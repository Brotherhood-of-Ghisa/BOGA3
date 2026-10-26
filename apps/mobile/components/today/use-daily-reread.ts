import { useEffect, type RefObject } from 'react';
import { AppState } from 'react-native';

import { startOfLocalDay } from '@/src/utils/local-calendar';

/**
 * While focused, calls `read` now, at each local midnight (a new day moves
 * Today's windows) and when the app returns to the foreground; `read` changing
 * reads again. Losing focus bumps `generation`, so a read still in flight
 * knows it is stale.
 */
export function useDailyReread(
  isFocused: boolean,
  read: () => void,
  nowRef: RefObject<() => Date>,
  generation: { current: number },
) {
  useEffect(() => {
    if (!isFocused) return;
    read();
    let midnight: ReturnType<typeof setTimeout> | undefined;
    const readAtMidnight = () => {
      clearTimeout(midnight);
      const current = nowRef.current();
      midnight = setTimeout(() => {
        read();
        readAtMidnight();
      }, startOfLocalDay(current, 1).getTime() - current.getTime());
    };
    readAtMidnight();
    // A suspended app's timer may not count the time away: aim it again on return.
    const foreground = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      read();
      readAtMidnight();
    });
    return () => {
      generation.current += 1;
      foreground.remove();
      clearTimeout(midnight);
    };
  }, [isFocused, read, nowRef, generation]);
}
