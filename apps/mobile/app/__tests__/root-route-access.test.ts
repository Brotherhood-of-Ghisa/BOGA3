import type { Session } from '@supabase/supabase-js';

import { selectRootRouteAccess } from '@/src/navigation/root-route-access';
import type { SyncGateDecisionSnapshot } from '@/src/sync/sync-gate-decision';

const session = { user: { id: 'user-1' } } as unknown as Session;
const signedIn = { isConfigured: true, session };
const signedOut = { isConfigured: true, session: null };
const unconfigured = { isConfigured: false, session: null };

const firstSyncPending: SyncGateDecisionSnapshot = { bootstrapCompletedAt: null, lastCycleErrorCode: null };
const bootstrapped: SyncGateDecisionSnapshot = {
  bootstrapCompletedAt: new Date(1_700_000_000_000),
  lastCycleErrorCode: null,
};

describe('selectRootRouteAccess', () => {
  it('sends a configured, signed-out user to sign-in', () => {
    expect(selectRootRouteAccess(signedOut, false, bootstrapped)).toBe('sign-in');
  });

  it('sends a signed-in user to sign-in when a cycle reported no signed-in user', () => {
    expect(selectRootRouteAccess(signedIn, true, bootstrapped)).toBe('sign-in');
    expect(selectRootRouteAccess(signedIn, true, firstSyncPending)).toBe('sign-in');
  });

  it('holds a signed-in user on the first-sync block until the first sync drains', () => {
    expect(selectRootRouteAccess(signedIn, false, firstSyncPending)).toBe('sync-setup');
  });

  it('keeps the first-sync block, with its Retry, on a retriable cycle error', () => {
    expect(selectRootRouteAccess(signedIn, false, { ...firstSyncPending, lastCycleErrorCode: 'INTERNAL' })).toBe(
      'sync-setup',
    );
  });

  it('opens the app once the first sync has drained', () => {
    expect(selectRootRouteAccess(signedIn, false, bootstrapped)).toBe('app');
  });

  it('opens the app on an unconfigured local-only build, whatever the sync state', () => {
    expect(selectRootRouteAccess(unconfigured, false, firstSyncPending)).toBe('app');
    expect(selectRootRouteAccess(unconfigured, true, firstSyncPending)).toBe('app');
  });
});
