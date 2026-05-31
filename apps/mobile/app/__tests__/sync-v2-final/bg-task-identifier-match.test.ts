/**
 * Outcome: the background-sync task identifier agrees across every place it has
 * to.
 *
 * The most common failure mode for the iOS background-refresh API is a mismatch
 * between the identifier the task handler registers under, the identifier the
 * schedule registration uses, and the identifier the OS allows via the
 * `BGTaskSchedulerPermittedIdentifiers` plist entry. Any drift and the OS runs
 * the task zero times with no diagnostic.
 *
 * The code centralises the value as one exported constant. This file asserts
 * all three references resolve to that one constant:
 *
 *   1. `TaskManager.defineTask(...)` (the handler registration), captured at
 *      module load.
 *   2. `BackgroundTask.registerTaskAsync(...)` (the schedule registration).
 *   3. The identifier the background-task Expo plugin writes into the generated
 *      `Info.plist` (`BGTaskSchedulerPermittedIdentifiers`), read straight from
 *      the plugin source so a plugin bump that changes the value fails loudly.
 *
 * The expo modules are stubbed so the module-load registration is observable
 * and the registration call is recorded.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// --- expo-task-manager stub: capture the (identifier, handler) defineTask got.
const mockDefineTask = jest.fn(
  (_identifier: string, _handler: () => Promise<unknown>): void => undefined,
);
jest.mock('expo-task-manager', () => ({
  __esModule: true,
  defineTask: (identifier: string, handler: () => Promise<unknown>) =>
    mockDefineTask(identifier, handler),
}));

// --- expo-background-task stub: record the registerTaskAsync identifier.
const mockRegisterTaskAsync = jest.fn(
  (_identifier: string, _options: unknown): Promise<void> => Promise.resolve(),
);
jest.mock('expo-background-task', () => ({
  __esModule: true,
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  registerTaskAsync: (identifier: string, options: unknown) =>
    mockRegisterTaskAsync(identifier, options),
}));

// --- expo-network / cycle / logging stubs so module load is side-effect-free.
jest.mock('expo-network', () => ({
  __esModule: true,
  getNetworkStateAsync: jest.fn(() => Promise.resolve({ isInternetReachable: true })),
}));
jest.mock('@/src/sync/cycle', () => ({
  __esModule: true,
  runSyncCycle: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/src/logging/logEvent', () => ({
  __esModule: true,
  logEvent: jest.fn(() => Promise.resolve()),
}));

type BackgroundTaskModule = typeof import('@/src/sync/background-task');
let backgroundTask: BackgroundTaskModule;
let IDENTIFIER: string;

beforeAll(() => {
  // Deferred require: a top-level import hoists above the mock holders, so the
  // module-load defineTask call would run before they exist.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  backgroundTask = require('@/src/sync/background-task') as BackgroundTaskModule;
  IDENTIFIER = backgroundTask.BACKGROUND_SYNC_TASK_IDENTIFIER;
});

describe('the three identifier call sites agree', () => {
  it('defineTask registers the handler under the centralised constant', () => {
    expect(mockDefineTask).toHaveBeenCalledTimes(1);
    expect(mockDefineTask.mock.calls[0][0]).toBe(IDENTIFIER);
  });

  it('registerTaskAsync schedules under the same constant', async () => {
    await backgroundTask.registerBackgroundSyncTask();
    expect(mockRegisterTaskAsync).toHaveBeenCalledTimes(1);
    expect(mockRegisterTaskAsync.mock.calls[0][0]).toBe(IDENTIFIER);
  });

  it('matches the identifier the Expo plugin writes into the Info.plist', () => {
    // The plugin hardcodes the permitted-identifier plist value and the iOS
    // native worker; read those literals back and assert the constant is among
    // them, so a plugin bump that renames the identifier fails here instead of
    // silently disabling background sync.
    const pluginSource = readFileSync(
      join(
        __dirname,
        '..',
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
    const permittedIdentifiers = [
      ...pluginSource.matchAll(/'(com\.expo\.modules\.backgroundtask\.[^']+)'/g),
    ].map((match) => match[1]);
    expect(permittedIdentifiers).toContain(IDENTIFIER);
  });

  it('keeps the background-task plugin wired in the Expo config', () => {
    // The plugin is what emits the UIBackgroundModes + permitted-identifier
    // plist entries during prebuild; dropping it from the config would erase
    // them and the OS would never run the task.
    const configSource = readFileSync(join(__dirname, '..', '..', '..', 'app.config.ts'), 'utf8');
    expect(configSource).toContain('expo-background-task');
  });
});
