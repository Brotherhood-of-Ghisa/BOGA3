// A tiny observable carrying the classification of the most recent sync cycle's
// outcome, for surfaces that must react to a failed cycle (the first-sync gate
// shows an error + Retry; a clean cycle clears it).
//
// The "no signed-in user" case is intentionally NOT carried here — it has its
// own dedicated signal because it is a route decision (send the user to
// sign-in), not a recoverable in-gate error. This module covers only the
// non-auth failure codes the gate renders as an error message:
//
//   - 'FK_VIOLATION': a server-side structural mismatch the cycle could not push past.
//   - 'LOCAL_FK_VIOLATION': a local SQLite FK failure while applying a pulled page.
//   - 'INTERNAL': a server-internal or transport failure.
//
// It is module-scoped on purpose: the cycle runs with no React context, so the
// cycle and the UI tree must observe the same source of truth. It carries no
// user data — just the latest code, or null when the last cycle was clean.

/** The non-auth failure classifications a cycle can report. */
export type CycleErrorCode = 'FK_VIOLATION' | 'LOCAL_FK_VIOLATION' | 'INTERNAL';

type CycleErrorListener = () => void;

const listeners = new Set<CycleErrorListener>();

let lastErrorCode: CycleErrorCode | null = null;

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

/** The most recent cycle's non-auth error code, or null when it was clean. */
export const getCycleErrorCode = (): CycleErrorCode | null => lastErrorCode;

/**
 * Subscribe to changes in the code. Returns an unsubscribe function; the
 * signature matches React's `useSyncExternalStore` subscribe contract.
 */
export const subscribeToCycleErrorCode = (listener: CycleErrorListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Records a non-auth failure code from the latest cycle (idempotent). */
export const markCycleError = (code: CycleErrorCode): void => {
  if (lastErrorCode === code) {
    return;
  }
  lastErrorCode = code;
  emit();
};

/** Clears the code: a cycle just completed (or recovered) cleanly (idempotent). */
export const clearCycleError = (): void => {
  if (lastErrorCode === null) {
    return;
  }
  lastErrorCode = null;
  emit();
};

/** Test-only reset so suites start from a known clean code. */
export const __resetCycleErrorSignalForTests = (): void => {
  lastErrorCode = null;
  listeners.clear();
};
