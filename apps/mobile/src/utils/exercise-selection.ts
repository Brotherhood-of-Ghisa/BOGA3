/** A visit-local selection; single-exercise readers retain their existing scope. */
export const MAX_SELECTED_EXERCISES = 5;

export type ExerciseReadScope =
  | { exerciseDefinitionId: string; exerciseDefinitionIds?: never }
  | { exerciseDefinitionIds: readonly string[]; exerciseDefinitionId?: never };

export const normalizeExerciseSelection = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_SELECTED_EXERCISES) return null;
  if (value.some(id => typeof id !== 'string' || !id.trim())) return null;
  const ids = [...new Set((value as string[]).map(id => id.trim()))];
  return ids.length >= 2 ? ids : null;
};

/** JSON preserves ids containing punctuation without inventing a reserved separator. */
export const parseExerciseSelection = (value: string | string[] | undefined): string[] | null => {
  if (Array.isArray(value) && value.length !== 1) return null;
  const encoded = Array.isArray(value) ? value[0] : value;
  if (!encoded) return null;
  try { return normalizeExerciseSelection(JSON.parse(encoded)); } catch { return null; }
};

export const exerciseScopeIds = (scope: ExerciseReadScope): readonly string[] => {
  if (scope.exerciseDefinitionIds === undefined) return [scope.exerciseDefinitionId];
  const ids = normalizeExerciseSelection(scope.exerciseDefinitionIds);
  if (!ids) throw new Error('Choose between 2 and 5 exercises.');
  return ids;
};
