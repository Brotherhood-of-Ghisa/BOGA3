import { exerciseScopeIds } from '@/src/utils/progress-selection';
import {
  compareExerciseHistoryOrder, loadExercisePerformanceHistory,
  type ExerciseHistorySummary, type LoadExercisePerformanceHistoryOptions,
} from './exercise-history';

/** A workload selection has no all-time bests or collective exercise identity. */
export type CombinedExerciseHistorySummary = Pick<ExerciseHistorySummary,
  'period' | 'appliedTagDefinitionId' | 'appliedGymId' | 'tagOptions' | 'gymOptions' | 'sessions'> & {
  exerciseDefinitionIds: readonly string[];
  exercises: readonly { id: string; name: string }[];
};

export type ExerciseHistoryViewSummary = ExerciseHistorySummary | CombinedExerciseHistorySummary;

export type LoadCombinedExerciseHistoryOptions = Omit<LoadExercisePerformanceHistoryOptions, 'exerciseDefinitionId'> & {
  exerciseDefinitionIds: readonly string[];
};

export const combineExerciseHistories = (summaries: ExerciseHistorySummary[]): CombinedExerciseHistorySummary => {
  const first = summaries[0];
  const tags = new Map<string, ExerciseHistorySummary['tagOptions'][number]>();
  const gyms = new Map<string | null, ExerciseHistorySummary['gymOptions'][number]>();
  for (const summary of summaries) {
    // These filter chips count listed blocks, as single-exercise History does.
    for (const tag of summary.tagOptions) {
      const previous = tags.get(tag.tagDefinitionId);
      tags.set(tag.tagDefinitionId, { ...tag, occurrenceCount: tag.occurrenceCount + (previous?.occurrenceCount ?? 0) });
    }
    for (const gym of summary.gymOptions) {
      const previous = gyms.get(gym.gymId);
      gyms.set(gym.gymId, { ...gym, occurrenceCount: gym.occurrenceCount + (previous?.occurrenceCount ?? 0) });
    }
  }
  return {
    exerciseDefinitionIds: summaries.map(summary => summary.exerciseDefinitionId),
    exercises: summaries.map(summary => ({ id: summary.exerciseDefinitionId, name: summary.exerciseName })),
    period: first.period, appliedTagDefinitionId: first.appliedTagDefinitionId, appliedGymId: first.appliedGymId,
    tagOptions: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
    gymOptions: [...gyms.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sessions: summaries.flatMap(summary => summary.sessions).sort(compareExerciseHistoryOrder),
  };
};

/** Preserve each exercise's own policy, as-of load and PR book before interleaving. */
export const loadCombinedExerciseHistory = async (options: LoadCombinedExerciseHistoryOptions): Promise<CombinedExerciseHistorySummary | null> => {
  const { exerciseDefinitionIds, ...shared } = options;
  const ids = exerciseScopeIds({ exerciseDefinitionIds });
  const now = options.now ?? new Date();
  const summaries = await Promise.all(ids.map(exerciseDefinitionId => loadExercisePerformanceHistory({ ...shared, exerciseDefinitionId, now })));
  if (summaries.some(summary => summary === null)) return null;
  return combineExerciseHistories(summaries.filter((summary): summary is ExerciseHistorySummary => summary !== null));
};
