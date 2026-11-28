# Screen Map (Authoritative Current UI)

Load when adding, removing, renaming or repurposing a route. Params and
transitions: `navigation-contract.md`; visual rules: `design-language.md`.

`expo-router` route files live under `apps/mobile/app/`; the file column is
relative to it. Rendering belongs there; components live under
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
| `/today` | Landing page: You (week, period, session; Sets/Tons control), Plan (Recovery [[comparison.allowed-periods]] with a counting chip in its header [[muscle.secondary-filter]]; targets/plans; `Planner` opens Planner), Groups (week board; CoW card: exercise and 1RM podium, `‹ ›` to last week; meet card: the live or nearest meet from 7 days before it starts to 7 days after it ends, with its state; sessions, each GR named, PRs counted). Plan first, initially You | `(tabs)/today.tsx`, `components/today/`, `src/progress-summary/`, `src/today-plan/` |
| `/train` | The single entry surface for starting a personal workout, and the workout in progress | `(tabs)/train.tsx` |
| `/progress` | Pinned breakdown/period/metric chips above search and Filters (family grouping, Sets/Volume primary-only switches [[muscle.secondary-filter]], gym radios where applicable). Muscle opens on Settings' layout (`List`/`3D`, default List). View (List, Patches, Wireframe) is per visit. Both breakdowns follow [[comparison.change-display]]. Exercise sorts Now / Prev / Change / recency; Muscle sorts name / Now / Prev / Change, by family or globally. Search matches exercises/primary muscles or muscles/families. Each breakdown retains search, grouping and sort per visit. Exercise opens on its configured metric (default Sets); 1RM is explicit. List names open history; hold selects muscles or exercises. Muscle chevrons disclose contributors. 3D supports muscle selection, orientation, framing and drag rotation. Table links carry gym and metric; 3D contributors open all-gym Timeline. Visits open on Settings' defaults ([[comparison.window]]); a changed default replaces its choice. `breakdown` / `period` links override on entry or change. Sessions remains last | `(tabs)/progress.tsx` |
| `/groups` | One group, under a tab header titled (and switched) by name, a settings icon; swiped pages, opening mid: `Stream` of sessions, records, membership, CoW and meet lifecycle events (a record card shows its set and certification status, then values; its sheet: the set, one Certify, each value, the previous #1 per board, `Session`, `Leaderboard`); `At a glance` (pinned stepper, metric; stats, top five, rank chart, latest sessions/GRs); `Leaderboards` (All podiums, search, order); `CoWs` (current, next and past challenges); `Meets` (upcoming, the Meets leaderboard: 🥇🥈🥉 counts, a row opens that member's trophies with links to their meets, past) | `(tabs)/groups.tsx`, `components/groups/` |
| `/more` | Secondary hub, the bar's ⋮. Two untitled cards: Exercises, Gyms, Notes; then Connect an AI (names the connected agents and opens `/connected-agents`; with none, or signed out, opens the setup instructions in the browser) and Settings | `(tabs)/more.tsx` |

### Preserved tab root and More's tab-owned pages

`/stats-history` stays a hidden tab. The rest are root-stack pages keeping
the tab bar (`TabOwnedPage`), owned by More.

| Route | What it is for | File |
| --- | --- | --- |
| `/stats-history` | Compatibility path for `/progress` — a re-export, not a second implementation. `period=7`, `breakdown=exercise` | `(tabs)/stats-history.tsx` |
| `/exercise-catalog` | Catalogue create/edit/delete/restore; ⋮ `Merge into…` above Delete: picker → native confirmation → refreshed catalogue; failures retain Retry. Gym-scoped stats; linked rows marked; shared browser ([[muscle.no-breakdown]]) | `exercise-catalog.tsx` |
| `/notes` | Training notes ([[notes.definition]]): add form over the list; Remove confirms. `?exerciseId=`: one exercise's, no tab bar | `notes.tsx` |
| `/settings` | One grouped list: Account; Training (Rest timer, Bodyweight, Muscles, Effort, Progress, Recovery); App (Appearance, Notifications, Data & sync, Everything else); About, last, read-only. Each row shows its current setting and opens a page | `settings.tsx`, `components/settings/` |

## Sessions

| Route | What it is for | File |
| --- | --- | --- |
| `/session/[sessionId]` | The completed-session editor: Start/End and cards lock during MCP entry, with robot takeover and Done to leave ([[agents.write-access]]). The active view is the Train tab: summary, exercise cards and `Finish`, replaced by a robot and read-only controls during AI logging; the timer remains usable | `session/[sessionId]/index.tsx`, `components/session-view/session-view-screen.tsx` |
| `/session/[sessionId]/exercise/[sessionExerciseId]` | One exercise of that session: records panel, ordered set list with the in-place logger, `Complete exercise` | `session/[sessionId]/exercise/[sessionExerciseId].tsx`, `components/exercise-page/`, `apps/mobile/src/session-recorder/` |
| `/session/[sessionId]/add-exercise` | Exercise picker (iOS page sheet): the catalogue browser in select mode, group exercises, inline create | `session/[sessionId]/add-exercise.tsx`, `components/session-recorder/exercise-picker.tsx` |
| `/session/[sessionId]/compare` | Session vs history: the open session's exercise / muscle volume against earlier completed history, off the session view so logging stays uncluttered | `session/[sessionId]/compare.tsx` |
| `/sessions` | Dedicated workout history: active session rows if running, then weekly workout history ([[comparison.window]]). Header ⋮: `Show deleted sessions` (off by default). `?week=` / `?day=` scroll history without filtering | `sessions.tsx` |
| `/planner` | Dedicated planner: scopes **All**, **Schedule**, **Routines**, **Programmes**, an interactive 7-day week strip, and optional **Completed plans**. Schedule supports single-day filtering and empty-day planning; resolved rows hide by default; unfinished programmes show `{completed} over {total}` in Tag, with skips ([[planner.progress-outcomes]]). Header ⋮: `Show completed plans`. `Plan session` and `New programme` open editors | `planner.tsx`, `components/session-planner/plan-sections.tsx`, `components/session-planner/planner-week-strip.tsx` |
| `/session-plan/new` | Shared plan editor: title, schedule, gym and ordered exercise targets. Standalone Routine ([[planner.routine-reuse]]) uses SwitchRow; Schedule becomes passive locked Anytime, retaining its date. Programme children omit Routine. Inline validation; Add set(s) appends counted copies of the last target. `?edit=<planId>` edits that plan in place (ordinary consumed blocks are guarded; Routine future-intent edits are atomic and version-checked); `?from=<planId>` prefills a duplicate saved as new | `session-plan/new.tsx`, `components/session-planner/plan-form-screen.tsx` |
| `/session-plan/[planId]` | Targets, outcome counts ([[planner.progress-outcomes]]), provenance; **Start all** (a conflict offers Resume, creating nothing), per-block **Add to session** (several compatible cards: a choice sheet, writing nothing until picked), **Skip** on pending blocks, **Duplicate**, and confirmed **Delete** ([[planner.deletion]]). Consumed blocks link to history. Routine shows both dates, Start/Resume and confirmed per-use Skip | `session-plan/[planId].tsx` |
| `/programme/new` | Multi-session training programme editor: name, description, ordered child sessions list with reorder/duplicate/remove controls, focused sub-sheet for editing child sessions including count-only Add set(s), atomic transactional save. `?edit=<programmeId>` edits the programme in place; `?from=<programmeId>` prefills a duplicate | `programme/new.tsx`, `components/session-planner/programme-form-screen.tsx` |
| `/programme/[programmeId]` | Programme detail: metadata, resolution badge, session outcomes/counts ([[planner.progress-outcomes]]), next unresolved block with **Add to session** and **Skip**; ordered child sessions link to `/session-plan/[planId]` with spoken block counts and reordering. Duplicate and Delete retain their lifecycle rules; deletion detaches child plans without deleting workouts | `programme/[programmeId].tsx`, `components/session-planner/use-programme-detail.ts` |
| `/completed-session/[sessionId]` | View Session: a finished session, read-only (`Summary` \| `Sets`), with `Edit`; ⋮ resumes on Train or deletes/undeletes. Resume precedes Delete, with no recency cutoff; pending actions disable Edit/Resume/Delete, conflicts offer the current workout, and stale targets become unavailable. `presentation=completion` draws the post-Finish summary | `completed-session/[sessionId].tsx`, `components/view-session/`, `components/session-complete/`, `components/session-detail/` |
| `/exercise-history` | Single or selected exercises: period/tag filters, header gym picker and chronological cards. Combined cards add exercise names, retaining individual records and omitting combined bests. Older sessions append ([[comparison.allowed-periods]]); a period resets expansion | `exercise-history.tsx` |
| `/progress-history` | History for one or selected muscles or exercises, with saved Timeline, Grid or Weekly view. Progress passes metric, gym and muscle secondary choices. Grid days open day detail. Week tiles, Weekly rows and Timeline View sets open week detail. Detail lists scoped sets newest first, including active sets, and muscle totals. Cards open their workout and refresh after edits. Muscle cards link to exercise history. Timelines expand to landscape with pinch and zoom buttons. Landscape opens at up to 52 weeks and can zoom out to the full History look-back ([[comparison.history-window]]). Tap a week to open its set window, close it to retain the selection, or collapse to return to portrait. Exercise History and RM curve stay available. Back restores the originating view and scroll. | `progress-history.tsx`, `components/stats/history-view.tsx`, `components/stats/history-period-detail.tsx` |
| `/rm-curve` | Selected-exercise analytics, titled by the exercise with `RM curve` on the chart; uses `components/rm-curve/`. History Options opens it; Back preserves History. Missing/deleted targets remain unavailable with Back | `rm-curve.tsx` |

## Account, library and tools

| Route | What it is for | File |
| --- | --- | --- |
| `/profile` | Auth-aware account route: signed-out credentials, signed-in username / email / password management, sign-out | `profile.tsx` |
| `/connected-agents` | Signed-in review and revocation of OAuth grants, with independent planning and workout-logging switches ([[agents.write-access]]) | `connected-agents.tsx` |
| `/theme-custom?part=` | One custom part (title switches it): hue bar, strength (background: lightness, depth); spotlight, preview; saves on release | `theme-custom.tsx`, `components/appearance/` |
| `/body-weight` | Settings → Bodyweight: calculation preference, Health import choice and dated reading history; source/inclusion follows [[bodyweight.health-import]] | `body-weight.tsx`, `components/bodyweight/` |
| `/settings-appearance`, `/settings-notifications` | Appearance: Theme radio rows (Custom folds presets), then Mode or the Custom part rows (open pickers), then preview; a choice repaints the app at once. Notifications: one switch (state as description) or `Open iOS Settings` / `Sign in`; Categories while on; one Notice with Retry | `settings-*.tsx`, `components/appearance/`, `components/notifications/` |
| `/settings-rest-timer`, `/settings-progress`, `/settings-effort`, `/settings-data-sync`, `/settings-review-changes`, `/settings-everything-else` | Settings' sub pages: rest timer; Progress; Effort; Data & sync (and its Review changes); Everything else (Display, Records, Experiments, Developer; dev-only tools) | `settings-*.tsx`, `components/settings/` |
| `/settings-recovery` | `Recovery Days` ([[comparison.allowed-periods]]), saved immediately; failures use Data & sync | `settings-recovery.tsx`, `components/preferences/recovery-settings.tsx` |
| `/settings-muscles`, `/settings-muscle-targets` | Weekly targets; Muscle setup opens the muscle list and combined muscles; a blank target uses the default ([[muscle.weekly-targets]]). Loading, retryable errors, empty targets | `settings-*.tsx`, `components/preferences/muscle-settings.tsx` |
| `/settings-muscle-list`, `/settings-muscle?id=` | Muscles by family; one muscle picks Off, On or a combined muscle, or starts one ([[muscle.report-groups]]) | `components/preferences/muscle-list-settings.tsx`, `muscle-choice-settings.tsx` |
| `/settings-combined-muscles`, `/settings-combined-muscle?key=` | Combined muscles by family, `Start from Broad…`, empty state; the editor saves then goes Back, deletes after an Alert | `components/preferences/combined-muscles-settings.tsx`, `combined-muscle-editor.tsx` |
| `/gyms` | Manage the gyms a session can be at, and their private locations | `gyms.tsx`, `components/gyms/` |
| `/exercise-edit` | The exercise editor; Primary and Secondary use the same multi-select sheet, with at least one Primary required; `?exerciseDefinitionId=` edits, else creates; `?request=` carries a caller's callbacks | `exercise-edit.tsx`, `components/exercise-catalog/exercise-editor-screen.tsx` |
| `/exercise-link` | Link one of my exercises to my groups' exercises, or unlink it | `exercise-link.tsx` |

## Groups

Group routes (`/group/*`, `/group-session/*`) and their screen rules live in
[group-screens.md](group-screens.md); load it when adding, removing or
repurposing one. The `/groups` tab is above.

## Dev-only routes

| Route | What it is for | File |
| --- | --- | --- |
| `/dev-logs` | In-app recent-log viewer, reached from Settings → Everything else only under `isDevMode()` | `dev-logs.tsx` |
| `/ui-gallery` | Native pattern gallery: fixed examples, long content and read states; explicit deep link only, dev client required | `ui-gallery.tsx` |
| `/maestro-harness` | Test harness: fixtures, resets, gate actions, teleports. Self-gated | `maestro-harness.tsx` |

## Shells (not user-facing screens)

- `_layout.tsx` — local data bootstrap, the restore guard
  (`components/navigation/auth-route-guard.tsx`) and the root stack
  (`components/navigation/root-stack.tsx`).
- `(tabs)/_layout.tsx` — the tab group; every tab root hides its header and takes `MainTabBar`.

## Reachability rules

- Detail screens use the **minimal** back button (arrow only), which keeps the
  internal `(tabs)` group name off screen.
- Screens titled by the name of a thing (an exercise, a group, a leaderboard) set
  that title in the route file once the entity resolves; session-view, exercise-page, the
  exercise picker and every `completed-session` presentation hide the native
  header and draw their own top bar; `/exercise-catalog`, `/groups`, `/notes` and
  `/settings` keep the tab bar, except the catalogue from a workout.

## Screen rules a route file will not tell you

- **Train never offers Resume.** While a workout is in progress `/train` *is*
  it: the session view replaces the disc in place.
- Session-view and exercise-page edits **autosave losslessly** (every row
  kept); only `Finish` / `Done` drop unconfirmed rows (`../05-data-model.md`).
  Both run the shared cleanup prompts, and invalid set values block them.
- A completed session's records compare against **the completed sessions
  before it** — never itself, never later ones.
- The exercise page opens from the session view, another exercise's title
  switcher (params swapped in place) or the Maestro teleport; with no history, back goes to `/train`.
- `presentation=completion` does **not** link to muscle analytics, its share
  image excludes gym and location, and optional historical enrichment can
  never block it.
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
- Settings home's Appearance row names the theme, and a preset's mode when it
  is not light.
- The body weight log is reachable from Settings' Bodyweight card regardless
  of the bodyweight-calculation preference, and no session, detail or logger surface shows or links to a
  reading.

## Overlays on existing routes (not destinations)

- Bodyweight overlays on the exercise editor, session and group routes follow
  [bodyweight-load-contract.md](../tech/bodyweight-load-contract.md) §6 and §7;
  load it when changing them.

The session and exercise timer strips expand their repeating readout fullscreen
(`components/session-recorder/repeating-timer-focus.tsx`). Close, Back and
accessibility escape collapse without changing the timer; the dismiss control
stays separate. The focus view shows phase above the countdown-only ring, then
interval controls, Pause/Resume and Reset. Both share the store, cues and
keep-awake. It is in-route state, not a new route.
