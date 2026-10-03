import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { computeStatsSummary, type StatsSummary } from '@/src/data';

export function useStatsSummary(weeks: number, revision: number, reloadExercises: () => void) {
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setSummary(null);
    setError(null);
    reloadExercises();
    void computeStatsSummary({ periodDays: weeks * 7, periodWeeks: weeks }).then(next => {
      if (active) setSummary(next);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unknown error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed bodyweight timeline change invalidates this read.
  }, [weeks, revision, reloadExercises]));
  return { summary, isLoading, errorMessage };
}
