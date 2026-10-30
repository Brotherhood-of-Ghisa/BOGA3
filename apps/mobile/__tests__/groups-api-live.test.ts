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
import { randomBytes, randomUUID } from 'node:crypto';

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
  getCoWCalendar, setCoWCalendar, createCoW, updateCoW, cancelCoW, getCoW, listCoWs,
  createCompetitionExercise,
} from '@/src/groups/api';

import { getNotificationPreferences, registerNotificationInstallation, setGroupNotificationMuted,
  setNotificationCategories, unregisterNotificationInstallation } from '@/src/notifications/api';
import { notificationSessionIdentity, setNotificationAccount } from '@/src/notifications/auth-boundary';

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
  it('round-trips every CoW definition/calendar RPC through the real client guards', async () => {
    const { groupId } = await groupWithMember('Live CoW');
    const calendar = await as(owner, () => getCoWCalendar(groupId));
    expect(calendar.time_zone).toBe('Europe/London');
    const zone = await as(owner, () => setCoWCalendar(groupId, calendar.revision, 'UTC'));
    const exercise = await as(owner, () => createCompetitionExercise({
      groupId, name: 'CoW bench', mode: 'total_load', contribution: 0, metric: 'e1rm',
    }));
    const input = { cowId: randomUUID(), groupExerciseId: exercise.exercise.group_exercise_id,
      metrics: ['e1rm', 'volume'] as ('e1rm' | 'volume')[], calendarRevision: zone.revision, weekStart: zone.next_week_start! };
    const created = await as(owner, () => createCoW(groupId, input));
    expect(created.cow).toMatchObject({ cow_id: input.cowId, time_zone: 'UTC', state: 'scheduled', revision: 1 });
    expect(await as(owner, () => createCoW(groupId, input))).toEqual(created);
    expect(await as(member, () => getCoW(groupId, input.cowId))).toEqual(created);
    expect((await as(member, () => listCoWs(groupId))).cows).toEqual([created.cow]);
    await expect(as(member, () => createCoW(groupId, { ...input, cowId: randomUUID() }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const edited = await as(owner, () => updateCoW(groupId, input.cowId, {
      revision: 1, groupExerciseId: input.groupExerciseId, metrics: ['improvement'],
    }));
    expect(edited.cow).toMatchObject({ metrics: ['improvement'], revision: 2 });
    const cancelled = await as(owner, () => cancelCoW(groupId, input.cowId, 2));
    expect(cancelled.cow.state).toBe('cancelled');
    expect((await as(owner, () => listCoWs(groupId))).cows).toEqual([]);
    await as(owner, () => createCoW(groupId, { ...input, cowId: randomUUID() }));
    await as(owner, () => removeGroupMember(groupId, member.userId));
    await expect(as(member, () => getCoW(groupId, input.cowId))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

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

const asNotification = async <T>(user: LiveClient, call: () => Promise<T>): Promise<T> => {
  const account = notificationSessionIdentity(user.session);
  if (!account) throw new Error('Notification live fixture has no Auth session identity');
  setNotificationAccount(account, user.session.access_token);
  try { return await as(user, call); }
  finally { setNotificationAccount(null); }
};

describe('notification client against the live server', () => {
  it('persists account categories and group mutes with live membership and owner isolation', async () => {
    const { groupId } = await groupWithMember('Live notification controls');
    const defaults = { activity: true, bests: true, ranks: true, muted: false };
    expect(await asNotification(owner, () => getNotificationPreferences(groupId))).toEqual(defaults);
    expect(await asNotification(owner, () => setNotificationCategories({ activity: false, bests: true, ranks: false })))
      .toMatchObject({ activity: false, bests: true, ranks: false });
    expect(await asNotification(owner, () => setGroupNotificationMuted(groupId, true))).toMatchObject({ muted: true });
    expect(await asNotification(owner, () => getNotificationPreferences(groupId))).toMatchObject({ activity: false, ranks: false, muted: true });
    expect(await asNotification(member, () => getNotificationPreferences(groupId))).toEqual(defaults);
    await as(owner, () => removeGroupMember(groupId, member.userId));
    await expect(asNotification(member, () => getNotificationPreferences(groupId))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(asNotification(member, () => setGroupNotificationMuted(groupId, true))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('registers exact local wire material, rotates token/account bindings and rejects a foreign capability', async () => {
    const projectId = process.env.GROUPS_LIVE_NOTIFICATION_PROJECT_ID;
    const bundleId = process.env.GROUPS_LIVE_NOTIFICATION_BUNDLE_ID;
    if (!projectId || !bundleId) throw new Error('Notification live configuration is required');
    const material = { installationId: randomUUID(), capability: randomBytes(32).toString('base64'),
      encryptionKey: randomBytes(32).toString('base64'), token: `LocalPushToken[${randomUUID()}]`,
      environment: 'local' as const, projectId, bundleId, permission: true, optedIn: true };
    const first = await asNotification(owner, () => registerNotificationInstallation(material));
    expect(await asNotification(owner, () => registerNotificationInstallation(material))).toBe(first);
    const rotated = { ...material, token: `LocalPushToken[${randomUUID()}]` };
    const second = await asNotification(owner, () => registerNotificationInstallation(rotated));
    expect(second).not.toBe(first);
    await expect(asNotification(member, () => registerNotificationInstallation({ ...rotated, capability: randomBytes(32).toString('base64') })))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const rebound = { ...rotated, encryptionKey: randomBytes(32).toString('base64') };
    const third = await asNotification(member, () => registerNotificationInstallation(rebound));
    expect(third).not.toBe(second);
    const binding = { installationId: material.installationId, bindingId: third };
    await asNotification(owner, () => unregisterNotificationInstallation(binding));
    expect(await asNotification(member, () => registerNotificationInstallation(rebound))).toBe(third);
    await asNotification(member, () => unregisterNotificationInstallation(binding));
    expect(await asNotification(member, () => registerNotificationInstallation(rebound))).not.toBe(third);
  });
});
