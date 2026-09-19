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
- Tab roots have `headerShown: false`; detail screens (`exercise-history`, `profile`, `completed-session/[sessionId]`, `maestro-harness`, and the M22 group routes `group/mine`, `group/new`, `group/join`, `group/[groupId]`, `group/[groupId]/edit`, `group/[groupId]/invite`, `group-session/[memberId]/[sessionId]`, the M25 `exercise-link`, the M25-T08 routes `group/[groupId]/members`, `group/[groupId]/exercises/new`, `group/[groupId]/exercises/[exerciseId]/edit`, and the M25-T09 `group/[groupId]/leaderboards/[exerciseId]` and `…/history`) remain outside `(tabs)/` and keep their existing native header behavior.
- Navigation is mostly string-path based; `apps/mobile/src/navigation/routes.ts` holds a few route constants and builders (`SIGN_IN_ROUTE`, `MAESTRO_HARNESS_ROUTE`, and the M25 `exerciseLinkHref(id)`), not a full typed route layer.
- The production shell is the typed four-tab model in
  `apps/mobile/src/navigation/main-tabs.ts`: `Today / Train / Progress / More`.
  `MainTabs`, inside the existing collapsible `BottomTray`, renders exactly
  those destinations. Canonical routes are visible; preserved roots are
  registered with `href: null` and map to their canonical owner when opened
  directly.
  `/today` now renders its real overview by composing the existing active/recent
  session repository and joined-group stream; the planning slot reports the
  current unavailable dependency instead of inventing plan data.
  `/train` now renders its real session-entry hub. Today and Train share one
  coordinator that rechecks for an active draft and serializes empty/planned
  launch requests before persistence or materialization.
  `/progress` now renders the exact existing Stats / History implementation;
  `/stats-history` remains available with unchanged behavior as its legacy path.
  `/more` renders the secondary-feature hub.
  The model maps legacy roots to their current owner. Recorder routes are
  focused work and collapse persistent navigation to its peek handle; every
  recognized root route keeps one selected canonical destination mounted.

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
  - composes an active-session resume or planning state, a bounded joined-group
    stream snapshot, and the three most recent non-deleted completed sessions
    from the existing feature hooks/repository
  - group activity preserves signed-out, auth-unavailable, cached/offline,
    missing-data, and inline-error states; a session card opens the
    friend-session route, while a record card or membership row opens
    `/groups?groupId=<groupId>` (records are read-only here, with no Certify)
  - an active session replaces the planned-session action and resumes at
    `/session-recorder`; any future ready plan is launched through the shared
    active-draft coordinator; recent rows open
    `/completed-session/[sessionId]` and the section-level action opens
    `/progress`
  - until the separate planning milestone ships a read/materialization API, the
    planning slot uses the approved `Watch this space 👀` placeholder and links
    to `/train`; no scheduled data or materialization behavior is synthesized

1c. `/train` (canonical tab)
- File: `apps/mobile/app/(tabs)/train.tsx`
- Params:
  - none
- Behavior:
  - loads the existing session-list repository while focused and blocks every
    launch action until active-draft detection succeeds
  - an active draft replaces empty/planned actions with one Resume action to
    `/session-recorder`
  - with no draft, `Start empty workout` rechecks for an active session,
    persists one empty active draft through the existing recorder repository,
    and then opens `/session-recorder`; simultaneous entry requests share the
    same in-flight result, and persistence failure is inline and retryable
  - exposes typed loading/error/empty/ready/unavailable planning states; a
    ready plan supplies its own materializer and management callback, while the
    current production state uses the approved `Watch this space 👀` placeholder
    without blocking empty training or guessing a route

1d. `/progress` (canonical tab)
- File: `apps/mobile/app/(tabs)/progress.tsx`
- Query params:
  - the same optional `period` and `breakdown` values as `/stats-history`
- Behavior:
  - re-exports the current `/stats-history` route implementation rather than
    redirecting or copying it, so all controls, metrics, loading/error/empty
    states, session drill-downs, and exercise/muscle heat maps are identical
  - `/stats-history` stays available as the unchanged legacy path

1e. `/more` (canonical tab)
- File: `apps/mobile/app/(tabs)/more.tsx`
- Params:
  - none
- Behavior:
  - groups real secondary destinations under Community, Tools, and Library &
    account without copying their feature logic
  - internal rows open `/groups`, `/connected-agents`, `/dev-logs`,
    `/exercise-catalog?source=more`, or `/settings?source=more`; the source
    marker gives the Exercise Catalog and Settings an explicit `Back to More`
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
  - preserved Progress-owned route inside the `(tabs)` group; renders the merged
    Stats / History view
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
  - active mode rechecks the latest persisted draft whenever the mounted route
    regains focus, but never overwrites in-memory recorder mutations
  - the persistent shell defaults to its collapsed peek handle in active and
    completed-edit modes, so it can still be expanded for tab navigation; a
    successful active submit opens the completion presentation, while a
    successful completed edit replaces to `/progress`
  - client sync cadence is route-independent: the foreground scheduler (`apps/mobile/src/sync/scheduler.ts`) never reads the active route; recorder writes reach it only through the same post-commit write nudge (`apps/mobile/src/sync/write-nudge.ts`) as every other repo mutation, so renaming this route has no sync impact

5. `/exercise-catalog`
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Query params:
  - `source` (optional; `session-recorder` enables recorder-return affordances;
    `more` shows an explicit `Back to More` action)
  - `intent` (optional; `add` auto-opens create editor once on initial load)
- Behavior:
  - when opened from recorder, saving an exercise returns via `router.back()`
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
  - opened from the Stats Sessions summary card
  - uses the root stack's minimal back-button display mode (below): the
    platform back arrow remains, while `(tabs)` and other previous-route labels
    are hidden
  - active Resume and review/complete both use `dismissTo('/session-recorder')`
    to return to the existing recorder; `/sessions` never completes an
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
    unavailable-target states a replacing exit to `/progress`
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
  - `metric` = `weight` | `e1rm` and `scope` = `certified` | `all`; missing or anything else means `e1rm` / `certified` (the podium card's view)
- Behavior:
  - on the board the toggles are in-route state initialised from the query; they are not written back to the URL, and `History` passes the current toggles in its query

18. `/group-session/[memberId]/[sessionId]`
- File: `apps/mobile/app/group-session/[memberId]/[sessionId].tsx`
- Path params:
  - `memberId`, `sessionId` (both required; a missing value renders "This session is no longer available")

19. `/exercise-link` (M25-T07)
- File: `apps/mobile/app/exercise-link.tsx`
- Query params:
  - `exerciseDefinitionId` (required; one of my exercises. Missing or unknown renders "This exercise isn't available" instead of crashing). Built by `exerciseLinkHref(id)` (`apps/mobile/src/navigation/routes.ts`)
- Behavior:
  - signed out or auth-unconfigured renders the group sign-in-required card
  - search, Link, Unlink (confirmed), and pull-to-refresh are in-route state; the route never navigates on its own

## Allowed route transitions (current high-level flows)

1. `/` -> `/today`
   - root redirect (renders `<Redirect />`)
2. `/progress` or `/stats-history` -> `/exercise-history?exerciseDefinitionId=<id>`
   - Stats sub-view per-exercise picker opens the per-exercise history view
3. `/sessions` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - completed Session History row tap (via the shared `HistoryList`)
4. `/progress` or `/stats-history` -> `/sessions`
   - Stats Sessions summary card
5. `/sessions` -> `/session-recorder`
   - active Resume or review/complete dismisses the Sessions stack screen to the
     existing recorder; completion continues through recorder validation and
     cleanup rather than a direct repository status change
6. `/today` <-> `/train` <-> `/progress` <-> `/more`
   - canonical switching via the shared bottom tray (`BottomTray` ->
     `MainTabs`); preserved `/stats-history`, `/exercise-catalog`, `/groups`,
     and `/settings` roots select Progress or More without becoming tabs
7. `/completed-session/<sessionId>` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - edit action
8. `/completed-session/<sessionId>?intent=edit` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>`
   - route-side redirect (`replace`)
9. `/completed-session/<sessionId>` -> `/session-recorder`
   - successful append of one selected historical exercise block as planned target rows in the active recorder (creates an active session first when needed)
10. `/session-recorder` -> `/completed-session/<sessionId>?presentation=completion`
   - successful active submit after persistence and completion both succeed
11. `/session-recorder?mode=completed-edit...` -> `/progress`
   - successful completed-session save; completion is not replayed
12. `/completed-session/<sessionId>?presentation=completion` -> `/progress`
   - Done, safe back, or unavailable-target exit (`replace`)
13. `/session-recorder?mode=completed-edit...` -> `/completed-session/<sessionId>?presentation=summary`
   - `Summary` after flushing pending valid edits (`push`)
14. `/completed-session/<sessionId>?presentation=summary` -> `/session-recorder?mode=completed-edit&sessionId=<sessionId>` or `/sessions`
   - explicit `Edit` pops to the live editor; `History` replaces to the list
15. `/session-recorder` -> `/exercise-catalog?source=session-recorder&intent=manage`
   - exercise picker `Manage` action
16. `/exercise-catalog?source=session-recorder...` -> `/session-recorder`
   - explicit back action or post-save return (`router.back()`)
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
29. `/group/mine` -> `/group/<groupId>`
   - row tap in My groups, the only way to the group page from the Groups
     screen (stream membership items do not navigate)
30. `/groups` / `/today` -> `/group-session/<memberId>/<sessionId>`
   - stream session-card tap (`router.push`)
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
38. `/session-recorder` -> `/exercise-link?exerciseDefinitionId=<id>` (M25-T07)
   - exercise card `•••` `Link to group exercise…` (`router.push`; signed in only); the open session is untouched
39. `/exercise-link` -> previous route
   - native back only
40. `/group/<groupId>` -> `/group/<groupId>/members` (M25-T08)
   - the header's member-count line (`router.push`); Back returns to the group screen
41. `/group/<groupId>` -> `/group/<groupId>/exercises/new`, `/group/<groupId>/exercises/<exerciseId>/edit` (M25-T08)
   - owner/admin `Add exercise` and the exercise sheet's `Rename` (`router.push`); both return with `router.back()` after saving, and the Exercises segment refreshes on focus
42. `/groups` -> `/group/<groupId>/leaderboards/<exerciseId>` (M25-T09)
   - a podium card on the Groups screen's Leaderboards segment (`router.push`, no query: e1RM · Certified)
43. `/group/<groupId>/leaderboards/<exerciseId>` -> `/group/<groupId>/leaderboards/<exerciseId>/history?metric=&scope=` (M25-T09)
   - the header `History` button with the current toggles; Back returns to the board, which reloads its first page on focus
44. `/groups`, `/group/<groupId>/leaderboards/<exerciseId>` -> `/group-session/<memberId>/<sessionId>` (M25-T10)
   - the row detail sheet's `View full session` (the sheet closes, then `router.push`); the sheet itself is in-route state opened from a record card or a full-board row
45. `/today` -> `/groups?groupId=<groupId>`
   - a Group activity record card or membership row

Note:

- Modal opens/closes are in-route UI state transitions, not route transitions.
- `session-recorder` exercise picker `Add new` now opens an in-route exercise editor modal rather than navigating to `/exercise-catalog`.
- The recorder's group pick sheet (M25-T07) and its `Add as new` editor are in-route modals too: the picker hides while either is open and returns on cancel.
- The record set row detail sheet (M25-T10) is an in-route modal on the Groups screen's Stream and the full board; certification writes and their confirmation `Alert`s stay on the same route.

## Header titles (current, high level)

- Routes inside the `(tabs)` group run with `headerShown: false`; per-screen
  titles in `apps/mobile/app/(tabs)/_layout.tsx` are declared for completeness.
  The visible shell is `BottomTray` composing `MainTabs`; it is suppressed on
  `/session-recorder`. `exercise-history` keeps its native stack header and
  renders `MainTabs` with Progress selected.
- Detail screens registered in the root stack (`exercise-history`, `sessions`, `profile`, `connected-agents`, `maestro-harness`, `completed-session/[sessionId]`) keep their native stack header behavior; titles are declared in `apps/mobile/app/_layout.tsx`. The root stack's `screenOptions` give every detail screen an arrow-only back affordance (`headerBackButtonDisplayMode: 'minimal'`, no custom `headerBackTitle`, which react-native-screens would render as a custom item that ignores the display mode and morphs its label in during the push); the system chevron reads "Back" to VoiceOver.
- `completed-session/[sessionId]` sets its title inside the route file (`View Session`, `Session complete`, or `Session summary`)
- `exercise-history` sets its title inside the route file to the resolved exercise name (falls back to `Exercise History` when the summary is not yet available)
- M22 group routes declare `My groups`, `New group`, `Join group`, `Group`, `Edit group`, `Invite`, and `Session` in `apps/mobile/app/_layout.tsx`; the group screen replaces `Group` with the group's name once loaded
- `exercise-link` (M25-T07) declares `Link exercise` in `apps/mobile/app/_layout.tsx` and replaces it with `Link "<exercise name>"` once the exercise resolves
- M25-T08 adds `Members`, `Add exercise`, and `Edit exercise` for the group routes in `apps/mobile/app/_layout.tsx`

## Documentation boundary

- Keep this doc concise and contract-oriented.
- Do not duplicate every navigation call site or all route edge cases from source.
- If a task changes route paths, params, redirects, or screen-to-screen transitions, update this doc in the same session.
