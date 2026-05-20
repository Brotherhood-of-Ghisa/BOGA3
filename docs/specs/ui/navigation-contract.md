# Navigation Contract (Authoritative Current Flows)

## Purpose

Brief entrypoint contract for current mobile routes, query/path params, and allowed route transitions.

- This doc answers: "which routes exist, what params matter, and how screens navigate between them?"
- Source files remain authoritative for exact navigation call sites and edge-case behavior.

## Sources

- `docs/specs/ui/screen-map.md`
- `docs/specs/ui/repo-discovery-baseline.md`
- Route files under `apps/mobile/app/**`

## Status legend

- `Current behavior (authoritative)`: verified against current app code.
- `Pending / planned`: approved direction documented for `docs/plans/navigation-redesign/plan.md` task chain (t2–t8) but not yet implemented.

## Router baseline (current)

- Router system: `expo-router` (file-based routes in `apps/mobile/app/`)
- Root stack/layout: `apps/mobile/app/_layout.tsx`
- Navigation is currently string-path based (no centralized typed route helper layer)

## Route + param summary (current)

1. `/` (alias)
- File: `apps/mobile/app/index.tsx`
- Params:
  - none
- Behavior:
  - re-exports `/session-list`

2. `/session-list`
- File: `apps/mobile/app/session-list.tsx`
- Params:
  - none
- Behavior:
  - focus refreshes data via local reload token

3. `/session-recorder`
- File: `apps/mobile/app/session-recorder.tsx`
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
- File: `apps/mobile/app/exercise-catalog.tsx`
- Query params:
  - `source` (optional; `session-recorder` enables recorder-return affordances)
  - `intent` (optional; `add` auto-opens create editor once on initial load)
- Behavior:
  - when opened from recorder, saving an exercise returns via `router.back()`

5. `/settings`
- File: `apps/mobile/app/settings.tsx`
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

1. `/` -> `/session-list`
   - default route alias behavior
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

- Static titles for `index`, `session-list`, `session-recorder`, `exercise-catalog` are set in `apps/mobile/app/_layout.tsx`
- Static titles for `settings` and `profile` are also set in `apps/mobile/app/_layout.tsx`
- `completed-session/[sessionId]` sets its title inside the route file (current title: `View Session`)
- `exercise-history` sets its title inside the route file to the resolved exercise name (falls back to `Exercise History` when the summary is not yet available)

## Pending / planned (navigation-redesign target state)

The `navigation-redesign` plan (`docs/plans/navigation-redesign/plan.md`, tasks t2–t8) introduces a `(tabs)` route group, a redirect for `/session-list`, an updated recorder dismiss target, and a hideable bottom tray. None of the items below are live today; they describe the contract that subsequent tasks will land.

### Planned router baseline

- Router system: `expo-router` (unchanged).
- A new route group `apps/mobile/app/(tabs)/` will host the three tab roots (`stats-history`, `session-recorder`, `exercise-catalog`) and `settings`. The group's `_layout.tsx` will own the shared bottom tray.
- The root stack (`apps/mobile/app/_layout.tsx`) will declare the `(tabs)` group plus the detail screens (`completed-session/[sessionId]`, `exercise-history`, `profile`, `maestro-harness`) and a redirect stub for `session-list`.
- Navigation remains string-path based; no typed route helper layer is introduced by this plan.

### Planned route + param summary

1. `/` (alias, planned)
- File: `apps/mobile/app/index.tsx`
- Behavior:
  - redirects to `/stats-history` instead of `/session-list`

2. `/session-list` (planned redirect stub)
- File: `apps/mobile/app/session-list.tsx` (becomes a thin redirect; removed entirely in t8 if no external dependency surfaces)
- Behavior:
  - redirects to `/stats-history` (history view) so existing maestro flows and any deep links continue to land on the merged tab until t8 retargets the harness

3. `/stats-history` (planned tab root)
- File: `apps/mobile/app/(tabs)/stats-history.tsx`
- Query params:
  - none required at the route boundary; the segmented `Stats ↔ History` view selection is in-route UI state, not a URL query param
- Behavior:
  - default sub-view is `Stats`
  - per-view scroll position is preserved when toggling between `Stats` and `History` within the tab

4. `/session-recorder` (planned Log tab root; URL preserved)
- File: `apps/mobile/app/(tabs)/session-recorder.tsx`
- Query params:
  - `mode` (optional; `completed-edit` enables completed-session edit flow, unchanged)
  - `sessionId` (optional; used by completed-edit flow, unchanged)
- Behavior:
  - empty state (no active session, `mode !== 'completed-edit'`) renders a single primary `Start Session` CTA which creates a session via the existing data layer and reveals the recorder body in place
  - dismiss targets for the active/save flow change from `dismissTo('/')` to `dismissTo('/stats-history')` (see `apps/mobile/app/session-recorder.tsx:1604,1619`)
  - completed-edit mode (`mode=completed-edit`) is unchanged in behavior and continues to dismiss to `/stats-history` after save
  - URL path `/session-recorder` is intentionally preserved so `apps/mobile/src/sync/scheduler.ts` (`SESSION_RECORDER_ROUTE_SEGMENT`) needs no change; the recorder sync cadence still flips correctly on this route segment
  - maintenance rule (unchanged): if this route path/segment is renamed in a future change, update `apps/mobile/src/sync/scheduler.ts` in the same task/session

5. `/exercise-catalog` (planned Exercises tab root)
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Query params:
  - `source`, `intent` — unchanged from today's contract

6. `/settings` (planned; path preserved)
- File: `apps/mobile/app/(tabs)/settings.tsx`
- Behavior:
  - reached from the Settings cog utility action rendered inside the bottom tray (not a tab); the cog is available from every screen that renders the tray
  - remains accessible while logged out

7. `/exercise-history` (detail screen, planned to remain unchanged path-wise)
- File: `apps/mobile/app/exercise-history.tsx`
- Query params:
  - `exerciseDefinitionId`, `period`, `tagDefinitionId` — unchanged from today's contract
- Behavior:
  - remains a detail screen pushed onto the root stack (outside the `(tabs)` group); not a tab root
  - reached from the Stats sub-view inside the Stats/History tab via the per-exercise history picker
  - continues to mount its own bottom tray (the t7-reshaped 3-tab + cog component) rather than inheriting it from `(tabs)/_layout.tsx`

### Planned allowed route transitions (delta from current)

The transitions below replace or augment the current list. Items not listed here are unchanged.

1. `/` → `/stats-history` (replaces `/` → `/session-list`)
2. `/session-list` → `/stats-history` (redirect stub; replaces today's `/session-list` as a real route)
3. `/stats-history` → `/completed-session/<sessionId>` (history row tap; replaces `/session-list` → `/completed-session/<sessionId>`)
4. `/stats-history` → `/session-recorder?mode=completed-edit&sessionId=<sessionId>` (edit completed session from history row actions; replaces the equivalent transition from `/session-list`)
5. `/stats-history` → `/exercise-history?exerciseDefinitionId=<id>` (per-exercise history picker inside the Stats sub-view; replaces `/stats` → `/exercise-history`)
6. `/session-recorder` (active or save) → `/stats-history` (replaces `dismissTo('/')` with `dismissTo('/stats-history')`)
7. `/completed-session/<sessionId>` → `/stats-history` (replaces `dismissTo('/')` after successful reopen)
8. `/stats-history` ↔ `/session-recorder` ↔ `/exercise-catalog` (tab switches via the bottom tray; no path-level redirects required, expo-router handles tab focus)
9. Any screen that renders the bottom tray → `/settings` (cog utility action; the cog is not a tab)

### Planned header titles

- `headerShown: false` on every tab root (`stats-history`, `session-recorder`, `exercise-catalog`, and on `settings` while it lives under `(tabs)`).
- Detail screens (`completed-session/[sessionId]`, `exercise-history`, `profile`, `session-recorder?mode=completed-edit`, `maestro-harness`) keep their existing titled headers.

### Planned tray rendering rule

- Tab roots inherit the tray from `apps/mobile/app/(tabs)/_layout.tsx`.
- Detail screens that should keep the tray visible (`completed-session/[sessionId]`, `exercise-history`, `profile`) continue to mount the shared bottom-tray component themselves rather than relying on inheritance from `(tabs)/_layout.tsx`.

## Documentation boundary

- Keep this doc concise and contract-oriented.
- Do not duplicate every navigation call site or all route edge cases from source.
- If a task changes route paths, params, redirects, or screen-to-screen transitions, update this doc in the same session.
