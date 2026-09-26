import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  aggregateExerciseCatalogStats,
  loadExerciseCatalogStatsRawHistory,
  type ExerciseCatalogStats,
  type ExerciseCatalogStatsPeriod,
  type ExerciseCatalogStatsRawHistory,
} from '@/src/data/exercise-catalog-stats';

import { isDevMode } from '@/src/utils/isDevMode';

import { subscribeToExerciseCatalogInvalidation } from './invalidation';

export type ExerciseCatalogStatsCacheStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ExerciseCatalogStatsCacheSnapshot = {
  status: ExerciseCatalogStatsCacheStatus;
  rawHistory: ExerciseCatalogStatsRawHistory | null;
  loadedAt: number;
  lastError: string | null;
};

type Listener = () => void;

const EMPTY_RAW_HISTORY: ExerciseCatalogStatsRawHistory = {
  sessions: [],
  sessionExercises: [],
  exerciseSets: [],
};

const EMPTY_SNAPSHOT: ExerciseCatalogStatsCacheSnapshot = {
  status: 'idle',
  rawHistory: null,
  loadedAt: 0,
  lastError: null,
};

const listeners = new Set<Listener>();
let snapshot: ExerciseCatalogStatsCacheSnapshot = EMPTY_SNAPSHOT;
let inFlightReload: Promise<void> | null = null;
let pendingReload = false;
let drainPromise: Promise<void> | null = null;
let maestroNextRead: 'fail-once' | 'slow-once' | null = null;

// Dev-only fault injection for real-browser loading/error screenshots and Retry.
export const prepareExerciseHistoryReadForMaestro = async (mode: string | null): Promise<void> => {
  if (!isDevMode()) return;
  if (drainPromise) await drainPromise;
  maestroNextRead = mode === 'fail-once' || mode === 'slow-once' ? mode : null;
};

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const setSnapshot = (next: ExerciseCatalogStatsCacheSnapshot) => {
  snapshot = next;
  emit();
};

const reload = async (): Promise<void> => {
  setSnapshot({ ...snapshot, status: 'loading', lastError: null });
  try {
    const fault = maestroNextRead;
    maestroNextRead = null;
    if (fault) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (fault === 'fail-once') throw new Error('Maestro exercise history read failure');
    }
    const rawHistory = await loadExerciseCatalogStatsRawHistory();
    setSnapshot({
      status: 'ready',
      rawHistory,
      loadedAt: Date.now(),
      lastError: null,
    });
  } catch (error) {
    setSnapshot({
      ...snapshot,
      status: 'error',
      lastError:
        error instanceof Error ? error.message : 'Unable to load exercise history.',
    });
  }
};

const drain = async (): Promise<void> => {
  while (pendingReload) {
    pendingReload = false;
    inFlightReload = reload();
    try {
      await inFlightReload;
    } finally {
      inFlightReload = null;
    }
  }
};

const ensureDrain = (): Promise<void> => {
  if (drainPromise) return drainPromise;
  drainPromise = drain().finally(() => {
    drainPromise = null;
    if (pendingReload) {
      void ensureDrain();
    }
  });
  return drainPromise;
};

export const getExerciseCatalogStatsSnapshot = (): ExerciseCatalogStatsCacheSnapshot =>
  snapshot;

export const subscribeToExerciseCatalogStats = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const ensureExerciseCatalogStatsLoaded = async (): Promise<void> => {
  if (snapshot.status === 'ready') return;
  if (inFlightReload) { await ensureDrain(); return; }
  pendingReload = true;
  await ensureDrain();
};

const refreshExerciseCatalogStats = (): void => {
  // Mount and focus/visible can request the same read in one render cycle.
  if (!inFlightReload) invalidateExerciseCatalogStatsCache();
};

export const invalidateExerciseCatalogStatsCache = (): void => {
  pendingReload = true;
  void ensureDrain();
};

subscribeToExerciseCatalogInvalidation(() => {
  pendingReload = true;
  void ensureDrain();
});

export const __resetExerciseCatalogStatsCacheForTests = (): void => {
  listeners.clear();
  snapshot = EMPTY_SNAPSHOT;
  inFlightReload = null;
  pendingReload = false;
  drainPromise = null;
  maestroNextRead = null;
};

export type UseExerciseCatalogStatsResult = {
  status: ExerciseCatalogStatsCacheStatus;
  stats: ExerciseCatalogStats;
  rawHistory: ExerciseCatalogStatsRawHistory | null;
  lastError: string | null;
  reload: () => void;
};

export const useExerciseCatalogStats = (
  period: ExerciseCatalogStatsPeriod
): UseExerciseCatalogStatsResult => {
  const current = useSyncExternalStore(
    subscribeToExerciseCatalogStats,
    getExerciseCatalogStatsSnapshot,
    getExerciseCatalogStatsSnapshot
  );

  useEffect(() => {
    void ensureExerciseCatalogStatsLoaded();
  }, []);

  const stats = useMemo(
    () =>
      aggregateExerciseCatalogStats(current.rawHistory ?? EMPTY_RAW_HISTORY, period, new Date(current.loadedAt || Date.now())),
    [current.rawHistory, current.loadedAt, period]
  );

  return {
    status: current.status,
    stats,
    rawHistory: current.rawHistory,
    lastError: current.lastError,
    reload: refreshExerciseCatalogStats,
  };
};
