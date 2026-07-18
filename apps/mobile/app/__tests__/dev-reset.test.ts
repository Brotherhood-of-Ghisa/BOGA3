import { resetLocalDataAndReseed } from '@/src/data/dev-reset';
import {
  SEED_CATALOG_BUNDLE_VERSION,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  seedSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  muscleGroups,
  sessionExerciseTags,
  sessionExercises,
  sessions,
  syncRuntimeState,
} from '@/src/data/schema';

type FakeRow = Record<string, unknown>;

type FakeState = {
  muscleGroups: FakeRow[];
  exerciseDefinitions: FakeRow[];
  exerciseMuscleMappings: FakeRow[];
  exerciseSets: FakeRow[];
  exerciseTagDefinitions: FakeRow[];
  sessionExerciseTags: FakeRow[];
  sessionExercises: FakeRow[];
  sessions: FakeRow[];
  gyms: FakeRow[];
  syncRuntimeState: FakeRow[];
};

const cloneRow = <T extends Record<string, unknown>>(row: T) => ({ ...row }) as T;

const createFakeDatabase = () => {
  const state: FakeState = {
    muscleGroups: [],
    exerciseDefinitions: [],
    exerciseMuscleMappings: [],
    exerciseSets: [],
    exerciseTagDefinitions: [],
    sessionExerciseTags: [],
    sessionExercises: [],
    sessions: [],
    gyms: [],
    syncRuntimeState: [],
  };

  const tableRows = new Map<object, FakeRow[]>([
    [muscleGroups, state.muscleGroups],
    [exerciseDefinitions, state.exerciseDefinitions],
    [exerciseMuscleMappings, state.exerciseMuscleMappings],
    [exerciseSets, state.exerciseSets],
    [exerciseTagDefinitions, state.exerciseTagDefinitions],
    [sessionExerciseTags, state.sessionExerciseTags],
    [sessionExercises, state.sessionExercises],
    [sessions, state.sessions],
    [gyms, state.gyms],
    [syncRuntimeState, state.syncRuntimeState],
  ]);

  const rowsFor = (table: object) => {
    const rows = tableRows.get(table);
    if (!rows) {
      throw new Error('Unknown table reference in fake database');
    }
    return rows;
  };

  const rowKey = (table: object, value: FakeRow): string => {
    if (table === exerciseMuscleMappings) {
      return `${String(value.exerciseDefinitionId)}:${String(value.muscleGroupId)}`;
    }
    return String((value as { id?: unknown }).id);
  };

  const createSelectBuilder = (table: object) => {
    const api = {
      from: (_table: object) => api,
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

  const select = (_fields?: unknown) => ({
    from: (table: object) => createSelectBuilder(table),
  });

  const insert = (table: object) => ({
    values: (input: FakeRow | FakeRow[]) => {
      const apply = () => {
        const rows = rowsFor(table);
        const values = Array.isArray(input) ? input : [input];
        values.forEach((value) => {
          const key = rowKey(table, value);
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
    set: (patch: Partial<FakeRow>) => ({
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
    transaction: <T>(callback: (tx: unknown) => T) => {
      const tx = { select, insert, update, delete: del };
      return callback(tx);
    },
    select,
    insert,
    update,
    delete: del,
  };

  return { database, state } as { database: any; state: FakeState };
};

describe('resetLocalDataAndReseed (dev reset path)', () => {
  it('refuses to run outside dev mode', async () => {
    const fake = createFakeDatabase();

    await expect(
      resetLocalDataAndReseed({
        isDev: false,
        bootstrap: async () => fake.database,
      })
    ).rejects.toThrow(/developer-only/i);

    // Nothing was wiped or seeded.
    expect(fake.state.exerciseDefinitions.length).toBe(0);
    expect(fake.state.muscleGroups.length).toBe(0);
  });

  it('wipes user data, clears the marker, and re-seeds the catalog', async () => {
    const fake = createFakeDatabase();

    // Seed the catalog and pre-populate user data so we can verify the wipe.
    seedSystemExerciseCatalog(fake.database, new Date('2026-03-01T00:00:00.000Z'));
    fake.state.gyms.push({ id: 'gym-1', name: 'Local Gym' });
    fake.state.sessions.push({ id: 'session-1', gymId: 'gym-1' });
    fake.state.sessionExercises.push({ id: 'sx-1', sessionId: 'session-1' });
    fake.state.exerciseSets.push({ id: 'set-1', sessionExerciseId: 'sx-1' });

    expect(fake.state.exerciseDefinitions.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(fake.state.gyms.length).toBe(1);

    const resetAt = new Date('2026-05-14T15:30:00.000Z');
    const result = await resetLocalDataAndReseed({
      isDev: true,
      bootstrap: async () => fake.database,
      now: resetAt,
    });

    expect(result.resetAt).toBe(resetAt);

    // User-mutable tables are empty after the wipe.
    expect(fake.state.gyms.length).toBe(0);
    expect(fake.state.sessions.length).toBe(0);
    expect(fake.state.sessionExercises.length).toBe(0);
    expect(fake.state.exerciseSets.length).toBe(0);
    expect(fake.state.sessionExerciseTags.length).toBe(0);
    expect(fake.state.exerciseTagDefinitions.length).toBe(0);

    // Catalog is repopulated from the canonical seed bundle.
    expect(fake.state.muscleGroups.length).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    expect(fake.state.exerciseDefinitions.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(fake.state.exerciseMuscleMappings.length).toBe(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length);
    expect(fake.state.exerciseDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'seed_incline_barbell_bench_presses',
          name: 'Incline Barbell Bench Press',
        }),
      ])
    );
    expect(fake.state.exerciseDefinitions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'seed_barbell_bench_presses' }),
      ])
    );
    expect(fake.state.exerciseMuscleMappings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exerciseDefinitionId: 'seed_barbell_bench_presses' }),
      ])
    );

    // The marker reflects the current catalog bundle version so a follow-up
    // seeder call is a no-op (the seed-once invariant survives the reset).
    expect(fake.state.syncRuntimeState[0]?.appliedSeedMigrationAppVersion).toBe(SEED_CATALOG_BUNDLE_VERSION);
  });
});
