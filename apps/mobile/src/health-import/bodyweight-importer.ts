import { eq } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { applyImportedBodyWeights } from '@/src/data/bodyweight';
import type { Transaction } from '@/src/data/clock';
import { readLocalDataOwner } from '@/src/data/local-wipe';
import { syncRuntimeState } from '@/src/data/schema';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { requireDate } from '@/src/bodyweight/weight-entry';
import { withLocalDataLock } from '@/src/sync/account-wipe';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import type { BodyWeightImportStore } from './bodyweight-storage';
import type { BodyWeightHealthStoreAdapter } from './types';

/** Native reads run outside the account lock; committing data and cursor holds it. */
export async function runBodyWeightImport(input: {
  userId: string; store: BodyWeightImportStore; adapter: BodyWeightHealthStoreAdapter;
  now: () => Date; isCurrent: () => boolean;
}): Promise<boolean> {
  const settings = input.store.read(input.userId);
  if (!settings.enabled || settings.since === null || !input.isCurrent()) return false;
  const since = new Date(settings.since);
  const changes = await input.adapter.readChanges({ anchor: settings.anchor, since });
  for (const sample of changes.samples) requireDate(sample.measuredAt, 'measurement date');
  const samples = changes.samples.filter(sample => sample.measuredAt >= since);
  return withLocalDataLock(async () => {
    const db = await bootstrapLocalDataLayer();
    if (!input.isCurrent() || readLocalDataOwner(db) !== input.userId) return false;
    const runtime = db.select().from(syncRuntimeState).where(eq(syncRuntimeState.id, 'primary')).get();
    if (!runtime?.bootstrapCompletedAt) return false;
    db.transaction(tx => applyImportedBodyWeights(tx as Transaction, samples, changes.deletedIds, input.now()));
    // Empty reads can mean denied access. Do not anchor them before the first
    // sample: a later permission grant must still read from the original cutoff.
    if (samples.length || changes.deletedIds.length) {
      input.store.write(input.userId, { ...input.store.read(input.userId), anchor: changes.newAnchor });
    }
    if (samples.length || changes.deletedIds.length) {
      notifyLocalWrite();
      invalidateExerciseCatalogCache();
      invalidateBodyWeightContext();
    }
    return true;
  });
}
