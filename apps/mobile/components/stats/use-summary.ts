import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { computeProgressComparisons, type ProgressComparisons } from '@/src/data';

/** Refocus may keep the same snapshot; another window or policy may not. */
export function useStatsSummary(weeks: number, revision: number, reloadExercises: () => void) {
  const context = `${weeks}:${revision}`;
  const [loaded, setLoaded] = useState<{ context: string; summary: ProgressComparisons } | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ context: string; message: string } | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setFailure(null);
    setRefreshRevision(value => value + 1);
    reloadExercises();
    void computeProgressComparisons({ periodWeeks: weeks }).then(summary => {
      if (active) setLoaded({ context, summary });
    }).catch((cause: unknown) => {
      if (active) setFailure({ context, message: cause instanceof Error ? cause.message : 'Unknown error' });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Retry repeats the same context read.
  }, [weeks, context, reloadExercises, retryRevision]));
  const summary = loaded?.context === context ? loaded.summary : null;
  return { summary, isLoading: isLoading || (!summary && failure?.context !== context),
    errorMessage: failure?.context === context ? failure.message : null,
    onRetry: () => setRetryRevision(value => value + 1), refreshRevision };
}
