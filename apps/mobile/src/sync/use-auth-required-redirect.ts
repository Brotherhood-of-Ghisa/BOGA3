// The shared "should the app route the user to sign-in?" decision.
//
// Two independent inputs combine here:
//
//   1. The auth snapshot — when auth is configured and there is no session, no
//      data screen may render. When auth is unconfigured, local-only tracker
//      routes remain available because there is no credential path that could
//      produce a session.
//   2. The sync cycle's auth-required signal — a cycle that ran against the
//      server and got back "no signed-in user" means the stored session is gone
//      or invalid even if the local snapshot has not caught up yet.
//
// The root route access (`src/navigation/root-route-access.ts`) consumes this so
// the "treat a missing session as a route-to-sign-in, not a generic error" rule
// lives in exactly one place.

import type { AuthSnapshot } from '@/src/auth';

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
 * Missing auth configuration is treated as a local-only build: the sign-in
 * screen can still show its disabled credential path when opened directly, but
 * the route layer must not block normal tracker screens behind a session that
 * cannot exist.
 */
export const selectShouldRouteToSignIn = (
  snapshot: AuthGateSnapshot,
  authRequiredSignal: boolean,
): boolean => {
  if (!snapshot.isConfigured) {
    return false;
  }
  if (!snapshot.session) {
    return true;
  }
  return authRequiredSignal;
};
