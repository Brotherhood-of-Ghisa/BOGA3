# Navigation contract

Load when you are adding or changing a route, a route param, a redirect, a route
guard, or a screen-to-screen transition — and update it in the same session when
you do. What lives here is what the code can violate and still compile.

Routes themselves are the Expo Router file tree under `apps/mobile/app/`
(`/group/[groupId]/edit` is `app/group/[groupId]/edit.tsx`), and a screen's
params are its own `useLocalSearchParams` typing. There is no route inventory
here: if you need which routes exist, what each is for, or which file backs it,
load `docs/specs/ui/screen-map.md` instead.

## Router baseline

- `expo-router`, file-based. Root layout `apps/mobile/app/_layout.tsx`; the root
  stack and every root screen declaration
  `apps/mobile/components/navigation/root-stack.tsx`.
- Navigation is string-path based; there is no typed route layer. The few
  constants and href builders live in `apps/mobile/src/navigation/routes.ts`
  (`SIGN_IN_ROUTE`, `GYMS_ROUTE`, `BODY_WEIGHT_ROUTE`, `THEME_COLOUR_ROUTE`,
  `exerciseLinkHref`) and `apps/mobile/src/navigation/active-session-entry.ts`
  (`sessionViewHref`, `sessionExerciseHref`, `sessionAddExerciseHref`,
  `sessionCompareHref`). Build a parameterised href with its builder rather than
  by interpolation: the builders `encodeURIComponent` their ids.
- Tab roots live in the `(tabs)` group (`apps/mobile/app/(tabs)/`), whose
  parenthesised name never appears in a URL (`/stats-history` is
  `app/(tabs)/stats-history.tsx`). Every other screen is a root-stack route.
- The shell is the four-tab model in `apps/mobile/src/navigation/main-tabs.ts`
  — Today / Train / Progress / More — rendered by `MainTabBar`
  (`apps/mobile/components/navigation/main-tab-bar.tsx`), the same bar on every
  screen that shows tabs. Only those four are visible destinations; the
  preserved roots `/stats-history`, `/exercise-catalog`, `/groups` and
  `/settings` stay directly addressable and each maps to a canonical owner
  (`resolveMainTab`), so every recognised root keeps exactly one tab selected.
  An unrecognised route selects none rather than a misleading default.
  `apps/mobile/app/(tabs)/_layout.tsx` therefore registers eight `Tabs.Screen`
  entries: the four visible destinations and those four preserved roots. A tab
  root added there must appear in `main-tabs.ts` as a destination or as a
  preserved root with an owner, or it renders with no tab selected.
- Train is the only tab whose destination is computed: with a workout in
  progress it opens that session directly (`mainTabDestination`,
  `useOpenMainTab`), and a failed lookup opens `/train` rather than assuming
  there is no workout. Train is also the only way into an active workout —
  nothing on Today opens `/session/<id>`.
- Sync cadence is route-independent: the scheduler
  (`apps/mobile/src/sync/scheduler.ts`) never reads the active route, and a
  screen's writes reach it only through the shared post-commit nudge
  (`apps/mobile/src/sync/write-nudge.ts`).

### Root route access

The navigator enforces access; no screen redirects to gate itself. The root
stack declares every root route under exactly one `Stack.Protected` group per
access level, and `useRootRouteAccess`
(`apps/mobile/src/navigation/root-route-access.ts`) enables one level at a time:

| Level | When | What exists |
| --- | --- | --- |
| `sign-in` | auth is configured and there is no session, or a sync cycle reported "no signed-in user" | only `/sign-in`, so a configured-but-signed-out launch never reaches a data screen |
| `sync-setup` | a signed-in user whose first sync has not drained (`sync_runtime_state.bootstrap_completed_at` is null) | only the first-sync block `/sync-setup` |
| `app` | everything else, including an unconfigured build (no working credential path, so no session or first sync can ever exist) | the rest; `/sign-in` stays reachable so a direct open can explain the disabled credential path |

- Anything short of a set bootstrap flag keeps the `sync-setup` block, so an
  unexpected gate state fails closed instead of opening data routes. The block's
  only ways out are the two transitions below; a retryable cycle error offers a
  single Retry that fires exactly one cycle, and `UPDATE_REQUIRED` explains the
  required app update with no Retry at all.
- When the level changes, the old level's routes leave the stack and the router
  lands on the first route still declared: `/sign-in`, `/sync-setup`, or `index`
  (which redirects to `/today`). A deep link to another level's route lands the
  same way. Group order in the root stack therefore matters.
- **Never unmount or swap out the navigator to gate access.** On expo-router 57
  unmounting it reverts the route, so a gate that renders a `<Redirect>` or a
  block in its place loops ("Maximum update depth exceeded"). The sole exception
  is the restore guard's neutral loading view
  (`apps/mobile/components/navigation/auth-route-guard.tsx`), rendered only
  before the navigator first mounts — until session restore resolves and, for a
  signed-in user, the persisted first-sync flag has been read — so a cold launch
  and its deep link land on the right level the first time.
- Every root route file must be declared in the root stack: Expo Router appends
  an undeclared one outside every `Stack.Protected` group
  (`__tests__/root-stack-routes.test.ts` fails on one).
- `/maestro-harness` (dev/test, self-gated) is declared last and exists at every
  level except `sign-in`: it is what lifts the first-sync block in tests, and it
  must never be where the router lands.

## Param rules

- **A param is an opening selection, not state.** A screen applies it on entry
  and never rewrites the query (except a leaderboard board, which writes its
  metric/scope back because Expo may reuse the screen); period, tag, section,
  grouping, search and sort changes are in-route state. A link changing a
  mounted tab's param re-enters it; one repeating its value does not.
- **A missing, unknown, deleted or unauthorised target renders an in-route
  unavailable state.** No route crashes on a bad param and none redirects away:
  an out-of-reach `groupId` shows the lost-access state, a dead session or group
  exercise "no longer available", a bad `exerciseDefinitionId` an error state.
- **Params carry ids and small enum values, nothing else.** Never a token,
  session, credential, serialized object, or private reading context, nor OAuth
  state, a callback or a user identifier on the one external transition (the
  first-party `/connect` page); a record sheet never routes private context
  out. Pass an id and let the destination read it.
- Dev/test-only params exist (`completed-session`'s `maestroShare`,
  `maestroCatalog`, `maestroInsights`) and are each gated by `isDevMode()`.

| Route | Param | Rule |
| --- | --- | --- |
| `/progress`, `/stats-history` | `period=7` | This week; absent or any other value uses the configured window |
| | `breakdown=exercise` | opens exercise browsing; anything else opens muscles |
| `/progress-history` | `exerciseDefinitionId` \| `muscleGroupId` | exactly one, required; both, neither or a blank id renders the unavailable state, as does an id the exercise catalogue no longer holds. The page reads the subject's name from that cache — never from a param |
| `/sessions` | `week`, `day` | where the list opens ([[session.history-open]]); malformed: the top |
| `/exercise-history` | `exerciseDefinitionId` | required |
| | `period` | `7` / `30` / `all`; absent or invalid is `30` |
| | `tagDefinitionId`, `gymId`, `currentGymId` | pre-applied filters; `currentGymId` applies only under the current-gym past-records preference |
| `/completed-session/[sessionId]` | `intent=edit` | replaces to `/session/<sessionId>` |
| | `presentation=completion` | the post-submit summary; `summary`, absent and invalid all open View Session with Summary active |
| `/exercise-catalog` | `source=session` | a save returns by `router.back()` |
| | `intent` | `add` auto-opens the create editor once on first load; the session picker passes `manage` |
| `/settings`, `/gyms`, `/exercise-catalog` | `source=more` | adds `Back to More` (below) |
| `/groups` | `groupId` | selects that group when it is in My groups, else the one last shown this app session, else the first by name |
| `/group/join` | `code` | prefills the code field and runs the preview once the username gate is satisfied |
| `/group-session/[memberId]/[sessionId]` | `groupId` | required authorised scope, read through the group-scoped safe reader/cache; missing renders generic session unavailable |
| `/session-plan/new` | `edit` | edits that plan: prefill, then the guarded per-operation sync; back returns to the plan detail |
| | `from` | prefills a duplicate; Save creates a new plan, never an in-place copy |
| `/session-plan/[planId]` | `planId` | required; missing, unknown or deleted renders the in-route unavailable state |
| `/group/[groupId]/leaderboards/[exerciseId]`, `…/history` | `metric=volume\|e1rm`, `scope=certified\|all` | absent or invalid metric uses the comparison's current default, absent or invalid scope `certified` |

`source=more` is a navigation marker, not screen state:
`apps/mobile/components/navigation/more-hub-back-button.tsx` renders the
`Back to More` arrow only when it is present, returning by `router.replace` for
a destination inside the tabs and `router.dismissTo` for one pushed over them on
the root stack (`/gyms`). Every such route stays valid, and looks the same,
without the marker. The More rows that carry it are declared in
`apps/mobile/src/navigation/more-destinations.ts`.

## Allowed transitions

Nothing outside this table navigates. A route not listed as a source
(`/exercise-link`, `/gyms`, `/theme-colour`, `/body-weight`,
`/connected-agents`, `/profile`) never navigates on its own.

| From | To | Trigger, method |
| --- | --- | --- |
| `/` | `/today` | root `<Redirect />` |
| any app route | `/sign-in` | a configured launch with no session, a sign-out, or a cycle reporting "no signed-in user": access flips to `sign-in` |
| `/sign-in` | `/sync-setup`, else `index` → `/today` | a successful sign-in removes the route |
| `/sync-setup` | `index` → `/today` | the first sync drains. Neither gate screen ever navigates itself: the stack drops it and the router lands |
| `/sync-setup` | `/sign-in` | the latest cycle outcome is `AUTH_REQUIRED` (no Retry offered) |
| `/today` ↔ `/train` ↔ `/progress` ↔ `/more` | | `MainTabBar` |
| any tab strip | `/session/<sessionId>` | the Train tab with a workout in progress: `push` from the tab bar and `exercise-history`, `dismissTo` from a completed session view, and nothing on that session's own view |
| `/train`, `/sessions`, `/completed-session/<id>` | `/session/<sessionId>` | every active-session entry, through `sessionViewHref` (`push`): Train's launch and Sessions' review/complete. Train rechecks for an existing draft first and `apps/mobile/src/session-entry/coordinator.ts` serialises simultaneous requests, so two drafts cannot appear |
| `/session/<id>` | `/completed-session/<id>?presentation=completion` | Finish, after its cleanup prompts and the completion write (`replace`) |
| `/session/<id>` | `/train` or another tab | Abandon after its confirmation, or the bottom bar (`dismissTo`, so the tab below is reused rather than stacked) |
| `/session/<id>` (completed edit) | the previous screen | `Done`: `back()`, else `replace('/completed-session/<id>')`; completion is never replayed |
| `/session/<id>` | `/session/<id>/exercise/<sessionExerciseId>` | an exercise card (`push`); Back, `Complete exercise` and `Remove from session` return `back()`, or `replace('/train')` with no history |
| `/session/<id>` | `/session/<id>/add-exercise` | `+ Add exercise` (`push`, a modal page sheet); Close, swipe-down and a successful add return `back()`, a failed add stays |
| `/session/<id>/add-exercise` | `/exercise-catalog?source=session&intent=manage` | the picker's Manage (`push`, a second sheet over it); the catalogue's post-save `back()` returns the picker as left |
| `/session/<id>` | `/session/<id>/compare`, `/gyms` | the ⋮ sheet's `Session vs history` and the gym sheet's `Manage gyms` (sheet closes, then `push`) |
| `/session/<id>/exercise/<id>` | `/exercise-history?exerciseDefinitionId=<id>` | the records panel's `History` (`push`) |
| `/session/<id>/exercise/<id>`, `/exercise-catalog` | `/exercise-link?exerciseDefinitionId=<id>` | ⋮ `Link to group exercise…` (sheet closes, then `push`); signed in only, and not for a deleted exercise. The open session is untouched |
| `/progress`, `/stats-history` | `/exercise-history?exerciseDefinitionId=<id>` | the exercise page's History, not Progress's own names |
| `/progress`, `/stats-history` | `/progress-history?muscleGroupId=<id>`, `?exerciseDefinitionId=<id>` | a muscle or exercise name, and a contribution row's exercise (`progressHistoryHref`, `push`). Native back returns to Progress with its breakdown, period, search, sort and scroll as left, restoring reader focus once, to the launching row |
| `/progress`, `/stats-history` | `/sessions` | the Sessions link row |
| `/progress-history` | `/completed-session/<id>`, `/sessions?day=`, `?week=` | a training day or week (`historyDayHref`, `sessionsWeekHref`, `push`) |
| `/sessions` | `/completed-session/<id>`, `/session/<id>` | a completed row (`push`), and the active row's resume (`sessionViewHref`). `/sessions` never completes an active session directly |
| `/sessions` | `/session-plan/new`, `/session-plan/<planId>` | the `Plan session` action, and a plan row (`push`). A create/duplicate save `replace`s to the new plan's detail; an edit save returns `back()` |
| `/session-plan/<id>` | `/session/<sessionId>` | **Start all** and **Add to session** route into the recorder through `sessionViewHref` (`push`) — conflict offers Resume, the ambiguous card choice is a sheet, not a route |
| `/session-plan/new` | `/session-plan/new?edit=`, `?from=` | the detail's `Edit` (pencil) and duplicate actions (`push`) |
| `/today` | `/progress`, `/sessions`, `/completed-session/<id>`, `/train` | the Progress card's `View progress`, `All sessions`, latest-session row, and the empty panel's `Open Train` (`push`) |
| `/exercise-history` | `/completed-session/<id>` | a session card or an all-time-best row |
| `/completed-session/<id>` | `/session/<id>` | `Edit` in either section (`push`); a deleted session offers no `Edit`, because the session view edits only a live session |
| `/completed-session/<id>?presentation=completion` | `/progress` | Done, Android system back, or an unavailable target (`replace`) |
| `/completed-session/<id>` | its originating screen | Back pops once, else `replace('/progress')` with no history. `Summary` / `Sets` switch locally, legacy `presentation=summary` links included |
| `/more` | `/groups`, `/connected-agents`, `/dev-logs`, `/gyms?source=more`, `/exercise-catalog?source=more`, `/settings?source=more` | hub rows; connected agents requires a current user and developer logs `isDevMode()` |
| `/more`, `/settings` | the first-party `/connect` page, system browser | `Connect an AI coach`; launch failure stays inline. OAuth begins later, in the user's own MCP client |
| `/settings` | `/profile`, `/connected-agents`, `/body-weight`, `/theme-colour` | destination rows (`push`); Connected agents is absent while signed out, and `Body weight log` is always shown, independent of the `Bodyweight calculations` preference. No workout route reaches bodyweight entry or history |
| `/profile`, `/connected-agents` | themselves | sign-in/sign-out rerender, and grant load / retry / confirmed revocation, update the route in place |
| `/connected-agents` | `/sign-in` | its auth guard on a signed-out direct entry |
| `/groups`, `/exercise-link` (signed out, auth configured) | `/sign-in` | the sign-in-required card's `Sign in` |
| `/groups` | `/group/mine` | the `My groups` header action — the only route to group management; nothing else on `/groups` opens the group page |
| `/group/mine` | `/group/<groupId>` | a row tap — the only way to the group page (stream membership items do not navigate) |
| `/groups`, `/group/mine` | `/group/new`, `/group/join` | `Join group` / `Create group` and the empty-state actions (`push`) |
| `/group/new`, `/group/join` | `/group/<groupId>` | after create, join, or `Open group` when already a member (`replace`, so Back returns to where the flow started) |
| `/group/<groupId>` | `/group/<groupId>/invite`, `/edit`, `/members`, `/exercises/new`, `/exercises/<exerciseId>/edit` | role-gated `Invite` / `Edit` header actions, the header's member-count line, and owner/admin `Add exercise` / the exercise sheet's `Rename` (`push`); each returns `back()` after saving |
| `/group/<groupId>/members` | `/groups` | after a successful leave (`dismissTo('/groups')`); the tab's focus refresh drops the group from the chips |
| `/groups` | `/group/<groupId>/leaderboards/<exerciseId>` | a podium card on the Leaderboards segment (`push`, no query) |
| `…/leaderboards/<exerciseId>` | `…/history?metric=&scope=` | the header `History`, passing the current toggles and rules revision |
| `/groups`, `/today`, a board | `/group-session/<memberId>/<sessionId>?groupId=<groupId>` | a stream session card, Today's one-member training-now row or latest completed session, or the row detail sheet's `View full session` (`push`). Every full-session exit carries `groupId` |
| `/today` | `/groups?groupId=<groupId>`, `/group/mine` | `View groups`, the week board and the `<n> training now` row, carrying Today's selected group; `Find a group` when there is none. Picking a chip changes the selection Today shares with `/groups`; it does not navigate |
| `boga3://group/join?code=XXXXXXXX` | `/group/join?code=…` | the invite share link. The static `group/join` segment wins over `group/[groupId]` (`__tests__/groups-join-deep-link.test.tsx`), and a new link while the screen is open remounts it with the new code. **Known limitation:** opening the link while signed out goes through `/sign-in` and lands on `/`, dropping the code (there is no return-to); reopening the link works |

Progress’s frozen controls change content in-route;
Sessions is the final scrolling link in both views. A muscle chevron toggles
its contribution block directly below that row. `/progress-history` is a
route, not a sheet.

Not route transitions, and must not become them: every modal, sheet and `Alert`
is in-route state. That includes the picker's `Add new` editor, group-pick sheet
and `Add as new` editor, the exercise page's effort / options / swap sheets and
its shared exercise editor, the Sessions row and active-session menus, and the
record set row detail sheet on the Stream and the full board. A back *gesture* is disabled rather than handled where leaving
would be wrong: the session view of a workout in progress and the completion
summary both set `gestureEnabled: false`, so they are left only by the actions
above.

## Header titles

Title strings live in `apps/mobile/components/navigation/root-stack.tsx`, and in
`apps/mobile/app/(tabs)/_layout.tsx` for the tab group. The conventions:

- A static title is declared in the root stack. A title that depends on loaded
  data is set in the route file's own `Stack.Screen`, replacing the declared
  placeholder once it resolves and falling back to it until then: the group
  screen's name for `Group`, a board's group exercise, `exercise-history`'s
  exercise name, `exercise-link`'s `Link "<name>"`.
- `headerShown: false` for every `(tabs)` route (the visible shell is
  `MainTabBar`) and for every screen that draws its own design-language top bar
  or needs no header at all (`session/[sessionId]/index`, the exercise page, the
  picker, `completed-session/[sessionId]`, `sign-in`, `sync-setup`). A headerless
  screen still declares a title: it is the back label VoiceOver reads on the
  screens it pushes. `exercise-history` is the one hybrid — a native header
  *and* `MainTabBar` with Progress selected.
- Every native header takes one style from the root stack's `screenOptions`: a
  `surface` background, an Archivo 700 `ink` title at `xl`, an `ink` back arrow,
  and `headerBackButtonDisplayMode: 'minimal'` for an arrow-only back.
  **Never add a `headerBackTitle`** — react-native-screens then builds a custom
  back item that ignores the display mode and morphs its label in during the
  push. The hidden label is the previous route's title, which is why the
  headerless `(tabs)` group is titled `Back` rather than `(tabs)`.
- The chevron's hidden label depends on the iOS runtime ("Back" on iOS 27, the
  previous route's title on iOS 26), so Maestro flows tap it by UIKit's
  `BackButton` id, never by label.
- Two screens replace the native back item with the shared `IconButton` arrow
  (`exercise-history`, `body-weight`) because the native item stops dispatching
  on iOS 26.4 when the screen is reached repeatedly from an active session. Both
  pop the stack, or `replace` with their owner (`/progress`, `/settings`) when
  nothing is below them; the native title, header and 44pt target stay.
