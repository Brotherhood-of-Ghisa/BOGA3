import { eq } from 'drizzle-orm';
import NetInfo from '@react-native-community/netinfo';

import { getMobileAuthRuntimeConfig } from '@/src/auth/supabase';
import { getSignedInUserId } from '@/src/auth/session-user';
import { bootstrapLocalDataLayer, type LocalDatabase } from '@/src/data/bootstrap';
import { deleteMergeLocal, listMergeLocal, readMergeLocal, writeMergeLocal } from '@/src/data/exercise-merge-store';
import { sessions } from '@/src/data/schema';
import { getAccountLocalPreferenceState } from '@/src/preferences/account-local';
import { formatLocalDateTime } from '@/src/utils/local-time';
import { readLocalDataOwner } from '@/src/data/local-wipe';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import type { MergePreview, MergeReviewItem } from '@/src/exercise-core/merge-types';
import { withLocalDataLock } from '@/src/sync/account-wipe';
import { runSyncCycle } from '@/src/sync/cycle';
import { mergeRpc, refreshMergeReview, uploadMergePending } from '@/src/sync/exercise-merge';

export type PendingMerge = { id: string; preview: MergePreview };

async function mergeAccount(): Promise<{ owner: string; database: LocalDatabase }> {
  const owner = getMobileAuthRuntimeConfig().isConfigured ? await getSignedInUserId() : null;
  if (!owner) throw new Error('Sign in to merge exercises.');
  const database = await bootstrapLocalDataLayer();
  if (readLocalDataOwner(database) !== owner) throw new Error('Wait for your account to finish syncing.');
  return { owner, database };
}
async function requireConnection(): Promise<void> {
  const network = await NetInfo.fetch();
  if (network.isConnected === false) throw new Error('Connect to merge exercises.');
}
async function syncBeforeMerge(): Promise<void> {
  const outcome = await runSyncCycle();
  if (outcome !== 'converged') throw new Error('Sync could not finish. Retry before merging.');
}

export async function prepareExerciseMerge(sourceId: string, destinationId: string): Promise<MergePreview> {
  const initialOwner = (await mergeAccount()).owner;
  await requireConnection();
  await syncBeforeMerge();
  const { owner, database } = await mergeAccount();
  if (owner !== initialOwner) throw new Error('Your account changed. Open the exercise again.');
  if (readMergeLocal(database, owner, 'operation')) throw new Error('Check the previous merge result in Data & Sync first.');
  return withLocalDataLock(async () => {
    let preview: MergePreview;
    try { preview = await mergeRpc<MergePreview>('exercise_merge_preview', { p_source: sourceId, p_destination: destinationId }, owner); }
    catch (failure) {
      const prefix = 'VALIDATION: correct stored weights in session ';
      if (failure instanceof Error && failure.message.startsWith(prefix)) {
        const session = database.select().from(sessions).where(eq(sessions.id, failure.message.slice(prefix.length))).get();
        if (session) throw new Error('Correct stored weights in the session on ' +
          formatLocalDateTime(session.startedAt.getTime(), getAccountLocalPreferenceState().values.dateFormat) + ' before merging.');
      }
      throw failure;
    }
    if (!preview || preview.sourceId !== sourceId || preview.destinationId !== destinationId ||
        !Number.isSafeInteger(preview.setCount) || ![0.5, 1, 2].includes(preview.factor) ||
        typeof preview.token !== 'string') throw new Error('Unable to prepare this merge.');
    if (await getSignedInUserId() !== owner) throw new Error('Your account changed. Open the exercise again.');
    return preview;
  });
}

function operationId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const digit = Math.floor(Math.random() * 16);
    return (char === 'x' ? digit : (digit & 3) | 8).toString(16);
  });
}

async function submitMerge(pending: PendingMerge, owner: string): Promise<void> {
  const result = await mergeRpc<{ id: string } | null>('exercise_merge_status', { p_id: pending.id }, owner);
  if (!result) await mergeRpc('exercise_merge_execute', {
    p_id: pending.id, p_source: pending.preview.sourceId,
    p_destination: pending.preview.destinationId, p_token: pending.preview.token,
  }, owner);
}

export async function executeExerciseMerge(preview: MergePreview): Promise<void> {
  await requireConnection();
  const { owner, database } = await mergeAccount();
  await withLocalDataLock(async () => {
    let pending = readMergeLocal<PendingMerge>(database, owner, 'operation');
    if (pending && (pending.preview.sourceId !== preview.sourceId || pending.preview.destinationId !== preview.destinationId)) {
      throw new Error('Check the previous merge result in Data & Sync first.');
    }
    pending ??= { id: operationId(), preview };
    const operation = pending;
    database.transaction(tx => writeMergeLocal(tx, { ownerUserId: owner, id: 'operation', kind: 'operation', payload: operation }));
    try {
      await submitMerge(operation, owner);
    } catch (error) {
      // A confirmed server refusal is safe to re-prepare; a transport failure keeps the same ID.
      if (error instanceof Error && /MERGE_STALE|VALIDATION|NOT_FOUND|CONFLICT:/.test(error.message)) {
        database.transaction(tx => deleteMergeLocal(tx, owner, 'operation'));
      }
      throw error;
    }
  });
  await syncBeforeMerge();
  invalidateExerciseCatalogCache();
}

export async function recoverExerciseMerge(): Promise<void> {
  const { owner, database } = await mergeAccount();
  const pending = readMergeLocal<PendingMerge>(database, owner, 'operation');
  if (pending) await executeExerciseMerge(pending.preview);
}

export async function loadMergeReview(): Promise<{ items: MergeReviewItem[]; pending: number; operation: boolean; error: string | null }> {
  const { owner, database } = await mergeAccount();
  let error: string | null = null;
  const network = await NetInfo.fetch();
  if (network.isConnected !== false) {
    try { await withLocalDataLock(async () => {
      await uploadMergePending(database, owner);
      await refreshMergeReview(database, owner);
    }); } catch (failure) { error = failure instanceof Error ? failure.message : 'Unable to refresh saved changes.'; }
  }
  if (await getSignedInUserId() !== owner || readLocalDataOwner(database) !== owner) throw new Error('Your account changed. Open the exercise again.');
  return {
    error,
    items: readMergeLocal<MergeReviewItem[]>(database, owner, 'conflicts') ?? [],
    pending: listMergeLocal(database, owner, 'pending').length,
    operation: readMergeLocal(database, owner, 'operation') !== null,
  };
}

export async function resolveMergeReview(item: MergeReviewItem, keep: boolean): Promise<void> {
  await requireConnection();
  const { owner, database } = await mergeAccount();
  await withLocalDataLock(() => mergeRpc('exercise_merge_resolve', { p_id: item.id, p_keep: keep, p_token: item.token }, owner));
  await syncBeforeMerge();
  await refreshMergeReview(database, owner);
  invalidateExerciseCatalogCache();
}

export function mergeConfirmationText(preview: MergePreview): string {
  const warning = preview.factor === 0.5 ? ' Weights will be halved.' : preview.factor === 2 ? ' Weights will be doubled.' : '';
  return 'Move ' + preview.setCount + (preview.setCount === 1 ? ' set' : ' sets') + ' from ' +
    preview.sourceName + ' to ' + preview.destinationName + ' and delete ' + preview.sourceName +
    '? This cannot be undone.' + warning;
}
