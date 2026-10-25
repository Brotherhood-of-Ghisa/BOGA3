import { getCurrentForegroundPositionLazy } from './foreground-location-lazy';
import type { CurrentForegroundPositionResult, ForegroundLocationPosition } from './foreground-location-service';

/**
 * The session view's position: acquired while the recorder is open, cached for
 * the session's lifetime, and consumed by the gym sheet's nearby suggestion.
 * Foreground-only: the reads run while the session screen is up, never behind
 * it.
 *
 * The gym sheet never selects a gym from a position — it suggests — so the
 * cache trades strictness for availability: the first fix that lands is
 * published at once, whatever its accuracy, so the sheet suggests straight
 * away. Reading then continues, after a wait between reads so the GPS
 * pipeline can tighten, until a fix is good — at least as accurate as
 * {@link SESSION_POSITION_GOOD_ACCURACY_M} — and each more accurate fix
 * replaces the held one and updates the sheet live. Timed-out or failed reads
 * retry the same way. Permission denial and services-off stop at once;
 * anything else keeps reading inside the attempt and wall-clock budgets. An
 * acquisition that spends its budget without a good fix keeps its best one,
 * and the gym sheet can re-arm it (`resume`), when the person opening the
 * sheet is waiting on exactly that.
 */

// A fix this accurate ends the acquisition: the same bar a gym's saved
// location must meet, and well inside the 1 km the suggestion reaches.
export const SESSION_POSITION_GOOD_ACCURACY_M = 100;

// How many reads one acquisition tries before giving up, how long it waits
// between them — so the GPS pipeline can answer — and how long the whole
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


// A fix's accuracy when it is a real radius; `null`, negative or non-finite
// readings count as unknown.
const knownAccuracyM = ({ accuracyM }: ForegroundLocationPosition): number | null =>
  accuracyM !== null && Number.isFinite(accuracyM) && accuracyM >= 0 ? accuracyM : null;

// Whether `next` should replace the held fix: any fix beats none, a known
// accuracy beats an unknown one, and a tighter one beats a looser one.
const isMoreAccurate = (
  next: ForegroundLocationPosition,
  held: ForegroundLocationPosition | null
): boolean => {
  if (!held) return true;
  const nextAccuracyM = knownAccuracyM(next);
  const heldAccuracyM = knownAccuracyM(held);
  if (nextAccuracyM === null) return false;
  return heldAccuracyM === null || nextAccuracyM < heldAccuracyM;
};

const isGoodFix = (position: ForegroundLocationPosition): boolean => {
  const accuracyM = knownAccuracyM(position);
  return accuracyM !== null && accuracyM <= SESSION_POSITION_GOOD_ACCURACY_M;
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
  // `reading` may already hold a fix it is still refining; `available` is a
  // settled acquisition with a fix, `unavailable` one without.
  status: 'reading' | 'available' | 'unavailable';
  // The most accurate fix so far.
  position: ForegroundLocationPosition | null;
  attempts: number;
  lastRead: { status: CurrentForegroundPositionResult['status']; accuracyM: number | null } | null;
  gaveUpReason: SessionPositionGaveUpReason | null;
};

type SessionPositionEntry = SessionPositionState & {
  // Whether the sheet may re-arm a settled acquisition: one that spent its
  // budget without a good fix.
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
 * The session's best fix so far — held while reading continues to refine it —
 * or `null` before any fix lands or when the session gave up without one.
 */
export const getSessionPosition = (sessionId: string): ForegroundLocationPosition | null =>
  entries.get(sessionId)?.position ?? null;

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
 * Starts the session's acquisition, or does nothing when it already ran: a
 * good fix or a denial makes this a no-op, as does a read still in flight.
 * With `resume`, an acquisition that spent its budget — holding only a coarse
 * fix, or none — reads again, keeping its best fix meanwhile: the gym sheet
 * passes it, because the person opening the sheet is waiting on exactly that
 * fix. The read takes the position reader as a parameter, so tests inject one
 * instead of the native module, and the retry wait as a second one, so tests
 * run without the waits.
 */
export const beginSessionPosition = async (
  sessionId: string,
  { resume = false }: { resume?: boolean } = {},
  readPosition: () => Promise<CurrentForegroundPositionResult> = getCurrentForegroundPositionLazy,
  retryDelayMs: number = RETRY_DELAY_MS
): Promise<void> => {
  const existing = entries.get(sessionId);
  if (existing) {
    // A read already in flight, a good fix, a denial, or — unless resumed —
    // an acquisition that already spent its budget.
    if (existing.status === 'reading' || !existing.resumable || !resume) return;
  }

  // A resumed acquisition keeps the best fix it had while it reads for a
  // better one.
  const entry: SessionPositionEntry = {
    status: 'reading',
    position: existing?.position ?? null,
    attempts: 0,
    lastRead: existing?.lastRead ?? null,
    gaveUpReason: null,
    resumable: false,
  };
  setEntry(sessionId, entry);

  // Ends the acquisition: a held fix settles as available, none as a give-up.
  const settle = (reason: SessionPositionGaveUpReason, resumable: boolean) =>
    setEntry(sessionId, {
      ...entry,
      status: entry.position ? 'available' : 'unavailable',
      gaveUpReason: entry.position ? null : reason,
      resumable,
    });

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
      const fix = result.status === 'success' ? result.position : null;
      const improved = fix !== null && isMoreAccurate(fix, entry.position);
      if (improved) entry.position = fix;
      setEntry(sessionId, { ...entry });
      if (improved) notifyPosition(sessionId, fix);

      if (entry.position && isGoodFix(entry.position)) {
        settle('no_fix', false);
        return;
      }
      if (!isRetryableRead(result.status)) {
        // Permission denied or services off: no better fix is coming, however
        // long the pipeline has.
        settle(gaveUpReasonFor(result), false);
        return;
      }

      const isLastAttempt = attempt >= MAX_READS || Date.now() + Math.max(retryDelayMs, 0) >= deadline;
      if (isLastAttempt) {
        settle(gaveUpReasonFor(result), true);
        return;
      }

      if (retryDelayMs > 0) await wait(retryDelayMs);
    }
  } catch {
    settle('read_error', true);
  }
};

/** Test-only: clears every session's entry and listeners. */
export const resetSessionPositions = (): void => {
  entries.clear();
  positionListeners.clear();
  stateListeners.clear();
};