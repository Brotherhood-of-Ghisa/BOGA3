/* eslint-disable import/first */

jest.mock('@/src/data', () => ({
  resetLocalAppData: jest.fn(),
}));

const mockIsDevMode = jest.fn<boolean, []>();
jest.mock('@/src/utils/isDevMode', () => ({
  isDevMode: () => mockIsDevMode(),
}));

import { ExecutionEnvironment } from 'expo-constants';

import { resetLocalAppData } from '@/src/data';
import {
  coerceMaestroHarnessQueryParam,
  isMaestroHarnessAllowed,
  resolveMaestroHarnessResetMode,
  resolveMaestroHarnessTeleportHref,
  resolveMaestroHarnessTeleportTarget,
  runMaestroHarnessReset,
} from '@/src/maestro/harness';

const mockResetLocalAppData = jest.mocked(resetLocalAppData);

describe('maestro harness helpers', () => {
  beforeEach(() => {
    mockResetLocalAppData.mockReset();
    mockResetLocalAppData.mockResolvedValue(undefined as never);
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
});
