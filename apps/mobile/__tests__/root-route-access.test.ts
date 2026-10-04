import type { Session } from '@supabase/supabase-js';

import { selectFirstSyncDrained, selectRootRouteAccess } from '@/src/navigation/root-route-access';

const session = { user: { id: 'user-1' } } as unknown as Session;
const signedIn = { isConfigured: true, session };
const signedOut = { isConfigured: true, session: null };
const unconfigured = { isConfigured: false, session: null };

describe('selectRootRouteAccess', () => {
  it('sends a configured, signed-out user to sign-in', () => {
    expect(selectRootRouteAccess(signedOut, false, true)).toBe('sign-in');
  });

  it('sends a signed-in user to sign-in when a cycle reported no signed-in user', () => {
    expect(selectRootRouteAccess(signedIn, true, true)).toBe('sign-in');
    expect(selectRootRouteAccess(signedIn, true, false)).toBe('sign-in');
  });

  it('holds a signed-in user on the first-sync block until the first sync drains', () => {
    expect(selectRootRouteAccess(signedIn, false, false)).toBe('sync-setup');
  });

  it('opens the app once the first sync has drained', () => {
    expect(selectRootRouteAccess(signedIn, false, true)).toBe('app');
  });

  it('opens the app on an unconfigured local-only build, whatever the sync state', () => {
    expect(selectRootRouteAccess(unconfigured, false, false)).toBe('app');
    expect(selectRootRouteAccess(unconfigured, true, false)).toBe('app');
  });
});

describe('selectFirstSyncDrained', () => {
  const drainedAt = new Date(1_700_000_000_000);

  it('is drained only once the bootstrap flag is set', () => {
    expect(selectFirstSyncDrained({ bootstrapCompletedAt: null, lastCycleErrorCode: null })).toBe(false);
    expect(selectFirstSyncDrained({ bootstrapCompletedAt: drainedAt, lastCycleErrorCode: null })).toBe(true);
  });

  it('keeps the block on any cycle error while the flag is null, including AUTH_REQUIRED', () => {
    expect(selectFirstSyncDrained({ bootstrapCompletedAt: null, lastCycleErrorCode: 'INTERNAL' })).toBe(false);
    expect(selectFirstSyncDrained({ bootstrapCompletedAt: null, lastCycleErrorCode: 'AUTH_REQUIRED' })).toBe(false);
  });

  it('is not drained while the store holds another account, whatever its flag says', () => {
    const otherAccountsStore = {
      bootstrapCompletedAt: drainedAt,
      lastCycleErrorCode: null,
      localDataOwnerId: 'previous-account',
    };
    expect(selectFirstSyncDrained(otherAccountsStore, 'user-1')).toBe(false);
    expect(selectFirstSyncDrained({ ...otherAccountsStore, localDataOwnerId: 'user-1' }, 'user-1')).toBe(true);
    // A store from before the owner was recorded is judged by its flag.
    expect(selectFirstSyncDrained({ ...otherAccountsStore, localDataOwnerId: null }, 'user-1')).toBe(true);
  });

  it("treats the harness's pinned in-progress state as not drained", () => {
    expect(
      selectFirstSyncDrained({
        bootstrapCompletedAt: drainedAt,
        lastCycleErrorCode: null,
        forcedProgress: { phase: 'pull', layersCompleted: 1, rowsApplied: 3, offline: false },
      }),
    ).toBe(false);
  });
});
