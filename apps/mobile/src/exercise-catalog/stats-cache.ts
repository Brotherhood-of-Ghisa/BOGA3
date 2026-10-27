import { useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  aggregateExerciseCatalogStats,
  exerciseCatalogStatsGymOptions,
  loadExerciseCatalogStatsRawHistory,
  withInProgressSession,
  type ExerciseCatalogStats,
  type ExerciseCatalogStatsPeriod,
  type ExerciseCatalogStatsRawHistory,
} from '@/src/data/exercise-catalog-stats';
import { getBodyWeightContextRevision } from '@/src/bodyweight/invalidation';
import { progressComparisonWindows } from '@/src/data/stats';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { historyWeekBounds } from '@/src/utils/calendar-weeks';
import type { GymScopeOption } from '@/src/utils/gym-scope-route';

import { isDevMode } from '@/src/utils/isDevMode';

import { subscribeToExerciseCatalogInvalidation } from './invalidation';

export type ExerciseCatalogStatsCacheStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ExerciseCatalogStatsCacheSnapshot = {
  status: ExerciseCatalogStatsCacheStatus;
  rawHistory: ExerciseCatalogStatsRawHistory | null;
  loadedAt: number;
  contextRevision: number;
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
  contextRevision: -1,
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
    const contextRevision = getBodyWeightContextRevision();
    const rawHistory = await loadExerciseCatalogStatsRawHistory();
    // A policy/bodyweight edit can invalidate a read already in flight.
    if (contextRevision !== getBodyWeightContextRevision()) { pendingReload = true; return; }
    setSnapshot({
      status: 'ready',
      rawHistory,
      loadedAt: Date.now(),
      contextRevision,
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

const useGymOptions = (raw: ExerciseCatalogStatsRawHistory | null): GymScopeOption[] =>
  useMemo(() => exerciseCatalogStatsGymOptions(raw ?? EMPTY_RAW_HISTORY), [raw]);

export type UseExerciseCatalogStatsResult = {
  status: ExerciseCatalogStatsCacheStatus;
  stats: ExerciseCatalogStats;
  /** The gyms the history was trained at, for the host's gym picker. */
  gymOptions: GymScopeOption[];
  rawHistory: ExerciseCatalogStatsRawHistory | null;
  lastError: string | null;
  reload: () => void;
};

export type UseExerciseCatalogComparisonResult = {
  status: ExerciseCatalogStatsCacheStatus;
  /** A successful read of the active calculation context survives warm refreshes. */
  hasSnapshot: boolean;
  /** The period in force, and the one before it ([[comparison.window]]). */
  current: ExerciseCatalogStats;
  previous: ExerciseCatalogStats;
  gymOptions: GymScopeOption[];
  lastError: string | null;
  reload: () => void;
};

/**
 * One exercise's two periods, for Progress's exercise breakdown: both windows
 * are derived from the same clock and the same loaded history, so a row's Now,
 * Prev and Change can never come from different reads. `gymId` is the one gym
 * filter, three-state (`src/utils/gym-scope-route.ts`); unset is every gym.
 */
export const useExerciseCatalogComparison = (
  weeks: number,
  gymId?: string | null
): UseExerciseCatalogComparisonResult => {
  const { values: { historyLookbackWeeks } } = useAccountLocalPreferenceState();
  const snapshot = useSyncExternalStore(
    subscribeToExerciseCatalogStats,
    getExerciseCatalogStatsSnapshot,
    getExerciseCatalogStatsSnapshot
  );

  useEffect(() => {
    void ensureExerciseCatalogStatsLoaded();
  }, []);

  // Measured to when the history loaded, like `useExerciseCatalogStats`.
  // Progress counts the workout in progress — its gym included; the catalogue
  // and pickers do not.
  const raw = useMemo(
    () => withInProgressSession(snapshot.rawHistory ?? EMPTY_RAW_HISTORY, new Date(snapshot.loadedAt)),
    [snapshot.rawHistory, snapshot.loadedAt]
  );
  const periods = useMemo(() => {
    const now = new Date(snapshot.loadedAt);
    const windows = progressComparisonWindows(weeks, now);
    const history = historyWeekBounds(historyLookbackWeeks, now);
    const historyStart = history.start;
    return {
      current: aggregateExerciseCatalogStats(raw, windows.current, now, { gymId, historyStart }),
      previous: aggregateExerciseCatalogStats(raw, windows.previous, now, { gymId, historyStart }),
    };
  }, [raw, snapshot.loadedAt, weeks, gymId, historyLookbackWeeks]);
  const gymOptions = useGymOptions(raw);

  return {
    status: snapshot.status,
    current: periods.current,
    previous: periods.previous,
    hasSnapshot: snapshot.rawHistory !== null && snapshot.contextRevision === getBodyWeightContextRevision(),
    gymOptions,
    lastError: snapshot.lastError,
    reload: refreshExerciseCatalogStats,
  };
};

/** `gymId` is the one gym filter, as `useExerciseCatalogComparison`'s. */
export const useExerciseCatalogStats = (
  period: ExerciseCatalogStatsPeriod,
  gymId?: string | null
): UseExerciseCatalogStatsResult => {
  const { values: { historyLookbackWeeks } } = useAccountLocalPreferenceState();
  const current = useSyncExternalStore(
    subscribeToExerciseCatalogStats,
    getExerciseCatalogStatsSnapshot,
    getExerciseCatalogStatsSnapshot
  );

  useEffect(() => {
    void ensureExerciseCatalogStatsLoaded();
  }, []);

  // Measured to when the history loaded. Before that there is no history, and
  // an empty history aggregates to nothing whatever the date.
  const stats = useMemo(
    () =>
      aggregateExerciseCatalogStats(current.rawHistory ?? EMPTY_RAW_HISTORY, period, new Date(current.loadedAt), { gymId, historyStart: historyWeekBounds(historyLookbackWeeks, new Date(current.loadedAt)).start }),
    [current.rawHistory, current.loadedAt, period, gymId, historyLookbackWeeks]
  );
  const gymOptions = useGymOptions(current.rawHistory);

  return {
    status: current.status,
    stats,
    gymOptions,
    rawHistory: current.rawHistory,
    lastError: current.lastError,
    reload: refreshExerciseCatalogStats,
  };
};
