import { useCallback, useEffect, useRef, useState } from 'react';

import { loadTodayProgress, type TodayProgress } from '@/src/progress-summary';

export type TodayProgressLoader = (now: Date) => Promise<TodayProgress>;

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
 * deleted elsewhere shows on return. The first read shows loading; a re-read
 * keeps the figures on screen until the new ones arrive.
 */
export function useTodayProgress({ isFocused, load = loadTodayProgress, now = systemNow }: UseTodayProgressInput) {
  const [state, setState] = useState<TodayProgressState>({ status: 'loading' });
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
    return loadRef.current(nowRef.current()).then(
      (progress) => {
        if (isCurrent()) setState({ status: 'loaded', progress });
      },
      (error: unknown) => {
        if (isCurrent()) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to load progress' });
        }
      },
    );
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    return read();
  }, [read]);

  useEffect(() => {
    if (!isFocused) return;
    void read();
    return () => {
      generationRef.current += 1;
    };
  }, [isFocused, read]);

  return { state, retry };
}
