import { Platform } from 'react-native';

import type { HealthQuantity, HealthStoreAdapter, HealthWorkout, HealthWorkoutChanges } from './types';

// The only module that touches Apple Health (`@kingstinct/react-native-healthkit`).
// It loads the library on iOS only, so Android, web and Jest never evaluate it;
// everything it returns is plain data for the importer.

type HealthKit = typeof import('@kingstinct/react-native-healthkit');
type WorkoutProxy = Awaited<ReturnType<HealthKit['queryWorkoutSamplesWithAnchor']>>['workouts'][number];

const READ_TYPES = [
  'HKWorkoutTypeIdentifier',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierDistanceCycling',
  'HKQuantityTypeIdentifierDistanceSwimming',
] as const;

let kit: HealthKit | null = null;
const loadHealthKit = (): HealthKit => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- iOS-only native module, loaded on first use.
  kit ??= require('@kingstinct/react-native-healthkit') as HealthKit;
  return kit;
};

const quantity = (value: unknown): HealthQuantity | null => {
  const candidate = value as Partial<HealthQuantity> | null | undefined;
  return typeof candidate?.quantity === 'number' && typeof candidate.unit === 'string'
    ? { quantity: candidate.quantity, unit: candidate.unit }
    : null;
};

const toHealthWorkout = async (healthKit: HealthKit, workout: WorkoutProxy): Promise<HealthWorkout> => {
  const heartRate = await workout.getStatistic('HKQuantityTypeIdentifierHeartRate', 'count/min');
  return {
    uuid: workout.uuid,
    activityType: healthKit.WorkoutActivityType[workout.workoutActivityType] ?? `type${workout.workoutActivityType}`,
    startDate: workout.startDate,
    endDate: workout.endDate,
    durationSeconds: workout.duration.quantity,
    totalDistance: quantity(workout.totalDistance),
    totalEnergyBurned: quantity(workout.totalEnergyBurned),
    averageHeartRateBpm: heartRate?.averageQuantity?.quantity ?? null,
    maxHeartRateBpm: heartRate?.maximumQuantity?.quantity ?? null,
    elevationAscended: quantity(workout.metadata?.HKElevationAscended),
    sourceName: workout.sourceRevision?.source?.name ?? null,
    deviceName: workout.device?.name ?? null,
  };
};

/** Heart-rate statistics read concurrently, this many at a time. */
const STATISTICS_BATCH = 16;

/**
 * False rather than a crash when the binary lacks the native module (a dev
 * client built before it was added): the import is optional, the app is not.
 */
const healthDataAvailable = (): boolean => {
  try {
    return loadHealthKit().isHealthDataAvailable();
  } catch (error) {
    console.warn('[health-import] HealthKit is unavailable in this build', error);
    return false;
  }
};

const iosAdapter: HealthStoreAdapter = {
  get supported() {
    return healthDataAvailable();
  },
  requestAuthorization: async () => {
    await loadHealthKit().requestAuthorization({ toRead: READ_TYPES });
  },
  readWorkoutChanges: async ({ anchor, since }): Promise<HealthWorkoutChanges> => {
    const healthKit = loadHealthKit();
    const response = await healthKit.queryWorkoutSamplesWithAnchor({
      limit: 0,
      filter: { date: { startDate: since } },
      ...(anchor !== null ? { anchor } : {}),
    });
    const workouts: HealthWorkout[] = [];
    for (let index = 0; index < response.workouts.length; index += STATISTICS_BATCH) {
      const batch = response.workouts.slice(index, index + STATISTICS_BATCH);
      workouts.push(...await Promise.all(batch.map((workout) => toHealthWorkout(healthKit, workout))));
    }
    return {
      workouts,
      deletedIds: response.deletedSamples.map((sample) => sample.uuid),
      newAnchor: response.newAnchor,
    };
  },
};

const unsupportedAdapter: HealthStoreAdapter = {
  supported: false,
  requestAuthorization: async () => {
    throw new Error('Apple Health is only available on iPhone.');
  },
  readWorkoutChanges: async () => {
    throw new Error('Apple Health is only available on iPhone.');
  },
};

let override: HealthStoreAdapter | null = null;
export const getHealthStoreAdapter = (): HealthStoreAdapter =>
  override ?? (Platform.OS === 'ios' ? iosAdapter : unsupportedAdapter);
export const setHealthStoreAdapterForTests = (adapter: HealthStoreAdapter | null): void => {
  override = adapter;
};
