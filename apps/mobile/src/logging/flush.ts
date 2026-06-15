import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { getSupabaseMobileClient } from '@/src/auth/supabase';
import { isDevMode } from '@/src/utils/isDevMode';

import {
  drainDroppedCount,
  peekPendingLogs,
  pushLog,
  removePendingLogs,
} from './buffer';
import { buildDropNotice, toInsertRow } from './record';
import { getLoggingUserId } from './currentUser';

const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_BATCH_SIZE = 50;

let flushing = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

/**
 * Drain buffered `warn`/`error` records to Supabase `app_logs` in one batched
 * insert. Best-effort and never throws:
 *
 *   - gated on being signed in (`getLoggingUserId()`), because the table only
 *     accepts inserts from an authenticated session — anon access stays fully
 *     revoked. Records logged before login simply wait here and flush once a
 *     session exists (auth calls this on sign-in / restore);
 *   - records are removed from the queue only after the insert succeeds, so a
 *     transient failure (offline) keeps them for the next attempt;
 *   - a single in-flight guard prevents overlapping flushes double-inserting.
 */
export const flushLogs = async (): Promise<void> => {
  if (flushing) {
    return;
  }

  if (getLoggingUserId() === null) {
    return;
  }

  const client = getSupabaseMobileClient();
  if (!client) {
    return;
  }

  flushing = true;
  try {
    const dropped = drainDroppedCount();
    if (dropped > 0) {
      pushLog(buildDropNotice(dropped));
    }

    const batch = peekPendingLogs(FLUSH_BATCH_SIZE);
    if (batch.length === 0) {
      return;
    }

    const { error } = await client.from('app_logs').insert(batch.map(toInsertRow));
    if (error) {
      throw error;
    }

    removePendingLogs(batch.length);
  } catch (error) {
    // Keep the batch queued for the next attempt; surface only in dev.
    if (isDevMode()) {
      console.warn('[logging] app log flush failed', error);
    }
  } finally {
    flushing = false;
  }
};

const handleAppStateChange = (status: AppStateStatus): void => {
  if (status === 'background' || status === 'inactive') {
    void flushLogs();
  }
};

/**
 * Start the periodic + on-background flush loop. Idempotent. Called once at
 * boot (`app/_layout.tsx`); the matching `stopLogFlushLoop` clears the interval
 * and listener so the open-handle guard stays green.
 */
export const startLogFlushLoop = (): void => {
  if (intervalHandle) {
    return;
  }

  intervalHandle = setInterval(() => {
    void flushLogs();
  }, FLUSH_INTERVAL_MS);

  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
};

export const stopLogFlushLoop = (): void => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  appStateSubscription?.remove();
  appStateSubscription = null;
};

export const __resetLogFlushForTests = (): void => {
  stopLogFlushLoop();
  flushing = false;
};
