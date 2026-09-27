import { asc, eq, isNull } from 'drizzle-orm';
import { hasEmptySessionWeight, planSessionWeightBackfill, type BackfillRange, type BackfillRow } from '@/src/bodyweight/backfill';
import { requireDate } from '@/src/bodyweight/weight-entry';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { bodyWeightMeasurements, sessions, type BodyWeightMeasurement, type Session } from './schema';

type Inventory = { sessions: Session[]; readings: BodyWeightMeasurement[] };
type Reader = Pick<Transaction, 'select'>;
const readInventory = (db: Reader): Inventory => ({
  sessions: db.select().from(sessions).where(isNull(sessions.deletedAt)).orderBy(asc(sessions.id)).all(),
  readings: db.select().from(bodyWeightMeasurements).where(isNull(bodyWeightMeasurements.deletedAt))
    .orderBy(asc(bodyWeightMeasurements.id)).all(),
});
// Transport acknowledgement alone does not change a preview's domain inputs.
const fingerprint = <T extends { localDirty: boolean }>(rows: T[]) =>
  JSON.stringify(rows.map(row => ({ ...row, localDirty: undefined })));
const missingSessions = (rows: Session[]) => rows.filter(row => row.status === 'completed' && hasEmptySessionWeight(row));

export type SessionWeightBackfillInventory = {
  rows: BackfillRow[];
  range: BackfillRange;
  readingFingerprint: string;
  sessionFingerprints: Record<string, string>;
  hasReadings: boolean;
};
export type SessionWeightBackfillPreview = SessionWeightBackfillInventory & { selectedIds: string[] };

const describeInventory = (inventory: Inventory, range: BackfillRange): SessionWeightBackfillInventory => ({
  rows: planSessionWeightBackfill(inventory.sessions, inventory.readings, range), range,
  readingFingerprint: fingerprint(inventory.readings), hasReadings: inventory.readings.length > 0,
  sessionFingerprints: Object.fromEntries(missingSessions(inventory.sessions).map(row => [row.id, fingerprint([row])])),
});

export const loadSessionWeightBackfill = async (range: BackfillRange): Promise<SessionWeightBackfillInventory> =>
  describeInventory(readInventory(await bootstrapLocalDataLayer()), range);

export function previewSessionWeightBackfill(
  inventory: SessionWeightBackfillInventory, selectedIds: string[],
): SessionWeightBackfillPreview {
  if (selectedIds.length === 0) throw new Error('Select at least one session.');
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error('Select each session once.');
  for (const id of selectedIds) {
    const row = inventory.rows.find(candidate => candidate.sessionId === id);
    if (!row) throw new Error('This session is outside the preview. Refresh the selection.');
    if (row.status !== 'ready') throw new Error(row.reason);
  }
  return { ...inventory, selectedIds: [...selectedIds], rows: inventory.rows.filter(row => selectedIds.includes(row.sessionId)) };
}

/** Atomic local revalidation. Cross-device conflict resolution is ordinary Sync v2 LWW. */
export async function applySessionWeightBackfill(
  preview: SessionWeightBackfillPreview, now = new Date(),
): Promise<{ filled: number; skipped: number }> {
  requireDate(now, 'current date');
  const db = await bootstrapLocalDataLayer();
  const result = db.transaction((tx: Transaction) => {
    const inventory = readInventory(tx);
    const current = describeInventory(inventory, preview.range);
    const byId = new Map(inventory.sessions.map(row => [row.id, row]));
    const selected = preview.selectedIds;
    if (new Set(selected).size !== selected.length || selected.length === 0) throw new Error('Refresh the selection.');
    if (selected.some(id => !preview.sessionFingerprints[id] || !preview.rows.some(row => row.sessionId === id))) {
      throw new Error('Refresh the selection.');
    }
    const pending = selected.filter(id => {
      const row = byId.get(id);
      // A deleted selected session is reported as skipped, never recreated.
      if (!row) return false;
      if (row.status !== 'completed') throw new Error('The selected sessions changed. Refresh the preview.');
      return hasEmptySessionWeight(row);
    });
    // Repeating an applied preview is a no-op, even after a later weigh-in.
    if (pending.length === 0) return { filled: 0, skipped: selected.length };
    if (current.readingFingerprint !== preview.readingFingerprint) {
      throw new Error('Weight readings changed. Refresh the preview before applying.');
    }
    // A concurrently filled snapshot is preserved; every other missing-session
    // input and membership must still match the inventory used for the preview.
    const before = { ...preview.sessionFingerprints };
    for (const [id, row] of byId) if (!hasEmptySessionWeight(row)) delete before[id];
    for (const id of selected) if (!byId.has(id)) delete before[id];
    if (JSON.stringify(before) !== JSON.stringify(current.sessionFingerprints)) {
      throw new Error('Sessions changed. Refresh the preview before applying.');
    }
    const verified = previewSessionWeightBackfill(current, pending);
    for (const row of verified.rows) {
      if (row.status !== 'ready') throw new Error('Refresh the preview before applying.');
      tx.update(sessions).set({ ...row.snapshot, localBodyweightMetadataKnown: true,
        localDirty: true, localUpdatedAtMs: nowMonotonic(tx), updatedAt: now })
        .where(eq(sessions.id, row.sessionId)).run();
    }
    return { filled: verified.rows.length, skipped: selected.length - pending.length };
  });
  if (result.filled > 0) notifyLocalWrite();
  return result;
}
