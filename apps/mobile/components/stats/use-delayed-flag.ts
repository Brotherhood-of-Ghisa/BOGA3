import { useEffect, useState } from 'react';

/**
 * True once `flag` has stayed true for `delayMs`, and false as soon as it is
 * not: a read that lands within the delay never draws its loading state.
 */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) return;
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [flag, delayMs]);
  return flag && shown;
}
