// The phone's health-store import (Apple Health today). The adapter is the
// only code that touches the native store; everything else is plain data so
// Jest can drive the import end to end. Contract:
// docs/specs/tech/health-activities-contract.md ("Phone import").

/** A quantity as the store reports it, in the store's own unit. */
export type HealthQuantity = { quantity: number; unit: string };

/** One workout's summary, read from the store. No route, no samples. */
export type HealthWorkout = {
  uuid: string;
  /**
   * The store's activity type name (`traditionalStrengthTraining`), or
   * `type<n>` for a value newer than the library's enum.
   */
  activityType: string;
  startDate: Date;
  endDate: Date;
  durationSeconds: number;
  totalDistance: HealthQuantity | null;
  totalEnergyBurned: HealthQuantity | null;
  averageHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  elevationAscended: HealthQuantity | null;
  sourceName: string | null;
  deviceName: string | null;
};

/** One anchored read: what changed since `anchor` (or everything since `since` without one). */
export type HealthWorkoutChanges = {
  workouts: HealthWorkout[];
  deletedIds: string[];
  newAnchor: string;
};

export type HealthStoreAdapter = {
  /** False where the store does not exist (Android, web, a device without Health). */
  readonly supported: boolean;
  /**
   * Shows the store's permission sheet. Resolves once the sheet is done; the
   * store never says whether reading was allowed, so this returns nothing.
   */
  requestAuthorization(): Promise<void>;
  /** Workouts starting at or after `since` that changed after `anchor` (all of them without one). */
  readWorkoutChanges(input: { anchor: string | null; since: Date }): Promise<HealthWorkoutChanges>;
};

/** The upload shape of `app_public.health_activities_apply`'s upserts. */
export type ImportedActivity = {
  external_id: string;
  activity_type: string;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  distance_m: number | null;
  active_energy_kcal: number | null;
  avg_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  elevation_gain_m: number | null;
  source_name: string | null;
  device_name: string | null;
};
