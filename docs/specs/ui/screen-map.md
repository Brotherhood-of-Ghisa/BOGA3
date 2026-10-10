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
| `/today` | Landing page: how this week and month are going, the latest session, and one joined group's week — each linking to its full screen. Starts and resumes nothing | `(tabs)/today.tsx`, `components/today/`, `apps/mobile/src/progress-summary/` |
| `/train` | The single entry surface for starting a personal workout (and, when it ships, planning it) | `(tabs)/train.tsx` |
| `/progress` | One frozen row of filter chips — breakdown, period, and the metric where the table has one to pick — over a frozen exercise search; breakdown and metric are remembered on the device, the period opens on Settings' ([[comparison.window]]), and `breakdown` / `period` override on entry, including a link that changes them on a mounted Progress; comparisons with one row contribution accordion; a muscle or exercise name pushes `/progress-history`; Sessions last in either scrolling body | `(tabs)/progress.tsx` |
| `/more` | Hub for secondary capabilities, so the tab bar stays at four: Community, Tools, Library & account | `(tabs)/more.tsx` |

### Preserved tab roots

Registered with `href: null`: not visible in the bar, still directly
addressable, each resolving to a canonical owner for tab selection.

| Route | What it is for | File |
| --- | --- | --- |
| `/stats-history` | Compatibility path for `/progress` — a re-export, not a second implementation. `period=7`, `breakdown=exercise` | `(tabs)/stats-history.tsx` |
| `/exercise-catalog` | Exercise catalogue management: create / edit / soft-delete / undelete, load-entry mode, muscle mappings. Also the picker's `Manage` target | `(tabs)/exercise-catalog.tsx` |
| `/groups` | One group at a time (chips, no `All`; none with one group): a newest-first `Stream` of sessions, records and membership events (a record card shows its set with the set's one certification status, then its values; it opens a sheet: the set with its status and one Certify, each value, the group's previous #1 per board, `Session`, `Leaderboard`), or `Leaderboards` podiums under an exercise-name search | `(tabs)/groups.tsx`, `components/groups/` |
| `/settings` | Account, AI coaching, preferences, sync status, About, and dev-only tools in one support surface | `(tabs)/settings.tsx` |

## Sessions

| Route | What it is for | File |
| --- | --- | --- |
| `/session/[sessionId]` | The session view: the active session, read-only and navigational (summary card, one card per exercise, `Finish`). Also the completed-session editor, with editable Start/End | `session/[sessionId]/index.tsx`, `components/session-view/` |
| `/session/[sessionId]/exercise/[sessionExerciseId]` | One exercise of that session: records panel, ordered set list with the in-place logger, `Complete exercise` | `session/[sessionId]/exercise/[sessionExerciseId].tsx`, `components/exercise-page/`, `apps/mobile/src/session-recorder/` |
| `/session/[sessionId]/add-exercise` | Exercise picker (iOS page sheet): the catalogue browser in select mode, group exercises, inline create | `session/[sessionId]/add-exercise.tsx`, `components/session-recorder/exercise-picker.tsx` |
| `/session/[sessionId]/compare` | Session vs history: the open session's exercise / muscle volume against earlier completed history, off the session view so logging stays uncluttered | `session/[sessionId]/compare.tsx` |
| `/sessions` | The planning hub: **Active** (the live session's row), **Upcoming** (scheduled one-off plans, soonest first), **Unscheduled** (standalone plans, most recently updated first) and the **Completed** history in the calendar weeks of [[comparison.window]], newest first, each with its own states, in one virtualized list; `?week=` / `?day=` open it at that week or day, scrolled only — nothing filtered; the header ⋮ holds `Show deleted sessions`; the quiet `Plan session` action is the hub's persistent entry and the empty planning sections' inline action. Plans never affect the completed history's count, filters or row actions | `sessions.tsx`, `components/session-planner/plan-sections.tsx` |
| `/session-plan/new` | The shared plan editor: title, optional schedule (`YYYY-MM-DD HH:mm`, blank = unscheduled) and gym, ordered exercise blocks with ordered target sets, inline field-addressable validation. `?edit=<planId>` edits that plan in place (its guarded sync refuses to touch a consumed block, writing nothing); `?from=<planId>` prefills a duplicate and Save creates a new plan | `session-plan/new.tsx`, `components/session-planner/plan-form-screen.tsx` |
| `/session-plan/[planId]` | One plan: targets, derived progress, provenance; **Start all** (an active-session conflict offers one Resume and creates nothing), per-block **Add to session** (several compatible cards offer a choice sheet that writes nothing until one is picked), **Skip without doing it** on pending blocks, **Duplicate**, and confirmed **Delete** while no block pins the plan. Consumed blocks are read-only and link to their performed session | `session-plan/[planId].tsx` |
| `/completed-session/[sessionId]` | View Session: a finished session, read-only (`Summary` \| `Sets`), with `Edit` and delete/undelete. `presentation=completion` instead draws the post-Finish summary: results, then context, then the two-page breakdown, then record cards, volume vs median, Share | `completed-session/[sessionId].tsx`, `components/view-session/`, `components/session-complete/`, `components/session-detail/` |
| `/exercise-history` | One `exercise_definitions` row's history: period and tag filters, all-time bests, one card per session | `exercise-history.tsx` |
| `/progress-history` | One muscle's or one exercise's effort history, titled by that subject: the view (Timeline \| Grid \| Weekly) and metric selectors in one row, then the saved view (the Timeline plots one value per Monday week, oldest left, with a readout above it), with its own loading / error+Retry / empty states; a Grid or Weekly training day or week opens its sessions; a rest day is not a button. Native back returns to Progress as it was left | `progress-history.tsx`, `components/stats/history-view.tsx` |

## Account, library and tools

| Route | What it is for | File |
| --- | --- | --- |
| `/profile` | Auth-aware account route: signed-out credentials, signed-in username / email / password management, sign-out | `profile.tsx` |
| `/connected-agents` | Signed-in review and revocation of OAuth grants held by external coaching agents | `connected-agents.tsx` |
| `/theme-colour` | Custom theme hue: ring, live preview, `Use this colour` | `theme-colour.tsx`, `components/appearance/` |
| `/body-weight` | Private dated kg readings and their history | `body-weight.tsx`, `components/bodyweight/` |
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
| `/dev-logs` | In-app recent-log viewer, reached from More only under `isDevMode()` | `dev-logs.tsx` |
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
  header and draw their own top bar.

## Screen rules a route file will not tell you

- **Train never offers Resume.** A workout in progress is *opened*: the Train
  tab goes to it (`mainTabDestination`), and `/train` reached another way
  replaces itself with it. There is no Resume button anywhere.
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
- A friend's session shows **no record band** (their history is not on this
  device) and no edit / delete / append; its normalized exercise cards omit raw
  load and derived absolute metrics while ordinary cards keep permitted kg.
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
  sheet runs one foreground lookup (1.5 s budget) and offers a single confident
  match as `Nearby · <gym>`, never preselected.
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
- `Body weight log` sits on Settings regardless of the bodyweight-calculation
  preference, and no session, detail or logger surface shows or links to a
  reading.

## Overlays on existing routes (not destinations)

- **Personal bodyweight calculations** (Settings On/Off): while enabled, the
  personal exercise editor adds only `Bodyweight contribution (%)`. Session and
  exercise routes keep ordinary kg Weight / 1RM / Volume labels and never show
  bodyweight context or entry actions. Reading or deletion changes recalculate
  affected projections silently.
- **Group bodyweight calculations** (admin-only group toggle): while enabled,
  add/edit group exercise shows only the group's own independent
  `Bodyweight contribution (%)`; linking never changes personal settings or
  contribution, and expected-revision conflicts retain edits. Group Volume/1RM
  boards and podiums then show explicit `kg·reps` / `kg` or `%BW·reps` / `%BW`
  units; record detail and history retain public witness state and original
  units, and normalized sessions omit raw loads and all session aggregate
  volume. See `docs/specs/tech/group-competition-contract.md`.
