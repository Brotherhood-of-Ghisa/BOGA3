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

## Tabs (the four canonical destinations)

The production shell is `apps/mobile/src/navigation/main-tabs.ts`; `MainTabBar`
draws the same fixed bar on every screen that shows tabs.

| Route | What it is for | File |
| --- | --- | --- |
| `/today` | Landing page: how this week and the current fixed period ([[comparison.window]]) are going, the latest session, and one joined group's week — each linking to its full screen. Starts and resumes nothing | `(tabs)/today.tsx`, `components/today/`, `apps/mobile/src/progress-summary/` |
| `/train` | The single entry surface for starting a personal workout (and, when it ships, planning it) | `(tabs)/train.tsx` |
| `/progress` | Frozen breakdown / period / metric chips over table search and a Filters button, whose sheet holds the family-grouping switch, `Count secondary sets` ([[muscle.secondary-filter]]) and the gym's radio rows — each only where the view uses it; both breakdowns use Settings' saved layout ([[muscle.progress-layout]]) and [[comparison.change-display]]. Exercise sorts Now / Prev / Change / recency; Muscle pairs periods under `Now` (Sets `12 (10)`) and sorts name / Now / Change, within fixed family sections or globally with grouping off. Search matches Exercise names/primary muscles or Muscle names/families. Each breakdown retains its own search, grouping and sort for the visit. Exercise 3D scopes the list to the tapped muscle, with aligned Primary effort / Secondary effort sections; 1RM uses List. Muscle List places compact Sets/Volume tickers beside names ([[comparison.muscle-ticker-extent]]); names open history and chevrons disclose contributors; 3D reveals effort-grouped contributors and Timeline / Grid / Weekly links. Table history and contributor links carry the chosen gym and metric; 3D muscle contributors open all-gym exercise Timeline. Visits open on Settings' defaults ([[comparison.window]]); choices last the visit, a changed default replaces one; `breakdown` / `period` links override on entry or change. Sessions remains last | `(tabs)/progress.tsx` |
| `/more` | Hub for secondary capabilities, so the tab bar stays at four. Two untitled cards: Groups, Exercises, Gyms; then Connect an AI (names the connected agents and opens `/connected-agents`; with none, or signed out, opens the setup instructions in the browser) and Settings | `(tabs)/more.tsx` |

### Preserved tab roots

Registered with `href: null`: not visible in the bar, still directly
addressable, each resolving to a canonical owner for tab selection.

| Route | What it is for | File |
| --- | --- | --- |
| `/stats-history` | Compatibility path for `/progress` — a re-export, not a second implementation. `period=7`, `breakdown=exercise` | `(tabs)/stats-history.tsx` |
| `/exercise-catalog` | Exercise catalogue management: create / edit / soft-delete / undelete, load-entry mode, muscle mappings in the user's muscles ([[muscle.no-breakdown]]); a gym pill scopes the row stats. A one-line title bar (back, `Exercises`, ⋮ for Manage), then search beside a labelled `Add`. Also the picker's `Manage` target | `(tabs)/exercise-catalog.tsx` |
| `/groups` | One group at a time (chips, no `All`; none with one group): a newest-first `Stream` of sessions, records and membership events (a record card shows its set with the set's one certification status, then its values; it opens a sheet: the set with its status and one Certify, each value, the group's previous #1 per board, `Session`, `Leaderboard`), or `Leaderboards` podiums under an exercise-name search | `(tabs)/groups.tsx`, `components/groups/` |
| `/settings` | One card per destination (icon, label, current value): Account, Appearance (sheet), Bodyweight, Rest timer, Notifications (scrollable sheet), Progress, Effort, Developer tools, Data & sync, Other; About last, not pressable. The rest live on sub pages | `(tabs)/settings.tsx`, `components/settings/` |

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
| `/exercise-history` | One `exercise_definitions` row's history, from exercise Progress's ⋮ and the exercise page's ⋮: period and tag filters, a gym button in the header (`gymId` opens on a gym), all-time bests, one card per session with the records it took | `exercise-history.tsx` |
| `/progress-history` | One muscle's or one exercise's effort history, titled by that subject and opened on Progress's metric, gym and secondary sets: optional `view=timeline\|daily\|weekly` overrides entry without saving; one row holds the view (Timeline \| Grid \| Weekly) selector, a metric chip stepping to the next metric on a tap, and the gym button — on a muscle, a Filters button holding the gym and [[muscle.secondary-filter]] — then the saved view, with loading / error+Retry / empty states; a Grid or Weekly training day or week opens its sessions; a rest day is not a button. The Timeline plots one value per Monday week, oldest left, and always focuses one — the selected week, else the newest — which its readout names between previous / next arrows; the header ⋮ opens that week's sessions and, on an exercise, History, RM curve (live only) and each muscle's history; with no action (a muscle's rest week) there is no ⋮. Under it, one card per exercise block opens its session; on a muscle's page, each card's progress button opens that exercise's history at the chosen gym. Native back preserves the originating screen | `progress-history.tsx`, `components/stats/history-view.tsx` |
| `/rm-curve` | Selected-exercise analytics, titled by the exercise with `RM curve` on the chart; uses `components/rm-curve/` and [[1rm.curve-scope]]. History Options opens it; Back preserves History. Missing/deleted targets remain unavailable with Back | `rm-curve.tsx` |

## Account, library and tools

| Route | What it is for | File |
| --- | --- | --- |
| `/profile` | Auth-aware account route: signed-out credentials, signed-in username / email / password management, sign-out | `profile.tsx` |
| `/connected-agents` | Signed-in review and revocation of OAuth grants, plus the per-coach **Allow this coach to make changes** permission (default off) | `connected-agents.tsx` |
| `/theme-colour` | Custom theme hue: ring, live preview, `Use this colour` | `theme-colour.tsx`, `components/appearance/` |
| `/body-weight` | Settings → Bodyweight: the `Bodyweight calculations` On/Off, then private dated kg readings and their history | `body-weight.tsx`, `components/bodyweight/` |
| `/settings-rest-timer`, `/settings-progress`, `/settings-effort`, `/settings-other`, `/settings-data-sync`, `/settings-developer-tools` | Settings' sub pages: rest timer; Progress defaults, view, targets, periods and Muscles ([[muscle.progress-layout]], [[muscle.report-groups]]); the effort table; date format, past-records gym filter, Today layout; the sync status and Backups cards; the Developer mode switch, then dev-only tools and logs | `settings-*.tsx`, `components/settings/` |
| `/gyms` | Manage the gyms a session can be at, and their private locations | `gyms.tsx`, `components/gyms/` |
| `/exercise-link` | Link one of my exercises to my groups' exercises, or unlink it | `exercise-link.tsx` |

## Groups

| Route | What it is for | File |
| --- | --- | --- |
| `/group/mine` | My groups: active memberships, `Join group` / `Create group` — the way into a group's management page | `group/mine.tsx` |
| `/group/new` | Create a group (inline username gate first when the username is blank) | `group/new.tsx` |
| `/group/join` | Join by code: code field, preview card, `Join group` | `group/join.tsx` |
| `/group/[groupId]` | The group screen, for *managing* the group: header, owner/admin Invite + Edit, and the group's exercises with link / unlink. Stream and leaderboards live on `/groups` | `group/[groupId]/index.tsx` |
| `/group/[groupId]/members` | The member list behind the header's member count, with role actions and `Leave group` | `group/[groupId]/members.tsx` |
| `/group/[groupId]/edit` | Owner/admin edit of name and description | `group/[groupId]/edit.tsx` |
| `/group/[groupId]/invite` | Owner/admin invite: the code, its `boga3://` link, Share, Regenerate | `group/[groupId]/invite.tsx` |
| `/group/[groupId]/exercises/new` | Owner/admin add a group exercise, `From catalogue` or `Custom` | `group/[groupId]/exercises/new.tsx` |
| `/group/[groupId]/exercises/[exerciseId]/edit` | Owner/admin rename a group exercise or change its weight entry | `group/[groupId]/exercises/[exerciseId]/edit.tsx` |
| `/group/[groupId]/leaderboards/[exerciseId]` | A group exercise's full board: `Volume` \| `1RM` × `Certified` \| `All`, ranked rows, row detail sheet with certification actions | `group/[groupId]/leaderboards/[exerciseId]/index.tsx` |
| `/group/[groupId]/leaderboards/[exerciseId]/history` | That board's lead changes under the current rules, newest first, below one row of tap-to-cycle filters: metric, `Certified` \| `All`, `History` \| `Scores` | `group/[groupId]/leaderboards/[exerciseId]/history.tsx` |
| `/group-session/[memberId]/[sessionId]` | A member's shared session as the group sees it, drawn with View Session's cards, View Session's facts card (an `In progress` mark while it runs), its #1 group 1RM records (row → leaderboard); my own adds a full-session action | `group-session/[memberId]/[sessionId].tsx` |

## Dev-only routes

| Route | What it is for | File |
| --- | --- | --- |
| `/dev-logs` | In-app recent-log viewer, reached from Settings → Developer tools only under `isDevMode()` | `dev-logs.tsx` |
| `/maestro-harness` | Test harness: fixtures, resets, gate actions, teleports. Self-gated | `maestro-harness.tsx` |

## Shells (not user-facing screens)

- `_layout.tsx` — local data bootstrap on mount, plus the restore guard
  (`components/navigation/auth-route-guard.tsx`) and the root stack
  (`components/navigation/root-stack.tsx`).
- `(tabs)/_layout.tsx` — the tab group: every tab root has
  `headerShown: false`, and the bar is supplied via `tabBar: MainTabBar`.

## Reachability rules

- The root stack declares every root route under **one `Stack.Protected` group
  per access level** — `sign-in`, `sync-setup`, `app` — and
  `apps/mobile/src/navigation/root-route-access.ts` enables exactly one at a
  time. Login-on-start and the first-sync block are therefore enforced by the
  navigator, which is never unmounted to gate access (on expo-router 57
  unmounting it reverts the route, so a gate rendered in its place loops).
- `/sign-in` stays reachable at the `app` level so an auth-unconfigured build
  can show its disabled credential path when opened directly.
- Every root route file must be declared in the root stack; an undeclared one
  is appended outside every `Protected` group. `/maestro-harness` is declared
  last and the router must never land on it.
- `/sync-setup` **renders through** for a signed-out or auth-unconfigured app,
  so it never traps a build that can have no session; `/sign-in` is exempt from
  its redirect so the two cannot loop. It redirects to `/sign-in` with no Retry
  when the latest cycle outcome is `AUTH_REQUIRED`.
- Detail screens use the native **minimal** back-button display mode (arrow,
  no text label), which also keeps the internal `(tabs)` group name off screen.
- Screens whose header title is the name of a thing (`exercise-history`,
  `exercise-link`, `progress-history`, `group/[groupId]`, a leaderboard) set
  that title inside the route file once the entity resolves; session-view, exercise-page, the
  exercise picker and every `completed-session` presentation hide the native
  header and draw their own top bar; `/settings` and `/exercise-catalog` keep
  the tab bar, so draw `TitleBar` (back, title, ⋮).

## Screen rules a route file will not tell you

- **Train never offers Resume.** A workout in progress is *opened*: the Train
  tab goes to it (`mainTabDestination`), and `/train` reached another way
  replaces itself with it.
- Session-view and exercise-page edits **autosave losslessly** (every row
  kept); only `Finish` / `Done` drop unconfirmed rows (`../05-data-model.md`).
  Both run the shared cleanup prompts, and invalid set values block them.
- A completed session's records compare against **the completed sessions
  before it** — never itself, never later ones.
- The exercise page is reachable only from the session view (plus the Maestro
  teleport); with no screen to go back to, back goes to `/train`.
- `presentation=completion` does **not** link to muscle analytics, its share
  image excludes gym and location, and optional historical enrichment can
  never block it.
- A friend's session is read-only, with group #1 bands ([[set.row-figures]])
  and normalized rows under [[groups.normalized-set-display]]; ordinary cards
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
  (`design-language.md`, "Choosing one"); meanwhile its checked sheet row reads
  `Next launch`, and a saved custom colour's button `Saved · next launch`. No
  sentence explains the restart ([[copy.no-inline-explanation]]).
- The body weight log is reachable from Settings' Bodyweight card regardless
  of the bodyweight-calculation preference, and no session, detail or logger surface shows or links to a
  reading.

## Overlays on existing routes (not destinations)

- **Personal bodyweight calculations** (Settings On/Off): while enabled, the
  personal exercise editor adds only `Bodyweight contribution (%)`. Session and
  exercise routes keep ordinary Weight / 1RM / Volume labels ([[copy.no-weight-unit]]) and never show
  bodyweight context or entry actions. Reading or deletion changes recalculate
  affected projections silently.
- **Group bodyweight calculations** (admin-only group toggle): while enabled,
  add/edit group exercise shows only the group's own independent
  `Bodyweight contribution (%)`; linking never changes personal settings or
  contribution, and expected-revision conflicts retain edits. Group Volume/1RM
  boards and podiums follow [[copy.no-weight-unit]]; record detail and history
  retain public witness state and original wire units. Normalized rows follow
  [[groups.normalized-set-display]]. See `docs/specs/tech/group-competition-contract.md`.

The session and exercise timer strips expand their repeating readout fullscreen
(`components/session-recorder/repeating-timer-focus.tsx`). Close, Back and
accessibility escape collapse without changing the timer; the strip’s dismiss
control remains separate. Phase sits above the countdown-only ring, followed by
interval controls, a wide Pause/Resume action and bottom Reset. Both presentations
share the store and [[timer.repeating-cues]] / [[timer.foreground-awake]].
This is in-route state, not a new route.
