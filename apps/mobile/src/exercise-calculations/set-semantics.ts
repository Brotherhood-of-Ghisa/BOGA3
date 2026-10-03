import { parseSetReps, parseSetWeight } from './parse.ts';

export type SetValueInput = {
  reps: string;
  weight: string;
};

export type SessionSetPerformanceStatus = 'planned' | 'skipped' | 'unperformed' | null;

export type SetPerformanceInput = SetValueInput & {
  performanceStatus?: SessionSetPerformanceStatus;
};

export const hasPositiveIntegerReps = (reps: string): boolean => parseSetReps(reps) !== null;

export const canonicalizeWeightForReps = (weight: string, reps: string): string =>
  weight.trim().length === 0 && hasPositiveIntegerReps(reps) ? '0' : weight;

export const canonicalizeSetValues = <T extends SetValueInput>(set: T): T => {
  const weight = canonicalizeWeightForReps(set.weight, set.reps);
  return weight === set.weight ? set : { ...set, weight };
};

/** Valid reps and Weight under the one parser (`parse.ts`); blank Weight with valid reps is `0`. */
export const hasValidActualValues = (set: SetValueInput): boolean =>
  hasPositiveIntegerReps(set.reps) &&
  parseSetWeight(canonicalizeWeightForReps(set.weight, set.reps)) !== null;

/**
 * A valid legacy row with no explicit status is confirmed. Every non-null
 * status is intentionally not performed, including planned/legacy-skipped rows.
 */
export const isConfirmedPerformedSet = (set: SetPerformanceInput): boolean =>
  hasValidActualValues(set) &&
  (set.performanceStatus === null || set.performanceStatus === undefined);

/**
 * The effort half of the counted-set rule: every set type but a warm-up.
 * Untagged, any RIR and unrecognised stored values all count. Read it alone
 * only where performance is already settled (a stored flag, a projection of
 * performed sets); otherwise use `isWorkingSet`. The group evaluator stores it
 * on every set fact: changing it needs a `GROUP_EVAL_RULES_VERSION` bump.
 */
export const isWorkingSetType = (setType: unknown): boolean => setType !== 'warm_up';

export type WorkingSetInput = SetPerformanceInput & { setType?: unknown };

/**
 * The counted-set rule (`training-metrics-contract.md` §1): a confirmed
 * performed set that is not a warm-up. A warm-up row keeps its own per-set
 * figures, but feeds no statistic, record, best, PR or baseline.
 */
export const isWorkingSet = (set: WorkingSetInput): boolean =>
  isConfirmedPerformedSet(set) && isWorkingSetType(set.setType);

/**
 * The counted-session rule (`training-metrics-contract.md` §2): a session —
 * or one exercise or muscle within it, given only that scope's sets — counts
 * toward a statistic when it holds at least one working set.
 */
export const isCountedSession = <T>(
  sets: Iterable<T>,
  read: (set: T) => WorkingSetInput,
): boolean => {
  for (const set of sets) if (isWorkingSet(read(set))) return true;
  return false;
};

/** The sessions among `rows` that count (`isCountedSession`), by session id. */
export const countedSessionIds = <T>(
  rows: Iterable<T>,
  read: (row: T) => WorkingSetInput & { sessionId: string | null | undefined },
): Set<string> => {
  const ids = new Set<string>();
  for (const row of rows) {
    const set = read(row);
    if (set.sessionId != null && isWorkingSet(set)) ids.add(set.sessionId);
  }
  return ids;
};

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
