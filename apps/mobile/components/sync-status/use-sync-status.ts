import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getSyncStatus, type SyncStatusSnapshot } from '@/src/sync/sync-status';

const STATUS_REFRESH_INTERVAL_MS = 5000;

/**
 * The sync-status snapshot for Settings' Data & sync card: read on focus and
 * every few seconds while in view, so a cycle that finishes meanwhile shows.
 * A failed read keeps the previous snapshot; the next tick retries.
 */
export function useSyncStatusSnapshot(
  isSignedIn: boolean,
  readStatus: () => Promise<SyncStatusSnapshot> = getSyncStatus,
): SyncStatusSnapshot | null {
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSignedIn) return;
      let live = true;
      const refresh = () => {
        readStatus().then(
          (next) => {
            if (live) setStatus(next);
          },
          () => {},
        );
      };
      refresh();
      const handle = setInterval(refresh, STATUS_REFRESH_INTERVAL_MS);
      return () => {
        live = false;
        clearInterval(handle);
      };
    }, [isSignedIn, readStatus]),
  );

  return isSignedIn ? status : null;
}
