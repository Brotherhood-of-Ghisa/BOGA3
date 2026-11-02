// Rows-pushed signal: the seam between the sync cycle and readers of
// server-derived views (group reads) that want to re-read once the server has
// a device's new rows.
//
// Dependency-free like `write-nudge.ts`. The cycle fires `notifyRowsPushed()`
// once at its end when any push leg sent rows. A listener runs inside the
// cycle's local-data lock, so it must only schedule work (a timer), never read
// or write local data itself.

type RowsPushedListener = () => void;

const listeners = new Set<RowsPushedListener>();
let lastRowsPushedAtMs: number | null = null;

/** Subscribes to rows-pushed notifications and returns an unsubscribe. */
export const subscribeToRowsPushed = (listener: RowsPushedListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Epoch-ms of the last cycle that pushed rows in this app run, or null. */
export const getLastRowsPushedAtMs = (): number | null => lastRowsPushedAtMs;

/** Announces that a sync cycle has pushed rows to the server. */
export const notifyRowsPushed = (): void => {
  lastRowsPushedAtMs = Date.now();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Best-effort: a listener failure must not fail the sync cycle.
    }
  }
};

/** Test-only reset so a suite starts with no subscribers and no push. */
export const __resetRowsPushedForTests = (): void => {
  listeners.clear();
  lastRowsPushedAtMs = null;
};
