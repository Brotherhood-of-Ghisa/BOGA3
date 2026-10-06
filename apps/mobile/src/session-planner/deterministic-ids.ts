import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { readLocalDataOwner } from '@/src/data/local-wipe';

/**
 * Deterministic materialization IDs (session-planning contract §4.2): provenance rows are
 * composed from the data owner and the source-plan row they materialize, so a
 * retry — on this device or a competing one — inserts the same primary keys
 * and converges on at most one live use of each source row, with the server
 * partial unique indexes as the final arbiter.
 *
 * The owner is the local data owner recorded in `sync_runtime_state`
 * (`accountUserId`). A signed-out local-only device materializes with the
 * `local` owner: nothing syncs, so the keys only need local stability.
 */

const LOCAL_OWNER = 'local';

export const planMaterializationOwnerId = (ownerId: string | null): string => ownerId ?? LOCAL_OWNER;

export const planStartSessionId = (ownerId: string | null, planId: string): string =>
  `${planMaterializationOwnerId(ownerId)}:${planId.trim()}:start`;

export const planStartCardId = (ownerId: string | null, planExerciseId: string): string =>
  `${planMaterializationOwnerId(ownerId)}:${planExerciseId.trim()}:start`;

export const planStartSetId = (ownerId: string | null, planSetId: string): string =>
  `${planMaterializationOwnerId(ownerId)}:${planSetId.trim()}:start`;

/**
 * Reads the owner the materialization IDs must be composed from. Returns
 * null when no account is signed in; call sites pass that through and the
 * recipes fall back to `local`.
 */
export const readPlanMaterializationOwnerId = async (): Promise<string | null> => {
  const database = await bootstrapLocalDataLayer();
  return readLocalDataOwner(database);
};
