/* eslint-disable import/first */

const mockBootstrapLocalDataLayer = jest.fn();

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

import {
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '@/src/data/exercise-catalog-seeds';
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

type FakeState = {
  gyms: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  sessionExercises: Record<string, unknown>[];
  exerciseSets: Record<string, unknown>[];
  exerciseDefinitions: Record<string, unknown>[];
  exerciseMuscleMappings: Record<string, unknown>[];
  exerciseTagDefinitions: Record<string, unknown>[];
  sessionExerciseTags: Record<string, unknown>[];
  muscleGroups: Record<string, unknown>[];
  syncOutboxEvents: Record<string, unknown>[];
  syncDeliveryState: Record<string, unknown>[];
  syncRuntimeState: Record<string, unknown>[];
};

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

  const tableRows = new Map<object, Record<string, unknown>[]>([
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

  const cloneRow = <T extends Record<string, unknown>>(row: T) => ({ ...row }) as T;

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

  const insert = (table: object) => ({
    values: (input: Record<string, unknown> | Record<string, unknown>[]) => {
      const apply = () => {
        const rows = rowsFor(table);
        const values = Array.isArray(input) ? input : [input];
        // Mimic onConflictDoUpdate by deduplicating on `id` so callers like
        // the seeder do not produce duplicate rows when invoked repeatedly.
        values.forEach((value) => {
          const id = (value as { id?: unknown }).id;
          const existingIndex = rows.findIndex((row) => (row as { id?: unknown }).id === id);
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
    set: (patch: Record<string, unknown>) => ({
      where: (_clause: unknown) => ({
        run: () => {
          const rows = rowsFor(table);
          rows.forEach((row) => {
            Object.entries(patch).forEach(([key, value]) => {
              if (value !== undefined) {
                (row as Record<string, unknown>)[key] = value;
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

describe('sync bootstrap merge re-seeds the system exercise catalog (T4)', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
  });

  it('restores the canonical seed counts after a bootstrap merge with an empty remote', async () => {
    const fake = createFakeDataLayer();
    mockBootstrapLocalDataLayer.mockResolvedValue(fake.database);

    await mergeRemoteProjectionIntoLocalState({
      remoteState: emptyRemoteState(),
      now: new Date('2026-03-07T12:00:00.000Z'),
    });

    // The merge step wipes the catalog tables, then the post-merge re-seed
    // step must repopulate them with the canonical seed bundle.
    expect(fake.state.exerciseDefinitions.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(fake.state.exerciseMuscleMappings.length).toBe(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length);
    // muscleGroups is not in the wipe list, but the seeder still upserts the
    // full set so that fresh installs end up with the canonical roster.
    expect(fake.state.muscleGroups.length).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
  });

  it('re-seeds the catalog even when prior local seed rows are wiped by the merge', async () => {
    const fake = createFakeDataLayer();
    mockBootstrapLocalDataLayer.mockResolvedValue(fake.database);

    // Pre-populate the local catalog tables with rows that match canonical
    // seed IDs so the post-merge seeder upserts (rather than appends) them.
    // This mirrors a previously seeded database whose catalog rows were just
    // wiped by the merge step.
    const canonicalExercise = SYSTEM_EXERCISE_DEFINITION_SEEDS[0];
    fake.state.exerciseDefinitions.push({
      id: canonicalExercise.id,
      name: 'Stale Name From Prior Boot',
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await mergeRemoteProjectionIntoLocalState({
      remoteState: emptyRemoteState(),
      now: new Date('2026-03-07T12:00:00.000Z'),
    });

    // After the merge wipe + re-seed, the catalog should contain exactly the
    // canonical seed bundle. The stale row is gone (wiped by the merge step)
    // and replaced by the canonical seed row with the up-to-date name.
    expect(fake.state.exerciseDefinitions.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    const restored = fake.state.exerciseDefinitions.find(
      (row) => row.id === canonicalExercise.id
    );
    expect(restored).toBeDefined();
    expect(restored?.name).toBe(canonicalExercise.name);
  });
});

describe('sync bootstrap merge respects the seeded-once marker (T8)', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
  });

  it('does not re-seed catalog rows when the marker is already set on an empty-remote merge', async () => {
    const fake = createFakeDataLayer();
    mockBootstrapLocalDataLayer.mockResolvedValue(fake.database);

    // Mark the catalog as already-seeded in a prior launch. The merge step
    // wipes the catalog tables, so we cannot use the existing pre-seeded
    // exercise rows as evidence; instead we assert the wipe is NOT followed
    // by a re-seed because the marker is set.
    const priorSeedAt = new Date('2026-03-01T00:00:00.000Z');
    fake.state.syncRuntimeState.push({
      id: 'primary',
      isEnabled: 0,
      bootstrapUserId: null,
      bootstrapCompletedAt: null,
      lastBootstrapError: null,
      lastBootstrapAttemptAt: null,
      seedsAppliedAt: priorSeedAt,
      updatedAt: priorSeedAt,
    });

    await mergeRemoteProjectionIntoLocalState({
      remoteState: emptyRemoteState(),
      now: new Date('2026-03-07T12:00:00.000Z'),
    });

    // The merge wiped the catalog tables; the post-merge seeder observed
    // the marker and returned early WITHOUT repopulating them. This is the
    // critical guarantee: an already-seeded device hitting an empty remote
    // does not generate spurious convergence churn from re-bumped
    // updated_at fields on seed rows.
    expect(fake.state.exerciseDefinitions.length).toBe(0);
    expect(fake.state.exerciseMuscleMappings.length).toBe(0);

    // Marker is preserved (not bumped to a fresh now) — proves the seeder
    // really did short-circuit instead of running and re-stamping.
    expect(fake.state.syncRuntimeState[0]?.seedsAppliedAt).toEqual(priorSeedAt);
  });
});
