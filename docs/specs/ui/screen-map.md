# Screen Map (Authoritative Current UI)

## Purpose

Brief entrypoint map of the current mobile screens.

- This doc answers: "what screens exist and what is each screen for?"
- Use `docs/specs/ui/navigation-contract.md` for path/param/transition rules.
- Use source files for detailed UI structure and render logic.

## Sources

- `docs/specs/ui/navigation-contract.md`
- Route files under `apps/mobile/app/**`

## User-facing route map (current)

1. `/` (alias)
- File: `apps/mobile/app/index.tsx`
- Purpose:
  - default app entry route that redirects to `/today`
- Notes:
  - no unique UI; renders an `expo-router` `Redirect` to the Today tab

1b. `/today` (canonical tab)
- File: `apps/mobile/app/(tabs)/today.tsx`
- Purpose:
  - concise orientation surface for current personal training, joined-group
    activity, and recent completed sessions
- Key states (high level):
  - an active draft takes priority and exposes one resume action; without one,
    the planning slot renders ready/loading/empty/error/unavailable states
  - group activity is bounded to the three newest session, record, or
    membership items visible to the user's joined groups (certified or not);
    record cards are read-only here (no `Certify`) and open the Groups screen
    on their group, as membership rows do; link and record-removed items stay
    in the full Groups feed. Today preserves auth-unavailable, signed-out,
    cached/offline, missing-data, empty, and inline-error behavior
  - recent activity is bounded to the three newest non-deleted completed
    sessions and preserves repository loading/error/empty behavior
  - until the separate planning milestone supplies its read/materialization
    interface, the planning slot uses the approved `Watch this space 👀`
    placeholder and links to Train without inventing plan data
- Key exits:
  - `/session-recorder` (or `/session/<id>` with the new-screens setting
    on), `/train`, `/groups`, `/group/[groupId]`,
    `/group-session/[memberId]/[sessionId]`,
    `/completed-session/[sessionId]`, `/progress`, and `/sign-in`

1c. `/train` (canonical tab)
- File: `apps/mobile/app/(tabs)/train.tsx`
- Purpose:
  - single entry surface for starting or resuming personal training and, once
    its separate dependency ships, managing personal planning
- Key states (high level):
  - active-session loading and retryable load error; start actions remain
    absent until the app knows that no active draft exists
  - active draft with one Resume action and no competing empty/planned action
  - no active draft with empty-workout start plus retryable inline persistence
    failure
  - planning loading/error/empty/ready/unavailable states; production uses the
    approved `Watch this space 👀` placeholder until M23 supplies a plan
    read/materialization and management interface
- Key exits:
  - `/session-recorder` after guarded empty/planned launch or active resume
    (`/session/<id>` instead with the new-screens setting on);
    a future planner exit is supplied by the planning integration rather than
    guessed here

1d. `/progress` (canonical tab)
- File: `apps/mobile/app/(tabs)/progress.tsx`
- Purpose:
  - canonical entry to the current Stats / History dashboard without
    adding or changing any analytics
- Key states (high level):
  - exactly the existing `/stats-history` loading, error, empty, dashboard,
    exercise/muscle breakdown, and daily/weekly heat-map states
- Key exits:
  - existing Sessions drill-down and in-route exercise/muscle history overlays
  - `/stats-history` remains available as the preserved legacy path and selects
    Progress in the shared navigation

1e. `/more` (canonical tab)
- File: `apps/mobile/app/(tabs)/more.tsx`
- Purpose:
  - scalable home for secondary capabilities that should not expand the
    persistent tab bar
- Key states (high level):
  - Community links to existing group discovery and administration
  - Tools links to MCP setup and connected-agent management; connected agents
    is omitted without a user, developer logs is omitted outside `isDevMode`,
    and an external-browser failure is shown inline without disabling the hub
  - Library & account links to existing exercise-database management and
    Settings/account
- Key exits:
  - `/groups`, `/connected-agents`, `/dev-logs`, `/exercise-catalog`, and
    `/settings`, plus the first-party external MCP setup page

2. `/sign-in`
- File: `apps/mobile/app/sign-in.tsx`
- Purpose:
  - dedicated sign-in entry point enforcing login-on-start; the route-layer auth guard redirects an unauthenticated user here before any data screen renders
- Key states (high level):
  - configured signed-out email/password form with inline auth error feedback (reuses the `/profile` signed-out credential pattern)
  - auth-unconfigured disabled-reason message instead of a form
  - already-signed-in redirect to `/`
- Key exits:
  - app proceeds to the normal route once a session exists (guard stops redirecting); no explicit navigation on success

2b. First-sync block (route-layer render state, not a route)
- File: `apps/mobile/src/sync/SyncGate.tsx`
- Purpose:
  - the device-recovery waiting room a signed-in user sees while the first sync cycle drains; renders a full-screen "Setting up your data…" block in place of the navigator until `sync_runtime_state.bootstrap_completed_at` is set, so no data screen is reachable before the user's data is restored
- Key states (high level):
  - in-progress: a phase label plus an advancing activity/progress indicator ("layer K of N", "N items") that visibly moves while work happens
  - offline: an offline message instead of an indefinite spinner when the device is network-unreachable
  - error: a single error message and a single Retry button (fires exactly one cycle) on a non-`AUTH_REQUIRED` cycle error
- Key exits:
  - dismisses in place once `bootstrap_completed_at` is set, and the normal route renders
  - redirects to `/sign-in` (no Retry) when the latest cycle outcome is `AUTH_REQUIRED`
- Notes:
  - stands aside (renders through) for a signed-out or auth-unconfigured app, so it never traps a build with no session; the `/sign-in` route is exempt so the redirect cannot loop; display-only surfaces (phase, activity, offline) carry no extra primary action — Retry is the single action

3. `/stats-history`
- File: `apps/mobile/app/(tabs)/stats-history.tsx`
- Purpose:
  - preserved Progress-owned path whose merged Stats / History surface switches
    between per-exercise and per-muscle summaries while preserving the Sessions
    drill-down and in-route history overlays
- Query params:
  - `period` (optional; `7` or `30`; absent/invalid values default to `7`)
  - `breakdown` (optional; `exercise` or `muscle`; absent/invalid values default to `exercise`)
- Key states (high level):
  - Stats summary loading/error/content states with separate labelled control
    rows: `Time range` keeps the 7-/30-day pills, and `Breakdown` keeps both
    joined `By Exercise` / `By Muscle` choices visible with one selected
  - valid query values set the initial controls, including the completion
    handoff at `?period=7&breakdown=muscle`; later control changes remain
    in-route state and do not rewrite the query string
  - top summary cards show `Sessions` and `Sets (W/Sets)` as absolute counts; their previous-period deltas never include percentages
  - per-exercise history is a viewport-fitting table with compact, single-line
    `Exercise`, `Sets`, `Vol`, and `1RM` headers; rows show aligned values, keep
    the working-set count in parentheses, use `—` for unavailable 1RM, allow
    exercise names to wrap without truncation, retain complete accessibility
    wording, and open an in-route exercise-history overlay as one whole-row
    action. Only exercises with at least one valid performed set in the selected
    7-/30-day window appear.
  - Exercise, Sets, and Vol are the only sort controls: default Sets high-to-low;
    Exercise cycles most/least recently completed across all-time valid history;
    Sets cycles all sets high/low then working sets high/low; and Vol cycles
    high/low. The 1RM header is static. Missing recency stays last, and ties use
    name then ID. Each sortable header reserves its inline indicator width so
    labels do not move when selection changes; the active slot alone is visible
    (`Recent` plus arrow for Exercise, arrow only for Sets/Vol). Accessibility
    wording retains the complete sort mode and next action. Mounted sort choice
    survives time-range, search, and Breakdown changes.
  - per-muscle family and nested rows show the same set/near-failure count grammar plus per-side, role-weighted `Volume`; set comparisons are signed absolute pairs while volume comparisons are percentage-only with explicit zero-baseline states
  - per-muscle family rows use uniform green failure-intensity backgrounds and visible nested-muscle rows use uniform warm backgrounds, selecting one shade per row and scaling to eight near-failure sets per seven days; exact counts remain readable/accessibly labelled and the threshold is not a training target
  - actionable muscle rows in Stats summary; expanded muscle rows and collapsed single-muscle family headers open an in-route muscle-history overlay
  - muscle-history overlay states for loading, error, no-history, populated heatmap with selectable `Volume` / `W/sets` metrics, selected positive-effort date with contributing exercise/set detail, and selected zero-effort date empty detail; daily and weekly charts stay warm-mounted so switching is immediate and preserves chart-local state
  - **By Exercise mode** (M17): the view-mode chip switches the body to the sortable exercise table; tapping an exercise data row opens an in-route `ExerciseHistoryOverlay`
  - exercise-history overlay states: loading, error, no-history, populated daily/weekly heatmaps (365-day window), metric chip selection (Volume / W/sets / 1RM / Top weight), week-selection banner
- Notes:
  - preserved tab-group route with `headerShown: false`; its exact existing UI
    is also exposed canonically at `/progress`. `BottomTray` composes
    `MainTabs`, maps this route to Progress, and is supplied via the `tabBar`
    prop in `(tabs)/_layout.tsx`.

4. `/session-recorder`
- File: `apps/mobile/app/(tabs)/session-recorder.tsx`
- Purpose:
  - active session recorder and completed-session editor (query-driven mode)
- Key states (high level):
  - active mode
  - completed-edit loading/error/content states
  - in-route picker/editor/action modals (exercise picker uses the shared exercise-list model: text filtering by exercise name + primary muscle display/family terms, local shared list options for grouping/date range/recents, initially collapsed muscle-family groups that preserve collapsed/expanded state while searching, matching catalog row stats, and compact header icon actions for options/manage/add; adding a new recorder exercise opens an in-place preselection panel with `Add empty set` and a disabled-or-enabled completed-history `Append plan`, while replacing an existing exercise remains direct)
  - in-route gym picker includes `No gym` as the null session-gym option; gym Manage focuses on edit/archive/unarchive plus archived visibility
  - in-route single gym editor owns private coordinate controls (`Save current location`, confirmation-gated replace, and confirmation-gated clear)
  - in-route exercise-tag add/manage modals (search/select/create, rename/delete/undelete, deleted-visibility toggle)
  - per-exercise collapsed-by-default `Past Records` bar below tags and above set rows; tapping expands inline loading/empty/error states plus metric label / selected record date / live `Current` / green `Max` rows for estimated `1RM`, volume, highest weight, and working-set count; left/right swipes anywhere on the expanded panel change the selected historical record, and max values derive from loaded records plus valid current metrics
  - exercise cards start expanded and their title region toggles a volatile collapsed summary showing valid performed-set and working-set counts (`RIR 0`/`RIR 1`/`RIR 2`); when the shared current-session insight helper finds a strict Wathan-estimate improvement over loaded completed history, the owning exercise alone shows a non-interactive success-surface `New PR` treatment with its best set and rounded estimated 1RM in both states; qualifying-set reversal removes the treatment immediately, and collapse closes in-card editing while replacement and appended-plan reveal expand the target card
  - active mode reveals a session-scoped `Session muscle load` row above recorder-wide actions only after valid confirmed work exists; it reports physical performed/working-set counts and leading mapped muscles, and opens an in-route detail sheet with exact weighted volumes and session-relative bars; unmapped work and retryable catalog failure are explicit, while reversal removes the row/sheet immediately and completed-edit mode remains unchanged
  - compact tap-to-edit set rows for normal and planned execution rows, each with an independently tappable left confirmation checkbox: a hollow circle is unperformed and a success-green tick is valid confirmed actual work; new/copy rows remain hollow even with valid copied values, and tapping a tick again retains values while removing the set from performed metrics; each exercise card identifies weight entry as `Total load` or `Per side`, while editable fields keep a compact `kg` suffix and make the full weight shell a focus target; adding a copied row focuses its weight and selects the full copied value; appended historical/program targets use a semantic soft blue-grey planned-row background/border while inactive, and selected appended/manual rows share one light-blue background and blue border, with no separate last-added tint, `Plan` badge, `Skip`, `Log`, or planned-row swipe action; tapping a planned body hydrates unconfirmed actual fields from the plan, and only removable user-added rows swipe to delete
  - active/completed-edit autosave preserves unconfirmed rows and values, while submit/save includes confirmed actual rows only; valid entered unconfirmed rows trigger a dedicated discard confirmation instead of being promoted or silently removed
  - appending a historical plan automatically expands and scrolls to the target exercise card once without giving it distinct selected styling; later card layouts from editing, row expansion/collapse, or keyboard changes do not move the recorder viewport
  - foreground GPS gym assistance is hidden on the recorder surface: brand-new active-session start may preselect one confident saved-gym match, null state displays as `No gym`, and long-pressing the gym box explicitly retries detection without a persistent suggestion panel
  - group exercises in the picker (M25-T07, signed in only): the default list is unchanged; with search text a `From your groups` section follows my own matches, and a `Groups` toggle beside the filter narrows the list to group exercises (all of them, by group, when the search is empty). Rows read `linked: <my exercise>` or `not linked` (from local links, so offline too; names from `group_cache`). A linked row adds my exercise; an unlinked row opens the in-route pick sheet (suggestion · `Choose another of your exercises…` · `Add "<name>" as a new exercise`, then `Link and add`); `Add as new` opens the exercise editor prefilled from the group exercise and saves the exercise and its link in one local transaction
  - the exercise card `•••` menu adds `Link to group exercise…` (signed in)
- Key exits:
  - `exercise-catalog` (`source=session-recorder&intent=manage` from exercise picker)
  - active submit replaces to
    `/completed-session/<sessionId>?presentation=completion` only after local
    persistence and completion succeed
  - completed-edit save replaces directly to `/progress` and does not
    replay completion
  - active mode rehydrates a newly persisted draft whenever the mounted route
    regains focus, unless in-memory recorder mutations must be preserved
  - the persistent four-tab navigation stays mounted but defaults to its
    collapsed peek handle in active and completed-edit recorder modes
  - `/exercise-link?exerciseDefinitionId=<id>` (`•••` `Link to group exercise…`)

4b. `/session/[sessionId]` (session view; new-screens setting only)
- File: `apps/mobile/app/session/[sessionId]/index.tsx` (components in
  `apps/mobile/components/session-view/`)
- Purpose:
  - the active session, read-only and navigational (exercise/session redesign
    step 5; accepted target `design-targets/exercise-session-v5.md`,
    `V6-Session`). Reached only while Settings' `New exercise & session
    screens` is On; Off keeps every entry on `/session-recorder`
- Key states (high level):
  - own top bar: `Session` · ⋮ · `Finish` (the one `accent` primary); the
    persistent four-tab bar sits at the bottom with Train selected
  - summary card: Time (elapsed, ticking) / Gym / Sets (confirmed performed) /
    Volume (their entered-load volume, warm-ups included)
  - one read-only card per exercise, the whole card one link: name, `n/m` done
    count (confirmed of all rows), every row as `type · weight × reps · 1RM ·
    VOL` with mini legends, done rows in ink and planned/unconfirmed rows faded
    (planned rows show their prescription), the best weight / 1RM / volume of
    the exercise today in bold per column, and a brass `record` band with the
    1RM when a done set beats the exercise's completed history
    (`deriveExercisePersonalRecord`, as the recorder's New PR)
  - `+ Add exercise` opens the recorder's exercise picker
    (`components/session-recorder/exercise-picker.tsx`) and writes the new
    exercise (one empty set) or appended plan straight to the draft
  - ⋮ opens the `Session` menu sheet with `Abandon session` (danger), which
    confirms before its soft delete
  - `Finish` runs the recorder's cleanup prompts (same copy, as alerts) and
    completion write; invalid set values block it with an alert naming the
    exercises
  - loading; `This session is no longer active.` with `Back to Train` when the
    id is not the active draft; retryable read error
- Key exits:
  - `/session/<sessionId>/exercise/<sessionExerciseId>` from a card
  - `/completed-session/<sessionId>?presentation=completion` after Finish
  - `/train` after Abandon, or any tab from the bottom bar (`dismissTo`)
  - `/exercise-catalog?source=session-recorder&intent=manage` from the
    picker's Manage; the picker returns on focus
- Notes:
  - reloads the draft on every focus, so the exercise page's edits show on return

5. `/exercise-catalog`
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Purpose:
  - exercise catalog management (create/edit/soft-delete/undelete exercises, load-entry mode, and muscle mappings)
- Key states (high level):
  - loading / error / content
  - shared exercise-list content with local shared preferences for grouping/date range/recents, default grouped `90d` recents-on-top behavior, taxonomy-ordered collapsible muscle-family headers, text filtering across exercise names + primary muscle display/family terms that preserves collapsed/expanded group state, and per-row stats for the selected range
  - in-route editor/action/delete modals
  - catalog-only muscle, deleted visibility (`Show deleted` / `Hide deleted`), and never-done visibility filters via top-level options kebab menu
  - the row `⋮` Exercise Actions menu offers `Edit`, `Link to group exercise…` (M25-T07; signed in only, disabled for a deleted exercise), and `Delete` / `Undelete`
- Key exits:
  - `session-recorder` after save when opened from recorder-origin manage flow
  - `/exercise-link?exerciseDefinitionId=<id>` (`⋮` `Link to group exercise…`)
  - explicit `Back to More` when opened with `source=more`
  - the preserved route is owned by More in the shared `MainTabs` tray

6. `/settings`
- File: `apps/mobile/app/(tabs)/settings.tsx`
- Purpose:
  - account, AI-coaching setup, preferences, sync, and installed-release
    information in one scrollable support surface
- Key states (high level):
  - visible `Settings` heading, then Account, AI coaching, Preferences, Data &
    sync, About, and development-only Developer tools sections in that order
  - Account routes to `/profile`, showing the signed-in email when available or
    concise signed-out guidance otherwise
  - Preferences card: date format (`settings-date-format-<format>`), then the
    `New exercise & session screens` Off/On toggle (`settings-new-screens-off` /
    `-on`), default Off, device-local and shown on every build (not
    `isDevMode()`). It opts into the redesigned exercise page and session view;
    until those routes ship it changes nothing else.
  - AI coaching always offers an external `Connect an AI coach` setup link and
    states the read-only/revocable boundary; browser-launch failure stays inline
    and retryable. The separate Connected agents row is signed-in only.
  - a sync-status card (signed-in only) showing last successful sync time
    (`Never` until the first success), pending-change count (rows still waiting
    to push across the user-owned tables), network state (online/offline), and
    the latest sync error (or a sign-in-required hint); a Refresh action nudges a
    sync cycle. The card refreshes on screen focus and on a short interval while
    focused. Card/fields carry stable testIDs (`settings-sync-status-card`,
    `settings-sync-status-last-success`, `settings-sync-status-dirty-count`,
    `settings-sync-status-network`, `settings-sync-status-error`).
  - signed-out Data & sync guidance instead of usable sync controls
  - About shows installed native version/build where available, optional release
    codename, and Preview/Local flavor only outside production
  - a developer-tools card (`isDevMode()` only), last and separate from the
    sync-status card, with the local/remote wipe affordances
  - available from the Settings row under More regardless of auth state; the
    row adds `source=more` and an explicit `Back to More`; the direct
    `/settings` path remains valid without it
- Key exits:
  - `more` via the source-aware explicit return action
  - `profile`
  - `connected-agents` (signed in only)
  - the first-party public `/connect` page in the system browser
  - back to the previous route via stack navigation

7. `/connected-agents`
- File: `apps/mobile/app/connected-agents.tsx`
- Purpose:
  - signed-in OAuth grant review and revocation for external coaching agents
- Key states (high level):
  - loading and concise no-connections empty states
  - one card per active grant with client name, granted time, last-access time
    (`Never` when no audit event exists), and explicit read-only capability copy
  - inline load/revoke error with Retry; grant revocation remains usable if
    optional last-access metadata cannot be loaded
  - destructive confirmation before revocation and an in-flight disabled state
- Key exits:
  - back to `settings` (or previous route) via stack navigation

8. `/profile`
- File: `apps/mobile/app/profile.tsx`
- Purpose:
  - auth-aware account route for sign-in, signed-in username/email/password management, and M13 sync controls/status
- Key states (high level):
  - restoring/auth-bootstrap banner
  - auth-disabled warning when client config is missing
  - signed-out email/password form with inline auth error feedback
  - signed-in view mode with row-based account values (username/email plus optional pending-email row) and bottom actions (`Edit`, danger `Sign Out`)
  - signed-in edit mode with `username`/`new email`/`new password` fields and one `Update` action
  - signed-in sync section with enable/disable control, current sync status, last successful sync (`Never` when no success yet), optional pending-count and next-retry rows
  - sync retry/error handling remains inline (backend free-text message + retry/action-required hint)
  - lazy profile load/provision state for `username`
  - inline unified profile-update success/failure (including pending email-confirmation messaging)
  - sign-out failure feedback that stays on the same route
- Key exits:
  - in-place rerender between signed-out and signed-in states
  - back to `settings` (or previous route) via stack navigation

9. `/sessions`
- File: `apps/mobile/app/sessions.tsx`
- Purpose:
  - stack-based complete session list reached from the Stats Sessions card
- Key states (high level):
  - optional active-session row followed by completed-session history
  - one focus-aware automatic history load on first presentation and on each
    later focus reacquisition; filter and mutation refreshes remain explicit
  - deleted-session visibility toggle and completed-session row actions
  - active Resume and review/complete affordances both return to the existing
    recorder so draft state and recorder cleanup rules remain authoritative
- Key exits:
  - `/session-recorder` via stack dismissal for active Resume or review/complete
    (with the new-screens setting on, `/session/<id>` is pushed instead)
  - `/session-recorder?mode=completed-edit&sessionId=<sessionId>` from a
    completed row or its explicit Edit action
- Notes:
  - the native stack header centers `Sessions` and uses the platform back arrow
    without a text label, so the internal `(tabs)` group name is never exposed

10. `/completed-session/[sessionId]`
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Purpose:
  - completed session detail viewer with edit/delete session actions and per-exercise block append actions
- Key states (high level):
  - loading / error / not-found / detail
  - `presentation=completion` and `presentation=summary` reuse the same content:
    one labelled totals card with informational per-muscle working-set counts,
    all compact `Personal records`, per-exercise current volume versus median
    and descriptive P5/P95 range, and previewed PNG session sharing. Neither
    presentation links to muscle analytics. Optional historical enrichment
    cannot block either summary, and share output excludes gym/location.
    Edit/delete/append actions are hidden in both modes; only post-submit
    completion renders Done
  - completion loading/error/not-found/deleted-target states expose one safe
    Progress exit; the native back affordance/gesture is suppressed and Android
    system back replaces to Progress
  - read-only exercise cards include a set table with `Set`, `Weight`, `Reps`, and `Effort`
  - exercise-card titles toggle an expanded/collapsed state; collapsed cards show valid performed-set and working-set counts while keeping `Append` available
  - each exercise card header exposes `Append` to copy that one historical block as planned target rows into the active recorder
  - temporary redirect placeholder for `intent=edit`
- Key exits:
  - `session-recorder` (edit)
  - `session-recorder` after successful per-exercise block append (the
    session view with the new-screens setting on)
  - `/progress` from completion Done/back
  - `/sessions` or completed-edit mode from historical-summary header actions

11. `/exercise-history`
- File: `apps/mobile/app/exercise-history.tsx`
- Purpose:
  - per-exercise performance history view (progression signals + per-tag drill-down for a single `exercise_definitions` row)
- Key states (high level):
  - loading / error / detail
  - in-section empty state when no sessions match the active period/tag filter
  - period chips (`7 / 30 / all`) and horizontal tag-filter chip strip
  - dynamic stack title set inside the route file to the resolved exercise name (falls back to `Exercise History`)
- Key exits:
  - `/completed-session/<sessionId>` from session card tap or from the all-time-best card rows
  - Today / Train / Progress / More via the shared `MainTabs`; Progress is
    selected for this analytics detail context

12. `/groups` (M22)
- File: `apps/mobile/app/(tabs)/groups.tsx`
- Purpose:
  - preserved More-owned route: one group at a time, chosen with the group
    chips (no `All`; `?groupId=`, else the group last shown, else the first),
    with a joined `Stream` / `Leaderboards` segment
  - Stream: a newest-first stream of the group's sessions, records, and
    membership events; (M25-T10) record cards sit directly below their session
    card, whose `N records` label counts them; record-removed and link items
    are light rows; a record card opens the row detail sheet and offers
    `Certify` inline
  - Leaderboards (M25-T09): the group's podium cards (see the group screen
    history below for their states)
- Key states (high level):
  - signed-out / auth-unconfigured sign-in-required card (no group RPC runs)
  - no-groups explanatory empty state with `Create group` / `Join with a code`
  - header: the `Groups` title with `My groups` beside it; the same however it
    is opened (no `Back to More`)
  - cached stream first, then refreshed on focus, every 30 s, and on pull-to-refresh; older pages load online at the end of the list
  - offline marker over cached data; offline empty state with no cache; inline error or error state with `Retry`
- Key exits:
  - `/group-session/<memberId>/<sessionId>` (session card), `/group/mine` (header), `/group/new`, `/group/join` (empty state); membership items do not navigate
  - `/group/<groupId>/leaderboards/<exerciseId>` (podium card)
  - the in-route row detail sheet (record card), whose `View full session` opens `/group-session/<memberId>/<sessionId>`

13. `/group/mine`
- File: `apps/mobile/app/group/mine.tsx`
- Purpose:
  - My groups: `Join group` / `Create group`, then each active membership with its description, member count, and my role; the way into a group's management page
- Key states (high level):
  - sign-in-required / empty (with `Create group` / `Join with a code` instead of the action row) / offline / error states as on the tab; pull-to-refresh
- Key exits:
  - `/group/<groupId>` (row tap); `/group/new`, `/group/join` (action row or empty state)

14. `/group/[groupId]`
- File: `apps/mobile/app/group/[groupId]/index.tsx`
- Purpose:
  - the group screen, for managing the group: header (name, description, the member count · my role line, which opens Members, and owner/admin `Invite` (primary) + `Edit`), then the group's `Exercises` (product D14). The stream and leaderboards moved to the Groups screen
- Key states (high level):
  - loading / offline / error
  - Exercises: active exercises, then archived ones marked `Archived`, each with its weight entry and my local link status (`Linked: …` / `Not linked`); an active row none of mine is linked to offers `Link your exercise` to every member (the M25-T07 pick sheet, link-only); owner/admin `Add exercise` and a row sheet (`Rename`, `Archive` with confirmation, or `Unarchive`), which members never see; "No group exercises yet" when empty; each write's outcome as an inline notice
  - Leaderboards podium states (M25-T09, now on the Groups screen): one podium card per group exercise on `Certified · e1RM` (top 3 with `You` on my row, `You: Nth` below the podium, `You: not ranked`, `No certified sets yet · N uncertified` / `No sets yet`), archived exercises last marked `Archived`; "No group exercises yet" when empty; cached, so it shows offline
  - lost access after `NOT_FOUND` on the group or its exercises: "You're no longer a member of this group", with cached data hidden
- Key exits:
  - `/group/<groupId>/members` (member count), `/group/<groupId>/invite`, `/group/<groupId>/edit`
  - `/group/<groupId>/exercises/new` (`Add exercise`), `/group/<groupId>/exercises/<exerciseId>/edit` (`Rename`)
- Notes:
  - sets its stack title to the group name once loaded

14a. `/group/[groupId]/members` (M25-T08)
- File: `apps/mobile/app/group/[groupId]/members.tsx`
- Purpose:
  - the member list behind the group header's member count (D14): members in server order (owner, admins, members, then username)
- Key states (high level):
  - a member row with actions for my role (§4.3) shows a chevron and opens the in-route member action sheet; Remove / Transfer confirm first
  - under the list: danger `Leave group` (admin, member, confirmed) or, for the owner, "Transfer ownership before leaving"
  - an inline notice for each write outcome ("alex was removed." / the failure, nothing changed); FORBIDDEN / NOT_FOUND also refresh
  - offline / error / lost-access states as on the group screen
- Key exits:
  - back to `/group/<groupId>`; after a successful leave, `/groups`

14b. `/group/[groupId]/exercises/new` (M25-T08)
- File: `apps/mobile/app/group/[groupId]/exercises/new.tsx`
- Purpose:
  - owner/admin add a group exercise: `From catalogue` (search the bundled standard exercises and pick one, which prefills the form) or `Custom`, through the shared name + weight-entry fields
- Key states (high level):
  - inline "Exercise name is required"; the write's failure above `Add exercise`, nothing created, draft kept; members see "You can't add exercises"
- Key exits:
  - back to `/group/<groupId>` (Exercises, refreshed on focus) after adding

14c. `/group/[groupId]/exercises/[exerciseId]/edit` (M25-T08)
- File: `apps/mobile/app/group/[groupId]/exercises/[exerciseId]/edit.tsx`
- Purpose:
  - owner/admin rename a group exercise or change its weight entry, prefilled from the cached list
- Key states (high level):
  - archived: "Archived exercises can't be edited"; not in the list: "This exercise is no longer available"; members: "You can't edit this exercise"; a failed save shows above `Save changes` and changes nothing
- Key exits:
  - back to `/group/<groupId>` after saving

14d. `/group/[groupId]/leaderboards/[exerciseId]` (M25-T09)
- File: `apps/mobile/app/group/[groupId]/leaderboards/[exerciseId]/index.tsx`
- Purpose:
  - a group exercise's full board (E1.2): `Weight | e1RM` and `Certified | All` toggles that switch in place, rows in rank order (rank, `You` / name, `(former)`, value, date; a check icon, or a ring icon and `uncertified`, on All only)
- Key states (high level):
  - `Archived · read-only` under the name; empty Certified: "No certified sets yet" with `See all sets`; empty All: "No sets yet"
  - rows read online and paged (never cached): offline with nothing loaded shows the offline empty state, loaded rows stay with the offline marker, a failed next page shows `Retry`
  - lost access (group `NOT_FOUND`); "This exercise isn't in this group" (exercise `NOT_FOUND`)
  - (M25-T10) a row opens the row detail sheet: value (with e1RM), the as-logged value when converted, date and gym, `Logged as "…"`, the certification line, and `Certify` / `Remove my certification` / `Cancel certification` as my relationship allows; a write refetches the first page
- Key exits:
  - `History` → `/group/<groupId>/leaderboards/<exerciseId>/history`; back to the group screen
  - the sheet's `View full session` → `/group-session/<memberId>/<sessionId>`
- Notes:
  - sets its stack title to the exercise name once loaded

14e. `/group/[groupId]/leaderboards/[exerciseId]/history` (M25-T09)
- File: `apps/mobile/app/group/[groupId]/leaderboards/[exerciseId]/history.tsx`
- Purpose:
  - the board's lead changes for the toggles it was opened with (E1.3), newest first, each a date and a sentence
- Key states (high level):
  - "No lead changes yet"; online and paged like the board, with the same offline, error, lost-access, and exercise-missing states
- Key exits:
  - back to the board

15. `/group/new` (M22-T05)
- File: `apps/mobile/app/group/new.tsx`
- Purpose:
  - create a group: the inline username gate first when the username is blank, then the shared name / description form
- Key states (high level):
  - inline field validation (name 1–50, description ≤280); the write's failure above `Create group`, nothing created; server `USERNAME_REQUIRED` re-opens the gate with the draft kept
- Key exits:
  - `/group/<newGroupId>` (replaces the form) as owner

16. `/group/join` (M22-T05)
- File: `apps/mobile/app/group/join.tsx`
- Purpose:
  - join by code: the username gate if needed, the code field, a preview (name, member count), then `Join group`
- Key states (high level):
  - a link's code is prefilled and previewed at once; "This invite code isn't valid." for an unknown or regenerated code; already a member shows `Open group`
- Key exits:
  - `/group/<groupId>` (replaces the join screen) after joining or when already a member

17. `/group/[groupId]/invite` (M22-T05)
- File: `apps/mobile/app/group/[groupId]/invite.tsx`
- Purpose:
  - owner/admin invite: the code (large, selectable, testID `group-invite-code`) and its `boga3://` link, `Share invite` (core `Share.share`), and danger `Regenerate code` behind a confirmation
- Key states (high level):
  - the code loads online only (never cached); members, or a server `FORBIDDEN`, see "Invites are for admins"; a failed regenerate keeps the old code

18. `/group/[groupId]/edit` (M22-T05)
- File: `apps/mobile/app/group/[groupId]/edit.tsx`
- Purpose:
  - owner/admin edit of name and description with the shared form, prefilled from the cached group
- Key states (high level):
  - members see "You can't edit this group"; a failed save shows above `Save changes` and changes nothing
- Key exits:
  - back to `/group/<groupId>` after saving

19. `/group-session/[memberId]/[sessionId]`
- File: `apps/mobile/app/group-session/[memberId]/[sessionId].tsx`
- Purpose:
  - read-only friend's session view composing `SessionContentLayout`: member, status, start/end, location, and exercise cards with performed sets (`Set`, `Weight`, `Reps`, `Effort`)
- Key states (high level):
  - `In progress` for an active session; cache-first with the offline marker; pull-to-refresh
  - `NOT_FOUND`: "This session is no longer available", and the cached detail is evicted
- Notes:
  - no edit, delete, or append; `completed-session/[sessionId]` is neither reused nor modified

20. `/exercise-link` (M25-T07)
- File: `apps/mobile/app/exercise-link.tsx`
- Purpose:
  - the Link screen for one of my exercises: link it to my groups' exercises or unlink it (product E0.3)
- Key states (high level):
  - sign-in-required when signed out; "This exercise isn't available" for a missing/unknown id
  - `Linked` (my links, from the local synced table: `Unlink` confirms first; a link into a group I left reads `inactive — not a member`, one to an archived group exercise `archived`; missing cache entries show `Group exercise` / `A group`), then a search over group exercises only, `Suggested` (same standard exercise, then name matches), and `All group exercises` by group; one link per group, so the rest of that group shows `already linked in <group>`; archived group exercises are never offered
  - `Link` and `Unlink` are local writes (work offline); a success line repeats the retroactivity note; the load-mode note shows when weight entry differs
  - a deleted exercise shows "Restore this exercise to link it" (links still listed and unlinkable); offline with nothing cached shows "Connect once to load your groups' exercises"; offline marker and pull-to-refresh as on the group screens
- Key exits:
  - back to the catalogue or the recorder (native back)
- Notes:
  - sets its stack title to `Link "<exercise name>"` once the exercise resolves

21. `/session/[sessionId]/exercise/[sessionExerciseId]` (exercise/session redesign step 4)
- File: `apps/mobile/app/session/[sessionId]/exercise/[sessionExerciseId].tsx` (composition in `apps/mobile/components/exercise-page/`)
- Purpose:
  - one page per exercise of the active session, in the design language (`design-language.md`; accepted target `design-targets/exercise-session-v5.md`): top bar (back · exercise name · ⋮), the collapsible records panel, one ordered set list whose current set expands in place into the logger, `+ Add set`, and `Complete exercise`
  - behind the `New exercise & session screens` setting (`useNewScreensEnabled()`); built beside the recorder, which it shares its domain with (`src/session-recorder/**`)
- Key states (high level):
  - records panel collapsed (`1RM` / `Max` / `Vol`), expanded on `Records` (each record's date and set) or on `Last` (the previous completed session's sets); `Records` | `Last` and `History` are present in both
  - performed, current and planned rows (glyph `set-done` / `set-current` / `set-planned`); the logger (Weight · Reps · Effort · the `accent` tick) on the first set not performed, or on the row tapped
  - the effort sheet (W-Up / RIR 2 / RIR 1 / RIR 0) and the ⋮ sheet (Edit exercise / Swap exercise / Remove from session)
  - setting off: a notice with `Open Settings`; a missing session or exercise, or a session not in progress: an inline message
- Key exits:
  - back (top bar) → the previous screen; `Complete exercise` → the previous screen after resolving the sets still waiting; `Remove from session` → the previous screen; `History` → `/exercise-history`
- Notes:
  - entered from the session view's exercise cards (step 5), or by deep link (Maestro `teleport=exercise-page`); with no screen to go back to, back goes to `/train`

## Route shell (not a user-facing screen)

1. `apps/mobile/app/_layout.tsx`
- Purpose:
  - root stack registration and local data bootstrap on app mount
- Notes:
  - wraps the whole navigator in the route-layer auth guard (`apps/mobile/components/navigation/auth-route-guard.tsx`), which enforces login-on-start for configured signed-out sessions (neutral loading view while restoring, redirect to `/sign-in` when configured-but-signed-out, stand aside when auth is unconfigured, while allowing `/sign-in` and the dev/test-gated `/maestro-harness` route to render through)
  - immediately below the auth guard, wraps the navigator in the first-sync gate (`apps/mobile/src/sync/SyncGate.tsx`), which blocks a signed-in user behind a full-screen "Setting up your data…" block until `sync_runtime_state.bootstrap_completed_at` is set (then dismisses in place), and observes sync runtime state through the single shared scheduler-state accessor
  - tab roots live inside the `(tabs)` route group (`apps/mobile/app/(tabs)/_layout.tsx`) with `headerShown: false`; the root stack registers the `(tabs)` group itself plus the `sign-in` screen and the detail screens (`exercise-history`, `sessions`, `profile`, `connected-agents`, `maestro-harness`, `completed-session/[sessionId]`, the M22 `group/mine`, `group/[groupId]/index`, `group-session/[memberId]/[sessionId]`, the M25 `exercise-link`, and the header-less redesign screens `session/[sessionId]/index` (session view) and `session/[sessionId]/exercise/[sessionExerciseId]` (exercise page))
  - the root stack gives every detail screen the native minimal back-button
    display mode (no custom back title), preserving normal platform back
    behavior while hiding the previous route-group title; the arrow-only
    button slides in with the screen instead of morphing a label in
  - completed-session route sets its title inside the route file
  - exercise-history route also sets its title inside the route file (resolved exercise name)

2. `apps/mobile/app/(tabs)/_layout.tsx`
- Purpose:
  - tab group layout that owns the canonical roots (`today`, `train`,
    `progress`, `more`) plus preserved legacy roots (`stats-history`,
    `session-recorder`, `exercise-catalog`, `groups`, `settings`)
- Notes:
  - all tab roots have `headerShown: false`
  - the system tab bar is supplied via `tabBar`: `BottomTray` wraps exactly four
    `MainTabs` destinations and exposes a drag handle to collapse to a peek
    strip. Preserved roots are registered with `href: null`, resolve to their
    canonical owner, and remain directly addressable; recorder routes keep the
    tray mounted but collapse it to the peek handle on entry. Screens can
    imperatively expand/collapse via `useTrayVisibility()`; initial state is
    `expanded`. Snap math is unit-tested in
    `apps/mobile/src/navigation/tray-snap.ts`.

## Documentation boundary

- Keep this doc brief and route-oriented.
- Do not duplicate detailed section breakdowns, component trees, or render logic from route files.
- If route purpose or screen-level state set changes materially, update this doc in the same task.
