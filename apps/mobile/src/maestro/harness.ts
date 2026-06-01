import type { Href } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { bootstrapLocalDataLayer, resetLocalAppData } from '@/src/data';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { syncRuntimeState } from '@/src/data/schema';
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
};
