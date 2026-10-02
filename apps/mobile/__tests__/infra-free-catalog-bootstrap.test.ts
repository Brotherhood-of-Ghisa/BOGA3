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
    expect(readSeedsAppliedMarker(asLocalDatabase(fixture))).toBe(CURRENT_APP_VERSION);
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
