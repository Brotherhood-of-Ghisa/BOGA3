/**
 * The Apple Health import's triggers and state (`src/health-import/lifecycle.ts`):
 * enabling shows the permission sheet then imports; foreground imports while
 * enabled; an account switch or sign-out discards the anchor; failures stay
 * visible until an import succeeds. The store and the server are faked.
 */
import { AppState, type AppStateStatus } from 'react-native';

import {
  __resetHealthImportForTests, __setHealthImportDepsForTests, disableHealthImport, enableHealthImport,
  getHealthImportSnapshot, importHealthActivitiesNow, startHealthImportLifecycle,
} from '@/src/health-import/lifecycle';
import { setHealthStoreAdapterForTests } from '@/src/health-import/native-adapter';
import { healthImportStore } from '@/src/health-import/storage';

import { fakeHealthApi, fakeHealthStore, healthWorkout } from './helpers/health-import-fakes';

const mockAuth = { userId: 'user-a' as string | null, listeners: new Set<() => void>() };
jest.mock('@/src/auth/service', () => ({
  getAuthSnapshot: () => ({ user: mockAuth.userId ? { id: mockAuth.userId } : null }),
  subscribeToAuthState: (listener: () => void) => {
    mockAuth.listeners.add(listener);
    return () => { mockAuth.listeners.delete(listener); };
  },
}));
const mockLog = jest.fn();
jest.mock('@/src/logging', () => ({ logEvent: (...args: unknown[]) => mockLog(...args) }));

const SINCE = new Date('2026-08-12T12:00:00.000Z');
const NOW = new Date('2026-11-10T12:00:00.000Z');
let appStateListener: ((state: AppStateStatus) => void) | null = null;
/** Lets the start-up import (started without a handle) finish. */
const settle = async () => {
  for (let round = 0; round < 20 && getHealthImportSnapshot().busy !== false; round += 1) await new Promise(setImmediate);
  for (let round = 0; round < 5; round += 1) await new Promise(setImmediate);
};

const signInAs = (userId: string | null) => {
  mockAuth.userId = userId;
  for (const listener of mockAuth.listeners) listener();
};

const setup = (supported = true) => {
  const store = fakeHealthStore(supported);
  const server = fakeHealthApi();
  setHealthStoreAdapterForTests(store.adapter);
  __setHealthImportDepsForTests({ api: server.api, now: () => NOW });
  return { store, server };
};

beforeEach(() => {
  __resetHealthImportForTests();
  mockAuth.userId = 'user-a';
  mockAuth.listeners.clear();
  mockLog.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: () => { appStateListener = null; } } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(() => {
  setHealthStoreAdapterForTests(null);
  jest.restoreAllMocks();
});

it('enabling shows the permission sheet, then backfills, and the switch stays on', async () => {
  const { store, server } = setup();
  startHealthImportLifecycle();
  expect(getHealthImportSnapshot()).toMatchObject({ supported: true, signedIn: true, enabled: false });

  store.queue({ workouts: [healthWorkout('a')], deletedIds: [], newAnchor: 'anchor-1' });
  await enableHealthImport();

  expect(store.authorizations).toBe(1);
  expect(server.calls.at(-1)).toMatchObject({ completeIds: ['a'] });
  expect(getHealthImportSnapshot()).toMatchObject({ enabled: true, enabling: false, busy: false, error: null });
  expect(healthImportStore.readEnabled('user-a')).toBe(true);
  expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'health_import.completed' }));
});

it('imports nothing until the person turns it on', async () => {
  const { store, server } = setup();
  startHealthImportLifecycle();
  appStateListener?.('active');
  await importHealthActivitiesNow();
  expect(store.reads).toEqual([]);
  expect(server.calls).toEqual([]);
});

it('imports on every foreground while enabled, from the saved anchor', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
  startHealthImportLifecycle();
  await importHealthActivitiesNow();

  appStateListener?.('background');
  appStateListener?.('active');
  await importHealthActivitiesNow();
  expect(store.reads.length).toBeGreaterThanOrEqual(2);
  expect(store.reads[0]).toEqual({ anchor: 'anchor-1', since: SINCE });
});

it('runs one import at a time and queues one more behind it', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  startHealthImportLifecycle();
  const first = importHealthActivitiesNow();
  void importHealthActivitiesNow();
  void importHealthActivitiesNow();
  await first;
  // The start-up import, then one queued rerun for the two extra calls.
  expect(store.reads).toHaveLength(2);
});

it('shows a failure until the next import succeeds, and never claims success', async () => {
  const { store, server } = setup();
  healthImportStore.writeEnabled('user-a', true);
  healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
  store.queue({ workouts: [healthWorkout('a')], deletedIds: [], newAnchor: 'anchor-2' });
  server.failNext(new Error('timeout'));
  startHealthImportLifecycle();
  await settle();

  expect(getHealthImportSnapshot()).toMatchObject({ error: 'Workouts could not be sent.', busy: false });
  expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'health_import.failed', message: 'timeout' }));
  expect(healthImportStore.readAnchor('user-a')?.anchor).toBe('anchor-1');

  await importHealthActivitiesNow();
  expect(getHealthImportSnapshot()).toMatchObject({ error: null });
  expect(healthImportStore.readAnchor('user-a')?.anchor).not.toBe('anchor-1');
});

it('names a store read failure', async () => {
  const [failure, message] = [new Error('denied'), 'Apple Health could not be read.'];
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  store.queue(failure);
  startHealthImportLifecycle();
  await settle();
  expect(getHealthImportSnapshot().error).toBe(message);
});

it('names a workout it cannot import', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  store.queue({ workouts: [healthWorkout('bad', { totalDistance: { quantity: 1, unit: 'league' } })], deletedIds: [], newAnchor: 'x' });
  startHealthImportLifecycle();
  await settle();
  expect(getHealthImportSnapshot().error).toBe('A workout could not be imported.');
});

it('stays off when the permission sheet cannot be shown', async () => {
  const { store } = setup();
  store.failAuthorization(new Error('no entitlement'));
  startHealthImportLifecycle();
  await enableHealthImport();
  expect(getHealthImportSnapshot()).toMatchObject({ enabled: false, error: 'Apple Health could not be opened.' });
  expect(healthImportStore.readEnabled('user-a')).toBe(false);
  expect(store.reads).toEqual([]);
});

it('turning off stops imports and forgets the anchor, so turning on again backfills afresh', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
  startHealthImportLifecycle();
  await importHealthActivitiesNow();

  disableHealthImport();
  expect(getHealthImportSnapshot().enabled).toBe(false);
  expect(healthImportStore.readAnchor('user-a')).toBeNull();
  const readsBefore = store.reads.length;
  appStateListener?.('active');
  await importHealthActivitiesNow();
  expect(store.reads).toHaveLength(readsBefore);

  await enableHealthImport();
  expect(store.reads.at(-1)).toEqual({ anchor: null, since: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000) });
});

it('signing out discards the anchor; another account starts with its own switch and a fresh backfill', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  healthImportStore.writeAnchor('user-a', 'anchor-a', SINCE);
  startHealthImportLifecycle();
  await importHealthActivitiesNow();

  signInAs(null);
  expect(getHealthImportSnapshot()).toMatchObject({ signedIn: false, enabled: false });
  expect(healthImportStore.readAnchor('user-a')).toBeNull();

  signInAs('user-b');
  await importHealthActivitiesNow();
  expect(getHealthImportSnapshot()).toMatchObject({ signedIn: true, enabled: false });
  const readsForB = store.reads.length;

  healthImportStore.writeEnabled('user-b', true);
  await importHealthActivitiesNow();
  expect(store.reads).toHaveLength(readsForB + 1);
  expect(store.reads.at(-1)?.anchor).toBeNull();
});

it('an account switch mid-import writes nothing more for the old account', async () => {
  const { store, server } = setup();
  healthImportStore.writeEnabled('user-a', true);
  store.queue({ workouts: [healthWorkout('a')], deletedIds: ['gone'], newAnchor: 'anchor-1' });
  const apply = server.api.apply;
  server.api.apply = async (input) => {
    const result = await apply(input);
    signInAs('user-b');
    return result;
  };
  startHealthImportLifecycle();
  await importHealthActivitiesNow();
  expect(server.calls).toHaveLength(1);
  expect(healthImportStore.readAnchor('user-a')).toBeNull();
  expect(getHealthImportSnapshot().error).toBeNull();
});

it('does nothing where Apple Health is unavailable', async () => {
  const { store } = setup(false);
  startHealthImportLifecycle();
  await enableHealthImport();
  expect(getHealthImportSnapshot()).toMatchObject({ supported: false, enabled: false });
  expect(store.authorizations).toBe(0);
});

it('names an expired session apart from a network failure', async () => {
  const { store, server } = setup();
  healthImportStore.writeEnabled('user-a', true);
  store.queue({ workouts: [healthWorkout('a')], deletedIds: [], newAnchor: 'x' });
  const { HealthImportError } = jest.requireActual('@/src/health-import/mapping') as typeof import('@/src/health-import/mapping');
  server.failNext(new HealthImportError('AUTH_REQUIRED', 'AUTH_REQUIRED: sign in to import activities'));
  startHealthImportLifecycle();
  await settle();
  expect(getHealthImportSnapshot().error).toBe('Sign in again to send workouts.');
  expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'health_import.failed', context: { code: 'AUTH_REQUIRED' } }));
});

it('turning on again after a failed permission sheet shows the sheet again', async () => {
  const { store } = setup();
  store.failAuthorization(new Error('restricted'));
  startHealthImportLifecycle();
  await enableHealthImport();
  expect(getHealthImportSnapshot()).toMatchObject({ enabled: false, enabling: false, error: 'Apple Health could not be opened.' });

  store.failAuthorization(null);
  await enableHealthImport();
  expect(store.authorizations).toBe(2);
  expect(getHealthImportSnapshot()).toMatchObject({ enabled: true, error: null });
});

it('ignores a second turn-on while the permission sheet is open', async () => {
  const { store } = setup();
  startHealthImportLifecycle();
  const first = enableHealthImport();
  expect(getHealthImportSnapshot().enabling).toBe(true);
  await enableHealthImport();
  await first;
  expect(store.authorizations).toBe(1);
});

it('off then on mid-import makes the running import stale, so the next one backfills afresh', async () => {
  const { store, server } = setup();
  healthImportStore.writeEnabled('user-a', true);
  healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
  store.queue({ workouts: [healthWorkout('a')], deletedIds: [], newAnchor: 'anchor-2' });
  const apply = server.api.apply;
  let toggled = false;
  server.api.apply = async (input) => {
    if (!toggled) {
      toggled = true;
      disableHealthImport();
      healthImportStore.writeEnabled('user-a', true);
    }
    return apply(input);
  };
  startHealthImportLifecycle();
  await settle();
  // The call already under way finishes; the stale run then saves no anchor and reports nothing.
  expect(server.calls).toHaveLength(1);
  expect(healthImportStore.readAnchor('user-a')).toBeNull();
  expect(getHealthImportSnapshot().error).toBeNull();

  await importHealthActivitiesNow();
  expect(store.reads.at(-1)?.anchor).toBeNull();
});

it('shows no failure from an import the person turned off while it ran', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  let reject: (error: Error) => void = () => undefined;
  store.adapter.readWorkoutChanges = () => new Promise((_resolve, fail) => { reject = fail; });
  startHealthImportLifecycle();
  disableHealthImport();
  reject(new Error('late failure'));
  await settle();
  expect(getHealthImportSnapshot()).toMatchObject({ enabled: false, error: null });
});

it('clears busy when the account changes mid-import', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  store.adapter.readWorkoutChanges = () => new Promise(() => undefined);
  startHealthImportLifecycle();
  expect(getHealthImportSnapshot().busy).toBe(true);
  signInAs('user-b');
  expect(getHealthImportSnapshot().busy).toBe(false);
});

it('a foreground during a running import does not queue another', async () => {
  const { store } = setup();
  healthImportStore.writeEnabled('user-a', true);
  startHealthImportLifecycle();
  appStateListener?.('active');
  await settle();
  expect(store.reads).toHaveLength(1);
});

it('stops listening when stopped', () => {
  setup();
  const stop = startHealthImportLifecycle();
  expect(startHealthImportLifecycle()).toBe(stop);
  stop();
  expect(appStateListener).toBeNull();
  expect(mockAuth.listeners.size).toBe(0);
});
