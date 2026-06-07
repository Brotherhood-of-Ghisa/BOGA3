import {
  selectSyncGateMode,
  type SyncGateAuthSnapshot,
  type SyncGateDecisionSnapshot,
} from '@/src/sync/sync-gate-decision';

const signedIn: SyncGateAuthSnapshot = { isConfigured: true, session: { user: { id: 'u' } } };

const snapshot = (
  overrides: Partial<SyncGateDecisionSnapshot> = {},
): SyncGateDecisionSnapshot => ({
  bootstrapCompletedAt: null,
  lastCycleErrorCode: null,
  ...overrides,
});

describe('selectSyncGateMode', () => {
  it('passes through when auth is unconfigured', () => {
    expect(selectSyncGateMode({ isConfigured: false, session: null }, snapshot()).kind).toBe('pass');
  });

  it('passes through when there is no session', () => {
    expect(selectSyncGateMode({ isConfigured: true, session: null }, snapshot()).kind).toBe('pass');
  });

  it('passes through once the bootstrap flag is set', () => {
    expect(
      selectSyncGateMode(signedIn, snapshot({ bootstrapCompletedAt: new Date() })).kind,
    ).toBe('pass');
  });

  it('blocks a signed-in user whose first sync has not yet drained', () => {
    expect(selectSyncGateMode(signedIn, snapshot()).kind).toBe('in-progress');
  });

  it('routes to sign-in on AUTH_REQUIRED', () => {
    expect(
      selectSyncGateMode(signedIn, snapshot({ lastCycleErrorCode: 'AUTH_REQUIRED' })).kind,
    ).toBe('route-to-sign-in');
  });

  it('shows a retriable error for FK_VIOLATION, LOCAL_FK_VIOLATION, and INTERNAL', () => {
    expect(selectSyncGateMode(signedIn, snapshot({ lastCycleErrorCode: 'FK_VIOLATION' }))).toEqual({
      kind: 'error',
      errorCode: 'FK_VIOLATION',
    });
    expect(selectSyncGateMode(signedIn, snapshot({ lastCycleErrorCode: 'LOCAL_FK_VIOLATION' }))).toEqual({
      kind: 'error',
      errorCode: 'LOCAL_FK_VIOLATION',
    });
    expect(selectSyncGateMode(signedIn, snapshot({ lastCycleErrorCode: 'INTERNAL' }))).toEqual({
      kind: 'error',
      errorCode: 'INTERNAL',
    });
  });

  it('prefers the completed flag over a stale error code', () => {
    // A flag that flipped non-null means the device holds its data; the gate is
    // done regardless of an earlier error code lingering in the snapshot.
    expect(
      selectSyncGateMode(
        signedIn,
        snapshot({ bootstrapCompletedAt: new Date(), lastCycleErrorCode: 'INTERNAL' }),
      ).kind,
    ).toBe('pass');
  });
});
