/**
 * The Apple Health adapter over `@kingstinct/react-native-healthkit` (mocked:
 * Jest has no HealthKit): read-only authorization, the anchored, date-bounded
 * workout query, and each workout's summary as plain data. Android has none.
 */
import { Platform } from 'react-native';

const mockKit = {
  isHealthDataAvailable: jest.fn(() => true),
  requestAuthorization: jest.fn(async (_request: unknown) => true),
  queryWorkoutSamplesWithAnchor: jest.fn(),
  WorkoutActivityType: { 37: 'running', 50: 'traditionalStrengthTraining', running: 37, traditionalStrengthTraining: 50 } as Record<string | number, string | number>,
};
jest.mock('@kingstinct/react-native-healthkit', () => mockKit);

const proxy = (extra: Record<string, unknown> = {}) => ({
  uuid: 'HK-1',
  workoutActivityType: 37,
  startDate: new Date('2026-11-09T07:00:00.000Z'),
  endDate: new Date('2026-11-09T07:30:00.000Z'),
  duration: { quantity: 1800, unit: 's' },
  totalDistance: { quantity: 5000, unit: 'meters' },
  totalEnergyBurned: { quantity: 350, unit: 'kcal' },
  metadata: { HKElevationAscended: { quantity: 21, unit: 'm' } },
  sourceRevision: { source: { name: 'Workout' } },
  device: { name: 'Apple Watch' },
  getStatistic: jest.fn(async () => ({ averageQuantity: { quantity: 150, unit: 'count/min' }, maximumQuantity: { quantity: 175, unit: 'count/min' } })),
  ...extra,
});

const loadAdapter = () => {
  let adapter: typeof import('@/src/health-import/native-adapter') | undefined;
  jest.isolateModules(() => { adapter = require('@/src/health-import/native-adapter'); });
  return adapter!.getHealthStoreAdapter();
};

const originalOS = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.clearAllMocks();
});

describe('on iOS', () => {
  beforeEach(() => { Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true }); });

  it('asks to read workouts and their heart rate, energy and distance, and never to write', async () => {
    await loadAdapter().requestAuthorization();
    expect(mockKit.requestAuthorization).toHaveBeenCalledWith({ toRead: [
      'HKWorkoutTypeIdentifier', 'HKQuantityTypeIdentifierHeartRate', 'HKQuantityTypeIdentifierActiveEnergyBurned',
      'HKQuantityTypeIdentifierDistanceWalkingRunning', 'HKQuantityTypeIdentifierDistanceCycling',
      'HKQuantityTypeIdentifierDistanceSwimming',
    ] });
  });

  it('reports availability from HealthKit', () => {
    mockKit.isHealthDataAvailable.mockReturnValueOnce(false);
    expect(loadAdapter().supported).toBe(false);
  });

  it('queries every workout since the backfill start after the anchor, and maps each summary', async () => {
    const workout = proxy();
    mockKit.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      workouts: [workout], deletedSamples: [{ uuid: 'HK-0' }], newAnchor: 'anchor-2',
    });
    const since = new Date('2026-08-12T12:00:00.000Z');

    await expect(loadAdapter().readWorkoutChanges({ anchor: 'anchor-1', since })).resolves.toEqual({
      workouts: [{
        uuid: 'HK-1', activityType: 'running',
        startDate: new Date('2026-11-09T07:00:00.000Z'), endDate: new Date('2026-11-09T07:30:00.000Z'),
        durationSeconds: 1800, totalDistance: { quantity: 5000, unit: 'meters' },
        totalEnergyBurned: { quantity: 350, unit: 'kcal' }, averageHeartRateBpm: 150, maxHeartRateBpm: 175,
        elevationAscended: { quantity: 21, unit: 'm' }, sourceName: 'Workout', deviceName: 'Apple Watch',
      }],
      deletedIds: ['HK-0'],
      newAnchor: 'anchor-2',
    });
    expect(mockKit.queryWorkoutSamplesWithAnchor).toHaveBeenCalledWith({ limit: 0, filter: { date: { startDate: since } }, anchor: 'anchor-1' });
    expect(workout.getStatistic).toHaveBeenCalledWith('HKQuantityTypeIdentifierHeartRate', 'count/min');
  });

  it('omits the anchor on a fresh backfill and keeps missing figures null', async () => {
    mockKit.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      workouts: [proxy({
        workoutActivityType: 999, totalDistance: undefined, totalEnergyBurned: undefined, metadata: {},
        device: undefined, sourceRevision: undefined, getStatistic: jest.fn(async () => undefined),
      })],
      deletedSamples: [], newAnchor: 'anchor-1',
    });
    const since = new Date('2026-08-12T12:00:00.000Z');
    const [workout] = (await loadAdapter().readWorkoutChanges({ anchor: null, since })).workouts;

    expect(mockKit.queryWorkoutSamplesWithAnchor).toHaveBeenCalledWith({ limit: 0, filter: { date: { startDate: since } } });
    expect(workout).toMatchObject({
      activityType: 'type999', totalDistance: null, totalEnergyBurned: null, elevationAscended: null,
      averageHeartRateBpm: null, maxHeartRateBpm: null, sourceName: null, deviceName: null,
    });
  });
});

it('is unsupported off iOS and never loads HealthKit', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  const adapter = loadAdapter();
  expect(adapter.supported).toBe(false);
  await expect(adapter.requestAuthorization()).rejects.toThrow('only available on iPhone');
  await expect(adapter.readWorkoutChanges({ anchor: null, since: new Date() })).rejects.toThrow('only available on iPhone');
  expect(mockKit.isHealthDataAvailable).not.toHaveBeenCalled();
});
