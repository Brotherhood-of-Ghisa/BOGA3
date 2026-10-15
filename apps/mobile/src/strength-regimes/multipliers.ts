import { estimateOneRepMax } from '@/src/exercise-calculations';
import { latentRirStates } from './likelihood';

export function rirCurveMultipliers(performedReps: number, recordedRir: number): number[] {
  if (!Number.isSafeInteger(performedReps) || performedReps <= 0) throw new Error('invalid performed reps');
  return latentRirStates(recordedRir).map(r => {
    const equivalent = performedReps + r;
    if (!Number.isSafeInteger(equivalent)) throw new Error('equivalent reps overflow');
    const multiplier = estimateOneRepMax(1, equivalent);
    if (multiplier === null || !Number.isFinite(multiplier) || multiplier <= 0) throw new Error('invalid RM multiplier');
    return multiplier;
  });
}
