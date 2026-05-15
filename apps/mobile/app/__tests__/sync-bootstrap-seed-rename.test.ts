/* eslint-disable import/first */

// T9 Test 3 — server rename of a seeded exercise wins over the local default
// after the bootstrap merge.
//
// What this locks: the merge by `updated_at_ms` is correct for the seed-rename
// case. Without this test, a future change to the merge rule (e.g. accidentally
// inverting the comparison direction) could make local seeds always win, which
// would clobber a user's renames whenever they reinstall.

const mockBootstrapLocalDataLayer = jest.fn();
const mockSeedSystemExerciseCatalog = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

// The merge re-seeds the catalog after commit (T4 + T8). We mock the seeder
// to a no-op so it cannot interfere with the post-merge state we are
// asserting against — the seed-rename invariant lives in the merge step,
// not in the post-merge re-seed.
jest.mock('@/src/data/exercise-catalog-seeds', () => {
  const actual = jest.requireActual('@/src/data/exercise-catalog-seeds');
  return {
    ...actual,
    seedSystemExerciseCatalog: (...args: unknown[]) => mockSeedSystemExerciseCatalog(...args),
  };
});

import { SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';
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
import {
  mergeRemoteProjectionIntoLocalState,
  type SyncBootstrapRemoteState,
} from '@/src/sync';

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

  const insert = (table: object) => ({
    values: (input: FakeRow | FakeRow[]) => {
      const apply = () => {
        const rows = rowsFor(table);
        const values = Array.isArray(input) ? input : [input];
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

const emptyRemoteState = (): SyncBootstrapRemoteState => ({
  gyms: [],
  sessions: [],
  sessionExercises: [],
  exerciseSets: [],
  exerciseDefinitions: [],
  exerciseMuscleMappings: [],
  exerciseTagDefinitions: [],
  sessionExerciseTags: [],
});

describe('sync bootstrap merge respects server rename of seeded exercises (T9)', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
    mockSeedSystemExerciseCatalog.mockReset();
  });

  it('replaces a seeded exercise definition with the server-renamed version when remote.updated_at is newer', async () => {
    const fake = createFakeDataLayer();
    mockBootstrapLocalDataLayer.mockResolvedValue(fake.database);

    // Mark seeds as already applied (T8 marker) so the post-merge re-seed
    // would no-op even if it weren't mocked. This isolates the assertion to
    // the merge behaviour.
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

    // Pick a known seeded exercise id and pretend the local row carries the
    // canonical seed name with a stale `updatedAt`.
    const canonicalSeed = SYSTEM_EXERCISE_DEFINITION_SEEDS[0];
    expect(canonicalSeed).toBeDefined();
    const seedId = canonicalSeed.id;
    const localUpdatedAt = new Date('2026-03-01T00:00:00.000Z');
    fake.state.exerciseDefinitions.push({
      id: seedId,
      name: canonicalSeed.name,
      deletedAt: null,
      createdAt: localUpdatedAt,
      updatedAt: localUpdatedAt,
    });

    // Build the remote projection: same id, different name, strictly newer
    // updated_at. This models a server-side rename (e.g. user renamed it on
    // device A and the convergence event landed; this device is now
    // bootstrapping fresh and pulling that rename down).
    const remoteUpdatedAtMs = new Date('2026-03-05T12:00:00.000Z').getTime();
    const remoteState = emptyRemoteState();
    const renamedName = 'User Custom Bench';
    remoteState.exerciseDefinitions.push({
      id: seedId,
      name: renamedName,
      deletedAtMs: null,
      createdAtMs: localUpdatedAt.getTime(),
      updatedAtMs: remoteUpdatedAtMs,
    });

    const mergeResult = await mergeRemoteProjectionIntoLocalState({
      remoteState,
      now: new Date('2026-03-07T12:00:00.000Z'),
    });

    // INVARIANT 1 — the local row now carries the server-renamed name. If a
    // future refactor inverted the merge comparison, the local seed name
    // would persist instead and this assertion would catch the regression.
    const mergedRow = fake.state.exerciseDefinitions.find((row) => row.id === seedId);
    expect(mergedRow).toBeDefined();
    expect(mergedRow?.name).toBe(renamedName);

    // INVARIANT 2 — exactly one row remains for this id (the wipe-and-merge
    // did not double-insert).
    const matchingRows = fake.state.exerciseDefinitions.filter((row) => row.id === seedId);
    expect(matchingRows.length).toBe(1);

    // INVARIANT 3 — no convergence event is queued for this id, because the
    // remote already has the canonical (newest) version. Re-uploading would
    // be churn at best and at worst could revert another device's edits.
    const queuedForSeed = fake.state.syncOutboxEvents.filter(
      (row) => row.entityType === 'exercise_definitions' && row.entityId === seedId
    );
    expect(queuedForSeed).toEqual([]);

    // INVARIANT 4 — merged-counts accurately reflect that the server row is
    // present.
    expect(mergeResult.mergedCounts.exerciseDefinitions).toBe(1);
  });
});
