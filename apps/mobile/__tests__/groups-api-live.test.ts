/* eslint-disable import/first */

/**
 * Outcome: every membership and settings call in the app's groups client
 * (`src/groups/api.ts`) reaches the real server and gets back a payload its
 * own guards accept. The competition calls run in
 * `groups-competition-api-live.test.ts`, this lane's second suite
 * (supabase/tests/groups-competition-live.sh).
 *
 * The other groups Jest suites mock Supabase, and the backend lanes
 * (groups-contract, groups-leaderboards) call the RPCs with curl, so neither
 * notices when the app's RPC names, parameter names or expected response
 * shapes drift from the server. This suite runs the REAL client code against
 * THIS worktree's local Supabase, signed in as two users the lane provisions
 * for this run (an owner and a member), so a drift fails here instead of on a
 * device. It is the wire half of what ios-groups-e2e used to prove; the server
 * rules themselves stay in the backend lanes.
 *
 * Runs only through `./boga test groups-api-live`
 * (supabase/tests/groups-api-live.sh), which provisions the users, exports
 * GROUPS_LIVE_* and deletes everything the run made. The default `jest` run
 * ignores this file; without the env it fails hard rather than skipping.
 *
 * Hermetic: each test creates its own group(s), so no test depends on another.
 */

import { readGroupsLiveEnv, signInLiveClient, type LiveClient } from './helpers/groups-live-endpoint';

let mockActiveClient: LiveClient['client'] | null = null;

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => {
    if (!mockActiveClient) throw new Error('groups-api-live: no signed-in client is active');
    return mockActiveClient;
  },
}));

import {
  createGroup,
  getGroup,
  getGroupInviteCode,
  joinGroup,
  leaveGroup,
  listMyGroups,
  previewGroupInvite,
  regenerateGroupInviteCode,
  removeGroupMember,
  setGroupMemberRole,
  transferGroupOwnership,
  updateGroup,
} from '@/src/groups/api';

const env = readGroupsLiveEnv();
let owner: LiveClient;
let member: LiveClient;

const as = async <T>(user: LiveClient, call: () => Promise<T>): Promise<T> => {
  mockActiveClient = user.client;
  try {
    return await call();
  } finally {
    mockActiveClient = null;
  }
};

/** The owner creates a group; the member joins it. */
const groupWithMember = async (name: string) => {
  const { group_id: groupId } = await as(owner, () => createGroup({ name, description: null }));
  const { code } = await as(owner, () => getGroupInviteCode(groupId));
  await as(member, () => joinGroup(code));
  return { groupId };
};

beforeAll(async () => {
  owner = await signInLiveClient(env, env.ownerEmail);
  member = await signInLiveClient(env, env.memberEmail);
});

afterAll(async () => {
  await owner?.teardown();
  await member?.teardown();
});

describe('groups client against the live server', () => {
  it('creates, invites, previews, joins, reads and updates a group', async () => {
    const { group_id: groupId } = await as(owner, () => createGroup({ name: 'Live create', description: 'd' }));
    const first = await as(owner, () => getGroupInviteCode(groupId));
    const { code } = await as(owner, () => regenerateGroupInviteCode(groupId));
    expect(code).not.toBe(first.code);

    const preview = await as(member, () => previewGroupInvite(code));
    expect(preview).toMatchObject({ group_id: groupId, member_count: 1, already_member: false });
    expect(await as(member, () => joinGroup(code))).toEqual({ group_id: groupId, joined: true });

    const mine = await as(member, () => listMyGroups());
    expect(mine.groups.map((group) => group.group_id)).toContain(groupId);
    const got = await as(owner, () => getGroup(groupId));
    expect(got.group).toMatchObject({ member_count: 2, my_role: 'owner' });
    expect(got.members.map((m) => m.user_id).sort()).toEqual([owner.userId, member.userId].sort());

    const updated = await as(owner, () =>
      updateGroup(groupId, { name: 'Live renamed', description: null, bodyweightCalculationsEnabled: true }),
    );
    expect(updated.group).toMatchObject({ name: 'Live renamed', bodyweight_calculations_enabled: true });
  });

  it('changes roles, transfers ownership, removes a member, and leaves', async () => {
    const { groupId } = await groupWithMember('Live members');
    const promoted = await as(owner, () => setGroupMemberRole(groupId, member.userId, 'admin'));
    expect(promoted.members.find((m) => m.user_id === member.userId)?.role).toBe('admin');
    await as(owner, () => setGroupMemberRole(groupId, member.userId, 'member'));

    const transferred = await as(owner, () => transferGroupOwnership(groupId, member.userId));
    expect(transferred.members.find((m) => m.user_id === member.userId)?.role).toBe('owner');
    const removed = await as(member, () => removeGroupMember(groupId, owner.userId));
    expect(removed.members.map((m) => m.user_id)).toEqual([member.userId]);

    const second = await groupWithMember('Live leave');
    expect(await as(member, () => leaveGroup(second.groupId))).toEqual({ group_id: second.groupId });
    const after = await as(owner, () => getGroup(second.groupId));
    expect(after.group.member_count).toBe(1);
  });
});
