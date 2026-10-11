import { compareWeightRecord } from '@/src/exercise-calculations/records';
import { ordinaryLoadContext, summarizeExerciseLoad } from '@/src/exercise-calculations/analytics';

import {
  personalRecordCount,
  type CurrentSessionMuscleSummary,
  type ExercisePersonalRecord,
  type ExerciseVolumeComparison,
  type SessionInsightExerciseInput,
  type SessionInsightMuscleMapping,
} from './calculations';

/**
 * The completion summary card's two breakdown pages. Both are derived from
 * what the screen already loads — the muscle summary, the volume comparisons
 * and the session's records — so neither page can disagree with the figures
 * beside it.
 *
 * A record counts on its exercise's **primary** muscles only, so the muscle
 * page's record counts do not sum to the session's record count. Muscle volume
 * is `weightedVolume`, already role-weighted, so it does not sum to the
 * session's Volume either. Both are intended.
 */

export type SessionBreakdownMuscleRow = {
  id: string;
  displayName: string;
  primarySetCount: number;
  secondarySetCount: number;
  weightedSetCount: number;
  // Null when the muscle took working sets whose volume is not known.
  volume: number | null;
  recordCount: number;
};

export type SessionBreakdownExerciseRow = {
  id: string;
  exerciseDefinitionId: string | null;
  name: string;
  workingSetCount: number;
  volume: number | null;
  // The session's top working-set weight (`exercise_session_facts.top_weight_kg`).
  topWeight: number | null;
  recordCount: number;
};

const recordCountByDefinition = (personalRecords: ExercisePersonalRecord[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const record of personalRecords) {
    counts.set(
      record.exerciseDefinitionId,
      (counts.get(record.exerciseDefinitionId) ?? 0) + personalRecordCount(record)
    );
  }
  return counts;
};

/**
 * The by-muscle page: the shipped `Sets by muscle` rows, in their order, with
 * the muscle's weighted volume and its primary-muscle record count.
 */
export const buildSessionBreakdownMuscleRows = ({
  muscleSummary,
  personalRecords,
  muscleMappings,
}: {
  muscleSummary: CurrentSessionMuscleSummary | null;
  personalRecords: ExercisePersonalRecord[];
  muscleMappings: SessionInsightMuscleMapping[];
}): SessionBreakdownMuscleRow[] => {
  if (!muscleSummary) return [];

  const volumeByMuscle = new Map(muscleSummary.muscles.map((muscle) => [muscle.id, muscle.weightedVolume]));
  const recordsByDefinition = recordCountByDefinition(personalRecords);
  const recordsByMuscle = new Map<string, number>();
  for (const mapping of muscleMappings) {
    if (mapping.role !== 'primary') continue;
    const count = recordsByDefinition.get(mapping.exerciseDefinitionId);
    if (count === undefined) continue;
    recordsByMuscle.set(mapping.muscleGroupId, (recordsByMuscle.get(mapping.muscleGroupId) ?? 0) + count);
  }

  return muscleSummary.workingSetsByMuscle.map((muscle) => ({
    id: muscle.id,
    displayName: muscle.displayName,
    primarySetCount: muscle.primarySetCount,
    secondarySetCount: muscle.secondarySetCount,
    weightedSetCount: muscle.weightedSetCount,
    volume: volumeByMuscle.get(muscle.id) ?? null,
    recordCount: recordsByMuscle.get(muscle.id) ?? 0,
  }));
};

// The heaviest working set across an exercise's blocks, each block weighed
// under its own load context, ordered by the Weight record's rule.
const topWeightOf = (
  sessionExerciseIds: string[],
  exerciseById: ReadonlyMap<string, SessionInsightExerciseInput>
): number | null => {
  let best: { weight: number; reps: number } | null = null;
  for (const sessionExerciseId of sessionExerciseIds) {
    const exercise = exerciseById.get(sessionExerciseId);
    if (!exercise) continue;
    const { topWeightSet } = summarizeExerciseLoad(exercise.sets, exercise.loadContext ?? ordinaryLoadContext());
    if (topWeightSet !== null && (best === null || compareWeightRecord(topWeightSet, best) > 0)) {
      best = topWeightSet;
    }
  }
  return best?.weight ?? null;
};

/**
 * The by-exercise page: one row per volume comparison, in session order, so
 * the sets and volume are the same figures the comparison cards below show.
 */
export const buildSessionBreakdownExerciseRows = ({
  comparisons,
  exercises,
  personalRecords,
}: {
  comparisons: ExerciseVolumeComparison[];
  exercises: SessionInsightExerciseInput[];
  personalRecords: ExercisePersonalRecord[];
}): SessionBreakdownExerciseRow[] => {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const recordsByDefinition = recordCountByDefinition(personalRecords);

  return comparisons.map((comparison) => ({
    id: comparison.sessionExerciseIds[0] ?? comparison.exerciseName,
    exerciseDefinitionId: comparison.exerciseDefinitionId,
    name: comparison.exerciseName,
    workingSetCount: comparison.workingSetCount,
    volume: comparison.currentVolume,
    topWeight: topWeightOf(comparison.sessionExerciseIds, exerciseById),
    recordCount:
      comparison.exerciseDefinitionId === null
        ? 0
        : recordsByDefinition.get(comparison.exerciseDefinitionId) ?? 0,
  }));
};
