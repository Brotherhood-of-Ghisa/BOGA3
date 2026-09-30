// "Add as new" (M25-T07; product E0.2) prefill: a new personal exercise that
// copies a group exercise's `ExerciseCore` (name + load mode). A group exercise
// has no muscles, and a personal exercise needs at least one, so the editor
// opens prefilled and the member confirms. When the group exercise was copied
// from a bundled standard exercise (`source_exercise_id` = `seed_<slug>`), that
// seed's muscle mappings are prefilled too.

import { SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS } from '@/src/data/exercise-catalog-seeds';
import type { LoadInputMode } from '@/src/exercise-core';

import { groupExerciseCore } from './api';
import { describeGroupLinkIncompatibility } from './link-view-model';
import type { GroupExercise } from './types';

export type AddAsNewPrefill = {
  name: string;
  loadInputMode: LoadInputMode;
  mappings: { muscleGroupId: string; weight: number; role: 'primary' | 'secondary' }[];
};

export const buildAddAsNewPrefill = (groupExercise: GroupExercise): AddAsNewPrefill => {
  const { name, loadInputMode } = groupExerciseCore(groupExercise);
  const sourceId = groupExercise.source_exercise_id;
  const mappings = sourceId
    ? SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.filter((mapping) => mapping.exerciseDefinitionId === sourceId).map(
        ({ muscleGroupId, weight, role }) => ({ muscleGroupId, weight, role }),
      )
    : [];
  return { name, loadInputMode, mappings };
};

/** Recheck the reviewed editor input before creating both the exercise and its link. */
export function requireAddAsNewCompatibility(input: { name: string; loadInputMode: LoadInputMode }, target: GroupExercise): void {
  const reason = describeGroupLinkIncompatibility({ id: '', name: input.name, deletedAt: null,
    loadInputMode: input.loadInputMode }, target);
  if (reason) throw new Error(reason);
}
