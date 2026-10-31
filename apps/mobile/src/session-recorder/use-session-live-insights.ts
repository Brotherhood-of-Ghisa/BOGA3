import { useMemo } from 'react';

import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import {
  deriveSessionExerciseVolumeComparisons,
  deriveSessionMuscleVolumeComparisons,
  sessionMuscleCatalogOfExercises,
  type ExerciseVolumeComparison,
} from '@/src/session-insights';
import { toSessionInsightExercises } from '@/src/session-recorder/session-model';
import type { SessionViewState } from '@/src/session-recorder/use-session-view';

export type SessionLiveInsights = {
  exercise: ExerciseVolumeComparison[];
  muscle: ExerciseVolumeComparison[];
};

/**
 * The open session's volume set against the user's history, by exercise and
 * by muscle, as if it were completed now (`useSessionView`'s comparison
 * point). The muscle grouping waits for the exercise catalog;
 * `muscleCatalogState` says how far it got.
 */
export function useSessionLiveInsights(sessionId: string | null, state: SessionViewState) {
  const exerciseCatalog = useExerciseCatalog();
  const { values: musclePreferences } = useAccountLocalPreferenceState();

  const insights = useMemo((): SessionLiveInsights | null => {
    if (state.status !== 'ready' || !sessionId) return null;
    const targetSession = {
      sessionId,
      status: 'completed' as const,
      completedAt: state.data.comparisonAt,
      bodyWeightKg: state.data.bodyWeightKg,
      exercises: toSessionInsightExercises(state.data.session, new Map()),
    };
    const base = { targetSession, historicalSessions: state.data.insightHistory };
    return {
      exercise: deriveSessionExerciseVolumeComparisons(base),
      muscle:
        exerciseCatalog.status === 'ready'
          ? deriveSessionMuscleVolumeComparisons({
              ...base,
              ...sessionMuscleCatalogOfExercises(
                exerciseCatalog.exercises, exerciseCatalog.muscleGroups, exerciseCatalog.muscleSetup.assignment,
              ),
            })
          : [],
    };
  }, [exerciseCatalog.exercises, exerciseCatalog.muscleGroups, exerciseCatalog.muscleSetup, exerciseCatalog.status,
    musclePreferences.progressCountSecondary, musclePreferences.muscleVolumePrimaryOnly, sessionId, state]);

  const muscleCatalogState = exerciseCatalog.status === 'idle' ? 'loading' : exerciseCatalog.status;
  return { insights, muscleCatalogState };
}
