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
  - when auth is unconfigured (no working credential path), it stands aside so local-only tracker routes remain available; the `/sign-in` route still shows the disabled credential path when opened directly;
  - `/sign-in` is exempt so the redirect cannot loop, and `/maestro-harness` is exempt so infra-free Maestro lanes can run the harness action before teleporting; the harness route still self-gates to development/test runtime contexts.
- A first-sync gate (`apps/mobile/src/sync/SyncGate.tsx`) wraps the navigator immediately **below** the auth guard, so it only applies to a signed-in user. It keys on the persisted `sync_runtime_state.bootstrap_completed_at` flag:
  - while the flag is null for a signed-in user, it renders a full-screen "Setting up your data…" block (a phase label plus an advancing activity/progress indicator; an offline message instead of an indefinite spinner when the device is offline) in place of the navigator — no data screen is reachable until the first sync cycle drains;
  - once the flag is set, it renders the navigator through and the normal routes paint;
  - on a non-`AUTH_REQUIRED` cycle error it shows the error message and a single Retry that fires exactly one cycle; when the latest cycle outcome is `AUTH_REQUIRED` it redirects to `/sign-in` and renders no Retry;
  - it stands aside (renders through) when there is no session or auth is unconfigured, so an unconfigured/local build is never trapped behind a block nothing will lift; the `/sign-in` and `/maestro-harness` routes are exempt so redirects and harness setup cannot loop.
- Tab roots live inside the `(tabs)` route group at `apps/mobile/app/(tabs)/` and share a tab layout at `apps/mobile/app/(tabs)/_layout.tsx`. The group name is parenthesised so it does not appear in URLs (e.g. `/session-recorder` resolves to `app/(tabs)/session-recorder.tsx`).
- Tab roots have `headerShown: false`; detail screens (`exercise-history`, `profile`, `completed-session/[sessionId]`, `maestro-harness`, and the M22 group routes `group/mine`, `group/new`, `group/join`, `group/[groupId]`, `group/[groupId]/edit`, `group/[groupId]/invite`, `group-session/[memberId]/[sessionId]`) remain outside `(tabs)/` and keep their existing native header behavior.
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
- Query params:
  - `period` (optional; validated `7 | 30`, default `7`)
  - `breakdown` (optional; validated `exercise | muscle`, default `exercise`)
- Behavior:
  - tab root inside the `(tabs)` group; renders the merged Stats / History view
    with separate labelled `Time range` (7-/30-day pills) and `Breakdown`
    (joined `By Exercise` / `By Muscle`) rows; both breakdown choices remain
    visible and `By Exercise` is the default
  - query values select only the initial control state; invalid values fall
    back to the same seven-day / By Exercise defaults
  - M16 muscle-history overlay opens and dismisses as in-route UI state on this route; no path, query param, redirect, or screen-to-screen transition is added for the overlay.

4. `/session-recorder`
- File: `apps/mobile/app/(tabs)/session-recorder.tsx`
- Query params:
  - `mode` (optional; `completed-edit` enables completed-session edit flow)
  - `sessionId` (optional; used by completed-edit flow)
- Behavior:
  - missing/invalid completed-edit inputs are handled by route UI state (no crash)
  - completed-edit is the default destination for a completed Session History
    row; its `Summary` action flushes valid pending edits before pushing
    `/completed-session/<sessionId>?presentation=summary`
  - client sync cadence is route-independent: the foreground scheduler (`apps/mobile/src/sync/scheduler.ts`) never reads the active route; recorder writes reach it only through the same post-commit write nudge (`apps/mobile/src/sync/write-nudge.ts`) as every other repo mutation, so renaming this route has no sync impact

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
  - routes to `/profile` from the `Account` destination row
  - opens the configured first-party `/connect` setup page in the system browser
    from `Connect an AI coach`; this external transition carries no OAuth state,
    session, callback, user identifier, or token, and launch failures stay inline
  - while signed in, routes to `/connected-agents` from a separate Connected
    agents destination row; the row is absent while signed out

7. `/connected-agents`
- File: `apps/mobile/app/connected-agents.tsx`
- Params:
  - none
- Behavior:
  - reads only the current signed-in user's Supabase OAuth grants
  - shows the most recent owner-visible metadata-only access timestamp when
    available; audit lookup failure does not disable grant revocation
  - asks for destructive confirmation before revoking a grant, then removes
    the revoked grant in place
  - auth guard requires a signed-in session; direct signed-out navigation
    redirects to `/sign-in`

8. `/profile`
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

9. `/sessions`
- File: `apps/mobile/app/sessions.tsx`
- Params:
  - none
- Behavior:
  - opened from the Stats Sessions summary card
  - uses the native stack's minimal back-button display mode plus a generic
    `Back` accessibility title: the platform back arrow remains, while `(tabs)`
    and other previous-route labels are hidden visually and from assistive
    technology
  - active Resume and review/complete both use `dismissTo('/session-recorder')`
    to return to the existing Log recorder; `/sessions` never completes an
    active session directly

10. `/completed-session/[sessionId]`
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Path params:
  - `sessionId` (required dynamic segment)
- Query params:
  - `intent` (optional; `edit` redirects to `session-recorder` completed-edit mode)
  - `presentation` (optional; `completion` selects the post-submit summary and
    `summary` selects the identical content from History; absent/invalid values
    preserve normal detail)
- Behavior:
  - completion mode hides historical edit/delete/append actions, disables the
    native back affordance/gesture, and gives Done, Android system back, and
    unavailable-target states a replacing exit to `/stats-history`
  - historical summary mode uses the same content and Share action without
    Done; explicit `History` and `Edit` header actions replace to `/sessions`
    and the still-mounted completed editor, and Android system back replaces to
    `/sessions`

11. `/exercise-history`
- File: `apps/mobile/app/exercise-history.tsx`
- Query params:
  - `exerciseDefinitionId` (required; if missing, the screen renders an error state instead of crashing)
  - `period` (optional; one of `7 | 30 | all`; defaults to `30` when absent/invalid)
  - `tagDefinitionId` (optional; pre-applies a tag filter when present)
- Behavior:
  - period and tag chip changes reload the summary in place; the route does not update its URL query string when these change
  - missing/invalid `exerciseDefinitionId` shows the in-screen error state and does not crash

12. `/groups` (M22)
- File: `apps/mobile/app/(tabs)/groups.tsx`
- Params:
  - none
- Behavior:
  - fourth tab root (`TopLevelTabs` key `groups`, testID `top-level-tab-groups`, mapped in `resolveActiveTab`)
  - the `All` / per-group chip selection is in-route state, not a query param
  - signed out or auth-unconfigured renders a sign-in-required card in place; configured builds offer `Sign in` (`/sign-in`)

13. `/group/mine`
- File: `apps/mobile/app/group/mine.tsx`
- Params:
  - none

14. `/group/[groupId]`
- File: `apps/mobile/app/group/[groupId]/index.tsx`
- Path params:
  - `groupId` (required dynamic segment; a missing value renders the lost-access state)
- Behavior:
  - the `Stream` / `Members` segment is in-route state

15. `/group/new` (M22-T05)
- File: `apps/mobile/app/group/new.tsx`
- Params:
  - none

16. `/group/join` (M22-T05)
- File: `apps/mobile/app/group/join.tsx`
- Query params:
  - `code` (optional): prefills the code field and runs the preview once the username gate is satisfied
- Deep link:
  - `boga3://group/join?code=XXXXXXXX` (the invite share link) opens this route; the static `group/join` segment wins over `group/[groupId]` (jest `groups-join-deep-link.test.tsx`)
  - a new link while the screen is open remounts it with the new code
  - known limitation: opening the link while signed out goes through `/sign-in` and lands on `/`, dropping the code (no return-to); reopening the link works

17. `/group/[groupId]/edit` and `/group/[groupId]/invite` (M22-T05)
- Files: `apps/mobile/app/group/[groupId]/edit.tsx`, `apps/mobile/app/group/[groupId]/invite.tsx`
- Path params:
  - `groupId` (required dynamic segment)

18. `/group-session/[memberId]/[sessionId]`
- File: `apps/mobile/app/group-session/[memberId]/[sessionId].tsx`
- Path params:
  - `memberId`, `sessionId` (both required; a missing value renders "This session is no longer available")

## Allowed route transitions (current high-level flows)

1. `/` -> `/stats-history`
   - root redirect (renders `<Redirect />`)
2. `/stats-history` -> `/exercise-history?exerciseDefinitionId=<id>`
   - Stats sub-view per-exercise picker opens the per-exercise history view
3. `/sessions` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - completed Session History row tap (via the shared `HistoryList`)
4. `/stats-history` -> `/sessions`
   - Stats Sessions summary card
5. `/sessions` -> `/session-recorder`
   - active Resume or review/complete dismisses the Sessions stack screen to the
     existing Log recorder; completion continues through recorder validation and
     cleanup rather than a direct repository status change
6. `/session-recorder` <-> `/stats-history` / `/exercise-catalog` / `/groups`
   - tab switching via the shared bottom tray (`BottomTray` -> `TopLevelTabs`); `exercise-history` also reaches `/groups` through its directly rendered `TopLevelTabs`
7. `/completed-session/<sessionId>` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - edit action
8. `/completed-session/<sessionId>?intent=edit` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - route-side redirect (`replace`)
9. `/completed-session/<sessionId>` -> `/session-recorder`
   - successful append of one selected historical exercise block as planned target rows in the active recorder (creates an active session first when needed)
10. `/session-recorder` -> `/completed-session/<sessionId>?presentation=completion`
   - successful active submit after persistence and completion both succeed
11. `/session-recorder?mode=completed-edit...` -> `/stats-history`
   - successful completed-session save; completion is not replayed
12. `/completed-session/<sessionId>?presentation=completion` -> `/stats-history`
   - Done, safe back, or unavailable-target exit (`replace`)
13. `/session-recorder?mode=completed-edit...` -> `/completed-session/<sessionId>?presentation=summary`
   - `Summary` after flushing pending valid edits (`push`)
14. `/completed-session/<sessionId>?presentation=summary` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>` or `/sessions`
   - explicit `Edit` pops to the live editor; `History` replaces to the list
15. `/session-recorder` -> `/exercise-catalog?source=session-recorder&intent=manage`
   - exercise picker `Manage` action
16. `/exercise-catalog?source=session-recorder...` -> `/session-recorder`
   - explicit back action or post-save return (`router.back()`)
17. (any tab root or detail screen rendering `TopLevelTabs`) -> `/settings`
   - shared Settings cog in the bottom tray / top-level tab strip
18. `/settings` -> `/profile`
   - Account destination row
19. `/settings` -> first-party `/connect` (system browser)
   - public MCP setup guidance; OAuth begins later in the user's MCP client
20. `/settings` -> `/connected-agents`
   - signed-in-only Connected agents destination row
21. `/connected-agents` -> `/connected-agents`
   - grant load, retry, and confirmed revocation update the route in place
22. `/profile` -> `/profile`
   - in-place auth-state rerender on sign-in/sign-out; no route replacement
23. `/exercise-history` -> `/completed-session/<sessionId>`
   - session card tap or all-time-best row tap
24. (any guarded route) -> `/sign-in`
   - route-layer auth-guard redirect on a configured-but-no-session launch, or when a sync cycle reports "no signed-in user" (`<Redirect />`)
25. `/sign-in` -> `/`
   - successful sign-in: the guard stops redirecting and the app proceeds to the normal route; an already-signed-in render of `/sign-in` also redirects to `/`
26. (any signed-in route) -> first-sync block
   - the first-sync gate (below the auth guard) renders a full-screen "Setting up your data…" block in place of the navigator while `sync_runtime_state.bootstrap_completed_at` is null for a signed-in user; this is render-substitution, not a route replacement (the URL is unchanged), and it dismisses in place once the flag is set
27. first-sync block -> `/sign-in`
   - when the latest sync cycle outcome is `AUTH_REQUIRED`, the gate redirects to `/sign-in` (no Retry); the `/sign-in` route is exempt from the block so the redirect cannot loop
28. `/groups` -> `/group/mine`
   - `My groups` header action
29. `/groups` -> `/group/<groupId>`; `/group/mine` -> `/group/<groupId>`
   - membership-item tap on the tab; row tap in My groups (membership items on the group screen itself do not navigate)
30. `/groups` / `/group/<groupId>` -> `/group-session/<memberId>/<sessionId>`
   - stream session-card tap (`router.push`)
31. `/groups` (signed out, auth configured) -> `/sign-in`
   - `Sign in` action on the sign-in-required card
32. `/groups` / `/group/mine` -> `/group/new`, `/group/join`
   - `Create group` / `Join group` header actions on the tab; the empty-state `Create group` / `Join with a code` on both (`router.push`)
33. `/group/new` -> `/group/<groupId>`; `/group/join` -> `/group/<groupId>`
   - after create, join, or `Open group` when already a member (`router.replace`, so Back returns to where the flow started)
34. `/group/<groupId>` -> `/group/<groupId>/invite`, `/group/<groupId>/edit`
   - owner/admin `Invite` / `Edit` header actions; edit returns with `router.back()` after saving
35. `/group/<groupId>` -> `/groups`
   - after a successful leave (`router.dismissTo('/groups')`); the tab's focus refresh drops the group from the chips
36. (external) `boga3://group/join?code=…` -> `/group/join?code=…`
   - the invite link

Note:

- Modal opens/closes are in-route UI state transitions, not route transitions.
- `session-recorder` exercise picker `Add new` now opens an in-route exercise editor modal rather than navigating to `/exercise-catalog`.

## Header titles (current, high level)

- Tab roots inside the `(tabs)` group (`stats-history`, `session-recorder`, `exercise-catalog`, `settings`) all run with `headerShown: false`; per-screen titles in `apps/mobile/app/(tabs)/_layout.tsx` are still declared for completeness but the visible tab bar is now `BottomTray` (composing `TopLevelTabs`) supplied via the `tabBar` prop. Detail screens that haven't yet moved into `(tabs)` (notably `exercise-history`) still render `TopLevelTabs` directly until they migrate.
- Detail screens registered in the root stack (`exercise-history`, `sessions`, `profile`, `connected-agents`, `maestro-harness`, `completed-session/[sessionId]`) keep their native stack header behavior; titles are declared in `apps/mobile/app/_layout.tsx`. `/sessions` specifically uses an arrow-only minimal back-button display mode with a generic `Back` accessibility title.
- `completed-session/[sessionId]` sets its title inside the route file (`View Session`, `Session complete`, or `Session summary`)
- `exercise-history` sets its title inside the route file to the resolved exercise name (falls back to `Exercise History` when the summary is not yet available)
- M22 group routes declare `My groups`, `New group`, `Join group`, `Group`, `Edit group`, `Invite`, and `Session` in `apps/mobile/app/_layout.tsx` (back title `Back`); the group screen replaces `Group` with the group's name once loaded

## Documentation boundary

- Keep this doc concise and contract-oriented.
- Do not duplicate every navigation call site or all route edge cases from source.
- If a task changes route paths, params, redirects, or screen-to-screen transitions, update this doc in the same session.
