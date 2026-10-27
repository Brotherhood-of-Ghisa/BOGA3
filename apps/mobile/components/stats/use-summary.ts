import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { computeProgressComparisons, type ProgressComparisons } from '@/src/data';
import { encodeGymRouteParam } from '@/src/utils/gym-scope-route';

type PeriodReads = {
  summaries: ReadonlyMap<string, ProgressComparisons>;
  failures: ReadonlyMap<string, string>;
  pending: ReadonlySet<string>;
};

const NO_READS: PeriodReads = { summaries: new Map(), failures: new Map(), pending: new Set() };

const contextKey = (weeks: number, revision: number, gymId?: string | null, countSecondary = true, historyWeeks?: number) =>
  `${weeks}:${revision}:${encodeGymRouteParam(gymId) ?? ''}${countSecondary ? '' : ':primary'}:${historyWeeks ?? ''}`;

const withEntry = <V,>(map: ReadonlyMap<string, V>, key: string, value: V) => new Map(map).set(key, value);
const withoutKey = <V,>(map: ReadonlyMap<string, V>, key: string) => {
  const next = new Map(map);
  next.delete(key);
  return next;
};
const withoutPending = (pending: ReadonlySet<string>, key: string) => {
  const next = new Set(pending);
  next.delete(key);
  return next;
};

/**
 * Both periods the chip offers, read together on focus, so switching between
 * them draws the other one at once instead of re-reading. Refocus keeps each
 * period's last snapshot until its new read lands; another window size or
 * policy revision hides it.
 */
export function useStatsSummary(weeks: number, targetWindowWeeks: number, revision: number, reloadExercises: () => void,
  { gymId, countSecondary = true, historyWeeks }: { gymId?: string | null; countSecondary?: boolean; historyWeeks?: number } = {}) {
  const [reads, setReads] = useState<PeriodReads>(NO_READS);
  const [retryRevision, setRetryRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    const periods = targetWindowWeeks === 1 ? [1] : [targetWindowWeeks, 1];
    const keys = periods.map(period => contextKey(period, revision, gymId, countSecondary, historyWeeks));
    const retainedKeys = [...keys, ...periods.map(period => contextKey(period, revision))];
    setReads(current => ({
      // Only this revision's periods survive, so an older policy never shows.
      summaries: new Map([...current.summaries].filter(([key]) => retainedKeys.includes(key))),
      failures: new Map(),
      pending: new Set(keys),
    }));
    reloadExercises();
    periods.forEach((period, index) => {
      const key = keys[index];
      void computeProgressComparisons({ periodWeeks: period, ...(gymId === undefined ? {} : { gymId }),
        ...(historyWeeks === undefined ? {} : { historyWeeks }),
        ...(countSecondary ? {} : { countSecondary }) }).then(summary => {
        if (active) setReads(current => ({ ...current, summaries: withEntry(current.summaries, key, summary),
          failures: withoutKey(current.failures, key), pending: withoutPending(current.pending, key) }));
      }).catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : 'Unknown error';
        if (active) setReads(current => ({ ...current, failures: withEntry(current.failures, key, message),
          pending: withoutPending(current.pending, key) }));
      });
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Retry repeats the same reads.
  }, [targetWindowWeeks, revision, reloadExercises, retryRevision, gymId, countSecondary, historyWeeks]));
  const key = contextKey(weeks, revision, gymId, countSecondary, historyWeeks);
  const summary = reads.summaries.get(key) ?? null;
  const errorMessage = reads.failures.get(key) ?? null;
  return { summary, isLoading: reads.pending.has(key) || (!summary && errorMessage === null),
    errorMessage, onRetry: () => setRetryRevision(value => value + 1) };
}
