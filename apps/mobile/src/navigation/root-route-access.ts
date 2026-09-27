// Which root routes exist right now. The root stack
// (`components/navigation/root-stack.tsx`) lists every root route under one
// `Stack.Protected` group per access level and enables exactly one group, so the
// navigator itself decides where a user can be: when access changes, the routes of
// the old level leave the stack and the router lands on the first route still
// available. The navigator stays mounted throughout. (Unmounting it to show a
// block or a redirect, as the old guard and gate did, reverts the route on
// expo-router 57 and loops the redirect.)
//
// The levels, in priority order:
//
//   1. `sign-in` — auth is configured and the app must route the user to sign-in:
//      no session, or a sync cycle reported "no signed-in user"
//      (`selectShouldRouteToSignIn`).
//   2. `sync-setup` — a signed-in user whose first sync cycle has not drained:
//      only the first-sync block (`/sync-setup`) is reachable. Anything short of a
//      set bootstrap flag keeps the block, so an unexpected gate state fails
//      closed rather than opening data routes.
//   3. `app` — everything else, including an unconfigured local-only build, where
//      no session or first sync can ever exist.

import { useSyncExternalStore } from 'react';

import { useAuth } from '@/src/auth';
import { getAuthRequiredSignal, subscribeToAuthRequiredSignal } from '@/src/sync/auth-required-signal';
import {
  getSyncGateStateSnapshot,
  subscribeToSyncGateState,
  type SyncGateStateSnapshot,
} from '@/src/sync/sync-gate-state';
import { selectShouldRouteToSignIn, type AuthGateSnapshot } from '@/src/sync/use-auth-required-redirect';

export type RootRouteAccess = 'sign-in' | 'sync-setup' | 'app';

/**
 * Whether the first sync has drained, as the first-sync block sees it: the
 * harness's pinned in-progress state counts as not drained.
 */
export const selectFirstSyncDrained = (gate: SyncGateStateSnapshot): boolean =>
  !gate.forcedProgress && gate.bootstrapCompletedAt !== null;

export const selectRootRouteAccess = (
  auth: AuthGateSnapshot,
  authRequiredSignal: boolean,
  firstSyncDrained: boolean,
): RootRouteAccess => {
  if (selectShouldRouteToSignIn(auth, authRequiredSignal)) {
    return 'sign-in';
  }
  if (!auth.isConfigured || !auth.session || firstSyncDrained) {
    return 'app';
  }
  return 'sync-setup';
};

const getFirstSyncDrained = (): boolean => selectFirstSyncDrained(getSyncGateStateSnapshot());

export const useRootRouteAccess = (): RootRouteAccess => {
  const { isConfigured, session } = useAuth();
  const authRequiredSignal = useSyncExternalStore(
    subscribeToAuthRequiredSignal,
    getAuthRequiredSignal,
    getAuthRequiredSignal,
  );
  // A boolean, not the snapshot: the bridge republishes the snapshot every poll
  // tick while the flag is null, and the root stack should re-render only when
  // access changes.
  const firstSyncDrained = useSyncExternalStore(subscribeToSyncGateState, getFirstSyncDrained, getFirstSyncDrained);
  return selectRootRouteAccess({ isConfigured, session }, authRequiredSignal, firstSyncDrained);
};
