import { eq } from 'drizzle-orm';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { applyPullPage, entityToWire, runSyncCycle, type WireEntity } from '@/src/sync/cycle';
import { syncExerciseMerges, validateMergeOutcomes } from '@/src/sync/exercise-merge';
import { guardSessionMergeEdit, listMergeLocal, readMergeLocal, writeMergeLocal } from '@/src/data/exercise-merge-store';
import { exerciseDefinitions, exerciseSessionFacts, exerciseSessionFactsStale, exerciseSets, gyms, sessionExercises, sessionPlans, sessionPlanExercises, sessionPlanSets, syncRuntimeState } from '@/src/data/schema';
import { wipeLocalDatabaseRows } from '@/src/data/local-wipe';
import * as dataBootstrap from '@/src/data/bootstrap';
import { createDrizzleSessionDraftStore, loadSessionSnapshotById, updateSessionMetadata } from '@/src/data/session-drafts';
import { mapDraftSnapshotToSession } from '@/src/session-recorder/session-model';
import { saveCompletedSessionEdit } from '@/src/session-recorder/session-lifecycle';
import { drainExerciseSessionFacts, rebuildAllExerciseSessionFacts } from '@/src/data/exercise-session-facts';
import type { LocalDatabase } from '@/src/data/bootstrap';
import type { Transaction } from '@/src/data/clock';
import type { MergeWireEntity } from '@/src/exercise-core/merge-types';

jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
const mockRpc = jest.fn();
const mockHeaders = jest.fn();
let mockSignedOwner = 'merge-owner';
jest.mock('@/src/auth/session-user', () => ({ getSignedInUserId: async () => mockSignedOwner }));
jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'merge-owner' }, access_token: 'test-token' } } }) },
    schema: () => ({ rpc: (name: string, args: unknown) => ({ setHeader: (header: string, value: string) => { mockHeaders(header, value); return mockRpc(name, args); } }) }),
  }),
  getMobileAuthRuntimeConfig: () => ({ isConfigured: false }),
}));
let fixture: InMemoryDatabaseFixture;
let database: LocalDatabase;
const owner = 'merge-owner';
const at = new Date(100);
beforeEach(() => {
  fixture = createInMemoryDatabase();
  database = fixture.database as unknown as LocalDatabase;
  database.insert(exerciseDefinitions).values([{ id: 'a', name: 'A' }, { id: 'b', name: 'B', loadInputMode: 'per_side_load' }]).run();
  fixture.client.prepare("insert into sessions(id,status,started_at,completed_at,created_at,updated_at) values('session','completed',1,2,1,2)").run();
  database.insert(sessionExercises).values({ id: 'block', sessionId: 'session', exerciseDefinitionId: 'a', name: 'A',
    orderIndex: 0, createdAt: at, updatedAt: at, localUpdatedAtMs: 100 }).run();
  database.insert(exerciseSets).values({ id: 'set', sessionExerciseId: 'block', orderIndex: 0, weightValue: '40',
    repsValue: '5', createdAt: at, updatedAt: at, localUpdatedAtMs: 100 }).run();
  database.insert(syncRuntimeState).values({ id: 'primary', accountUserId: owner }).run();
  mockRpc.mockReset(); mockHeaders.mockReset(); mockSignedOwner = 'merge-owner';
});
afterEach(() => fixture.close());
const wire = (row: unknown, type: string) => entityToWire(row as Parameters<typeof entityToWire>[0], type as WireEntity['type']);
const adapter = {
  toWire: (row: Record<string, unknown>, type: string) => wire(row, type),
  apply: (tx: Transaction, rows: MergeWireEntity[], force = false) => {
    let changed = 0;
    for (const type of ['exercise_definitions', 'session_exercises', 'exercise_sets'] as const) {
      changed += applyPullPage(tx, rows.filter(row => row.type === type) as WireEntity[], type, force);
    }
    return changed;
  },
};
function canonical(): MergeWireEntity[] {
  const block = database.select().from(sessionExercises).get()!;
  const set = database.select().from(exerciseSets).get()!;
  return [
    wire({ ...block, exerciseDefinitionId: 'b', name: 'B', mergeRevision: 1, localUpdatedAtMs: 200 }, 'session_exercises'),
    wire({ ...set, weightValue: '20', mergeRevision: 1, localUpdatedAtMs: 200 }, 'exercise_sets'),
  ];
}
function rpcPages(rows = canonical()) {
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'exercise_merge_snapshot') return { data: { sequence: 1, token: 'token', rows, nextOffset: rows.length, hasMore: false }, error: null };
    if (name === 'exercise_merge_save_conflict') return { data: 'preserved', error: null };
    if (name === 'exercise_merge_review') return { data: { items: [], hasMore: false }, error: null };
    throw new Error('Unexpected RPC ' + name);
  });
}
const sync = () => syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount: 0, adapter });

it('keeps the complete old graph on ordinary partial pulls, then installs the complete new context', async () => {
  const rows = canonical();
  database.transaction(tx => applyPullPage(tx, [rows[0] as WireEntity], 'session_exercises'));
  expect(database.select().from(sessionExercises).get()?.exerciseDefinitionId).toBe('a');
  expect(database.select().from(exerciseSets).get()?.weightValue).toBe('40');
  rpcPages(rows);
  await sync();
  expect(database.select().from(sessionExercises).get()).toMatchObject({ exerciseDefinitionId: 'b', mergeRevision: 1 });
  expect(database.select().from(exerciseSets).get()).toMatchObject({ weightValue: '20', mergeRevision: 1, localDirty: false });
  const stale = { ...rows[1], client_updated_at_ms: 9999, fields: { ...rows[1].fields, merge_revision: 0, weight_value: '80' } };
  database.transaction(tx => applyPullPage(tx, [stale as WireEntity], 'exercise_sets'));
  expect(database.select().from(exerciseSets).get()?.weightValue).toBe('20');
});

it('preserves a future-clock edit before canonical replacement and uploads its original units', async () => {
  const rows = canonical();
  database.update(exerciseSets).set({ weightValue: '44', localDirty: true, localUpdatedAtMs: 9999 }).run();
  rpcPages(rows);
  await sync();
  expect(mockRpc).toHaveBeenCalledWith('exercise_merge_save_conflict', expect.objectContaining({
    p_row: expect.objectContaining({ id: 'set', weight_value: '44', merge_revision: 0 }),
  }));
  expect(database.select().from(exerciseSets).get()?.weightValue).toBe('20');
});

it('keeps edits made while the snapshot is downloading, including a new unsent set', async () => {
  const rows = canonical();
  rpcPages(rows);
  mockRpc.mockImplementationOnce(async () => {
    database.insert(exerciseSets).values({ id: 'new-set', sessionExerciseId: 'block', orderIndex: 1,
      weightValue: '35', repsValue: '8', localDirty: true, localUpdatedAtMs: 500 }).run();
    return { data: { sequence: 1, token: 'token', rows, nextOffset: rows.length, hasMore: false }, error: null };
  });
  await sync();
  expect(mockRpc).toHaveBeenCalledWith('exercise_merge_save_conflict', expect.objectContaining({
    p_row: expect.objectContaining({ id: 'new-set', weight_value: '35' }),
  }));
  expect(database.select().from(exerciseSets).all()).toHaveLength(1);
});

it('retains coherent raw history and resumes durable staged pages after interruption', async () => {
  const rows = canonical();
  mockRpc.mockImplementationOnce(async () => ({ data: {
    sequence: 1, token: 'token', rows: [rows[0]], nextOffset: 1, hasMore: true,
  }, error: null })).mockRejectedValueOnce(new Error('Offline'));
  await expect(sync()).rejects.toThrow('Offline');
  expect(database.select().from(sessionExercises).get()?.exerciseDefinitionId).toBe('a');
  expect(database.select().from(exerciseSets).get()?.weightValue).toBe('40');
  mockRpc.mockImplementationOnce(async (_name, args) => {
    expect(args).toMatchObject({ p_offset: 1, p_token: 'token' });
    return { data: { sequence: 1, token: 'token', rows: [rows[1]], nextOffset: 2, hasMore: false }, error: null };
  });
  await sync();
  expect(readMergeLocal(database, owner, 'sequence')).toBe(1);
  expect(listMergeLocal(database, owner, 'stage')).toHaveLength(0);
});

it('does not discard pending edits when upload fails and keeps them private across an account wipe', async () => {
  const rows = canonical();
  database.update(exerciseSets).set({ weightValue: '46', localDirty: true, localUpdatedAtMs: 9999 }).run();
  rpcPages(rows);
  mockRpc.mockImplementation(async name => name === 'exercise_merge_snapshot' ?
    { data: { sequence: 1, token: 'token', rows, nextOffset: rows.length, hasMore: false }, error: null } :
    { data: null, error: { message: 'Offline' } });
  await expect(sync()).rejects.toThrow('Offline');
  expect(listMergeLocal(database, owner, 'pending')).toHaveLength(1);
  wipeLocalDatabaseRows(database, { accountUserId: 'other' });
  expect(listMergeLocal(database, 'other', 'pending')).toHaveLength(0);
  expect(listMergeLocal(database, owner, 'pending')).toHaveLength(1);
  expect(readMergeLocal(database, owner, 'sequence')).toBeNull();
});

it('preserves an old editor snapshot instead of upgrading its revision from the latest database', async () => {
  rpcPages(); await sync();
  expect(guardSessionMergeEdit(database, {
    sessionId: 'session', exercises: [{ id: 'block', exerciseDefinitionId: 'a', name: 'A', mergeRevision: 0,
      sets: [{ id: 'set', weightValue: '48', repsValue: '6' }] }],
  })).toBe(true);
  expect(database.select().from(exerciseSets).get()?.weightValue).toBe('20');
  const pending = listMergeLocal(database, owner, 'pending').map(row => JSON.parse(row.payload));
  expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({
    type: 'exercise_sets', fields: expect.objectContaining({ weight_value: '48', merge_revision: 0 }),
  })]));
});

it('validates selective acknowledgements without accepting missing, duplicate or unknown rows', () => {
  const batch = canonical();
  expect(() => validateMergeOutcomes({ ok: true, outcomes: [] }, batch)).toThrow(/Incomplete/);
  expect(() => validateMergeOutcomes({ ok: true, outcomes: batch.map(row => ({ type: row.type, id: 'wrong', outcome: 'accepted' })) }, batch)).toThrow(/Invalid/);
  expect(() => validateMergeOutcomes({ ok: true, outcomes: batch.map(row => ({ type: row.type, id: row.id, outcome: 'preserved' })) }, batch)).not.toThrow();
  expect(() => validateMergeOutcomes(null, batch)).toThrow(/acknowledge/);
});


it('revalidates a complete staged snapshot before it can replace newly pulled clean rows', async () => {
  const rows = canonical();
  database.transaction(tx => {
    writeMergeLocal(tx, { ownerUserId: owner, id: 'stage', kind: 'stage',
      payload: { after: 0, token: 'old', nextOffset: rows.length, sequence: 1, complete: true } });
    writeMergeLocal(tx, { ownerUserId: owner, id: 'stage:0', kind: 'stage', payload: rows });
  });
  database.insert(exerciseSets).values({ id: 'new-clean', sessionExerciseId: 'block', orderIndex: 1,
    weightValue: '12', repsValue: '8', localDirty: false }).run();
  mockRpc.mockResolvedValue({ data: null, error: { message: 'MERGE_STALE: graph changed' } });
  await expect(syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount: 0, adapter })).rejects.toThrow(/MERGE_STALE/);
  expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'new-clean')).get()?.weightValue).toBe('12');
  expect(readMergeLocal(database, owner, 'stage')).toBeNull();
  const clean = database.select().from(exerciseSets).where(eq(exerciseSets.id, 'new-clean')).get()!;
  rpcPages([...rows, wire({ ...clean, mergeRevision: 1 }, 'exercise_sets')]);
  await syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount: 0, adapter });
  expect(database.select().from(exerciseSets).all()).toHaveLength(2);
});

it('stales both definitions and folds repeated destination blocks identically to a full facts rebuild', async () => {
  database.insert(sessionExercises).values({ id: 'existing-b', sessionId: 'session', exerciseDefinitionId: 'b',
    name: 'B', orderIndex: 1, localUpdatedAtMs: 100 }).run();
  database.insert(exerciseSets).values({ id: 'b-set', sessionExerciseId: 'existing-b', orderIndex: 0,
    weightValue: '22', repsValue: '5', localUpdatedAtMs: 100 }).run();
  drainExerciseSessionFacts(database);
  const existingBlock = database.select().from(sessionExercises).where(eq(sessionExercises.id, 'existing-b')).get()!;
  const existingSet = database.select().from(exerciseSets).where(eq(exerciseSets.id, 'b-set')).get()!;
  rpcPages([...canonical(), wire({ ...existingBlock, mergeRevision: 1 }, 'session_exercises'),
    wire({ ...existingSet, mergeRevision: 1 }, 'exercise_sets')]);
  await syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount: 0, adapter });
  expect(database.select().from(exerciseSessionFactsStale).all().map(row => row.exerciseDefinitionId).sort()).toEqual(['a', 'b']);
  drainExerciseSessionFacts(database);
  const incremental = database.select().from(exerciseSessionFacts).all();
  expect(incremental).toHaveLength(1);
  expect(incremental[0]).toMatchObject({ exerciseDefinitionId: 'b', workingSets: 2, volumeKg: 420, topWeightKg: 22 });
  database.transaction(tx => rebuildAllExerciseSessionFacts(tx));
  expect(database.select().from(exerciseSessionFacts).all()).toEqual(incremental);
});

it('ignores absent tombstoned siblings in a fresh editor and preserves explicit clears and reorder positions', () => {
  database.update(sessionExercises).set({ mergeRevision: 1 }).run();
  database.insert(sessionExercises).values({ id: 'removed', sessionId: 'session', exerciseDefinitionId: 'a',
    name: 'A', orderIndex: 1, mergeRevision: 1, deletedAt: new Date(150) }).run();
  expect(guardSessionMergeEdit(database, { sessionId: 'session',
    exercises: [{ id: 'block', exerciseDefinitionId: 'a', name: 'A', mergeRevision: 1, sets: [] }] })).toBe(false);
  database.update(sessionExercises).set({ machineName: 'Cable' }).where(eq(sessionExercises.id, 'block')).run();
  expect(guardSessionMergeEdit(database, { sessionId: 'session', exercises: [
    { id: 'new', exerciseDefinitionId: 'b', name: 'B', sets: [] },
    { id: 'block', exerciseDefinitionId: 'a', name: 'A', machineName: null, mergeRevision: 0, sets: [] },
  ] })).toBe(true);
  const saved = listMergeLocal(database, owner, 'pending').map(row => JSON.parse(row.payload) as MergeWireEntity);
  expect(saved.find(row => row.id === 'block')?.fields).toMatchObject({ order_index: 1, machine_name: null });
});

it('saves safe new blocks before reporting a stale editor, keeping the merged graph canonical', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    database.update(sessionExercises).set({ exerciseDefinitionId: 'b', name: 'B', mergeRevision: 1 }).run();
    database.update(exerciseSets).set({ weightValue: '20', mergeRevision: 1 }).run();
    await expect(createDrizzleSessionDraftStore().saveCompletedSessionGraph({
      sessionId: 'session', gymId: null, startedAt: new Date(1), completedAt: new Date(2), durationSec: 1, now: new Date(300),
      exercises: [
        { id: 'block', exerciseDefinitionId: 'a', name: 'A', mergeRevision: 0, sets: [{ id: 'set', weightValue: '48', repsValue: '6' }] },
        { id: 'new-block', exerciseDefinitionId: 'b', name: 'New B', sets: [{ id: 'new-work', weightValue: '15', repsValue: '7' }] },
      ],
    })).rejects.toThrow(/saved for review/);
    expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'block')).get()).toMatchObject({ exerciseDefinitionId: 'b', mergeRevision: 1 });
    expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'set')).get()?.weightValue).toBe('20');
    expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'new-work')).get()).toMatchObject({ weightValue: '15', localDirty: true });
  } finally { boot.mockRestore(); }
});

it('pins push to its captured account and leaves the dirty row intact if the account changes in flight', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    database.update(syncRuntimeState).set({ bootstrapCompletedAt: new Date(200) }).run();
    database.insert(gyms).values({ id: 'private-a', name: 'A gym', localDirty: true, localUpdatedAtMs: 400 }).run();
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'sync_pull') return { data: { entities: [], next_cursor: null, has_more: false }, error: null };
      if (name === 'sync_push') { mockSignedOwner = 'other-account'; return { data: { ok: true }, error: null }; }
      throw new Error('Unexpected request ' + name);
    });
    await expect(runSyncCycle()).resolves.toBe('auth-required');
    expect(mockHeaders.mock.calls.every(([header, value]) => header === 'Authorization' && value === 'Bearer test-token')).toBe(true);
    expect(database.select().from(gyms).where(eq(gyms.id, 'private-a')).get()?.localDirty).toBe(true);
    expect(database.select().from(syncRuntimeState).get()?.accountUserId).toBe(owner);
    expect(mockRpc.mock.calls.filter(([name]) => name === 'sync_push')).toHaveLength(1);
  } finally { boot.mockRestore(); }
});

it.each(['same-session', 'outside-session'])('keeps losing plan attachments as unsourced work during canonical apply: %s', async location => {
  database.insert(sessionPlans).values({ id: 'plan', title: 'Plan' }).run();
  database.insert(sessionPlanExercises).values({ id: 'plan-block', sessionPlanId: 'plan', exerciseDefinitionId: 'a', name: 'A', orderIndex: 0 }).run();
  database.insert(sessionPlanSets).values({ id: 'plan-target', sessionPlanExerciseId: 'plan-block', orderIndex: 0, targetReps: 5 }).run();
  if (location === 'outside-session') fixture.client.prepare("insert into sessions(id,status,started_at,created_at,updated_at) values('active','active',1,1,1)").run();
  database.insert(sessionExercises).values({ id: 'loser', sessionId: location === 'same-session' ? 'session' : 'active',
    exerciseDefinitionId: 'a', name: 'A', orderIndex: 1, sourcePlanExerciseId: 'plan-block', localDirty: true }).run();
  database.insert(exerciseSets).values({ id: 'losing-work', sessionExerciseId: 'loser', orderIndex: 0,
    sourcePlanSetId: 'plan-target', weightValue: '55', repsValue: '7', localDirty: true }).run();
  const rows = canonical().map(row => ({ ...row, fields: { ...row.fields,
    ...(row.type === 'session_exercises' ? { source_plan_exercise_id: 'plan-block' } : { source_plan_set_id: 'plan-target' }),
  } }));
  rpcPages(rows);
  await syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount: 0, adapter });
  expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'loser')).get()).toMatchObject({ sourcePlanExerciseId: null, localDirty: true });
  expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'losing-work')).get()).toMatchObject({ sourcePlanSetId: null, weightValue: '55', repsValue: '7', localDirty: true });
  expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'block')).get()?.sourcePlanExerciseId).toBe('plan-block');
});

it('saves header edits independently and permits a freshly loaded merged block removal through Done', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    database.update(sessionExercises).set({ mergeRevision: 1 }).run();
    database.update(exerciseSets).set({ mergeRevision: 1 }).run();
    database.insert(gyms).values({ id: 'new-gym', name: 'Gym' }).run();
    await updateSessionMetadata('session', { gymId: 'new-gym', times: { startedAt: new Date(10), completedAt: new Date(6010) } });
    const snapshot = (await loadSessionSnapshotById('session'))!;
    expect(snapshot).toMatchObject({ gymId: 'new-gym', durationSec: 6 });
    expect(snapshot.exercises[0].mergeRevision).toBe(1);
    const session = mapDraftSnapshotToSession(snapshot);
    await saveCompletedSessionEdit({ sessionId: 'session', gymId: 'new-gym',
      times: { startedAt: snapshot.startedAt, completedAt: snapshot.completedAt! },
      completedHistorySession: { ...session, exercises: [] },
    });
    expect(database.select().from(sessionExercises).get()?.deletedAt).not.toBeNull();
    expect(listMergeLocal(database, owner, 'pending')).toHaveLength(0);
  } finally { boot.mockRestore(); }
});

it('refuses an old active finish before mutating metadata or appending blocks to a completed session', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    database.update(sessionExercises).set({ mergeRevision: 1 }).run();
    await expect(createDrizzleSessionDraftStore().saveDraftGraph({ sessionId: 'session', gymId: null,
      startedAt: new Date(9999), now: new Date(10000), status: 'active', exercises: [
        { id: 'block', exerciseDefinitionId: 'a', name: 'A', mergeRevision: 0, sets: [] },
        { id: 'new', exerciseDefinitionId: 'b', name: 'B', sets: [] },
      ],
    })).rejects.toThrow(/Cannot modify completed/);
    expect(database.select().from(sessionExercises).all()).toHaveLength(1);
    expect((await loadSessionSnapshotById('session'))?.startedAt.getTime()).toBe(1);
  } finally { boot.mockRestore(); }
});
