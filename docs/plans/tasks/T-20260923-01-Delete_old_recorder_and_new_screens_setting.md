---
task_id: T-20260923-01-Delete_old_recorder_and_new_screens_setting
milestone_id: "none (plan: docs/plans/exercise-session-redesign.md, step 6b)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; ./boga test backend (6b-1, 6b-2: src/data changes)"
docs_touched: "docs/specs/ui/{screen-map,navigation-contract,ux-rules,components-catalog}.md, docs/specs/{02,03,05,06,08,09,11}*.md, docs/specs/tech/groups-contract.md, apps/mobile/README-maestro.md, apps/mobile/app/__tests__/README.md, RUNBOOK.md"
---

# Step 6b: delete the old recorder route and the new-screens setting

## Task metadata

- Task ID: `T-20260923-01-Delete_old_recorder_and_new_screens_setting`
- Status: `planned`. The user decided D1–D9 and G1–G3 on 2026-09-23. **Build nothing until the card is approved.**
- Session date: 2026-09-23
- Plan: `docs/plans/exercise-session-redesign.md`, step 6b. Step 6a (default on) shipped as #326 (`c648f66`).

## Context freshness

- Branch `claude/zealous-pascal-275ce8`, fast-forwarded to `origin/main` `c648f66`; slot 2 leased.
- Docs read: `AGENTS.md`; specs `02`, `03`, `09`; the recorder, session-view and exercise-page sections of `docs/specs/ui/{screen-map,navigation-contract,ux-rules,components-catalog}.md`; the plan and the build spec; `docs/plans/README.md`. Of specs `06` and `11`, only the parts that name the recorder's flows and lanes.
- The inventory is taken from `app/(tabs)/session-recorder.tsx` (5,821 lines) at `c648f66`. Line numbers refer to that commit.
- 6a already changed one behaviour. Every default-path session now starts through `src/session-entry/coordinator.ts:71-80`, which sets `gymId: null`. **GPS gym preselection has therefore not run on the default path since 6a.** Only the recorder's own `Start Session` still uses it.

## Objective

Remove `/session-recorder`, its recorder-specific Maestro coverage and the `New exercise & session screens` setting, **without silently dropping behaviour** (plan rule 2 and its Risks section).

Every recorder behaviour below is marked **covered** (the new screens already do it), **move** (build it on the new screens first), or **drop** (deleted, with the user's agreement).

## Behaviour inventory

### Covered: nothing to do beyond deleting

| Recorder behaviour (old line) | Where the new screens do it |
| --- | --- |
| Start session / empty state (3402-3425, 1456-1511) | Train and Today, through `session-entry/coordinator.ts` |
| Rehydrate the draft on focus without overwriting in-memory edits (1069-1131) | `use-session-view.ts:92-100`, with a generation guard |
| Autosave: debounced text, immediate structural changes, flush on blur, background and unmount (823-907) | `use-session-exercise-draft.ts`, using `draft-autosave` and `lifecycle-helpers` |
| Gym *selection*, including `No gym` (4086-4128) | `SessionGymSheet` → `setActiveSessionGym` |
| Confirm and unconfirm a set, with planned values hydrated (2669-2742) | `SetRow` toggle and `toggleSetPerformed` |
| Weight and reps entry; focus moves to a new set (3818-3900) | `SetLogger`; `exercise-page-screen.tsx:149-156` |
| Set type: tap to cycle, long-press for a picker | `EffortSheet`, defaulting to the planned type (plan decision) |
| Add a set as a copy of the previous one (2539-2567) | `addSet` |
| Change exercise (2530-2537) | Swap, in the exercise ⋮ |
| Remove exercise (2499-2528) | `Remove from session` |
| Add an exercise, or append a plan, via the picker (2369-2458) | Session view `+ Add exercise`; `session-lifecycle.ts:115-162` |
| `/exercise-catalog?source=session-recorder&intent=manage` and return (2460-2469) | Session view `index.tsx:103-111, 223-227` (transition 49) |
| Live PR against history (3294-3317) | Record band from `session-view-model.ts:117-126`; `record` emphasis on the exercise page |
| Submit: block on invalid values, cleanup prompts, completion write, completion route (3050-3157) | Session view Finish (`index.tsx:115-154`), using the same `session-model.ts` rules |
| Share preview, completion PR celebration, volume comparison, completion muscle breakdown | Live in `completed-session` and `components/session-recorder/*`; they do not depend on the route |

### Decisions (user, 2026-09-23)

| # | Recorder behaviour | Decision | What it means for the build |
| --- | --- | --- | --- |
| **D1** | **Completed-session edit** (`?mode=completed-edit`, 744-750, 972-1045, 3437-3526, 3084-3102): edit sets and gym; editable Start/End with validation and an "autosave paused" notice; `Summary` / `History` / `Save Changes`; flush in `beforeRemove`. Three callers ignore the setting: the History row tap and Edit (`sessions.tsx:116-118`), completed-session Edit (`completed-session/[sessionId].tsx:541-547`), and the `intent=edit` redirect (`:947-953`) | **Move** | **PR 6b-1.** The session view and exercise page accept a completed session. Instead of Finish/Abandon there is `Done`. The summary card's Time stat becomes Start/End, editable with the recorder's validation; while the times are invalid, autosave pauses and a notice shows. Edits autosave through `persistCompletedSessionSnapshot`, and only confirmed rows are saved (`05-data-model.md:305-306`). The exercise page's `not-active` guard (`session-exercise-draft.ts:39-48`) widens to completed sessions. `Complete exercise` keeps its rules. The History row, completed-session `Edit` and `intent=edit` all open `/session/<id>`. `Summary` goes: the completed-session detail already is the summary. The `presentation=summary` branch then becomes unreachable and is deleted (M5) |
| **D2 + D3** | **Gym add/edit/archive/manage** with private coordinates (4133-4318, 1592-1904); **GPS detection**, meaning preselect on a new start (1422-1511) and long-press retry (1513-1543) | **Move**, in the layout below | **PR 6b-2.** GPS suggests in the sheet only (G1); the start-time preselect and the long-press retry are dropped. `src/location/*` and `expo-location` stay, so there is no native change |
| **D4** | **Exercise tags** editing: `#`, chips, attach/create/remove, manage (3905-3962, 4336-4551, 2909-3048) | **Drop** the editing UI | Keep the synced tag tables, the read-only chips in completed-session and exercise history, and `listSessionExerciseAssignedTags`. Delete the list/create/rename/delete/attach APIs (`exercise-tags.ts:620-628`), `ExerciseTagDomainError` and their tests. Retire `ux-rules.md:437-443` |
| **D5** | **Live `Session muscle load`** row and sheet (3270-3323, 3978-3988) | **Drop** | Delete `components/session-recorder/session-muscle-load.tsx` and its test. Move the `SessionMuscleLoadCatalogState` type next to `session-completion-presentation.tsx`. The completion screen's breakdown stays |
| **D6** | **Past Records extras**: the older-block swipe navigator and the live Current/Max table (2012-2272) | **Drop** | The records panel (Records / Last / History) is the replacement |
| **D7** | **Swipe to delete a set** (461-586) | **Drop** | To remove a set: untick, then `Complete exercise` (removes ad-hoc sets that were never ticked) |
| **D8** | **`Total load` / `Per side`** weight-entry label (3921-3933) | **Drop** | The exercise page shows no load mode; it is edited in the catalogue and still drives analytics |
| **D9** | **`Link to group exercise…`** in the card's `•••` menu (4571-4579; transition 38) | **Move** | Add a signed-in item to the exercise-page ⋮ sheet (`useGroupLinkingUserId`, `exerciseLinkHref`). Transition 38 now starts from the exercise page. Goes in PR 6b-2 |

Also dropped, by the plan and build spec (no new approval): the struck-prescription "modified" row, collapsible cards with their collapsed summary, the kg suffix, and the read-only date field (elapsed Time replaced it).

### Gym layout (D2 + D3)

The user's direction: tapping the gym opens a quick selector where GPS suggests; management gets its own screen, linked from the sheet.

- **Quick selector: `SessionGymSheet`**, opened from the session view's Gym stat.
  - **Suggestion row first.** Opening the sheet runs a foreground location lookup. It uses the recorder's 1.5 s timeout and the existing pure matcher (`src/location/gym-location-matcher.ts`). With exactly one confident match, the first row reads `Nearby · <gym>`, and one tap selects it.
  - No suggestion row appears on a permission denial, timeout, missing coordinates or a tie. This is the same quiet assistance as `ux-rules` §14 today.
  - **Then** `No gym` and the gyms, with the current one marked (as today).
  - **Footer link `Manage gyms`**: closes the sheet and pushes `/gyms`. On return, the gym list reloads on focus.
- **Gyms screen: `/gyms`**, on the root stack with a native header `Gyms`.
  - A list of gyms, each showing whether a location is saved, plus `+ Add gym`.
  - A row opens that gym's editor: name, `Save current location` / confirmation-gated `Replace` / `Clear`, and `Archive`.
  - A `Show archived` toggle, with `Unarchive` for archived gyms.
- **Archive is a soft delete** through the synced `gyms.deleted_at`. The schema and sync contract do not change. The recorder's archive lived in memory and was never persisted, so this makes it real. Archived gyms still name past sessions, and `listLocalGyms` already hides them from the selector.
- **Code:** lift the editor out of the recorder (4192-4318, 1659-1904) into `components/gyms/`. Persistence uses `upsertLocalGym` (with coordinates) plus a new `setLocalGymArchived` in `src/data/local-gyms.ts`.

**Decided (user, 2026-09-23):**

- **G1. GPS suggests only.** GPS never preselects at session start. The coordinator keeps `gymId: null`, which drops the recorder's start-time preselect. The location permission prompt first appears when the gym sheet opens.
- **G2. `/gyms` is reachable from the sheet's `Manage gyms` link and from a `Gyms` row under More → Tools.** From More it gets an explicit `Back to More`, like Settings and the catalogue (`source=more`, `ux-rules` More rules).
- **G3. Archive is a soft delete** (`gyms.deleted_at`). There is no hard delete.

### Mechanical: no approval needed

- **M1: the setting.**
  - Delete `src/session-recorder/new-screens-preference.ts`, the Settings row (`settings.tsx:289-309`), the exercise page's setting-off notice (`[sessionExerciseId].tsx:37-55`), and `useNewScreensEnabled` in Today, Train, Sessions and completed-session.
  - `activeSessionHref(id, enabled)` becomes `sessionViewHref(id)`, with a non-null id. `sessions.tsx:73-79` always pushes it.
  - The SecureStore key `boga3.newExerciseSessionScreens.v1` is left orphaned. That is harmless.
- **M2: the route.**
  - Delete `app/(tabs)/session-recorder.tsx` and its `Tabs.Screen` (`(tabs)/_layout.tsx:57`).
  - Remove the `main-tabs.ts` `session-recorder` segment and `shouldCollapseMainNavigation`.
  - Remove the dead `BottomTray collapseOnEntry` path.
- **M3: the source param.**
  - Rename `source=session-recorder` to `source=session` (`exercise-catalog.tsx:66`, `session/[sessionId]/index.tsx:39`).
  - Fix the stale comment at `exercise-calculations/index.ts:59`.
- **M4: the harness** (`src/maestro/harness.ts`, `app/maestro-harness.tsx`).
  - Drop the `session-recorder` teleport, `mode`, `newScreens=`, and `reset=data`'s preference restore (`harness.ts:191-211`).
  - Add a way to open a completed session in the session view for 6b-1. For example, `teleport=session&sessionId=` with a completed fixture.
  - `maestroShare=fail-once` flows move to `teleport=completed-session`, which already accepts it.
- **M5: dead code.**
  - In `session-model.ts`: `mapSessionGraphSnapshotToSession`, `REPS_INPUT_PATTERN` and `createSetFromPrevious`. Also un-export what is only used inside the file.
  - `ExercisePicker` `mode='replace'`.
  - `ExercisePersonalRecordCelebration` `variant='expanded'`.
  - Unused `SessionContentLayout` props.
  - The recorder state types in `types.ts`.
  - The completed-session `presentation=summary` branch and `handleSummaryEdit` (after D1).
  - The tag write APIs (D4).
- **M6: glyph allowlist.** Remove both entries in `ui-icon.test.tsx:75-81` (the route and `session-muscle-load.tsx`). Delete the allowlist mechanism, which is now empty.
- **M7: picker coverage.** `session-view-screen.test.tsx` mocks `ExercisePicker`. Before deleting the recorder tests, port its real tests to a component test of `components/session-recorder/exercise-picker.tsx`: search, grouping, inline create, group rows and the pick sheet. This includes the cases `groups-contract.md:1628` cites from `session-recorder-group-picker.test.tsx`.

## Tests to delete or rewrite

### Jest

| File | Action |
| --- | --- |
| `session-recorder-screen.test.tsx` (1,021 lines) | Delete. Port the GPS, gym picker and gym editor cases to the sheet and `/gyms` tests (6b-2) |
| `session-recorder-interactions.test.tsx` (1,842) | Delete. Picker cases go to M7; completed-edit parity cases go to 6b-1; tag cases are dropped (D4) |
| `session-recorder-persistence.test.tsx` (708) | Delete. Port the completed-edit load, the invalid-time autosave pause and the leave-flush cases (6b-1) |
| `session-recorder-submit.test.tsx` (810) | Delete. Port the completed-edit save cases (6b-1); `Summary` is gone |
| `session-recorder-group-picker.test.tsx` (369) | Delete, after M7 |
| `new-screens-preference.test.ts`, `settings-new-screens.test.tsx`, `session-muscle-load.test.tsx` | Delete |
| Tag write-API tests (`exercise-tags` data tests and dirty-bit cases) | Delete what covers deleted APIs (D4) |
| `maestro-harness.test.ts` | Edit: the recorder teleport (`:141, 152-158`) and the preference block (`:213-247`); add the completed-session teleport |
| `session-view-model.test.ts:252-254`, `today-screen.test.tsx`, `train-screen.test.tsx` | Edit: remove the setting-Off cases |
| `sessions-screen.test.tsx` | Edit: remove the Off case (`:94-100`); row and Edit → `/session/<id>` (`:127`) |
| `completed-session-detail-screen.test.tsx` | Edit: `:836`, `:1113` → `/session/<id>`; `:859` → `/session/<id>`; remove the `presentation=summary` Edit case |
| `exercise-page-screen.test.tsx:483-486` | Edit: remove the "notice when off" case; add completed-session editing (6b-1) and the ⋮ Link item (D9) |
| `main-tabs.test.tsx:43, 57-59` | Edit: remove the recorder segment and the collapse case |
| `ui-icon.test.tsx` | Edit (M6) |

### Maestro

Runners: `apps/mobile/scripts/maestro-run-lane.sh` and `maestro-ios-gates.sh`. `meta-tests` (`maestro-flow-lanes.test.sh`) requires every flow to have a runner line, so a flow and its runner line change together.

| Flow | Lane | Action |
| --- | --- | --- |
| `smoke-launch.yaml:50-75` | ios-smoke, ios-gates | **Rewrite**: Train → `train-start-empty-button` → `session-view-screen`. Drop the tray-collapse steps (M2) and rename the `05/06-m26-recorder-*` screenshots |
| `data-runtime-smoke.yaml:29-123` | ios-data-smoke, ios-gates | **Rewrite** the write path: Train start → `+ Add exercise` → picker → exercise-page logger → back → Finish → Done. **Keep** the Stats read-back (`:137-142`). **Delete** the muscle-load block `:76-112` (D5) |
| `exercise-block-history-fixture.yaml` (304 lines) | ios-ui-regression | **Delete** the recorder half (`:1-212`). **Move** the completion tail (`:213-304`: multi-PR, share preview, image failure, native share sheet, muscle breakdown) into `session-completion-states-fixture` via `teleport=completed-session&presentation=completion&maestroShare=fail-once`, which needs a two-PR fixture session. Then delete the file and its runner line |
| `session-completion-states-fixture.yaml:87-125` | ios-ui-regression | **Rewrite** (6b-1) as a completed edit through `/session/<id>`: open from completed-session `Edit`, change a set on the exercise page, change the Start time, `Done`, then read it back. `:1-86` stay |
| `sync-first-run-log-and-roundtrip.yaml:130-176` (Phase B) | ios-sync-e2e | **Rewrite** Phase B through Train → session view → exercise page → Finish. Phases A, C and D are unchanged. Update the comment at `:120-129` and `maestro-run-lane.sh:132-136` |
| `groups-link-exercise.yaml:156-193` (section 2) | ios-groups-e2e | **Rewrite**: Train start → `session-view-add-exercise` → the same picker group steps → assert the session-view card. **Add** exercise ⋮ → `Link to group exercise…` → the Link screen (D9) |
| `settings-new-screens-toggle.yaml` | ios-ui-regression | **Delete**, with its runner line `maestro-run-lane.sh:96` |
| `session-view.yaml` | ios-session-view | Edit: drop `assertNotVisible: session-recorder-screen` (`:57`) and the setting wording. **Add** (6b-2) Gym stat → sheet → `Manage gyms` → `/gyms` → add a gym → back → select it |
| `exercise-page.yaml`, `session-view-abandon.yaml` | ios-exercise-page, ios-session-view | Edit comments only |

Maestro cannot fake a location on the simulator reliably, so the GPS suggestion row is covered in jest (injected location service), not Maestro. Unaffected flows: `stats-screen-ux`, `settings-dev-wipe-local`, `auth-profile-happy-path`, `groups-two-user-stream`. Fixture users do not change.

## Doc graduations (in the PR that ships each behaviour)

- **`ui/screen-map.md`**
  - Delete entry 4 `/session-recorder` (`:169-199`).
  - Remove every "Off / `/session-recorder`" clause (`:45, 66, 210, 255, 344-349, 377-381, 562`).
  - Settings loses the toggle (`:271-274`).
  - Update the preserved-roots list (`:593, 599`).
  - Entries 4b and 21 gain completed-session editing (6b-1), the gym sheet's suggestion row and `Manage gyms` (6b-2), and the ⋮ Link item (D9).
  - **New entry `/gyms`** (6b-2); the More entry gains the Tools `Gyms` row (also `ux-rules` More rules, `:55-60`).
- **`ui/navigation-contract.md`**
  - Delete route 4 (`:153-169`).
  - 4b: remove the setting and `activeSessionHref`; allow completed sessions (`:177-182`).
  - `source=session` (`:190-194`).
  - Sessions (`:247-256`).
  - Transitions 3, 7, 8 and 14 → `/session/<id>`; delete 5, 10, 11, 13, 15, 16; repoint 38 to the exercise page; remove 46's Off clause.
  - Add `/session/<id>` → `/gyms` (sheet `Manage gyms`) and `/more` → `/gyms?source=more` (with `Back to More`); both return by back.
  - Notes (`:488-489, 498`).
- **`ui/ux-rules.md`**
  - Remove the Settings rule (`:64-69`) and the "or the recorder" clauses (`:84, 94-98`).
  - Move the picker rules (`:106-160`) to the shared picker.
  - Completed-edit (`:158`) → session view (D1).
  - Remove the set-row rules (`:170-184`), muscle load §12 (D5), Past Records §17 (D6) and tags (`:437-443`, D4).
  - Rewrite GPS §14 and gym §15-16 for the sheet and `/gyms` (D2/D3).
  - Remove the raw-colour note (`:325`) and the glyph notes (`:373, 425`).
- **`ui/components-catalog.md`**
  - `:24, 128, 142-143, 156, 168, 174, 180-189, 274, 300, 324-327`: drop "recorder" as owner or consumer.
  - Drop `SessionMuscleLoad` and the tray-collapse-on-entry note.
  - Add the gym editor under `components/gyms/`.
- **`03-technical-architecture.md`**: the session-insights row (source `app/(tabs)/session-recorder.tsx`); the GPS row ("isolated from recorder" → "from the gym sheet and Gyms screen").
- **`05-data-model.md:305-306`**: completed-edit save semantics, now owned by the session view.
- **`08-ux-delivery-standard.md:94, 98`**, **`09-project-structure.md:81`** (plus `components/gyms/` if structure is listed).
- **`tech/groups-contract.md:1628-1630, 2028, 2209`**: test and flow citations; the Link entry point is now the exercise-page ⋮.
- **Test docs**
  - `02:136` sync e2e: "real session view / exercise page UI".
  - `06:88-95, 202, 210, 336-353`.
  - `11:310, 329-340`.
  - `apps/mobile/README-maestro.md:142-144, 150-152, 181-185`.
  - `apps/mobile/app/__tests__/README.md:37`.
  - `RUNBOOK.md:891`.
- **Plan**: mark 6b shipped in `exercise-session-redesign.md` (in 6b-3).

## PR split

Each PR stays under the ~2,000 added/modified-line budget (deleted lines don't count).

1. **6b-1: completed-session editing on the new screens (D1).**
   - Session view and exercise page accept a completed session: Start/End editing and `Done`.
   - Sessions and completed-session route to `/session/<id>`; drop `Summary` and `presentation=summary`.
   - Harness teleport; rewrite `session-completion-states-fixture:87-125`; port the completed-edit jest cases.
   - The recorder still exists, but nothing links to it for completed sessions.
2. **6b-2: gyms (D2 + D3) and Link (D9).**
   - Suggestion row in `SessionGymSheet`, `Manage gyms` link, the `/gyms` screen and editor, the More → Tools `Gyms` row, `setLocalGymArchived`.
   - The exercise-page ⋮ `Link to group exercise…`.
   - Jest ports; `session-view.yaml` and `groups-link-exercise` steps.
3. **6b-3: the delete (M1–M7, D4–D8 drops).**
   - Route, setting, harness, dead code, tag write APIs, muscle load.
   - The remaining flow rewrites; doc graduations; the plan row.

6b-1 and 6b-2 are independent and can run in parallel. 6b-3 goes after both.

## Gates (from `./boga test for`, checked at `c648f66`)

| PR | Required | Why |
| --- | --- | --- |
| 6b-1 | `fast` + `frontend` + **`backend`** + `docs-check` + `meta-tests` | `src/data/session-drafts.ts` persistence → "data layer / client schema" |
| 6b-2 | `fast` + `frontend` + **`backend`** + `docs-check` | `src/data/local-gyms.ts` → "data layer / client schema" |
| 6b-3 | `fast` + `frontend` + **`backend`** + `docs-check` + `meta-tests` | UI routes, Maestro flows, docs; the tag-API deletion edits `src/data/exercise-tags.ts` → "data layer / client schema". Confirm with `./boga test for --diff` |

- **All three:** `./boga test handles` (timers go with the recorder's autosave and GPS timeout, and new ones arrive with the sheet lookup).
- **6b-3:** `./boga test ios-gates` by name (smoke + data-smoke pair).
- There is no native change: `expo-location` stays, so no dev-client rebuild.
- `frontend` already includes every rewritten flow's lane (smoke, data-smoke, ui-regression, exercise-page, session-view, auth-profile, sync-e2e, groups-e2e).
- `./boga db reset` between `frontend` and `backend` (known pollution).
- Durations come from `./boga timings` only.

## Acceptance criteria

1. There are no references to `session-recorder` as a route, and none to `newScreens`, `useNewScreensEnabled`, `NEW_SCREENS` or `activeSessionHref`, in `apps/mobile`, `scripts` or `docs/specs`. The folder names `src/session-recorder/` and `components/session-recorder/` remain until step 7.
2. D1, D2/D3 and D9 have shipped as moves, each with jest coverage and a Maestro step on a lane. D4–D8 are deleted along with their code, tests and doc rules.
3. A completed session opened from History or completed-session `Edit` can be edited (sets, gym, Start/End) and read back, and is never replayed through completion.
4. A gym can be added, located, archived and unarchived from `/gyms`, and a confident GPS match shows as the sheet's first row.
5. Every flow has a runner line (`meta-tests` green), and no flow teleports to a deleted target.
6. The gates above are green, with evidence in each PR body per `.github/pull_request_template.md`.

## Step 7 (close out): what's left after 6b

- Delete `docs/plans/exercise-session-redesign.md` and `exercise-session-build-spec.md` once every "Decisions already made" bullet is confirmed in `docs/specs/**`. Most are already in §14a/§14b, `design-language.md` and screen-map 4b/21. Check that "Back vs Complete are distinct exits" and "planned vs ad-hoc is not a mode" are in `ux-rules.md`.
- Restyle View Session (`/completed-session/[sessionId]`: detail and completion presentation) to the design language, in its own task card started after 6b-1 (user, 2026-09-23), so it builds on the session view's styling and components. It is the old-styled screen closest to the redesign (the completed edit's `Edit`/`Done` loop crosses it), and step 7 cannot retire the legacy styling while it still uses `uiColors`.
- Delete `app/__tests__/ui-tokens-additive.test.ts` and its mentions in `design-language` and `ux-rules`. Decide whether `uiColors` now merges into `uiRoles`, since the additive rule protects nothing once the old screens are gone.
- Strip the "redesign step N" and "default since step 6a" wording from `screen-map.md`, `navigation-contract.md`, `ux-rules.md` §14a/§14b and `components-catalog.md`.
- Optional: rename `src/session-recorder/` and `components/session-recorder/` (e.g. to `session/`), since "recorder" no longer names a screen. This is mechanical but wide; `scripts/triggers.tsv:26` cites `src/session-recorder/set-semantics.ts`.
- Revisit the pending-primitives list in `components-catalog`.
- Delete this task card with 6b-3.
