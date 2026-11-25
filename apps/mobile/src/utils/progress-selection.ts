/** The visit-local bound shared by both Progress lists and their routes. */
export const MAX_PROGRESS_SELECTION = 5;

export type ExerciseReadScope =
  | { exerciseDefinitionId: string; exerciseDefinitionIds?: never }
  | { exerciseDefinitionIds: readonly string[]; exerciseDefinitionId?: never };

export const normalizeProgressSelection = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_PROGRESS_SELECTION) return null;
  if (value.some(id => typeof id !== 'string' || !id.trim())) return null;
  const ids = [...new Set((value as string[]).map(id => id.trim()))];
  return ids.length >= 2 ? ids : null;
};

/** JSON preserves ids containing punctuation without inventing a reserved separator. */
export const parseProgressSelection = (value: string | string[] | undefined): string[] | null => {
  if (Array.isArray(value) && value.length !== 1) return null;
  const encoded = Array.isArray(value) ? value[0] : value;
  if (!encoded) return null;
  try { return normalizeProgressSelection(JSON.parse(encoded)); } catch { return null; }
};

export const exerciseScopeIds = (scope: ExerciseReadScope): readonly string[] => {
  if (scope.exerciseDefinitionIds === undefined) return [scope.exerciseDefinitionId];
  const ids = normalizeProgressSelection(scope.exerciseDefinitionIds);
  if (!ids) throw new Error('Choose between 2 and 5 exercises.');
  return ids;
};
