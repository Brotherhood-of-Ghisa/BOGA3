import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { canonicalizeWeightForReps } from '@/src/exercise-calculations/set-semantics';
import type { PastRecordsGymScope } from '@/src/preferences/model';
import type { ExerciseRecordSet } from '@/src/session-insights';
import type { BandRecord } from '@/src/session-insights/record-band';

/**
 * The gym exercise history opens on from the exercise page ([[gym.view-filter]]):
 * the session's gym when the exercise is split per gym (`ownBookGymId`) or the
 * account reads past records at the current gym; otherwise every gym. A
 * session with no gym opens on every gym. The picker changes it from there.
 */
export const exerciseHistoryOpeningGym = ({
  ownBookGymId,
  scope,
  currentGymId,
}: {
  ownBookGymId: string | null;
  scope: PastRecordsGymScope;
  currentGymId: string | null;
}): string | undefined =>
  ownBookGymId ?? (scope === 'current-gym' && currentGymId !== null ? currentGymId : undefined);

/** A performed set's figures, as its row shows them. */
const setFigures = (set: ExerciseHistorySessionEntry['sets'][number]) => {
  const weight = parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue));
  const reps = parseSetReps(set.repsValue);
  // History lists confirmed performed sets only, and those always parse.
  if (weight === null || reps === null) throw new Error(`record set ${set.setId} has no figures`);
  return { weight, reps };
};

/**
 * One history card's records as the set rows and the band read them
 * (`recordFlagsFor`, `cardRecordBand`): the stored records its session took
 * when it was completed (`ExerciseHistoryBlockRecords`). Null without one.
 */
export const historyBlockRecord = (entry: ExerciseHistorySessionEntry): BandRecord | null => {
  const records = entry.records;
  if (!records) return null;
  const sets: ExerciseRecordSet[] = [];
  for (const set of entry.sets) {
    const oneRepMax = records.oneRepMax?.setId === set.setId;
    const topWeight = records.topWeightSetId === set.setId;
    if (!oneRepMax && !topWeight) continue;
    sets.push({
      sessionExerciseId: entry.sessionExerciseId,
      setId: set.setId,
      setOrderIndex: set.orderIndex,
      ...setFigures(set),
      estimatedOneRepMax: oneRepMax ? records.oneRepMax?.valueKg ?? null : null,
      oneRepMax,
      topWeight,
    });
  }
  // The 1RM record's set first, as the live derivation orders them.
  sets.sort((left, right) => Number(right.oneRepMax) - Number(left.oneRepMax));
  return { sessionExerciseId: entry.sessionExerciseId, sets, volume: records.volumeKg };
};
