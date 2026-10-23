import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { loadTodayProgress, type TodayProgress } from '@/src/progress-summary';
import { startOfLocalDay } from '@/src/utils/local-calendar';

/** Reads Today's figures at `now`, the period being Settings' Progress period in weeks. */
export type TodayProgressLoader = (now: Date, periodWeeks: number) => Promise<TodayProgress>;

export type TodayProgressState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; progress: TodayProgress };

export type UseTodayProgressInput = {
  isFocused: boolean;
  load?: TodayProgressLoader;
  now?: () => Date;
};

const systemNow = () => new Date();

/**
 * Today's progress read, again on every focus: a session finished, edited or
 * deleted elsewhere shows on return. While focused it reads again when the
 * app returns to the foreground and at local midnight, so a new day moves the
 * windows, and when the Progress period changes. The first read shows
 * loading; a re-read keeps the figures on screen until the new ones arrive.
 */
export function useTodayProgress({ isFocused, load = loadTodayProgress, now = systemNow }: UseTodayProgressInput) {
  const { accountRevision: context, values: { targetWindowWeeks: periodWeeks } } = useAccountLocalPreferenceState();
  const [result, setResult] = useState<{ context: number; state: TodayProgressState }>({ context, state: { status: 'loading' } });
  const generationRef = useRef(0);
  // Read through refs, so a caller's inline loader or clock never re-triggers the focus read.
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
    return loadRef.current(nowRef.current(), periodWeeks).then(
      (progress) => {
        if (isCurrent()) setResult({ context, state: { status: 'loaded', progress } });
      },
      (error: unknown) => {
        if (isCurrent()) {
          setResult({ context, state: { status: 'error', message: error instanceof Error ? error.message : 'Unable to load progress' } });
        }
      },
    );
  }, [context, periodWeeks]);

  const retry = useCallback(() => {
    setResult({ context, state: { status: 'loading' } });
    return read();
  }, [read, context]);

  useEffect(() => {
    if (!isFocused) return;
    void read();
    const foreground = AppState.addEventListener('change', (next) => {
      if (next === 'active') void read();
    });
    let midnight: ReturnType<typeof setTimeout> | undefined;
    const readAtMidnight = () => {
      const current = nowRef.current();
      midnight = setTimeout(() => {
        void read();
        readAtMidnight();
      }, startOfLocalDay(current, 1).getTime() - current.getTime());
    };
    readAtMidnight();
    return () => {
      generationRef.current += 1;
      foreground.remove();
      clearTimeout(midnight);
    };
  }, [isFocused, read]);

  const state: TodayProgressState = result.context === context ? result.state : { status: 'loading' };
  return { state, retry };
}
