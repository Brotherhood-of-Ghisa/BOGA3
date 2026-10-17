import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { DEFAULT_REST_TIMER_SECONDS } from '../preferences/model';

export const REST_TIMER_STEP_SEC = 15;

export type RestTimerEntry = {
  sessionId: string;
  startedAtMs: number;
  endsAtMs: number;
  durationSec: number;
};

export type RestTimerView =
  | { status: 'idle' }
  | {
      status: 'running' | 'completed';
      sessionId: string;
      remainingSec: number;
      formatted: string;
      durationSec: number;
    };

const IDLE_REST_TIMER_VIEW: RestTimerView = { status: 'idle' };

let activeEntry: RestTimerEntry | null = null;
const listeners = new Set<() => void>();

const emit = () => {
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

export const deriveRestTimerView = (
  entry: RestTimerEntry | null,
  sessionId: string | null,
  nowMs: number = Date.now(),
): RestTimerView => {
  if (!entry || !sessionId || entry.sessionId !== sessionId) {
    return IDLE_REST_TIMER_VIEW;
  }
  const remainingMs = Math.max(0, entry.endsAtMs - nowMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  if (remainingSec <= 0) {
    return {
      status: 'completed',
      sessionId: entry.sessionId,
      remainingSec: 0,
      formatted: '0:00',
      durationSec: entry.durationSec,
    };
  }
  return {
    status: 'running',
    sessionId: entry.sessionId,
    remainingSec,
    formatted: formatRestTimerSeconds(remainingSec),
    durationSec: entry.durationSec,
  };
};

export const getRestTimerEntry = (): RestTimerEntry | null => activeEntry;

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
  activeEntry = {
    sessionId,
    startedAtMs: nowMs,
    endsAtMs: nowMs + normalizedDuration * 1000,
    durationSec: normalizedDuration,
  };
  emit();
};

export const adjustRestTimer = (
  sessionId: string,
  deltaSec: number,
  nowMs: number = Date.now(),
): void => {
  if (!activeEntry || activeEntry.sessionId !== sessionId || !Number.isFinite(deltaSec)) {
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
  const targetDuration = durationSec ?? (activeEntry?.sessionId === sessionId ? activeEntry.durationSec : DEFAULT_REST_TIMER_SECONDS);
  startRestTimer(sessionId, targetDuration, nowMs);
};

export const dismissRestTimer = (sessionId?: string): void => {
  if (!activeEntry) return;
  if (sessionId !== undefined && activeEntry.sessionId !== sessionId) return;
  activeEntry = null;
  emit();
};

export const __resetRestTimerForTests = (): void => {
  activeEntry = null;
  listeners.clear();
};

const systemNowMs = () => Date.now();

export type UseSessionRestTimerOptions = {
  defaultDurationSec?: number;
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
    autoStart = true,
    isActiveSession = true,
    now = systemNowMs,
  } = options;
  const entry = useSyncExternalStore(subscribeRestTimer, getRestTimerEntry, getRestTimerEntry);
  const view = isActiveSession ? deriveRestTimerView(entry, sessionId, now()) : IDLE_REST_TIMER_VIEW;
  const [, setObservedRemainingSec] = useState(view.status === 'idle' ? -1 : view.remainingSec);
  const isRunningForSession = view.status === 'running';

  useEffect(() => {
    if (!isRunningForSession) return;
    const interval = setInterval(() => {
      const nextView = deriveRestTimerView(getRestTimerEntry(), sessionId, now());
      const nextRemaining = nextView.status === 'idle' ? -1 : nextView.remainingSec;
      setObservedRemainingSec((prev) => (prev === nextRemaining ? prev : nextRemaining));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunningForSession, entry?.endsAtMs, now, sessionId]);

  const isActive = view.status !== 'idle';

  const start = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    startRestTimer(sessionId, defaultDurationSec, now());
  }, [defaultDurationSec, isActiveSession, now, sessionId]);

  const adjust = useCallback(
    (deltaSec: number) => {
      if (!isActiveSession || !sessionId) return;
      adjustRestTimer(sessionId, deltaSec, now());
    },
    [isActiveSession, now, sessionId],
  );

  const restart = useCallback(() => {
    if (!isActiveSession || !sessionId) return;
    restartRestTimer(sessionId, defaultDurationSec, now());
  }, [defaultDurationSec, isActiveSession, now, sessionId]);

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
    startRestTimer(sessionId, defaultDurationSec, now());
  }, [autoStart, defaultDurationSec, isActiveSession, now, sessionId]);

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
  };
}
