// How a member's linked exercise maps onto a group exercise, shared by the
// mobile client and the Deno evaluator. Personal contributions are deliberately
// absent from the link/scoring context.
import { isLoadInputMode, type ExerciseCore, type LoadInputMode } from '../exercise-core/index.ts';

export type GroupLinkSource = {
  loadInputMode: string;
};
export type GroupLinkCompatibility =
  | { compatible: true; enteredWeightFactor: 0.5 | 1 | 2 }
  | { compatible: false; reason: 'load_input_mode_invalid' };

/** A distribution conversion changes entered Weight only, never bodyweight contribution. */
export function groupEnteredWeightFactor(source: LoadInputMode, target: LoadInputMode): 0.5 | 1 | 2 {
  return source === target ? 1 : source === 'per_side_load' ? 2 : 0.5;
}

/** Existing conventional links retain their explicit user-reviewed identity. */
export function checkGroupLinkCompatibility(source: GroupLinkSource, target: Pick<ExerciseCore, 'loadInputMode'>): GroupLinkCompatibility {
  if (!isLoadInputMode(source.loadInputMode) || !isLoadInputMode(target.loadInputMode)) {
    return { compatible: false, reason: 'load_input_mode_invalid' };
  }
  return { compatible: true, enteredWeightFactor: groupEnteredWeightFactor(source.loadInputMode, target.loadInputMode) };
}
