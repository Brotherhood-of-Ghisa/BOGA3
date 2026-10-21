import { getCurrentForegroundPositionLazy } from './foreground-location-lazy';
import type { CurrentForegroundPositionResult, ForegroundLocationPosition } from './foreground-location-service';

/**
 * The session view's position: acquired once when the recorder starts, cached
 * for the session's lifetime, and consumed by the gym sheet's nearby
 * suggestion. Foreground-only: the read runs while the session screen is up,
 * never behind it.
 *
 * The gym sheet never selects a gym from a position — it suggests — so the
 * cache trades strictness for availability: a fix at least as accurate as
 * {@link SESSION_POSITION_MAX_ACCURACY_M} is trusted the moment it lands and
 * the sheet updates live. A coarser fix is retried, because a cold GPS
 * pipeline tightens over successive reads. A session that ends with no usable
 * fix (permission denied, services off, repeated coarse reads) gives up for
 * the rest of the session.
 */

// Gyms usually sit more than a kilometre apart, so a fix this coarse still
// names the right gym or gyms. The matcher pairs this with its own radius.
export const SESSION_POSITION_MAX_ACCURACY_M = 500;

// How many coarse reads the session's acquisition tries before giving up.
export const SESSION_POSITION_MAX_COARSE_READS = 3;
const MAX_COARSE_READS = SESSION_POSITION_MAX_COARSE_READS;

type SessionPositionEntry =
  | { status: 'reading' }
  | { status: 'available'; position: ForegroundLocationPosition }
  | { status: 'unavailable' };

const entries = new Map<string, SessionPositionEntry>();
const listeners = new Set<(position: ForegroundLocationPosition) => void>();

const notify = (position: ForegroundLocationPosition) => {
  for (const listener of listeners) listener(position);
};

/**
 * The session's cached fix, or `null` while it is still being acquired or the
 * session gave up on one.
 */
export const getSessionPosition = (sessionId: string): ForegroundLocationPosition | null => {
  const entry = entries.get(sessionId);
  return entry?.status === 'available' ? entry.position : null;
};

/**
 * Live updates for the gym sheet: the listener runs the moment the session's
 * fix lands. Returns the unsubscribe function.
 */
export const subscribeSessionPosition = (
  listener: (position: ForegroundLocationPosition) => void
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Starts the session's acquisition, or resumes nothing when it already ran:
 * a cached fix or a recorded failure makes this a no-op, as does a read still
 * in flight. The read takes the position reader as a parameter, so tests
 * inject one instead of the native module.
 */
export const beginSessionPosition = async (
  sessionId: string,
  readPosition: () => Promise<CurrentForegroundPositionResult> = getCurrentForegroundPositionLazy
): Promise<void> => {
  const existing = entries.get(sessionId);
  if (existing) {
    // Either a settled outcome or a read already in flight.
    return;
  }
  entries.set(sessionId, { status: 'reading' });

  try {
    for (let coarseReads = 0; coarseReads < MAX_COARSE_READS; coarseReads += 1) {
      const result = await readPosition();
      if (result.status !== 'success') {
        // Permission, services, read failure, timeout: no fix is coming.
        entries.set(sessionId, { status: 'unavailable' });
        return;
      }
      const { accuracyM } = result.position;
      if (accuracyM !== null && accuracyM >= 0 && accuracyM <= SESSION_POSITION_MAX_ACCURACY_M) {
        entries.set(sessionId, { status: 'available', position: result.position });
        notify(result.position);
        return;
      }
    }
    entries.set(sessionId, { status: 'unavailable' });
  } catch {
    entries.set(sessionId, { status: 'unavailable' });
  }
};

/** Test-only: clears every session's entry and listeners. */
export const resetSessionPositions = (): void => {
  entries.clear();
  listeners.clear();
};
