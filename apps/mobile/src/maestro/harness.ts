import type { Href } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { bootstrapLocalDataLayer, resetLocalAppData } from '@/src/data';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { syncRuntimeState } from '@/src/data/schema';
import { clearAuthRequired, markAuthRequired } from '@/src/sync/auth-required-signal';
import type { SyncProgress } from '@/src/sync/progress';
import {
  getSyncGateStateSnapshot,
  publishSyncGateState,
} from '@/src/sync/sync-gate-state';
import { isDevMode } from '@/src/utils/isDevMode';

import { seedExerciseBlockHistoryFixture } from './exercise-block-history-fixture';

export type MaestroHarnessResetMode = 'none' | 'data';
export type MaestroHarnessFixtureName = 'none' | 'exercise-block-history';
/**
 * Drives the first-sync gate deterministically in tests without a live cycle:
 * 'reset' clears the bootstrap flag so the gate's full-screen block shows;
 * 'complete' sets it so the block dismisses, simulating a drained first cycle.
 */
export type MaestroHarnessBootstrapAction = 'none' | 'reset' | 'complete';
/**
 * Drives the first-sync gate's ONLINE in-progress display deterministically:
 * 'in-progress' pins the "setting up your data" block in its online,
 * actively-syncing state (spinner + advancing counters) regardless of the live
 * scheduler — needed because the simulator's NetInfo cannot confirm internet
 * reachability, so the real cycle's online state is not observable in a flow;
 * 'clear' removes the pin so the gate reflects real state again (paired with
 * `bootstrap=complete` to dismiss). A no-op for 'none'.
 */
export type MaestroHarnessGateAction = 'none' | 'in-progress' | 'clear';
export type MaestroHarnessTeleportTarget =
  | 'session-list'
  | 'session-recorder'
  | 'exercise-catalog'
  | 'completed-session';

export const coerceMaestroHarnessQueryParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

export const isMaestroHarnessAllowed = ({
  isDev = isDevMode(),
  executionEnvironment = Constants.executionEnvironment,
}: {
  isDev?: boolean;
  executionEnvironment?: ExecutionEnvironment;
} = {}) => isDev && executionEnvironment !== ExecutionEnvironment.StoreClient;

export const resolveMaestroHarnessResetMode = (
  value: string | null | undefined
): MaestroHarnessResetMode => (value === 'data' ? 'data' : 'none');

export const resolveMaestroHarnessFixtureName = (
  value: string | null | undefined
): MaestroHarnessFixtureName => (value === 'exercise-block-history' ? value : 'none');

export const resolveMaestroHarnessBootstrapAction = (
  value: string | null | undefined
): MaestroHarnessBootstrapAction =>
  value === 'reset' || value === 'complete' ? value : 'none';

export const resolveMaestroHarnessGateAction = (
  value: string | null | undefined
): MaestroHarnessGateAction =>
  value === 'in-progress' || value === 'clear' ? value : 'none';

export const resolveMaestroHarnessTeleportTarget = (
  value: string | null | undefined
): MaestroHarnessTeleportTarget | null => {
  switch (value) {
    case 'session-list':
    case 'session-recorder':
    case 'exercise-catalog':
    case 'completed-session':
      return value;
    default:
      return null;
  }
};

const withQuery = (pathname: string, params: Record<string, string | null | undefined>): Href => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (!value) {
      return;
    }

    searchParams.set(key, value);
  });

  const search = searchParams.toString();
  return (search.length > 0 ? `${pathname}?${search}` : pathname) as Href;
};

export const resolveMaestroHarnessTeleportHref = ({
  target,
  mode,
  intent,
  sessionId,
}: {
  target: MaestroHarnessTeleportTarget | null;
  mode?: string | null;
  intent?: string | null;
  sessionId?: string | null;
}) => {
  switch (target) {
    case 'session-list':
      // Post-redesign: the legacy `/session-list` route is gone; the merged
      // Stats/History tab is the canonical landing target. Existing Maestro
      // flow YAML keeps `teleport=session-list` so they don't need rewriting.
      return '/stats-history' as Href;
    case 'session-recorder':
      return withQuery('/session-recorder', {
        mode: mode === 'completed-edit' ? mode : null,
        sessionId,
      });
    case 'exercise-catalog':
      return withQuery('/exercise-catalog', {
        intent,
        source: 'maestro-harness',
      });
    case 'completed-session':
      return sessionId ? (withQuery(`/completed-session/${sessionId}`, { intent }) as Href) : null;
    default:
      return null;
  }
};

export const runMaestroHarnessReset = async (resetMode: MaestroHarnessResetMode) => {
  if (resetMode === 'data') {
    await resetLocalAppData();
  }
};

export const runMaestroHarnessFixture = async (fixtureName: MaestroHarnessFixtureName) => {
  if (fixtureName === 'exercise-block-history') {
    await seedExerciseBlockHistoryFixture();
  }
};

/**
 * Sets or clears the first-sync `bootstrap_completed_at` flag on the singleton
 * runtime-state row, so a test can drive the gate's block on/off without waiting
 * on a live sync cycle. 'complete' stamps the flag now (block dismisses);
 * 'reset' clears it (block shows). A no-op for 'none'.
 *
 * The new value is both persisted to the row and published straight into the
 * gate's reactive holder, so the gate's block→dismiss (or dismiss→block)
 * transition takes effect on the same tick rather than waiting for the bridge's
 * next periodic re-read. That makes the transition observable deterministically
 * the instant this resolves, with no polling-interval race.
 *
 * 'complete' models a fully-drained first sync, which by definition talked to the
 * server with a valid session — so it also clears the "no signed-in user" route
 * signal, matching what a real drained cycle does. 'reset' models the not-yet-run
 * state and raises that signal, so the route layer treats the device as needing a
 * session again. This keeps the route layer and the gate consistent under the
 * harness, so a freshly-signed-in user is not bounced back to sign-in by a stale
 * signal while the first cycle is being simulated.
 */
export const runMaestroHarnessBootstrapAction = async (
  action: MaestroHarnessBootstrapAction,
) => {
  if (action === 'none') {
    return;
  }

  const database = await bootstrapLocalDataLayer();
  const bootstrapCompletedAt = action === 'complete' ? new Date() : null;

  database
    .insert(syncRuntimeState)
    .values({ id: PRIMARY_RUNTIME_STATE_ID, bootstrapCompletedAt })
    .onConflictDoUpdate({
      target: syncRuntimeState.id,
      set: { bootstrapCompletedAt },
    })
    .run();

  if (action === 'complete') {
    clearAuthRequired();
  } else {
    markAuthRequired();
  }

  publishSyncGateState({
    ...getSyncGateStateSnapshot(),
    bootstrapCompletedAt,
  });
};

/**
 * A representative in-progress snapshot for the pinned gate display: the pull
 * phase, one layer drained and a few rows applied, online. It renders the
 * "Restoring your data" heading, the spinner, and an advancing-counters line.
 */
const FORCED_IN_PROGRESS_SNAPSHOT: SyncProgress = {
  phase: 'pull',
  layersCompleted: 1,
  rowsApplied: 3,
  offline: false,
};

/**
 * Pins ('in-progress') or clears ('clear') the gate's online in-progress
 * display by publishing straight into the gate's reactive holder, so the block
 * shows its actively-syncing state deterministically the instant this resolves —
 * independent of the live scheduler / NetInfo. Pair 'clear' with
 * `bootstrap=complete` to dismiss the gate. A no-op for 'none'.
 */
export const runMaestroHarnessGateAction = (action: MaestroHarnessGateAction): void => {
  if (action === 'none') {
    return;
  }

  publishSyncGateState({
    ...getSyncGateStateSnapshot(),
    forcedProgress: action === 'in-progress' ? FORCED_IN_PROGRESS_SNAPSHOT : null,
  });
};
