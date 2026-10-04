import { invalidateBodyWeightContext } from '../bodyweight/invalidation';
import { invalidateExerciseCatalogCache } from '../exercise-catalog/invalidation';
import { personalLoadContext } from '../exercise-calculations/analytics';
import {
  DEFAULT_DISPLAY_EFFORTS, DEFAULT_PERSONAL_EFFORT_POLICY, effortPolicyKey, type EffortCalculationPolicy, type EffortChoice,
} from '../exercise-calculations/effort-policy';

// Durable account-local preferences publish logging and calculation snapshots here.
// Persistence adapters pass it explicitly to the pure shared kernel; groups
// and the coaching API never read this device configuration.
let policy: EffortCalculationPolicy = DEFAULT_PERSONAL_EFFORT_POLICY;
let display: readonly EffortChoice[] = DEFAULT_DISPLAY_EFFORTS;
export const getDisplayEfforts = () => display;
export const configureDisplayEfforts = (next: readonly EffortChoice[]) => { display = [...next]; };
export const getPersonalEffortPolicy = (): EffortCalculationPolicy => policy;
export const personalCalculationContext = (
  enabled: boolean,
  definition?: Parameters<typeof personalLoadContext>[1],
  session?: Parameters<typeof personalLoadContext>[2],
) => personalLoadContext(enabled, definition, session, getPersonalEffortPolicy());
export function configurePersonalEffortPolicy(next: EffortCalculationPolicy): void {
  if (effortPolicyKey(policy) === effortPolicyKey(next)) return;
  policy = { workingSetEfforts: [...next.workingSetEfforts], volumeEfforts: [...next.volumeEfforts] };
  invalidateExerciseCatalogCache();
  invalidateBodyWeightContext();
}
