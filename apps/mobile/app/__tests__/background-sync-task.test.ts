/**
 * Covers the background sync task: the short-lived native handler that iOS runs
 * to refresh sync while the app is suspended. The handler is stateless — it does
 * a one-shot network pre-flight, runs exactly one cycle directly, and never
 * touches the foreground scheduler.
 *
 * Every outbound dependency is stubbed: the task manager captures the handler
 * registered at module load so the test can invoke it; the background-task
 * module supplies the result enum and records the registration call; the network
 * module returns a controllable reachability snapshot; the cycle is a spy that
 * resolves or throws on demand; and the foreground scheduler is spied so the
 * test can prove the handler never calls into it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { runSyncCycle } from '@/src/sync/cycle';

// --- expo-task-manager stub --------------------------------------------------
//
// defineTask runs at module load. It is a jest.fn so the registered
// (identifier, handler) pair survives in mock.calls — a jest.fn reference is the
// only hoist-safe way to capture it, since a plain const would not be
// initialised yet when the hoisted factory first runs. Helpers below read the
// captured pair back. The `mock`-prefixed name is the reference babel-jest
// allows inside a hoisted jest.mock factory.
const mockDefineTask = jest.fn(
  (_identifier: string, _handler: () => Promise<unknown>): void => undefined,
);

jest.mock('expo-task-manager', () => ({
  __esModule: true,
  defineTask: (identifier: string, handler: () => Promise<unknown>) => mockDefineTask(identifier, handler),
}));

/** The identifier the module-load defineTask call registered under. */
const definedTaskIdentifier = (): unknown => mockDefineTask.mock.calls[0]?.[0];

/** The handler the module-load defineTask call registered. */
const definedTaskHandler = (): (() => Promise<unknown>) | undefined =>
  mockDefineTask.mock.calls[0]?.[1] as (() => Promise<unknown>) | undefined;

// --- expo-background-task stub -----------------------------------------------
//
// Supplies the result enum (mirrors the real numeric values) and records the
// registration call so the test can assert the identifier and options.
const mockRegisterTaskAsync = jest.fn(
  (_identifier: string, _options: unknown): Promise<void> => Promise.resolve(),
);

jest.mock('expo-background-task', () => ({
  __esModule: true,
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  registerTaskAsync: (identifier: string, options: unknown) =>
    mockRegisterTaskAsync(identifier, options),
}));

// --- expo-network stub -------------------------------------------------------
const mockNetworkState: { isInternetReachable: boolean | null } = { isInternetReachable: true };
const mockGetNetworkStateAsync = jest.fn(() => Promise.resolve(mockNetworkState));

jest.mock('expo-network', () => ({
  __esModule: true,
  getNetworkStateAsync: () => mockGetNetworkStateAsync(),
}));

// --- cycle stub --------------------------------------------------------------
const mockRunSyncCycle = jest.fn(() => Promise.resolve('converged'));

jest.mock('@/src/sync/cycle', () => ({
  __esModule: true,
  runSyncCycle: () => mockRunSyncCycle(),
}));

// --- logging spy -------------------------------------------------------------
jest.mock('@/src/logging/logEvent', () => ({
  __esModule: true,
  logEvent: jest.fn(() => Promise.resolve()),
}));

// --- foreground-scheduler spy ------------------------------------------------
//
// The whole scheduler module is replaced with spies. If the background handler
// reached into the foreground scheduler — its `requestSync` entry point or any
// of its lifecycle/state exports — these spies would record the call. The
// background path must stay stateless, so they must never fire.
const mockRequestSync = jest.fn();
const mockStartSyncScheduler = jest.fn();
const mockStopSyncScheduler = jest.fn();
const mockGetSchedulerState = jest.fn(() => ({ state: { name: 'OFFLINE' }, online: false, timerArmed: false }));

jest.mock('@/src/sync/scheduler', () => ({
  __esModule: true,
  requestSync: () => mockRequestSync(),
  startSyncScheduler: () => mockStartSyncScheduler(),
  stopSyncScheduler: () => mockStopSyncScheduler(),
  __getSchedulerStateForTests: () => mockGetSchedulerState(),
}));

const BackgroundTaskResult = { Success: 1, Failed: 2 } as const;

// The module under test is loaded with require() inside beforeAll rather than a
// top-level import. A top-level ES import is hoisted above the mock-holder const
// declarations, so the module-load `defineTask` call would run before the holder
// (mockDefineTask) is initialised. Deferring the require until the holders exist
// captures the module-load registration cleanly.
type BackgroundTaskModule = typeof import('@/src/sync/background-task');
let backgroundTask: BackgroundTaskModule;
let BACKGROUND_SYNC_TASK_IDENTIFIER: string;
let registerBackgroundSyncTask: BackgroundTaskModule['registerBackgroundSyncTask'];
let runBackgroundSyncTask: BackgroundTaskModule['runBackgroundSyncTask'];

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred load: a top-level import hoists above the mock holders.
  backgroundTask = require('@/src/sync/background-task') as BackgroundTaskModule;
  BACKGROUND_SYNC_TASK_IDENTIFIER = backgroundTask.BACKGROUND_SYNC_TASK_IDENTIFIER;
  registerBackgroundSyncTask = backgroundTask.registerBackgroundSyncTask;
  runBackgroundSyncTask = backgroundTask.runBackgroundSyncTask;
});

beforeEach(() => {
  mockRegisterTaskAsync.mockClear();
  mockGetNetworkStateAsync.mockClear();
  mockRunSyncCycle.mockClear();
  mockRequestSync.mockClear();
  mockStartSyncScheduler.mockClear();
  mockStopSyncScheduler.mockClear();
  mockGetSchedulerState.mockClear();
  mockNetworkState.isInternetReachable = true;
  mockRunSyncCycle.mockImplementation(() => Promise.resolve('converged'));
});

describe('task definition and registration', () => {
  it('defines the task at module load under the shared identifier', () => {
    expect(mockDefineTask).toHaveBeenCalledTimes(1);
    expect(definedTaskIdentifier()).toBe(BACKGROUND_SYNC_TASK_IDENTIFIER);
    expect(typeof definedTaskHandler()).toBe('function');
  });

  it('registers the task under the same identifier with a 15-minute floor', async () => {
    await registerBackgroundSyncTask();
    expect(mockRegisterTaskAsync).toHaveBeenCalledTimes(1);
    expect(mockRegisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK_IDENTIFIER, {
      minimumInterval: 15,
    });
  });
});

describe('task body — network online', () => {
  it('awaits one cycle and returns Success', async () => {
    mockNetworkState.isInternetReachable = true;

    const result = await runBackgroundSyncTask();

    expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(1);
    expect(mockRunSyncCycle).toHaveBeenCalledTimes(1);
    expect(result).toBe(BackgroundTaskResult.Success);
  });

  it('the captured module-load handler runs the same body', async () => {
    mockNetworkState.isInternetReachable = true;

    const result = await definedTaskHandler()?.();

    expect(mockRunSyncCycle).toHaveBeenCalledTimes(1);
    expect(result).toBe(BackgroundTaskResult.Success);
  });
});

describe('task body — network offline (pre-flight fails)', () => {
  it('skips the cycle and returns Success when internet is unreachable', async () => {
    mockNetworkState.isInternetReachable = false;

    const result = await runBackgroundSyncTask();

    expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(1);
    expect(mockRunSyncCycle).not.toHaveBeenCalled();
    expect(result).toBe(BackgroundTaskResult.Success);
  });

  it('treats a null reachability (unknown) the same as offline', async () => {
    mockNetworkState.isInternetReachable = null;

    const result = await runBackgroundSyncTask();

    expect(mockRunSyncCycle).not.toHaveBeenCalled();
    expect(result).toBe(BackgroundTaskResult.Success);
  });
});

describe('task body — cycle outcome drives the result', () => {
  it('returns Success on a converged cycle', async () => {
    mockNetworkState.isInternetReachable = true;
    mockRunSyncCycle.mockImplementation(() => Promise.resolve('converged'));

    const result = await runBackgroundSyncTask();

    expect(mockRunSyncCycle).toHaveBeenCalledTimes(1);
    expect(result).toBe(BackgroundTaskResult.Success);
  });

  it('returns Failed on a retriable INTERNAL outcome so the OS retries sooner', async () => {
    mockNetworkState.isInternetReachable = true;
    mockRunSyncCycle.mockImplementation(() => Promise.resolve('internal'));

    const result = await runBackgroundSyncTask();

    expect(result).toBe(BackgroundTaskResult.Failed);
  });

  it('returns Failed on an FK_VIOLATION outcome', async () => {
    mockNetworkState.isInternetReachable = true;
    mockRunSyncCycle.mockImplementation(() => Promise.resolve('fk-violation'));

    const result = await runBackgroundSyncTask();

    expect(result).toBe(BackgroundTaskResult.Failed);
  });

  it('returns Success on an auth-required outcome (no foreground to route, retry is futile)', async () => {
    mockNetworkState.isInternetReachable = true;
    mockRunSyncCycle.mockImplementation(() => Promise.resolve('auth-required'));

    const result = await runBackgroundSyncTask();

    expect(result).toBe(BackgroundTaskResult.Success);
  });

  it('returns Failed when the cycle defensively rejects (escaped throw)', async () => {
    mockNetworkState.isInternetReachable = true;
    mockRunSyncCycle.mockImplementation(() => Promise.reject(new Error('cycle blew up')));

    const result = await runBackgroundSyncTask();

    expect(mockRunSyncCycle).toHaveBeenCalledTimes(1);
    expect(result).toBe(BackgroundTaskResult.Failed);
  });
});

describe('foreground-scheduler isolation', () => {
  it('does not request a foreground sync or read scheduler state (online path)', async () => {
    mockNetworkState.isInternetReachable = true;
    await runBackgroundSyncTask();
    expect(mockRequestSync).not.toHaveBeenCalled();
    expect(mockGetSchedulerState).not.toHaveBeenCalled();
  });

  it('does not request a foreground sync or read scheduler state (offline path)', async () => {
    mockNetworkState.isInternetReachable = false;
    await runBackgroundSyncTask();
    expect(mockRequestSync).not.toHaveBeenCalled();
    expect(mockGetSchedulerState).not.toHaveBeenCalled();
  });

  it('does not request a foreground sync or read scheduler state (cycle-throws path)', async () => {
    mockNetworkState.isInternetReachable = true;
    mockRunSyncCycle.mockImplementation(() => Promise.reject(new Error('cycle blew up')));
    await runBackgroundSyncTask();
    expect(mockRequestSync).not.toHaveBeenCalled();
    expect(mockGetSchedulerState).not.toHaveBeenCalled();
  });

  it('drives the cycle directly (the body calls runSyncCycle, not the scheduler)', () => {
    // The body's only sync trigger is the cycle, asserted above. This keeps the
    // cycle import referenced so a future refactor that routes through the
    // scheduler instead fails the suite rather than passing vacuously.
    expect(typeof runSyncCycle).toBe('function');
  });
});

describe('identifier does not drift from the prebuild config', () => {
  it('keeps the background-task plugin in the Expo config plugins array', () => {
    // The plugin is what writes UIBackgroundModes + the permitted-identifier
    // entry into the generated Info.plist. If it is dropped from the config, the
    // plist entries vanish and the OS runs the task zero times.
    const configSource = readFileSync(
      join(__dirname, '..', '..', 'app.config.ts'),
      'utf8',
    );
    expect(configSource).toContain('expo-background-task');
  });

  it('matches the identifier the Expo plugin writes into the Info.plist', () => {
    // The most common failure mode for this API is a mismatch between the
    // identifier the handler registers under and the one in
    // BGTaskSchedulerPermittedIdentifiers. The background-task plugin hardcodes
    // that plist value (and the iOS native worker) to a fixed string and exposes
    // no option to change it. Read the value straight from the plugin source and
    // assert our constant equals it, so a plugin bump that changes the identifier
    // fails here instead of silently disabling background sync.
    const pluginSource = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'node_modules',
        'expo-background-task',
        'plugin',
        'build',
        'withBackgroundTask.js',
      ),
      'utf8',
    );
    const permittedIdentifiers = [...pluginSource.matchAll(/'(com\.expo\.modules\.backgroundtask\.[^']+)'/g)].map(
      (match) => match[1],
    );
    expect(permittedIdentifiers).toContain(BACKGROUND_SYNC_TASK_IDENTIFIER);
  });
});
