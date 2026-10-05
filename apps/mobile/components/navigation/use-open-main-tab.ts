import type { Href } from 'expo-router';
import { useCallback, useRef } from 'react';

import { mainTabDestination } from '@/src/navigation/active-session-entry';
import type { MainTabKey } from '@/src/navigation/main-tabs';

/**
 * A main-tab press handler: resolves where the tab leads (`mainTabDestination`)
 * and opens it with `open`. A press while the last one is still resolving is
 * ignored, so a double tap on Train cannot push the session view twice.
 */
export function useOpenMainTab(
  open: (href: Href) => void,
  loadActive?: () => Promise<string | null>,
): (tab: MainTabKey) => void {
  const pendingRef = useRef(false);
  return useCallback(
    (tab: MainTabKey) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      void mainTabDestination(tab, loadActive)
        .then(open)
        .finally(() => {
          pendingRef.current = false;
        });
    },
    [open, loadActive],
  );
}
