import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { bodyWeightMeasurements, type BodyWeightMeasurement } from './schema';
import { createAsOfWeightResolver, type ResolvedSessionWeight } from '@/src/bodyweight/as-of';
import { requireDate, validateBodyWeight, type WeightReadingInput } from '@/src/bodyweight/weight-entry';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

type ReadWeightTx = Pick<Transaction, 'select'>;

export const findLatestWeightReading = (tx: ReadWeightTx, at: Date): BodyWeightMeasurement | null => {
  requireDate(at, 'session date');
  return tx.select().from(bodyWeightMeasurements)
    .where(and(isNull(bodyWeightMeasurements.deletedAt), lte(bodyWeightMeasurements.measuredAt, at)))
    .orderBy(desc(bodyWeightMeasurements.measuredAt), asc(bodyWeightMeasurements.id)).limit(1).get() ?? null;
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
  return db.select().from(bodyWeightMeasurements).where(isNull(bodyWeightMeasurements.deletedAt))
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
    tx.update(bodyWeightMeasurements).set({ deletedAt: now, updatedAt: now,
      localDirty: true, localUpdatedAtMs: nowMonotonic(tx as Transaction),
    }).where(eq(bodyWeightMeasurements.id, id)).run();
  });
  notifyLocalWrite();
  invalidateExerciseCatalogCache();
  invalidateBodyWeightContext();
};
