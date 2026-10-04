import { resetLocalDataAndReseed } from '@/src/data/dev-reset';

import { createInMemoryDatabase } from './helpers/in-memory-db';
import {
  SEED_CATALOG_BUNDLE_VERSION,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  seedSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';
import {
  bodyWeightMeasurements,
  exerciseDefinitions,
  exerciseGroupLinks,
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
  bodyWeightMeasurements: FakeRow[];
  muscleGroups: FakeRow[];
  exerciseDefinitions: FakeRow[];
  exerciseGroupLinks: FakeRow[];
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
    bodyWeightMeasurements: [],
    muscleGroups: [],
    exerciseDefinitions: [],
    exerciseGroupLinks: [],
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
    [bodyWeightMeasurements, state.bodyWeightMeasurements],
    [muscleGroups, state.muscleGroups],
    [exerciseDefinitions, state.exerciseDefinitions],
    [exerciseGroupLinks, state.exerciseGroupLinks],
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

  it('wipes user data and the sync accounting, keeps the owner, and re-seeds the catalog', async () => {
    const fixture = createInMemoryDatabase();
    const { database, client } = fixture;
    try {
      seedSystemExerciseCatalog(database as never, new Date('2026-03-01T00:00:00.000Z'));
      client.exec(`
        INSERT INTO gyms (id, name) VALUES ('gym-1', 'Local Gym');
        INSERT INTO sessions (id, gym_id, started_at) VALUES ('session-1', 'gym-1', 1);
        INSERT INTO session_exercises (id, session_id, order_index, name) VALUES ('sx-1', 'session-1', 0, 'Press');
        INSERT INTO exercise_sets (id, session_exercise_id, order_index) VALUES ('set-1', 'sx-1', 0);
        INSERT INTO body_weight_measurements (id, measured_at, weight_kg) VALUES ('reading-1', 1, 80);
      `);
      database
        .update(syncRuntimeState)
        .set({
          bootstrapCompletedAt: new Date(1_700_000_000_000),
          pullCursor: { '1': { id: 'stale' } } as never,
          accountUserId: 'user-a',
        })
        .run();

      const resetAt = new Date('2026-05-14T15:30:00.000Z');
      const result = await resetLocalDataAndReseed({
        isDev: true,
        bootstrap: async () => database as never,
        now: resetAt,
      });

      expect(result.resetAt).toBe(resetAt);
      const count = (table: string) =>
        (client.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      for (const table of ['gyms', 'sessions', 'session_exercises', 'exercise_sets', 'body_weight_measurements']) {
        expect({ table, rows: count(table) }).toEqual({ table, rows: 0 });
      }

      // Catalog is repopulated from the canonical seed bundle.
      expect(count('muscle_groups')).toBe(SYSTEM_MUSCLE_GROUP_SEEDS.length);
      expect(count('exercise_definitions')).toBe(SYSTEM_EXERCISE_DEFINITION_SEEDS.length);
      expect(count('exercise_muscle_mappings')).toBe(SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length);

      // The next sync restores the rest from scratch: no bootstrap flag, no
      // cursors that would skip the account's older server rows. The store still
      // belongs to the same account, and the seed marker is current so a later
      // seeder call is a no-op.
      const runtime = database.select().from(syncRuntimeState).get();
      expect(runtime).toMatchObject({
        bootstrapCompletedAt: null,
        pullCursor: {},
        accountUserId: 'user-a',
        appliedSeedMigrationAppVersion: SEED_CATALOG_BUNDLE_VERSION,
      });
    } finally {
      fixture.close();
    }
  });
});
