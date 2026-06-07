// Write-time sync nudge: the decoupling seam between the data layer and the
// sync scheduler.
//
// A local domain mutation should ask the scheduler to sync soon after it
// commits, but the data repos must NOT import the scheduler directly: the
// scheduler imports the sync cycle, which imports the data layer
// (`@/src/data/bootstrap`, `clock`, `schema`, …), so a `data -> scheduler`
// edge would close an import cycle. This tiny dependency-free event emitter is
// that seam — the data layer fires `notifyLocalWrite()`, and the scheduler
// subscribes its `requestSync` at boot — mirroring the established
// `@/src/exercise-catalog/invalidation` pattern.
//
// The nudge is fire-and-forget and safe to fire redundantly: the scheduler
// coalesces requests and is a no-op while OFFLINE or RUNNING, so an extra call
// is harmless. It is the caller's responsibility to fire it post-commit (never
// inside a transaction) and exactly once per logical mutation.

type WriteNudgeListener = () => void;

const listeners = new Set<WriteNudgeListener>();

/**
 * Subscribes a listener to local-write notifications and returns an
 * unsubscribe. The scheduler wires `requestSync` here at boot; the returned
 * teardown is invoked when the scheduler stops so a restart does not stack
 * subscriptions.
 */
export const subscribeToLocalWrites = (listener: WriteNudgeListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Announces that a local domain mutation has committed. Called by the data-layer
 * write boundaries AFTER their transaction returns — never inside it — exactly
 * once per logical mutation. A listener throwing must not corrupt the write that
 * already committed nor stop sibling listeners, so each is invoked defensively.
 */
export const notifyLocalWrite = (): void => {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A nudge is best-effort: the mutation already committed, so a listener
      // failure must not propagate back into the write path.
    }
  }
};

/** Test-only reset so a suite starts with no subscribers. */
export const __resetLocalWriteSubscribersForTests = (): void => {
  listeners.clear();
};
