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
- Root layout: `apps/mobile/app/_layout.tsx`; root stack and its screen declarations: `apps/mobile/components/navigation/root-stack.tsx`
- Root route access is enforced by the navigator itself. The root stack (`apps/mobile/components/navigation/root-stack.tsx`) declares every root route under exactly one `Stack.Protected` group per access level, and `useRootRouteAccess` (`apps/mobile/src/navigation/root-route-access.ts`) enables one level at a time:
  - `sign-in` — auth is configured and there is no session, or a sync cycle reported "no signed-in user": only `/sign-in` exists, so a configured-but-signed-out launch never reaches a data screen;
  - `sync-setup` — a signed-in user whose first sync has not drained (`sync_runtime_state.bootstrap_completed_at` is null): only the first-sync block `/sync-setup` exists (a phase label plus an advancing activity/progress indicator; an offline message instead of an indefinite spinner when the device is offline; on a retryable cycle error, the message and a single Retry that fires exactly one cycle; `UPDATE_REQUIRED` instead explains the required app update without Retry);
  - `app` — everything else, including an unconfigured build (no working credential path), where no session or first sync can ever exist; `/sign-in` stays reachable there to show the disabled credential path when opened directly.
- When the level changes, the routes of the old level leave the stack and the router lands on the first route still declared: `/sign-in`, `/sync-setup`, or `index` (which redirects to `/today`). A deep link to a route of another level lands the same way.
- The navigator is never unmounted or swapped out to gate access: on expo-router 57, unmounting it reverts the route, so a gate that renders a `<Redirect>` or a block in its place loops ("Maximum update depth exceeded"). The only thing rendered instead of the navigator is the restore guard's neutral loading view (`apps/mobile/components/navigation/auth-route-guard.tsx`), and only before the navigator first mounts: until the session restore resolves and, for a signed-in user, the persisted first-sync flag has been read, so a cold launch (and its deep link) lands on the right level the first time.
- Every root route file must be declared in the root stack: Expo Router appends an undeclared one outside every `Stack.Protected` group (`__tests__/root-stack-routes.test.ts` fails on one).
- `/maestro-harness` (dev/test self-gated) is declared last and exists at every level except `sign-in`: it is what lifts the first-sync block in tests, and it must never be where the router lands.
- Tab roots live inside the `(tabs)` route group at `apps/mobile/app/(tabs)/` and share a tab layout at `apps/mobile/app/(tabs)/_layout.tsx`. The group name is parenthesised so it does not appear in URLs (e.g. `/stats-history` resolves to `app/(tabs)/stats-history.tsx`).
- Tab roots have `headerShown: false`; detail screens (`exercise-history`, `profile`, `completed-session/[sessionId]`, `maestro-harness`, and the M22 group routes `group/mine`, `group/new`, `group/join`, `group/[groupId]`, `group/[groupId]/edit`, `group/[groupId]/invite`, `group-session/[memberId]/[sessionId]`, the M25 `exercise-link`, the M25-T08 routes `group/[groupId]/members`, `group/[groupId]/exercises/new`, `group/[groupId]/exercises/[exerciseId]/edit`, and the M25-T09 `group/[groupId]/leaderboards/[exerciseId]` and `…/history`) remain outside `(tabs)/` and keep their existing native header behavior (except `completed-session/[sessionId]`, which draws its own top bar).
- Navigation is mostly string-path based; `apps/mobile/src/navigation/routes.ts` holds a few route constants and builders (`SIGN_IN_ROUTE`, `GYMS_ROUTE`, and the M25 `exerciseLinkHref(id)`), not a full typed route layer.
- The production shell is the typed four-tab model in
  `apps/mobile/src/navigation/main-tabs.ts`: `Today / Train / Progress / More`.
  `MainTabBar` (`MainTabs` on the `paper` ground) renders exactly those
  destinations, the same bar on every screen that shows the tabs. Canonical routes are visible; preserved roots are
  registered with `href: null` and map to their canonical owner when opened
  directly.
  `/today` is a landing page: the local progress summary and one joined
  group's week. It starts and resumes nothing.
  `/train` now renders its real session-entry hub, through one coordinator that
  rechecks for an active draft and serializes empty/planned launch requests
  before persistence or materialization.
  `/progress` renders muscle comparison tables and inline exercise contributions;
  `/stats-history` re-exports that implementation as its compatibility path.
  `/more` renders the secondary-feature hub.
  The model maps legacy roots to their current owner; every recognized root
  route keeps one selected canonical destination mounted.

## Route + param summary (current)

1. `/` (alias)
- File: `apps/mobile/app/index.tsx`
- Params:
  - none
- Behavior:
  - renders an `expo-router` `Redirect` to `/today`

1b. `/today` (canonical tab)
- File: `apps/mobile/app/(tabs)/today.tsx`
- Params:
  - none
- Behavior:
  - composes the Progress card (the local progress summary, read again on each
    focus) and the Group activity card (one group's week)
  - Progress: `View progress` opens `/progress`, `All sessions` opens
    `/sessions`, the latest-session row opens `/completed-session/[sessionId]`,
    and with no completed session the empty panel's `Open Train` opens
    `/train` (transition 55). Nothing on Today opens `/session/<id>`: an
    active workout is reached from Train
  - Group activity: `View groups`, the board and the `<n> training now` row
    open `/groups?groupId=<selected group>` (`/groups` with no group); the
    one-member training-now row and the latest completed session open
    `/group-session/<memberId>/<sessionId>?groupId=<groupId>`; `Find a group` (no group) opens
    `/group/mine`; `Sign in` (signed out) opens `/sign-in`. Picking a chip
    changes the selection Today shares with the Groups screen; it does not
    navigate

1c. `/train` (canonical tab)
- File: `apps/mobile/app/(tabs)/train.tsx`
- Params:
  - none
- Behavior:
  - the Train tab, from any `MainTabs` strip, opens the workout in progress
    (`/session/<id>`) instead of `/train` when there is one (transition 57);
    a failed lookup opens `/train`
  - reads the active draft as one row (`findActiveSessionId`) on every focus
    and ignores every launch action until that succeeds
  - an active draft found by Train's read (Train reached by a link, Today's
    `Open Train`) pushes `/session/<id>`: no Resume action and no
    empty/planned action
  - with no draft, `Start` rechecks for an active session,
    persists one empty active draft through the existing session repository,
    and then pushes `/session/<id>` (transition 46); simultaneous entry requests share the
    same in-flight result, and persistence failure is inline and retryable
  - exposes typed loading/error/empty/ready/unavailable planning states; a
    ready plan supplies its own materializer and management callback, while the
    current production state is unavailable, which shows nothing beneath the
    disc, without blocking empty training or guessing a route

1d. `/progress` (canonical tab)
- File: `apps/mobile/app/(tabs)/progress.tsx`
- Query params:
  - the same optional `period` and `breakdown` values as `/stats-history`
- Behavior:
  - owns the shared Progress implementation: complete muscle comparisons,
    separate name-history links and selection chevrons, inline contributions
    and inert Total. Quiet Browse exercises / Sessions rows retain those exits.
  - `/stats-history` re-exports it. No redirect or second analytics surface.

1e. `/more` (canonical tab)
- File: `apps/mobile/app/(tabs)/more.tsx`
- Params:
  - none
- Behavior:
  - groups real secondary destinations under Community, Tools, and Library &
    account without copying their feature logic
  - internal rows open `/groups`, `/connected-agents`, `/gyms?source=more`,
    `/dev-logs`, `/exercise-catalog?source=more`, or `/settings?source=more`;
    the source marker gives Gyms, the Exercise Catalog and Settings an explicit `Back to More`
    action (Groups looks the same however it is opened),
    connected agents requires a current user, and developer logs requires
    `isDevMode()`
  - `Connect an AI coach` opens the same first-party MCP setup URL as Settings
    in the system browser and reports launch failure inline

2. `/sign-in`
- File: `apps/mobile/app/sign-in.tsx`
- Params:
  - none
- Behavior:
  - dedicated sign-in entry point: the only route while auth is configured and the user must sign in (login-on-start enforcement; `sign-in` access, see "Router baseline")
  - reuses the signed-out email/password credential pattern from `/profile` (no new interaction pattern) with inline auth error feedback
  - on a successful sign-in the shared auth snapshot flips to a live session; the root stack removes this route and the router lands on `/sync-setup` or `/`. The screen itself never navigates
  - auth-unconfigured render shows the disabled-reason message instead of a form that cannot succeed
  - `headerShown: false`

2b. `/sync-setup`
- File: `apps/mobile/app/sync-setup.tsx` (`SyncSetupScreen`, `apps/mobile/src/sync/SyncGate.tsx`)
- Params:
  - none
- Behavior:
  - the first-sync block: the only route (besides the dev/test harness) while a signed-in user's first sync has not drained (`sync-setup` access, see "Router baseline")
  - phase label and advancing activity line; offline message once NetInfo reports offline; on a non-`AUTH_REQUIRED` cycle error, the message and a single Retry
  - never navigates itself: the root stack removes it once the first sync drains, and the router lands on `/`
  - `headerShown: false`

3. `/stats-history`
- File: `apps/mobile/app/(tabs)/stats-history.tsx`
- Query params:
  - `period=7` selects This week; missing/other/invalid values select the configured window
  - `breakdown=exercise` opens retained exercise browsing; all other values open muscles
- Behavior:
  - re-exports `/progress`; query values select initial state and controls do
    not rewrite them. Browse exercises stays in-route; By Muscle returns to tables.
  - Muscle names open one muscle ID, chevrons select its inline contributions;
    family headings, figures and Total are inert. Exercise names open definition
    history. No new path/query/redirect for selection or history sheets.
  - Dismissal preserves muscle selection, table metric, period, search, sort and
    scroll, returning accessible focus to the launching name. Settings owns the
    saved look-back and view: unset/invalid Daily, valid saved Weekly retained.
    History metric/day/week is separate from table selection.

4b. `/session/[sessionId]`
- File: `apps/mobile/app/session/[sessionId]/index.tsx`
- Params:
  - `sessionId` (path; the active draft's id, or a completed session's)
- Behavior:
  - the session view; every app entry into the active session
    opens it through `sessionViewHref(sessionId)` in
    `apps/mobile/src/navigation/active-session-entry.ts` (transitions 9, 46)
  - a completed session opens it the same way from every
    completed-edit entry (transitions 3, 7, 8). It edits in place and `Done` returns with
    `router.back()` (`router.replace('/completed-session/<sessionId>')` with no
    history); it never replays completion
  - an id that is neither the active draft nor a completed, undeleted session
    renders an in-route state
  - leaving by the bottom bar or after Abandon uses `router.dismissTo`, so the
    tab below is reused rather than stacked
  - root-stack screen with `headerShown: false`; it draws its own top bar
  - client sync cadence is route-independent: the foreground scheduler (`apps/mobile/src/sync/scheduler.ts`) never reads the active route; session writes reach it only through the same post-commit write nudge (`apps/mobile/src/sync/write-nudge.ts`) as every other repo mutation

5. `/exercise-catalog`
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Query params:
  - `source` (optional; `session` returns to the session view after a save;
    `more` shows an explicit `Back to More` action)
  - `intent` (optional; `add` auto-opens create editor once on initial load;
    the session view passes `manage`)
- Behavior:
  - when opened from the session view (`source=session`), saving an exercise
    returns via `router.back()`
  - when opened from More, `Back to More` replaces to `/more`; the direct route
    remains valid without that action

6. `/settings`
- File: `apps/mobile/app/(tabs)/settings.tsx`
- Query params:
  - `source` (optional; `more` shows an explicit `Back to More` action)
- Behavior:
  - reached from the Settings row under `/more`; `Back to More` replaces to the
    hub when source-marked, while the direct path remains valid
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
  - opened from the Progress Sessions link row
  - uses the root stack's minimal back-button display mode (below): the
    platform back arrow remains, while `(tabs)` and other previous-route labels
    are hidden
  - active Resume and review/complete both push `/session/<sessionId>` (the
    session view, transition 46); `/sessions` never completes an active session
    directly
  - a completed row pushes `/completed-session/<sessionId>`;
    its overflow Edit pushes `/session/<sessionId>` (transition 3)
  - the row and active-session action menus are in-route `Sheet`s, not
    navigation; the active `Delete` confirms before discarding (DLM-T10)

10. `/completed-session/[sessionId]`
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Path params:
  - `sessionId` (required dynamic segment)
- Query params:
  - `intent` (optional; `edit` replaces to `/session/<sessionId>`, the session
    view editing the session)
  - `presentation` (optional; `completion` selects the post-submit summary,
    `summary`, absent and invalid values all select View Session with Summary active)
- Behavior:
  - completion mode hides historical edit/delete/append actions, is header-less
    (`headerShown: false`, `gestureEnabled: false`; its own top bar carries
    Done), and gives Done, Android system back, and unavailable-target states a
    replacing exit to `/progress`
  - every historical entry opens View Session with local `Summary | Sets` sections;
    Summary defaults to `By exercise`. Section changes push no route and preserve
    chart grouping. Legacy `presentation=summary` links use this same view.
  - `Edit` in either section pushes `/session/<sessionId>`; on `Done`, facts,
    sets and insights reload on focus, preserving the section and chart grouping.
    Direct-editor fallback opens View Session's Summary. A deleted session
    offers no `Edit` (the session view edits only a live session)
  - the detail is header-less (`headerShown: false`, stack title `View
    Session`) and draws its own top bar; its back is `router.back()`, or
    `router.replace('/progress')` with no history

11. `/exercise-history`
- File: `apps/mobile/app/exercise-history.tsx`
- Query params:
  - `exerciseDefinitionId` (required; if missing, the screen renders an error state instead of crashing)
  - `period` (optional; one of `7 | 30 | all`; defaults to `30` when absent/invalid)
  - `tagDefinitionId` (optional; pre-applies a tag filter when present)
- Behavior:
  - period and tag chip changes reload the summary in place; the route does not update its URL query string when these change
  - missing/invalid `exerciseDefinitionId` shows the in-screen error state and does not crash
  - the bests rows and each session card push `/completed-session/<sessionId>`
    (transition 23); the period and tag controls push nothing (DLM-T10)
  - it draws its own back arrow (`exercise-history-back`, label `Back`) in place
    of the native back item, which can stop dispatching on iOS 26.4 when the
    screen is reached from an active session; Back pops the stack, or replaces
    with `/progress` when nothing is below it

12. `/groups` (M22)
- File: `apps/mobile/app/(tabs)/groups.tsx`
- Query params:
  - `groupId` (optional): selects that group when it is in My groups
- Behavior:
  - preserved direct route owned by the canonical More tab; it looks the same
    from More, Today, or a direct link (no `Back to More`)
  - one group at a time, picked with the group chips (no `All`): the
    `groupId` param, else the group last shown this app session, else the
    first group by name; the chip and the `Stream` / `Leaderboards` segment
    are in-route state after that
  - managing groups (join, create, the group page) lives behind the header's
    `My groups`; nothing on this screen opens the group page
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
  - management only: the header (name, description, member count, role-gated
    `Invite` / `Edit`), then the group's Exercises; Members is its own route
    behind the header member count. The stream and leaderboards live on
    `/groups`

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

17a. `/group/[groupId]/members` (M25-T08)
- File: `apps/mobile/app/group/[groupId]/members.tsx`
- Path params:
  - `groupId` (required dynamic segment; a missing value renders the lost-access state)

17b. `/group/[groupId]/exercises/new` and `/group/[groupId]/exercises/[exerciseId]/edit` (M25-T08)
- Files: `apps/mobile/app/group/[groupId]/exercises/new.tsx`, `apps/mobile/app/group/[groupId]/exercises/[exerciseId]/edit.tsx`
- Path params:
  - `groupId` (required dynamic segment)
  - `exerciseId` (edit; required): the `group_exercise_id`; one missing from the cached list renders "This exercise is no longer available"
- Behavior:
  - the add screen's `From catalogue` / `Custom` choice is in-route state

17c. `/group/[groupId]/leaderboards/[exerciseId]` and `/group/[groupId]/leaderboards/[exerciseId]/history` (M25-T09)
- Files: `apps/mobile/app/group/[groupId]/leaderboards/[exerciseId]/index.tsx`, `apps/mobile/app/group/[groupId]/leaderboards/[exerciseId]/history.tsx`
- Path params:
  - `groupId`, `exerciseId` (the `group_exercise_id`; required; a missing value renders the lost-access state)
- Query params:
  - `metric` = `volume` | `e1rm` and `scope` = `certified` | `all`; absent/invalid metric uses the comparison default, and absent/invalid scope uses `certified`. History additionally accepts the saved legacy metric under its recorded revision
- Behavior:
  - the board writes in-place metric/scope selections back to the query; `History` passes those selections and the current rules revision

18. `/group-session/[memberId]/[sessionId]`
- File: `apps/mobile/app/group-session/[memberId]/[sessionId].tsx`
- Query params:
  - `groupId` (required authorized group scope; missing renders generic session unavailable)
- Path params:
  - `memberId`, `sessionId` (both required; a missing value renders "This session is no longer available")

19. `/exercise-link` (M25-T07)
- File: `apps/mobile/app/exercise-link.tsx`
- Query params:
  - `exerciseDefinitionId` (required; one of my exercises. Missing or unknown renders "This exercise isn't available" instead of crashing). Built by `exerciseLinkHref(id)` (`apps/mobile/src/navigation/routes.ts`)
- Behavior:
  - signed out or auth-unconfigured renders the group sign-in-required card
  - search, Link, Unlink (confirmed), and pull-to-refresh are in-route state; the route never navigates on its own

20. `/session/[sessionId]/exercise/[sessionExerciseId]`
- File: `apps/mobile/app/session/[sessionId]/exercise/[sessionExerciseId].tsx`
- Path params:
  - `sessionId` (an active session, or a completed one being edited from the session view) and `sessionExerciseId` (one of its exercises); both required. A missing or deleted session, or an exercise no longer in it, renders an inline message instead of the page
- Behavior:
  - no query params; the records panel, the open set and every sheet are in-route state
  - registered with `headerShown: false`: the page draws its own top bar

20b. `/session/[sessionId]/compare`
- File: `apps/mobile/app/session/[sessionId]/compare.tsx`
- Path params:
  - `sessionId` (required; the session the view has open). A missing or deleted session renders an in-route message
- Behavior:
  - no query params; the By exercise / By muscle grouping is in-route state
  - root-stack screen with the native header `Session vs history`; native Back returns to the session view
  - built by `sessionCompareHref` (`apps/mobile/src/navigation/active-session-entry.ts`)

20c. `/session/[sessionId]/add-exercise`
- File: `apps/mobile/app/session/[sessionId]/add-exercise.tsx`
- Path params:
  - `sessionId` (required; the session the view has open, active or a
    completed one being edited)
- Behavior:
  - no query params; search, filters, preselection and every sheet are in-route state
  - root-stack screen with `presentation: 'modal'` (an iOS page sheet) and
    `headerShown: false`: it draws its own title row with Close. Swipe-down or
    Close returns with `router.back()`; a successful add writes the draft, then
    `router.back()`; a failed add stays
  - built by `sessionAddExerciseHref` (`apps/mobile/src/navigation/active-session-entry.ts`)

21. `/gyms`
- File: `apps/mobile/app/gyms.tsx`
- Query params:
  - `source` (optional; `more` shows an explicit `Back to More` action)
- Behavior:
  - root-stack screen with the native header `Gyms`; the list, the in-place
    editor, its confirmations and `Show archived` are in-route state, and the
    route never navigates on its own except `Back to More`
  - `Back to More` pops back to the tabs (`router.dismissTo('/more')`), since
    the screen sits above them on the root stack; the direct route (and the
    session view's push) remains valid without it
  - built by `GYMS_ROUTE` (`apps/mobile/src/navigation/routes.ts`)

22. `/body-weight`
- File: `apps/mobile/app/body-weight.tsx`
- Params: none
- Behavior: native-header `Body weight` screen reached from Settings through
  `BODY_WEIGHT_ROUTE`; current reading and history reload on focus. Add/edit,
  delete confirmation and validation are in-route sheets/state. The header's
  shared `IconButton` arrow calls `router.back()` and returns to Settings, which
  reloads the current reading. This explicit action replaces the native back
  item, which stopped dispatching on repeated visits from an active session in
  the iOS 26.4 device flow; the native title/header and 44pt target remain.
  A direct entry without a back stack replaces with `/settings`.

## Allowed route transitions (current high-level flows)

1. `/` -> `/today`
   - root redirect (renders `<Redirect />`)
2. `/progress` or `/stats-history` -> `/exercise-history?exerciseDefinitionId=<id>`
   - Exercise page History opens the per-exercise history route; Progress exercise names open in-route history sheets
3. `/sessions` -> `/session/<sessionId>`
   - completed Session History row overflow Edit action: the session view,
     editing; `Done` returns by `router.back()`. The row tap opens
     `/completed-session/<sessionId>`.
4. `/progress` or `/stats-history` -> `/sessions`
   - Progress Sessions link row
5. (removed: Sessions' active Resume to the recorder; see 46)
6. `/today` <-> `/train` <-> `/progress` <-> `/more`
   - canonical switching via the shared bottom bar (`MainTabBar`); preserved `/stats-history`, `/exercise-catalog`, `/groups`,
     and `/settings` roots select Progress or More without becoming tabs
7. `/completed-session/<sessionId>` -> `/session/<sessionId>`
   - edit action (`push`); `Done` returns by `router.back()`
8. `/completed-session/<sessionId>?intent=edit` -> `/session/<sessionId>`
   - route-side redirect (`replace`)
9. `/completed-session/<sessionId>` -> `/session/<activeSessionId>`
   - `Append to current session` in an exercise card's ⋮ sheet: a successful append of that historical block as planned target rows in the active session (creates an active session first when needed); pushes the id the append returns
10. (removed: the recorder's active submit; see 47)
11. `/session/<sessionId>` (completed) -> the previous screen
   - `Done` after the completed-edit save (`router.back()`, or
     `router.replace('/completed-session/<sessionId>')` with no history);
     completion is not replayed
12. `/completed-session/<sessionId>?presentation=completion` -> `/progress`
   - Done, safe back, or unavailable-target exit (`replace`)
13. (removed: the recorder's completed-edit `Summary`)
14. `/completed-session/<sessionId>` -> its originating screen
    - Back pops once, falling back to Progress with no history. Summary / Sets
      switch locally; this also applies to legacy `presentation=summary` links.
15. (removed: the recorder picker's `Manage`; see 49)
16. (removed: the catalogue's return to the recorder; see 49)
17. `/more` -> `/settings?source=more`, `/exercise-catalog?source=more`, or `/groups`
   - Settings and Exercise Catalog rows carry their hub origin and expose
     `Back to More`; each unmarked direct route remains addressable
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
24. (any app route) -> `/sign-in`
   - a configured-but-no-session launch or sign-out, or a sync cycle reporting "no signed-in user": the root stack switches to `sign-in` access and the router lands on `/sign-in`
25. `/sign-in` -> `/sync-setup` or `/`
   - successful sign-in: the root stack removes `/sign-in`; the router lands on `/sync-setup` until the first sync drains, else on `index` (-> `/today`)
26. `/sync-setup` -> `/`
   - the first sync drains (`sync_runtime_state.bootstrap_completed_at` set): the root stack removes `/sync-setup` and the router lands on `index` (-> `/today`)
27. `/sync-setup` -> `/sign-in`
   - the latest sync cycle outcome is `AUTH_REQUIRED`: `sign-in` access, no Retry
28. `/groups` -> `/group/mine`
   - `My groups` header action
29. `/group/mine` -> `/group/<groupId>`
   - row tap in My groups, the only way to the group page from the Groups
     screen (stream membership items do not navigate)
30. `/groups` / `/today` -> `/group-session/<memberId>/<sessionId>?groupId=<groupId>`
   - stream session-card tap; on Today, the latest-activity row for one member training now or the latest completed session (`router.push`)
31. `/groups` (signed out, auth configured) -> `/sign-in`
   - `Sign in` action on the sign-in-required card
32. `/groups` / `/group/mine` -> `/group/new`, `/group/join`
   - `Join group` / `Create group` actions on My groups; the empty-state `Create group` / `Join with a code` on both (`router.push`)
33. `/group/new` -> `/group/<groupId>`; `/group/join` -> `/group/<groupId>`
   - after create, join, or `Open group` when already a member (`router.replace`, so Back returns to where the flow started)
34. `/group/<groupId>` -> `/group/<groupId>/invite`, `/group/<groupId>/edit`
   - owner/admin `Invite` / `Edit` header actions; edit returns with `router.back()` after saving
35. `/group/<groupId>/members` -> `/groups`
   - after a successful leave (`router.dismissTo('/groups')`); the tab's focus refresh drops the group from the chips
36. (external) `boga3://group/join?code=…` -> `/group/join?code=…`
   - the invite link
37. `/exercise-catalog` -> `/exercise-link?exerciseDefinitionId=<id>` (M25-T07)
   - Exercise Actions `⋮` `Link to group exercise…` (`router.push`; signed in only, disabled for a deleted exercise)
38. `/session/<sessionId>/exercise/<sessionExerciseId>` -> `/exercise-link?exerciseDefinitionId=<id>` (M25-T07)
   - the exercise page's ⋮ `Link to group exercise…` (the sheet closes, then `router.push`; signed in only); the open session is untouched
39. `/exercise-link` -> previous route
   - native back only
40. `/group/<groupId>` -> `/group/<groupId>/members` (M25-T08)
   - the header's member-count line (`router.push`); Back returns to the group screen
41. `/group/<groupId>` -> `/group/<groupId>/exercises/new`, `/group/<groupId>/exercises/<exerciseId>/edit` (M25-T08)
   - owner/admin `Add exercise` and the exercise sheet's `Rename` (`router.push`); both return with `router.back()` after saving, and the Exercises segment refreshes on focus
42. `/groups` -> `/group/<groupId>/leaderboards/<exerciseId>` (M25-T09)
   - a podium card on the Groups screen's Leaderboards segment (`router.push`, no query: comparison default · Certified)
43. `/group/<groupId>/leaderboards/<exerciseId>` -> `/group/<groupId>/leaderboards/<exerciseId>/history?metric=&scope=` (M25-T09)
   - the header `History` button with the current toggles; Back returns to the board, which reloads its first page on focus
44. `/groups`, `/group/<groupId>/leaderboards/<exerciseId>` -> `/group-session/<memberId>/<sessionId>?groupId=<groupId>` (M25-T10)
   - the row detail sheet's `View full session` (the sheet closes, then `router.push`); the sheet itself is in-route state opened from a record card or a full-board row
45. `/today` -> `/groups?groupId=<groupId>`, `/group/mine`
   - `View groups`, the week board or the `<n> training now` row (the selected group); `Find a group` with no group
46. `/train`, `/sessions`, `/completed-session/<sessionId>` (append) -> `/session/<sessionId>`
   - every active-session entry (a new launch, Sessions' review/complete,
     and the append of transition 9), through `sessionViewHref` (`router.push`).
     A session view of a workout in progress blocks the back gesture
     (`gestureEnabled: false`); it is left by the tab bar or Abandon/Finish
47. `/session/<sessionId>` -> `/completed-session/<sessionId>?presentation=completion`
   - Finish after its cleanup prompts and the completion write (`router.replace`)
48. `/session/<sessionId>` -> `/train` or another tab
   - Abandon session after its confirmation, or the bottom bar (`router.dismissTo`)
49. `/session/<sessionId>/add-exercise` -> `/exercise-catalog?source=session&intent=manage`
   - the picker's Manage (`router.push`, presented as a second page sheet over the picker, headerless); swipe-down or the catalogue's post-save `router.back()` returns to the picker as it was left
50. `/session/<sessionId>` -> `/session/<sessionId>/exercise/<sessionExerciseId>`
   - the session view's exercise card (`router.push`). Back, `Complete exercise` and `Remove from session` return with `router.back()`, and the session view reloads the draft on focus; with no history (a deep link) they `router.replace('/train')`
51. `/session/<sessionId>/exercise/<sessionExerciseId>` -> `/exercise-history?exerciseDefinitionId=<id>`
   - the records panel's `History` link (`router.push`)
52. `/session/<sessionId>` -> `/gyms`
   - the gym sheet's `Manage gyms` (the sheet closes, then `router.push`); native back returns, and the sheet reopens with the gyms reloaded
53. `/more` -> `/gyms?source=more`
   - the Tools `Gyms` row (`router.push`); native back or `Back to More` returns
54. `/settings` -> `/body-weight`
   - the always-visible `Body weight log` row uses `router.push` independently
     of the `Bodyweight calculations` preference; header Back returns to
     Settings. Workout/session routes never navigate to reading entry or
     history, so the dated kg timeline is managed only from Settings
55. `/today` -> `/progress`, `/sessions`, `/completed-session/<sessionId>`, `/train`
   - the Progress card (`router.push`): `View progress`, `All sessions`, the
     latest-session row, and the empty panel's `Open Train`. A session deleted
     since the read is gone on return: Today reads again on focus
56. `/session/<sessionId>` -> `/session/<sessionId>/compare`
   - the ⋮ sheet's `Session vs history` (the sheet closes, then `router.push`); native Back returns and the session view reloads on focus
57. any `MainTabs` strip -> `/session/<sessionId>` (the workout in progress)
   - the Train tab while a workout is in progress (`mainTabDestination`,
     `useOpenMainTab`): `router.push` from the tab bar and `exercise-history`,
     `router.dismissTo` from a completed session view; on the session view of
     the workout in progress the Train tab does nothing
58. `/session/<sessionId>` -> `/session/<sessionId>/add-exercise`
   - `+ Add exercise` (`router.push`); the picker returns with `router.back()`
     after an add, Close or a swipe down, and the session view reloads on focus

Note:

- Modal opens/closes are in-route UI state transitions, not route transitions.
- The exercise picker's `Add new` opens an in-route exercise editor modal rather than navigating to `/exercise-catalog`.
- The picker's group pick sheet (M25-T07) and its `Add as new` editor are in-route modals too, presented over the picker, which stays as it was.
- The exercise page's effort, options and swap sheets, the shared exercise editor it opens from `Edit exercise`, and its Complete / Remove confirmations (`Alert`) are in-route state.
- The record set row detail sheet (M25-T10) is an in-route modal on the Groups screen's Stream and the full board; certification writes and their confirmation `Alert`s stay on the same route.

## Header titles (current, high level)

- Routes inside the `(tabs)` group run with `headerShown: false`; per-screen
  titles in `apps/mobile/app/(tabs)/_layout.tsx` are declared for completeness.
  The visible shell is `MainTabBar`. `exercise-history` keeps its native stack header and
  renders the same `MainTabBar` with Progress selected.
- Detail screens registered in the root stack (`exercise-history`, `sessions`, `profile`, `connected-agents`, `gyms`, `maestro-harness`) keep their native stack header behavior; titles are declared in `apps/mobile/components/navigation/root-stack.tsx`. The root stack's `screenOptions` give every detail screen an arrow-only back affordance (`headerBackButtonDisplayMode: 'minimal'`, no custom `headerBackTitle`, which react-native-screens would render as a custom item that ignores the display mode and morphs its label in during the push); the system chevron's hidden label depends on the iOS runtime — "Back" on iOS 27, the previous route's title on iOS 26 (hence the `(tabs)` group's "Back" title) — so Maestro flows tap it by UIKit's `BackButton` id rather than by label. The same `screenOptions` give every native header one design-language style (DLM-T02): a `surface` background, an Archivo 700 `ink` title at `xl`, and an `ink` back arrow (`headerTintColor`).
- `completed-session/[sessionId]` sets its title inside the route file (`View Session` or `Session complete`); all presentations hide the native header and draw their own top bar (`back · View Session · ⋮ · Edit` or `Session complete · Done`), so the title is only the back label of what the detail pushes
- `exercise-history` sets its title inside the route file to the resolved exercise name (falls back to `Exercise History` when the summary is not yet available)
- M22 group routes declare `My groups`, `New group`, `Join group`, `Group`, `Edit group`, `Invite`, and `Session` in `apps/mobile/components/navigation/root-stack.tsx`; the group screen replaces `Group` with the group's name once loaded
- `session/[sessionId]/index` has no native header (`headerShown: false`); its
  own top bar reads `Session`, or `Edit session` for a completed session. The exercise page likewise draws its own. Their
  stack titles (`Session`, `Exercise`) are only the back label VoiceOver reads
  on the screens they push (`Gyms`, `Link exercise`)
- `body-weight` declares `Body weight` in `apps/mobile/components/navigation/root-stack.tsx`
- `gyms` declares `Gyms` in `apps/mobile/components/navigation/root-stack.tsx`
- `exercise-link` (M25-T07) declares `Link exercise` in `apps/mobile/components/navigation/root-stack.tsx` and replaces it with `Link "<exercise name>"` once the exercise resolves
- M25-T08 adds `Members`, `Add exercise`, and `Edit exercise` for the group routes in `apps/mobile/components/navigation/root-stack.tsx`

## Group calculation navigation

Boards use `metric=volume|e1rm` and `scope=certified|all`. The comparison's
current default chooses the opening metric. In-place toggles update parameters
when Expo reuses the screen. History carries a positive rules revision and keeps
recorded units; retired-revision Scores are unavailable. Every full-session exit
carries `groupId` and uses the group-scoped safe reader/cache. Record sheets never
route to or expose private reading context.

## Documentation boundary

- Keep this doc concise and contract-oriented.
- Do not duplicate every navigation call site or all route edge cases from source.
- If a task changes route paths, params, redirects, or screen-to-screen transitions, update this doc in the same session.
