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
//      only the first-sync block (`/sync-setup`) is reachable
//      (`selectSyncGateMode`).
//   3. `app` — everything else, including an unconfigured local-only build, where
//      no session or first sync can ever exist.

import { useSyncExternalStore } from 'react';

import { useAuth } from '@/src/auth';
import { getAuthRequiredSignal, subscribeToAuthRequiredSignal } from '@/src/sync/auth-required-signal';
import { selectSyncGateMode, type SyncGateDecisionSnapshot } from '@/src/sync/sync-gate-decision';
import { selectShouldRouteToSignIn, type AuthGateSnapshot } from '@/src/sync/use-auth-required-redirect';
import { useSyncGateState } from '@/src/sync/use-sync-gate-state';

export type RootRouteAccess = 'sign-in' | 'sync-setup' | 'app';

export const selectRootRouteAccess = (
  auth: AuthGateSnapshot,
  authRequiredSignal: boolean,
  gate: SyncGateDecisionSnapshot,
): RootRouteAccess => {
  if (selectShouldRouteToSignIn(auth, authRequiredSignal)) {
    return 'sign-in';
  }
  const mode = selectSyncGateMode(auth, gate);
  // `route-to-sign-in` mirrors the auth-required signal, already handled above.
  return mode.kind === 'in-progress' || mode.kind === 'error' ? 'sync-setup' : 'app';
};

export const useRootRouteAccess = (): RootRouteAccess => {
  const { isConfigured, session } = useAuth();
  const authRequiredSignal = useSyncExternalStore(
    subscribeToAuthRequiredSignal,
    getAuthRequiredSignal,
    getAuthRequiredSignal,
  );
  // The same composed gate snapshot the first-sync block renders (it honours the
  // harness's pinned in-progress state), so access and the block always agree.
  const gate = useSyncGateState();
  return selectRootRouteAccess({ isConfigured, session }, authRequiredSignal, gate);
};
