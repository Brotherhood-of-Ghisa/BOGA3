// The shared "should the app route the user to sign-in?" decision.
//
// Two independent inputs combine here:
//
//   1. The auth snapshot — when there is no session, no data screen may render.
//      This is intentionally fail-closed even if the Supabase runtime config is
//      missing: a misconfigured build should show the sign-in/unavailable state,
//      not silently fall through to local-only app usage.
//   2. The sync cycle's auth-required signal — a cycle that ran against the
//      server and got back "no signed-in user" means the stored session is gone
//      or invalid even if the local snapshot has not caught up yet.
//
// Both the route-layer auth guard and the first-sync gate consume this so the
// "treat a missing session as a route-to-sign-in, not a generic error" rule
// lives in exactly one place.

import { useSyncExternalStore } from 'react';

import type { AuthSnapshot } from '@/src/auth';
import {
  getAuthRequiredSignal,
  subscribeToAuthRequiredSignal,
} from '@/src/sync/auth-required-signal';

/** The minimal auth-snapshot shape this decision reads. */
export type AuthGateSnapshot = Pick<AuthSnapshot, 'isConfigured' | 'session'>;

/**
 * Pure selector: given the current auth snapshot and the latest auth-required
 * signal, decide whether the user must be routed to the sign-in entry point.
 *
 * Returns true when EITHER:
 *   - there is no session, OR
 *   - the latest sync cycle reported "no signed-in user".
 *
 * Missing auth configuration is not treated as permission to use the app: the
 * sign-in screen owns showing the disabled credential path. That keeps the
 * top-level contract simple — no session means no data route.
 */
export const selectShouldRouteToSignIn = (
  snapshot: AuthGateSnapshot,
  authRequiredSignal: boolean,
): boolean => {
  if (!snapshot.session) {
    return true;
  }
  return authRequiredSignal;
};

/**
 * React hook wrapping {@link selectShouldRouteToSignIn}. Subscribes to the sync
 * cycle's auth-required signal so a session that silently expires mid-use (the
 * snapshot still holds a stale session, but a cycle just learned otherwise)
 * re-routes the user without waiting for the auth listener to fire.
 */
export const useShouldRouteToSignIn = (snapshot: AuthGateSnapshot): boolean => {
  const authRequiredSignal = useSyncExternalStore(
    subscribeToAuthRequiredSignal,
    getAuthRequiredSignal,
    getAuthRequiredSignal,
  );

  return selectShouldRouteToSignIn(snapshot, authRequiredSignal);
};
