import type { HealthImportApi, HealthImportApplyInput } from '@/src/health-import/api';
import type { HealthStoreAdapter, HealthWorkout, HealthWorkoutChanges } from '@/src/health-import/types';

/** A store workout with every summary figure; override what a case needs. */
export const healthWorkout = (uuid: string, extra: Partial<HealthWorkout> = {}): HealthWorkout => ({
  uuid,
  activityType: 'running',
  startDate: new Date('2026-11-09T07:00:00.000Z'),
  endDate: new Date('2026-11-09T07:30:00.000Z'),
  durationSeconds: 1800.4,
  totalDistance: { quantity: 5012.3, unit: 'meters' },
  totalEnergyBurned: { quantity: 351.2, unit: 'kcal' },
  averageHeartRateBpm: 148,
  maxHeartRateBpm: 171,
  elevationAscended: { quantity: 22, unit: 'm' },
  sourceName: 'Workout',
  deviceName: 'Apple Watch',
  ...extra,
});

/** A scripted store: each read returns the next queued change set (or throws it). */
export const fakeHealthStore = (supported = true) => {
  const reads: { anchor: string | null; since: Date }[] = [];
  const queue: (HealthWorkoutChanges | Error)[] = [];
  let authorizations = 0;
  let authorizationError: Error | null = null;
  const adapter: HealthStoreAdapter = {
    supported,
    requestAuthorization: async () => {
      authorizations += 1;
      if (authorizationError) throw authorizationError;
    },
    readWorkoutChanges: async (input) => {
      reads.push(input);
      const next = queue.shift() ?? { workouts: [], deletedIds: [], newAnchor: `anchor-${reads.length}` };
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return {
    adapter,
    reads,
    queue: (next: HealthWorkoutChanges | Error) => { queue.push(next); },
    failAuthorization: (error: Error | null) => { authorizationError = error; },
    get authorizations() { return authorizations; },
  };
};

/** Records every RPC call; `failNext` makes the next call throw. */
export const fakeHealthApi = () => {
  const calls: HealthImportApplyInput[] = [];
  let failure: Error | null = null;
  const api: HealthImportApi = {
    apply: async (input) => {
      calls.push(input);
      if (failure) { const error = failure; failure = null; throw error; }
      return { upserted: input.upserts.length, deleted: input.deletes.length, pruned: input.completeSince ? 1 : 0 };
    },
  };
  return { api, calls, failNext: (error: Error) => { failure = error; } };
};
