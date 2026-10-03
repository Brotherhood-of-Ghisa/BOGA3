import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';

import type { PersonalRecordKind } from './calculations';

/**
 * The words announcing a session's record set (`training-metrics-contract.md`
 * §3), shared by every `record` band: the exercise page's set list, the
 * session view and View Session cards, and the completion card. `spoken` is
 * the same phrase for an accessibility label.
 */
export type RecordBand = { kind: PersonalRecordKind; label: string; spoken: string };

export type RecordBandInput = {
  kind: PersonalRecordKind;
  weight: number;
  reps: number;
  estimatedOneRepMax: number | null;
};

export const recordBand = ({ kind, weight, reps, estimatedOneRepMax }: RecordBandInput): RecordBand => {
  if (kind === 'oneRepMax') {
    if (estimatedOneRepMax === null) throw new Error('a 1RM record needs its 1RM');
    const value = formatOneRepMax(estimatedOneRepMax);
    return { kind, label: `New 1RM record · ${value}`, spoken: `new 1RM record ${value}` };
  }
  const set = `${formatWeight(weight)} × ${reps}`;
  return { kind, label: `New top weight · ${set}`, spoken: `new top weight ${set}` };
};
