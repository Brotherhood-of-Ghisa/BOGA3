import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';

import { deriveExerciseRecords, type ExerciseRecordsSummary } from './exercise-records';

export type ExerciseRecordsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; summary: ExerciseRecordsSummary };

export type LoadExerciseHistory = typeof loadExercisePerformanceHistory;

/**
 * All-time records and the previous session for one exercise definition.
 * `excludeSessionId` leaves out a completed session being edited, so it is
 * measured against the rest of history rather than against itself.
 */
export const useExerciseRecords = (
  exerciseDefinitionId: string | null,
  load: LoadExerciseHistory = loadExercisePerformanceHistory,
  excludeSessionId: string | null = null,
  refreshKey: string | number = 0
): ExerciseRecordsState => {
  const [state, setState] = useState<ExerciseRecordsState>({
    status: 'loading',
  });

  useFocusEffect(useCallback(() => {
    if (!exerciseDefinitionId) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void load({ exerciseDefinitionId, period: 'all' })
      .then((history) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          summary: deriveExerciseRecords(
            (history?.sessions ?? []).filter((entry) => entry.sessionId !== excludeSessionId)
          ),
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
  }, [excludeSessionId, exerciseDefinitionId, load, refreshKey]));

  return state;
};
