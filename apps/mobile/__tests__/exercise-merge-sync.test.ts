import { TOPO_LAYERS, type EntityTableName } from '@/src/sync/topo-order';
import { eq } from 'drizzle-orm';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { applyMergeRows, applyPullPage, entityToWire, runSyncCycle, selectPushBatch, type WireEntity } from '@/src/sync/cycle';
import { syncExerciseMerges, validateMergeOutcomes } from '@/src/sync/exercise-merge';
import { guardSessionMergeEdit, listMergeLocal, readMergeLocal, writeMergeLocal } from '@/src/data/exercise-merge-store';
import { exerciseDefinitions, exerciseSessionFacts, exerciseSessionFactsStale, exerciseSets, gyms, sessionExercises, sessionPlans, sessionPlanExercises, sessionPlanSets, sessionPlanUses, sessions, syncRuntimeState } from '@/src/data/schema';
import { wipeLocalDatabaseRows } from '@/src/data/local-wipe';
import * as dataBootstrap from '@/src/data/bootstrap';
import { createDrizzleSessionDraftStore, loadSessionSnapshotById, updateSessionMetadata } from '@/src/data/session-drafts';
import { mapDraftSnapshotToSession, toPersistDraftExercises } from '@/src/session-recorder/session-model';
import { captureSessionEditBaseline } from '@/src/data/session-edit-baseline';
import { setSessionDeletedState } from '@/src/data/session-list';
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
    for (const type of TOPO_LAYERS.flat() as EntityTableName[]) {
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
  mockRpc.mockImplementation(async (name: string, args: { p_offset?: number } = {}) => {
    if (name === 'exercise_merge_snapshot') return { data: { sequence: 1, token: 'token', rows: rows.slice(args.p_offset ?? 0), nextOffset: rows.length, hasMore: false }, error: null };
    if (name === 'exercise_merge_save_conflict') return { data: 'preserved', error: null };
    if (name === 'exercise_merge_review') return { data: { items: [], hasMore: false }, error: null };
    throw new Error('Unexpected RPC ' + name);
  });
}
const sync = () => syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount: 0, adapter });

async function withDatabase<T>(operation: () => Promise<T>): Promise<T> {
  const bootstrap = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try { return await operation(); } finally { bootstrap.mockRestore(); }
}

it('keeps a stale editor’s actual input for review when AI takes control, without changing the canonical graph', async () => {
  database.update(sessions).set({ status: 'active', completedAt: null, mergeRevision: 1 }).run();
  database.update(sessionExercises).set({ mergeRevision: 1 }).run();
  database.update(exerciseSets).set({ mergeRevision: 1 }).run();
  const snapshot = await withDatabase(() => loadSessionSnapshotById('session'));
  const session = mapDraftSnapshotToSession(snapshot!);
  session.exercises[0].sets[0].weight = '55';
  database.update(sessions).set({ loggingClientId: 'coach', loggingGrantedAt: '2026-11-10T10:00:00Z', mergeRevision: 2 }).run();
  database.update(sessionExercises).set({ mergeRevision: 2 }).run();
  database.update(exerciseSets).set({ mergeRevision: 2 }).run();
  await withDatabase(async () => {
    await expect(createDrizzleSessionDraftStore().saveDraftGraph({ sessionId: 'session', gymId: null,
      startedAt: snapshot!.startedAt, status: 'active', now: new Date(), exercises: toPersistDraftExercises(session),
      editBaseline: snapshot!.editBaseline })).rejects.toThrow(/saved for review/);
  });
  expect(database.select().from(exerciseSets).get()?.weightValue).toBe('40');
  const saved = listMergeLocal(database, owner, 'pending').map(row => JSON.parse(row.payload) as MergeWireEntity);
  expect(saved.some(row => row.type === 'exercise_sets' && row.fields.weight_value === '55' && row.fields.merge_revision === 1)).toBe(true);
});

it('drains a protected dirty graph before the final header and reuses its lifecycle ID until the intent changes', () => {
  database.update(sessions).set({ mergeRevision: 1, localDirty: true, localUpdatedAtMs: 500 }).run();
  database.update(sessionExercises).set({ mergeRevision: 1 }).run();
  database.update(exerciseSets).set({ mergeRevision: 1, localDirty: true }).run();
  expect(database.transaction(tx => selectPushBatch(tx, 200)).map(row => row.type)).toEqual(['exercise_sets']);
  database.update(exerciseSets).set({ localDirty: false }).run();
  const first = database.transaction(tx => selectPushBatch(tx, 200));
  expect(first).toHaveLength(1);
  expect(first[0].lifecycle_action).toMatchObject({ id: expect.stringMatching(/^lifecycle:/), base_revision: 1 });
  const retry = database.transaction(tx => selectPushBatch(tx, 200));
  expect(retry[0].lifecycle_action).toEqual(first[0].lifecycle_action);
  database.update(sessions).set({ startedAt: new Date(10), localUpdatedAtMs: 501 }).run();
  expect(database.transaction(tx => selectPushBatch(tx, 200))[0].lifecycle_action?.id)
    .not.toBe(first[0].lifecycle_action?.id);
});

it('recovers a lost lifecycle acknowledgement without saving already accepted intent as a conflict', async () => {
  database.delete(exerciseSets).run(); database.delete(sessionExercises).run();
  database.update(sessions).set({ mergeRevision: 1, localDirty: true, localUpdatedAtMs: 9999 }).run();
  const [sent] = database.transaction(tx => selectPushBatch(tx, 200));
  const current = database.select().from(sessions).get()!;
  rpcPages([wire({ ...current, mergeRevision: 2, localUpdatedAtMs: 10000 }, 'sessions')]);
  const pages = mockRpc.getMockImplementation()!;
  mockRpc.mockImplementation(async (name: string, args) => name === 'exercise_merge_status'
    ? { data: { id: sent.lifecycle_action!.id, sequence: 1, sessionId: 'session', workoutRevision: 2, matchesInput: true }, error: null }
    : pages(name, args));
  await sync();
  expect(database.select().from(sessions).get()).toMatchObject({ mergeRevision: 2, localDirty: false });
  expect(mockRpc.mock.calls.some(([name]) => name === 'exercise_merge_save_conflict')).toBe(false);
  expect(readMergeLocal(database, owner, 'lifecycle:session')).toBeNull();
});

async function loadedEdit() {
  const snapshot = (await loadSessionSnapshotById('session'))!;
  return { snapshot, input: { sessionId: 'session', gymId: snapshot.gymId, startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt!, durationSec: snapshot.durationSec ?? 0, now: new Date(300),
    editBaseline: snapshot.editBaseline, exercises: toPersistDraftExercises(mapDraftSnapshotToSession(snapshot)),
  } };
}
function advanceWorkout() {
  database.update(sessions).set({ mergeRevision: 1 }).run();
  database.update(sessionExercises).set({ mergeRevision: 1 }).run();
  database.update(exerciseSets).set({ mergeRevision: 1 }).run();
}

it('rejects a discard confirmed from an older lifecycle instead of deleting the newly completed workout', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    advanceWorkout();
    await expect(setSessionDeletedState('session', true, { expectedRevision: 0 })).rejects.toThrow(/changed elsewhere/);
    expect(database.select().from(sessions).get()).toMatchObject({ status: 'completed', deletedAt: null, mergeRevision: 1 });
    await setSessionDeletedState('session', true, { expectedRevision: 1 });
    expect(database.select().from(sessions).get()?.deletedAt).not.toBeNull();
  } finally { boot.mockRestore(); }
});

it('rebases independent timing fields and preserves an actual same-field timing conflict at the loaded epoch', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    database.update(sessions).set({ mergeRevision: 1, completedAt: new Date(200000) }).run();
    const applied = await updateSessionMetadata('session', { times: { startedAt: new Date(0), completedAt: new Date(2) },
      timesBaseline: { revision: 0, startedAt: new Date(1), completedAt: new Date(2) } });
    expect(applied).toEqual({ startedAt: new Date(0), completedAt: new Date(200000) });
    database.update(sessions).set({ mergeRevision: 2, completedAt: new Date(300000), localDirty: false }).run();
    await expect(updateSessionMetadata('session', { times: { startedAt: new Date(0), completedAt: new Date(250000) },
      timesBaseline: { revision: 1, startedAt: new Date(0), completedAt: new Date(200000) },
    })).rejects.toThrow(/saved for review/);
    expect(database.select().from(sessions).get()?.completedAt).toEqual(new Date(300000));
    const saved = listMergeLocal(database, owner, 'pending').map(row => JSON.parse(row.payload));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'sessions', fields: { completed_at: 250000, merge_revision: 1 } });
  } finally { boot.mockRestore(); }
});

it('preserves completed time edits when another phone resumes the workout and gives AI control', async () => {
  await withDatabase(async () => {
    database.update(sessions).set({ status: 'active', completedAt: null, mergeRevision: 2,
      loggingClientId: 'coach', loggingGrantedAt: '2026-11-10T12:00:00Z', localDirty: false }).run();
    await expect(updateSessionMetadata('session', {
      times: { startedAt: new Date(0), completedAt: new Date(250000) },
      timesBaseline: { revision: 0, startedAt: new Date(1), completedAt: new Date(2) },
    })).rejects.toThrow(/saved for review/);
    expect(database.select().from(sessions).get()).toMatchObject({
      status: 'active', completedAt: null, loggingClientId: 'coach', mergeRevision: 2, localDirty: false,
    });
    expect(listMergeLocal(database, owner, 'pending').map(row => JSON.parse(row.payload))).toMatchObject([
      { type: 'sessions', fields: { status: 'completed', started_at: 0, completed_at: 250000, merge_revision: 0 } },
    ]);
    await expect(updateSessionMetadata('session', { gymId: null })).rejects.toThrow(/AI is logging/);
  });
});

it('keeps ordinary timing edits usable on a workout that has never entered a protected epoch', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    database.update(sessions).set({ completedAt: new Date(200000) }).run();
    await expect(updateSessionMetadata('session', { times: { startedAt: new Date(1), completedAt: new Date(250000) },
      timesBaseline: { revision: 0, startedAt: new Date(1), completedAt: new Date(2) } })).resolves.toEqual({ startedAt: new Date(1), completedAt: new Date(250000) });
    expect(database.select().from(sessions).get()?.completedAt).toEqual(new Date(250000));
    expect(listMergeLocal(database, owner, 'pending')).toHaveLength(0);
  } finally { boot.mockRestore(); }
});

it('rebases a loaded set edit while retaining a set added by chat that the editor never saw', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    const { input } = await loadedEdit();
    input.exercises[0].sets[0].weightValue = '44';
    advanceWorkout();
    database.insert(exerciseSets).values({ id: 'chat-set', sessionExerciseId: 'block', orderIndex: 1,
      weightValue: '60', repsValue: '8', mergeRevision: 1 }).run();
    await createDrizzleSessionDraftStore().saveCompletedSessionGraph(input);
    expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'set')).get()).toMatchObject({ weightValue: '44', mergeRevision: 1 });
    expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'chat-set')).get()).toMatchObject({ weightValue: '60', deletedAt: null });
    expect(listMergeLocal(database, owner, 'pending')).toHaveLength(0);
  } finally { boot.mockRestore(); }
});

it('gives a freshly added exercise and its sets the session epoch actually loaded by the editor', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    advanceWorkout();
    const { input } = await loadedEdit();
    input.exercises.push({ id: 'fresh-block', exerciseDefinitionId: 'b', name: 'B', mergeRevision: 0,
      machineName: null, sourcePlanExerciseId: null, sets: [{ id: 'fresh-set', weightValue: '10', repsValue: '8',
        setType: null, plannedWeightValue: null, plannedRepsValue: null, plannedSetType: null,
        performanceStatus: null, sourcePlanSetId: null }] });
    await createDrizzleSessionDraftStore().saveCompletedSessionGraph(input);
    expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'fresh-block')).get()?.mergeRevision).toBe(1);
    expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'fresh-set')).get()?.mergeRevision).toBe(1);
    const batch = database.transaction(tx => selectPushBatch(tx, 200));
    expect(batch.find(row => row.id === 'fresh-block')?.fields.merge_revision).toBe(1);
    expect(batch.find(row => row.id === 'fresh-set')?.fields.merge_revision).toBe(1);
    expect(batch.some(row => row.type === 'sessions')).toBe(false);
  } finally { boot.mockRestore(); }
});

it('preserves only actual input when chat changes the same set, without inventing a removal for an unseen set', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    const { input } = await loadedEdit();
    input.exercises[0].sets[0].weightValue = '44';
    advanceWorkout();
    database.update(exerciseSets).set({ weightValue: '50' }).where(eq(exerciseSets.id, 'set')).run();
    database.insert(exerciseSets).values({ id: 'chat-set', sessionExerciseId: 'block', orderIndex: 1,
      weightValue: '60', repsValue: '8', mergeRevision: 1 }).run();
    await expect(createDrizzleSessionDraftStore().saveCompletedSessionGraph(input)).rejects.toThrow(/saved for review/);
    const pending = listMergeLocal(database, owner, 'pending').map(row => JSON.parse(row.payload));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: 'exercise_sets', id: 'set', fields: { weight_value: '44', merge_revision: 0, deleted_at: null } });
    expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'set')).get()?.weightValue).toBe('50');
  } finally { boot.mockRestore(); }
});

it('preserves an edited active buffer when chat finishes it and keeps the canonical completed lifecycle', async () => {
  const boot = jest.spyOn(dataBootstrap, 'bootstrapLocalDataLayer').mockResolvedValue(database);
  try {
    database.update(sessions).set({ status: 'active', completedAt: null, durationSec: null }).run();
    const baseline = captureSessionEditBaseline(database, 'session');
    const snapshot = (await loadSessionSnapshotById('session'))!;
    const exercises = toPersistDraftExercises(mapDraftSnapshotToSession(snapshot));
    exercises[0].sets[0].weightValue = '44';
    database.update(sessions).set({ status: 'completed', completedAt: new Date(500), durationSec: 1 }).run();
    advanceWorkout();
    await expect(createDrizzleSessionDraftStore().saveDraftGraph({ sessionId: 'session', gymId: null,
      startedAt: new Date(1), status: 'active', now: new Date(600), editBaseline: baseline, exercises,
    })).rejects.toThrow(/saved for review/);
    expect(database.select().from(sessions).get()).toMatchObject({ status: 'completed', completedAt: new Date(500) });
    const pending = listMergeLocal(database, owner, 'pending').map(row => JSON.parse(row.payload));
    expect(pending).toHaveLength(1); expect(pending[0].id).toBe('set');
  } finally { boot.mockRestore(); }
});

it('holds a dirty active session through ordinary pull, then preserves it before forcing a remote finish over a future clock', async () => {
  const completed = database.select().from(sessions).get()!;
  const incoming = wire({ ...completed, mergeRevision: 1, localUpdatedAtMs: 2000 }, 'sessions');
  database.update(sessions).set({ status: 'active', completedAt: null, durationSec: null,
    localDirty: true, localUpdatedAtMs: 1000 }).run();
  database.transaction(tx => applyPullPage(tx, [incoming], 'sessions'));
  expect(database.select().from(sessions).get()).toMatchObject({ status: 'active', localDirty: true });
  database.update(sessions).set({ localUpdatedAtMs: 9999 }).run();
  rpcPages([incoming, ...canonical()]);
  await sync();
  expect(database.select().from(sessions).get()).toMatchObject({ status: 'completed', mergeRevision: 1, localDirty: false });
  expect(mockRpc).toHaveBeenCalledWith('exercise_merge_save_conflict', expect.objectContaining({
    p_type: 'sessions', p_row: expect.objectContaining({ status: 'active', merge_revision: 0, client_updated_at_ms: 9999 }),
  }));
});

it('preserves a new offline exercise before its sets instead of installing them into a chat-finished workout', async () => {
  const completed = database.select().from(sessions).get()!;
  database.insert(sessionExercises).values({ id: 'offline-block', sessionId: 'session', exerciseDefinitionId: 'a',
    name: 'A', orderIndex: 1, localDirty: true, localUpdatedAtMs: 9999 }).run();
  database.insert(exerciseSets).values({ id: 'offline-set', sessionExerciseId: 'offline-block',
    orderIndex: 0, weightValue: '99', repsValue: '8', localDirty: true, localUpdatedAtMs: 9999 }).run();
  rpcPages([wire({ ...completed, mergeRevision: 1, localUpdatedAtMs: 2000 }, 'sessions'), ...canonical()]);
  await sync();
  const uploads = mockRpc.mock.calls.filter(([name]) => name === 'exercise_merge_save_conflict').map(([, args]) => args);
  expect(uploads.map(args => args.p_type)).toEqual(['session_exercises', 'exercise_sets']);
  expect(uploads[0].p_row).toMatchObject({ id: 'offline-block', session_id: 'session' });
  expect(uploads[1].p_row).toMatchObject({ id: 'offline-set', weight_value: '99' });
  expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'offline-block')).get()).toBeUndefined();
  expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'offline-set')).get()).toBeUndefined();
});

it('installs an empty remotely deleted workout and preserves stale local metadata', async () => {
  const current = database.select().from(sessions).get()!;
  database.delete(exerciseSets).run(); database.delete(sessionExercises).run();
  const incoming = wire({ ...current, deletedAt: new Date(500), mergeRevision: 1, localUpdatedAtMs: 2000 }, 'sessions');
  database.update(sessions).set({ startedAt: new Date(10), localDirty: true, localUpdatedAtMs: 9999 }).run();
  rpcPages([incoming]); await sync();
  expect(database.select().from(sessions).get()).toMatchObject({ deletedAt: new Date(500), mergeRevision: 1, localDirty: false });
  expect(mockRpc).toHaveBeenCalledWith('exercise_merge_save_conflict', expect.objectContaining({
    p_type: 'sessions', p_row: expect.objectContaining({ started_at: 10 }),
  }));
});

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


it('keeps ordinary history provenance beside a merged repeated use of the same targets', async () => {
  database.insert(sessionPlans).values({ id: 'plan', title: 'Plan', isRoutine: true }).run();
  database.insert(sessionPlanExercises).values({ id: 'plan-block', sessionPlanId: 'plan', exerciseDefinitionId: 'a', name: 'A', orderIndex: 0 }).run();
  database.insert(sessionPlanSets).values({ id: 'plan-target', sessionPlanExerciseId: 'plan-block', orderIndex: 0, targetReps: 5 }).run();
  database.insert(sessionPlanUses).values({ id: 'use', sessionPlanId: 'plan', slotIndex: 1, kind: 'workout' }).run();
  fixture.client.prepare("insert into sessions(id,status,started_at,completed_at) values('ordinary-session','completed',1,2)").run();
  fixture.client.prepare("update sessions set source_plan_id='plan',source_plan_use_id='use' where id='session'").run();
  database.insert(sessionExercises).values({ id: 'ordinary', sessionId: 'ordinary-session', exerciseDefinitionId: 'a', name: 'A',
    orderIndex: 1, sourcePlanExerciseId: 'plan-block', localDirty: false }).run();
  database.insert(exerciseSets).values({ id: 'ordinary-work', sessionExerciseId: 'ordinary', orderIndex: 0,
    sourcePlanSetId: 'plan-target', weightValue: '55', repsValue: '7', localDirty: false }).run();
  const rows = canonical().map(row => ({ ...row, fields: { ...row.fields, source_plan_use_id: 'use',
    ...(row.type === 'session_exercises' ? { source_plan_exercise_id: 'plan-block' } : { source_plan_set_id: 'plan-target' }),
  } }));
  rpcPages(rows);
  await sync();
  expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'ordinary')).get())
    .toMatchObject({ sourcePlanExerciseId: 'plan-block', sourcePlanUseId: null, localDirty: false });
  expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'ordinary-work')).get())
    .toMatchObject({ sourcePlanSetId: 'plan-target', sourcePlanUseId: null, weightValue: '55', localDirty: false });
  expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'block')).get())
    .toMatchObject({ sourcePlanExerciseId: 'plan-block', sourcePlanUseId: 'use' });
});


it('atomically repairs a missed slot winner while installing merge ancestors, preserving the losing work', async () => {
  database.insert(sessionPlans).values({ id: 'plan', title: 'Routine', isRoutine: true }).run();
  database.insert(sessionPlanExercises).values({ id: 'planned', sessionPlanId: 'plan', exerciseDefinitionId: 'a', name: 'A', orderIndex: 0 }).run();
  database.insert(sessionPlanSets).values({ id: 'target', sessionPlanExerciseId: 'planned', orderIndex: 0, targetReps: 5 }).run();
  database.insert(sessionPlanUses).values({ id: 'losing-use', sessionPlanId: 'plan', slotIndex: 1, kind: 'workout', localDirty: true }).run();
  fixture.client.prepare("update sessions set source_plan_id='plan',source_plan_use_id='losing-use' where id='session'").run();
  database.update(sessionExercises).set({ sourcePlanExerciseId: 'planned', sourcePlanUseId: 'losing-use', localDirty: true }).run();
  database.update(exerciseSets).set({ sourcePlanSetId: 'target', sourcePlanUseId: 'losing-use', localDirty: true }).run();
  const base = { createdAt: at, updatedAt: at, deletedAt: null, localUpdatedAtMs: 200, localDirty: false };
  const rows = [
    wire({ ...base, id: 'winning-use', sessionPlanId: 'plan', slotIndex: 1, kind: 'workout', skippedAt: null }, 'session_plan_uses'),
    wire({ ...base, id: 'remote-session', status: 'completed', gymId: null, startedAt: at, completedAt: at,
      durationSec: 1, sourcePlanId: 'plan', sourcePlanUseId: 'winning-use', mergeRevision: 0 }, 'sessions'),
    ...canonical().map(row => ({ ...row, id: 'remote-' + row.id, fields: { ...row.fields, source_plan_use_id: 'winning-use',
      ...(row.type === 'session_exercises'
        ? { session_id: 'remote-session', source_plan_exercise_id: 'planned' }
        : { session_exercise_id: 'remote-block', source_plan_set_id: 'target' }),
    } })),
  ];
  rpcPages(rows);
  const failAfterAncestors = { ...adapter, apply: (tx: Transaction, incoming: MergeWireEntity[], force = false) => {
    const changed = adapter.apply(tx, incoming, force);
    if (incoming.some(row => row.type === 'session_plan_uses')) throw new Error('Simulated install failure after repair');
    return changed;
  } };
  await expect(syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount: 0, adapter: failAfterAncestors }))
    .rejects.toThrow('Simulated install failure after repair');
  expect(database.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, 'losing-use')).get()!.deletedAt).toBeNull();
  expect(database.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, 'winning-use')).get()).toBeUndefined();
  expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'set')).get())
    .toMatchObject({ sourcePlanSetId: 'target', sourcePlanUseId: 'losing-use', weightValue: '40' });
  expect(readMergeLocal(database, owner, 'sequence')).toBeNull();
  expect(readMergeLocal(database, owner, 'stage')).not.toBeNull();
  await sync();
  expect(database.select().from(sessionPlanUses).where(eq(sessionPlanUses.id, 'losing-use')).get()!.deletedAt).not.toBeNull();
  expect(database.select().from(sessionExercises).where(eq(sessionExercises.id, 'block')).get())
    .toMatchObject({ sourcePlanExerciseId: null, sourcePlanUseId: null, localDirty: true });
  expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'set')).get())
    .toMatchObject({ sourcePlanSetId: null, sourcePlanUseId: null, weightValue: '40', repsValue: '5', localDirty: true });
  expect(database.select().from(exerciseSets).where(eq(exerciseSets.id, 'remote-set')).get())
    .toMatchObject({ sourcePlanSetId: 'target', sourcePlanUseId: 'winning-use', weightValue: '20' });
  expect(readMergeLocal(database, owner, 'sequence')).toBe(1);
  expect(readMergeLocal(database, owner, 'stage')).toBeNull();
  await sync();
  expect(database.select().from(sessionPlanUses).all()).toHaveLength(2);
});

describe('entity types this build does not know', () => {
  // The production adapter: it rejects any row type outside the topology.
  const realAdapter = { ...adapter, apply: applyMergeRows };
  const unknownRow = (id: string): MergeWireEntity => ({
    type: 'training_notes', id, client_updated_at_ms: 200, fields: { exercise_definition_id: 'b', body: 'Brace', deleted_at: null },
  });
  const servePages = (pages: MergeWireEntity[][]) => {
    const offsets = pages.map((_page, index) => pages.slice(0, index).reduce((total, page) => total + page.length, 0));
    mockRpc.mockImplementation(async (name: string, args: { p_offset?: number } = {}) => {
      if (name === 'exercise_merge_snapshot') {
        const offset = args.p_offset ?? 0;
        const index = offsets.indexOf(offset);
        const rows = index < 0 ? [] : pages[index];
        return { data: { sequence: 1, token: 'token', rows, nextOffset: offset + rows.length, hasMore: index >= 0 && index < pages.length - 1 }, error: null };
      }
      if (name === 'exercise_merge_review') return { data: { items: [], hasMore: false }, error: null };
      throw new Error('Unexpected RPC ' + name);
    });
  };
  const syncReal = (conflictCount = 0) => syncExerciseMerges({ database, owner, remoteSequence: 1, conflictCount, adapter: realAdapter });

  it('skips unknown rows in a snapshot page; paging and install complete and known rows apply', async () => {
    const [block, set] = canonical();
    servePages([[unknownRow('note-1'), block], [set, unknownRow('note-2')]]);
    await syncReal();
    expect(database.select().from(sessionExercises).get()).toMatchObject({ exerciseDefinitionId: 'b', mergeRevision: 1 });
    expect(database.select().from(exerciseSets).get()).toMatchObject({ weightValue: '20', mergeRevision: 1 });
    expect(readMergeLocal(database, owner, 'sequence')).toBe(1);
    expect(readMergeLocal(database, owner, 'stage')).toBeNull();
  });

  it('a page made only of unknown rows still advances the snapshot', async () => {
    servePages([[unknownRow('note-1'), unknownRow('note-2')], canonical()]);
    await syncReal();
    expect(mockRpc.mock.calls.filter(([name]) => name === 'exercise_merge_snapshot').map(([, args]) => args.p_offset)).toEqual([0, 2]);
    expect(database.select().from(exerciseSets).get()?.weightValue).toBe('20');
    expect(readMergeLocal(database, owner, 'sequence')).toBe(1);
  });

  it('still rejects a malformed row, whatever its type', async () => {
    const malformed = { ...unknownRow('note-1'), id: undefined } as unknown as MergeWireEntity;
    servePages([[malformed, ...canonical()]]);
    await expect(syncReal()).rejects.toThrow('Invalid exercise history row.');
    expect(readMergeLocal(database, owner, 'sequence')).toBeNull();
  });

  it('keeps only review items of types this build can show, paging past the rest', async () => {
    servePages([[]]);
    const item = (id: string, type: string) => ({ id, type, token: 't-' + id, entityId: id, blockId: 'block', sessionId: 'session',
      exerciseName: 'A', current: null, saved: null, invalid: false });
    const offsets: number[] = [];
    const pages = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(async (name: string, args: { p_offset?: number } = {}) => {
      if (name !== 'exercise_merge_review') return pages(name, args);
      offsets.push(args.p_offset ?? 0);
      return (args.p_offset ?? 0) === 0
        ? { data: { items: [item('n', 'training_notes'), item('s', 'exercise_sets')], hasMore: true }, error: null }
        : { data: { items: [item('t', 'session_exercise_tags')], hasMore: false }, error: null };
    });
    await syncReal(2);
    expect(offsets).toEqual([0, 2]);
    expect((readMergeLocal<{ id: string }[]>(database, owner, 'conflicts') ?? []).map(entry => entry.id)).toEqual(['s', 't']);

    mockRpc.mockImplementation(async (name: string, args: { p_offset?: number } = {}) => name === 'exercise_merge_review'
      ? { data: { items: [{ ...item('x', 'sessions'), type: 7 }], hasMore: false }, error: null } : pages(name, args));
    await expect(syncReal(1)).rejects.toThrow('Invalid saved changes response.');
  });
});
