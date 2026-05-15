/* eslint-disable import/first */

// T9 Test 1 — user-write-during-bootstrap survives the merge wipe.
//
// What this locks: `applyMergePlanTx` reads `localState` via
// `readLocalProjectionState(tx)` *inside* the same transaction that wipes-and-
// reinserts. Any local row that exists at tx-start time is included in
// `buildMergePlan` → `localSelections` → reinserted with merged state, AND
// queued as a convergence event so the server learns about it. If a future
// refactor moved the read outside the tx, or split read and write across
// separate transactions, this protection silently disappears.

const mockBootstrapLocalDataLayer = jest.fn();
const mockSeedSystemExerciseCatalog = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

// The merge re-seeds the catalog after commit (T4). This test focuses on the
// user-write survival invariant rather than seed contents, so we stub the
// seeder out to keep the in-memory fake DB easier to reason about.
jest.mock('@/src/data/exercise-catalog-seeds', () => ({
  seedSystemExerciseCatalog: (...args: unknown[]) => mockSeedSystemExerciseCatalog(...args),
}));

import { upsertLocalGym } from '@/src/data/local-gyms';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessionExercises,
  sessionExerciseTags,
  sessions,
  syncDeliveryState,
  syncOutboxEvents,
  syncRuntimeState,
} from '@/src/data/schema';
import { mergeRemoteProjectionIntoLocalState } from '@/src/sync';

type FakeRow = Record<string, unknown>;

type FakeState = {
  gyms: FakeRow[];
  sessions: FakeRow[];
  sessionExercises: FakeRow[];
  exerciseSets: FakeRow[];
  exerciseDefinitions: FakeRow[];
  exerciseMuscleMappings: FakeRow[];
  exerciseTagDefinitions: FakeRow[];
  sessionExerciseTags: FakeRow[];
  muscleGroups: FakeRow[];
  syncOutboxEvents: FakeRow[];
  syncDeliveryState: FakeRow[];
  syncRuntimeState: FakeRow[];
};

const cloneRow = <T extends Record<string, unknown>>(row: T) => ({ ...row }) as T;

const createFakeDataLayer = () => {
  const state: FakeState = {
    gyms: [],
    sessions: [],
    sessionExercises: [],
    exerciseSets: [],
    exerciseDefinitions: [],
    exerciseMuscleMappings: [],
    exerciseTagDefinitions: [],
    sessionExerciseTags: [],
    muscleGroups: [],
    syncOutboxEvents: [],
    syncDeliveryState: [],
    syncRuntimeState: [],
  };

  const tableRows = new Map<object, FakeRow[]>([
    [gyms, state.gyms],
    [sessions, state.sessions],
    [sessionExercises, state.sessionExercises],
    [exerciseSets, state.exerciseSets],
    [exerciseDefinitions, state.exerciseDefinitions],
    [exerciseMuscleMappings, state.exerciseMuscleMappings],
    [exerciseTagDefinitions, state.exerciseTagDefinitions],
    [sessionExerciseTags, state.sessionExerciseTags],
    [muscleGroups, state.muscleGroups],
    [syncOutboxEvents, state.syncOutboxEvents],
    [syncDeliveryState, state.syncDeliveryState],
    [syncRuntimeState, state.syncRuntimeState],
  ]);

  const rowsFor = (table: object) => {
    const rows = tableRows.get(table);
    if (!rows) {
      throw new Error('Unknown table reference in fake data layer');
    }
    return rows;
  };

  const createSelectBuilder = (table: object) => {
    const api = {
      where: (_clause: unknown) => api,
      orderBy: (..._args: unknown[]) => api,
      limit: (_count: number) => api,
      all: () => rowsFor(table).map((row) => cloneRow(row)),
      get: () => {
        const rows = rowsFor(table);
        return rows.length > 0 ? cloneRow(rows[0]) : undefined;
      },
    };
    return api;
  };

  // Tables whose primary key is something other than `id`. For these we
  // must NOT dedupe on `id` (e.g. `syncOutboxEvents.id` is an autoincrement
  // integer that the writer leaves undefined; deduping on it would collapse
  // every row into one).
  const rowKey = (table: object, value: FakeRow): string | null => {
    if (table === syncOutboxEvents) {
      return `event:${String(value.eventId ?? '')}`;
    }
    if (table === exerciseMuscleMappings) {
      return `pair:${String(value.exerciseDefinitionId ?? '')}:${String(value.muscleGroupId ?? '')}`;
    }
    const id = (value as { id?: unknown }).id;
    if (id === undefined || id === null) {
      return null;
    }
    return `id:${String(id)}`;
  };

  const insert = (table: object) => ({
    values: (input: FakeRow | FakeRow[]) => {
      const apply = () => {
        const rows = rowsFor(table);
        const values = Array.isArray(input) ? input : [input];
        // Mimic onConflictDoUpdate by deduplicating on the table's natural
        // key. For tables without a stable natural key (e.g. autoincrement
        // outbox rows), append unconditionally.
        values.forEach((value) => {
          const key = rowKey(table, value);
          if (key === null) {
            rows.push(cloneRow(value));
            return;
          }
          const existingIndex = rows.findIndex((row) => rowKey(table, row) === key);
          if (existingIndex >= 0) {
            rows[existingIndex] = cloneRow(value);
          } else {
            rows.push(cloneRow(value));
          }
        });
      };
      return {
        run: apply,
        onConflictDoUpdate: (_options: unknown) => ({
          run: apply,
        }),
      };
    },
  });

  const update = (table: object) => ({
    set: (patch: FakeRow) => ({
      where: (_clause: unknown) => ({
        run: () => {
          const rows = rowsFor(table);
          rows.forEach((row) => {
            Object.entries(patch).forEach(([key, value]) => {
              if (value !== undefined) {
                row[key] = value;
              }
            });
          });
        },
      }),
    }),
  });

  const del = (table: object) => {
    const run = () => {
      const rows = rowsFor(table);
      rows.length = 0;
    };
    return {
      where: (_clause: unknown) => ({ run }),
      run,
    };
  };

  const database = {
    transaction: <T>(callback: (tx: any) => T) => {
      const tx = {
        select: (_fields?: unknown) => ({
          from: (table: object) => createSelectBuilder(table),
        }),
        insert,
        update,
        delete: del,
      };
      return callback(tx);
    },
    select: (_fields?: unknown) => ({
      from: (table: object) => createSelectBuilder(table),
    }),
    insert,
    update,
    delete: del,
  };

  return { database, state };
};

const emptyRemoteState = () => ({
  gyms: [],
  sessions: [],
  sessionExercises: [],
  exerciseSets: [],
  exerciseDefinitions: [],
  exerciseMuscleMappings: [],
  exerciseTagDefinitions: [],
  sessionExerciseTags: [],
});

describe('sync bootstrap merge preserves user writes that landed before bootstrap (T9)', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
    mockSeedSystemExerciseCatalog.mockReset();
  });

  it('reinserts a locally-created gym after the wipe-and-merge and queues a convergence event for it', async () => {
    const fake = createFakeDataLayer();
    mockBootstrapLocalDataLayer.mockResolvedValue(fake.database);

    // Simulate the T8 marker so the seeder no-ops and we do not need to model
    // its inserts here. (The seeder is jest.mock'd to a no-op anyway; this
    // mirrors a real device whose first-launch seed has already happened.)
    fake.state.syncRuntimeState.push({
      id: 'primary',
      isEnabled: 0,
      bootstrapUserId: null,
      bootstrapCompletedAt: null,
      lastBootstrapError: null,
      lastBootstrapAttemptAt: null,
      seedsAppliedAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    // The user creates a gym locally via the public data API. This must
    // - land in the `gyms` table, and
    // - emit a `gyms.upsert` event into the outbox.
    const createdAt = new Date('2026-03-07T11:59:00.000Z');
    const userGymId = 'user-created-gym-1';
    await upsertLocalGym({
      id: userGymId,
      name: 'My Garage Gym',
      now: createdAt,
    });

    // Sanity: the user write actually landed in both local tables before the
    // merge runs.
    expect(fake.state.gyms.find((row) => row.id === userGymId)).toBeDefined();
    const outboxAfterUserWrite = fake.state.syncOutboxEvents.filter(
      (row) => row.entityType === 'gyms' && row.entityId === userGymId
    );
    expect(outboxAfterUserWrite.length).toBe(1);
    const userWriteOutboxEventId = outboxAfterUserWrite[0]?.eventId;
    expect(typeof userWriteOutboxEventId).toBe('string');

    // Run the merge against an empty remote. This is the bootstrap path that
    // wipes-and-reinserts the projection tables in a single transaction.
    const mergeNow = new Date('2026-03-07T12:00:00.000Z');
    const mergeResult = await mergeRemoteProjectionIntoLocalState({
      remoteState: emptyRemoteState(),
      now: mergeNow,
    });

    // INVARIANT 1 — the locally-created gym row survives the wipe because
    // `applyMergePlanTx` reads localState inside the merge tx and reinserts
    // local-winner rows.
    const survivingGym = fake.state.gyms.find((row) => row.id === userGymId);
    expect(survivingGym).toBeDefined();
    expect(survivingGym?.name).toBe('My Garage Gym');

    // INVARIANT 2 — the merge wipe never touches the outbox table. The
    // original `upsertLocalGym` event is still queued to be flushed.
    const survivingOriginalEvent = fake.state.syncOutboxEvents.find(
      (row) => row.eventId === userWriteOutboxEventId
    );
    expect(survivingOriginalEvent).toBeDefined();
    expect(survivingOriginalEvent?.entityType).toBe('gyms');
    expect(survivingOriginalEvent?.entityId).toBe(userGymId);

    // INVARIANT 3 — the merge ALSO queues a convergence event for the local
    // winner so a fresh server (post-reinstall, post-account-switch) learns
    // about the gym even if the original outbox event had already been
    // shipped. This is the "local winner → convergence event" guarantee that
    // makes the bootstrap merge idempotent across reinstall cycles.
    expect(mergeResult.convergenceEventsQueued).toBeGreaterThan(0);
    const convergenceEvents = fake.state.syncOutboxEvents.filter(
      (row) =>
        row.entityType === 'gyms' &&
        row.entityId === userGymId &&
        row.eventId !== userWriteOutboxEventId
    );
    expect(convergenceEvents.length).toBeGreaterThanOrEqual(1);
    const convergenceEvent = convergenceEvents[0];
    expect(convergenceEvent?.eventType).toBe('upsert');

    // INVARIANT 4 — merged-counts reflect the survived gym so callers that
    // log/observe merge results see it included.
    expect(mergeResult.mergedCounts.gyms).toBe(1);
  });
});
