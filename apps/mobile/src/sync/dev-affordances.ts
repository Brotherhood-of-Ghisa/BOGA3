// Developer-only escape hatches for debugging the sync cycle without
// reinstalling the app.
//
//   - wipeLocalAndReBootstrap: drop the local SQLite database and re-run the
//     boot data layer (migrations, then the marker-gated starter-catalog seed).
//     The dropped database loses the first-sync flag, so the next sync cycle
//     re-enters the first-sign-in bootstrapper, which re-pulls the user's server
//     state into the fresh local store (and re-seeds the starter catalog only
//     when the server holds nothing for the user).
//   - wipeRemoteForCurrentUser: ask a server-side helper to delete every row
//     owned by the signed-in user, then wipe local so the freshly-cleaned
//     server is not immediately re-populated by a push of the local rows.
//
// Both helpers are gated on `isDevMode()` rather than the bare `__DEV__`
// global: `__DEV__` is false in the internally-distributed developer build,
// which is exactly the build that needs these tools. `isDevMode()` stays true
// there. The guards throw synchronously (before any I/O) so a release build
// can never reach the destructive code path even if a caller forgets to gate
// the call site.

import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import { bootstrapLocalDataLayer, resetLocalAppData } from '@/src/data/bootstrap';
import { isDevMode } from '@/src/utils/isDevMode';

/** The server-side helper that deletes every row owned by the caller. */
const DEV_WIPE_REMOTE_RPC = 'dev_wipe_my_data';

/**
 * The Postgres schema the helper RPC lives in. PostgREST exposes it under this
 * schema rather than the default `public`, so the client must select it before
 * dispatching or the call fails to resolve the function.
 */
const DEV_WIPE_REMOTE_SCHEMA = 'app_public';

const DEV_ONLY_MESSAGE =
  'This is a developer-only tool and must not run in release builds.';

/** Throws immediately, on the calling stack, when not in developer mode. */
const assertDevModeSync = (): void => {
  if (isDevMode() !== true) {
    throw new Error(DEV_ONLY_MESSAGE);
  }
};

/**
 * Drops the local SQLite database and re-bootstraps the data layer (runs
 * migrations, then the marker-gated starter-catalog seed). In a sync-configured
 * build that seed is a no-op — the dropped database loses the first-sync flag,
 * so the next sync cycle's first-sign-in bootstrapper decides whether to re-seed
 * the starter catalog (muscle_groups, exercise_definitions, and their mappings)
 * based on the server's state, recovering the user's own catalog rather than
 * re-creating starter rows. The bootstrap and reset paths are serialized behind
 * a single lock in the data layer, so re-bootstrapping after the reset is safe
 * and never interleaves with the reset's own native close/delete calls.
 *
 * The dev-mode guard runs synchronously, on the caller's stack, BEFORE any
 * async work is scheduled — so a release build that somehow reaches this call
 * throws at the call site rather than entering the destructive path and
 * rejecting a tick later. (A guard inside the async body would only surface as
 * a rejected promise; the synchronous wrapper is deliberate.)
 */
export const wipeLocalAndReBootstrap = (): Promise<void> => {
  assertDevModeSync();
  return runWipeLocalAndReBootstrap();
};

const runWipeLocalAndReBootstrap = async (): Promise<void> => {
  await resetLocalAppData();
  await bootstrapLocalDataLayer();
};

/** The shape the server helper returns: how many rows it removed. */
export interface WipeRemoteResult {
  rowsDeleted: number;
}

/**
 * Calls the server-side helper that deletes every row owned by the signed-in
 * user across all synced entity tables, in a single transaction. Returns the
 * number of rows the server removed.
 *
 * This only clears the remote copy. Callers that also want a clean local store
 * should follow this with `wipeLocalAndReBootstrap()` so the local rows are not
 * re-pushed on the next sync cycle.
 *
 * The dev-mode guard runs synchronously, on the caller's stack, before the
 * network request is issued (see `wipeLocalAndReBootstrap` for the rationale).
 */
export const wipeRemoteForCurrentUser = (): Promise<WipeRemoteResult> => {
  assertDevModeSync();
  return runWipeRemoteForCurrentUser();
};

const runWipeRemoteForCurrentUser = async (): Promise<WipeRemoteResult> => {
  const client = getRequiredSupabaseMobileClient();
  const { data, error } = await client.schema(DEV_WIPE_REMOTE_SCHEMA).rpc(DEV_WIPE_REMOTE_RPC);

  if (error) {
    throw new Error(error.message ?? 'Failed to wipe remote data.');
  }

  return { rowsDeleted: coerceRowsDeleted(data) };
};

/**
 * The helper returns a count. PostgREST may surface a scalar return either as
 * a bare number or wrapped in an object/array, so normalize defensively and
 * fall back to 0 when the shape is unexpected.
 */
const coerceRowsDeleted = (data: unknown): number => {
  if (typeof data === 'number' && Number.isFinite(data)) {
    return data;
  }

  if (data && typeof data === 'object') {
    const record = Array.isArray(data) ? data[0] : (data as Record<string, unknown>);
    const candidate =
      record && typeof record === 'object'
        ? (record as Record<string, unknown>).rows_deleted ??
          (record as Record<string, unknown>).rowsDeleted
        : undefined;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return 0;
};
