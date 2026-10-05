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
  - a landing page: how this week and this month are going, the latest
    session, and joined-group activity, each linking to its full screen
- Key states (high level):
  - Progress (`components/today/`, from `src/progress-summary`): this week's
    sessions, working sets and PRs, each with a bar against last week's whole
    total; the month's working sets against the previous month at the same
    day and a cumulative line chart with a projection; the
    latest completed session as one link row. Loading and a retryable error
    are `StatePanel`s; with no completed session, `Your week starts here` with
    `Open Train`. Read again on every focus, keeping the figures on screen
  - Group activity (`components/today/`, one `group_week_summary` read per
    group, cache-first): a group `ChipGroup` only with more than one group
    (the Groups screen's selection, shared both ways), this week's top three
    by working sets with group records as `PRs`, a `You · <rank>` line when
    the user is outside them, then the latest activity row (one member
    training now, `<n> training now`, or the latest completed session with its
    group record). Signed out and auth-unavailable keep their `StatePanel`s;
    no group is `Train with friends` with `Find a group`; offline shows the
    cached week under the offline `Notice`, never an earlier week; a failed
    refresh is an inline `Notice` with `Retry` above the card
  - no in-progress workout and no plan: Train owns starting and resuming
- Presentation: `design-targets/today-landing.md`. `paper` ground, no page
  title, one `SectionHeader` per section (`View progress` / `View groups` caps
  text buttons), each section one `Card`. No `accent`: Today has no primary
  action; `record` marks PRs and the `viz` ramp draws the bars and the chart
  fill. The group card reuses the Groups screen's chips (`GroupFilterChips`),
  offline `Notice` and missing-data panels
- Key exits:
  - `/progress`, `/sessions`, `/completed-session/[sessionId]`, `/train`,
    `/groups`, `/group/[groupId]`, `/group-session/[memberId]/[sessionId]`,
    and `/sign-in`

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
- Presentation (design language, DLM-T03): `paper` ground, a `PageHeader`
  and one `SectionHeader` per section. One `accent` at a time:
  `Resume workout`, or `Start planned workout` when a plan is ready (with
  `Start empty workout` as an outline), else `Start empty workout`
- Key exits:
  - `/session/<id>` after guarded empty/planned launch or active resume;
    a future planner exit is supplied by the planning integration rather than
    guessed here

1d. `/progress` (canonical tab)
- File: `apps/mobile/app/(tabs)/progress.tsx`
- Purpose:
  - canonical muscle comparisons and inline contributing exercises
- Key states:
  - configured calendar window; Working sets initially, Volume alternative;
    complete taxonomy grouped by inert families; separate muscle history links
    and contribution chevrons; matched Now/Previous/Change columns and inert Total
  - first loading, inline error/Retry, previous-only and metric-specific empty
    contributions, Volume coverage; Settings-driven individual history sheets
  - quiet Browse exercises and Sessions links; retained exercise search and sort
- Notes:
  - `stats-history.tsx` re-exports this implementation; the compatibility path
    selects Progress in shared navigation. Target: `design-targets/progress-tables.md`.

1e. `/more` (canonical tab)
- File: `apps/mobile/app/(tabs)/more.tsx`
- Purpose:
  - scalable home for secondary capabilities that should not expand the
    persistent tab bar
- Key states (high level):
  - Community links to existing group discovery and administration
  - Tools links to MCP setup, connected-agent management and Gyms; connected
    agents is omitted without a user, developer logs is omitted outside
    `isDevMode`, and an external-browser failure is shown inline without
    disabling the hub
  - Library & account links to existing exercise-database management and
    Settings/account
- Presentation (design language, DLM-T04): `paper` ground under a
  `PageHeader`. Each section is an `ink-muted` micro-label over one `Card` of
  `ListRow`s: a leading `ink-muted` glyph (no badge), the label and its
  description, and a trailing chevron, or `arrow-up-right` for the external
  setup link. The inline error is `danger` text under its row. No `accent`
- Key exits:
  - `/groups`, `/connected-agents`, `/gyms?source=more`, `/dev-logs`,
    `/exercise-catalog`, and `/settings`, plus the first-party external MCP
    setup page

2. `/sign-in`
- File: `apps/mobile/app/sign-in.tsx`
- Purpose:
  - dedicated sign-in entry point enforcing login-on-start: while auth is configured and the user must sign in, it is the only route the root stack declares, so no data screen renders
- Key states (high level):
  - configured signed-out email/password form with inline auth error feedback (reuses the `/profile` signed-out credential pattern)
  - auth-unconfigured disabled-reason message instead of a form
- Presentation (design language, DLM-T05): `paper`, centred, no header. A
  `PageHeader` over one `Card` of `FormField`s with `Sign in` as the one
  `accent`; a failure is a `danger` `Notice`, and an auth-unconfigured build a
  `Notice` with the `warning` glyph ("Sign-in unavailable") instead of the form
- Key exits:
  - the root stack removes this route once a session exists and the router moves on to `/sync-setup` or `/`; no explicit navigation on success

2b. `/sync-setup` (first-sync block)
- File: `apps/mobile/app/sync-setup.tsx` (renders `SyncSetupScreen` from `apps/mobile/src/sync/SyncGate.tsx`)
- Purpose:
  - the device-recovery waiting room a signed-in user sees while the first sync cycle drains: a full-screen "Setting up your data…" block. Until `sync_runtime_state.bootstrap_completed_at` is set it is the only route the root stack declares (besides the dev/test harness), so no data screen is reachable before the user's data is restored; once set, the root stack removes it and the router moves on to `/`
- Key states (high level):
  - in-progress: a phase label plus an advancing activity/progress indicator ("layer K of N", "N items") that visibly moves while work happens
  - offline: an offline message instead of an indefinite spinner, shown only once NetInfo has reported `isConnected === false`; before NetInfo's first determined report the network is unknown and the block shows the in-progress state, never the offline copy
  - error: a single error message and a single Retry button (fires exactly one cycle) on a non-`AUTH_REQUIRED` cycle error
- Presentation (design language, DLM-T05): one `Card` centred on `paper`; the
  phase in `ink`, an `ink-muted` spinner, the activity line in Plex Mono
  `ink-muted`; offline is a `Notice` with the `offline` glyph; the error is
  `danger` text above `Retry`, the gate's one `accent`
- Key exits:
  - dismisses in place once `bootstrap_completed_at` is set, and the normal route renders
  - redirects to `/sign-in` (no Retry) when the latest cycle outcome is `AUTH_REQUIRED`
- Notes:
  - stands aside (renders through) for a signed-out or auth-unconfigured app, so it never traps a build with no session; the `/sign-in` route is exempt so the redirect cannot loop; display-only surfaces (phase, activity, offline) carry no extra primary action — Retry is the single action

3. `/stats-history`
- File: `apps/mobile/app/(tabs)/stats-history.tsx`
- Purpose: compatibility entry to `/progress`, with one implementation.
- Query params:
  - `period=7`: This week; all other/missing/invalid values: configured window
  - `breakdown=exercise`: retained exercise browsing; all other values: muscle table
- Key states and exits: identical to Progress above. Individual muscle names
  open exactly one muscle ID; exercise names open definition history. Each
  `HistorySheet` uses the saved look-back and Settings-owned Daily/Weekly view,
  with Daily for unset/invalid choices and valid Weekly retained. Both views
  remain mounted; Retry retains history selection. No family heatmap action.
- Notes: one `ScreenScroll` on paper over `MainTabs`, with Progress selected;
  the new landing is governed by `design-targets/progress-tables.md`, retained
  history by `design-targets/progress.md` and `ux-rules.md` §12–§13.

4b. `/session/[sessionId]` (session view)
- File: `apps/mobile/app/session/[sessionId]/index.tsx` (components in
  `apps/mobile/components/session-view/`)
- Purpose:
  - the active session, read-only and navigational (accepted target
    `design-targets/exercise-session-v5.md`, `V6-Session`). Every active-session entry opens it: Today, Train, Sessions'
    Resume and review/complete, and the completed session's per-exercise
    `Append`
  - also the completed-session editor: History's overflow `Edit`,
    View Session's top-bar `Edit` and
    `intent=edit` open it
- Key states (high level):
  - own top bar: `Session` · ⋮ · `Finish` (the one `accent` primary); the
    persistent four-tab bar sits at the bottom with Train selected
  - a completed session: `Edit session` · `Done` (no ⋮, nothing to abandon),
    Progress selected in the tab bar, and the summary card's Time replaced by
    editable `Start` / `End` fields (`YYYY-MM-DD HH:mm`). A field's error shows
    once it is left; while either is invalid, autosave pauses and the card says
    `Autosave paused until Start/End times are valid.` Gym, `+ Add exercise` and
    the cards work as for an active session, written back to the completed
    session; records compare against the completed sessions before it, never the session itself or later ones
  - summary card: Time (elapsed, ticking) / Gym / Sets (performed working sets) /
    Volume (the working sets' entered-load volume, warm-ups left out); the Gym stat opens
    the `Gym` sheet to change it: opening it starts one foreground location
    lookup (1.5 s budget), and exactly one confident match shows first as
    `Nearby · <gym>` (never preselected, and not shown for the session's own
    gym); then `No gym` and the unarchived gyms (seeded + local), the current
    one marked; the `Manage gyms` footer row opens `/gyms`
  - one read-only card per exercise, the whole card one link: name, `n/m` done
    count (confirmed of all rows), every row as `type · weight × reps · 1RM ·
    VOL` with mini legends, done rows in ink and planned/unconfirmed rows faded
    (planned rows show their prescription), every figure in its row's colour
    and weight, and — the one highlight — a brass record 1RM and `record` band with the
    1RM when a done set beats the exercise's completed history
    (`deriveExercisePersonalRecord`)
  - `+ Add exercise` opens the shared exercise picker with Search, Favourite/Name A–Z and Show never-done, a tall `Sheet`
    (`components/session-recorder/exercise-picker.tsx`), and writes the new
    exercise (one empty set) or appended plan straight to the draft. Design
    target: `design-targets/exercise-catalogue.md`
  - ⋮ opens the `Session` menu sheet: `Session vs history` (opens
    `/session/<id>/compare`) and `Abandon session` (danger), which confirms
    before its soft delete
  - `Finish` runs the shared cleanup prompts (unconfirmed sets, then one
    prompt for incomplete sets and empty exercises, as alerts) and completion
    write; invalid set values block it with an alert naming the
    exercises
  - `Done` (completed): invalid times reveal their errors and write nothing;
    otherwise it runs the same set-value check and cleanup prompts with
    completed-edit labels (`… and save changes`), then saves the confirmed rows
    only and never replays completion
  - loading; `This session is no longer active.` with `Back to Train` when the
    id is neither the active draft nor a completed, undeleted session;
    retryable read error
- Key exits:
  - `/session/<sessionId>/exercise/<sessionExerciseId>` from a card
  - `/completed-session/<sessionId>?presentation=completion` after Finish
  - back to where the edit was opened (History, the completed session) after
    `Done`; `/completed-session/<sessionId>` when there is nothing to go back to
  - `/train` after Abandon, or any tab from the bottom bar (`dismissTo`)
  - `/exercise-catalog?source=session&intent=manage` from the picker's
    Manage; the picker returns on focus
  - `/gyms` from the gym sheet's `Manage gyms`; on return the sheet reopens
    with the gyms reloaded
- Notes:
  - reloads the session on every focus, so the exercise page's edits show on
    return; edited Start/End are not reloaded over
  - edits autosave losslessly (every row kept); only `Done` drops unconfirmed
    rows (`05-data-model.md`)
  - its stack title `Session` is the back label of the screens it pushes

5. `/exercise-catalog`
- File: `apps/mobile/app/(tabs)/exercise-catalog.tsx`
- Purpose:
  - exercise catalog management (create/edit/soft-delete/undelete exercises, load-entry mode, and muscle mappings)
- Key states (high level):
  - in the design language (DLM-T07; target `design-targets/exercise-catalogue.md`):
    the in-content title `Exercises`, then the filter field, the `accent` `+`
    (the screen's one primary) and management ⋮ on one row, Sort and Show never-done
    below it, and an outcome `Notice` (`Exercise created.` …)
  - loading / error as a `StatePanel`, or the content
  - shared exercise browser with mandatory taxonomy-ordered muscle families, visible Favourite/Name A–Z and Show never-done controls (shared local preferences); search expands matching families and clearing restores prior expansion. Rows show last performed and all-time session count; history loading/error states never imply Never done
  - the management sheet (⋮): catalogue-only deleted visibility (`Show deleted` / `Hide deleted`); everyday browsing controls stay on the page
  - the row `⋮` actions sheet, titled with the exercise's name, offers `Edit`, `Link to group exercise…` (M25-T07; signed in only, disabled for a deleted exercise), and `Delete` (`danger`, no confirmation) / `Undelete`
  - the exercise editor sheet (create / edit), with its muscle list shown in the same sheet
- Key exits:
  - back to the session view (`router.back()`) after save when opened with
    `source=session` (the session view picker's Manage)
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
  - Preferences: an `Appearance` row (`settings-appearance-row`, Lucide
    `palette`) naming the chosen theme (`<Preset> from next launch` until the
    app reopens), which opens the `Appearance` sheet
    (`settings-appearance-sheet`): the presets as radio rows
    (`settings-appearance-option-<id>`) with a decorative swatch of each, saved
    on tap, and a note that a new theme applies the next time BoGa opens; a
    failed save restores the previous choice and says nothing changed
    (`settings-appearance-error`). Rules: `ux-rules.md` §9b
  - Preferences card: date format (`settings-date-format-<format>`) and past-records
    gym filter (`settings-records-gym-<scope>`) are account-local on this device.
    Sign-out hides the choices and returning to the account restores them;
    database rebuilds preserve them. Read/save failure retains durable values
    and failed input; feedback lives centrally in Data & Sync's Error row,
    with its existing Refresh action retrying storage. Preference controls and
    the three exercise browsers add no error boxes or Retry buttons.
    Theme and the synced bodyweight toggle retain their separate storage paths.
  - AI coaching always offers an external `Connect an AI coach` setup link and
    states the read-only/revocable boundary; browser-launch failure stays inline
    and retryable. The separate Connected agents row is signed-in only.
  - a sync-status card (signed-in only) showing last successful sync time
    (`Never` until the first success), pending-change count (rows still waiting
    to push across the user-owned tables), network state (online/offline, or
    `Checking…` until NetInfo reports a determined `isConnected` — never shown
    as offline or online before then), and
    the latest sync error (or a sign-in-required hint) alongside any preference
    storage failure in the same live Error row; Refresh retries preferences,
    nudges a sync cycle and reads sync status. The card refreshes on screen focus and on a short interval while
    focused. Card/fields carry stable testIDs (`settings-sync-status-card`,
    `settings-sync-status-last-success`, `settings-sync-status-dirty-count`,
    `settings-sync-status-network`, `settings-sync-status-error`).
  - signed-out Data & sync guidance in the existing card. A preference-storage
    failure adds the Error row and Refresh within that card; Refresh retries
    only preferences, without starting sync or reading signed-in sync status
  - About shows installed native version/build where available, optional release
    codename, and Preview/Local flavor only outside production
  - a developer-tools card (`isDevMode()` only), last and separate from the
    sync-status card, with the local/remote wipe affordances
  - available from the Settings row under More regardless of auth state; the
    row adds `source=more` and an explicit `Back to More`; the direct
    `/settings` path remains valid without it
- Presentation (design language, DLM-T04): as More, under `Back to More` and a
  `PageHeader`. The date format is a `SegmentedControl`; the signed-out sync
  guidance a `StatePanel` in a `Card`; About a `Card` of text rows. The sync
  panel is a `Card` of `ListRow`s with Plex Mono values: offline is the
  `offline` glyph plus "Offline" in `ink`, an error is `danger`, and `Refresh`
  is an outline. Developer tools is one `Card` headed by the `warning` glyph;
  outline buttons (`Wipe remote` in `danger`) and a `Notice` per outcome. No
  `accent`. Logs (`/dev-logs`, dev only) filters with a single-select
  `ChipGroup` and lists its rows in one `Card` (error `danger`, warning `ink` +
  `warning` glyph). Design target: `design-targets/more-settings.md`
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
- Presentation (design language, DLM-T05): the native header carries the
  title (no in-content title) above the `ink-muted` intro. Signed-out, loading,
  empty and error states are `StatePanel`s in a `Card`. Each grant is a `Card`
  with an `AI` `Tag`, `ListRow`s for the two dates (Plex Mono) and `Revoke
  access` as an outline in `danger`. No `accent`
- Key exits:
  - back to `settings` (or previous route) via stack navigation

8. `/profile`
- File: `apps/mobile/app/profile.tsx`
- Purpose:
  - auth-aware account route for sign-in and signed-in username/email/password management (sync status lives on Settings)
- Key states (high level):
  - restoring/auth-bootstrap banner
  - auth-disabled warning when client config is missing
  - signed-out email/password form with inline auth error feedback
  - signed-in view mode with row-based account values (username/email plus optional pending-email row) and bottom actions (`Edit`, `Sign out` in `danger`)
  - signed-in edit mode with `username`/`new email`/`new password` fields and one `Update` action
  - lazy profile load/provision state for `username`
  - inline unified profile-update success/failure (including pending email-confirmation messaging)
  - sign-out failure feedback that stays on the same route
- Presentation (design language, DLM-T05): `paper`. View mode is one `Card`
  of `Stat kind="text"` rows in `ink` over `Edit` (outline) and `Sign out`
  (outline in `danger`), with no `accent`. Edit stays inline: a `Card` of
  `FormField`s with `Cancel` (text) and `Update` (the `accent`). Outcomes are
  `Notice`s (`success` glyph, or `danger`); restoring is a loading
  `StatePanel`; auth-unconfigured is the `warning` `Notice`
- Key exits:
  - in-place rerender between signed-out and signed-in states
  - back to `settings` (or previous route) via stack navigation

9. `/sessions`
- File: `apps/mobile/app/sessions.tsx`
- Purpose:
  - stack-based complete session list reached from the Stats Sessions card
- Key states (high level):
  - one `ScreenScroll` on `paper` (DLM-T10): an `Active` micro-label over the
    active session's `Card` (the `set-current` glyph, its summary line, then
    `check` and ⋮ `IconButton`s), then a `History` micro-label with the
    `Show deleted` / `Hide deleted` text button (`checked`), and the completed
    sessions as `ListRow`s in one `Card`, each with ⋮
  - one focus-aware automatic history load on first presentation and on each
    later focus reacquisition; filter and mutation refreshes remain explicit
  - a completed row's ⋮ opens a `Sheet` titled with its start stamp: `Edit`,
    `Append`, `Delete` (`danger`, no confirm) or `Undelete`; a deleted row is
    faded and carries a `Deleted` `Tag`
  - the active ⋮ opens a `Sheet` with `Delete`, confirmed by an `Alert`
    (`Cancel` / `Discard`, T10-D4)
  - `StatePanel`s: `Loading sessions…`; `Could not load sessions` with `Retry`
    (T10-D6); `No completed sessions`; `No sessions yet`
  - active Resume and review/complete affordances both open the session view
    so draft state and the shared cleanup rules remain authoritative
- Key exits:
  - `/session/<id>` pushed for active Resume or review/complete
  - `/completed-session/<sessionId>` from a completed row
  - `/session/<sessionId>` from its explicit Edit action
- Notes:
  - the native stack header centers `Sessions` and uses the platform back arrow
    without a text label, so the internal `(tabs)` group name is never exposed

10. `/completed-session/[sessionId]`
- File: `apps/mobile/app/completed-session/[sessionId].tsx`
- Purpose:
  - View Session: a finished session, read-only, in the design language
    (`components/view-session/`, the shared cards in
    `components/session-detail/`); `Edit` opens it in the session view
- Key states (high level):
  - loading / error / not-found (on `paper`, with the top bar's back) / detail
  - `presentation=completion` (after Finish), in the design language
    (`components/session-complete/`): its own top bar `Session complete` ·
    `Done` (`accent`); a summary card (Duration / Exercises / Sets, then Gym)
    with an informational `Sets by muscle` table (primary, secondary, and
    sets = primary + ½ secondary); every record set (1RM,
    else Weight) as a `record`-band card; per-exercise working-set volume versus
    median with a descriptive P5/P95 range (a warm-up-only exercise is not
    compared); and `Share session` (outline), which opens a
    `Sheet` previewing the PNG. It does not link to muscle analytics. Optional
    historical enrichment cannot block it, and share output excludes
    gym/location. Edit/delete/append actions are hidden.
  - all historical links (including `presentation=summary`) open View Session:
    shared facts, then local `Summary | Sets` (Summary by default). Summary
    reuses the working-set breakdown, records, comparison grouping and Share;
    Sets contains the read-only exercise cards. A comparison loading/error
    state leaves facts, Sets and actions usable. No additional detail route.
    Edit → Done preserves section/grouping and refreshes all projections.
  - completion loading/error/not-found/deleted-target states show the top bar
    without Done and one safe exit, `Back to Progress`; the back gesture is
    off and Android system back replaces to Progress
  - detail: its own top bar, `back · View Session · ⋮ · Edit` (`Edit` the one
    `accent` action, no native header); a summary card with `Start` / `End`
    (`YYYY-MM-DD HH:mm`) then `Duration` / `Gym` / `Sets` / `Volume` (working
    sets only); Sets has one card
    per exercise with its confirmed sets as the session view's rows (`type ·
    weight × reps · 1RM · VOL`, `n sets`), the record set's beaten figures in
    brass and a `record` band on its card (`tech/training-metrics-contract.md`
    §3); no tags, no collapse
  - the session ⋮ opens a `Session` sheet: `Delete session` (danger), or
    `Undelete session` while deleted; a deleted session shows a `Deleted ·
    hidden from history` band and no `Edit`
  - each card's ⋮ opens a sheet with `Append to current session`, which copies
    that one block as planned target rows into the active session (creating one
    first when needed)
  - a failed delete, undelete or append shows inline in `danger`
  - redirect placeholder for `intent=edit`
- Key exits:
  - `/session/<sessionId>` (the session view, editing) from `Edit`, and by
    `replace` for `intent=edit`
  - `/session/<activeSessionId>` (the session view) after a successful
    per-exercise block append, using the id the append returns
  - `/progress` from completion Done/back
  - back from the detail's top bar (`router.back()`, or `/progress` with no
    history)

11. `/exercise-history`
- File: `apps/mobile/app/exercise-history.tsx`
- Purpose:
  - per-exercise performance history view (progression signals + per-tag drill-down for a single `exercise_definitions` row)
- Key states (high level):
  - one `ScreenScroll` on `paper` over `MainTabs` (DLM-T10; `ux-rules` §13.14–16)
  - loading / error / detail, as `StatePanel`s in a `Card`
  - in-section empty state when no sessions match the active period/tag filter
  - a `Last 7 days` / `Last 30 days` / `All time` `SegmentedControl` and a
    sideways-scrolling tag `ChipGroup` (`ux-rules` §10.2)
  - a deleted exercise's `Notice`; the `All-time bests` card (`1RM`, `Top
    weight`, figures in `record`); one View Session exercise card per session
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
- Presentation (design language, DLM-T11; `design-targets/groups.md`): a
  `ScreenScroll` on `paper` (the stream a `FlatList` on the same shell), the
  `Groups` `PageHeader` with `My groups` a caps text button beside it, the
  group chips a single `ChipGroup`, and `Stream` | `Leaderboards` a
  `SegmentedControl`. Session cards are `Card` links (`Training now` beside the
  `set-current` ring); record cards carry the `record` band and open the row
  detail `Sheet` (no Close; `Certify` its one `accent`). The empty state's
  `Create group` is the screen's one primary. Every group route shares this
  page shell (`groupScreenStyles`) and its state panels (`StatePanel`)
- Key states (high level):
  - signed-out / auth-unconfigured sign-in-required card (no group RPC runs)
  - no-groups explanatory empty state with `Create group` / `Join with a code`
  - header: the `Groups` title with `My groups` beside it; the same however it
    is opened (no `Back to More`)
  - cached stream first, then refreshed on focus, every 30 s, and on pull-to-refresh; older pages load online at the end of the list
  - offline marker over cached data; offline empty state with no cache; inline error or error state with `Retry`
- Key exits:
  - `/group-session/<memberId>/<sessionId>?groupId=<groupId>` (session card), `/group/mine` (header), `/group/new`, `/group/join` (empty state); membership items do not navigate
  - `/group/<groupId>/leaderboards/<exerciseId>` (podium card)
  - the in-route row detail sheet (record card), whose `View full session` opens `/group-session/<memberId>/<sessionId>?groupId=<groupId>`

13. `/group/mine`
- File: `apps/mobile/app/group/mine.tsx`
- Purpose:
  - My groups: `Join group` (outline) / `Create group` (the one `accent`), then the active memberships as one `Card` of rows (name in Archivo, description in `ink-muted`, member count · my role as a micro-label, a chevron; design language DLM-T13); the way into a group's management page
- Key states (high level):
  - sign-in-required / empty (with `Create group` / `Join with a code` instead of the action row) / offline / error states as on the tab; pull-to-refresh
- Key exits:
  - `/group/<groupId>` (row tap); `/group/new`, `/group/join` (action row or empty state)

14. `/group/[groupId]`
- File: `apps/mobile/app/group/[groupId]/index.tsx`
- Purpose:
  - the group screen, for managing the group: the header `Card` (name, description, and a `Members` row with the member count · my role, which opens Members), owner/admin `Invite` (the screen's one `accent`, DLM-T13-D1) + `Edit` (outline), then the group's `Exercises` under a micro-label, whose `Add exercise` is an outline (product D14). The stream and leaderboards moved to the Groups screen
- Key states (high level):
  - loading / offline / error
  - Exercises: active exercises, then archived ones marked `Archived`, each with its weight entry and my local link status (`Linked: …` / `Not linked`); an active row none of mine is linked to offers `Link your exercise` to every member (the M25-T07 pick sheet, link-only); a linked row offers `Unlink…` independently of role, selecting one personal ID through `Your linked exercises` when several exist, then confirming; local read failures hide actions/status and offer retry; owner/admin `Add exercise` (an outline beside the `Exercises` micro-label, DLM-T14) and a row sheet (`Rename`, `Archive` with confirmation, or `Unarchive`), which members never see; the rows are one `Card`, and the pick sheet and the unlink chooser are `Sheet`s with no Cancel; "No group exercises yet" when empty; each write's outcome as an inline notice
  - Leaderboards podium states (M25-T09, now on the Groups screen): one podium card per group exercise on `Certified · 1RM` (top 3 with `You` on my row, `You: Nth` below the podium, `You: not ranked`, `No certified sets yet · N uncertified` / `No sets yet`), archived exercises last marked `Archived`; "No group exercises yet" when empty; cached, so it shows offline
  - lost access after `NOT_FOUND` on the group or its exercises: "You're no longer a member of this group", with cached data hidden
- Key exits:
  - `/group/<groupId>/members` (member count), `/group/<groupId>/invite`, `/group/<groupId>/edit`
  - `/group/<groupId>/exercises/new` (`Add exercise`), `/group/<groupId>/exercises/<exerciseId>/edit` (`Rename`)
- Notes:
  - sets its stack title to the group name once loaded

14a. `/group/[groupId]/members` (M25-T08)
- File: `apps/mobile/app/group/[groupId]/members.tsx`
- Purpose:
  - the member list behind the group header's member count (D14): the header `Card` (name, count · my role), then members in server order (owner, admins, members, then username) as one `Card` of rows, the role a `Tag` (design language DLM-T13)
- Key states (high level):
  - a member row with actions for my role (§4.3) shows a chevron and opens the member action `Sheet` (no Cancel: the backdrop dismisses it); Remove / Transfer confirm first
  - under the list: `Leave group`, an outline in `danger` (admin, member, confirmed) or, for the owner, "Transfer ownership before leaving"
  - an inline notice for each write outcome ("alex was removed." / the failure, nothing changed); FORBIDDEN / NOT_FOUND also refresh
  - offline / error / lost-access states as on the group screen
- Key exits:
  - back to `/group/<groupId>`; after a successful leave, `/groups`

14b. `/group/[groupId]/exercises/new` (M25-T08)
- File: `apps/mobile/app/group/[groupId]/exercises/new.tsx`
- Purpose:
  - owner/admin add a group exercise: `From catalogue` (search the bundled standard exercises and pick one, which prefills the form) or `Custom` (a `SegmentedControl`), through the shared name + weight-entry fields in a `Card` whose submit is the screen's one primary; the picked standard exercise is the `radio-on` row (DLM-T14)
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
  - a group exercise's full board (E1.2): `Volume | 1RM` and `Certified | All` toggles that switch in place, rows in rank order in one card (rank, `You` / name, `(former)`, value, date; a check icon, or a ring icon and `uncertified`, on All only)
- Key states (high level):
  - `Archived · read-only` above the toggles (the name is the header title); empty Certified: "No certified sets yet" with `See all sets`; empty All: "No sets yet"
  - rows read online and paged (never cached): offline with nothing loaded shows the offline empty state, loaded rows stay with the offline marker, a failed next page shows `Retry`
  - lost access (group `NOT_FOUND`); "This exercise isn't in this group" (exercise `NOT_FOUND`)
  - (M25-T10) a row opens the row detail sheet: value (with the 1RM), the as-logged value when converted, date and gym, `Logged as "…"`, the certification line, and `Certify` / `Remove my certification` / `Cancel certification` as my relationship allows; a write refetches the first page
- Key exits:
  - `History` → `/group/<groupId>/leaderboards/<exerciseId>/history`; back to the group screen
  - the sheet's `View full session` → `/group-session/<memberId>/<sessionId>?groupId=<groupId>`
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
  - create a group: the inline username gate first when the username is blank (a `Card` with a `FormField` and `Save username`), then the shared name / description form (two `FormField`s, the description's counter in Plex Mono, the submit the one `accent`)
- Key states (high level):
  - inline field validation (name 1–50, description ≤280); the write's failure above `Create group`, nothing created; server `USERNAME_REQUIRED` re-opens the gate with the draft kept
- Key exits:
  - `/group/<newGroupId>` (replaces the form) as owner

16. `/group/join` (M22-T05)
- File: `apps/mobile/app/group/join.tsx`
- Purpose:
  - join by code: the username gate if needed, the code field (a Plex Mono `FormField`) and `Find group` (outline), a preview `Card` (name, member count), then `Join group` (the one `accent`)
- Key states (high level):
  - a link's code is prefilled and previewed at once; "This invite code isn't valid." for an unknown or regenerated code; already a member shows `Open group`
- Key exits:
  - `/group/<groupId>` (replaces the join screen) after joining or when already a member

17. `/group/[groupId]/invite` (M22-T05)
- File: `apps/mobile/app/group/[groupId]/invite.tsx`
- Purpose:
  - owner/admin invite: the code (Plex Mono 700 at `xxl`, letter-spaced, selectable, testID `group-invite-code`; DLM-T13-D3) and its `boga3://` link in `ink-muted`, `Share invite` (the one `accent`; core `Share.share`), and `Regenerate code` (an outline in `danger`) behind a confirmation, whose success reads "New code ready…" in a neutral `Notice` with the `success` glyph
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
  - read-only friend's session view on `paper`, drawn with View Session's cards (`components/session-detail/`): a facts card with the member, the status (`In progress` beside the `set-current` ring, or `Completed · <duration>`), Start / End, Gym and Sets, then one card per exercise with permitted reps/effort; normalized cards omit raw load and derived absolute metrics, while ordinary cards retain permitted kg; no collapse and no record band (the friend's history is not on this device)
- Key states (high level):
  - `In progress` for an active session; cache-first with the offline marker; pull-to-refresh (the offline marker, errors and empty states keep the groups screens' styling)
  - `NOT_FOUND`: "This session is no longer available", and the cached detail is evicted
- Notes:
  - no edit, delete, or append; `completed-session/[sessionId]` is not reused, only its cards

20. `/exercise-link` (M25-T07)
- File: `apps/mobile/app/exercise-link.tsx`
- Purpose:
  - the Link screen for one of my exercises: link it to my groups' exercises or unlink it (product E0.3)
- Key states (high level):
  - sign-in-required when signed out; "This exercise isn't available" for a missing/unknown id
  - `Linked` (my links, from the local synced table: `Unlink` confirms first; a link into a group I left reads `inactive — not a member`, one to an archived group exercise `archived`; missing cache entries show `Group exercise` / `A group`), then a search over group exercises only, `Suggested` (same standard exercise, then name matches), and `All group exercises` by group; one link per group, so the rest of that group shows `already linked in <group>`; archived group exercises are never offered
  - `Link` and `Unlink` are local writes (work offline); link success repeats the retroactivity note; unlink uses the same contextual confirmation and preservation wording as the group row, then names the removed mapping (plus reconnect/sync wording offline); failed local reads have a separate retry and never imply a write failed; the load-mode note shows when weight entry differs
  - a deleted exercise shows "Restore this exercise to link it" (links still listed and unlinkable); offline with nothing cached shows "Connect once to load your groups' exercises"; offline marker and pull-to-refresh as on the group screens
  - in the design language (DLM-T14): outcomes are `Notice`s (neutral with the `success` glyph, or `danger`); `Linked`, `Suggested` and `All group exercises` are micro-labels over `Card`s of rows, `Unlink` a `danger` text button and `Link` an outline; a `SearchField`; no primary
- Key exits:
  - back to the catalogue or the exercise page (native back)
- Notes:
  - sets its stack title to `Link "<exercise name>"` once the exercise resolves

21. `/session/[sessionId]/exercise/[sessionExerciseId]`
- File: `apps/mobile/app/session/[sessionId]/exercise/[sessionExerciseId].tsx` (composition in `apps/mobile/components/exercise-page/`)
- Purpose:
  - one page per exercise of the active session, or of a completed session being edited from the session view, in the design language (`design-language.md`; accepted target `design-targets/exercise-session-v5.md`): top bar (back · exercise name · ⋮), the collapsible records panel, one ordered set list whose current set expands in place into the logger, `+ Add set`, and `Complete exercise` — the last item in the scroll, after the set list, never a pinned footer
  - reached only from the session view; its domain lives in `src/session-recorder/**`
  - a completed session's exercise is edited with the same rules (logger, ticks, `Complete exercise`) and written back as completed with its times, every row kept; its records panel counts only the sessions before it (`ux-rules` §14a.4)
- Key states (high level):
  - records panel collapsed (`1RM` / `Max` / `Vol` of the selected view: the records, or the last session), expanded on `Records` (each record's date and set) or on `Last` (the previous completed session's sets); `Records` | `Last` and `History` are present in both, and switching views keeps the panel collapsed or expanded
  - performed, current and planned rows (glyph `set-done` / `set-current` / `set-planned`); the logger (Weight · Reps · Effort · the `accent` tick) on the first set not performed, or on the row tapped
  - the effort sheet (W-Up / None / descending RIR from the file-configured maximum, default 3) and the ⋮ sheet (Edit exercise / Swap exercise / `Link to group exercise…`, signed in only / Remove from session)
  - Swap exercise: the same Search, Favourite/Name A–Z and Show never-done controls and family list as the catalogue; excludes the current/deleted exercise, reveals search matches, and handles loading/error/empty history explicitly
  - a missing session or exercise, or a deleted session: an inline message
- Key exits:
  - back (top bar) → the previous screen; `Complete exercise` → the previous screen after resolving the sets still waiting; `Remove from session` → the previous screen; `History` → `/exercise-history`; ⋮ `Link to group exercise…` → `/exercise-link?exerciseDefinitionId=<id>`
- Notes:
  - entered from the session view's exercise cards, or by deep link (Maestro `teleport=exercise-page`); with no screen to go back to, back goes to `/train`

21b. `/session/[sessionId]/compare` (Session vs history)
- File: `apps/mobile/app/session/[sessionId]/compare.tsx`
- Purpose: the open session's live exercise/muscle volume comparisons against
  earlier completed history (working sets), off the session view so logging
  stays uncluttered.
- Key states: the shared `SessionInsightPresentation` (By exercise / By
  muscle); loading and failed history reads are explicit in it; an in-route
  loading, retryable error, or `This session is no longer active.` state.
- Entry: the session view's ⋮ `Session vs history`. Exit: the native header's
  Back.

22. `/gyms` (Gyms screen)
- File: `apps/mobile/app/gyms.tsx` (composition in `apps/mobile/components/gyms/`)
- Purpose:
  - manage the gyms a session can be at, and their private locations
- Key states (high level):
  - native header `Gyms`; one card listing the unarchived gyms (the seeded ones first, then the local ones by name), each with `Location saved` / `No location saved` (presence only, never coordinates); `+ Add gym`; `Show archived (n)` / `Hide archived` when any gym is archived, revealing an `Archived` card
  - a row opens its editor in place (`accent-wash`, `accent` leading rule): `Name`, the location status, then `Save current location` (no location) or `Replace` / `Clear` (each confirmed inline first), inline success/error feedback, and a footer `Archive` (danger) or `Unarchive` · `Cancel` · `Save` / `Add gym` (the one `accent` primary)
  - loading; a retryable read error
- Key exits:
  - native back → the session view (its gym sheet reopens) or More; from More (`source=more`) also an explicit `Back to More`, which pops back to the tabs (`dismissTo('/more')`)
- Notes:
  - reloads the gyms on every focus; name and archive changes close the editor, location changes keep it open

23. `/body-weight`
- File: `apps/mobile/app/body-weight.tsx`; composition: `components/bodyweight/`
- Purpose: private dated kg readings and history, reached from the always-visible
  `Body weight log` Settings row independently of the calculation preference.
- States: current value and measurement date; empty history;
  loading/retryable error; Add/Edit sheet with positive kg and required
  local date/time; invalid/future date or failed-save feedback retaining input;
  delete confirmation. Saves are local/offline.
- Native back returns to the caller. History orders by measurement time then ID.
- No session/detail/logger surface shows or links to a reading. Reading
  value/date changes and deletion recalculate affected projections silently.

## Route shell (not a user-facing screen)

1. `apps/mobile/app/_layout.tsx`
- Purpose:
  - root stack registration and local data bootstrap on app mount
- Notes:
  - wraps the root stack in the restore guard (`apps/mobile/components/navigation/auth-route-guard.tsx`), which shows a neutral loading view instead of the navigator while the session restore is in flight (boot only)
  - the root stack (`apps/mobile/components/navigation/root-stack.tsx`) declares every root route under one `Stack.Protected` group per access level — `sign-in`, `sync-setup`, the app — and `useRootRouteAccess` (`apps/mobile/src/navigation/root-route-access.ts`) enables one at a time, so login-on-start and the first-sync block are enforced by the navigator without unmounting it; see `navigation-contract.md` "Router baseline"
  - tab roots live inside the `(tabs)` route group (`apps/mobile/app/(tabs)/_layout.tsx`) with `headerShown: false`; the root stack registers the `(tabs)` group itself plus the `sign-in` and `sync-setup` screens and the detail screens (`exercise-history`, `sessions`, `profile`, `connected-agents`, `maestro-harness`, `completed-session/[sessionId]`, the M22 `group/mine`, `group/[groupId]/index`, `group-session/[memberId]/[sessionId]`, the M25 `exercise-link`, the `gyms` screen, and the header-less redesign screens `session/[sessionId]/index` (session view) and `session/[sessionId]/exercise/[sessionExerciseId]` (exercise page), and `session/[sessionId]/compare` with the native header `Session vs history`)
  - the root stack gives every detail screen the native minimal back-button
    display mode (no custom back title), preserving normal platform back
    behavior while hiding the previous route-group title; the arrow-only
    button slides in with the screen instead of morphing a label in
  - completed-session route sets its title inside the route file; all presentations hide the native header and draw their own top bar
  - exercise-history route also sets its title inside the route file (resolved exercise name)

2. `apps/mobile/app/(tabs)/_layout.tsx`
- Purpose:
  - tab group layout that owns the canonical roots (`today`, `train`,
    `progress`, `more`) plus preserved legacy roots (`stats-history`,
    `exercise-catalog`, `groups`, `settings`)
- Notes:
  - all tab roots have `headerShown: false`
  - the system tab bar is supplied via `tabBar`: `BottomTray` wraps exactly four
    `MainTabs` destinations and exposes a drag handle to collapse to a peek
    strip. Preserved roots are registered with `href: null`, resolve to their
    canonical owner, and remain directly addressable. Screens can
    imperatively expand/collapse via `useTrayVisibility()`; initial state is
    `expanded`. Snap math is unit-tested in
    `apps/mobile/src/navigation/tray-snap.ts`.

## Documentation boundary

- Keep this doc brief and route-oriented.
- Do not duplicate detailed section breakdowns, component trees, or render logic from route files.
- If route purpose or screen-level state set changes materially, update this doc in the same task.


### Optional bodyweight calculation overlays

Settings adds a private `Bodyweight calculations` On/Off control and a separate,
always-visible `Body weight log` row. While calculations are enabled, the personal exercise editor adds only
`Bodyweight contribution (%)`. The session/exercise routes keep ordinary kg
Weight, 1RM and Volume labels and never show bodyweight context or entry actions.
These are overlays on existing routes, not additional destinations.

## Optional group bodyweight calculations

Group settings adds an admin-only `Bodyweight calculations` toggle. While
enabled, add/edit group exercise shows only the group's independent
`Bodyweight contribution (%)`. Expected-revision conflicts retain edits; linking
never changes personal settings or contribution.

Group Volume/1RM boards and podiums show explicit `kg·reps`/`kg` or
`%BW·reps`/`%BW` units. Record detail and history retain public witness state and
original units; normalized sessions omit raw/absolute loads and all session
aggregate volume. Rebuilding, archived, offline and generic unavailable/ended
states retain the group recipes. Group Settings reviews effective switches;
c=0 switches do not promise a rebuild. [Accepted target](design-targets/group-competitions.md).
