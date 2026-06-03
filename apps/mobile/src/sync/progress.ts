// First-sync progress snapshot: the shape the bootstrap/first-pull leg produces
// so a stalled setup screen can show WHERE it is and that it is still advancing.
//
// The representation is deliberately denominator-free. The pull drains each
// topological layer until the server says there is no more, and the catalog
// seed writes a bundle of unknown size, so no honest up-front total exists for a
// percentage. Instead the snapshot carries two monotonic counters the producer
// already computes for free — how many of the fixed topo layers have drained,
// and a running count of rows applied this run — plus the current phase label
// and an offline flag. A renderer animates an indeterminate indicator while the
// counters advance and labels it with the phase, which is honest about the
// unknown total while still proving liveness.
//
// `offline` mirrors the network reachability the scheduler already projects; it
// is single-sourced from there (the surfacing layer overrides it from the live
// projection), never derived from a phase or a cycle error, so a transient
// error can never masquerade as "offline".

/** The genuinely-distinct, observable phases of a first sync. */
export type SyncPhase = 'idle' | 'pull' | 'push' | 'seed' | 'done';

/** The number of topological pull layers — the ONLY known progress denominator. */
export const PULL_LAYER_COUNT = 4;

/**
 * An immutable progress snapshot. `layersCompleted` runs 0..PULL_LAYER_COUNT
 * during the pull phase; `rowsApplied` is a monotonic per-run count and is never
 * a percentage; `offline` mirrors the network reachability projection.
 */
export interface SyncProgress {
  phase: SyncPhase;
  layersCompleted: number;
  rowsApplied: number;
  offline: boolean;
}

/** The snapshot every run starts from: idle, nothing applied, assumed online. */
export const INITIAL_SYNC_PROGRESS: SyncProgress = {
  phase: 'idle',
  layersCompleted: 0,
  rowsApplied: 0,
  offline: false,
};

// Module-scoped latest snapshot. The bootstrapper is the sole writer; the
// surfacing layer (and tests) read it. Keeping it here — rather than inside the
// scheduler — gives the surfacing layer a dependency-light read seam and keeps
// the producer's writes out of the scheduler's state machine.
let latestProgress: SyncProgress = INITIAL_SYNC_PROGRESS;

/** Returns the latest progress snapshot. */
export const getSyncProgress = (): SyncProgress => latestProgress;

/**
 * Replaces the latest snapshot. The producer calls this as it crosses a phase /
 * layer / page boundary. `offline` is left to the producer's last known value;
 * the surfacing layer is responsible for overriding it from the live network
 * projection so a stale snapshot can never report the wrong network state.
 */
export const setSyncProgress = (next: SyncProgress): void => {
  latestProgress = next;
};

/** Resets the snapshot to the initial idle state at the start of a fresh run. */
export const resetSyncProgress = (): void => {
  latestProgress = INITIAL_SYNC_PROGRESS;
};
