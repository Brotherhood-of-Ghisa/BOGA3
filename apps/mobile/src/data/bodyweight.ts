import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';

import { bootstrapLocalDataLayer, type LocalDatabase } from './bootstrap';
import { nowMonotonic, type Transaction } from './clock';
import { bodyWeightMeasurements, sessions, type BodyWeightMeasurement } from './schema';
import { EMPTY_SESSION_WEIGHT, isValidBodyWeightReading, requireDate, validateBodyWeight,
  type SessionWeightSnapshot, type WeightEntry, type WeightReadingInput } from '@/src/bodyweight/weight-entry';
import { notifyLocalWrite } from '@/src/sync/write-nudge';

type ReadWeightTx = Pick<Transaction, 'select'>;

export const findLatestWeightReading = (tx: ReadWeightTx, at: Date): BodyWeightMeasurement | null => {
  requireDate(at, 'session date');
  return tx.select().from(bodyWeightMeasurements)
    .where(and(isNull(bodyWeightMeasurements.deletedAt), lte(bodyWeightMeasurements.measuredAt, at)))
    .orderBy(desc(bodyWeightMeasurements.measuredAt), asc(bodyWeightMeasurements.id)).limit(1).get() ?? null;
};

/** Called only for a new session, inside the transaction that creates it. */
export const captureSessionWeight = (tx: ReadWeightTx, startedAt: Date): SessionWeightSnapshot => {
  const reading = findLatestWeightReading(tx, startedAt);
  if (!reading || !isValidBodyWeightReading(reading)) return { ...EMPTY_SESSION_WEIGHT };
  return { bodyWeightKg: reading.weightKg, bodyWeightSource: 'reading',
    bodyWeightMeasurementId: reading.id, bodyWeightMeasuredAt: reading.measuredAt,
  };
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
};

/** An explicit correction supplies the whole frozen tuple, never a live link. */
export const correctSessionBodyWeight = async (
  sessionId: string, input: WeightEntry, now = new Date(),
): Promise<SessionWeightSnapshot> => {
  requireDate(now, 'current date');
  const { weightKg } = validateBodyWeight(input);
  const db: LocalDatabase = await bootstrapLocalDataLayer();
  const snapshot: SessionWeightSnapshot = { bodyWeightKg: weightKg, bodyWeightSource: 'manual',
    bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null,
  };
  db.transaction(tx => {
    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session || session.deletedAt) throw new Error('This session is no longer available.');
    tx.update(sessions).set({ ...snapshot, localBodyweightMetadataKnown: true,
      updatedAt: now, localDirty: true, localUpdatedAtMs: nowMonotonic(tx as Transaction),
    }).where(eq(sessions.id, sessionId)).run();
  });
  notifyLocalWrite();
  return snapshot;
};
