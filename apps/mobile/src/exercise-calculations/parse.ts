/**
 * The one parser for the text-typed `weight_value` / `reps_value` columns.
 * Every validity check (a performed set, an input field, a calculation) reads
 * these, so a value is valid everywhere or nowhere.
 */

/**
 * Weight is stored as text in the local schema but is logically a
 * non-negative number. The accepted shape mirrors the exercise page's
 * weight input (`components/exercise-page/set-logger.tsx`: digits with an
 * optional decimal point) so the
 * parser never accepts inputs that the UI itself would reject — for
 * example `1e3` parses as `Number` but is not a legal weight entry here.
 */
const WEIGHT_INPUT_PATTERN = /^\d*\.?\d*$/;

export const parseSetWeight = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!WEIGHT_INPUT_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

/**
 * The most reps a performed set can have ([[set.performed]]). The exercise
 * page's reps input (`components/exercise-page/set-logger.tsx`) stops at two
 * digits; imported, synced and agent-written sets stop here.
 */
export const MAX_SET_REPS = 999;

/**
 * Reps must be a positive integer no greater than `MAX_SET_REPS` to count
 * toward any of these calculations.
 */
export const parseSetReps = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_SET_REPS) return null;
  return parsed;
};
