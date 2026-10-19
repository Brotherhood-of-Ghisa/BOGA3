import type { ExerciseEditorPrefill } from '@/src/exercise-catalog/editor-model';
import type { ExerciseSharePayload } from './types';

export const buildSharePrefill = (payload: ExerciseSharePayload): ExerciseEditorPrefill => ({
  name: payload.name,
  loadInputMode: payload.loadInputMode,
  bodyweightContribution: payload.bodyweightContribution,
  mappings: payload.mappings.map((mapping) => ({
    muscleGroupId: mapping.muscleGroupId,
    weight: mapping.weight,
    role: mapping.role ?? 'primary',
  })),
});
