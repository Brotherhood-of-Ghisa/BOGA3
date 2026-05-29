import { eq } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import { nowMonotonic } from './clock';
import { gyms } from './schema';

export type UpsertLocalGymInput = {
  id: string;
  name: string;
  coordinates?:
    | {
        latitude: number;
        longitude: number;
        accuracyM: number;
        updatedAt: Date;
      }
    | null;
  now?: Date;
};

export type LocalGymLookupRecord = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  coordinateAccuracyM: number | null;
  coordinatesUpdatedAt: Date | null;
};

const validateCoordinateNumber = (value: number, label: string, min: number, max: number) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
};

const validateCoordinateAccuracy = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('coordinate accuracy must be a non-negative finite number');
  }
};

const validateCoordinateTimestamp = (value: Date) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()) || value.getTime() < 0) {
    throw new Error('coordinates updated timestamp must be a valid non-negative Date');
  }
};

const normalizeCoordinateInput = (coordinates: UpsertLocalGymInput['coordinates']) => {
  if (coordinates === undefined) {
    return undefined;
  }

  if (coordinates === null) {
    return {
      latitude: null,
      longitude: null,
      coordinateAccuracyM: null,
      coordinatesUpdatedAt: null,
    };
  }

  validateCoordinateNumber(coordinates.latitude, 'latitude', -90, 90);
  validateCoordinateNumber(coordinates.longitude, 'longitude', -180, 180);
  validateCoordinateAccuracy(coordinates.accuracyM);
  validateCoordinateTimestamp(coordinates.updatedAt);

  return {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    coordinateAccuracyM: coordinates.accuracyM,
    coordinatesUpdatedAt: coordinates.updatedAt,
  };
};

export const upsertLocalGym = async (input: UpsertLocalGymInput) => {
  const database = await bootstrapLocalDataLayer();
  const now = input.now ?? new Date();
  const normalizedCoordinates = normalizeCoordinateInput(input.coordinates);

  database.transaction((tx) => {
    const existing = tx.select().from(gyms).where(eq(gyms.id, input.id)).get();

    if (existing) {
      const nextCoordinateFields =
        normalizedCoordinates === undefined
          ? {
              latitude: existing.latitude,
              longitude: existing.longitude,
              coordinateAccuracyM: existing.coordinateAccuracyM,
              coordinatesUpdatedAt: existing.coordinatesUpdatedAt,
            }
          : normalizedCoordinates;

      tx.update(gyms)
        .set({
          name: input.name,
          ...nextCoordinateFields,
          updatedAt: now,
          // Dirty-bit wiring (sync-v2-client t5a, t2 §7.2): every repo write
          // flips local_dirty = 1 and stamps a monotonic timestamp inside the
          // same transaction as the row write.
          localDirty: true,
          localUpdatedAtMs: nowMonotonic(tx),
        })
        .where(eq(gyms.id, input.id))
        .run();
      return;
    }

    const nextCoordinateFields =
      normalizedCoordinates ?? {
        latitude: null,
        longitude: null,
        coordinateAccuracyM: null,
        coordinatesUpdatedAt: null,
      };

    tx.insert(gyms)
      .values({
        id: input.id,
        name: input.name,
        ...nextCoordinateFields,
        createdAt: now,
        updatedAt: now,
        // Dirty-bit wiring (sync-v2-client t5a, t2 §7.2).
        localDirty: true,
        localUpdatedAtMs: nowMonotonic(tx),
      })
      .run();
  });
};

export const loadLocalGymById = async (gymId: string): Promise<LocalGymLookupRecord | null> => {
  const database = await bootstrapLocalDataLayer();
  const row = database
    .select({
      id: gyms.id,
      name: gyms.name,
      latitude: gyms.latitude,
      longitude: gyms.longitude,
      coordinateAccuracyM: gyms.coordinateAccuracyM,
      coordinatesUpdatedAt: gyms.coordinatesUpdatedAt,
    })
    .from(gyms)
    .where(eq(gyms.id, gymId))
    .get();
  return row ?? null;
};
