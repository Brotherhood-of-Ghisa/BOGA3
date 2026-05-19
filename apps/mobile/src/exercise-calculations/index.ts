/**
 * Pure calculation helpers for per-exercise strength metrics derived from
 * `exercise_sets` rows (or any caller-provided set-shaped input).
 *
 * Storage and stats wiring are intentionally out of scope here; this module
 * only owns the math and the parsing rules that turn the text-typed
 * `weight_value` / `reps_value` columns into trusted numerics.
 */

export type CalculationSetInput = {
  weightValue: string | null | undefined;
  repsValue: string | null | undefined;
  setType?: string | null | undefined;
};

export type ParsedCalculationSet = {
  weight: number;
  reps: number;
  setType: string | null;
};

export type CalculationOptions = {
  /** When true, warm-up sets are included. Defaults to false. */
  includeWarmUps?: boolean;
};

export type MaxRepsAtWeight = {
  weight: number;
  maxReps: number;
};

/**
 * Weight is stored as text in the local schema but is logically a
 * non-negative number. The accepted shape mirrors the UI's
 * `WEIGHT_INPUT_PATTERN` (digits with an optional decimal point) so the
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
 * Reps must be a positive integer to count toward any of these
 * calculations. Matches the UI input contract in `app/session-recorder.tsx`.
 */
export const parseSetReps = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

export const parseCalculationSet = (set: CalculationSetInput): ParsedCalculationSet | null => {
  const weight = parseSetWeight(set.weightValue);
  const reps = parseSetReps(set.repsValue);
  if (weight === null || reps === null) return null;
  return {
    weight,
    reps,
    setType: set.setType ?? null,
  };
};

const WARM_UP_SET_TYPE = 'warm_up';

const collectParsedSets = (
  sets: CalculationSetInput[],
  options: CalculationOptions | undefined
): ParsedCalculationSet[] => {
  const includeWarmUps = options?.includeWarmUps ?? false;
  const parsed: ParsedCalculationSet[] = [];
  for (const raw of sets) {
    if (!includeWarmUps && (raw.setType ?? null) === WARM_UP_SET_TYPE) continue;
    const parsedSet = parseCalculationSet(raw);
    if (parsedSet === null) continue;
    parsed.push(parsedSet);
  }
  return parsed;
};

/**
 * Wathan (1994) 1RM estimate:
 *   1RM = 100·w / (48.8 + 53.8·e^(-0.075·r))
 *
 * Chosen because it is asymptotic — it caps near ~2.05·w as reps grow
 * rather than ballooning linearly (Epley) or diverging (Brzycki at r≥37) —
 * while remaining near-exact at r=1 (1.013·w) and ranking among the most
 * accurate predictors in LeSuer et al. (1997) and Reynolds et al. (2006).
 *
 * Returns `null` when inputs are not a valid `(non-negative weight,
 * positive integer reps)` pair so callers can short-circuit cleanly.
 */
export const estimateOneRepMax = (weight: number, reps: number): number | null => {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  if (!Number.isInteger(reps) || reps <= 0) return null;
  const denominator = 48.8 + 53.8 * Math.exp(-0.075 * reps);
  return (100 * weight) / denominator;
};

export const computeSetVolume = (weight: number, reps: number): number => {
  if (!Number.isFinite(weight) || weight < 0) return 0;
  if (!Number.isInteger(reps) || reps <= 0) return 0;
  return weight * reps;
};

/**
 * Estimated 1RM for an exercise = the maximum per-set Wathan estimate
 * across the eligible sets. Returns `null` when no eligible set exists.
 */
export const estimateExerciseOneRepMax = (
  sets: CalculationSetInput[],
  options?: CalculationOptions
): number | null => {
  const parsed = collectParsedSets(sets, options);
  let best: number | null = null;
  for (const set of parsed) {
    const estimate = estimateOneRepMax(set.weight, set.reps);
    if (estimate === null) continue;
    if (best === null || estimate > best) {
      best = estimate;
    }
  }
  return best;
};

export const computeExerciseVolume = (
  sets: CalculationSetInput[],
  options?: CalculationOptions
): number => {
  const parsed = collectParsedSets(sets, options);
  let total = 0;
  for (const set of parsed) {
    total += computeSetVolume(set.weight, set.reps);
  }
  return total;
};

/**
 * For each distinct weight present in the eligible sets, the maximum
 * rep count observed at that weight. Returned sorted by weight descending
 * so callers can render a PR-style table without further sorting.
 *
 * Weight equality is the parsed numeric value, so text-distinct entries
 * like `'42.5'` and `'42.50'` collapse into a single row.
 */
export const computeMaxRepsByWeight = (
  sets: CalculationSetInput[],
  options?: CalculationOptions
): MaxRepsAtWeight[] => {
  const parsed = collectParsedSets(sets, options);
  const maxByWeight = new Map<number, number>();
  for (const set of parsed) {
    const existing = maxByWeight.get(set.weight);
    if (existing === undefined || set.reps > existing) {
      maxByWeight.set(set.weight, set.reps);
    }
  }
  return Array.from(maxByWeight, ([weight, maxReps]) => ({ weight, maxReps })).sort(
    (left, right) => right.weight - left.weight
  );
};
