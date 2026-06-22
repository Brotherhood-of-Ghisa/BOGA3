import type { BogaImportSet, BogaImportSetType, BogaSessionImportPackage } from './boga-import-contract';

const SET_TYPE_SEQUENCE_AFTER_UNCLASSIFIED: BogaImportSetType[] = ['rir_2', 'rir_1', 'rir_0'];

export const setTypeForRank = (rank: number, setCount: number): BogaImportSetType => {
  if (setCount <= 0 || rank < 0 || rank >= setCount) {
    throw new Error(`Invalid set rank ${rank} for set count ${setCount}`);
  }
  if (rank === 0) {
    return 'warm_up';
  }
  if (rank === 1) {
    return null;
  }
  return SET_TYPE_SEQUENCE_AFTER_UNCLASSIFIED[Math.min(rank - 2, SET_TYPE_SEQUENCE_AFTER_UNCLASSIFIED.length - 1)];
};

const orderKey = (set: BogaImportSet, index: number) => `${set.orderIndex}\0${index}`;

export const enrichSetTypesForExerciseSets = (sets: BogaImportSet[]): BogaImportSet[] => {
  const ranksByKey = new Map<string, number>();
  sets
    .map((set, index) => ({ set, index }))
    .sort((left, right) => left.set.orderIndex - right.set.orderIndex || left.index - right.index)
    .forEach(({ set, index }, rank) => {
      ranksByKey.set(orderKey(set, index), rank);
    });

  return sets.map((set, index) => {
    const rank = ranksByKey.get(orderKey(set, index));
    if (rank === undefined) {
      throw new Error('Internal error: missing set rank during set type enrichment');
    }
    return {
      ...set,
      setType: setTypeForRank(rank, sets.length),
    };
  });
};

export const enrichBogaImportSetTypes = (pkg: BogaSessionImportPackage): BogaSessionImportPackage => ({
  ...pkg,
  sessions: pkg.sessions.map((session) => ({
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      sets: enrichSetTypesForExerciseSets(exercise.sets),
    })),
  })),
});
