import type { HealthImportApi, HealthImportApplyResult } from './api';
import { HealthImportError, toImportedActivity } from './mapping';
import type { HealthImportStore } from './storage';
import type { HealthStoreAdapter } from './types';

/** How far back the first import (and every fresh backfill) reads. */
export const BACKFILL_DAYS = 90;
/** Rows per RPC call: well under the server's 1000-row batch cap. */
export const IMPORT_BATCH_SIZE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export type HealthImportRun = {
  userId: string;
  adapter: HealthStoreAdapter;
  api: HealthImportApi;
  store: HealthImportStore;
  now: Date;
  /** False once the signed-in account changed: stop before writing anything more. */
  isCurrent: () => boolean;
};

export type HealthImportOutcome =
  | { status: 'imported'; backfill: boolean; upserted: number; deleted: number; pruned: number }
  | { status: 'stale' };

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

/**
 * One import: read the store's changes since the saved anchor (or the last
 * `BACKFILL_DAYS` without one), upload deletions then upserts in batches, and
 * on a fresh backfill that read any workout close with the complete id list so
 * the server drops what the store no longer has. The anchor advances only after every call
 * succeeded, so a failure re-reads the same changes next time; the server's
 * upsert makes that repeat harmless. Every failure throws.
 */
export const runHealthImport = async (run: HealthImportRun): Promise<HealthImportOutcome> => {
  const saved = run.store.readAnchor(run.userId);
  const since = saved?.since ?? new Date(run.now.getTime() - BACKFILL_DAYS * DAY_MS);
  let changes;
  try {
    changes = await run.adapter.readWorkoutChanges({ anchor: saved?.anchor ?? null, since });
  } catch (error) {
    throw new HealthImportError('READ_FAILED', error instanceof Error ? error.message : 'Apple Health could not be read.');
  }
  const upserts = changes.workouts.filter((workout) => workout.startDate >= since).map(toImportedActivity);

  const totals: HealthImportApplyResult = { upserted: 0, deleted: 0, pruned: 0 };
  const apply = async (input: Parameters<HealthImportApi['apply']>[0]): Promise<boolean> => {
    if (!run.isCurrent()) return false;
    const result = await run.api.apply(input);
    totals.upserted += result.upserted;
    totals.deleted += result.deleted;
    totals.pruned += result.pruned;
    return true;
  };
  for (const deletes of chunks(changes.deletedIds, IMPORT_BATCH_SIZE)) {
    if (!(await apply({ upserts: [], deletes }))) return { status: 'stale' };
  }
  for (const batch of chunks(upserts, IMPORT_BATCH_SIZE)) {
    if (!(await apply({ upserts: batch, deletes: [] }))) return { status: 'stale' };
  }
  // iOS reports denied read access as no workouts at all, so an empty backfill
  // proves nothing is gone: it never prunes the account's server rows.
  if (saved === null && upserts.length > 0) {
    const complete = { upserts: [], deletes: [], completeSince: since.toISOString(), completeIds: upserts.map((row) => row.external_id) };
    if (!(await apply(complete))) return { status: 'stale' };
  }
  if (!run.isCurrent()) return { status: 'stale' };
  run.store.writeAnchor(run.userId, changes.newAnchor, since);
  return { status: 'imported', backfill: saved === null, ...totals };
};
