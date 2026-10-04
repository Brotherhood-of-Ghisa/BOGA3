import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { computeStatsSummary, type StatsSummary } from '@/src/data';

export function useStatsSummary(weeks: number, revision: number, reloadExercises: () => void) {
  const [loaded, setLoaded] = useState<{ weeks: number; summary: StatsSummary } | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [errorMessage, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    reloadExercises();
    void computeStatsSummary({ periodWeeks: weeks }).then(next => {
      if (active) setLoaded({ weeks, summary: next });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unknown error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed bodyweight timeline change invalidates this read.
  }, [weeks, revision, reloadExercises]));
  // Keep the current window visible during refocus; never label another window's data as this one.
  const summary = loaded?.weeks === weeks ? loaded.summary : null;
  return { summary, isLoading, errorMessage };
}
