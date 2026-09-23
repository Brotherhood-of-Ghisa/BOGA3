---
task_id: T-20260923-01-Group_exercise_unlink_UX
status: planned
ui_impact: "yes"
areas: "frontend, groups"
runtimes: "expo, maestro, supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; ./boga test groups-leaderboards; additional gates from ./boga test for"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/ui/screen-map.md, docs/specs/ui/ux-rules.md, docs/specs/ui/components-catalog.md"
---

# Discoverable group exercise unlinking, with certifications preserved

- **Status:** planned; this card does not implement the feature.
- **Decision date:** 2026-09-23.
- **Origin:** user agreement in this conversation; group-row discoverability feedback recorded in [PR #312](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/312).
- **Baseline:** `origin/main` at `71055ca4`; fetched before authoring. The group UI, local link repository, certification SQL, and regression tests were inspected. Recheck these paths before implementation.
- **Delivery:** one focused implementation PR. This is a standalone task, with no milestone dependency.

## Objective

Let a member unlink one of their personal exercises directly from the group's
Exercises list, without finding the catalogue or recorder menu. Explain that
the exercise's sets leave the group's All and Certified leaderboards while
past activity and existing certifications remain.

Reuse the existing unlink and sync behavior. The task is a discoverability and
feedback improvement, not a new historical eligibility model.

## References and verified behavior

- [Group contract](../../specs/tech/groups-contract.md): §2.5 session sharing; §2.11 boards and certification; §6.3 linking UI; §10 P2, P4, P12, P16 and D8.
- [UX delivery standard](../../specs/08-ux-delivery-standard.md), [UI documentation](../../specs/ui/README.md), and [AI design policy](../../specs/ui/ai-design-policy.md).
- [Test gates](../../specs/02-quality-and-test-gates.md) and [project structure](../../specs/09-project-structure.md).
- [Local link repository](../../../apps/mobile/src/data/exercise-group-links.ts): `unlinkExercise(personalExerciseId, groupId)` tombstones only that member's mapping and queues normal sync.
- [Existing Link screen](../../../apps/mobile/app/exercise-link.tsx): already provides unlink from catalogue/recorder entry points.
- [Certification regression](../../../supabase/tests/groups-certification.sh): the `non-voiding changes: unlink / relink` section checks that certification survives, its Certified entry leaves, and relinking restores the entry.
- [Board regression](../../../supabase/tests/groups-boards.sh): R5 covers retroactive linking, partial unlink, retargeting, and no record void caused by unlink.

### Agreed product rules

1. A certification attests a particular set under a particular group exercise.
   Its stored group-exercise association survives removal of the personal
   exercise's current link. Unlink must not delete, cancel, or void it.
   Preserve existing record-card viewing/certification eligibility; do not add
   a new requirement for a currently active personal link.
2. Renaming the same personal exercise changes neither its link nor its
   certification or leaderboard eligibility. Creating another personal exercise
   creates a different identity; certifications do not transfer to its sets.
3. Linking is retroactive for already-shared eligible sets. Unlinking removes
   that personal exercise's contribution to the target group's All and Certified
   boards after sync/evaluation. Another still-linked exercise can supply the
   member's next-best entry, so the member need not disappear from the board.
4. Session sharing is independent of exercise links. Unlinking neither removes
   past shared sessions/completed record activity nor stops future session
   sharing. It is not a privacy or session-delete action.
5. Relinking the same personal exercise to the same group exercise restores
   eligibility, including still-valid certifications on the original sets.
   It does not revive withdrawn, cancelled, or voided certifications.
6. Existing set-edit/delete invalidation, membership access, archived-board
   freezing, and provisional-record rules remain governed by the group contract.

## Scope

**Include:** group-row unlink affordance; selection of one personal link when
several exist; shared confirmation wording across new and existing entry points;
local success/error/loading states; regression and device evidence.

**Exclude:** stop-future-only linking, link history/date windows, certification
transfer, bulk unlink, deleting exercises or sessions, changing group exercise
ownership, changing ranking/sharing rules, schema migrations, and redesigning
the group screens beyond the controls needed here.

## UX Contract

### Accepted design target

Repository-native brief: the flows below extend the current group exercise
rows, sheets, buttons, and notices. Existing production styling governs their
appearance; no external design artifact is required. Before implementation,
capture the current group Exercises list and existing Link screen as visual
references. Capture the implemented states at matching viewport sizes and
compare them; record material deviations in the PR per the AI design policy.

### Key user flows

1. **Unlink one personal exercise from the group list**
   - **Trigger:** Groups → My groups → select a group → Exercises; a row has
     exactly one of my personal exercises linked.
   - **Steps:** show a separate, visible `Unlink…` control beside/below the link
     status. Tap it to open the confirmation below; `Cancel` or dismissal writes
     nothing. `Unlink` removes only the identified personal-exercise/group link.
   - **Success outcome:** remain on the group page, reload local links, show
     `Not linked`, restore the existing `Link your exercise` action on active
     group exercises, and show a success notice. Server boards update through
     normal sync/evaluation, not by editing their local cache.
   - **Failure/edge outcome:** a failed write keeps the link and shows an inline
     error with a retry path. Disable repeat submission while the write is
     pending. Offer no unlink while the local link read is loading/failed;
     provide a retry for a failed link read instead of presenting `Not linked`.

2. **Choose one of several linked personal exercises**
   - **Trigger:** tap `Unlink…` on a row with multiple personal links.
   - **Steps:** open a sheet titled `Your linked exercises`, showing the group
     exercise and group names, then each personal exercise with its own `Unlink`
     action. Selecting one opens the same confirmation. Dismiss the chooser
     before presenting the confirmation; cancellation returns to the group list.
   - **Success outcome:** only the selected mapping is removed. The group row
     continues to list remaining links and offer `Unlink…`. Reopening the chooser
     reads the refreshed links. Never silently unlink every mapped exercise.
   - **Failure/edge outcome:** identify mappings by stable IDs, never display
     names or array position. Duplicate names need visible distinguishing context;
     missing names use `Unnamed personal exercise` plus a short identifier. A
     deleted personal exercise's existing mapping remains removable. If a mapping
     vanished or moved since selection, refresh and explain that state changed;
     do not remove a different mapping under an old confirmation.

3. **Confirm consistently from every entry point**
   - **Trigger:** unlink from the new group row or the existing Link screen
     reached through the catalogue/recorder menu.
   - **Steps:** use one shared confirmation formatter with personal exercise,
     group exercise, and group context:

     > **Unlink “[personal exercise]”?**
     > Its sets will stop counting towards “[group exercise]” in “[group]” on
     > both All and Certified leaderboards. Past activity and existing
     > certifications will be kept. Leaderboards update after syncing.

     Buttons: `Cancel` and destructive `Unlink`.
   - **Success outcome:** `Unlinked “[personal exercise]” from “[group exercise]”.`
     Keep the existing route and return behavior of the Link screen.
   - **Failure/edge outcome:** current members can manage their own links
     regardless of member/admin/owner role. This is separate from the admin-only
     Rename/Archive actions and never exposes another member's mappings.

4. **Unlink offline and from frozen targets**
   - **Trigger:** a locally available mapping is selected while offline, or
     the existing Link screen shows an archived/inactive target.
   - **Steps:** allow the same local unlink write offline; retain the offline
     marker and append `Leaderboards will update after you reconnect and sync.`
     to the success notice. Do not route this through the online-only group RPC
     action helper. Existing local write/sync handling is the only queue.
   - **Success outcome:** local link status updates immediately; other devices
     and boards converge normally after syncing. A later link-read failure must
     not be misreported as a failed write or a confirmed unlinked read state.
   - **Failure/edge outcome:** preserve existing ability to remove an archived
     or inactive personal link. For archived targets, replace the immediate
     leaderboard-effect sentence with `Archived leaderboards stay unchanged;
     this link change takes effect if the exercise is unarchived.` For inactive
     membership use `Leaderboards stay unchanged while you are not a member;
     this link change takes effect if you rejoin.` Retain the preservation
     sentence. When both apply, state both conditions. Never offer a new link to
     an archived target or promise an immediate change to its frozen board.

### Interaction and appearance notes

- Reuse `UiButton`, `UiText`, the current group row, sheet and notice components,
  and the existing UI tokens. No new typography/palette or raw style exceptions.
- Personal-link actions remain independently accessible from the admin row
  press target; do not nest a button inside an accessible row that swallows it.
- Use at least 44 pt touch targets, explicit accessibility labels identifying
  the personal/group exercise, and text in addition to destructive color.
- Allow long names to wrap on small phones; keep chooser content scrollable
  and restore focus to the launching row after dismissal.

## Implementation boundaries

- Expected UI: `components/groups/group-exercises-page.tsx`,
  `group-exercise-row.tsx`, an optional small linked-exercise sheet, and
  `app/exercise-link.tsx` for consistent confirmation/notice wording.
- Expected client model: `src/groups/exercise-view-model.ts`,
  `use-my-group-exercise-links.ts`, and `link-view-model.ts`. The current row
  projection drops personal IDs; retain them or resolve from `allLinks` rather
  than attempting to unlink by the group-exercise ID/name.
- Reuse the local repository operation and shared sync notifications. Recheck
  the selected target before mutation; if an atomic expected-target guard is
  needed to prevent stale-confirmation races, add a narrowly scoped repository
  guard and its test, then run its additional path-triggered gates.
- Do not change server certification/board semantics to make a UI test pass.
  Report any discovered mismatch against the agreed rules with a reproducer.

## Acceptance and verification

- Every UX flow above has a success and cancellation/error assertion where
  applicable. Cover zero/one/multiple links, all member roles, stable selection
  with duplicate/missing names, a stale selection, failed local reads/writes,
  pending taps, archived/inactive targets, and offline local success in Jest.
- Use the existing tests nearest the behavior: `groups-exercise-screens`,
  `groups-exercise-view-model`, `groups-exercise-link-screen`, and
  `groups-link-view-model`; extend repository coverage only if that code changes.
  Read the test directory's `README.md` before editing tests.
- Extend the existing `ios-groups-e2e` flow with a certified set: cancel unlink
  (no change), unlink from the new group-row control, sync/refresh, verify its
  All and Certified contribution leaves, verify the completed record activity
  and the same active certification remain, relink, and verify eligibility
  returns without recertification. Include a second personal link to prove it
  is not removed. Use backend assertions for certification identity as needed.
- Reuse `groups-boards.sh` R5 and `groups-certification.sh` unlink/relink coverage
  as backend proof; extend only if the new acceptance cases reveal a real gap.
- Record screenshots on small and large iPhones for the linked row, multiple
  link chooser, confirmation, success, and an error/offline state. Record both
  interaction/accessibility checks and comparison with the baseline captures.

Required implementation checks, all local:

```bash
./boga test for
./boga test fast
./boga test frontend
./boga test groups-leaderboards
```

`frontend` includes the two-user `ios-groups-e2e` lane; report its result
explicitly. `groups-leaderboards` is an additional acceptance check because
certification preservation is central to this task. If backend tests or
`src/data/**` change, run `./boga test backend` as required by `test for`;
that gate includes `groups-leaderboards`, so a separate duplicate run is not
needed. Sync/auth changes require their additional gates and are not expected.
Follow `docs/specs/11-maestro-runtime-and-testing-conventions.md` and
`apps/mobile/README-maestro.md` when extending device coverage.

This planning-only change requires `./boga test docs-check`; future runtime
checks listed above are acceptance requirements, not claimed results.

## Documentation and closeout

- Update `docs/specs/tech/groups-contract.md` §6.3/E0.4 with the new entry point
  and preserved semantics; retain P4's retroactive link/unlink rule.
- Update `docs/specs/ui/screen-map.md`, `ux-rules.md`, and
  `components-catalog.md` for the controls, confirmation, and component API.
  No new route is planned; update `navigation-contract.md` if that changes.
- Record test and screenshot evidence, deviations, and flow-to-test coverage
  in the implementation PR. Follow `./boga test for` and validate its body with
  `./boga pr check --body <file>` before opening it.
- Mark the feedback implemented only when the UX and preservation checks pass.
  Delete this task card in the PR that ships it; durable rules stay in specs.
