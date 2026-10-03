// The one best-set rule for a session's estimated 1RM (spec 05, "Exercise
// session facts"): the exercise session facts derive their 1RM bests and PR
// flags with it, and the session view and completed-session detail pick
// their PR set on an in-memory session with it. Only working sets compete.

import { calculateAnalyticsSetMetrics } from './analytics.ts';
import type { LoadContext, SetMetrics } from './load-metrics.ts';
import { isWorkingSet, type SessionSetPerformanceStatus } from './set-semantics.ts';

type Ordered = { orderIndex: number; id: string };

export type BestSetSetInput = Ordered & {
  weightValue: string;
  repsValue: string;
  setType: string | null;
  performanceStatus?: SessionSetPerformanceStatus;
  deletedAt?: Date | null;
};

/** One block of a definition in a session, with the load context its sets are calculated under. */
export type BestSetBlockInput<S extends BestSetSetInput> = Ordered & {
  loadContext: LoadContext;
  sets: readonly S[];
};

export type EligibleSessionSet<B, S> = {
  block: B;
  set: S;
  metric: Extract<SetMetrics, { eligible: true }>;
};

/** Session order: block, then set; ids break position ties. */
export const compareSessionPosition = (left: Ordered, right: Ordered): number =>
  left.orderIndex - right.orderIndex || left.id.localeCompare(right.id);

/** Each block's non-deleted working sets with their metrics, blocks and sets in session order. */
export const eligibleSetsByBlockInSessionOrder = <S extends BestSetSetInput, B extends BestSetBlockInput<S>>(
  blocks: readonly B[],
): EligibleSessionSet<B, S>[][] =>
  [...blocks].sort(compareSessionPosition).map((block) =>
    [...block.sets].sort(compareSessionPosition).flatMap((set) => {
      if ((set.deletedAt ?? null) !== null) return [];
      if (!isWorkingSet({
        weight: set.weightValue, reps: set.repsValue, performanceStatus: set.performanceStatus, setType: set.setType,
      })) return [];
      const metric = calculateAnalyticsSetMetrics({ ...set, ...block.loadContext });
      return metric.eligible ? [{ block, set, metric }] : [];
    }),
  );

export type BestEstimatedOneRepMaxSet<B, S> = EligibleSessionSet<B, S> & {
  estimatedOneRepMaxKg: number;
  enteredWeightKg: number;
};

/**
 * The set with the highest estimated 1RM among sets given in session order.
 * Strictly greater wins, so the first set in session order keeps a tie.
 */
export const pickBestEstimatedOneRepMaxSet = <B, S>(
  setsInSessionOrder: readonly EligibleSessionSet<B, S>[],
): BestEstimatedOneRepMaxSet<B, S> | null => {
  let best: BestEstimatedOneRepMaxSet<B, S> | null = null;
  for (const eligible of setsInSessionOrder) {
    const { estimatedOneRepMaxKg: value, load } = eligible.metric;
    // A 1RM exists only on a known load; the status check narrows the type.
    if (value === null || load.status !== 'known') continue;
    if (best !== null && value <= best.estimatedOneRepMaxKg) continue;
    best = { ...eligible, estimatedOneRepMaxKg: value, enteredWeightKg: load.enteredWeightKg };
  }
  return best;
};
