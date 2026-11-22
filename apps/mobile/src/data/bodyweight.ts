import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { bodyWeightMeasurements, type BodyWeightMeasurement } from './schema';
import { createAsOfWeightResolver, isValidBodyWeightReading, type ResolvedSessionWeight } from '@/src/bodyweight/as-of';
import { healthWeightIdentity, requireDate, validateBodyWeight, type WeightReadingInput } from '@/src/bodyweight/weight-entry';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

type ReadWeightTx = Pick<Transaction, 'select'>;

export const findLatestWeightReading = (tx: ReadWeightTx, at: Date): BodyWeightMeasurement | null => {
  requireDate(at, 'session date');
  return tx.select().from(bodyWeightMeasurements)
    .where(and(isNull(bodyWeightMeasurements.deletedAt), lte(bodyWeightMeasurements.measuredAt, at)))
    .orderBy(desc(bodyWeightMeasurements.measuredAt), asc(bodyWeightMeasurements.id)).all()
    .find(isValidBodyWeightReading) ?? null;
};

/** One timeline read per graph; sessions and sets remain immutable. */
export const loadAsOfWeightResolver = (database: ReadWeightTx) => createAsOfWeightResolver(
  database.select().from(bodyWeightMeasurements).where(isNull(bodyWeightMeasurements.deletedAt)).all(),
);
export const resolveSessionWeights = <T extends { startedAt: Date }>(database: ReadWeightTx, rows: readonly T[]) => {
  if (!rows.length) return [] as (T & ResolvedSessionWeight)[];
  const resolve = loadAsOfWeightResolver(database);
  return rows.map(row => ({ ...row, ...resolve(row.startedAt) }));
};

export const listBodyWeightReadings = async (): Promise<BodyWeightMeasurement[]> => {
  const db = await bootstrapLocalDataLayer();
  return db.select().from(bodyWeightMeasurements).where(or(isNull(bodyWeightMeasurements.deletedAt),
    and(eq(bodyWeightMeasurements.source, 'apple_health'), eq(bodyWeightMeasurements.ignored, true))))
    .orderBy(desc(bodyWeightMeasurements.measuredAt), asc(bodyWeightMeasurements.id)).all();
};

export const readCurrentBodyWeight = async (now = new Date()): Promise<BodyWeightMeasurement | null> => {
  const db = await bootstrapLocalDataLayer();
  return findLatestWeightReading(db, now);
};

export const saveBodyWeightReading = async (input: WeightReadingInput): Promise<BodyWeightMeasurement> => {
  const now = input.now ?? new Date();
  requireDate(now, 'current date');
  requireDate(input.measuredAt, 'measurement date');
  if (input.measuredAt.getTime() > now.getTime()) throw new Error('The measurement date cannot be in the future.');
  const value = validateBodyWeight(input);
  const db = await bootstrapLocalDataLayer();
  const id = input.id ?? `body-weight-${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  const saved = db.transaction(tx => {
    const existing = tx.select().from(bodyWeightMeasurements).where(eq(bodyWeightMeasurements.id, id)).get();
    if (!input.id && existing) throw new Error('Could not create the reading. Try again.');
    if (input.id && (!existing || existing.deletedAt)) throw new Error('This reading is no longer available. Refresh history.');
    if (existing?.source === 'apple_health') throw new Error('Apple Health readings are read-only.');
    const patch = { ...value, measuredAt: input.measuredAt, updatedAt: now,
      localDirty: true, localUpdatedAtMs: nowMonotonic(tx as Transaction),
    };
    if (existing) tx.update(bodyWeightMeasurements).set(patch).where(eq(bodyWeightMeasurements.id, id)).run();
    else tx.insert(bodyWeightMeasurements).values({ id, ...patch, createdAt: now }).run();
    const row = tx.select().from(bodyWeightMeasurements).where(eq(bodyWeightMeasurements.id, id)).get();
    if (!row) throw new Error('The reading could not be saved. Try again.');
    return row;
  });
  notifyLocalWrite();
  invalidateExerciseCatalogCache();
  invalidateBodyWeightContext();
  return saved;
};

export const deleteBodyWeightReading = async (id: string, now = new Date()): Promise<void> => {
  requireDate(now, 'current date');
  const db = await bootstrapLocalDataLayer();
  db.transaction(tx => {
    const existing = tx.select().from(bodyWeightMeasurements).where(eq(bodyWeightMeasurements.id, id)).get();
    if (!existing || existing.deletedAt) return;
    if (existing.source === 'apple_health') throw new Error('Apple Health readings are read-only.');
    tx.update(bodyWeightMeasurements).set({ deletedAt: now, updatedAt: now,
      localDirty: true, localUpdatedAtMs: nowMonotonic(tx as Transaction),
    }).where(eq(bodyWeightMeasurements.id, id)).run();
  });
  notifyLocalWrite();
  invalidateExerciseCatalogCache();
  invalidateBodyWeightContext();
};

/** Ignore is a reversible tombstone, so every existing calculation skips it. */
export const setBodyWeightReadingIgnored = async (id: string, ignored: boolean, now = new Date()): Promise<void> => {
  requireDate(now, 'current date');
  const db = await bootstrapLocalDataLayer();
  db.transaction(tx => {
    const row = tx.select().from(bodyWeightMeasurements).where(eq(bodyWeightMeasurements.id, id)).get();
    if (!row || row.source !== 'apple_health' || (row.deletedAt && !row.ignored)) {
      throw new Error('This reading is no longer available. Refresh history.');
    }
    if (row.ignored === ignored) return;
    tx.update(bodyWeightMeasurements).set({ ignored, deletedAt: ignored ? now : null, updatedAt: now,
      externalId: row.externalId ?? healthWeightIdentity(row.id.slice('apple-health-weight:'.length)).externalId,
      localDirty: true, localUpdatedAtMs: nowMonotonic(tx as Transaction),
    }).where(eq(bodyWeightMeasurements.id, id)).run();
  });
  notifyLocalWrite();
  invalidateExerciseCatalogCache();
  invalidateBodyWeightContext();
};

export type ImportedBodyWeight = { uuid: string; weightKg: number; measuredAt: Date };

/** Caller holds the account/sync lock. Replaying a sample never changes an existing row. */
export function applyImportedBodyWeights(tx: Transaction, readings: readonly ImportedBodyWeight[],
  deletedIds: readonly string[], now: Date): void {
  requireDate(now, 'current date');
  for (const reading of readings) {
    requireDate(reading.measuredAt, 'measurement date');
    if (!Number.isFinite(reading.weightKg) || reading.weightKg <= 0 || reading.measuredAt > now) {
      throw new Error('Apple Health returned an invalid weight measurement.');
    }
    // Fixed source version: even a much later offline import must lose to a
    // user's Ignore/Use choice or source deletion stamped by nowMonotonic.
    tx.insert(bodyWeightMeasurements).values({ ...healthWeightIdentity(reading.uuid),
      source: 'apple_health', weightKg: reading.weightKg, measuredAt: reading.measuredAt,
      ignored: false, deletedAt: null, createdAt: reading.measuredAt, updatedAt: reading.measuredAt,
      localDirty: true, localUpdatedAtMs: 1,
    }).onConflictDoNothing().run();
  }
  for (const uuid of deletedIds) {
    const identity = healthWeightIdentity(uuid);
    const existing = tx.select().from(bodyWeightMeasurements).where(eq(bodyWeightMeasurements.id, identity.id)).get();
    if (existing?.deletedAt && !existing.ignored && existing.externalId !== null) continue;
    const patch = { ignored: false, deletedAt: now, updatedAt: now,
      source: 'apple_health' as const, externalId: identity.externalId,
      localDirty: true, localUpdatedAtMs: nowMonotonic(tx),
    };
    if (existing) tx.update(bodyWeightMeasurements).set(patch).where(eq(bodyWeightMeasurements.id, identity.id)).run();
    // A deletion can arrive before this phone ever saw the sample. Keep an
    // invalid, hidden tombstone so another phone's stale insert cannot revive it.
    else tx.insert(bodyWeightMeasurements).values({ ...identity,
      weightKg: 0, measuredAt: new Date(0), createdAt: new Date(0), ...patch,
    }).run();
  }
}
