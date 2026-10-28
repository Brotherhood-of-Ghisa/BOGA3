import { AppState } from 'react-native';

import { startOfLocalDay } from '@/src/utils/local-calendar';

/** Calendar predicate for [[appearance.november]]. */
export const isNovember = (date = new Date()): boolean => date.getMonth() === 10;

/** Re-aim at local midnight after resume, including a changed device time zone. */
export function watchNovemberAppearance(refresh: (november: boolean) => void): () => void {
  let midnight: ReturnType<typeof setTimeout> | undefined;
  function reread() {
    clearTimeout(midnight);
    if (AppState.currentState !== 'active') return;
    const now = new Date();
    refresh(isNovember(now));
    midnight = setTimeout(reread, startOfLocalDay(now, 1).getTime() - now.getTime());
  }
  const subscription = AppState.addEventListener('change', reread);
  reread();
  return () => {
    subscription.remove();
    clearTimeout(midnight);
  };
}
