/**
 * Push-side FK closure preflight coverage.
 *
 * Two layers:
 *
 *  - Unit: `findPushBatchFkViolations` over a real in-memory database with
 *    planted orphan / valid dirty graphs. Orphans are planted with local FK
 *    enforcement OFF (the realistic provenance of an orphan: a row that predates
 *    FK enforcement or survived corruption), then the preflight — a pure local
 *    read — is asserted to flag exactly the orphan rows and leave valid graphs
 *    alone.
 *  - Integration: `runSyncCycle` with a stubbed server, proving a predictable
 *    orphan batch is never sent to `sync_push`, surfaces a `LOCAL_FK_VIOLATION`
 *    (distinct from the server's `FK_VIOLATION`), leaves dirty bits set, and logs
 *    a structured diagnostic — while a valid parent+child graph still pushes.
 */

import { eq } from 'drizzle-orm';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import {
  exerciseDefinitions,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  sessionExercises,
  sessionExerciseTags,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests, getCycleErrorCode } from '@/src/sync/cycle-error-signal';
import { BATCH_CAP, runSyncCycle, selectPushBatch } from '@/src/sync/cycle';
import { findPushBatchFkViolations } from '@/src/sync/fk-graph';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

// ---------------------------------------------------------------------------
// Shared fixture + mocks (the integration suite mirrors the convergence test)
// ---------------------------------------------------------------------------

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

beforeEach(() => {
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  fixture = createInMemoryDatabase();
  database = fixture.database;
  mockBootstrapState.database = database;
  mockRpc.mockReset();
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  fixture.close();
  mockBootstrapState.database = null;
  __resetClockForTests();
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

const emptyPage = { entities: [], next_cursor: null, has_more: false };
const pushOk = { data: { ok: true, server_received_at: '2026-05-29T10:00:00.000Z' }, error: null };

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

// Plants rows with local FK enforcement OFF, the realistic provenance of an
// orphan (a row predating FK enforcement or surviving corruption) that the
// preflight exists to catch. The pragma is restored afterwards.
const plantOrphan = (build: () => void): void => {
  fixture.client.pragma('foreign_keys = OFF');
  try {
    build();
  } finally {
    fixture.client.pragma('foreign_keys = ON');
  }
};

// Row planters. Children may be planted as orphans via `plantOrphan`.
const insertGym = (id: string, ms: number, dirty = true): void => {
  database.insert(gyms).values({ id, name: `Gym ${id}`, localDirty: dirty, localUpdatedAtMs: ms }).run();
};

const insertSession = (id: string, ms: number, dirty = true, gymId: string | null = null): void => {
  database
    .insert(sessions)
    .values({
      id,
      gymId,
      startedAt: new Date('2026-05-29T08:00:00.000Z'),
      localDirty: dirty,
      localUpdatedAtMs: ms,
    })
    .run();
};

const insertSessionExercise = (id: string, sessionId: string, ms: number, dirty = true): void => {
  database
    .insert(sessionExercises)
    .values({ id, sessionId, orderIndex: 0, name: `Ex ${id}`, localDirty: dirty, localUpdatedAtMs: ms })
    .run();
};

const insertExerciseSet = (id: string, sessionExerciseId: string, ms: number, dirty = true): void => {
  database
    .insert(exerciseSets)
    .values({ id, sessionExerciseId, orderIndex: 0, localDirty: dirty, localUpdatedAtMs: ms })
    .run();
};

const insertExerciseDefinition = (id: string, ms: number, dirty = true): void => {
  database
    .insert(exerciseDefinitions)
    .values({ id, name: `Def ${id}`, localDirty: dirty, localUpdatedAtMs: ms })
    .run();
};

const insertTagDefinition = (id: string, exerciseDefinitionId: string, ms: number, dirty = true): void => {
  database
    .insert(exerciseTagDefinitions)
    .values({
      id,
      exerciseDefinitionId,
      name: `Tag ${id}`,
      normalizedName: `tag ${id}`,
      localDirty: dirty,
      localUpdatedAtMs: ms,
    })
    .run();
};

const insertSessionExerciseTag = (
  id: string,
  sessionExerciseId: string,
  tagDefinitionId: string,
  ms: number,
  dirty = true,
): void => {
  database
    .insert(sessionExerciseTags)
    .values({
      id,
      sessionExerciseId,
      exerciseTagDefinitionId: tagDefinitionId,
      localDirty: dirty,
      localUpdatedAtMs: ms,
    })
    .run();
};

const preflight = () =>
  database.transaction((tx) => {
    const batch = selectPushBatch(tx as Transaction, BATCH_CAP);
    return findPushBatchFkViolations(tx as Transaction, batch);
  });

// ---------------------------------------------------------------------------
// Unit: findPushBatchFkViolations
// ---------------------------------------------------------------------------

describe('findPushBatchFkViolations', () => {
  it('flags a dirty session_exercise whose sessions parent is missing locally', () => {
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));

    const violations = preflight();

    expect(violations).toEqual([
      {
        childType: 'session_exercises',
        childId: 'se-orphan',
        parentType: 'sessions',
        parentIdField: 'session_id',
        parentId: 'sess-missing',
      },
    ]);
  });

  it('flags a layer-3 orphan exercise_set whose session_exercise parent is missing', () => {
    plantOrphan(() => insertExerciseSet('set-orphan', 'se-missing', 100));

    const violations = preflight();

    expect(violations).toEqual([
      {
        childType: 'exercise_sets',
        childId: 'set-orphan',
        parentType: 'session_exercises',
        parentIdField: 'session_exercise_id',
        parentId: 'se-missing',
      },
    ]);
  });

  it('flags a layer-3 orphan session_exercise_tag for each missing parent', () => {
    plantOrphan(() => insertSessionExerciseTag('tag-orphan', 'se-missing', 'tagdef-missing', 100));

    const violations = preflight();

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          childType: 'session_exercise_tags',
          childId: 'tag-orphan',
          parentType: 'session_exercises',
          parentIdField: 'session_exercise_id',
        }),
        expect.objectContaining({
          childType: 'session_exercise_tags',
          childId: 'tag-orphan',
          parentType: 'exercise_tag_definitions',
          parentIdField: 'exercise_tag_definition_id',
        }),
      ]),
    );
    expect(violations).toHaveLength(2);
  });

  it('passes a valid dirty parent+child graph that pushes in the same batch', () => {
    insertSession('sess-1', 10);
    insertSessionExercise('se-1', 'sess-1', 20);
    insertExerciseSet('set-1', 'se-1', 30);

    expect(preflight()).toEqual([]);
  });

  it('passes a dirty child whose parent is clean and present locally (already on server)', () => {
    // Parent is clean: it is not selected into the batch, but it is physically
    // present, which the preflight treats as proof it is on the server.
    insertSession('sess-clean', 10, false);
    insertSessionExercise('se-1', 'sess-clean', 20);

    expect(preflight()).toEqual([]);
  });

  it('does not block a valid independent dirty row sitting beside a valid graph', () => {
    insertGym('gym-indep', 5);
    insertSession('sess-1', 10);
    insertSessionExercise('se-1', 'sess-1', 20);

    expect(preflight()).toEqual([]);
  });

  it('treats a null nullable FK (sessions.gym_id) as FK-safe', () => {
    insertSession('sess-1', 10, true, null);

    expect(preflight()).toEqual([]);
  });

  it('flags a child whose parent is present locally but already quarantined', () => {
    // The parent session is present and clean locally, but it is in the
    // quarantined set — so it will not be pushed this cycle. A child relying on
    // it would be rejected by the server, so the preflight must flag it. This is
    // what cascades a quarantine down a chain of orphans.
    insertSession('sess-q', 10, false);
    insertSessionExercise('se-1', 'sess-q', 20);

    const violations = database.transaction((tx) => {
      const batch = selectPushBatch(tx as Transaction, BATCH_CAP);
      return findPushBatchFkViolations(tx as Transaction, batch, new Set(['sessions sess-q']));
    });

    expect(violations).toEqual([
      {
        childType: 'session_exercises',
        childId: 'se-1',
        parentType: 'sessions',
        parentIdField: 'session_id',
        parentId: 'sess-q',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integration: runSyncCycle preflight -> quarantine behaviour
// ---------------------------------------------------------------------------

describe('runSyncCycle push preflight', () => {
  const pushCalls = (): unknown[][] =>
    mockRpc.mock.calls.filter(([name]) => name === 'sync_push');

  it('quarantines an orphan instead of sending it, and the cycle converges', async () => {
    markBootstrapDone();
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));

    mockRpc.mockImplementation(async (name: string) =>
      name === 'sync_pull' ? { data: emptyPage, error: null } : pushOk,
    );

    // No throw: the orphan is quarantined out of the way and the cycle settles.
    await expect(runSyncCycle()).resolves.toBe('converged');

    // The orphan batch never reached the server.
    expect(pushCalls()).toHaveLength(0);
    // No structural error is surfaced to the gate — quarantine is not a wedge.
    expect(getCycleErrorCode()).toBeNull();
    // Dirty bit is left set so a later repair + cycle can push it.
    const row = database.select().from(sessionExercises).where(eq(sessionExercises.id, 'se-orphan')).get();
    expect(row?.localDirty).toBe(true);
  });

  it('logs a structured row_quarantined event with safe context only', async () => {
    markBootstrapDone();
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));
    mockRpc.mockImplementation(async (name: string) =>
      name === 'sync_pull' ? { data: emptyPage, error: null } : pushOk,
    );

    await runSyncCycle();

    const quarantineLogs = mockLogEvent.mock.calls
      .map(([params]) => params)
      .filter((p) => p.event === 'sync.row_quarantined');
    expect(quarantineLogs.length).toBeGreaterThanOrEqual(1);
    const [log] = quarantineLogs;
    expect(log.level).toBe('warn');
    expect(log.source).toBe('sync');
    expect(log.context).toMatchObject({
      operation: 'push_batch_preflight',
      error_code: 'LOCAL_FK_VIOLATION',
      quarantined_count: 1,
      rows: [
        {
          entity_type: 'session_exercises',
          entity_id: 'se-orphan',
          parent_type: 'sessions',
          parent_id_field: 'session_id',
          parent_id: 'sess-missing',
        },
      ],
    });
    // No row payload / user-entered values leak into the diagnostic.
    expect(JSON.stringify(log.context)).not.toContain('Ex se-orphan');
  });

  it('does not let a quarantine logging failure wedge the cycle', async () => {
    markBootstrapDone();
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));
    mockLogEvent.mockRejectedValueOnce(new Error('log insert failed'));
    mockRpc.mockImplementation(async (name: string) =>
      name === 'sync_pull' ? { data: emptyPage, error: null } : pushOk,
    );

    // The log rejects, but quarantine persistence and convergence proceed.
    await expect(runSyncCycle()).resolves.toBe('converged');
  });

  it('pushes a valid parent+child graph in topological order', async () => {
    markBootstrapDone();
    insertSession('sess-1', 10);
    insertSessionExercise('se-1', 'sess-1', 20);

    mockRpc.mockImplementation(async (name: string) =>
      name === 'sync_pull' ? { data: emptyPage, error: null } : pushOk,
    );

    await expect(runSyncCycle()).resolves.toBe('converged');

    const calls = pushCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const firstBatch = (calls[0][1] as { entities: { type: string; id: string }[] }).entities;
    const order = firstBatch.map((e) => e.type);
    // Parent (sessions, Layer 1) precedes child (session_exercises, Layer 2).
    expect(order.indexOf('sessions')).toBeLessThan(order.indexOf('session_exercises'));

    // Both rows cleared their dirty bit on ack.
    expect(database.select().from(sessions).where(eq(sessions.id, 'sess-1')).get()?.localDirty).toBe(false);
    expect(
      database.select().from(sessionExercises).where(eq(sessionExercises.id, 'se-1')).get()?.localDirty,
    ).toBe(false);
  });
});
