import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';

import type { PastRecordsGymScope } from '@/src/exercise-catalog/list-model';

import { deriveExerciseRecords, type ExerciseRecordsSummary } from './exercise-records';

export type ExerciseRecordsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; summary: ExerciseRecordsSummary };

export type LoadExerciseHistory = typeof loadExercisePerformanceHistory;

export type ExerciseRecordsGymFilter = {
  scope: PastRecordsGymScope;
  currentGymId: string | null;
};

/**
 * All-time records and the previous session for one exercise definition.
 * `excludeSessionId` leaves out a completed session being edited, so it is
 * measured against the rest of history rather than against itself.
 */
export const useExerciseRecords = (
  exerciseDefinitionId: string | null,
  load: LoadExerciseHistory = loadExercisePerformanceHistory,
  excludeSessionId: string | null = null,
  gymFilter?: ExerciseRecordsGymFilter,
  refreshKey: string | number = 0
): ExerciseRecordsState => {
  const [state, setState] = useState<ExerciseRecordsState>({
    status: 'loading',
  });

  const datedWeightRevision = useBodyWeightContextRevision();
  const filterScope = gymFilter?.scope ?? 'all';
  const filterGymId = gymFilter?.currentGymId ?? null;

  useFocusEffect(useCallback(() => {
    if (!exerciseDefinitionId) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void load({ exerciseDefinitionId, period: 'all' })
      .then((history) => {
        if (cancelled) return;
        let sessions = (history?.sessions ?? []).filter((entry) => entry.sessionId !== excludeSessionId);
        if (filterScope === 'current-gym' && filterGymId) {
          sessions = sessions.filter((entry) => entry.gymId === filterGymId);
        }
        setState({
          status: 'ready',
          summary: deriveExerciseRecords(sessions),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  // The explicit revision invalidates history after a saved-weight or load review.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludeSessionId, exerciseDefinitionId, filterGymId, filterScope, load, refreshKey, datedWeightRevision]));

  return state;
};
