import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Vibration } from 'react-native';

import {
  DEFAULT_REPEATING_TIMER_INTERVAL_SECONDS,
  DEFAULT_REST_TIMER_SECONDS,
  MAX_REPEATING_TIMER_INTERVAL_SECONDS,
  MIN_REPEATING_TIMER_INTERVAL_SECONDS,
} from '../preferences/model';
import { playRepeatingTimerCue, prepareRepeatingTimerAudio, setRepeatingTimerAwake, stopRepeatingTimerAudio } from './repeating-timer-native';

export const REST_TIMER_STEP_SEC = 15;
export const REPEATING_TIMER_STEP_SEC = 15;
export const REPEATING_TIMER_PREPARATION_SEC = 15;

export type TimerMode = 'rest' | 'repeating';

export type RestTimerEntry = {
  mode: 'rest';
  sessionId: string;
  startedAtMs: number;
  endsAtMs: number;
  durationSec: number;
};

export type RepeatingTimerEntry = {
  mode: 'repeating';
  sessionId: string;
  startedAtMs: number;
  accumulatedMs: number;
  pausedAtMs: number | null;
  intervalSec: number;
};

export type WorkoutTimerEntry = RestTimerEntry | RepeatingTimerEntry;

export type RestTimerModeView = {
  mode: 'rest';
  status: 'running' | 'completed';
  sessionId: string;
  remainingSec: number;
  formatted: string;
  durationSec: number;
};

export type RepeatingTimerModeView = {
  mode: 'repeating';
  status: 'preparing' | 'running' | 'paused';
  sessionId: string;
  round: number;
  remainingSec: number;
  formatted: string;
  intervalSec: number;
  isPaused: boolean;
};

export type RestTimerView =
  | { status: 'idle'; mode?: TimerMode }
  | RestTimerModeView
  | RepeatingTimerModeView;

const IDLE_REST_TIMER_VIEW: RestTimerView = { status: 'idle' };

let activeEntry: WorkoutTimerEntry | null = null;
let lastSignaledRound: number | null = null;
let lastSignaledRestEndsAtMs: number | null = null;
let roundBoundaryTimeout: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let isForeground = false;
let cueGeneration = 0;
let restCompletionTimeout: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const suppressedAutoStartSessionIds = new Set<string>();

export const isRestTimerAutoStartSuppressed = (sessionId: string): boolean => {
  return suppressedAutoStartSessionIds.has(sessionId);
};

export const clearRestTimerAutoStartSuppression = (sessionId?: string): void => {
  if (sessionId !== undefined) {
    suppressedAutoStartSessionIds.delete(sessionId);
  } else {
    suppressedAutoStartSessionIds.clear();
  }
};

const emit = () => {
  updateRepeatingTimerResources();
  scheduleRoundBoundaryCue();
  scheduleRestCompletionCue();
  for (const listener of listeners) {
    listener();
  }
};

export const formatRestTimerSeconds = (seconds: number): string => {
  const clamped = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

export const triggerRoundBoundaryCue = (): void => {
  try {
    Vibration.vibrate(400);
  } catch {
    // Unsupported platform or headless runner.
  }
};

export const triggerRestCompletionCue = (): void => {
  try {
    Vibration.vibrate(400);
  } catch {
    // Unsupported platform or headless runner.
  }
};

export const checkAndTriggerRestCompletion = (
  entry: WorkoutTimerEntry | null,
  nowMs: number = Date.now(),
): void => {
  if (!entry || entry.mode !== 'rest') return;
  if (nowMs >= entry.endsAtMs) {
    if (lastSignaledRestEndsAtMs !== entry.endsAtMs) {
      lastSignaledRestEndsAtMs = entry.endsAtMs;
      triggerRestCompletionCue();
    }
  }
};

export const checkAndTriggerRoundBoundary = (round: number): void => {
  if (round <= 0) return;
  if (lastSignaledRound === null) {
    lastSignaledRound = round;
    return;
  }
  if (round > lastSignaledRound) {
    lastSignaledRound = round;
    triggerRoundBoundaryCue();
  }
};

export const deriveRepeatingTimerView = (
  entry: RepeatingTimerEntry,
  sessionId: string,
  nowMs: number = Date.now(),
): RepeatingTimerModeView => {
  const isPaused = entry.pausedAtMs !== null;
  const totalElapsedMs = isPaused
    ? entry.accumulatedMs
    : Math.max(0, nowMs - entry.startedAtMs + entry.accumulatedMs);
  const elapsedMs = totalElapsedMs - REPEATING_TIMER_PREPARATION_SEC * 1000;
  const isPreparing = elapsedMs < 0;
  const intervalMs = Math.max(1, entry.intervalSec) * 1000;
  const round = isPreparing ? 0 : Math.floor(elapsedMs / intervalMs) + 1;
  const roundElapsedMs = elapsedMs % intervalMs;
  const remainingMs = isPreparing ? -elapsedMs : intervalMs - roundElapsedMs;
  const remainingSec = Math.max(1, Math.ceil(remainingMs / 1000));

  return {
    mode: 'repeating',
    status: isPaused ? 'paused' : isPreparing ? 'preparing' : 'running',
    sessionId,
    round,
    remainingSec,
    formatted: formatRestTimerSeconds(remainingSec),
    intervalSec: entry.intervalSec,
    isPaused,
  };
};

// The store owns native resources across both hosts, including after a view unmounts.
function updateRepeatingTimerResources(): void {
  if (activeEntry?.mode !== 'repeating' && !appStateSubscription) return;
  stopRepeatingTimerAudio();
  if (activeEntry?.mode === 'repeating') {
    if (!appStateSubscription) {
      // Unknown initial state waits for an active event rather than retaining foreground resources.
      isForeground = AppState.currentState === 'active';
      appStateSubscription = AppState.addEventListener('change', (state) => {
        isForeground = state === 'active';
        stopRepeatingTimerAudio();
        setRepeatingTimerAwake(isForeground && activeEntry?.mode === 'repeating' && activeEntry.pausedAtMs === null);
        scheduleRoundBoundaryCue();
        for (const listener of listeners) listener();
      });
    }
    prepareRepeatingTimerAudio();
  } else {
    appStateSubscription?.remove();
    appStateSubscription = null;
  }
  setRepeatingTimerAwake(isForeground && activeEntry?.mode === 'repeating' && activeEntry.pausedAtMs === null);
}

function scheduleRoundBoundaryCue(): void {
  const token = ++cueGeneration;
  if (roundBoundaryTimeout !== null) clearTimeout(roundBoundaryTimeout);
  roundBoundaryTimeout = null;
  if (!isForeground || !activeEntry || activeEntry.mode !== 'repeating' || activeEntry.pausedAtMs !== null) return;

  const nowMs = Date.now();
  const totalElapsedMs = Math.max(0, nowMs - activeEntry.startedAtMs + activeEntry.accumulatedMs);
  const preparationMs = REPEATING_TIMER_PREPARATION_SEC * 1000;
  const intervalMs = activeEntry.intervalSec * 1000;
  const boundaryMs = totalElapsedMs < preparationMs ? preparationMs
    : preparationMs + (Math.floor((totalElapsedMs - preparationMs) / intervalMs) + 1) * intervalMs;
  const warningMs = boundaryMs - 5_000;
  const nextCueMs = totalElapsedMs < warningMs ? warningMs
    : Math.min(boundaryMs, warningMs + (Math.floor((totalElapsedMs - warningMs) / 1_000) + 1) * 1_000);
  const targetMs = nowMs + nextCueMs - totalElapsedMs;
  const kind = nextCueMs === boundaryMs ? 'long' : 'short';
  roundBoundaryTimeout = setTimeout(() => {
    if (token !== cueGeneration) return;
    if (Date.now() - targetMs <= 250) {
      playRepeatingTimerCue(kind, targetMs);
      if (kind === 'long' && activeEntry?.mode === 'repeating') {
        checkAndTriggerRoundBoundary(deriveRepeatingTimerView(activeEntry, activeEntry.sessionId).round);
      }
    }
    scheduleRoundBoundaryCue();
  }, targetMs - nowMs);
}

function scheduleRestCompletionCue(): void {
  if (restCompletionTimeout !== null) {
    clearTimeout(restCompletionTimeout);
    restCompletionTimeout = null;
  }
  if (!activeEntry || activeEntry.mode !== 'rest') {
    lastSignaledRestEndsAtMs = null;
    return;
  }

  const targetEndsAtMs = activeEntry.endsAtMs;
  const remainingMs = Math.max(0, targetEndsAtMs - Date.now());
  if (remainingMs <= 0) {
    checkAndTriggerRestCompletion(activeEntry, Date.now());
    return;
  }

  restCompletionTimeout = setTimeout(() => {
    if (activeEntry?.mode === 'rest' && activeEntry.endsAtMs === targetEndsAtMs) {
      checkAndTriggerRestCompletion(activeEntry, targetEndsAtMs);
      for (const listener of listeners) {
        listener();
      }
    }
  }, remainingMs);
}

export const deriveRestTimerView = (
  entry: WorkoutTimerEntry | null,
  sessionId: string | null,
  nowMs: number = Date.now(),
): RestTimerView => {
  if (!entry || !sessionId || entry.sessionId !== sessionId) {
    return IDLE_REST_TIMER_VIEW;
  }
  if (entry.mode === 'repeating') {
    return deriveRepeatingTimerView(entry, sessionId, nowMs);
  }
  const remainingMs = Math.max(0, entry.endsAtMs - nowMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  if (remainingSec <= 0) {
    return {
      mode: 'rest',
      status: 'completed',
      sessionId: entry.sessionId,
      remainingSec: 0,
      formatted: '0:00',
      durationSec: entry.durationSec,
    };
  }
  return {
    mode: 'rest',
    status: 'running',
    sessionId: entry.sessionId,
    remainingSec,
    formatted: formatRestTimerSeconds(remainingSec),
    durationSec: entry.durationSec,
  };
};

export const getRestTimerEntry = (): WorkoutTimerEntry | null => activeEntry;

export const subscribeRestTimer = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const startRestTimer = (
  sessionId: string,
  durationSec: number,
  nowMs: number = Date.now(),
): void => {
  const normalizedDuration = Math.max(1, Math.round(durationSec));
  if (!sessionId || !Number.isFinite(normalizedDuration)) return;
  suppressedAutoStartSessionIds.delete(sessionId);
  activeEntry = {
    mode: 'rest',
    sessionId,
    startedAtMs: nowMs,
    endsAtMs: nowMs + normalizedDuration * 1000,
    durationSec: normalizedDuration,
  };
  lastSignaledRound = null;
  lastSignaledRestEndsAtMs = null;
  emit();
};

export const adjustRestTimer = (
  sessionId: string,
  deltaSec: number,
  nowMs: number = Date.now(),
): void => {
  if (
    !activeEntry ||
    activeEntry.sessionId !== sessionId ||
    activeEntry.mode !== 'rest' ||
    !Number.isFinite(deltaSec)
  ) {
    return;
  }
  const currentRemainingMs = Math.max(0, activeEntry.endsAtMs - nowMs);
  const nextRemainingMs = Math.max(0, currentRemainingMs + Math.round(deltaSec * 1000));
  activeEntry = {
    ...activeEntry,
    endsAtMs: nowMs + nextRemainingMs,
  };
  emit();
};

export const restartRestTimer = (
  sessionId: string,
  durationSec?: number,
  nowMs: number = Date.now(),
): void => {
  const targetDuration =
    durationSec ??
    (activeEntry?.sessionId === sessionId && activeEntry.mode === 'rest'
      ? activeEntry.durationSec
      : DEFAULT_REST_TIMER_SECONDS);
  startRestTimer(sessionId, targetDuration, nowMs);
};

export const startRepeatingTimer = (
  sessionId: string,
  intervalSec: number = DEFAULT_REPEATING_TIMER_INTERVAL_SECONDS,
  nowMs: number = Date.now(),
): void => {
  if (!sessionId || !Number.isFinite(intervalSec)) return;
  suppressedAutoStartSessionIds.delete(sessionId);
  const clampedInterval = Math.max(
    MIN_REPEATING_TIMER_INTERVAL_SECONDS,
    Math.min(MAX_REPEATING_TIMER_INTERVAL_SECONDS, Math.round(intervalSec)),
  );
  if (
    activeEntry &&
    activeEntry.sessionId === sessionId &&
    activeEntry.mode === 'repeating' &&
    activeEntry.pausedAtMs !== null
  ) {
    activeEntry = {
      ...activeEntry,
      startedAtMs: nowMs,
      pausedAtMs: null,
    };
    emit();
    return;
  }
  activeEntry = {
    mode: 'repeating',
    sessionId,
    startedAtMs: nowMs,
    accumulatedMs: 0,
    pausedAtMs: null,
    intervalSec: clampedInterval,
  };
  lastSignaledRound = 0;
  emit();
};

export const stopRepeatingTimer = (
  sessionId: string,
  nowMs: number = Date.now(),
): void => {
  if (
    !activeEntry ||
    activeEntry.sessionId !== sessionId ||
    activeEntry.mode !== 'repeating' ||
    activeEntry.pausedAtMs !== null
  ) {
    return;
  }
  const elapsedSegment = Math.max(0, nowMs - activeEntry.startedAtMs);
  activeEntry = {
    ...activeEntry,
    accumulatedMs: activeEntry.accumulatedMs + elapsedSegment,
    pausedAtMs: nowMs,
  };
  emit();
};

export const toggleRepeatingTimer = (
  sessionId: string,
  nowMs: number = Date.now(),
): void => {
  if (!activeEntry || activeEntry.sessionId !== sessionId || activeEntry.mode !== 'repeating') {
    startRepeatingTimer(sessionId, DEFAULT_REPEATING_TIMER_INTERVAL_SECONDS, nowMs);
    return;
  }
  if (activeEntry.pausedAtMs !== null) {
    startRepeatingTimer(sessionId, activeEntry.intervalSec, nowMs);
  } else {
    stopRepeatingTimer(sessionId, nowMs);
  }
};

export const resetRepeatingTimer = (
  sessionId: string,
  nowMs: number = Date.now(),
): void => {
  if (!activeEntry || activeEntry.sessionId !== sessionId || activeEntry.mode !== 'repeating') {
    return;
  }
  const isPaused = activeEntry.pausedAtMs !== null;
  activeEntry = {
    ...activeEntry,
    startedAtMs: nowMs,
    accumulatedMs: 0,
    pausedAtMs: isPaused ? nowMs : null,
  };
  lastSignaledRound = 0;
  emit();
};

export const adjustRepeatingTimer = (
  sessionId: string,
  deltaSec: number,
  nowMs: number = Date.now(),
): void => {
  if (
    !activeEntry ||
    activeEntry.sessionId !== sessionId ||
    activeEntry.mode !== 'repeating' ||
    !Number.isFinite(deltaSec)
  ) {
    return;
  }
  const nextInterval = Math.max(
    MIN_REPEATING_TIMER_INTERVAL_SECONDS,
    Math.min(MAX_REPEATING_TIMER_INTERVAL_SECONDS, activeEntry.intervalSec + Math.round(deltaSec)),
  );
  if (nextInterval === activeEntry.intervalSec) return;
  const isPaused = activeEntry.pausedAtMs !== null;
  activeEntry = {
    ...activeEntry,
    intervalSec: nextInterval,
    startedAtMs: nowMs,
    accumulatedMs: 0,
    pausedAtMs: isPaused ? nowMs : null,
  };
  lastSignaledRound = 0;
  emit();
};

export const switchTimerMode = (
  sessionId: string,
  targetMode: TimerMode,
  options: {
    restDurationSec?: number;
    repeatingIntervalSec?: number;
    nowMs?: number;
  } = {},
): void => {
  const nowMs = options.nowMs ?? Date.now();
  if (targetMode === 'repeating') {
    if (activeEntry?.sessionId === sessionId && activeEntry.mode === 'repeating') return;
    const interval = options.repeatingIntervalSec ?? DEFAULT_REPEATING_TIMER_INTERVAL_SECONDS;
    startRepeatingTimer(sessionId, interval, nowMs);
  } else {
    if (activeEntry?.sessionId === sessionId && activeEntry.mode === 'rest') return;
    const duration = options.restDurationSec ?? DEFAULT_REST_TIMER_SECONDS;
    startRestTimer(sessionId, duration, nowMs);
  }
};

export const dismissRestTimer = (
  sessionId?: string,
  options: { suppressAutoStart?: boolean } = {},
): void => {
  const { suppressAutoStart = true } = options;
  if (sessionId !== undefined && suppressAutoStart) {
    suppressedAutoStartSessionIds.add(sessionId);
  }
  if (!activeEntry) return;
  if (sessionId !== undefined && activeEntry.sessionId !== sessionId) return;
  activeEntry = null;
  lastSignaledRound = null;
  lastSignaledRestEndsAtMs = null;
  emit();
};

export const __resetRestTimerForTests = (): void => {
  activeEntry = null;
  lastSignaledRound = null;
  lastSignaledRestEndsAtMs = null;
  suppressedAutoStartSessionIds.clear();
  updateRepeatingTimerResources();
  scheduleRoundBoundaryCue();
  scheduleRestCompletionCue();
  listeners.clear();
};

const systemNowMs = () => Date.now();

export type UseSessionRestTimerOptions = {
  defaultDurationSec?: number;
  defaultRepeatingIntervalSec?: number;
  autoStart?: boolean;
  isActiveSession?: boolean;
  now?: () => number;
};

export function useSessionRestTimer(
  sessionId: string | null,
  options: UseSessionRestTimerOptions = {},
) {
  const {
    defaultDurationSec = DEFAULT_REST_TIMER_SECONDS,
    defaultRepeatingIntervalSec = DEFAULT_REPEATING_TIMER_INTERVAL_SECONDS,
    autoStart = true,
    isActiveSession = true,
    now = systemNowMs,
  } = options;

  const entry = useSyncExternalStore(subscribeRestTimer, getRestTimerEntry, getRestTimerEntry);
  const view = isActiveSession ? deriveRestTimerView(entry, sessionId, now()) : IDLE_REST_TIMER_VIEW;
  const timerKey =
    entry && entry.sessionId === sessionId
      ? entry.mode === 'repeating'
        ? `repeating:${entry.intervalSec}:${entry.startedAtMs}:${entry.accumulatedMs}:${entry.pausedAtMs}`
        : `rest:${entry.startedAtMs}:${entry.endsAtMs}`
      : null;

  const initialRemaining = view.status === 'idle' ? -1 : view.remainingSec;
  const initialRound = view.status !== 'idle' && view.mode === 'repeating' ? view.round : -1;
  const [observed, setObserved] = useState({
    timerKey,
    remainingSec: initialRemaining,
    round: initialRound,
  });

  if (observed.timerKey !== timerKey) {
    setObserved({ timerKey, remainingSec: initialRemaining, round: initialRound });
  }

  const isRunningForSession =
    (view.status === 'running' || view.status === 'preparing') &&
    entry !== null &&
    entry.sessionId === sessionId &&
    (entry.mode === 'rest' || entry.pausedAtMs === null);

  useEffect(() => {
    if (!isRunningForSession) return;
    const interval = setInterval(() => {
      const currentEntry = getRestTimerEntry();
      const nextView = deriveRestTimerView(currentEntry, sessionId, now());
      const nextRemaining = nextView.status === 'idle' ? -1 : nextView.remainingSec;
      const nextRound =
        nextView.status !== 'idle' && nextView.mode === 'repeating' ? nextView.round : -1;

      setObserved((prev) => {
        if (
          prev.timerKey === timerKey &&
          prev.remainingSec === nextRemaining &&
          prev.round === nextRound
        ) {
          return prev;
        }
        return { timerKey, remainingSec: nextRemaining, round: nextRound };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunningForSession, timerKey, now, sessionId]);

  const isActive = view.status !== 'idle';

  const start = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    startRestTimer(sessionId, defaultDurationSec, now());
  }, [defaultDurationSec, isActiveSession, now, sessionId]);

  const adjust = useCallback(
    (deltaSec: number) => {
      if (!isActiveSession || !sessionId) return;
      if (entry?.sessionId === sessionId && entry.mode === 'repeating') {
        adjustRepeatingTimer(sessionId, deltaSec, now());
      } else {
        adjustRestTimer(sessionId, deltaSec, now());
      }
    },
    [entry, isActiveSession, now, sessionId],
  );

  const restart = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    if (entry?.sessionId === sessionId && entry.mode === 'repeating') {
      resetRepeatingTimer(sessionId, now());
    } else {
      restartRestTimer(sessionId, defaultDurationSec, now());
    }
  }, [defaultDurationSec, entry, isActiveSession, now, sessionId]);

  const dismiss = useCallback(() => {
    if (!sessionId) return;
    dismissRestTimer(sessionId);
  }, [sessionId]);

  const toggle = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    if (getRestTimerEntry()?.sessionId === sessionId) {
      dismissRestTimer(sessionId);
    } else {
      startRestTimer(sessionId, defaultDurationSec, now());
    }
  }, [defaultDurationSec, isActiveSession, now, sessionId]);

  const onSetConfirmed = useCallback(() => {
    if (!isActiveSession || !sessionId || !autoStart) return;
    if (isRestTimerAutoStartSuppressed(sessionId)) return;
    const current = getRestTimerEntry();
    if (current && current.sessionId === sessionId && current.mode === 'repeating') {
      return;
    }
    startRestTimer(sessionId, defaultDurationSec, now());
  }, [autoStart, defaultDurationSec, isActiveSession, now, sessionId]);

  const startRepeating = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    startRepeatingTimer(sessionId, defaultRepeatingIntervalSec, now());
  }, [defaultRepeatingIntervalSec, isActiveSession, now, sessionId]);

  const stopRepeating = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    stopRepeatingTimer(sessionId, now());
  }, [isActiveSession, now, sessionId]);

  const toggleRepeating = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    toggleRepeatingTimer(sessionId, now());
  }, [isActiveSession, now, sessionId]);

  const resetRepeating = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    resetRepeatingTimer(sessionId, now());
  }, [isActiveSession, now, sessionId]);

  const switchMode = useCallback(
    (mode: TimerMode) => {
      if (!isActiveSession || !sessionId) return;
      switchTimerMode(sessionId, mode, {
        restDurationSec: defaultDurationSec,
        repeatingIntervalSec: defaultRepeatingIntervalSec,
        nowMs: now(),
      });
    },
    [defaultDurationSec, defaultRepeatingIntervalSec, isActiveSession, now, sessionId],
  );

  return {
    view,
    isActive,
    start,
    adjust,
    restart,
    dismiss,
    toggle,
    toggleForSession: isActiveSession ? toggle : undefined,
    onSetConfirmed,
    startRepeating,
    stopRepeating,
    toggleRepeating,
    resetRepeating,
    switchMode,
  };
}
