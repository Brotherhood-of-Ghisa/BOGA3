# Navigation Contract (Authoritative Current Flows)

## Purpose

Brief entrypoint contract for current mobile routes, query/path params, and allowed route transitions.

- This doc answers: "which routes exist, what params matter, and how screens navigate between them?"
- Source files remain authoritative for exact navigation call sites and edge-case behavior.

## Sources

- `docs/specs/ui/screen-map.md`
- `docs/specs/ui/repo-discovery-baseline.md`
- Route files under `apps/mobile/app/**`

## Router baseline (current)

- Router system: `expo-router` (file-based routes in `apps/mobile/app/`)
- Root stack/layout: `apps/mobile/app/_layout.tsx`
- Tab roots live inside the `(tabs)` route group at `apps/mobile/app/(tabs)/` and share a tab layout at `apps/mobile/app/(tabs)/_layout.tsx`. The group name is parenthesised so it does not appear in URLs (e.g. `/session-recorder` resolves to `app/(tabs)/session-recorder.tsx`).
- Tab roots have `headerShown: false`; detail screens (`session-list`, `exercise-history`, `profile`, `completed-session/[sessionId]`, `maestro-harness`) remain outside `(tabs)/` and keep their existing native header behavior.
- Navigation is currently string-path based (no centralized typed route helper layer)

## Route + param summary (current)

1. `/` (alias)
- File: `apps/mobile/app/index.tsx`
- Params:
  - none
- Behavior:
  - renders an `expo-router` `Redirect` to `/stats-history`

2. `/session-list`
- File: `apps/mobile/app/session-list.tsx`
- Params:
  - none
- Behavior:
  - focus refreshes data via local reload token
  - this route is still live during the navigation redesign migration so the `session-list-decompose` task can extract reusable pieces; final retirement happens in `maestro-and-tests` once nothing still hits it

2a. `/stats-history`
- File: `apps/mobile/app/(tabs)/stats-history.tsx`
- Params:
  - none
- Behavior:
  - tab root inside the `(tabs)` group; renders the (legacy) Stats body verbatim until the `stats-history-tab` task layers the Stats↔History segmented toggle on top

2b. `/stats` (redirect)
- File: `apps/mobile/app/stats.tsx`
- Params:
  - none
- Behavior:
  - back-compat shim: renders an `expo-router` `Redirect` to `/stats-history`

3. `/session-recorder`
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

4. `/exercise-catalog`
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Query params:
  - `source` (optional; `session-recorder` enables recorder-return affordances)
  - `intent` (optional; `add` auto-opens create editor once on initial load)
- Behavior:
  - when opened from recorder, saving an exercise returns via `router.back()`

5. `/settings`
- File: `apps/mobile/app/(tabs)/settings.tsx`
- Params:
  - none
- Behavior:
  - reached from the shared top-level navigation utility action on `session-list` and `exercise-catalog`
  - remains accessible while logged out; it does not require an authenticated session before opening `/profile`
  - routes to `/profile` from the `Profile` destination row

6. `/profile`
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

7. `/completed-session/[sessionId]`
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Path params:
  - `sessionId` (required dynamic segment)
- Query params:
  - `intent` (optional; `edit` redirects to `session-recorder` completed-edit mode)

8. `/exercise-history`
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
   - root redirect (renders `<Redirect />`); replaces the previous `/session-list` alias
2. `/session-list` -> `/session-recorder`
   - start/open active session
3. `/session-list` -> `/completed-session/<sessionId>`
   - open completed session detail
4. `/session-list` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - edit completed session from session actions
5. `/session-list` <-> `/exercise-catalog`
   - top-level tabs
6. `/completed-session/<sessionId>` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - edit action
7. `/completed-session/<sessionId>?intent=edit` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - route-side redirect (`replace`)
8. `/completed-session/<sessionId>` -> `/`
   - successful reopen (`dismissTo('/')`)
9. `/session-recorder...` -> `/`
   - successful submit/save (`dismissTo('/')`)
10. `/session-recorder` -> `/exercise-catalog?source=session-recorder&intent=manage`
   - exercise picker `Manage` action
11. `/exercise-catalog?source=session-recorder...` -> `/session-recorder`
   - explicit back action or post-save return (`router.back()`)
12. `/session-list` -> `/settings`
   - shared top-level navigation utility action
13. `/exercise-catalog` -> `/settings`
   - shared top-level navigation utility action
14. `/settings` -> `/profile`
   - settings destination row
15. `/profile` -> `/profile`
   - in-place auth-state rerender on sign-in/sign-out; no route replacement
16. `/stats` -> `/exercise-history?exerciseDefinitionId=<id>`
   - "Per-exercise history" picker section opens the per-exercise history view
17. `/exercise-history` -> `/completed-session/<sessionId>`
   - session card tap or all-time-best row tap

Note:

- Modal opens/closes are in-route UI state transitions, not route transitions.
- `session-recorder` exercise picker `Add new` now opens an in-route exercise editor modal rather than navigating to `/exercise-catalog`.

## Header titles (current, high level)

- Tab roots inside the `(tabs)` group (`stats-history`, `session-recorder`, `exercise-catalog`, `settings`) all run with `headerShown: false`; per-screen titles in `apps/mobile/app/(tabs)/_layout.tsx` are still declared for completeness but the visible tab bar is now `BottomTray` (composing `TopLevelTabs`) supplied via the `tabBar` prop. Detail screens that haven't yet moved into `(tabs)` (notably `exercise-history`) still render `TopLevelTabs` directly until they migrate.
- Detail screens registered in the root stack (`session-list`, `stats` redirect shim, `profile`, `maestro-harness`) keep their native stack header behavior; titles are declared in `apps/mobile/app/_layout.tsx`
- `completed-session/[sessionId]` sets its title inside the route file (current title: `View Session`)
- `exercise-history` sets its title inside the route file to the resolved exercise name (falls back to `Exercise History` when the summary is not yet available)

## Documentation boundary

- Keep this doc concise and contract-oriented.
- Do not duplicate every navigation call site or all route edge cases from source.
- If a task changes route paths, params, redirects, or screen-to-screen transitions, update this doc in the same session.
