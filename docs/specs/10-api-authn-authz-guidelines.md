# API AuthN/AuthZ Guidelines (M5 Baseline)

> **Owns:** authN/authZ and API development/consumption rules. **Not here:** backend local-dev runbook → `supabase/README.md`; sync RPC contract → `tech/sync-v2-server-contract.md`. **Load when:** auth, RLS, or backend API work.

## Purpose

Minimal authN/authZ context every agent must know before:

- developing new backend APIs
- consuming backend APIs from the mobile app

This is the shortest operational summary. Use the "Further reading" section when a task changes auth, `RLS`, or security posture.

## Status / scope

- Applies to the current M5 backend baseline (`Supabase`).
- Captures the agreed design baseline for auth/authz and API usage.
- Includes the M11 mobile auth bootstrap/session baseline as it affects API consumers.

## Minimal rules (must know)

1. Backend auth/authz stack is `Supabase Auth + Postgres RLS`.
2. Authorization must be backend-enforced (`RLS` / DB constraints), never FE-only.
3. M5 auth method is `email + password` only.
4. Public self-signup is disabled.
5. User creation is controlled/admin-provisioned only (script or dashboard admin flow).
6. User-owned app rows normally use direct ownership linkage to `auth.users(id)` via `owner_user_id`; the M11 `user_profiles` table is the explicit exception and uses `id = auth.users.id`.
7. MVP sync-domain tables are user-private (including `gyms` for now).
8. Child tables also carry redundant `owner_user_id` and must enforce ownership consistency with parent rows (constraints/FKs).
9. `RLS` must be enabled on all user-owned tables with deny-by-default posture.
10. Normal app access uses `anon` key + user JWT; never use `service_role` from mobile/client code.
11. `service_role` is server-only/admin-only (provisioning, maintenance, tightly scoped backend tasks).
12. API changes must include negative-path tests for unauthorized and cross-user access denial.

## Practical guidance for API developers (backend)

- Prefer simple ownership policies on each table: compare `owner_user_id` to `auth.uid()`.
- Do not trust handler-level checks alone; keep DB constraints and `RLS` as the source of truth.
- Validate custom API inputs at the boundary (Edge Function/server handler) and rely on DB constraints for invariants.
- Do not expose `auth` schema via API surfaces.
- Treat `owner_user_id` as immutable after insert unless a task explicitly defines a safe migration/admin path.

## Practical guidance for API consumers (mobile/app)

- Use client-safe Supabase credentials only (`anon` key), plus the authenticated user session token.
- Mobile auth bootstrap reads `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`; missing config must not crash the app, but the route layer still fails closed to the sign-in screen where the disabled auth state is visible.
- Persist and restore the normal `Supabase Auth` session; do not invent an app-specific long-lived token format.
- Assume all user data access is scoped to the authenticated user by backend policy.
- Never assume the client can override ownership (`owner_user_id`) for another user.
- For M11 profile work, read/write `app_public.user_profiles` as the authenticated user and lazily create the row on first profile load/save if it does not exist yet.
- Email and password updates stay on the `Supabase Auth` user object (`auth.updateUser`), not in `app_public.user_profiles`.
- Keep auth/profile failures route-local and inline; sign-in/sign-out/profile errors must not block local-only tracker routes or imply hidden sync side effects.
- Handle auth failures and `RLS` denials as expected runtime outcomes (not exceptional backend bugs by default).
- Do not embed or request `service_role` credentials for any app feature.

## Mobile app login/session routing policy

The mobile app's top-level product contract is **login before use**. App launch
may restore a persisted Supabase Auth session automatically, but cached local
SQLite app data is never treated as proof of identity. Without a live Supabase
session, the route layer must render the sign-in route (or the sign-in-unavailable
state when auth config is missing) before any data screen can paint.

### Decision flow

```mermaid
flowchart TD
  launch[App launch / RootLayout mounts] --> auth_boot[AuthProvider bootstraps auth state]
  auth_boot --> config{Supabase mobile env configured?}

  config -- No --> missing_env[Auth snapshot: ready, no session, disabledReason]
  missing_env --> guard_no_env[Route guard sees no session]
  guard_no_env --> sign_in_disabled[/sign-in: show sign-in unavailable + missing env]

  config -- Yes --> restore[Supabase auth.getSession from persisted auth storage]
  restore --> restoring{Restore in flight?}
  restoring -- Yes --> loading[Route guard shows neutral Loading state]
  loading --> restore
  restoring -- No --> session{Restored session?}

  session -- Yes --> stale{Sync raised AUTH_REQUIRED?}
  stale -- No --> app[Render app screens]
  stale -- Yes --> sign_in[/sign-in: ask user to sign in again]

  session -- No --> sign_in
  sign_in --> credentials[User enters email + password]
  credentials --> success{signInWithPassword succeeds?}
  success -- Yes --> persist[Supabase persists session; auth snapshot has session]
  persist --> app
  success -- No --> inline_error[Stay on /sign-in and show inline error]
```

### Case table

| Case | Expected behavior | Why |
| --- | --- | --- |
| Auth config exists and a persisted Supabase session restores | Auto-enter the app. | The session is the authenticated identity; no manual login prompt is needed. |
| Auth config exists and no session restores | Redirect to `/sign-in`. | The app has a working credential path and no authenticated user. |
| Auth config exists, a stale session is present, and sync reports `AUTH_REQUIRED` | Redirect to `/sign-in`. | The server has rejected the current auth state; route to credential repair instead of showing a generic sync error. |
| Auth config is missing | Route to `/sign-in` and show the disabled auth message. | Misconfiguration must be visible and fail closed; it is not permission to use local-only data screens. |
| User signs in successfully | Persist the Supabase session and allow app screens. | Supabase Auth owns session persistence and token refresh. |
| User signs in unsuccessfully | Stay on `/sign-in` and show inline feedback. | Failed credentials must not transition into app state. |
| User signs out or switches account | Clear the session and wipe local account-scoped data before the next account uses the device. | Prevents one user's local data from leaking into another account or suppressing first-sign-in restore. |
| Device is offline at launch with a valid persisted session | Allow app screens from the restored session; sync waits until reachable. | Offline availability is tied to an already-authenticated cached session, not anonymous use. |
| Device is offline at launch with no persisted session | Show `/sign-in`; sign-in may fail until network/auth is available. | Cached local app data alone is not authentication. |
| A future guest/offline mode is explicitly added | It must be a distinct product mode with clear UI, disabled sync/profile/server features, and separate tests. | Guest/local-only use must be deliberate, not a fallback from broken auth. |

### Implementation ownership

- `apps/mobile/src/auth/supabase.ts` owns mobile Supabase client config and persisted-session options.
- `apps/mobile/src/auth/service.ts` owns bootstrapping/restoring the Supabase Auth session and publishing the shared auth snapshot.
- `apps/mobile/src/sync/use-auth-required-redirect.ts` owns the pure "should route to sign-in?" selector shared by the route guard and sync gate.
- `apps/mobile/components/navigation/auth-route-guard.tsx` owns the top-level redirect/loading decision before app screens render.
- `apps/mobile/app/sign-in.tsx` owns credential entry, inline auth errors, and the missing-auth-config disabled state.

## Local development / test expectations

- Use local Supabase runtime for auth/RLS/API verification when backend authz behavior changes.
- Use deterministic fixture identities (`user_a`, `user_b`) for ownership tests.
- Prefer real local Supabase Auth sign-in flows for auth tests (success/failure), not only mocked tokens.
- For mobile auth bootstrap/session work, cover the no-session, stored-session, and sign-out/session-clear paths before moving to profile UI tasks.
- For M11 profile changes, add local-Supabase contract coverage for `user_profiles` owner read/update/insert behavior plus mobile tests for username/email/password mutation states.
- For final M11 auth/profile proof, run the real iOS simulator happy path against local Supabase using the deterministic fixture credentials exposed by `supabase/scripts/auth-fixture-constants.sh`.
- Required test coverage for auth-sensitive API changes:
  - success path
  - unauthenticated denial
  - cross-user denial

## Minimal security hygiene

- Never log passwords, JWTs, refresh tokens, `Authorization` headers, or service-role keys.
- Keep auth error responses generic where user enumeration risk exists.
- Use Supabase built-in auth rate limiting/config hardening for M5 baseline (no custom rate limiter required unless scoped by a task).

## Further reading (load when needed)

- Testing requirements for backend auth/RLS/API work:
  - `docs/specs/06-testing-strategy.md`
- Local Supabase runtime and fixture commands:
  - `supabase/README.md`
