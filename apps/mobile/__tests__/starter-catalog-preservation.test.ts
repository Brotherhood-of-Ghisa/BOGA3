import { eq } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import { runBundleMigrations } from '@/src/data/bundle-migrations';
import {
  CURRENT_APP_VERSION,
  STANDARD_EXERCISE_DEFINITION_SEEDS,
  STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  seedSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';
import { maintainInfraFreeStarterCatalog } from '@/src/data/infra-free-catalog-bootstrap';
import {
  exerciseDefinitions, exerciseMuscleMappings, exerciseSets, muscleGroups,
  sessionExercises, sessions, syncRuntimeState,
} from '@/src/data/schema';
import { buildAddAsNewPrefill } from '@/src/groups/add-as-new';
import { searchStandardExercises } from '@/src/groups/exercise-view-model';
import { EMPTY_MUSCLE_SETUP } from '@/src/exercise-catalog/muscle-setup';
import { seedStandardCatalogFixture } from '@/src/maestro/standard-catalog-fixture';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
beforeEach(() => { fixture = createInMemoryDatabase(); });
afterEach(() => { fixture.close(); });

it('preserves a returning account\'s full old catalogue, edits, tombstones and completed history', () => {
  const db = fixture.database;
  const now = new Date('2026-10-01T12:00:00.000Z');
  db.insert(muscleGroups).values(SYSTEM_MUSCLE_GROUP_SEEDS).run();
  db.insert(exerciseDefinitions).values(STANDARD_EXERCISE_DEFINITION_SEEDS).run();
  db.insert(exerciseMuscleMappings).values(STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS).run();
  db.insert(exerciseDefinitions).values({ id: 'custom', name: 'My exercise' }).run();
  db.update(exerciseDefinitions).set({ name: 'My Squat', bodyweightContribution: 0.25 })
    .where(eq(exerciseDefinitions.id, 'seed_barbell_back_squat')).run();
  db.update(exerciseDefinitions).set({ deletedAt: now })
    .where(eq(exerciseDefinitions.id, 'seed_dumbbell_lateral_raise')).run();
  db.update(exerciseMuscleMappings).set({ weight: 0.33, role: 'secondary' })
    .where(eq(exerciseMuscleMappings.id, 'seed_map_barbell_back_squat__quads')).run();
  db.insert(sessions).values({ id: 'old-session', status: 'completed', startedAt: now,
    completedAt: new Date(now.getTime() + 60_000), durationSec: 60 }).run();
  db.insert(sessionExercises).values({ id: 'old-block', sessionId: 'old-session', orderIndex: 0,
    exerciseDefinitionId: 'seed_incline_dumbbell_press', name: 'Incline Dumbbell Press' }).run();
  db.insert(exerciseSets).values({ id: 'old-set', sessionExerciseId: 'old-block', orderIndex: 0,
    weightValue: '30', repsValue: '10', setType: 'rir_2' }).run();
  db.insert(syncRuntimeState).values({ id: 'primary', appliedSeedMigrationAppVersion: 7 }).run();
  const before = {
    definitions: db.select().from(exerciseDefinitions).all(),
    mappings: db.select().from(exerciseMuscleMappings).all(),
    muscles: db.select().from(muscleGroups).all(),
    sessions: db.select().from(sessions).all(),
    blocks: db.select().from(sessionExercises).all(),
    sets: db.select().from(exerciseSets).all(),
  };

  const database = db as unknown as LocalDatabase;
  maintainInfraFreeStarterCatalog(database);
  seedSystemExerciseCatalog(database);
  runBundleMigrations(database);

  expect(CURRENT_APP_VERSION).toBe(7);
  expect(db.select().from(exerciseDefinitions).all()).toEqual(before.definitions);
  expect(db.select().from(exerciseMuscleMappings).all()).toEqual(before.mappings);
  expect(db.select().from(muscleGroups).all()).toEqual(before.muscles);
  expect(db.select().from(sessions).all()).toEqual(before.sessions);
  expect(db.select().from(sessionExercises).all()).toEqual(before.blocks);
  expect(db.select().from(exerciseSets).all()).toEqual(before.sets);
  expect(fixture.client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('keeps generation-3 bodyweight upgrades for the two exercises removed from the new starter', () => {
  const db = fixture.database;
  db.insert(exerciseDefinitions).values([
    { id: 'seed_chin-ups', name: 'Chin-Up' },
    { id: 'seed_parallel_bar_dips', name: 'Parallel Bar Dip' },
    { id: 'seed_pull_up', name: 'Pull-Up' },
    { id: 'seed_push_up', name: 'Push-Up' },
    { id: 'renamed', name: 'My Chin-Up', bodyweightContribution: 0.4 },
  ]).run();
  db.insert(syncRuntimeState).values({ id: 'primary', appliedSeedMigrationAppVersion: 2 }).run();

  runBundleMigrations(db as unknown as LocalDatabase);

  expect(db.select({ id: exerciseDefinitions.id, contribution: exerciseDefinitions.bodyweightContribution })
    .from(exerciseDefinitions).all()).toEqual([
    { id: 'seed_chin-ups', contribution: 1 },
    { id: 'seed_parallel_bar_dips', contribution: 1 },
    { id: 'seed_pull_up', contribution: 1 },
    { id: 'seed_push_up', contribution: 0.7 },
    { id: 'renamed', contribution: 0.4 },
  ]);
});

it('keeps the global group catalogue and old source prefills independent of the new starter', () => {
  expect(STANDARD_EXERCISE_DEFINITION_SEEDS).toHaveLength(136);
  expect(STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS).toHaveLength(412);
  const options = searchStandardExercises('', EMPTY_MUSCLE_SETUP, Infinity);
  expect(options.total).toBe(136);
  expect(options.options).toContainEqual({ sourceExerciseId: 'seed_standing_calf_raise',
    name: 'Standing Calf Raise', loadInputMode: 'total_load' });
  expect(searchStandardExercises('incline pectoralis', EMPTY_MUSCLE_SETUP, Infinity).options)
    .toContainEqual({ sourceExerciseId: 'seed_incline_dumbbell_press',
      name: 'Incline Dumbbell Press', loadInputMode: 'per_side_load' });
  expect(buildAddAsNewPrefill({ group_exercise_id: 'group-incline', name: 'Incline',
    source_exercise_id: 'seed_incline_dumbbell_press', load_input_mode: 'per_side_load',
    archived_at_ms: null }).mappings).toEqual([
    { muscleGroupId: 'chest', weight: 1, role: 'primary' },
    { muscleGroupId: 'delts_front', weight: 0.5, role: 'secondary' },
    { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  ]);
});

it('explicitly restores the old catalogue for history fixtures without changing the fresh seed marker', async () => {
  const db = fixture.database;
  const database = db as unknown as LocalDatabase;
  seedSystemExerciseCatalog(database);
  expect(db.select().from(exerciseDefinitions).all()).toHaveLength(21);
  db.insert(exerciseDefinitions).values({ id: 'fixture-custom', name: 'Custom' }).run();
  db.insert(exerciseMuscleMappings).values({ id: 'fixture-custom-map',
    exerciseDefinitionId: 'fixture-custom', muscleGroupId: 'chest', weight: 1, role: 'primary' }).run();

  for (let repeat = 0; repeat < 2; repeat += 1) {
    await seedStandardCatalogFixture(database);
    expect(db.select().from(exerciseDefinitions).all()).toHaveLength(137);
    const mappings = db.select({ id: exerciseMuscleMappings.id,
      exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
      muscleGroupId: exerciseMuscleMappings.muscleGroupId, weight: exerciseMuscleMappings.weight,
      role: exerciseMuscleMappings.role }).from(exerciseMuscleMappings).all();
    expect(mappings.filter((mapping) => mapping.exerciseDefinitionId !== 'fixture-custom'))
      .toEqual(STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS);
    expect(mappings.find((mapping) => mapping.id === 'fixture-custom-map')).toBeDefined();
    expect(db.select().from(syncRuntimeState).get()?.appliedSeedMigrationAppVersion).toBe(7);
  }
});
