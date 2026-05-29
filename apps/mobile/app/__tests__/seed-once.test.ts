import {
  __clearSeedsAppliedMarkerForReset,
  SEED_CATALOG_BUNDLE_VERSION,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  seedSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  muscleGroups,
  syncRuntimeState,
} from '@/src/data/schema';

type FakeRow = Record<string, unknown> & { id?: unknown };
type FakeMappingRow = FakeRow & { exerciseDefinitionId?: unknown; muscleGroupId?: unknown };

type FakeState = {
  muscleGroups: FakeRow[];
  exerciseDefinitions: FakeRow[];
  exerciseMuscleMappings: FakeMappingRow[];
  syncRuntimeState: FakeRow[];
};

const cloneRow = <T extends Record<string, unknown>>(row: T) => ({ ...row }) as T;

const createFakeDatabase = () => {
  const state: FakeState = {
    muscleGroups: [],
    exerciseDefinitions: [],
    exerciseMuscleMappings: [],
    syncRuntimeState: [],
  };

  const tableRows = new Map<object, FakeRow[]>([
    [muscleGroups, state.muscleGroups],
    [exerciseDefinitions, state.exerciseDefinitions],
    [exerciseMuscleMappings, state.exerciseMuscleMappings],
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
      const mapping = value as FakeMappingRow;
      return `${String(mapping.exerciseDefinitionId)}:${String(mapping.muscleGroupId)}`;
    }
    return String((value as { id?: unknown }).id);
  };

  const findExistingIndex = (rows: FakeRow[], table: object, value: FakeRow): number => {
    const key = rowKey(table, value);
    return rows.findIndex((row) => rowKey(table, row) === key);
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
          const existingIndex = findExistingIndex(rows, table, value);
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

describe('seedSystemExerciseCatalog (T8 — seed once, never overwrite)', () => {
  const fixedNow = new Date('2026-05-14T12:00:00.000Z');

  it('seeds the canonical bundle on the first call against an empty database and stamps the marker', () => {
    const fake = createFakeDatabase();

    seedSystemExerciseCatalog(fake.database, fixedNow);

    expect(fake.state.muscleGroups.length).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    expect(fake.state.exerciseDefinitions.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(fake.state.exerciseMuscleMappings.length).toBe(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length);

    const runtimeRow = fake.state.syncRuntimeState[0];
    expect(runtimeRow).toBeDefined();
    expect(runtimeRow?.appliedSeedMigrationAppVersion).toBe(SEED_CATALOG_BUNDLE_VERSION);
  });

  it('returns early on subsequent calls so a user rename of a seeded row is preserved across launches', () => {
    const fake = createFakeDatabase();

    seedSystemExerciseCatalog(fake.database, fixedNow);

    const renamedSeedId = SYSTEM_EXERCISE_DEFINITION_SEEDS[0].id;
    const customName = 'My Custom Bench Variant';
    const renamedRow = fake.state.exerciseDefinitions.find((row) => row.id === renamedSeedId);
    expect(renamedRow).toBeDefined();
    if (renamedRow) {
      renamedRow.name = customName;
    }

    seedSystemExerciseCatalog(fake.database, new Date('2026-05-14T18:00:00.000Z'));

    const persistedRow = fake.state.exerciseDefinitions.find((row) => row.id === renamedSeedId);
    expect(persistedRow?.name).toBe(customName);
  });

  it('does not bump updated_at on seeded rows when invoked after the marker is set', () => {
    const fake = createFakeDatabase();

    seedSystemExerciseCatalog(fake.database, fixedNow);
    const initialDefinitionTimestamps = fake.state.exerciseDefinitions.map((row) => row.updatedAt);

    seedSystemExerciseCatalog(fake.database, new Date('2026-05-14T23:59:59.000Z'));
    const followUpDefinitionTimestamps = fake.state.exerciseDefinitions.map((row) => row.updatedAt);

    expect(followUpDefinitionTimestamps).toEqual(initialDefinitionTimestamps);
  });

  it('re-seeds after the marker is cleared (the dev-reset path)', () => {
    const fake = createFakeDatabase();

    seedSystemExerciseCatalog(fake.database, fixedNow);
    expect(fake.state.exerciseDefinitions.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);

    // Simulate the dev-reset wipe + clear-marker flow.
    fake.state.muscleGroups.length = 0;
    fake.state.exerciseDefinitions.length = 0;
    fake.state.exerciseMuscleMappings.length = 0;
    __clearSeedsAppliedMarkerForReset(fake.database, fixedNow);

    expect(fake.state.exerciseDefinitions.length).toBe(0);

    const reseedAt = new Date('2026-05-15T08:00:00.000Z');
    seedSystemExerciseCatalog(fake.database, reseedAt);

    expect(fake.state.exerciseDefinitions.length).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
    expect(fake.state.muscleGroups.length).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
    expect(fake.state.exerciseMuscleMappings.length).toBe(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length);
    expect(fake.state.syncRuntimeState[0]?.appliedSeedMigrationAppVersion).toBe(SEED_CATALOG_BUNDLE_VERSION);
  });
});
