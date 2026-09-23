import { useEffect, useState } from 'react';

import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';

import { deriveExerciseRecords, type ExerciseRecordsSummary } from './exercise-records';

export type ExerciseRecordsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; summary: ExerciseRecordsSummary };

export type LoadExerciseHistory = typeof loadExercisePerformanceHistory;

/** All-time records and the previous session for one exercise definition. */
export const useExerciseRecords = (
  exerciseDefinitionId: string | null,
  load: LoadExerciseHistory = loadExercisePerformanceHistory
): ExerciseRecordsState => {
  const [state, setState] = useState<ExerciseRecordsState>({
    status: 'loading',
  });

  useEffect(() => {
    if (!exerciseDefinitionId) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void load({ exerciseDefinitionId, period: 'all' })
      .then((history) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          summary: deriveExerciseRecords(history?.sessions ?? []),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [exerciseDefinitionId, load]);

  return state;
};
