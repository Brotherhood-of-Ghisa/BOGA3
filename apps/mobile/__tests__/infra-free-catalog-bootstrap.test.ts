import { and, eq } from 'drizzle-orm';

import type { LocalDatabase } from '@/src/data/bootstrap';
import {
  CURRENT_APP_VERSION,
  PER_SIDE_LOAD_SEED_IDS,
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
  readSeedsAppliedMarker,
  seedSystemExerciseCatalog,
} from '@/src/data/exercise-catalog-seeds';
import { maintainInfraFreeStarterCatalog } from '@/src/data/infra-free-catalog-bootstrap';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  muscleGroups,
  syncRuntimeState,
} from '@/src/data/schema';

import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
} from './helpers/in-memory-db';

const asLocalDatabase = (fixture: InMemoryDatabaseFixture) =>
  fixture.database as unknown as LocalDatabase;

describe('infra-free starter catalog bootstrap', () => {
  let fixture: InMemoryDatabaseFixture;

  beforeEach(() => {
    fixture = createInMemoryDatabase();
  });

  afterEach(() => {
    fixture.close();
  });

  it('full-seeds a first install and stamps the current bundle generation', () => {
    maintainInfraFreeStarterCatalog(asLocalDatabase(fixture));

    expect(fixture.database.select().from(exerciseDefinitions).all()).toHaveLength(
      SYSTEM_EXERCISE_DEFINITION_SEEDS.length
    );
    expect(fixture.database.select().from(exerciseMuscleMappings).all()).toHaveLength(
      SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.length
    );
    expect(fixture.database.select().from(muscleGroups).all()).toHaveLength(25);
    expect(readSeedsAppliedMarker(asLocalDatabase(fixture))).toBe(CURRENT_APP_VERSION);
    expect(fixture.database.select().from(muscleGroups)
      .where(eq(muscleGroups.id, 'tibialis_anterior')).get()).toMatchObject({
      displayName: 'Tibialis Anterior',
      familyName: 'Lower Legs',
      localDirty: true,
    });
    for (const [id, displayName] of [
      ['forearms_grip', 'Forearms'],
      ['abs_rectus', 'Abs'],
      ['hip_abductors', 'Hip Abductors'],
    ]) {
      expect(fixture.database.select().from(muscleGroups)
        .where(eq(muscleGroups.id, id)).get()?.displayName).toBe(displayName);
    }
  });

  it('shortens generation-6 muscle names without reseeding exercises or mappings', () => {
    seedSystemExerciseCatalog(asLocalDatabase(fixture));
    const renamedMuscles = [
      { id: 'forearms_grip', oldName: 'Forearms / Grip', displayName: 'Forearms' },
      { id: 'abs_rectus', oldName: 'Abs (Rectus Abdominis)', displayName: 'Abs' },
      { id: 'hip_abductors', oldName: 'Hip Abductors (Glute Med/Min)', displayName: 'Hip Abductors' },
    ];
    for (const muscle of renamedMuscles) {
      fixture.database.update(muscleGroups)
        .set({ displayName: muscle.oldName, localDirty: false })
        .where(eq(muscleGroups.id, muscle.id)).run();
    }
    fixture.database.update(syncRuntimeState)
      .set({ appliedSeedMigrationAppVersion: 6 })
      .where(eq(syncRuntimeState.id, 'primary')).run();
    const exercises = fixture.database.select().from(exerciseDefinitions).all();
    const mappings = fixture.database.select().from(exerciseMuscleMappings).all();

    maintainInfraFreeStarterCatalog(asLocalDatabase(fixture));

    for (const { id, displayName } of renamedMuscles) {
      expect(fixture.database.select().from(muscleGroups)
        .where(eq(muscleGroups.id, id)).get()).toMatchObject({ displayName, localDirty: true });
    }
    expect(fixture.database.select().from(exerciseDefinitions).all()).toEqual(exercises);
    expect(fixture.database.select().from(exerciseMuscleMappings).all()).toEqual(mappings);
    expect(readSeedsAppliedMarker(asLocalDatabase(fixture))).toBe(CURRENT_APP_VERSION);
    const muscles = fixture.database.select().from(muscleGroups).all();

    maintainInfraFreeStarterCatalog(asLocalDatabase(fixture));

    expect(fixture.database.select().from(muscleGroups).all()).toEqual(muscles);
  });

  it('uses generation 2 migration for a marker-1 install without overwriting renamed or edited/extra mapping data', () => {
    seedSystemExerciseCatalog(asLocalDatabase(fixture));

    const exerciseId = [...PER_SIDE_LOAD_SEED_IDS].find((candidateId) =>
      SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.some(
        (mapping) => mapping.exerciseDefinitionId === candidateId
      )
    );
    if (!exerciseId) {
      throw new Error('Expected a per-side seed with at least one canonical mapping');
    }

    const canonicalMappings = SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.filter(
      (mapping) => mapping.exerciseDefinitionId === exerciseId
    );
    const editedMapping = canonicalMappings[0];
    const extraMuscleGroup = SYSTEM_MUSCLE_GROUP_SEEDS.find(
      (muscleGroup) =>
        !canonicalMappings.some((mapping) => mapping.muscleGroupId === muscleGroup.id)
    );
    if (!editedMapping || !extraMuscleGroup) {
      throw new Error('Expected canonical and extra mapping fixtures');
    }

    fixture.database
      .update(exerciseDefinitions)
      .set({
        name: 'My Renamed Seed Exercise',
        loadInputMode: 'total_load',
      })
      .where(eq(exerciseDefinitions.id, exerciseId))
      .run();
    fixture.database
      .update(exerciseMuscleMappings)
      .set({
        weight: 0.42,
        role: 'secondary',
      })
      .where(eq(exerciseMuscleMappings.id, editedMapping.id))
      .run();
    fixture.database
      .insert(exerciseMuscleMappings)
      .values({
        id: 'user-extra-mapping',
        exerciseDefinitionId: exerciseId,
        muscleGroupId: extraMuscleGroup.id,
        weight: 0.33,
        role: 'stabilizer',
      })
      .run();
    fixture.database
      .update(syncRuntimeState)
      .set({ appliedSeedMigrationAppVersion: 1 })
      .where(eq(syncRuntimeState.id, 'primary'))
      .run();

    maintainInfraFreeStarterCatalog(asLocalDatabase(fixture));

    expect(
      fixture.database
        .select()
        .from(exerciseDefinitions)
        .where(eq(exerciseDefinitions.id, exerciseId))
        .get()
    ).toMatchObject({
      name: 'My Renamed Seed Exercise',
      loadInputMode: 'per_side_load',
    });
    expect(
      fixture.database
        .select()
        .from(exerciseMuscleMappings)
        .where(eq(exerciseMuscleMappings.id, editedMapping.id))
        .get()
    ).toMatchObject({
      weight: 0.42,
      role: 'secondary',
    });
    expect(
      fixture.database
        .select()
        .from(exerciseMuscleMappings)
        .where(
          and(
            eq(exerciseMuscleMappings.exerciseDefinitionId, exerciseId),
            eq(exerciseMuscleMappings.muscleGroupId, extraMuscleGroup.id)
          )
        )
        .get()
    ).toMatchObject({
      id: 'user-extra-mapping',
      weight: 0.33,
      role: 'stabilizer',
    });
    expect(readSeedsAppliedMarker(asLocalDatabase(fixture))).toBe(CURRENT_APP_VERSION);
  });
});
