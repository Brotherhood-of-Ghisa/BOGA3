// The typed snapshot the sync/bootstrap layer reports to the UI so a waiting
// user can see what is happening while the first sync drains.
//
// The shape is deliberately honest about what is and is not knowable up front.
// The pull leg drains each topological layer until the server says "no more",
// and the catalog seeder writes a bundle of unknown size, so there is no total
// row count to divide by — an exact percentage would have to fabricate a
// denominator that jumps and stalls. Instead the snapshot carries:
//
//   - the current `phase` of the run,
//   - two monotonic counters that only ever climb (the advancing liveness proof:
//     "layer K of 4", "N items"), where the ONLY known denominator is the fixed
//     count of topological layers, and
//   - an `offline` boolean mirroring the scheduler's network reachability
//     projection, so an offline device shows a clear message instead of an
//     indefinite spinner.
//
// `offline` is purely a projection of network reachability; it is never derived
// from a phase or a cycle error. A "no signed-in user" outcome is therefore NOT
// offline — that is the gate's route-to-sign-in concern, handled separately.

/** The number of topological layers the first pull drains, in order. */
export const SYNC_PULL_LAYER_COUNT = 4;

/** The distinct, observable phases of a first sync / bootstrap run. */
export type SyncPhase = 'idle' | 'pull' | 'push' | 'seed' | 'done';

/**
 * An immutable progress snapshot the gate renders. Counters are monotonic within
 * a single run and carry no total (except `layersCompleted`, bounded by the
 * fixed {@link SYNC_PULL_LAYER_COUNT}); they are advancing-liveness signals, not
 * a completion fraction.
 */
export interface SyncProgress {
  /** The phase the first-sync/bootstrap run is currently in. */
  phase: SyncPhase;
  /** How many pull layers have fully drained so far (0..{@link SYNC_PULL_LAYER_COUNT}). */
  layersCompleted: number;
  /** Running count of rows applied this run; monotonic, never a percentage. */
  rowsApplied: number;
  /** True when the device has no usable network (mirrors the scheduler projection). */
  offline: boolean;
}

/** The neutral starting snapshot: nothing has run yet and the network is unknown. */
export const IDLE_SYNC_PROGRESS: SyncProgress = {
  phase: 'idle',
  layersCompleted: 0,
  rowsApplied: 0,
  offline: false,
};
