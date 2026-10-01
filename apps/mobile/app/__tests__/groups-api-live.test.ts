/* eslint-disable import/first */

/**
 * Outcome: every call in the app's groups client (`src/groups/api.ts`) reaches
 * the real server and gets back a payload its own guards accept.
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
 * Hermetic: each test creates its own group(s) and session ids, so no test
 * depends on another. The member's sessions go in through `sync_push`, as the
 * member's own app would send them.
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
  archiveGroupExercise,
  cancelGroupCertification,
  certifyGroupMetric,
  certifyGroupSet,
  createGroup,
  createGroupComparison,
  createGroupExercise,
  endGroupMetricCertification,
  getGroup,
  getGroupBoard,
  getGroupBoardHistory,
  getGroupBoardPodiums,
  getGroupInviteCode,
  getGroupMetricBoard,
  getGroupMetricCertification,
  getGroupMetricHistory,
  getGroupMetricPodiums,
  getGroupMetricRevisions,
  getGroupMetricStream,
  getGroupSessionDetail,
  getGroupStream,
  joinGroup,
  leaveGroup,
  listGroupComparisons,
  listGroupExercises,
  listMyGroups,
  previewGroupInvite,
  regenerateGroupInviteCode,
  removeGroupMember,
  setGroupMemberRole,
  transferGroupOwnership,
  unarchiveGroupExercise,
  updateGroup,
  updateGroupComparison,
  updateGroupExercise,
  withdrawGroupCertification,
} from '@/src/groups/api';
import type { GroupMetricBoardWire } from '@/src/groups/metric-wire';

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

let seq = 0;
const uniqueId = (label: string) => `groups-api-live-${env.runTag}-${label}-${(seq += 1)}`;

/** The owner creates a group; the member joins it. Returns the group id and the member's join time. */
const groupWithMember = async (name: string) => {
  const { group_id: groupId } = await as(owner, () => createGroup({ name, description: null }));
  const { code } = await as(owner, () => getGroupInviteCode(groupId));
  await as(member, () => joinGroup(code));
  // The share rule compares started_at with the server's joined_at; read it
  // back so a pushed session never starts before it, whatever the clock skew.
  const stream = await as(member, () => getGroupStream({ groupId }));
  const joined = stream.items.find(
    (item) => item.kind === 'membership' && item.event === 'joined' && item.member.user_id === member.userId,
  );
  if (!joined) throw new Error(`no "joined" item for the member in ${JSON.stringify(stream.items)}`);
  return { groupId, joinedAtMs: joined.sort_at_ms };
};

let lastCuam = 0;
const nextCuam = () => (lastCuam = Math.max(Date.now(), lastCuam + 1));
const entity = (type: string, id: string, cuam: number, fields: Record<string, unknown>) => ({
  type,
  id,
  client_updated_at_ms: cuam,
  fields,
});

type SetSpec = { weight: string; reps: string };

/** A completed (or active) one-exercise session of the member's, plus its exercise definition. */
const pushMemberSession = async ({
  startedAt,
  completed,
  sets,
  link,
}: {
  startedAt: number;
  completed: boolean;
  sets: SetSpec[];
  link?: { groupId: string; groupExerciseId: string };
}) => {
  const cuam = nextCuam();
  const sessionId = uniqueId('session');
  const definitionId = `${sessionId}-def`;
  const exerciseId = `${sessionId}-ex`;
  const completedAt = completed ? startedAt + 45 * 60 * 1000 : null;
  const entities = [
    entity('exercise_definitions', definitionId, cuam, {
      name: 'Bench Press', load_input_mode: 'total_load', bodyweight_contribution: 0,
      created_at: cuam, updated_at: cuam, deleted_at: null,
    }),
    ...(link
      ? [
          entity('exercise_group_links', `${link.groupId}:${definitionId}`, cuam, {
            exercise_definition_id: definitionId, group_id: link.groupId, group_exercise_id: link.groupExerciseId,
            created_at: cuam, updated_at: cuam, deleted_at: null,
          }),
        ]
      : []),
    entity('sessions', sessionId, cuam, {
      gym_id: null, status: completed ? 'completed' : 'active', started_at: startedAt, completed_at: completedAt,
      duration_sec: completedAt === null ? null : Math.round((completedAt - startedAt) / 1000),
      created_at: startedAt, updated_at: cuam, deleted_at: null,
    }),
    entity('session_exercises', exerciseId, cuam, {
      session_id: sessionId, exercise_definition_id: definitionId, order_index: 0, name: 'Bench Press',
      machine_name: null, created_at: cuam, updated_at: cuam, deleted_at: null,
    }),
    ...sets.map((set, index) =>
      entity('exercise_sets', `${sessionId}-set-${index + 1}`, cuam, {
        session_exercise_id: exerciseId, order_index: index, weight_value: set.weight, reps_value: set.reps,
        set_type: 'working', planned_weight_value: null, planned_reps_value: null, planned_set_type: null,
        performance_status: null, created_at: cuam, updated_at: cuam, deleted_at: null,
      }),
    ),
  ];
  const { data, error } = (await member.client.schema('app_public').rpc('sync_push', { entities })) as {
    data: { ok?: boolean } | null;
    error: { message: string } | null;
  };
  if (error || data?.ok !== true) throw new Error(`sync_push failed: ${error?.message ?? JSON.stringify(data)}`);
  return { sessionId, firstSetId: `${sessionId}-set-1` };
};

/** The evaluator applies a push asynchronously (pg_net kick, pg_cron sweep backup): poll until it has. */
const poll = async <T>(label: string, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> => {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`${label}: not ready after 90s; last read ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
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

  it('writes and reads the group exercise catalogue', async () => {
    const { groupId } = await groupWithMember('Live exercises');
    const copy = await as(owner, () =>
      createGroupExercise(groupId, {
        name: 'Barbell Bench Press', loadInputMode: 'total_load', sourceExerciseId: 'seed_barbell_bench_press',
      }),
    );
    const custom = await as(owner, () =>
      createGroupExercise(groupId, { name: 'Sled Push', loadInputMode: 'per_side_load', sourceExerciseId: null }),
    );
    const renamed = await as(owner, () =>
      updateGroupExercise(groupId, custom.exercise.group_exercise_id, { name: 'Prowler Push', loadInputMode: 'per_side_load' }),
    );
    expect(renamed.exercise.name).toBe('Prowler Push');
    const archived = await as(owner, () => archiveGroupExercise(groupId, copy.exercise.group_exercise_id));
    expect(archived.exercise.archived_at_ms).not.toBeNull();
    const unarchived = await as(owner, () => unarchiveGroupExercise(groupId, copy.exercise.group_exercise_id));
    expect(unarchived.exercise.archived_at_ms).toBeNull();

    const comparison = await as(owner, () =>
      createGroupComparison(groupId, {
        name: 'Pull-up', loadInputMode: 'total_load', bodyweightCalculationsEnabled: true,
        bodyweightContribution: 1, defaultMetric: 'e1rm', sourceExerciseId: null,
      }),
    );
    const revised = await as(owner, () =>
      updateGroupComparison(groupId, comparison.exercise.group_exercise_id, comparison.exercise.rules_revision, {
        name: 'Pull-up', loadInputMode: 'total_load', bodyweightCalculationsEnabled: true,
        bodyweightContribution: 0.7, defaultMetric: 'e1rm',
      }),
    );
    expect(revised.exercise.bodyweight_contribution).toBe(0.7);
    const revisions = await as(owner, () => getGroupMetricRevisions(groupId, comparison.exercise.group_exercise_id));
    expect(revisions.revisions.length).toBeGreaterThanOrEqual(1);

    // A member reads both catalogue readers.
    const names = (await as(member, () => listGroupExercises(groupId))).exercises.map((e) => e.name).sort();
    expect(names).toEqual(['Barbell Bench Press', 'Prowler Push', 'Pull-up']);
    expect((await as(member, () => listGroupComparisons(groupId))).exercises).toHaveLength(3);
  });

  it("shares the member's session into both streams and its detail", async () => {
    const { groupId, joinedAtMs } = await groupWithMember('Live stream');
    const { sessionId, firstSetId } = await pushMemberSession({
      startedAt: Math.max(Date.now(), joinedAtMs + 1000), completed: false, sets: [{ weight: '100', reps: '5' }],
    });

    const stream = await as(owner, () => getGroupStream({ groupId }));
    expect(stream.items).toContainEqual(
      expect.objectContaining({ kind: 'session', session_id: sessionId, status: 'active' }),
    );
    const v2 = await as(owner, () => getGroupMetricStream({ groupId }));
    expect(v2.contract_version).toBe(3);
    const detail = await as(owner, () => getGroupSessionDetail(member.userId, sessionId));
    expect(JSON.stringify(detail.session)).toContain(firstSetId);
  });

  it('ranks a linked record on a comparison board, then certifies, withdraws and cancels per metric', async () => {
    const { groupId, joinedAtMs } = await groupWithMember('Live metric boards');
    const target = await as(owner, () =>
      createGroupComparison(groupId, {
        name: 'Bench', loadInputMode: 'total_load', bodyweightCalculationsEnabled: false,
        bodyweightContribution: 0, defaultMetric: 'weight', sourceExerciseId: null,
      }),
    );
    const groupExerciseId = target.exercise.group_exercise_id;
    const { firstSetId } = await pushMemberSession({
      startedAt: Math.max(Date.now(), joinedAtMs + 1000), completed: true, sets: [{ weight: '110', reps: '5' }],
      link: { groupId, groupExerciseId },
    });
    const view = { groupId, groupExerciseId, metric: 'weight' as const, certified: false };
    const board = await poll<GroupMetricBoardWire>(
      'Weight · All board',
      () => as(owner, () => getGroupMetricBoard(view)),
      (b) => b.entries.length > 0,
    );
    const row = board.entries[0];
    expect(row).toMatchObject({ value: 110, certified: false, set_id: firstSetId });
    expect(row.member.user_id).toBe(member.userId);
    const podiums = await as(owner, () => getGroupMetricPodiums(groupId, false));
    expect(podiums.exercises.map((card) => card.exercise.group_exercise_id)).toContain(groupExerciseId);
    const history = await as(owner, () => getGroupMetricHistory(view));
    expect(history.events.length).toBeGreaterThan(0);

    const certify = () =>
      as(owner, () =>
        certifyGroupMetric({
          ...view, memberUserId: member.userId, setId: row.set_id,
          expectedRevision: board.rules_revision, expectedFingerprint: row.fingerprint,
        }),
      );
    const first = await certify();
    const certificationId = first.certification.certification_id;
    const read = await as(member, () => getGroupMetricCertification(groupId, certificationId));
    expect(read.certification.certified_by?.user_id).toBe(owner.userId);
    const withdrawn = await as(owner, () => endGroupMetricCertification(groupId, certificationId, 'withdraw'));
    expect(withdrawn.certification.end_reason).toBe('withdrawn');
    const second = await certify();
    const cancelled = await as(owner, () =>
      endGroupMetricCertification(groupId, second.certification.certification_id, 'cancel'),
    );
    expect(cancelled.certification.end_reason).toBe('cancelled');
  }, 120_000);

  it('ranks a linked record on a legacy board, then certifies, withdraws and cancels the set', async () => {
    const { groupId, joinedAtMs } = await groupWithMember('Live legacy boards');
    const target = await as(owner, () =>
      createGroupExercise(groupId, { name: 'Bench', loadInputMode: 'total_load', sourceExerciseId: null }),
    );
    const groupExerciseId = target.exercise.group_exercise_id;
    const { firstSetId } = await pushMemberSession({
      startedAt: Math.max(Date.now(), joinedAtMs + 1000), completed: true, sets: [{ weight: '110', reps: '5' }],
      link: { groupId, groupExerciseId },
    });
    const view = { groupId, groupExerciseId, metric: 'weight' as const, certified: false };
    const board = await poll('legacy Weight · All board', () => as(owner, () => getGroupBoard(view)), (b) => b.rows.length > 0);
    expect(board.rows[0]).toMatchObject({ set_id: firstSetId, value_kg: 110, certified: false });
    expect(board.rows[0].member.user_id).toBe(member.userId);
    const podiums = await as(owner, () => getGroupBoardPodiums(groupId));
    expect(podiums.exercises.map((exercise) => exercise.exercise.group_exercise_id)).toContain(groupExerciseId);
    const history = await as(owner, () => getGroupBoardHistory(view));
    expect(history.items.length).toBeGreaterThan(0);

    const certify = () =>
      as(owner, () => certifyGroupSet({ groupId, groupExerciseId, memberUserId: member.userId, setId: firstSetId }));
    const first = await certify();
    expect(first.created).toBe(true);
    await as(owner, () => withdrawGroupCertification(groupId, first.certification.certification_id));
    const second = await certify();
    await as(owner, () => cancelGroupCertification(groupId, second.certification.certification_id));
  }, 120_000);
});
