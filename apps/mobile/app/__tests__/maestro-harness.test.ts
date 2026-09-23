/* eslint-disable import/first */

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

// `mock`-prefixed so the hoisted jest factory may reference it.
let mockHarnessFixture: InMemoryDatabaseFixture | null = null;

jest.mock('@/src/data', () => ({
  resetLocalAppData: jest.fn(),
  bootstrapLocalDataLayer: () => Promise.resolve(mockHarnessFixture?.database),
}));

jest.mock('@/src/maestro/exercise-block-history-fixture', () => ({
  buildExerciseBlockHistoryFixtureRows: jest.requireActual(
    '@/src/maestro/exercise-block-history-fixture'
  ).buildExerciseBlockHistoryFixtureRows,
  EXERCISE_BLOCK_HISTORY_FIXTURE: jest.requireActual(
    '@/src/maestro/exercise-block-history-fixture'
  ).EXERCISE_BLOCK_HISTORY_FIXTURE,
  seedExerciseBlockHistoryFixture: jest.fn(),
}));

jest.mock('@/src/maestro/exercise-page-fixture', () => ({
  seedExercisePageFixture: jest.fn(),
}));

const mockIsDevMode = jest.fn<boolean, []>();
jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

import { ExecutionEnvironment } from 'expo-constants';

import { eq } from 'drizzle-orm';

import { resetLocalAppData } from '@/src/data';
import { PRIMARY_RUNTIME_STATE_ID } from '@/src/data/clock';
import { syncRuntimeState } from '@/src/data/schema';
import {
  buildExerciseBlockHistoryFixtureRows,
  EXERCISE_BLOCK_HISTORY_FIXTURE,
  seedExerciseBlockHistoryFixture,
} from '@/src/maestro/exercise-block-history-fixture';
import { seedExercisePageFixture } from '@/src/maestro/exercise-page-fixture';
import {
  coerceMaestroHarnessQueryParam,
  isMaestroHarnessAllowed,
  resolveMaestroHarnessBootstrapAction,
  resolveMaestroHarnessFixtureName,
  resolveMaestroHarnessGateAction,
  resolveMaestroHarnessResetMode,
  resolveMaestroHarnessTeleportHref,
  resolveMaestroHarnessTeleportTarget,
  runMaestroHarnessBootstrapAction,
  runMaestroHarnessFixture,
  runMaestroHarnessGateAction,
  runMaestroHarnessReset,
} from '@/src/maestro/harness';
import {
  __resetSyncGateStateForTests,
  getSyncGateStateSnapshot,
} from '@/src/sync/sync-gate-state';

const mockResetLocalAppData = jest.mocked(resetLocalAppData);
const mockSeedExerciseBlockHistoryFixture = jest.mocked(seedExerciseBlockHistoryFixture);

describe('maestro harness helpers', () => {
  beforeEach(() => {
    mockResetLocalAppData.mockReset();
    mockResetLocalAppData.mockResolvedValue(undefined as never);
    mockSeedExerciseBlockHistoryFixture.mockReset();
    mockSeedExerciseBlockHistoryFixture.mockResolvedValue({
      ...EXERCISE_BLOCK_HISTORY_FIXTURE,
      sessionIds: [],
      sessionExerciseIds: [],
      setIds: [],
    } as never);
    mockIsDevMode.mockReset();
    mockIsDevMode.mockReturnValue(false);
  });

  it('allows the harness only in non-store-client development contexts', () => {
    expect(
      isMaestroHarnessAllowed({
        isDev: true,
        executionEnvironment: ExecutionEnvironment.Bare,
      })
    ).toBe(true);

    expect(
      isMaestroHarnessAllowed({
        isDev: true,
        executionEnvironment: ExecutionEnvironment.StoreClient,
      })
    ).toBe(false);

    expect(
      isMaestroHarnessAllowed({
        isDev: false,
        executionEnvironment: ExecutionEnvironment.Standalone,
      })
    ).toBe(false);
  });

  it('defaults the dev check to isDevMode() when isDev is omitted', () => {
    mockIsDevMode.mockReturnValue(true);
    expect(
      isMaestroHarnessAllowed({ executionEnvironment: ExecutionEnvironment.Standalone })
    ).toBe(true);

    mockIsDevMode.mockReturnValue(false);
    expect(
      isMaestroHarnessAllowed({ executionEnvironment: ExecutionEnvironment.Standalone })
    ).toBe(false);
  });

  it('normalizes harness query params and reset modes', () => {
    expect(coerceMaestroHarnessQueryParam(['data', 'ignored'])).toBe('data');
    expect(coerceMaestroHarnessQueryParam(undefined)).toBeNull();
    expect(resolveMaestroHarnessResetMode('data')).toBe('data');
    expect(resolveMaestroHarnessResetMode('unexpected')).toBe('none');
    expect(resolveMaestroHarnessFixtureName('exercise-block-history')).toBe(
      'exercise-block-history'
    );
    expect(resolveMaestroHarnessFixtureName('session-view')).toBe('session-view');
    expect(resolveMaestroHarnessFixtureName('unexpected')).toBe('none');
    expect(resolveMaestroHarnessBootstrapAction('complete')).toBe('complete');
    expect(resolveMaestroHarnessBootstrapAction('reset')).toBe('reset');
    expect(resolveMaestroHarnessBootstrapAction('unexpected')).toBe('none');
    expect(resolveMaestroHarnessBootstrapAction(null)).toBe('none');
  });

  it('maps supported teleport targets to route hrefs', () => {
    // The old recorder route is gone (redesign 6b); its teleport went with it.
    expect(resolveMaestroHarnessTeleportTarget('session-recorder')).toBeNull();
    expect(resolveMaestroHarnessTeleportTarget('unknown')).toBeNull();

    expect(
      resolveMaestroHarnessTeleportHref({
        target: 'session-list',
      })
    ).toBe('/stats-history');

    expect(
      resolveMaestroHarnessTeleportHref({
        target: 'completed-session',
        intent: 'edit',
        sessionId: 'session-123',
      })
    ).toBe('/completed-session/session-123?intent=edit');

    expect(
      resolveMaestroHarnessTeleportHref({
        target: 'completed-session',
        sessionId: 'session-123',
        presentation: 'completion',
        maestroShare: 'fail-once',
        maestroCatalog: 'fail-once',
      })
    ).toBe(
      '/completed-session/session-123?presentation=completion&maestroShare=fail-once&maestroCatalog=fail-once'
    );

    expect(
      resolveMaestroHarnessTeleportHref({
        target: 'completed-session',
      })
    ).toBeNull();

    expect(resolveMaestroHarnessTeleportTarget('exercise-page')).toBe('exercise-page');
    expect(
      resolveMaestroHarnessTeleportHref({
        target: 'exercise-page',
        sessionId: 'session-123',
        sessionExerciseId: 'exercise-456',
      })
    ).toBe('/session/session-123/exercise/exercise-456');
    expect(
      resolveMaestroHarnessTeleportHref({ target: 'exercise-page', sessionId: 'session-123' })
    ).toBeNull();
    expect(resolveMaestroHarnessTeleportTarget('session-view')).toBe('session-view');
    expect(
      resolveMaestroHarnessTeleportHref({ target: 'session-view', sessionId: 'session-123' })
    ).toBe('/session/session-123');
    expect(resolveMaestroHarnessTeleportHref({ target: 'session-view' })).toBeNull();
    // A completed session opens the same route, to edit it.
    expect(
      resolveMaestroHarnessTeleportHref({ target: 'session-view', sessionId: 'maestro_m24_completion_one_pr' })
    ).toBe('/session/maestro_m24_completion_one_pr');
  });

  it('runs a data reset only when requested', async () => {
    await runMaestroHarnessReset('none');
    expect(mockResetLocalAppData).not.toHaveBeenCalled();

    await runMaestroHarnessReset('data');
    expect(mockResetLocalAppData).toHaveBeenCalledTimes(1);
  });

  it('runs the exercise block history fixture only when requested', async () => {
    await runMaestroHarnessFixture('none');
    expect(mockSeedExerciseBlockHistoryFixture).not.toHaveBeenCalled();

    await runMaestroHarnessFixture('exercise-block-history');
    expect(mockSeedExerciseBlockHistoryFixture).toHaveBeenCalledTimes(1);
    expect(mockSeedExerciseBlockHistoryFixture).toHaveBeenLastCalledWith();
    expect(jest.mocked(seedExercisePageFixture)).not.toHaveBeenCalled();

    expect(resolveMaestroHarnessFixtureName('completion-two-prs')).toBe('completion-two-prs');
    await runMaestroHarnessFixture('completion-two-prs');
    expect(mockSeedExerciseBlockHistoryFixture).toHaveBeenLastCalledWith({ includeTwoPrSession: true });

    expect(resolveMaestroHarnessFixtureName('exercise-page')).toBe('exercise-page');
    await runMaestroHarnessFixture('exercise-page');
    expect(jest.mocked(seedExercisePageFixture)).toHaveBeenCalledTimes(1);
    expect(mockSeedExerciseBlockHistoryFixture).toHaveBeenCalledTimes(2);
  });

  describe('bootstrap-flag harness action', () => {
    const readFlag = (): Date | null =>
      mockHarnessFixture!.database
        .select({ bootstrapCompletedAt: syncRuntimeState.bootstrapCompletedAt })
        .from(syncRuntimeState)
        .where(eq(syncRuntimeState.id, PRIMARY_RUNTIME_STATE_ID))
        .get()?.bootstrapCompletedAt ?? null;

    beforeEach(() => {
      mockHarnessFixture = createInMemoryDatabase();
      __resetSyncGateStateForTests();
    });

    afterEach(() => {
      mockHarnessFixture?.close();
      mockHarnessFixture = null;
      __resetSyncGateStateForTests();
    });

    it('leaves the flag untouched for the none action', async () => {
      await runMaestroHarnessBootstrapAction('none');
      expect(readFlag()).toBeNull();
    });

    it('stamps the flag for the complete action so the gate dismisses', async () => {
      await runMaestroHarnessBootstrapAction('complete');
      expect(readFlag()).not.toBeNull();
    });

    it('clears the flag for the reset action so the gate blocks again', async () => {
      await runMaestroHarnessBootstrapAction('complete');
      expect(readFlag()).not.toBeNull();

      await runMaestroHarnessBootstrapAction('reset');
      expect(readFlag()).toBeNull();
    });

    it('publishes the new flag into the shared accessor so the gate flips on the same tick', async () => {
      expect(getSyncGateStateSnapshot().bootstrapCompletedAt).toBeNull();

      await runMaestroHarnessBootstrapAction('complete');
      expect(getSyncGateStateSnapshot().bootstrapCompletedAt).not.toBeNull();

      await runMaestroHarnessBootstrapAction('reset');
      expect(getSyncGateStateSnapshot().bootstrapCompletedAt).toBeNull();
    });
  });

  describe('gate in-progress harness action', () => {
    beforeEach(() => {
      __resetSyncGateStateForTests();
    });

    afterEach(() => {
      __resetSyncGateStateForTests();
    });

    it('resolves only the known gate actions', () => {
      expect(resolveMaestroHarnessGateAction('in-progress')).toBe('in-progress');
      expect(resolveMaestroHarnessGateAction('clear')).toBe('clear');
      expect(resolveMaestroHarnessGateAction('unexpected')).toBe('none');
      expect(resolveMaestroHarnessGateAction(null)).toBe('none');
    });

    it('pins an online in-progress snapshot for the in-progress action', () => {
      expect(getSyncGateStateSnapshot().forcedProgress).toBeFalsy();

      runMaestroHarnessGateAction('in-progress');

      const pinned = getSyncGateStateSnapshot().forcedProgress;
      expect(pinned).not.toBeNull();
      expect(pinned?.offline).toBe(false);
      expect(pinned?.phase).toBe('pull');
    });

    it('clears the pin for the clear action so the gate reflects real state again', () => {
      runMaestroHarnessGateAction('in-progress');
      expect(getSyncGateStateSnapshot().forcedProgress).not.toBeNull();

      runMaestroHarnessGateAction('clear');
      expect(getSyncGateStateSnapshot().forcedProgress).toBeNull();
    });

    it('is a no-op for the none action', () => {
      runMaestroHarnessGateAction('none');
      expect(getSyncGateStateSnapshot().forcedProgress).toBeFalsy();
    });
  });

  it('builds deterministic exercise block history fixture rows for populated and empty visual QA states', () => {
    const rows = buildExerciseBlockHistoryFixtureRows(
      new Date('2026-05-26T12:00:00.000Z')
    );
    const primarySessionExerciseRows = rows.sessionExercises.filter(
      (row) => row.exerciseDefinitionId === EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId
    );
    const secondarySessionExerciseRows = rows.sessionExercises.filter(
      (row) => row.exerciseDefinitionId === EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId
    );
    const noHistorySessionExerciseRows = rows.sessionExercises.filter(
      (row) => row.exerciseDefinitionId === EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId
    );

    expect(new Set(primarySessionExerciseRows.map((row) => row.sessionId)).size).toBeGreaterThanOrEqual(5);
    expect(secondarySessionExerciseRows.length).toBeGreaterThanOrEqual(1);
    expect(noHistorySessionExerciseRows).toEqual([]);

    const latestPrimaryRows = primarySessionExerciseRows.filter(
      (row) => row.sessionId === 'maestro_exercise_block_history_squat_1'
    );
    expect(latestPrimaryRows).toHaveLength(2);
    expect(rows.exerciseSets.some((row) => row.setType === 'warm_up')).toBe(true);
    expect(rows.exerciseSets.some((row) => row.setType === 'rir_0')).toBe(true);
    // The two-PR completion session is opt-in, so the shared history is unchanged.
    expect(rows.sessions.map((row) => row.id)).not.toContain(
      EXERCISE_BLOCK_HISTORY_FIXTURE.twoPrCompletionSessionId
    );
  });

  it('adds the newest completed session with a squat and a bench PR only when asked', () => {
    const now = new Date('2026-05-26T12:00:00.000Z');
    const base = buildExerciseBlockHistoryFixtureRows(now);
    const rows = buildExerciseBlockHistoryFixtureRows(now, { includeTwoPrSession: true });

    expect(rows.sessions).toHaveLength(base.sessions.length + 1);
    const twoPr = rows.sessions.find((row) => row.id === EXERCISE_BLOCK_HISTORY_FIXTURE.twoPrCompletionSessionId);
    expect(twoPr?.completedAt.getTime()).toBe(
      Math.max(...rows.sessions.map((row) => row.completedAt.getTime()))
    );
    expect(
      rows.sessionExercises
        .filter((row) => row.sessionId === EXERCISE_BLOCK_HISTORY_FIXTURE.twoPrCompletionSessionId)
        .map((row) => row.exerciseDefinitionId)
    ).toEqual([
      EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
      EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId,
    ]);
  });
});
