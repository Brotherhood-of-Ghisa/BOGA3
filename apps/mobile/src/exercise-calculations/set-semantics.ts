export type SetValueInput = {
  reps: string;
  weight: string;
};

export type SessionSetPerformanceStatus = 'planned' | 'skipped' | 'unperformed' | null;

export type SetPerformanceInput = SetValueInput & {
  performanceStatus?: SessionSetPerformanceStatus;
};

export const hasPositiveIntegerReps = (reps: string): boolean => {
  const trimmed = reps.trim();
  if (!/^\d+$/.test(trimmed)) {
    return false;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0;
};

export const canonicalizeWeightForReps = (weight: string, reps: string): string =>
  weight.trim().length === 0 && hasPositiveIntegerReps(reps) ? '0' : weight;

export const canonicalizeSetValues = <T extends SetValueInput>(set: T): T => {
  const weight = canonicalizeWeightForReps(set.weight, set.reps);
  return weight === set.weight ? set : { ...set, weight };
};

export const hasValidActualValues = (set: SetValueInput): boolean => {
  if (!hasPositiveIntegerReps(set.reps)) {
    return false;
  }

  const canonicalWeight = canonicalizeWeightForReps(set.weight, set.reps).trim();
  if (canonicalWeight.length === 0) {
    return false;
  }

  const parsedWeight = Number(canonicalWeight);
  return Number.isFinite(parsedWeight) && parsedWeight >= 0;
};

/**
 * A valid legacy row with no explicit status is confirmed. Every non-null
 * status is intentionally not performed, including planned/legacy-skipped rows.
 */
export const isConfirmedPerformedSet = (set: SetPerformanceInput): boolean =>
  hasValidActualValues(set) &&
  (set.performanceStatus === null || set.performanceStatus === undefined);

/**
 * The working-set rule over a stored effort: every set that is not a warm-up.
 * Untagged, any RIR and unrecognised stored values all count. The group
 * evaluator stores it on every set fact: changing it needs a
 * `GROUP_EVAL_RULES_VERSION` bump.
 */
export const isWorkingSetType = (setType: unknown): boolean => setType !== 'warm_up';

/**
 * The one rule for what counts toward a stat (`ux-rules.md` §5.11): a
 * confirmed performed set that is not a warm-up. A warm-up row keeps its own
 * per-set figures, but feeds no record, best, PR or baseline.
 */
export const isWorkingSet = (set: SetPerformanceInput & { setType?: unknown }): boolean =>
  isConfirmedPerformedSet(set) && isWorkingSetType(set.setType);

export const normalizeSessionSetPerformanceStatus = (
  status: string | null | undefined
): SessionSetPerformanceStatus =>
  status === 'planned' || status === 'skipped' || status === 'unperformed'
    ? status
    : null;

/**
 * Legacy blank/partial rows used null before confirmation was explicit. Mark
 * them unperformed when hydrating so later valid input cannot promote them.
 */
export const hydrateSessionSetPerformanceStatus = (
  status: string | null | undefined,
  values: SetValueInput
): SessionSetPerformanceStatus => {
  const normalized = normalizeSessionSetPerformanceStatus(status);
  if (normalized === 'skipped') {
    return 'planned';
  }
  return normalized === null && !hasValidActualValues(values) ? 'unperformed' : normalized;
};

// Compatibility name for callers that only ask whether entered values are valid.
export const isPerformedSet = hasValidActualValues;
