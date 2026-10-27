import { inArray } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import {
  STANDARD_EXERCISE_DEFINITION_SEEDS,
  STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '@/src/data/exercise-catalog-seeds';
import { exerciseDefinitions, exerciseMuscleMappings, muscleGroups } from '@/src/data/schema';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';

/** History fixtures model an existing account, independent of the new-joiner bundle. */
export const seedStandardCatalogFixture = async (database?: LocalDatabase): Promise<void> => {
  const target = database ?? await bootstrapLocalDataLayer();
  target.transaction((tx) => {
    tx.insert(muscleGroups).values(SYSTEM_MUSCLE_GROUP_SEEDS).onConflictDoNothing().run();
    for (const exercise of STANDARD_EXERCISE_DEFINITION_SEEDS) {
      tx.insert(exerciseDefinitions).values(exercise)
        .onConflictDoUpdate({ target: exerciseDefinitions.id, set: exercise }).run();
    }
    tx.delete(exerciseMuscleMappings).where(inArray(exerciseMuscleMappings.exerciseDefinitionId,
      STANDARD_EXERCISE_DEFINITION_SEEDS.map((exercise) => exercise.id))).run();
    tx.insert(exerciseMuscleMappings).values(STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS).run();
  });
  invalidateExerciseCatalogCache();
};
