/**
 * Sync quarantine coverage.
 *
 * Three layers:
 *
 *  - Unit (`quarantineRows` / `readQuarantine` / `countQuarantinedRows`): the
 *    persistence semantics — idempotent upsert that preserves `first_seen`,
 *    advances `last_seen` and `occurrence_count`, and never creates duplicate
 *    rows — and the read shapes the push leg and status surface consume.
 *  - Selection (`selectPushBatch`): a quarantined row is skipped by future push
 *    batch selection.
 *  - Integration (`runSyncCycle`): one orphan beside one valid independent dirty
 *    row proves the valid row still pushes and clears dirty while the orphan is
 *    quarantined (persisted, skipped, logged), the cycle converges rather than
 *    wedging, the quarantine survives a database reopen, and a logger failure
 *    never blocks persistence or the continued push.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { LogEventParams } from '@/src/logging/logEvent';
import { __resetClockForTests, PRIMARY_RUNTIME_STATE_ID, type Transaction } from '@/src/data/clock';
import * as schema from '@/src/data/schema';
import { gyms, sessionExercises, syncQuarantine, syncRuntimeState } from '@/src/data/schema';
import { __resetAuthRequiredSignalForTests } from '@/src/sync/auth-required-signal';
import { __resetCycleErrorSignalForTests, getCycleErrorCode } from '@/src/sync/cycle-error-signal';
import { runSyncCycle, selectPushBatch, BATCH_CAP } from '@/src/sync/cycle';
import {
  countQuarantinedRows,
  quarantineRows,
  readQuarantine,
  type QuarantineRecordInput,
} from '@/src/sync/quarantine';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
  type InMemoryTestDatabase,
} from './helpers/in-memory-db';

// ---------------------------------------------------------------------------
// Shared fixture + mocks (mirrors the push-preflight integration suite)
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

// Plants rows with local FK enforcement OFF — the realistic provenance of an
// orphan (a row predating FK enforcement or surviving corruption).
const plantOrphan = (build: () => void): void => {
  fixture.client.pragma('foreign_keys = OFF');
  try {
    build();
  } finally {
    fixture.client.pragma('foreign_keys = ON');
  }
};

const insertGym = (id: string, ms: number, dirty = true): void => {
  database.insert(gyms).values({ id, name: `Gym ${id}`, localDirty: dirty, localUpdatedAtMs: ms }).run();
};

const insertSessionExercise = (id: string, sessionId: string, ms: number, dirty = true): void => {
  database
    .insert(sessionExercises)
    .values({ id, sessionId, orderIndex: 0, name: `Ex ${id}`, localDirty: dirty, localUpdatedAtMs: ms })
    .run();
};

const orphanRecord = (overrides: Partial<QuarantineRecordInput> = {}): QuarantineRecordInput => ({
  entityType: 'session_exercises',
  entityId: 'se-orphan',
  errorCode: 'LOCAL_FK_VIOLATION',
  parentType: 'sessions',
  parentIdField: 'session_id',
  parentId: 'sess-missing',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Unit: quarantineRows persistence semantics
// ---------------------------------------------------------------------------

describe('quarantineRows', () => {
  it('inserts a fresh row with count 1 and equal first/last seen timestamps', () => {
    const results = database.transaction((tx) =>
      quarantineRows(tx as Transaction, [orphanRecord()], 1_000),
    );

    expect(results).toEqual([{ input: orphanRecord(), created: true }]);

    const row = database.select().from(syncQuarantine).get();
    expect(row).toMatchObject({
      entityType: 'session_exercises',
      entityId: 'se-orphan',
      errorCode: 'LOCAL_FK_VIOLATION',
      parentType: 'sessions',
      parentIdField: 'session_id',
      parentId: 'sess-missing',
      firstSeenAtMs: 1_000,
      lastSeenAtMs: 1_000,
      occurrenceCount: 1,
    });
  });

  it('updates last_seen/count and preserves first_seen on repeat instead of duplicating', () => {
    database.transaction((tx) => quarantineRows(tx as Transaction, [orphanRecord()], 1_000));
    const second = database.transaction((tx) =>
      quarantineRows(tx as Transaction, [orphanRecord()], 5_000),
    );

    expect(second).toEqual([{ input: orphanRecord(), created: false }]);

    const rows = database.select().from(syncQuarantine).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstSeenAtMs: 1_000,
      lastSeenAtMs: 5_000,
      occurrenceCount: 2,
    });
  });
});

describe('readQuarantine + countQuarantinedRows', () => {
  it('returns keys, ids-by-type, and a count over the quarantined rows', () => {
    database.transaction((tx) =>
      quarantineRows(
        tx as Transaction,
        [
          orphanRecord(),
          orphanRecord({ entityType: 'exercise_sets', entityId: 'set-orphan', parentType: 'session_exercises' }),
        ],
        1_000,
      ),
    );

    const snapshot = database.transaction((tx) => readQuarantine(tx as Transaction));
    expect(snapshot.keys).toEqual(new Set(['session_exercises se-orphan', 'exercise_sets set-orphan']));
    expect(snapshot.idsByType.get('session_exercises')).toEqual(['se-orphan']);
    expect(snapshot.idsByType.get('exercise_sets')).toEqual(['set-orphan']);

    const total = database.transaction((tx) => countQuarantinedRows(tx as Transaction));
    expect(total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Selection: quarantined rows are skipped
// ---------------------------------------------------------------------------

describe('selectPushBatch quarantine exclusion', () => {
  it('skips a quarantined dirty row but still selects a valid dirty row', () => {
    insertGym('gym-1', 5);
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));
    database.transaction((tx) => quarantineRows(tx as Transaction, [orphanRecord()], 1_000));

    const batch = database.transaction((tx) => selectPushBatch(tx as Transaction, BATCH_CAP));
    const ids = batch.map((entity) => `${entity.type} ${entity.id}`);

    expect(ids).toEqual(['gyms gym-1']);
  });
});

// ---------------------------------------------------------------------------
// Integration: runSyncCycle quarantines the orphan and continues the valid row
// ---------------------------------------------------------------------------

describe('runSyncCycle quarantine', () => {
  const pushedEntities = (): { type: string; id: string }[] =>
    mockRpc.mock.calls
      .filter(([name]) => name === 'sync_push')
      .flatMap(([, body]) => (body as { entities: { type: string; id: string }[] }).entities)
      .map((entity) => ({ type: entity.type, id: entity.id }));

  beforeEach(() => {
    markBootstrapDone();
    mockRpc.mockImplementation(async (name: string) =>
      name === 'sync_pull' ? { data: emptyPage, error: null } : pushOk,
    );
  });

  it('pushes the valid independent row, quarantines the orphan, and converges', async () => {
    insertGym('gym-valid', 5);
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));

    await expect(runSyncCycle()).resolves.toMatchObject({ outcome: 'converged' });

    // The valid row reached the server; the orphan never did.
    const pushed = pushedEntities();
    expect(pushed).toContainEqual({ type: 'gyms', id: 'gym-valid' });
    expect(pushed.some((entity) => entity.id === 'se-orphan')).toBe(false);

    // The valid row cleared its dirty bit; the orphan stays dirty for later repair.
    expect(database.select().from(gyms).where(eq(gyms.id, 'gym-valid')).get()?.localDirty).toBe(false);
    expect(
      database.select().from(sessionExercises).where(eq(sessionExercises.id, 'se-orphan')).get()?.localDirty,
    ).toBe(true);

    // The orphan is persisted in quarantine with its diagnostic context.
    const quarantined = database.select().from(syncQuarantine).all();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({
      entityType: 'session_exercises',
      entityId: 'se-orphan',
      errorCode: 'LOCAL_FK_VIOLATION',
      parentType: 'sessions',
      parentIdField: 'session_id',
      parentId: 'sess-missing',
      occurrenceCount: 1,
    });

    // No structural error is surfaced to the gate — quarantine is not a wedge.
    expect(getCycleErrorCode()).toBeNull();
  });

  it('logs that the push continued after quarantining the orphan', async () => {
    insertGym('gym-valid', 5);
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));

    await runSyncCycle();

    const continued = mockLogEvent.mock.calls
      .map(([params]) => params)
      .filter((p) => p.event === 'sync.push_continued_after_quarantine');
    expect(continued.length).toBeGreaterThanOrEqual(1);
    expect(continued[0].context).toMatchObject({
      operation: 'push_batch_continue',
      quarantined_row_count: 1,
    });
    expect(continued[0].context?.pushed_row_count).toBeGreaterThanOrEqual(1);
  });

  it('keeps the quarantine record after a database reopen', async () => {
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));

    await runSyncCycle();

    // Reopen: a fresh drizzle handle over the same physical SQLite connection,
    // standing in for a process restart against the persisted database.
    const reopened = drizzle(fixture.client, { schema });
    const persisted = reopened.select().from(syncQuarantine).all();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].entityId).toBe('se-orphan');
  });

  it('quarantines persistently even when the diagnostic log fails', async () => {
    insertGym('gym-valid', 5);
    plantOrphan(() => insertSessionExercise('se-orphan', 'sess-missing', 100));
    mockLogEvent.mockRejectedValue(new Error('log insert failed'));

    await expect(runSyncCycle()).resolves.toMatchObject({ outcome: 'converged' });

    // Persistence and the valid push both proceeded despite the logger failure.
    expect(database.select().from(syncQuarantine).all()).toHaveLength(1);
    expect(database.select().from(gyms).where(eq(gyms.id, 'gym-valid')).get()?.localDirty).toBe(false);
  });

  it('cascades quarantine to a child whose only parent is itself a quarantined orphan', async () => {
    // se-orphan is an orphan (its session is missing); set-1 is a valid child of
    // se-orphan. Quarantining se-orphan means it will not reach the server, so
    // set-1 would be rejected too — it must be quarantined in the same drain.
    plantOrphan(() => {
      insertSessionExercise('se-orphan', 'sess-missing', 100);
      database
        .insert(schema.exerciseSets)
        .values({ id: 'set-1', sessionExerciseId: 'se-orphan', orderIndex: 0, localDirty: true, localUpdatedAtMs: 110 })
        .run();
    });

    await expect(runSyncCycle()).resolves.toMatchObject({ outcome: 'converged' });

    const quarantinedIds = database
      .select({ id: syncQuarantine.entityId })
      .from(syncQuarantine)
      .all()
      .map((row) => row.id);
    expect(quarantinedIds).toEqual(expect.arrayContaining(['se-orphan', 'set-1']));
    expect(quarantinedIds).toHaveLength(2);
  });
});
