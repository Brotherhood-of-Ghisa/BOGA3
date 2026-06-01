// React binding over the single shared scheduler-state accessor. The gate (and
// later the Settings sync-status surface) subscribe through this so the UI tree
// observes the same snapshot the cycle/bootstrapper produces, without polling.

import { useSyncExternalStore } from 'react';

import {
  getSchedulerStateSnapshot,
  subscribeToSchedulerState,
  type SchedulerStateSnapshot,
} from '@/src/sync/scheduler-state';

/** Subscribes to the latest scheduler-state snapshot and re-renders on change. */
export const useSchedulerState = (): SchedulerStateSnapshot =>
  useSyncExternalStore(
    subscribeToSchedulerState,
    getSchedulerStateSnapshot,
    getSchedulerStateSnapshot,
  );
