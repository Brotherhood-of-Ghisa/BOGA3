/* eslint-disable import/first */

/**
 * Regression for the "first-sync gate spins forever" half of the error/health
 * channel bug.
 *
 * The bootstrapper does real local work that can throw a plain (non-
 * `SyncCycleError`) exception: a seed verification `throw new Error(...)`, a
 * Drizzle/SQLite write failure, a missing Supabase client, or a malformed-payload
 * `new Date(NaN)`. Before the fix, `runSyncCycle` re-threw any such throw
 * unclassified, so `bootstrap_completed_at` was never set AND no error code was
 * ever recorded — `selectSyncGateMode` then fell through to `in-progress` and the
 * gate showed the "Setting up your data…" spinner FOREVER, with no error and no
 * Retry.
 *
 * The fix wraps any unknown throw escaping the cycle body as a retriable INTERNAL
 * outcome: the cycle no longer throws, it raises the gate error code, and the
 * gate decision renders an error + Retry. This test pins the whole channel:
 *
 *   1. the cycle returns the 'internal' outcome (does NOT reject), and
 *   2. it raises the INTERNAL error code, which the gate decision maps to a
 *      retriable `{ kind: 'error', errorCode: 'INTERNAL' }` (error + Retry) — NOT
 *      the indefinite `{ kind: 'in-progress' }` spinner.
 *
 * The unexpected throw is injected by stubbing the bootstrapper to throw a plain
 * Error, which stands in for any of the non-`SyncCycleError` throws the real
 * bootstrapper can raise.
 */

const mockRunBootstrapper = jest.fn();
jest.mock('@/src/sync/bootstrapper', () => ({
  runBootstrapper: () => mockRunBootstrapper(),
}));

// The cycle resolves the data layer before touching the bootstrapper; stub it so
// the cycle reaches the bootstrapper (which throws) without a real database.
jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: jest.fn(async () => ({}) as never),
}));

// The bundle-migrations step also runs in the try block; stub it as a no-op so
// the only throw under test is the injected bootstrapper one.
jest.mock('@/src/data/bundle-migrations', () => ({
  runBundleMigrations: jest.fn(),
}));

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: jest.fn(() => ({
    rpc: jest.fn(),
    schema: () => ({ rpc: jest.fn() }),
  })),
}));

import {
  __resetAuthRequiredSignalForTests,
  getAuthRequiredSignal,
} from '@/src/sync/auth-required-signal';
import {
  __resetCycleErrorSignalForTests,
  getCycleErrorCode,
} from '@/src/sync/cycle-error-signal';
import { runSyncCycle } from '@/src/sync/cycle';
import { selectSyncGateMode } from '@/src/sync/sync-gate-decision';

const signedInGateState = () => ({
  // First sync has not drained, so the gate is up.
  bootstrapCompletedAt: null as Date | null,
  // The gate reads the cycle's classified error code, mirrored from the signal.
  lastCycleErrorCode: getAuthRequiredSignal() ? ('AUTH_REQUIRED' as const) : getCycleErrorCode(),
});

const signedInAuth = { isConfigured: true, session: { user: 'u' } };

beforeEach(() => {
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
  mockRunBootstrapper.mockReset();
});

afterEach(() => {
  __resetAuthRequiredSignalForTests();
  __resetCycleErrorSignalForTests();
});

describe('unexpected (non-SyncCycleError) throw during the first-sync bootstrapper', () => {
  it('is classified as a retriable INTERNAL outcome instead of escaping', async () => {
    mockRunBootstrapper.mockImplementation(() => {
      // Stands in for the real bootstrapper's plain throws: a seed verification
      // `throw new Error(...)`, a Drizzle/SQLite write failure, `new Date(NaN)`, etc.
      throw new Error('System exercise catalog seed verification failed');
    });

    // The cycle must NOT reject — every throw is classified and returned.
    await expect(runSyncCycle()).resolves.toBe('internal');
  });

  it('raises the INTERNAL error code so the gate shows an error + Retry, not an infinite spinner', async () => {
    mockRunBootstrapper.mockImplementation(() => {
      throw new Error('Drizzle write failed');
    });

    await runSyncCycle();

    // The error channel: the cycle recorded the non-auth failure code.
    expect(getCycleErrorCode()).toBe('INTERNAL');
    expect(getAuthRequiredSignal()).toBe(false);

    // The gate channel: with the first sync not drained and an INTERNAL code, the
    // gate renders an error + Retry — NOT the indefinite in-progress spinner.
    const mode = selectSyncGateMode(signedInAuth, signedInGateState());
    expect(mode).toEqual({ kind: 'error', errorCode: 'INTERNAL' });
  });

  it('reproduction guard: an unclassified throw would leave the gate spinning forever', async () => {
    // This documents the pre-fix failure mode. With no error code recorded (the
    // throw having escaped) and the bootstrap flag still null, the gate decision
    // falls through to the indefinite in-progress spinner — no error, no Retry.
    // After the fix the cycle ALWAYS records a code, so this branch is never the
    // post-throw state; the assertion proves the decision layer's fall-through is
    // exactly the trap the fix removes.
    const trappedMode = selectSyncGateMode(signedInAuth, {
      bootstrapCompletedAt: null,
      lastCycleErrorCode: null,
    });
    expect(trappedMode).toEqual({ kind: 'in-progress' });

    // ...and the fixed cycle never leaves the channel in that state after a throw.
    mockRunBootstrapper.mockImplementation(() => {
      throw new Error('unexpected');
    });
    await runSyncCycle();
    expect(getCycleErrorCode()).not.toBeNull();
    expect(selectSyncGateMode(signedInAuth, signedInGateState()).kind).toBe('error');
  });
});
