// Background sync task: wraps iOS BGAppRefreshTask so a sync cycle can run while
// the app is suspended and the foreground scheduler's JS timer is frozen.
//
// The task body is deliberately stateless: it never reads or mutates the
// foreground scheduler's state and never calls its "request sync" entry point.
// iOS — not a JS setTimeout — wakes this task in a short-lived native context,
// so there is nothing to coalesce; the task IS the trigger and runs exactly one
// cycle directly, outside the foreground state machine.
//
// The task definition lives at module-load time, not inside the registration
// function: when iOS relaunches the app in the background to run the task, it
// re-evaluates this module's top level and expects the task handler to already
// be registered before the registration call runs.

import * as BackgroundTask from 'expo-background-task';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';

import { logEvent } from '@/src/logging/logEvent';
import { runSyncCycle } from '@/src/sync/cycle';

/**
 * The single task identifier for the background sync task. This exact string
 * must be used in three places that have to agree or the OS silently runs the
 * task zero times with no diagnostic:
 *
 *   1. the `TaskManager.defineTask(...)` call below (the handler registration),
 *   2. the `BackgroundTask.registerTaskAsync(...)` call in
 *      `registerBackgroundSyncTask` (the schedule registration), and
 *   3. the `BGTaskSchedulerPermittedIdentifiers` array the background-task Expo
 *      plugin writes into the generated `Info.plist` during prebuild.
 *
 * Identifier drift between those three is the most common failure mode for this
 * API, so the value is centralised here as the single source of truth and a
 * test asserts every reference resolves to it.
 *
 * The value is fixed by the background-task Expo plugin: that plugin hardcodes
 * this exact string into both `BGTaskSchedulerPermittedIdentifiers` in the
 * generated `Info.plist` and the iOS native worker, and it exposes no option to
 * change it. The handler registered here must therefore use the same string, or
 * the OS runs the task zero times. (A test reads the plugin's written value back
 * and asserts it equals this constant so a future plugin bump that changes the
 * identifier fails loudly instead of silently disabling background sync.)
 */
export const BACKGROUND_SYNC_TASK_IDENTIFIER = 'com.expo.modules.backgroundtask.processing';

/**
 * Inexact floor, in minutes, between background task runs. iOS treats this as a
 * minimum delay and schedules opportunistically — it is not a guaranteed
 * cadence. 15 is the smallest value the system honours.
 */
const MINIMUM_INTERVAL_MINUTES = 15;

/**
 * The background task body. Runs in a short-lived native context with at most a
 * few tens of seconds of wall-clock budget, so it does the minimum:
 *
 *   1. A one-shot network pre-flight. NetInfo's long-lived change listener is
 *      not running in this context, so reachability is queried synchronously via
 *      expo-network. If the internet is not reachable, the task returns Success
 *      (not Failed) without starting a cycle — returning Success preserves the
 *      OS's scheduling preference for the task, where Failed would penalise it.
 *   2. One sync cycle directly. Success on resolve, Failed on throw.
 *
 * Exported for unit coverage; the registration wires it through TaskManager.
 */
export const runBackgroundSyncTask = async (): Promise<BackgroundTask.BackgroundTaskResult> => {
  void logEvent({
    level: 'debug',
    source: 'sync',
    event: 'sync_background_task_started',
    context: { timestampMs: Date.now() },
  });

  const networkState = await Network.getNetworkStateAsync();
  if (networkState.isInternetReachable !== true) {
    // No usable network. Skip the cycle but report Success so the OS keeps the
    // task in good standing and tries again on its next scheduling window.
    void logEvent({
      level: 'debug',
      source: 'sync',
      event: 'sync_background_task_skipped_offline',
      context: { timestampMs: Date.now() },
    });
    return BackgroundTask.BackgroundTaskResult.Success;
  }

  try {
    await runSyncCycle();
    void logEvent({
      level: 'debug',
      source: 'sync',
      event: 'sync_background_task_succeeded',
      context: { timestampMs: Date.now() },
    });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    void logEvent({
      level: 'warn',
      source: 'sync',
      event: 'sync_background_task_failed',
      message: 'Background sync cycle threw; the OS will retry on its next window.',
      context: { error: String(error), timestampMs: Date.now() },
    });
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
};

// Register the task handler at module-load time. iOS relaunches the JS bundle to
// run a background task and expects the handler defined before the run begins;
// defining it here (rather than inside the registration function) guarantees
// that ordering regardless of when the foreground app calls the registration.
TaskManager.defineTask(BACKGROUND_SYNC_TASK_IDENTIFIER, () => runBackgroundSyncTask());

/**
 * Registers the background sync task with the OS scheduler. Called once during
 * app init. The handler itself was already defined at module load (above), so
 * this only asks the OS to start scheduling it. Safe to await without blocking
 * boot — callers fire it without waiting.
 */
export const registerBackgroundSyncTask = async (): Promise<void> => {
  await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK_IDENTIFIER, {
    minimumInterval: MINIMUM_INTERVAL_MINUTES,
  });
};
