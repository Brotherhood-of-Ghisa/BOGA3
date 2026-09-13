---
task_id: M25-T08-Mobile_group_page
milestone_id: "M25"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend (includes ios-groups-e2e)"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md, docs/specs/ui/ux-rules.md"
---

# M25-T08 — Mobile group page: Stream · Exercises · Leaderboards, Exercises page

## Task metadata

- Task ID: `M25-T08-Mobile_group_page`
- Status: `planned`
- Depends on: `M25-T01` (PR #287, merged), `M25-T02` (PR #285, merged)
- Uses (merged): `M25-T03` (PR #286) — local links `listLinks()`
- Parallel with: `M25-T07` (mobile linking; also touches group screens —
  whichever merges second rebases and resolves)
- Unblocks: `M25-T09` (with T05)

## Parent references

- Milestone: `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`
- Product: `docs/plans/group-exercises-and-leaderboards.md` — P1, P5, E0.4,
  D8, D10, D14
- Design: `docs/plans/group-exercises-tech-design.md` — §1 (shared
  `ExerciseCore`), §4 (persistent stream), §7 (cache keys)
- Contract: `docs/specs/tech/groups-contract.md` §2.7, §4.4 (group exercise
  RPCs), §6 (client), §7 (freshness/offline)
- As-built inputs: `apps/mobile/src/groups/api.ts` (`listGroupExercises`,
  `createGroupExercise`, `updateGroupExercise`, `archiveGroupExercise`,
  `unarchiveGroupExercise`, `groupExerciseCore`),
  `apps/mobile/src/exercise-core/index.ts` (`validateExerciseCore`,
  `LOAD_INPUT_MODES`), `apps/mobile/src/data/exercise-group-links.ts`
  (`listLinks`), `apps/mobile/src/data/exercise-catalog-seeds.ts`
  (`SYSTEM_EXERCISE_DEFINITION_SEEDS`), current group screen
  `apps/mobile/app/group/[groupId]/index.tsx`
- UX: `docs/specs/08-ux-delivery-standard.md` (patterns 3, 7, 8, 9),
  `docs/specs/ui/ux-rules.md` §14

## Objective

The group screen becomes **Stream · Exercises · Leaderboards** (D10). Members
move behind the header's member count (D14). The Exercises page lists the
group's exercises with my link status, and lets the owner and admins add
(copy a standard exercise or create a custom one), rename, and archive them
through the same name + weight-entry fields as the personal exercise editor
(design T1). Leaderboards is an empty state until T09.

## Scope

### In scope

1. **Segments.** `/group/[groupId]` segment becomes `Stream` / `Exercises` /
   `Leaderboards` (joined `SegmentedChips`, testIDs
   `group-screen-segment-{stream,exercises,leaderboards}`). Stream is
   unchanged and stays the default.
2. **Members route.** The header's member-count line (`group-screen-meta`)
   becomes a press target (`group-screen-members-link`, chevron, a11y label
   "Members, N") that pushes a new route **`/group/[groupId]/members`**
   holding what the Members segment holds today: the member rows, the
   role-gated member action sheet (§4.3 matrix, unchanged), write feedback,
   and Leave / the owner's transfer notice. It reads the same `group:<id>`
   resource (no new cache key); after a successful leave it
   `dismissTo('/groups')` as today; lost access shows the existing state.
3. **Exercises page** (segment content).
   - Data: `listGroupExercises` through `useGroupResource`, cache key
     **`group-exercises:<groupId>`** (design §7), added to `groupCacheKeys`
     and to `evictGroup` (access loss clears it). Cache-first, focus + 30 s
     poll + pull-to-refresh, offline banner, missing-data / inline-error
     states — the §7 pattern the other group screens use.
   - Rows: active exercises in server order, then archived ones at the
     bottom marked `Archived`. Each row: name, weight entry (`Total load` /
     `Per side`), and my status from my **local** links (T03 rows, so it
     works offline): `Linked: <my exercise name>` (several names
     comma-joined when I linked more than one), else `Not linked`. Names come
     from my local exercise catalogue; a link whose exercise is missing
     locally shows `Linked` with no name.
   - Empty state: "No group exercises yet" (admins: with an `Add exercise`
     button; members: "Admins add exercises here").
   - A view-model function in `src/groups` builds the rows (ordering,
     archived flag, status wording) so it is unit-tested without the screen.
4. **Admin actions** (owner, admin — `canManageGroup`; members see none,
   and the server still enforces `FORBIDDEN`).
   - `Add exercise` (header of the page) → new route
     **`/group/[groupId]/exercises/new`**: a `From catalogue` / `Custom`
     choice. *From catalogue* shows a searchable list of the bundled standard
     exercises (`SYSTEM_EXERCISE_DEFINITION_SEEDS`); picking one prefills the
     form (name, weight entry) and sets `sourceExerciseId` to the seed id.
     *Custom* is the empty form with `sourceExerciseId: null`. Submit calls
     `createGroupExercise`, then returns to the Exercises segment, refreshed.
   - Tapping an active row (admins only; chevron) opens an in-route action
     sheet: `Rename` (→ **`/group/[groupId]/exercises/[exerciseId]/edit`**,
     the form prefilled via `groupExerciseCore` from the cached list; submit
     = `updateGroupExercise`) and `Archive` (danger, `Alert.alert`
     confirmation noting links and boards are kept read-only and it is no
     longer offered for new links — D8). An archived row's sheet offers
     `Unarchive` only (no confirmation); archived exercises cannot be edited
     (server `VALIDATION`).
   - All writes go through `useGroupAction`: refused offline before any
     request, failure shown inline with "nothing was changed", no queue
     (pattern 9). `FORBIDDEN` / `NOT_FOUND` refresh the list.
5. **Shared `ExerciseCore` form.** Extract the name input + `Total load` /
   `Per side` control from
   `components/exercise-catalog/exercise-editor-modal.tsx` into one
   component (`ExerciseCoreFields`, a new `components/exercise-core/`
   folder) used by both the personal editor and the group exercise form.
   Validation for both goes through `validateExerciseCore` (messages from
   `EXERCISE_CORE_ISSUE_MESSAGES`). The personal editor keeps its testIDs
   (`exercise-editor-name-input`, `exercise-editor-load-mode-*`) through a
   testID-prefix prop, so its tests and flows are unchanged.
6. **Leaderboards page.** An empty state (`group-screen-leaderboards-empty`):
   "Leaderboards are coming soon" plus one line on what they will show. No
   RPC; T09 replaces it.
7. **Maestro.** Extend `ios-groups-e2e`'s flow
   `groups-two-user-stream.yaml` (device `user_c` is the group owner; no new
   fixture user): after creating the group, open Exercises, add one standard
   copy and one custom exercise, rename one, archive one (it moves to the
   bottom marked Archived), and assert `Not linked`. The counterparty script
   gains a step asserting `user_d` (a member) reads the same list through
   `group_exercise_list`. Step 8 (remove the counterparty) opens Members
   through the header member count instead of the old segment.
   `groups-fixture-reset.sh` already deletes the groups, which cascades to
   `group_exercises`.

### Out of scope

- **"Link your exercise"** on an unlinked row (E0.4): it opens T07's pick
  sheet, so T07 wires it (or whichever of T07/T08 merges second). T08 shows
  the status text only; no link writes here.
- Leaderboard content (`boards:<groupId>`, podium, full board, history) —
  T09. Stream record / link items — T10.
- Server changes: none. `src/sync/**`: untouched.
- Deleting group exercises (no RPC; P1 has archive only).

## UX Contract

### Key user flows

1. **Switch pages**
   - Trigger: open a group.
   - Steps: Stream shows first; tap Exercises or Leaderboards.
   - Success: the page switches in place; the header (name, description,
     member count · role, Invite / Edit) stays.
   - Edge: offline — each page shows its cached data with the offline
     banner, or the offline empty state when nothing is cached.
2. **See members**
   - Trigger: tap "3 members · You're the owner".
   - Steps: the Members screen opens; owner/admin open a member's action
     sheet as today; Leave sits at the bottom.
   - Success: member writes update the list in place with the inline notice;
     Back returns to the group screen.
   - Edge: removed while viewing → lost-access state.
3. **Browse exercises (any member)**
   - Trigger: tap Exercises.
   - Success: active exercises, then archived ones marked Archived; each
     shows weight entry and `Linked: …` / `Not linked`.
   - Edge: no exercises → empty state (admin: Add exercise; member: "Admins
     add exercises here"). Rows are not pressable for members.
4. **Add an exercise (owner/admin)**
   - Trigger: Add exercise.
   - Steps: choose From catalogue (search, pick → prefilled form) or Custom
     (type a name, pick weight entry); Save.
   - Success: back on Exercises with the new row after refresh.
   - Edge: blank name → inline "Exercise name is required", no request;
     offline or server failure → inline error above Save, nothing created,
     draft kept.
5. **Rename / archive / unarchive (owner/admin)**
   - Trigger: tap an exercise row.
   - Steps: Rename → prefilled form → Save; or Archive → confirm; or (archived
     row) Unarchive.
   - Success: the list refreshes; an archived row moves to the bottom
     marked Archived.
   - Edge: offline / failure → inline notice, nothing changed; `FORBIDDEN`
     (demoted meanwhile) → notice + refresh, actions disappear.

### Interaction + appearance notes

- Reuse `SegmentedChips`, `UiSurface`, `UiText`, `UiButton`, the group state
  panels, `GroupOfflineBanner`, `GroupWriteNotice`, and the member action
  sheet's modal pattern; no raw color literals.
- Three segments must fit a 375 pt phone without wrapping.
- The member-count press target meets the tap-target baseline and reads as
  tappable (chevron), not colour alone.
- Archive is the only destructive action here and confirms first
  (pattern 3); rename and unarchive do not.

## Acceptance criteria

1. The group screen shows `Stream` / `Exercises` / `Leaderboards`; no
   Members segment remains. Stream behaves exactly as before (existing jest
   and Maestro stream assertions pass unchanged).
2. The header member count opens `/group/[groupId]/members`, which offers
   every member action, the Leave / owner notice, and the lost-access state
   exactly as the old segment did (existing member-action jest cases move
   over and pass).
3. Exercises lists `group_exercise_list` results active-first with archived
   last and marked; each row shows weight entry and my local link status
   (`Linked: A, B` / `Linked` / `Not linked`), proven by view-model jest.
4. The list is cached under `group-exercises:<groupId>`, renders offline from
   cache with the offline banner, shows the offline empty state with no
   cache, and is removed by `evictGroup` (cache jest).
5. Members see no Add / row actions; owner and admin see them. Jest walks
   owner / admin / member.
6. Add from catalogue sends the seed's id, name, and weight entry; Custom
   sends `sourceExerciseId: null`; Rename sends the edited core; Archive
   confirms first; Unarchive shows only on archived rows. Each has a jest
   happy path and an offline refusal (no RPC called) and a server-failure
   path (inline, nothing changed).
7. The personal exercise editor and the group form render the same
   `ExerciseCoreFields` and validate through `validateExerciseCore`;
   existing exercise-editor jest and Maestro flows pass unchanged.
8. Leaderboards shows its empty state and makes no request.
9. `ios-groups-e2e` passes with the extended flow (add standard + custom,
   rename, archive, `Not linked`, counterparty reads the list, Members via
   the header) and its screenshots are the visual evidence.
10. Group screens call group RPCs only through `@/src/groups`; nothing in
    `src/sync/**` changes; dev-only UI (if any) uses `isDevMode()`.

## Docs touched

- `docs/specs/tech/groups-contract.md`: §6.1 (exercise hooks / view model),
  §6.2 (`group-exercises:<groupId>` key and eviction), §6.3 (routes:
  members, exercise new/edit; segments), §8 (flow extension) — as-built
  notes.
- `docs/specs/ui/screen-map.md`: group screen segments; new members and
  exercise form routes.
- `docs/specs/ui/navigation-contract.md`: the three routes, params, and
  transitions (header → members, Add → new, row → edit, back/refresh).
- `docs/specs/ui/components-catalog.md`: `ExerciseCoreFields`, the group
  exercise row / list / action sheet / form.
- `docs/specs/ui/ux-rules.md` §14: admin exercise actions and archive
  confirmation.
- `docs/specs/08-ux-delivery-standard.md`: only if a genuinely new pattern
  emerges (none expected).
- Delete this card in the PR.

## Testing and verification

- `./boga test for --diff origin/main` and every lane it prints (expected:
  `./boga test fast`, `./boga test frontend`, which includes
  `ios-groups-e2e`); plus `./boga test handles`.
- Durations only from `./boga timings`.

## Completion note

- What changed:
- What tests ran:
- What remains:
