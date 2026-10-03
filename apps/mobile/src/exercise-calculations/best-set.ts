// The one best-set rule for a session's estimated 1RM (spec 05, "Exercise
// session facts"): the exercise session facts derive their 1RM bests and PR
// flags with it, and the session's record set (`records.ts`) is picked over
// the same eligible sets. Only working sets compete.

import { addFiniteVolume, calculateAnalyticsSetMetrics, enteredWeightKg } from './analytics.ts';
import { summarizeVolume, type LoadContext, type SetMetrics } from './load-metrics.ts';
import { compareWeightRecord } from './records.ts';
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

export type TopWeightSet<B, S> = EligibleSessionSet<B, S> & { weight: number; reps: number };

/**
 * The set with the top Weight among sets in session order: the highest raw
 * entered kg, then more reps (`compareWeightRecord`); the first set keeps a
 * full tie.
 */
export const pickTopWeightSet = <B, S extends { weightValue: string; repsValue: string }>(
  setsInSessionOrder: readonly EligibleSessionSet<B, S>[],
): TopWeightSet<B, S> | null => {
  let best: TopWeightSet<B, S> | null = null;
  for (const eligible of setsInSessionOrder) {
    const weight = enteredWeightKg(eligible.set);
    if (weight === null) continue;
    const value = { weight, reps: eligible.metric.reps };
    if (best !== null && compareWeightRecord(value, best) <= 0) continue;
    best = { ...eligible, ...value };
  }
  return best;
};

/**
 * One session's bests for one exercise, from its blocks' working sets
 * (`eligibleSetsByBlockInSessionOrder`): the inputs of every record
 * (`records.ts`). Null when the session has no working set of it.
 */
export const summarizeSessionBests = <S extends BestSetSetInput, B extends BestSetBlockInput<S>>(
  blocks: readonly B[],
) => {
  const byBlock = eligibleSetsByBlockInSessionOrder<S, B>(blocks).filter((sets) => sets.length > 0);
  if (byBlock.length === 0) return null;
  const sets = byBlock.flat();
  let knownVolume: number | null = 0;
  let totalVolume: number | null = 0;
  // Each block sums alone, as the completed-session volume comparison does.
  for (const blockSets of byBlock) {
    const coverage = summarizeVolume(blockSets.map(({ metric }) => metric));
    knownVolume = addFiniteVolume(knownVolume, coverage.knownVolumeKgReps);
    totalVolume = addFiniteVolume(totalVolume, coverage.totalVolumeKgReps);
  }
  return {
    oneRepMax: pickBestEstimatedOneRepMaxSet(sets),
    topWeight: pickTopWeightSet(sets),
    volumeKg: totalVolume ?? knownVolume,
    volumeComplete: totalVolume !== null,
    workingSets: sets.length,
  };
};
