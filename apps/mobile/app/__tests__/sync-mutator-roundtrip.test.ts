/**
 * Repository-mutator → sync push, end-to-end (single-device base case).
 *
 * The existing push tests hand-build dirty rows (direct `localDirty: true`
 * inserts) or call `selectPushBatch` in isolation. Nothing drives a REAL
 * repository mutator all the way through the REAL `runSyncCycle` and asserts the
 * mutated values reach the wire. That leaves a silent-failure gap: a mutator
 * that forgets to set the dirty bit (or stamps the wrong column) writes a row
 * that simply never syncs — and every existing sync test still passes, because
 * they never exercise the mutator → dirty → push chain together.
 *
 * These tests close that chain: call the real mutator, assert the row went
 * dirty, run the real cycle against a stubbed server that CAPTURES the push
 * payload, then assert the captured wire envelopes carry the mutated fields and
 * the rows ended clean. A mutator that failed to dirty a row would push nothing
 * for it and fail here.
 */

import { and, eq } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import {
  exerciseDefinitions,
  exerciseSets,
  gyms,
  sessionExercises,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, type WireEntity } from '@/src/sync/cycle';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';
// The real mutators resolve their db handle through the mocked bootstrap (babel
// hoists the jest.mock calls below above every import, and each mock factory
// defers its variable references to call time).
import { upsertLocalGym } from '@/src/data/local-gyms';
import { createDrizzleSessionDraftStore } from '@/src/data/session-drafts';
import { setExerciseCatalogExerciseDeletedState } from '@/src/data/exercise-catalog';

const mockBootstrapState: { database: InMemoryTestDatabase | null } = { database: null };
const mockLogEvent = jest.fn<Promise<void>, [LogEventParams]>(() => Promise.resolve());

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => {
    if (!mockBootstrapState.database) {
      throw new Error('Test database not initialised');
    }
    return mockBootstrapState.database;
  }),
}));

const mockRpc = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    rpc: mockRpc,
    schema: () => ({ rpc: mockRpc }),
  })),
}));

jest.mock('@/src/logging/logEvent', () => ({
  logEvent: (params: LogEventParams) => mockLogEvent(params),
}));

let fixture: InMemoryDatabaseFixture;
let database: InMemoryTestDatabase;

/** Every entity envelope the stubbed server received across all push batches. */
let pushedEntities: WireEntity[];

const pushOk = {
  data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' },
  error: null,
};
const emptyPage = { entities: [], next_cursor: null, has_more: false };

/** Pulls are always empty; pushes ack and have their entities captured. */
const stubServerCapturingPushes = (): void => {
  mockRpc.mockImplementation(async (name: string, args: { entities?: WireEntity[] }) => {
    if (name === 'sync_pull') {
      return { data: emptyPage, error: null };
    }
    if (args.entities) {
      pushedEntities.push(...args.entities);
    }
    return pushOk;
  });
};

const markBootstrapDone = (): void => {
  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt: new Date(1_700_000_000_000) })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt: new Date(1_700_000_000_000) },
    })
    .run();
};

const pushedOfType = (type: WireEntity['type']): WireEntity[] =>
  pushedEntities.filter((entity) => entity.type === type);

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  // FK enforcement on: the session graph mutator writes children under parents.
  fixture = createInMemoryDatabase({ foreignKeys: true });
  database = fixture.database;
  mockBootstrapState.database = database;
  markBootstrapDone();
  pushedEntities = [];
  mockRpc.mockReset();
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
  stubServerCapturingPushes();
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

describe('mutator write → cycle → push payload', () => {
  it('pushes a gym created through upsertLocalGym, carrying its name, then clears it', async () => {
    await upsertLocalGym({ id: 'gym-1', name: 'Iron Temple' });

    // The mutator marked the row dirty in the same transaction as the write.
    const dirtyBefore = database
      .select({ localDirty: gyms.localDirty })
      .from(gyms)
      .where(eq(gyms.id, 'gym-1'))
      .get();
    expect(dirtyBefore?.localDirty).toBe(true);

    await expect(runSyncCycle()).resolves.toBe('converged');

    const pushedGyms = pushedOfType('gyms');
    expect(pushedGyms.map((entity) => entity.id)).toEqual(['gym-1']);
    expect(pushedGyms[0].fields.name).toBe('Iron Temple');

    const cleared = database
      .select({ localDirty: gyms.localDirty })
      .from(gyms)
      .where(eq(gyms.id, 'gym-1'))
      .get();
    expect(cleared?.localDirty).toBe(false);
  });

  it('pushes a whole session graph (session + exercise + set) with the logged set values', async () => {
    // FK parent for the session_exercise's exercise_definition_id; clean, so the
    // push preflight treats it as already on the server.
    database
      .insert(exerciseDefinitions)
      .values({ id: 'def-bench', name: 'Bench Press', localDirty: false, localUpdatedAtMs: 50 })
      .run();

    await createDrizzleSessionDraftStore().saveDraftGraph({
      sessionId: 'sess-1',
      gymId: null,
      status: 'active',
      startedAt: new Date('2026-05-30T10:00:00.000Z'),
      exercises: [
        {
          id: 'sx-1',
          exerciseDefinitionId: 'def-bench',
          name: 'Bench Press',
          sets: [{ id: 'set-1', repsValue: '5', weightValue: '225' }],
        },
      ],
      now: new Date('2026-05-30T10:01:00.000Z'),
    });

    // All three layers went dirty in the one mutator transaction.
    expect(
      database.select({ d: sessions.localDirty }).from(sessions).where(eq(sessions.id, 'sess-1')).get()?.d,
    ).toBe(true);
    expect(
      database.select({ d: sessionExercises.localDirty }).from(sessionExercises).where(eq(sessionExercises.id, 'sx-1')).get()?.d,
    ).toBe(true);
    expect(
      database.select({ d: exerciseSets.localDirty }).from(exerciseSets).where(eq(exerciseSets.id, 'set-1')).get()?.d,
    ).toBe(true);

    await expect(runSyncCycle()).resolves.toBe('converged');

    // The push carried every layer, in the same wire shapes the server expects,
    // with the actual logged values — not just the parent session row.
    expect(pushedOfType('sessions').map((entity) => entity.id)).toEqual(['sess-1']);

    const pushedExercises = pushedOfType('session_exercises');
    expect(pushedExercises.map((entity) => entity.id)).toEqual(['sx-1']);
    expect(pushedExercises[0].fields.name).toBe('Bench Press');

    const pushedSets = pushedOfType('exercise_sets');
    expect(pushedSets.map((entity) => entity.id)).toEqual(['set-1']);
    expect(pushedSets[0].fields.weight_value).toBe('225');
    expect(pushedSets[0].fields.reps_value).toBe('5');

    // The whole graph ended clean.
    expect(
      database.select({ d: exerciseSets.localDirty }).from(exerciseSets).where(eq(exerciseSets.id, 'set-1')).get()?.d,
    ).toBe(false);
  });

  it('pushes a soft-delete made through the catalog mutator, carrying deleted_at', async () => {
    // A clean, already-synced exercise definition.
    database
      .insert(exerciseDefinitions)
      .values({ id: 'def-curl', name: 'Curl', localDirty: false, localUpdatedAtMs: 50 })
      .run();

    await setExerciseCatalogExerciseDeletedState({ id: 'def-curl', isDeleted: true });

    const tombstoned = database
      .select({ localDirty: exerciseDefinitions.localDirty, deletedAt: exerciseDefinitions.deletedAt })
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, 'def-curl'))
      .get();
    expect(tombstoned?.localDirty).toBe(true);
    expect(tombstoned?.deletedAt).not.toBeNull();

    await expect(runSyncCycle()).resolves.toBe('converged');

    const pushed = pushedOfType('exercise_definitions').filter((entity) => entity.id === 'def-curl');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].fields.deleted_at).not.toBeNull();

    const cleared = database
      .select({ localDirty: exerciseDefinitions.localDirty })
      .from(exerciseDefinitions)
      .where(and(eq(exerciseDefinitions.id, 'def-curl')))
      .get();
    expect(cleared?.localDirty).toBe(false);
  });
});
