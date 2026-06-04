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
import {
  coerceMaestroHarnessQueryParam,
  isMaestroHarnessAllowed,
  resolveMaestroHarnessBootstrapAction,
  resolveMaestroHarnessFixtureName,
  resolveMaestroHarnessResetMode,
  resolveMaestroHarnessTeleportHref,
  resolveMaestroHarnessTeleportTarget,
  runMaestroHarnessBootstrapAction,
  runMaestroHarnessFixture,
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
    expect(resolveMaestroHarnessFixtureName('unexpected')).toBe('none');
    expect(resolveMaestroHarnessBootstrapAction('complete')).toBe('complete');
    expect(resolveMaestroHarnessBootstrapAction('reset')).toBe('reset');
    expect(resolveMaestroHarnessBootstrapAction('unexpected')).toBe('none');
    expect(resolveMaestroHarnessBootstrapAction(null)).toBe('none');
  });

  it('maps supported teleport targets to route hrefs', () => {
    expect(resolveMaestroHarnessTeleportTarget('session-recorder')).toBe('session-recorder');
    expect(resolveMaestroHarnessTeleportTarget('unknown')).toBeNull();

    expect(
      resolveMaestroHarnessTeleportHref({
        target: 'session-list',
      })
    ).toBe('/stats-history');

    expect(
      resolveMaestroHarnessTeleportHref({
        target: 'session-recorder',
        mode: 'completed-edit',
        sessionId: 'session-123',
      })
    ).toBe('/session-recorder?mode=completed-edit&sessionId=session-123');

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
      })
    ).toBeNull();
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
  });
});
