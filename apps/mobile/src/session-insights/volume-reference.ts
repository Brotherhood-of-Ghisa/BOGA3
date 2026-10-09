import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';

import type { ExerciseVolumeComparison } from './calculations';

/**
 * Whether a comparison can draw its distribution ([[session.volume-comparison]]):
 * a finite session Volume and enough known prior comparable sessions for
 * quartiles. Everything else is pooled by name under `Building history`, so
 * the volume card never renders an empty plot.
 */
export const hasVolumeReference = (comparison: ExerciseVolumeComparison): boolean =>
  comparison.currentVolume !== null &&
  comparison.historicalSessionCount >= MIN_HISTORY_OBSERVATIONS &&
  comparison.medianVolume !== null &&
  comparison.percentile25Volume !== null &&
  comparison.percentile75Volume !== null;

export type PartitionedVolumeComparisons = {
  /** The comparisons that get a card, in the order given. */
  comparable: ExerciseVolumeComparison[];
  /** The names pooled into one `Building history` card, in the order given. */
  buildingHistory: string[];
};

export const partitionVolumeComparisons = (
  comparisons: readonly ExerciseVolumeComparison[],
): PartitionedVolumeComparisons => {
  const comparable: ExerciseVolumeComparison[] = [];
  const buildingHistory: string[] = [];
  for (const comparison of comparisons) {
    if (hasVolumeReference(comparison)) comparable.push(comparison);
    else buildingHistory.push(comparison.exerciseName);
  }
  return { comparable, buildingHistory };
};
