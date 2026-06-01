// A tiny observable flag the sync cycle raises when the server answers a
// push/pull with the structured "no signed-in user" envelope. The pre-login app
// is granted anonymous execute on the sync RPCs, so an unauthenticated cycle
// returns this envelope rather than a transport 401 — and the cycle treats it as
// a clean, retriable outcome (it does not throw). That makes the condition
// invisible to anything watching the cycle for an exception.
//
// This module turns that outcome into an explicit, subscribable signal: the
// route-layer auth guard reads it to send the user to the sign-in entry point,
// and any caller that successfully establishes a session clears it so a later
// authenticated cycle starts from a clean slate. It carries no user data — just
// a boolean edge — and is deliberately module-scoped so the cycle (which has no
// React context) and the UI tree observe the same source of truth.

type AuthRequiredListener = () => void;

const listeners = new Set<AuthRequiredListener>();

let authRequired = false;

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

/** Whether the latest sync cycle reported that no user is signed in. */
export const getAuthRequiredSignal = (): boolean => authRequired;

/**
 * Subscribe to changes in the signal. Returns an unsubscribe function. The
 * signature matches React's `useSyncExternalStore` subscribe contract so the
 * UI can observe the flag without polling.
 */
export const subscribeToAuthRequiredSignal = (listener: AuthRequiredListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Raise the flag (idempotent): a cycle just saw the "no signed-in user" envelope. */
export const markAuthRequired = (): void => {
  if (authRequired) {
    return;
  }
  authRequired = true;
  emit();
};

/** Lower the flag (idempotent): a session now exists, so the condition is resolved. */
export const clearAuthRequired = (): void => {
  if (!authRequired) {
    return;
  }
  authRequired = false;
  emit();
};

/** Test-only reset so suites start from a known clean flag. */
export const __resetAuthRequiredSignalForTests = (): void => {
  authRequired = false;
  listeners.clear();
};
