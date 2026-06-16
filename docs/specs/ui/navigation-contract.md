# Navigation Contract (Authoritative Current Flows)

## Purpose

Brief entrypoint contract for current mobile routes, query/path params, and allowed route transitions.

- This doc answers: "which routes exist, what params matter, and how screens navigate between them?"
- Source files remain authoritative for exact navigation call sites and edge-case behavior.

## Sources

- `docs/specs/ui/screen-map.md`
- Route files under `apps/mobile/app/**`

## Router baseline (current)

- Router system: `expo-router` (file-based routes in `apps/mobile/app/`)
- Root stack/layout: `apps/mobile/app/_layout.tsx`
- A route-layer auth guard (`apps/mobile/components/navigation/auth-route-guard.tsx`) wraps the whole navigator inside the root layout. It runs before any screen paints and decides whether the user may proceed:
  - while the session restore is in flight, it renders a neutral loading view (no flash of the sign-in screen or a data screen);
  - when auth is configured and there is no session — or a sync cycle reported "no signed-in user" — it redirects to `/sign-in`, so a configured-but-signed-out launch never reaches a data screen;
  - when auth is unconfigured (no working credential path) it renders through, so local-only/dev builds are not stranded on a sign-in form.
- A first-sync gate (`apps/mobile/src/sync/SyncGate.tsx`) wraps the navigator immediately **below** the auth guard, so it only applies to a signed-in user. It keys on the persisted `sync_runtime_state.bootstrap_completed_at` flag:
  - while the flag is null for a signed-in user, it renders a full-screen "Setting up your data…" block (a phase label plus an advancing activity/progress indicator; an offline message instead of an indefinite spinner when the device is offline) in place of the navigator — no data screen is reachable until the first sync cycle drains;
  - once the flag is set, it renders the navigator through and the normal routes paint;
  - on a non-`AUTH_REQUIRED` cycle error it shows the error message and a single Retry that fires exactly one cycle; when the latest cycle outcome is `AUTH_REQUIRED` it redirects to `/sign-in` and renders no Retry;
  - it stands aside (renders through) when there is no session or auth is unconfigured, so an unconfigured/local build is never trapped behind a block nothing will lift; the `/sign-in` route itself is exempt so the redirect cannot loop.
- Tab roots live inside the `(tabs)` route group at `apps/mobile/app/(tabs)/` and share a tab layout at `apps/mobile/app/(tabs)/_layout.tsx`. The group name is parenthesised so it does not appear in URLs (e.g. `/session-recorder` resolves to `app/(tabs)/session-recorder.tsx`).
- Tab roots have `headerShown: false`; detail screens (`exercise-history`, `profile`, `completed-session/[sessionId]`, `maestro-harness`) remain outside `(tabs)/` and keep their existing native header behavior.
- Navigation is currently string-path based (no centralized typed route helper layer)

## Route + param summary (current)

1. `/` (alias)
- File: `apps/mobile/app/index.tsx`
- Params:
  - none
- Behavior:
  - renders an `expo-router` `Redirect` to `/stats-history`

2. `/sign-in`
- File: `apps/mobile/app/sign-in.tsx`
- Params:
  - none
- Behavior:
  - dedicated sign-in entry point the route-layer auth guard redirects to when auth is configured and there is no session (login-on-start enforcement)
  - reuses the signed-out email/password credential pattern from `/profile` (no new interaction pattern) with inline auth error feedback
  - on a successful sign-in the shared auth snapshot flips to a live session and the guard lets the app proceed; the screen itself does not navigate on success
  - already-signed-in render of this route redirects to `/`
  - auth-unconfigured render shows the disabled-reason message instead of a form that cannot succeed
  - `headerShown: false`

3. `/stats-history`
- File: `apps/mobile/app/(tabs)/stats-history.tsx`
- Params:
  - none
- Behavior:
  - tab root inside the `(tabs)` group; renders the merged Stats / History view with a top Stats ↔ History segmented toggle (History sub-view reuses the shared `HistoryList`; Stats sub-view hosts the period chips and per-exercise picker that links out to `/exercise-history`)
  - M16 muscle-history overlay opens and dismisses as in-route UI state on this route; no path, query param, redirect, or screen-to-screen transition is added for the overlay.

4. `/session-recorder`
- File: `apps/mobile/app/(tabs)/session-recorder.tsx`
- Query params:
  - `mode` (optional; `completed-edit` enables completed-session edit flow)
  - `sessionId` (optional; used by completed-edit flow)
- Behavior:
  - missing/invalid completed-edit inputs are handled by route UI state (no crash)
  - client sync cadence contract depends on this route segment:
    - active route segment `session-recorder` -> `10s` recorder cadence
    - all other routes -> `60s` general cadence
  - maintenance rule:
    - if this route path/segment is renamed, update `apps/mobile/src/sync/scheduler.ts` (`SESSION_RECORDER_ROUTE_SEGMENT`) in the same task/session.

5. `/exercise-catalog`
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Query params:
  - `source` (optional; `session-recorder` enables recorder-return affordances)
  - `intent` (optional; `add` auto-opens create editor once on initial load)
- Behavior:
  - when opened from recorder, saving an exercise returns via `router.back()`

6. `/settings`
- File: `apps/mobile/app/(tabs)/settings.tsx`
- Params:
  - none
- Behavior:
  - reached from the shared bottom-tray Settings cog (available from every tab root and the detail screens that still render `TopLevelTabs` directly)
  - remains accessible while logged out; it does not require an authenticated session before opening `/profile`
  - routes to `/profile` from the `Profile` destination row

7. `/profile`
- File: `apps/mobile/app/profile.tsx`
- Params:
  - none
- Behavior:
  - may briefly render a restoring banner while auth bootstrap resolves a stored session
  - renders in-place logged-out vs signed-in account states from the shared auth provider snapshot
  - signed-in state includes in-route sync controls/status (`Enable/Disable sync`, status line, last successful sync, inline retry/error hints) without navigating away
  - sync bootstrap/retry activity remains background/non-blocking; users can leave `/profile` while sync continues
  - sign-in/sign-out change route state without redirecting away from `/profile`
  - inline auth/profile failures do not redirect away from `/profile` or block returning to local-only routes

8. `/completed-session/[sessionId]`
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Path params:
  - `sessionId` (required dynamic segment)
- Query params:
  - `intent` (optional; `edit` redirects to `session-recorder` completed-edit mode)

9. `/exercise-history`
- File: `apps/mobile/app/exercise-history.tsx`
- Query params:
  - `exerciseDefinitionId` (required; if missing, the screen renders an error state instead of crashing)
  - `period` (optional; one of `7 | 30 | all`; defaults to `30` when absent/invalid)
  - `tagDefinitionId` (optional; pre-applies a tag filter when present)
- Behavior:
  - period and tag chip changes reload the summary in place; the route does not update its URL query string when these change
  - missing/invalid `exerciseDefinitionId` shows the in-screen error state and does not crash

## Allowed route transitions (current high-level flows)

1. `/` -> `/stats-history`
   - root redirect (renders `<Redirect />`)
2. `/stats-history` -> `/exercise-history?exerciseDefinitionId=<id>`
   - Stats sub-view per-exercise picker opens the per-exercise history view
3. `/stats-history` -> `/completed-session/<sessionId>`
   - History sub-view row tap (via the shared `HistoryList`)
4. `/session-recorder` <-> `/stats-history` / `/exercise-catalog`
   - tab switching via the shared bottom tray (`BottomTray` -> `TopLevelTabs`)
5. `/completed-session/<sessionId>` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - edit action
6. `/completed-session/<sessionId>?intent=edit` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - route-side redirect (`replace`)
7. `/completed-session/<sessionId>` -> `/session-recorder`
   - successful append of the historical session as planned target rows in the active recorder (creates an active session first when needed)
8. `/session-recorder...` -> `/`
   - successful submit/save (`dismissTo('/')`, forwarded to `/stats-history` by the root alias)
9. `/session-recorder` -> `/exercise-catalog?source=session-recorder&intent=manage`
   - exercise picker `Manage` action
10. `/exercise-catalog?source=session-recorder...` -> `/session-recorder`
   - explicit back action or post-save return (`router.back()`)
11. (any tab root or detail screen rendering `TopLevelTabs`) -> `/settings`
   - shared Settings cog in the bottom tray / top-level tab strip
12. `/settings` -> `/profile`
   - settings destination row
13. `/profile` -> `/profile`
   - in-place auth-state rerender on sign-in/sign-out; no route replacement
14. `/exercise-history` -> `/completed-session/<sessionId>`
   - session card tap or all-time-best row tap
15. (any guarded route) -> `/sign-in`
   - route-layer auth-guard redirect on a configured-but-no-session launch, or when a sync cycle reports "no signed-in user" (`<Redirect />`)
16. `/sign-in` -> `/`
   - successful sign-in: the guard stops redirecting and the app proceeds to the normal route; an already-signed-in render of `/sign-in` also redirects to `/`
17. (any signed-in route) -> first-sync block
   - the first-sync gate (below the auth guard) renders a full-screen "Setting up your data…" block in place of the navigator while `sync_runtime_state.bootstrap_completed_at` is null for a signed-in user; this is render-substitution, not a route replacement (the URL is unchanged), and it dismisses in place once the flag is set
18. first-sync block -> `/sign-in`
   - when the latest sync cycle outcome is `AUTH_REQUIRED`, the gate redirects to `/sign-in` (no Retry); the `/sign-in` route is exempt from the block so the redirect cannot loop

Note:

- Modal opens/closes are in-route UI state transitions, not route transitions.
- `session-recorder` exercise picker `Add new` now opens an in-route exercise editor modal rather than navigating to `/exercise-catalog`.

## Header titles (current, high level)

- Tab roots inside the `(tabs)` group (`stats-history`, `session-recorder`, `exercise-catalog`, `settings`) all run with `headerShown: false`; per-screen titles in `apps/mobile/app/(tabs)/_layout.tsx` are still declared for completeness but the visible tab bar is now `BottomTray` (composing `TopLevelTabs`) supplied via the `tabBar` prop. Detail screens that haven't yet moved into `(tabs)` (notably `exercise-history`) still render `TopLevelTabs` directly until they migrate.
- Detail screens registered in the root stack (`exercise-history`, `profile`, `maestro-harness`, `completed-session/[sessionId]`) keep their native stack header behavior; titles are declared in `apps/mobile/app/_layout.tsx`
- `completed-session/[sessionId]` sets its title inside the route file (current title: `View Session`)
- `exercise-history` sets its title inside the route file to the resolved exercise name (falls back to `Exercise History` when the summary is not yet available)

## Documentation boundary

- Keep this doc concise and contract-oriented.
- Do not duplicate every navigation call site or all route edge cases from source.
- If a task changes route paths, params, redirects, or screen-to-screen transitions, update this doc in the same session.
