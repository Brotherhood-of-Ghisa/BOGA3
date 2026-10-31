import { invalidateBodyWeightContext } from '../bodyweight/invalidation';
import { invalidateExerciseCatalogCache } from '../exercise-catalog/invalidation';

export type MuscleCountingPolicy = { countSecondarySets: boolean; countSecondaryVolume: boolean };
let policy: MuscleCountingPolicy = { countSecondarySets: false, countSecondaryVolume: true };
export const getPersonalMuscleCounting = (): MuscleCountingPolicy => policy;
export function configurePersonalMuscleCounting(next: MuscleCountingPolicy): void {
  if (next.countSecondarySets === policy.countSecondarySets && next.countSecondaryVolume === policy.countSecondaryVolume) return;
  policy = { ...next };
  invalidateExerciseCatalogCache();
  invalidateBodyWeightContext();
}
