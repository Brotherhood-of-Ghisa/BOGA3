---
task_id: T-20260802-02-History_exercise_sortable_table
milestone_id: "MVP"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend && ./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md"
---

# Make By Exercise History a Sortable Table

## Task metadata

- Task ID: `T-20260802-02-History_exercise_sortable_table`
- Title: Make the Stats / History By Exercise display a sortable table
- Status: `planned`
- File location rule:
  - active card lives at
    `docs/tasks/T-20260802-02-History_exercise_sortable_table.md`
  - move it to `docs/tasks/complete/` when completed or outdated
- Session date: 2026-08-02
- Session interaction mode: `interactive`
- Branch/PR contract:
  - implement and close this card on the existing
    `codex/history-set-failure-implementation` branch
  - do not create another implementation branch or PR
  - preserve the completed History set/failure, Sessions loading, and control
    hierarchy work already committed on this branch
  - validate the cumulative branch diff, not only the files changed for this
    card

## Parent references (required)

- Project directives: `AGENTS.md`, `docs/specs/README.md`
- Milestone spec: N/A - user-requested Stats / History refinement on the
  existing MVP implementation branch.
- Related completed work:
  - `docs/tasks/complete/T-20260726-01-History_set_and_failure_counts.md`
  - `docs/tasks/complete/T-20260726-02-History_muscle_failure_bars.md`
  - `docs/tasks/complete/T-20260802-01-Fix_sessions_loading_and_history_controls.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness (required at session start; update before edits)

- Verified implementation branch + pre-task-card HEAD commit:
  `codex/history-set-failure-implementation` at
  `2d9b8e63421ab80e083bb5ed102d8563cfb35927`.
- Start-of-session sync with `origin/main` completed?: `N/A`; this card must be
  implemented on the current cumulative branch. Do not rebase or recreate the
  branch as part of this task without explicit user direction.
- Parent refs opened while authoring this card:
  - `AGENTS.md`
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/tasks/README.md`
- Code/docs inventory freshness checks run on 2026-08-02:
  - `apps/mobile/app/(tabs)/stats-history.tsx`: By Exercise currently renders a
    flat list of whole-row `Pressable` cards. Each row repeats small `Sets`,
    `Volume`, and optional `1RM` labels instead of aligning values beneath a
    common header.
  - `sortExerciseListItems` currently applies one fixed order: valid performed
    set count descending, then exercise name ascending.
  - `ExerciseListItem` currently contains name, all-set count, working-set
    count (stored as `nearFailureCount`), volume, and optional estimated 1RM,
    but not the last-completed timestamp.
  - `apps/mobile/src/data/exercise-catalog-stats.ts` already exposes
    `lastCompletedAtById` for every exercise with valid completed history. The
    route can map that value into its display item; no extra query, schema, or
    aggregate pass is required.
  - `apps/mobile/app/__tests__/stats-screen.test.tsx` has focused coverage for
    the current fixed sorter, row metrics, row press behavior, Breakdown
    controls, search reset, and history overlay.
  - `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml` already enters the By
    Exercise view and is the preferred focused flow to extend for table/sort
    interaction evidence.
  - `docs/specs/ui/ux-rules.md` and `docs/specs/ui/screen-map.md` currently
    document fixed set-count-descending ordering and must change with the new
    table contract.
- Known stale references or assumptions:
  - The request calls the first column `Exercise` but describes its two sort
    states as recency, not alphabetical name order. This card therefore treats
    that header as **exercise recency**: most recently trained, then least
    recently trained.
  - The request says every header is clickable but does not define the `1RM`
    cycle. This card uses the conventional numeric cycle: highest estimated
    1RM first, then lowest, with unavailable values last in both directions.
  - `W/Sets` means the existing valid confirmed `RIR 0`, `RIR 1`, or `RIR 2`
    working-set subset currently held in `nearFailureCount`; it does not add a
    new metric.
  - The implementation session must refresh this inventory and run
    `./boga test for` before edits because the branch may advance after this
    card is committed.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260802-02-History_exercise_sortable_table.md`

## Objective

Replace the Stats / History **By Exercise** card-like list with a compact,
readable table whose columns are `Exercise`, `Sets (W/Sets)`, `Volume`, and
`1RM`. Make each header the only sort control for its column, provide
predictable click cycles, and clearly communicate the active sort without
adding a toolbar, menu, button row, or extra toggle.

## Scope

### In scope

- Render one shared header row above the exercise data rows with aligned
  columns for `Exercise`, `Sets (W/Sets)`, `Volume`, and `1RM`.
- Remove repeated visual metric labels from each exercise row while preserving
  complete accessible row descriptions.
- Make all four headers pressable with the exact cycles in this card.
- Add a subtle text-only status above the header row describing the active
  field and direction.
- Show a compact direction/active-metric indicator in the active header so the
  control remains understandable where the interaction occurs.
- Preserve whole-row press behavior for opening the exercise history overlay.
- Reuse the existing all-time last-completed timestamp for recency sorting.
- Keep sorting local and synchronous; header presses must not query or mutate
  stored data.
- Add deterministic pure-sort/state-cycle coverage, screen interaction and
  accessibility coverage, focused Maestro evidence, and canonical UI docs.

### Out of scope

- Adding a sort toolbar, dropdown, menu, modal, chips, radio group, or saved
  user preference.
- Alphabetical sorting. The `Exercise` header cycles through most/least recent
  because that is the requested behavior.
- Changing the selected 7-/30-day metrics, exercise inclusion rule, working-set
  definition, volume formula, estimated-1RM formula, or default Breakdown mode.
- Changing By Muscle rows, either heatmap overlay, summary cards, Sessions, or
  the Time range / Breakdown controls.
- Adding a repository query for each sort or moving display sorting into SQL.
- Persisting sort state across app restarts or devices.
- Schema, migration, Supabase, RLS, sync-envelope, or backend API changes.
- Introducing a general-purpose data-table library or native dependency.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- By Exercise changes from vertically separated name/metric blocks to a
  column-aligned table with interactive headers.
- The table must remain legible on the supported phone width without horizontal
  scrolling. The exercise column is flexible; numeric columns are compact,
  consistently aligned, and use the same widths in the header and every row.
- Existing row press, search, loading, error, empty, overlay, and Breakdown
  interactions remain unchanged.

## UX Contract

### Key user flows

1. Flow name: Understand the current exercise ordering
   - Trigger: user opens Stats / History in By Exercise mode.
   - Steps: user reads the subtle status line and scans the active table header.
   - Success outcome: the initial table is visibly described as `Sorted by:
     Sets — high to low`; the `Sets (W/Sets)` header is visibly active.
   - Failure/edge outcome: sorting remains understandable without relying on
     color, an unexplained arrow, or memory of the previous click.
2. Flow name: Sort exercises by recency
   - Trigger: user presses the `Exercise` header.
   - Steps: first press orders the most recently trained exercises first;
     pressing the already-active header again orders the least recent first.
   - Success outcome: the status and header indicator update immediately, rows
     reorder without loading, and row presses still open the correct exercise.
   - Failure/edge outcome: equal timestamps remain deterministic; unavailable
     timestamps remain at the bottom.
3. Flow name: Cycle all-set and working-set ordering
   - Trigger: user presses `Sets (W/Sets)`.
   - Steps: repeated presses on the active header cycle all sets high-to-low,
     all sets low-to-high, working sets high-to-low, then working sets
     low-to-high before repeating.
   - Success outcome: the status explicitly says either `Sets` or `Working
     sets` plus direction so the four states are never ambiguous.
   - Failure/edge outcome: tied values use deterministic name/ID tie-breakers,
     and the displayed `<sets> (<working sets>)` pair does not change.
4. Flow name: Sort numeric metrics
   - Trigger: user presses `Volume` or `1RM`.
   - Steps: the first press on a newly active numeric header sorts high-to-low;
     the second press sorts low-to-high, then repeats.
   - Success outcome: sorting is immediate and the active status/indicator
     follows the chosen metric.
   - Failure/edge outcome: missing 1RM values remain at the bottom in both
     directions and display as `—` so table alignment is preserved.

### Interaction + appearance notes

- Show a quiet text status directly above the table header, for example
  `Sorted by: Working sets — high to low`. It is informative text, not another
  control.
- Keep the visible header labels exactly `Exercise`, `Sets (W/Sets)`, `Volume`,
  and `1RM`. The active Sets header may add a small secondary indicator such as
  `Sets ↓` or `W/Sets ↑` without changing its canonical label.
- Use compact up/down indicators in the active header and no indicators in
  inactive headers. Always pair the indicator with text/accessibility wording.
- Make the full header cell tappable with the standard minimum touch target;
  avoid adding standalone sort icons that create extra touch targets.
- Keep the exercise name flexible at up to two lines. Right-align numeric data,
  align all cells under their headers, and render missing 1RM as `—`.

## Sort state contract

### Initial state

- Default to `Sets — high to low`, preserving the current fixed ordering.
- The initial status line reads `Sorted by: Sets — high to low`.

### Header cycles

- `Exercise`:
  1. most recent first
  2. least recent first
  3. repeat
- `Sets (W/Sets)`:
  1. all valid performed sets, high to low
  2. all valid performed sets, low to high
  3. working sets, high to low
  4. working sets, low to high
  5. repeat
- `Volume`:
  1. highest volume first
  2. lowest volume first
  3. repeat
- `1RM`:
  1. highest estimated 1RM first
  2. lowest estimated 1RM first
  3. repeat

### State transitions and tie-breakers

- Pressing the currently active header advances exactly one step in that
  header's cycle.
- Pressing a different header activates that header at its first state, rather
  than remembering a prior state from that header.
- Changing Time range, search text, or Breakdown and returning to By Exercise
  preserves the selected sort for the lifetime of the mounted screen.
- Recalculate numeric ordering when Time range changes; do not preserve stale
  sorted arrays.
- Recency uses `lastCompletedAtById`: the latest valid performed set in a
  completed, non-deleted session across available history. It is intentionally
  independent of the selected metric window so exercises outside 7/30 days can
  still be meaningfully ordered.
- Missing recency and missing estimated 1RM sort after present values in both
  directions.
- Every primary tie uses exercise name ascending with locale-aware comparison;
  identical names use stable exercise ID ascending.
- The sort helper must return a new array and never mutate route props or data
  maps.

### Status copy

- Use these exact concepts, with equivalent punctuation allowed:
  - `Sorted by: Most recent exercise`
  - `Sorted by: Least recent exercise`
  - `Sorted by: Sets — high to low`
  - `Sorted by: Sets — low to high`
  - `Sorted by: Working sets — high to low`
  - `Sorted by: Working sets — low to high`
  - `Sorted by: Volume — high to low`
  - `Sorted by: Volume — low to high`
  - `Sorted by: 1RM — high to low`
  - `Sorted by: 1RM — low to high`
- Announce status changes politely to screen readers without moving focus.
- Each header's accessible label states the current sort when active and the
  sort that activation will apply next.

## Acceptance criteria

1. By Exercise displays one aligned header row labelled `Exercise`,
   `Sets (W/Sets)`, `Volume`, and `1RM` above the data rows.
2. Per-row visual metric labels are removed; values remain aligned under the
   shared headers and complete in each row's accessibility label.
3. The table fits the supported phone viewport without horizontal scrolling,
   overlapping text, or metric values changing columns between rows.
4. The whole exercise row remains the sole action for opening that exercise's
   history overlay; header presses never open an overlay.
5. Initial ordering remains all-set count descending, with the status
   `Sorted by: Sets — high to low` and the Sets header visibly active.
6. The Exercise header cycles most-recent-first then least-recent-first using
   `lastCompletedAtById`, with no new data query.
7. The Sets header follows the exact four-state all-set/working-set cycle and
   repeats after the fourth press.
8. Volume cycles high-to-low then low-to-high.
9. 1RM cycles high-to-low then low-to-high; unavailable values display as `—`
   and sort last in both directions.
10. Selecting a different header always starts at that header's first state;
    pressing the active header advances one state exactly once.
11. Time-range and search changes preserve the active sort choice, recompute
    order from current items, and do not create loading/query activity.
12. Every sort is deterministic using name then ID tie-breakers, and no helper
    mutates the input array.
13. A subtle non-interactive status above the header names the active sort
    metric and direction, including whether the Sets column is sorting all
    sets or working sets.
14. The active header has a compact direction/state indicator; inactive
    headers do not show misleading direction indicators.
15. Headers meet minimum touch-target and accessibility requirements, expose
    button semantics, and announce both active and next sort states without
    relying on arrows or color alone.
16. Loading, error, empty, filtering, Breakdown switching, exercise-row
    navigation, heatmap overlay, and metric calculations remain unchanged.
17. No toolbar, dropdown, menu, sort chip, extra toggle, table dependency, raw
    color literal, schema change, or sort-specific database query is added.
18. Canonical UI docs describe the table columns, default order, click cycles,
    status/indicator contract, recency source, and missing-value behavior.

## Docs touched (required)

- Planned docs/spec files to update:
  - `docs/specs/ui/ux-rules.md` - replace the fixed By Exercise order with the
    sortable-table interaction, cycles, status copy, accessibility, recency,
    and missing-value contracts.
  - `docs/specs/ui/screen-map.md` - replace the flat-list/fixed-sort summary
    with the four-column table and header-driven sorting states.
- UI docs update required?: `yes`; the task changes current screen structure
  and interaction behavior, invoking the UI behavior/state maintenance rules
  in `docs/specs/ui/README.md`.
- `docs/specs/ui/components-catalog.md`: no update expected; keep the header and
  status route-local unless implementation reveals a genuine existing shared
  primitive contract that must change.
- `docs/specs/ui/navigation-contract.md`: no update; no route, parameter,
  redirect, overlay destination, or transition changes.
- `docs/specs/03-technical-architecture.md`: no update; no dependency, runtime,
  or architectural decision changes.
- `docs/specs/05-data-model.md`: no update; the existing transient
  `lastCompletedAtById` value is consumed without persistence changes.
- `docs/specs/06-testing-strategy.md`: no update; coverage stays within
  existing unit/screen and Maestro layers.
- Tokens/primitives compliance statement:
  - Reuse plan: existing typography, spacing, border, surface, pressed-state,
    muted-text, and focus/accessibility patterns. Compose header cells from
    existing `Pressable`, `Text`, and `View` primitives.
  - Exceptions: route-local table grid widths and sort state are justified
    because this is the only four-column exercise summary. No raw color or
    duplicate global button styling is allowed.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`.
  - Planned captures: initial Sets-descending table; Exercise most-recent
    table; working-sets sort state; Volume ascending; 1RM state with at least
    one unavailable value if fixture data permits.

## Testing and verification approach

- Planned focused Jest command, from `apps/mobile/`:
  - `npm test -- --runInBand app/__tests__/stats-screen.test.tsx`
- Required pure coverage:
  - every state in each header cycle and wraparound
  - switching headers starts at the new header's first state
  - recency ascending/descending, equal timestamps, and missing timestamps
  - all-set and working-set ascending/descending
  - volume and 1RM ascending/descending
  - missing 1RM always last
  - name then ID tie-breakers
  - input array remains unchanged
- Required screen coverage:
  - four aligned header labels and one non-interactive status line
  - initial Sets-descending state
  - each press cycle updates row order, status copy, active indicator, and
    accessible current/next state exactly once
  - time-range/search changes preserve the active mode and re-sort current data
  - missing 1RM renders `—`
  - row presses still target the correct exercise after reordering
  - loading/error/empty states and overlay interaction remain intact
- Data-layer coverage:
  - reuse the existing `lastCompletedAtById` contract. Extend
    `apps/mobile/app/__tests__/exercise-catalog-stats.test.ts` only if the route
    cannot consume that established value without changing its contract.
- Additional targeted checks, from `apps/mobile/`:
  - `npm run typecheck`
  - `npm run lint:ui-guardrails`
- Maestro coverage:
  - extend `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml` to assert the
    four headers, initial status, at least one Sets cycle transition, Exercise
    recency transition, another numeric column transition, and screenshots
  - prefer stable table-row IDs/order assertions over coordinate taps
  - run `./boga test meta-tests` after flow changes
- Test layers covered: pure state machine/comparator, route/screen rendering
  and accessibility, row-navigation regression, and local iOS interaction and
  visual evidence.
- Slow-gate triggers:
  - route/component/flow changes require `./boga test frontend`
  - the cumulative branch contains backend-triggering History data changes, so
    `./boga test backend` remains required before branch closeout
- Hosted/deployed smoke ownership: N/A; no hosted or deployment behavior.
- CI/manual posture note: local gates and simulator evidence are mandatory and
  are not replaced by CI.
- Before claiming any lane is unavailable, run `./boga doctor` and repair the
  local bootstrap gap. Do not state a duration without `./boga timings`
  evidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/stats-history.tsx`
  - `apps/mobile/app/__tests__/stats-screen.test.tsx`
  - `apps/mobile/.maestro/flows/stats-view-toggle-ux.yaml`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `apps/mobile/app/__tests__/exercise-catalog-stats.test.ts` only if the
    established last-completed contract genuinely needs added regression
    coverage
- Recommended implementation shape:
  - define a closed `ExerciseSortMode` union for the ten states in this card
  - keep one pure `nextExerciseSortMode(activeMode, pressedHeader)` transition
    helper and one pure non-mutating comparator/sort helper
  - add `lastCompletedAt: Date | null` to the display item and populate it from
    `exerciseCatalogStats.lastCompletedAtById`
  - keep sort state at the Stats screen/shell level so search, period, and
    Breakdown changes do not reset it during the mounted session
  - filter current items, then derive the ordered array with `useMemo`
  - render one route-local grid definition shared by header and rows so cells
    cannot drift
- Do not overload the existing data-layer recency score. The requested order
  is the latest completion timestamp, not the weighted recency score used by
  the exercise catalogue's `recents-on-top` preference.
- Keep `nearFailureCount` storage naming unchanged unless a broader already-
  planned rename exists; label it `W/Sets` / `Working sets` at the UI boundary.
- Project structure impact: none; no new directory or ownership convention.
- Native dependency/config impact: none.
- Data/sync impact: none; this consumes an existing transient map and changes
  no entity, migration, sync scope, or backend API.

## Mandatory verify gates

- Run the focused Jest, typecheck, UI guardrail, and Maestro checks above.
- Run `./boga test for` against the final cumulative branch diff and follow its
  complete lane result.
- Expected cumulative branch gates based on the current branch:
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test frontend`
  - `./boga test docs-check`
  - `./boga test meta-tests`
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260802-02-History_exercise_sortable_table.md`
  before handoff, using the completed-card path if the helper is run after
  moving the card.

## Evidence

- Focused pure/screen test output for every cycle, direction, missing-value
  rule, tie-breaker, and non-mutating sort behavior.
- Screen test output proving the table/header/status semantics and correct row
  navigation after reordering.
- Maestro captures listed in `Docs touched`, including a Working sets state
  where the status removes any ambiguity from the four-state header cycle.
- Final `./boga test for` output plus evidence for every required local lane.
- UI/UX visual artifacts: required as described above.
- Manual verification summary: record simulator/device, table fit, long-name
  behavior, touch targets, every click cycle, search/period preservation, and
  row-overlay behavior.
- Deferred/manual hosted checks: N/A.

## Execution plan

1. Bootstrap the card, refresh required parent refs and code inventory, verify
   the current branch/HEAD, and run `./boga test for` before editing.
2. Add the closed sort-state model and failing pure tests for every cycle,
   missing-value rule, tie-breaker, and input immutability contract.
3. Map the existing last-completed timestamp into exercise display items and
   implement deterministic local sorting without new queries.
4. Add failing screen tests, then build the aligned header/status/row grid and
   accessible header interactions while preserving row-overlay behavior.
5. Extend the focused Maestro flow and update canonical UI docs.
6. Run focused checks, inspect simulator captures at supported width/dynamic
   type, run every lane required by the final cumulative diff, fill evidence
   and completion notes, move the card to `docs/tasks/complete/`, and commit on
   the same branch.

## Risks and rollback

- Risk: four states behind one Sets header are hard to discover. Mitigation:
  show explicit `Sets` versus `Working sets` status text plus direction, and
  make the active header describe the next activation accessibly.
- Risk: table columns become cramped on smaller phones or with long values.
  Mitigation: use one shared responsive grid, a flexible two-line exercise
  cell, compact right-aligned metric cells, `—` placeholders, and simulator
  captures before closeout.
- Risk: 1RM null handling reverses unexpectedly on ascending sort. Mitigation:
  treat missing values as a separate bucket that is always last and cover both
  directions.
- Risk: changing period/search resets state or reuses stale ordering.
  Mitigation: model selection separately from derived sorted items and cover
  both transitions.
- Risk: the route accidentally uses weighted catalogue recency instead of last
  use. Mitigation: consume `lastCompletedAtById` explicitly and test timestamps
  whose weighted scores would produce a different result.
- Rollback boundary: route-local display/sort state, route tests, one Maestro
  flow, and two UI docs. No migration or destructive rollback is required.

## Completion note

- What changed: pending implementation.
- What tests ran: pending implementation.
- What remains: all work in this planned card.

## Status update checklist (mandatory at closeout)

- Update `Status` and frontmatter `status` to `completed`, `blocked`, or
  `outdated`.
- If completed or outdated, move this file to `docs/tasks/complete/` in the
  same commit and update affected references.
- Fill the completion note and evidence with measured commands/results.
- Update the listed canonical UI docs and keep them synthetic/source-linked.
- Re-run `./boga test for` and every required lane on the cumulative branch.
- Run the task closeout helper and record its result before handoff.
