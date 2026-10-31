# Screen Map (Authoritative Current UI)

What screens exist, what each one is for, and which are reachable at all. Load
this when you add, remove, rename or repurpose a route. Paths, params and
transitions: `navigation-contract.md`. Visual language: `design-language.md`.
Render logic: the route file.

Routes are `expo-router` file routes under `apps/mobile/app/`; the file column
below is relative to that directory. Components live beside the route, under
`apps/mobile/components/`.

## Entry and gates

| Route | What it is for | File |
| --- | --- | --- |
| `/` | Redirect to `/today`. No UI of its own | `index.tsx` |
| `/sign-in` | Email/password entry. The *only* route while auth is configured and there is no session | `sign-in.tsx` |
| `/sync-setup` | First-sync waiting room ("Setting up your data…"): phase label, advancing activity indicator, offline message, one Retry. The *only* route until the user's data is restored | `sync-setup.tsx` (screen in `apps/mobile/src/sync/SyncGate.tsx`) |

## Tabs (the five canonical destinations)

The production shell is `apps/mobile/src/navigation/main-tabs.ts`; `MainTabBar`
draws the same fixed bar on every screen that shows tabs.

| Route | What it is for | File |
| --- | --- | --- |
| `/today` | Landing page: You (this week, N-week period, a session's exercises), Plan (muscles' last three days, today and week against targets; week's plans; `Sessions` opens Sessions), Groups (current CoW exercise/metrics, last week’s winners, unchanged week board and sessions). Swiped cards: Plan first, opens on You. Starts nothing | `(tabs)/today.tsx`, `components/today/`, `src/progress-summary/`, `src/today-plan/` |
| `/train` | The single entry surface for starting a personal workout | `(tabs)/train.tsx` |
| `/progress` | Frozen breakdown / period / metric chips over table search and a Filters button, whose sheet holds the family-grouping switch, `Count secondary sets` ([[muscle.secondary-filter]]) and the gym's radio rows — each only where the view uses it; Muscle uses Settings' saved layout (`List`/`3D`, default `List`), Exercise always uses its full exercise list; both follow [[comparison.change-display]]. Exercise sorts Now / Prev / Change / recency; Muscle sorts name / Now / Prev / Change, within fixed family sections or globally with grouping off. Search matches Exercise names/primary muscles or Muscle names/families. Each breakdown retains its own search, grouping and sort for the visit. Exercise opens on its configured metric (Sets by default), with 1RM available explicitly. Muscle List uses the Exercise table’s separate columns and responsive rows; names open history and chevrons disclose contributors; 3D reveals effort-grouped contributors and Timeline / Grid / Weekly links. Table history and contributor links carry the chosen gym and metric; 3D muscle contributors open all-gym exercise Timeline. Visits open on Settings' defaults ([[comparison.window]]); choices last the visit, a changed default replaces one; `breakdown` / `period` links override on entry or change. Sessions remains last | `(tabs)/progress.tsx` |
| `/more` | Secondary hub, the bar's ⋮. Two untitled cards: Exercises, Gyms; then Connect an AI (names the connected agents and opens `/connected-agents`; with none, or signed out, opens the setup instructions in the browser) and Settings | `(tabs)/more.tsx` |

### Preserved tab root and tab-owned pages

`/stats-history` stays a hidden tab. The rest are root-stack pages keeping
the tab bar (`TabOwnedPage`): `/groups` is the Groups tab; More owns the rest.

| Route | What it is for | File |
| --- | --- | --- |
| `/stats-history` | Compatibility path for `/progress` — a re-export, not a second implementation. `period=7`, `breakdown=exercise` | `(tabs)/stats-history.tsx` |
| `/exercise-catalog` | Catalogue create/edit/delete/restore; ⋮ `Merge into…` above Delete: picker → native confirmation → refreshed catalogue; failures retain Retry. Gym-scoped stats; linked rows marked; shared browser ([[muscle.no-breakdown]]) | `exercise-catalog.tsx` |
| `/groups` | One group, titled (and switched) by name, a settings icon; swiped pages, opening mid: `Stream` of sessions, records, membership and CoW lifecycle events (a record card shows its set and certification status, then values; its sheet: the set, one Certify, each value, the previous #1 per board, `Session`, `Leaderboard`); `At a glance` (pinned stepper, metric; stats, top five, rank chart); `Leaderboards` (All podiums, search, order); `CoWs` (current, next and past challenges) | `groups.tsx`, `components/groups/` |
| `/settings` | One grouped list: Account; Training (Rest timer, Bodyweight, Muscles, Effort, Progress); App (Appearance, Notifications, Data & sync, Everything else); About, last, read-only. Each row shows its current setting and opens a page | `settings.tsx`, `components/settings/` |

## Sessions

| Route | What it is for | File |
| --- | --- | --- |
| `/session/[sessionId]` | The session view: the active session, read-only and navigational (summary card, one card per exercise, `Finish`). Also the completed-session editor, with editable Start/End | `session/[sessionId]/index.tsx`, `components/session-view/` |
| `/session/[sessionId]/exercise/[sessionExerciseId]` | One exercise of that session: records panel, ordered set list with the in-place logger, `Complete exercise` | `session/[sessionId]/exercise/[sessionExerciseId].tsx`, `components/exercise-page/`, `apps/mobile/src/session-recorder/` |
| `/session/[sessionId]/add-exercise` | Exercise picker (iOS page sheet): the catalogue browser in select mode, group exercises, inline create | `session/[sessionId]/add-exercise.tsx`, `components/session-recorder/exercise-picker.tsx` |
| `/session/[sessionId]/compare` | Session vs history: the open session's exercise / muscle volume against earlier completed history, off the session view so logging stays uncluttered | `session/[sessionId]/compare.tsx` |
| `/sessions` | The planning hub: **Active** (the live session's row), **Upcoming** (scheduled one-off plans, soonest first), **Unscheduled** (standalone plans and multi-session training programmes, most recently updated first) and the **Completed** history in the calendar weeks of [[comparison.window]], newest first, each with its own states, in one virtualized list; `?week=` / `?day=` open it at that week or day, scrolled only — nothing filtered; the header ⋮ holds `Show deleted sessions`; the quiet `Plan session` and `New programme` actions are the hub's persistent entries and the empty planning sections' inline action. Plans never affect the completed history's count, filters or row actions | `sessions.tsx`, `components/session-planner/plan-sections.tsx` |
| `/session-plan/new` | The shared plan editor: title, optional schedule (native date/time picker, cleared = unscheduled) and gym, ordered exercise blocks with ordered target sets, inline field-addressable validation. Add set(s) asks how many exact copies of the last target to append. `?edit=<planId>` edits that plan in place (its guarded sync refuses to touch a consumed block, writing nothing); `?from=<planId>` prefills a duplicate and Save creates a new plan | `session-plan/new.tsx`, `components/session-planner/plan-form-screen.tsx` |
| `/session-plan/[planId]` | One plan: targets, derived progress, provenance; **Start all** (an active-session conflict offers one Resume and creates nothing), per-block **Add to session** (several compatible cards offer a choice sheet that writes nothing until one is picked), **Skip without doing it** on pending blocks, **Duplicate**, and confirmed **Delete** while no block pins the plan. Consumed blocks are read-only and link to their performed session | `session-plan/[planId].tsx` |
| `/programme/new` | Multi-session training programme editor: name, description, ordered child sessions list with reorder/duplicate/remove controls, focused sub-sheet for editing child sessions including count-only Add set(s), atomic transactional save. `?edit=<programmeId>` edits the programme in place; `?from=<programmeId>` prefills a duplicate | `programme/new.tsx`, `components/session-planner/programme-form-screen.tsx` |
| `/programme/[programmeId]` | Training programme detail: programme metadata, status badge, next unresolved block card (in programme then exercise order) with "Add to session" and "Skip", ordered list of child plans linking to `/session-plan/[planId]` with accessible reordering, duplicate, and contract-defined delete (detaches child plans as standalone plans without deleting workouts) | `programme/[programmeId].tsx`, `components/session-planner/use-programme-detail.ts` |
| `/completed-session/[sessionId]` | View Session: a finished session, read-only (`Summary` \| `Sets`), with `Edit` and delete/undelete. `presentation=completion` instead draws the post-Finish summary: results, then context, then the two-page breakdown, then record cards, volume vs median, Share | `completed-session/[sessionId].tsx`, `components/view-session/`, `components/session-complete/`, `components/session-detail/` |
| `/exercise-history` | Exercise history from catalogue / exercise Progress / exercise page actions: period and tag filters, header gym picker, all-time bests, session cards with records. History's footer appends below an Older sessions divider ([[comparison.allowed-periods]]); selecting a period resets expansion | `exercise-history.tsx` |
| `/progress-history` | One muscle's or one exercise's effort history, titled by that subject (a muscle's title switches muscle) and opened on Progress's metric, gym and secondary sets: optional `view=timeline\|daily\|weekly` overrides entry without saving; one row holds the view (Timeline \| Grid \| Weekly) selector, a metric chip stepping to the next metric on a tap, and the gym button — on a muscle, also a `Sec` / `Pri` chip ([[muscle.secondary-filter]]) — then the saved view, with loading / error+Retry / empty states; a Grid or Weekly training day or week opens its sessions. The Timeline plots one value per Monday week, oldest left, and always focuses one — the selected week, else the newest — which its readout names between previous / next arrows; the header ⋮ opens that week's sessions and, on an exercise, History, RM curve (live only) and each muscle's history; with no action there is no ⋮. Under it, one card per exercise block, newest first, opens its session; its header carries the day (an exercise's: the gym); on a muscle's, a disc marks primary or secondary work and a progress button opens the exercise's history. Reloads keep the last chart. | `progress-history.tsx`, `components/stats/history-view.tsx` |
| `/rm-curve` | Selected-exercise analytics, titled by the exercise with `RM curve` on the chart; uses `components/rm-curve/`. History Options opens it; Back preserves History. Missing/deleted targets remain unavailable with Back | `rm-curve.tsx` |

## Account, library and tools

| Route | What it is for | File |
| --- | --- | --- |
| `/profile` | Auth-aware account route: signed-out credentials, signed-in username / email / password management, sign-out | `profile.tsx` |
| `/connected-agents` | Signed-in review and revocation of OAuth grants, plus the per-coach **Allow this coach to make changes** permission (default off) | `connected-agents.tsx` |
| `/theme-colour` | Custom theme hue: ring, live preview; saves on release, then `Saved · next launch` | `theme-colour.tsx`, `components/appearance/` |
| `/body-weight` | Settings → Bodyweight: the `Bodyweight calculations` On/Off, then private dated kg readings and their history | `body-weight.tsx`, `components/bodyweight/` |
| `/settings-appearance`, `/settings-notifications` | Appearance: Theme radio rows with swatches, `Custom colour` (to `/theme-colour`), footnote `Applies next launch`. Notifications: one switch (state as description) or `Open iOS Settings` / `Sign in`; Categories while on; one Notice with Retry | `settings-*.tsx`, `components/appearance/`, `components/notifications/` |
| `/settings-rest-timer`, `/settings-progress`, `/settings-effort`, `/settings-data-sync`, `/settings-review-changes`, `/settings-everything-else` | Settings' sub pages: rest timer; Progress (Opens on, Display, Periods, Counting); Effort (Display, Working set, Volume checks); Data & sync (Sync status, Backups) and its Review changes; Everything else: Display (date format), Records (gym filter), Experiments (title-bar timer), Developer (mode; dev-only tools) | `settings-*.tsx`, `components/settings/` |
| `/settings-muscles`, `/settings-muscle-targets`, `/settings-enabled-muscles` | Muscles' Weekly targets and Muscle breakdown sections link to full target/enablement pages; a blank target shows and uses the default ([[muscle.weekly-targets]], [[muscle.report-groups]]). Native Back; loading, retryable errors, empty targets | `settings-*.tsx`, `components/preferences/muscle-settings.tsx` |
| `/gyms` | Manage the gyms a session can be at, and their private locations | `gyms.tsx`, `components/gyms/` |
| `/exercise-edit` | The exercise editor; Primary and Secondary use the same multi-select sheet, with at least one Primary required; `?exerciseDefinitionId=` edits, else creates; `?request=` carries a caller's callbacks | `exercise-edit.tsx`, `components/exercise-catalog/exercise-editor-screen.tsx` |
| `/exercise-link` | Link one of my exercises to my groups' exercises, or unlink it | `exercise-link.tsx` |

## Groups

| Route | What it is for | File |
| --- | --- | --- |
| `/group/mine` | My groups: active memberships, `Join group` / `Create group` — the way into a group's management page | `group/mine.tsx` |
| `/group/new` | Create a group (inline username gate first when the username is blank) | `group/new.tsx` |
| `/group/join` | Join by code: code field, preview card, `Join group` | `group/join.tsx` |
| `/group/[groupId]` | The group screen, for *managing* the group: header, owner/admin Invite + Edit, CoW preview, and the group's exercises with link / unlink. Stream and leaderboards live on `/groups` | `group/[groupId]/index.tsx` |
| `/group/[groupId]/members` | The member list behind the header's member count, with role actions and `Leave group` | `group/[groupId]/members.tsx` |
| `/group/[groupId]/edit` | Owner/admin edit of name, description and group calendar time zone | `group/[groupId]/edit.tsx` |
| `/group/[groupId]/cows` | This week, next week and past CoWs; independent metric preview, online history and admin next-week entry | `group/[groupId]/cows/index.tsx` |
| `/group/[groupId]/cows/[cowId]` | Online full standings, server ranks/units and finality; metric switch replaces pages | `group/[groupId]/cows/[cowId].tsx` |
| `/group/[groupId]/cows/schedule` | Admin create/edit/cancel before start; fixed next week, active exercise picker, independent metric choices and uncertain-write recovery | `group/[groupId]/cows/schedule.tsx` |
| `/group/[groupId]/invite` | Owner/admin invite: the code, its `boga3://` link, Share, Regenerate | `group/[groupId]/invite.tsx` |
| `/group/[groupId]/exercises/new` | Owner/admin add a group exercise, `From catalogue` or `Custom` | `group/[groupId]/exercises/new.tsx` |
| `/group/[groupId]/exercises/[exerciseId]/edit` | Owner/admin rename a group exercise or change its weight entry | `group/[groupId]/exercises/[exerciseId]/edit.tsx` |
| `/group/[groupId]/leaderboards/[exerciseId]` | A group exercise's full board: `Volume` \| `1RM` × `Certified` \| `All`, ranked rows, row detail sheet with certification actions | `group/[groupId]/leaderboards/[exerciseId]/index.tsx` |
| `/group/[groupId]/leaderboards/[exerciseId]/history` | That board's lead changes under the current rules, newest first, below one row of tap-to-cycle filters: metric, `Certified` \| `All`, `History` \| `Scores` | `group/[groupId]/leaderboards/[exerciseId]/history.tsx` |
| `/group-session/[memberId]/[sessionId]` | A member's shared session as the group sees it, drawn with View Session's cards, View Session's facts card (an `In progress` mark while it runs), its #1 group 1RM records (row → leaderboard); my own adds a full-session action | `group-session/[memberId]/[sessionId].tsx` |

## Dev-only routes

| Route | What it is for | File |
| --- | --- | --- |
| `/dev-logs` | In-app recent-log viewer, reached from Settings → Everything else only under `isDevMode()` | `dev-logs.tsx` |
| `/maestro-harness` | Test harness: fixtures, resets, gate actions, teleports. Self-gated | `maestro-harness.tsx` |

## Shells (not user-facing screens)

- `_layout.tsx` — local data bootstrap on mount, plus the restore guard
  (`components/navigation/auth-route-guard.tsx`) and the root stack
  (`components/navigation/root-stack.tsx`).
- `(tabs)/_layout.tsx` — the tab group: every tab root has
  `headerShown: false`, and the bar is supplied via `tabBar: MainTabBar`.

## Reachability rules

- Detail screens use the native **minimal** back-button display mode (arrow,
  no text label), which also keeps the internal `(tabs)` group name off screen.
- Screens whose header title is the name of a thing (`exercise-history`,
  `exercise-edit`, `exercise-link`, `progress-history`, `group/[groupId]`, a leaderboard) set
  that title inside the route file once the entity resolves; session-view, exercise-page, the
  exercise picker and every `completed-session` presentation hide the native
  header and draw their own top bar; `/exercise-catalog`, `/groups` and
  `/settings` keep the tab bar, except the catalogue from a workout.

## Screen rules a route file will not tell you

- **Train never offers Resume.** A workout in progress is *opened*: the Train
  tab goes to it (`mainTabDestination`), and `/train` reached another way
  replaces itself with it.
- Session-view and exercise-page edits **autosave losslessly** (every row
  kept); only `Finish` / `Done` drop unconfirmed rows (`../05-data-model.md`).
  Both run the shared cleanup prompts, and invalid set values block them.
- A completed session's records compare against **the completed sessions
  before it** — never itself, never later ones.
- The exercise page opens from the session view, another exercise's title
  switcher (`replace`) or the Maestro teleport; with no history, back goes to `/train`.
- `presentation=completion` does **not** link to muscle analytics, its share
  image excludes gym and location, and optional historical enrichment can
  never block it.
- A friend's session is read-only, with group #1 bands ([[set.row-figures]])
  and normalized `%BW` rows; ordinary cards
  retain permitted load.
- Invite codes and leaderboard rows are read **online only, never cached**; the
  group stream and the podiums are cached and render offline behind the offline
  marker, never showing an earlier week as if it were this one.
- One personal exercise links to **at most one exercise per group**, and
  archived group exercises are never offered as link targets.
- Group exercise add / rename / archive is owner/admin only, and a member sees
  an explicit refusal ("You can't add exercises") rather than a missing screen.
  Losing access (`NOT_FOUND`) replaces the screen with "no longer a member" and
  hides the cached data.
- A gym's location is shown as **presence only** (`Location saved` /
  `No location saved`) — never coordinates, anywhere. The session view's gym
  sheet suggests located gyms within 1 km of any fix, nearest first, as
  `Nearby · <gym>`, never preselected.
- Network state is **three-valued**: until NetInfo reports a determined
  `isConnected`, the UI says `Checking…` (or stays on its in-progress state)
  and never claims online or offline. `/sync-setup` shows its offline copy only
  after `isConnected === false`, so a slow first report is not an outage.
- Deleted-exercise visibility is **catalogue-only**; the everyday browse
  filters (`Never-done`, `Sort`) are shared local preferences applied to every
  open browser at once.
- The date format and the past-records gym scope are **account-local to this
  device**: sign-out hides them, returning to the account restores them, and a
  database rebuild preserves them. Preference-storage failures surface in one
  place — Settings' Data & sync `Error` row, retried by its `Refresh` — so no
  preference control or exercise browser grows its own error box.
- An Appearance preset reads `<Preset> from next launch` until the app reopens
  (`design-language.md`, "Choosing one"); meanwhile its checked row reads
  `Next launch`.
- The body weight log is reachable from Settings' Bodyweight card regardless
  of the bodyweight-calculation preference, and no session, detail or logger surface shows or links to a
  reading.

## Overlays on existing routes (not destinations)

- **Personal bodyweight calculations** (Settings On/Off): while enabled, the
  exercise editor adds `Uses bodyweight` and its share. Session and
  exercise routes keep ordinary Weight / 1RM / Volume labels ([[copy.no-weight-unit]]) and never show
  bodyweight context or entry actions. Reading or deletion changes recalculate
  affected projections silently.
- **Group bodyweight calculations** (admin-only group toggle): while enabled,
  the group exercise form adds the group's own `Uses bodyweight` and share;
  linking never changes personal settings or
  contribution, and expected-revision conflicts retain edits. Group Volume/1RM
  boards and podiums follow [[copy.no-weight-unit]]; record detail and history
  retain public witness state and original wire units. Normalized rows follow
  `docs/specs/tech/group-competition-contract.md`.

The session and exercise timer strips expand their repeating readout fullscreen
(`components/session-recorder/repeating-timer-focus.tsx`). Close, Back and
accessibility escape collapse without changing the timer; the strip’s dismiss
control remains separate. Phase sits above the countdown-only ring, followed by
interval controls, a wide Pause/Resume action and bottom Reset. Both share
the store, its cues and its keep-awake.
In-route state, not a new route.
