import type { HealthQuantity, HealthWorkout, ImportedActivity } from './types';

/** A workout the server would reject; the import stops instead of dropping it. */
export class HealthImportError extends Error {
  constructor(readonly code: 'INVALID_WORKOUT' | 'UPLOAD_FAILED' | 'READ_FAILED' | 'AUTH_REQUIRED', message: string) {
    super(message);
    this.name = 'HealthImportError';
  }
}

/** `traditionalStrengthTraining` → `traditional_strength_training`, the server's activity type form. */
export const activityTypeName = (storeName: string): string => {
  const snake = storeName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Za-z])([0-9])/g, '$1_$2')
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(snake)) {
    throw new HealthImportError('INVALID_WORKOUT', `Unsupported workout type name: ${storeName}`);
  }
  return snake;
};

const DISTANCE_TO_METRES: Record<string, number> = { m: 1, meters: 1, km: 1000, cm: 0.01, ft: 0.3048, yd: 0.9144, mi: 1609.344 };
const ENERGY_TO_KCAL: Record<string, number> = { kcal: 1, Cal: 1, cal: 0.001, kJ: 1 / 4.184, J: 1 / 4184 };

const converted = (value: HealthQuantity | null, factors: Record<string, number>, label: string): number | null => {
  if (value === null) return null;
  const factor = factors[value.unit];
  if (factor === undefined || !Number.isFinite(value.quantity)) {
    throw new HealthImportError('INVALID_WORKOUT', `Unsupported ${label} unit: ${value.unit}`);
  }
  return value.quantity * factor;
};

const name = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
};

const heartRate = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) && value > 0 ? value : null;

/**
 * One store workout as the server's upsert. Missing figures stay null; a
 * figure in a unit the importer does not know fails loud rather than being
 * guessed. A heart rate of zero or less means none was recorded.
 */
export const toImportedActivity = (workout: HealthWorkout): ImportedActivity => {
  const start = workout.startDate.getTime();
  const end = workout.endDate.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new HealthImportError('INVALID_WORKOUT', `Workout ${workout.uuid} ends before it starts.`);
  }
  return {
    external_id: workout.uuid,
    activity_type: activityTypeName(workout.activityType),
    started_at: workout.startDate.toISOString(),
    ended_at: workout.endDate.toISOString(),
    duration_sec: Math.max(0, Math.round(workout.durationSeconds)),
    distance_m: converted(workout.totalDistance, DISTANCE_TO_METRES, 'distance'),
    active_energy_kcal: converted(workout.totalEnergyBurned, ENERGY_TO_KCAL, 'energy'),
    avg_heart_rate_bpm: heartRate(workout.averageHeartRateBpm),
    max_heart_rate_bpm: heartRate(workout.maxHeartRateBpm),
    elevation_gain_m: converted(workout.elevationAscended, DISTANCE_TO_METRES, 'elevation'),
    source_name: name(workout.sourceName),
    device_name: name(workout.deviceName),
  };
};
