/**
 * Pure calculation helpers for per-exercise strength metrics derived from
 * `exercise_sets` rows (or any caller-provided set-shaped input).
 *
 * Storage and stats wiring are intentionally out of scope here; this module
 * only owns the math and the parsing rules that turn the text-typed
 * `weight_value` / `reps_value` columns into trusted numerics.
 */

import { parseSetReps, parseSetWeight } from './parse.ts';

export { parseSetReps, parseSetWeight };

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
  if (!Number.isFinite(weight) || weight < 0) return null;
  if (!Number.isInteger(reps) || reps <= 0) return null;
  if (weight === 0) return 0;
  const denominator = 48.8 + 53.8 * Math.exp(-0.075 * reps);
  return (100 * weight) / denominator;
};
