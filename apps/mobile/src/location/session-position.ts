import { getCurrentForegroundPositionLazy } from './foreground-location-lazy';
import type { CurrentForegroundPositionResult, ForegroundLocationPosition } from './foreground-location-service';

/**
 * The session view's position: acquired while the recorder is open, cached for
 * the session's lifetime, and consumed by the gym sheet's nearby suggestion.
 * Foreground-only: the reads run while the session screen is up, never behind
 * it.
 *
 * The gym sheet never selects a gym from a position — it suggests — so the
 * cache trades strictness for availability: a fix at least as accurate as
 * {@link SESSION_POSITION_MAX_ACCURACY_M} is trusted the moment it lands and
 * the sheet updates live. A coarser fix — or a read that times out or fails —
 * is retried after a wait, because a cold GPS pipeline tightens over seconds,
 * and three reads fired back to back only see the same coarse cached fix.
 * Permission denial and services-off give up at once; anything else keeps
 * retrying inside the attempt and wall-clock budgets. A session that ends its
 * acquisition with no usable fix gives up until the gym sheet re-arms it
 * (`resume`), when the person opening the sheet is waiting on exactly that.
 */

// Gyms usually sit more than a kilometre apart, so a fix this coarse still
// names the right gym or gyms. The matcher pairs this with its own radius.
export const SESSION_POSITION_MAX_ACCURACY_M = 500;

// How many reads one acquisition tries before giving up, how long it waits
// between them — so the GPS pipeline can tighten — and how long the whole
// acquisition may run.
export const SESSION_POSITION_MAX_READS = 6;
export const SESSION_POSITION_RETRY_DELAY_MS = 2_000;
export const SESSION_POSITION_ACQUISITION_BUDGET_MS = 60_000;

const MAX_READS = SESSION_POSITION_MAX_READS;
const RETRY_DELAY_MS = SESSION_POSITION_RETRY_DELAY_MS;
const ACQUISITION_BUDGET_MS = SESSION_POSITION_ACQUISITION_BUDGET_MS;

// The read statuses worth retrying: everything but the two denials that no
// amount of retrying changes.
const isRetryableRead = (status: CurrentForegroundPositionResult['status']): boolean =>
  status !== 'permission_denied' && status !== 'unavailable';

const isUsableFix = (position: ForegroundLocationPosition): boolean => {
  const { accuracyM } = position;
  return accuracyM !== null && accuracyM >= 0 && accuracyM <= SESSION_POSITION_MAX_ACCURACY_M;
};

const gaveUpReasonFor = (result: CurrentForegroundPositionResult): SessionPositionGaveUpReason => {
  if (result.status === 'permission_denied') return 'permission_denied';
  if (result.status === 'unavailable') return 'services_disabled';
  if (result.status === 'success' || result.status === 'timeout') return 'no_fix';
  return 'read_error';
};

export type SessionPositionGaveUpReason =
  | 'permission_denied'
  | 'services_disabled'
  | 'no_fix'
  | 'read_error';

export type SessionPositionState = {
  status: 'reading' | 'available' | 'unavailable';
  position: ForegroundLocationPosition | null;
  attempts: number;
  lastRead: { status: CurrentForegroundPositionResult['status']; accuracyM: number | null } | null;
  gaveUpReason: SessionPositionGaveUpReason | null;
};

type SessionPositionEntry = SessionPositionState & {
  // Whether the sheet may clear the settled failure and acquire again.
  resumable: boolean;
};

const entries = new Map<string, SessionPositionEntry>();
// Listeners are keyed per session: two recorder screens can be mounted at
// once in a navigation stack, and neither sheet may hear the other session's
// fix or diagnostics.
const positionListeners = new Map<string, Set<(position: ForegroundLocationPosition) => void>>();
const stateListeners = new Map<string, Set<(state: SessionPositionState) => void>>();

const listenersOf = <T,>(map: Map<string, Set<T>>, sessionId: string): Set<T> => {
  let listeners = map.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    map.set(sessionId, listeners);
  }
  return listeners;
};

const notifyPosition = (sessionId: string, position: ForegroundLocationPosition) => {
  for (const listener of positionListeners.get(sessionId) ?? []) listener(position);
};

const notifyState = (sessionId: string, state: SessionPositionState) => {
  for (const listener of stateListeners.get(sessionId) ?? []) listener(state);
};

const entryState = (entry: SessionPositionEntry): SessionPositionState => ({
  status: entry.status,
  position: entry.position,
  attempts: entry.attempts,
  lastRead: entry.lastRead,
  gaveUpReason: entry.gaveUpReason,
});

const setEntry = (sessionId: string, entry: SessionPositionEntry) => {
  entries.set(sessionId, entry);
  notifyState(sessionId, entryState(entry));
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The session's cached fix, or `null` while it is still being acquired or the
 * session gave up on one.
 */
export const getSessionPosition = (sessionId: string): ForegroundLocationPosition | null => {
  const entry = entries.get(sessionId);
  return entry?.status === 'available' ? entry.position : null;
};

/**
 * The session's acquisition diagnostics: what the reads saw and why a fix is
 * or is not held. The gym sheet's developer GPS panel renders this.
 */
export const getSessionPositionState = (sessionId: string): SessionPositionState | null => {
  const entry = entries.get(sessionId);
  return entry ? entryState(entry) : null;
};

/**
 * Live updates for the gym sheet: the position listener runs the moment the
 * session's fix lands; the state listener runs on every acquisition change,
 * including attempts and give-ups. Returns the unsubscribe function.
 */
export const subscribeSessionPosition = (
  sessionId: string,
  listener: (position: ForegroundLocationPosition) => void
): (() => void) => {
  const listeners = listenersOf(positionListeners, sessionId);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) positionListeners.delete(sessionId);
  };
};

export const subscribeSessionPositionState = (
  sessionId: string,
  listener: (state: SessionPositionState) => void
): (() => void) => {
  const listeners = listenersOf(stateListeners, sessionId);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stateListeners.delete(sessionId);
  };
};

/**
 * Starts the session's acquisition, or resumes nothing when it already ran: a
 * cached fix or a recorded failure makes this a no-op, as does a read still in
 * flight. With `resume`, a settled failure from a finished acquisition — one
 * that ran out of its retry budget, not a denial — is cleared and the
 * acquisition runs again: the gym sheet passes it, because the person opening
 * the sheet is waiting on exactly that fix. The read takes the position reader
 * as a parameter, so tests inject one instead of the native module, and the
 * retry wait as a second one, so tests run without the waits.
 */
export const beginSessionPosition = async (
  sessionId: string,
  { resume = false }: { resume?: boolean } = {},
  readPosition: () => Promise<CurrentForegroundPositionResult> = getCurrentForegroundPositionLazy,
  retryDelayMs: number = RETRY_DELAY_MS
): Promise<void> => {
  const existing = entries.get(sessionId);
  if (existing) {
    // A read already in flight, a held fix, a denial, or — unless resumed —
    // an acquisition that already spent its budget.
    if (existing.status !== 'unavailable' || !existing.resumable || !resume) return;
  }

  const entry: SessionPositionEntry = {
    status: 'reading',
    position: null,
    attempts: 0,
    lastRead: existing?.lastRead ?? null,
    gaveUpReason: null,
    resumable: false,
  };
  setEntry(sessionId, entry);

  try {
    // The deadline bounds the whole acquisition, so a slow read cannot stretch
    // it past the session's foreground lifetime.
    const deadline = Date.now() + ACQUISITION_BUDGET_MS;
    for (let attempt = 1; ; attempt += 1) {
      let result: CurrentForegroundPositionResult;
      try {
        result = await readPosition();
      } catch (error) {
        result = { status: 'read_failure', error };
      }

      entry.attempts = attempt;
      entry.lastRead = {
        status: result.status,
        accuracyM: result.status === 'success' ? result.position.accuracyM : null,
      };
      setEntry(sessionId, { ...entry });

      if (result.status === 'success' && isUsableFix(result.position)) {
        setEntry(sessionId, { ...entry, status: 'available', position: result.position });
        notifyPosition(sessionId, result.position);
        return;
      }
      if (!isRetryableRead(result.status)) {
        // Permission denied or services off: no fix is coming, however long
        // the pipeline has.
        setEntry(sessionId, {
          ...entry,
          status: 'unavailable',
          gaveUpReason: gaveUpReasonFor(result),
        });
        return;
      }

      const isLastAttempt = attempt >= MAX_READS || Date.now() + Math.max(retryDelayMs, 0) >= deadline;
      if (isLastAttempt) {
        setEntry(sessionId, {
          ...entry,
          status: 'unavailable',
          gaveUpReason: gaveUpReasonFor(result),
          resumable: true,
        });
        return;
      }

      if (retryDelayMs > 0) await wait(retryDelayMs);
    }
  } catch {
    setEntry(sessionId, { ...entry, status: 'unavailable', gaveUpReason: 'read_error', resumable: true });
  }
};

/** Test-only: clears every session's entry and listeners. */
export const resetSessionPositions = (): void => {
  entries.clear();
  positionListeners.clear();
  stateListeners.clear();
};