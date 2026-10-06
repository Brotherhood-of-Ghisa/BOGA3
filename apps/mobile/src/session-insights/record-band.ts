import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';

import type { ExercisePersonalRecord, ExerciseRecordSet } from './calculations';

/**
 * One record an exercise took, or two when one set took both its 1RM and top
 * Weight: the words, and the set on the right (none for Volume). The session
 * view, View Session, the exercise page and completion all read these
 * (`training-metrics-contract.md` §3).
 */
export type RecordLine = { key: string; label: string; set: string | null; spoken: string };

const setFigures = (set: ExerciseRecordSet): string => `${formatWeight(set.weight)} × ${set.reps}`;

const oneRepMaxOf = (set: ExerciseRecordSet): string => {
  if (set.estimatedOneRepMax === null) throw new Error('a 1RM record needs its 1RM');
  return formatOneRepMax(set.estimatedOneRepMax);
};

const bandSetLine = (set: ExerciseRecordSet): RecordLine => {
  const figures = setFigures(set);
  if (set.oneRepMax && set.topWeight) {
    const value = oneRepMaxOf(set);
    return { key: set.setId, label: `New 1RM · ${value} + top weight`, set: figures, spoken: `new 1RM ${value} and top weight ${figures}` };
  }
  if (set.oneRepMax) {
    const value = oneRepMaxOf(set);
    return { key: set.setId, label: `New 1RM record · ${value}`, set: figures, spoken: `new 1RM record ${value} on ${figures}` };
  }
  return { key: set.setId, label: 'New top weight', set: figures, spoken: `new top weight ${figures}` };
};

/**
 * A card's `record` band, one line per record: those whose set is in the
 * block, and the Volume record on the exercise's first block.
 */
export const recordBandLines = (record: ExercisePersonalRecord, blockId: string): RecordLine[] => {
  const lines = record.sets.filter((set) => set.sessionExerciseId === blockId).map(bandSetLine);
  if (record.volume !== null && record.sessionExerciseId === blockId) {
    const value = formatVolume(record.volume);
    lines.push({ key: 'volume', label: `New volume record · ${value}`, set: null, spoken: `new volume record ${value}` });
  }
  return lines;
};

/** The completion's and View Session's record list: each record set's kinds, then Volume, in plain words. */
export const personalRecordLines = (record: ExercisePersonalRecord): RecordLine[] => {
  const lines = record.sets.map((set): RecordLine => {
    const figures = setFigures(set);
    const label = [set.oneRepMax ? `1RM ${oneRepMaxOf(set)}` : null, set.topWeight ? 'Top weight' : null]
      .filter(Boolean)
      .join(' · ');
    return { key: set.setId, label, set: figures, spoken: `${label.replace(' · ', ' and ')}, ${figures}` };
  });
  if (record.volume !== null) {
    const value = formatVolume(record.volume);
    lines.push({ key: 'volume', label: `Volume ${value}`, set: null, spoken: `Volume ${value}` });
  }
  return lines;
};
