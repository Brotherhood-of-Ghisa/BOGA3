import { useCallback, useEffect, useRef, useState } from 'react';

import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { loadTodayPlan, type TodayPlan, type TodayPlanOptions } from '@/src/today-plan';

import { useDailyReread } from './use-daily-reread';

/** Reads the Plan page at `now`, against Settings' weekly target and secondary sets. */
export type TodayPlanLoader = (now: Date, options: TodayPlanOptions) => Promise<TodayPlan>;

export type TodayPlanState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; plan: TodayPlan };

export type UseTodayPlanInput = {
  isFocused: boolean;
  load?: TodayPlanLoader;
  now?: () => Date;
};

const systemNow = () => new Date();

/**
 * The Plan page's read, again on every focus, at local midnight, on return to
 * the foreground and when the weekly target or secondary-set default changes.
 * The first read shows loading; a re-read keeps the page until it lands.
 */
export function useTodayPlan({ isFocused, load = loadTodayPlan, now = systemNow }: UseTodayPlanInput) {
  const {
    accountRevision: context,
    values: { weeklyWorkingSetTarget: weeklyTarget, progressCountSecondary: countSecondary },
  } = useAccountLocalPreferenceState();
  const [result, setResult] = useState<{ context: number; state: TodayPlanState }>({ context, state: { status: 'loading' } });
  const generationRef = useRef(0);
  const loadRef = useRef(load);
  const nowRef = useRef(now);
  useEffect(() => {
    loadRef.current = load;
    nowRef.current = now;
  });

  const read = useCallback(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const isCurrent = () => generationRef.current === generation;
    return loadRef.current(nowRef.current(), { weeklyTarget, countSecondary }).then(
      (plan) => {
        if (isCurrent()) setResult({ context, state: { status: 'loaded', plan } });
      },
      (error: unknown) => {
        if (isCurrent()) {
          setResult({ context, state: { status: 'error', message: error instanceof Error ? error.message : 'Unable to load your plan' } });
        }
      },
    );
  }, [context, weeklyTarget, countSecondary]);

  const readNow = useCallback(() => {
    void read();
  }, [read]);

  const retry = useCallback(() => {
    setResult({ context, state: { status: 'loading' } });
    return read();
  }, [read, context]);

  useDailyReread(isFocused, readNow, nowRef, generationRef);

  const state: TodayPlanState = result.context === context ? result.state : { status: 'loading' };
  return { state, retry };
}
