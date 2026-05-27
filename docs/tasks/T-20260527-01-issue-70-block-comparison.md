---
task_id: T-20260527-01-issue-70-block-comparison
milestone_id: "M1"
status: in_progress
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A unless fixture/runtime selectors change; otherwise run the exercise-block-history Maestro fixture for visual evidence"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/components-catalog.md if a reusable component is extracted"
---

# Task Card

## Task metadata

- Task ID: `T-20260527-01-issue-70-block-comparison`
- Title: Issue 70 phase 1 - collapsible previous/current block comparison in recorder
- Status: `in_progress`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-27`
- Session interaction mode: `interactive (default)`
- Suggested implementation branch: `codex/issue-70-block-comparison`
- Issue context:
  - GitHub Issue: `https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/70`
  - Parent completed slice: `docs/tasks/complete/T-20260526-01-issue-70-exercise-block-history.md`
  - Phase 0A shipped a compact previous-block panel. Phase 1 responds to visual-density feedback and turns the panel into a useful comparison between the selected historical block and the current in-progress exercise block.

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M1-ui-session-recorder.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: Agent 2A started on `main` at `3168ca0` after `git fetch origin main && git pull --ff-only origin main` confirmed already up to date.
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` for Agent 2A implementation.
- Parent refs opened in this Agent 2A session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `docs/tasks/complete/T-20260526-01-issue-70-exercise-block-history.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260527-01-issue-70-block-comparison.md` - confirmed branch/task metadata and required gates at `3168ca0`.
  - `rg -n "exercise-block-history|loadRecentExerciseBlocks|Previous blocks|Near failure" docs apps/mobile -S` - confirmed Phase 0A implementation/docs/test surfaces.
  - Source review of `apps/mobile/app/(tabs)/session-recorder.tsx`, `apps/mobile/src/data/exercise-block-history.ts`, `apps/mobile/src/exercise-calculations/index.ts`, and `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`.
- Known stale references or assumptions:
  - Assumption: current-session comparison metrics should use the same calculation semantics as Phase 0A history metrics: warm-up sets excluded, invalid/blank set inputs ignored, estimated 1RM via existing Wathan helper, highest weight from eligible parsed sets, and `Near failure` from valid sets marked `rir_0`, `rir_1`, or `rir_2`.
- Optional helper command (recommended):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260527-01-issue-70-block-comparison.md`

## Objective

Refine the recorder's Issue 70 block-history panel so it is less visually heavy, can be hidden per exercise card, and compares the selected previous completed-session block against the current unsaved exercise block as the user logs sets.

## Scope

### In scope

- Add per-exercise show/hide control for the block comparison panel.
- Replace the Phase 0A metric grid with a cleaner previous/current comparison layout.
- Compute current unsaved exercise metrics live from the exercise card's set rows.
- Preserve previous-block loading, empty, error, and `<<` older / `>>` newer behavior.
- Keep all block-comparison state volatile and local to recorder UI.
- Update recorder interaction tests and UI docs.
- Capture visual evidence for expanded comparison, collapsed state, and empty/error handling.

### Out of scope

- Persisting collapse preferences.
- Adding any new local schema column, backend schema field, sync event, or outbox behavior.
- Adding percent deltas, trend badges, PR claims, or analytics beyond the current four Phase 0A metrics.
- Changing the Phase 0A repository query contract unless a narrowly scoped bug is found and covered by tests first.
- Reworking the whole exercise card layout outside the block-history/comparison area.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- This is a recorder UI refinement and must follow:
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
- Tokens/primitives compliance statement:
  - Reuse plan: use existing `uiColors`, screen-local recorder spacing/type patterns, existing `Pressable` affordances, and existing exercise-block formatting helpers where possible.
  - Exceptions: no new raw color literals in route files. If a one-off style is unavoidable, document file + rationale here before closeout.
- UI docs update plan:
  - Update `docs/specs/ui/ux-rules.md` because recorder block-history semantics change from a read-only previous-block panel to a collapsible previous/current comparison.
  - Update `docs/specs/ui/screen-map.md` because `/session-recorder` key states gain collapsed and current-comparison states.
  - Update `docs/specs/ui/components-catalog.md` only if implementation extracts a reusable component or changes a reusable component API.
  - `docs/specs/ui/navigation-contract.md` should remain unchanged unless route/query/transition behavior changes.

## UX Contract

### Key user flows

1. Flow name: Hide and reveal block comparison
   - Trigger: User has an exercise card with previous block history loaded.
   - Steps: User taps the comparison header control.
   - Success outcome: The detailed comparison collapses to a compact header that does not crowd set entry; tapping again restores the comparison without reloading history.
   - Failure/edge outcome: Loading, empty, and error states are still compact and can be dismissed/revealed without blocking set entry.
2. Flow name: Compare current work to previous block
   - Trigger: User enters or edits set weight, reps, or set type on an exercise card.
   - Steps: Current metrics recalculate from the in-progress sets while the selected previous block remains visible.
   - Success outcome: The user can scan `Previous` and `Current` side by side for `Est. 1RM`, `Volume`, `Highest`, and `Near failure`.
   - Failure/edge outcome: Blank or invalid current inputs render as `-` for missing stats and do not produce noisy validation inside the comparison panel.
3. Flow name: Navigate previous blocks while logging
   - Trigger: User taps `<<` older or `>>` newer in the comparison header/control row.
   - Steps: Previous block changes, current block values remain based on the current unsaved sets.
   - Success outcome: The selected previous values and age/index update; current values do not reset.
   - Failure/edge outcome: Boundary controls are disabled with existing accessibility state and minimum touch target behavior.
4. Flow name: Continue logging when history is unavailable
   - Trigger: Exercise has no previous blocks or history loading fails.
   - Steps: User logs or edits sets normally.
   - Success outcome: The panel remains inline, compact, optionally collapsible, and non-blocking.
   - Failure/edge outcome: Error text stays concise (`Previous blocks unavailable`) and never blocks autosave, submit/save, tags, or set entry.

### Interaction + appearance notes

- Prefer a calm table-like comparison over four standalone metric cards.
- Use `Previous` as neutral/muted and `Current` as the accent column; do not rely on color alone for meaning.
- Keep the collapsed state very compact: a slim `Past blocks` bar only, with no visible Hide/Show button.
- Default behavior: collapsed when history state first appears; tapping the bar expands, and tapping the expanded header collapses.
- Avoid delta badges in this task; side-by-side comparison is enough signal for Phase 1.

## Acceptance criteria

1. Each exercise card with block-history state exposes a per-card hide/show affordance for the comparison panel.
2. Collapsed state preserves enough context to identify that block comparison exists, without showing the full metric table.
3. Expanded populated state shows four rows: `Est. 1RM`, `Volume`, `Highest`, and `Near failure`.
4. Expanded populated state shows both `Previous` and `Current` values for each metric.
5. Current values update live from unsaved recorder set rows when weight, reps, or set type changes.
6. Current metric semantics match Phase 0A history semantics: warm-up sets excluded, invalid/blank set inputs ignored, volume/1RM/highest calculated through existing helpers, `Near failure` counts valid `RIR <= 2` sets.
7. Older/newer navigation updates only the selected previous block values, age/index, and boundary disabled states.
8. Loading, empty, and error states remain inline, compact, accessible, and non-blocking.
9. No persistence, schema, sync, outbox, or backend behavior is added.
10. Screen UI uses documented tokens/primitives/shared patterns, or records a justified exception.
11. No raw color literals are introduced in screen files.
12. Relevant UI docs are updated, or explicit no-update rationale is recorded for docs that do not need changes.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/ui/ux-rules.md` - update recorder block-history rule for collapsible previous/current comparison semantics.
  - `docs/specs/ui/screen-map.md` - update `/session-recorder` key states for collapsed/expanded comparison and live current metrics.
  - `docs/specs/ui/components-catalog.md` - update only if a reusable component is extracted or a reusable API changes; otherwise record no-update rationale in completion note.
  - `docs/specs/ui/navigation-contract.md` - expected no update because no route, param, query, redirect, or transition behavior should change.
  - `docs/specs/05-data-model.md` - expected no update because this task must not change data model boundaries; record `no data-model change` in completion note.
  - `RUNBOOK.md` - expected no update unless the implementation changes local run/test/debug command surfaces or fixture flows.
- UI docs update required?: `yes`
- Tokens/primitives compliance statement:
  - Reuse plan: existing recorder styles, `uiColors`, existing calculation/format helpers, existing test IDs/accessibility conventions.
  - Exceptions, if any: fill during implementation.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts: expanded populated comparison, collapsed state, and empty/error state. Prefer the existing checked-in exercise-block-history Maestro fixture if available; otherwise capture equivalent simulator or rendered-test evidence and document any runtime blocker.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx app/__tests__/exercise-block-history.test.ts`
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - `./scripts/quality-fast.sh frontend`
  - Visual evidence run/capture for populated expanded, collapsed, and empty/error states. Preferred when simulator is available:
    - `cd apps/mobile && PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260527-01-issue-70-block-comparison ./scripts/maestro-ios-run-flow.sh --flow .maestro/flows/exercise-block-history-fixture.yaml --scenario exercise-block-history-fixture`
- Test layers covered:
  - React Native Testing Library interaction/state tests for current live metrics, collapse/expand, previous navigation, empty/error non-blocking behavior.
  - Existing service/data tests for historical block aggregation should remain green.
  - Visual/runtime evidence for layout quality when available.
- Execution triggers:
  - Always run targeted recorder interaction tests after UI/state changes.
  - Always run `lint:ui-guardrails` after style changes.
  - Always run `./scripts/quality-fast.sh frontend` before closeout.
- Slow-gate triggers:
  - `./scripts/quality-slow.sh frontend` is not mandatory for this task because no native/runtime dependency or Maestro harness behavior is expected to change.
  - If fixture flow selectors or Maestro harness support change, run the affected Maestro flow and document artifact paths.
- Hosted/deployed smoke ownership:
  - N/A; no backend/hosted changes.
- CI/manual posture note:
  - Current repo has no full CI guarantee. Record all local commands and visual evidence in `Evidence`.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`
  - `apps/mobile/app/__tests__/session-recorder-screen.test.tsx` if broader screen assertions need updates
  - `apps/mobile/app/__tests__/exercise-block-history.test.ts` only if a Phase 0A aggregation bug is found
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/components-catalog.md` only if a reusable component/API changes
- Project structure impact:
  - Expected none. If the implementation extracts a feature component/helper, keep it within the existing mobile ownership boundaries and update UI docs if it becomes reusable.
- Constraints/assumptions:
  - Prefer a small pure helper for current in-progress exercise metrics if it prevents duplication and keeps tests direct.
  - Reuse `computeExerciseVolume`, `computeMaxRepsByWeight`, and `estimateExerciseOneRepMax` rather than hand-rolling formulas in UI code.
  - Normalize/handle set types consistently with Phase 0A; `warm_up` does not count toward metrics and `rir_0`/`rir_1`/`rir_2` count as near-failure when the set parses.
  - Collapse state is keyed by recorder exercise row identity and should reset cleanly when an exercise card is removed or changed.
  - No data model/sync impact: all new state is derived and volatile.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless this task changes Maestro harness/fixture behavior or runtime-sensitive app setup.
- Optional closeout validation helper (recommended before handoff): `./scripts/task-closeout-check.sh docs/tasks/T-20260527-01-issue-70-block-comparison.md`
- Additional gates:
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - Targeted recorder interaction tests listed above.

## Evidence

- Targeted tests:
  - Red check before implementation: `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx` failed on the new comparison/collapse/current-metric assertions against the Phase 0A UI.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx` - passed, 21 tests.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-screen.test.tsx app/__tests__/exercise-block-history.test.ts` - passed, 57 tests.
  - `cd apps/mobile && npm run lint:ui-guardrails` - passed, 0 raw-color violations.
  - `./scripts/quality-fast.sh frontend` - passed (`lint`, `typecheck`, 50 Jest suites / 374 tests).
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260527-01-issue-70-block-comparison.md` - failed as expected for this handoff posture because the task remains `in_progress` per instruction not to close/archive; milestone task line was updated to `in_progress`.
- UI/UX task visual artifacts note:
  - Maestro fixture command passed: `cd apps/mobile && PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260527-01-issue-70-block-comparison ./scripts/maestro-ios-run-flow.sh --flow .maestro/flows/exercise-block-history-fixture.yaml --scenario exercise-block-history-fixture`.
  - Artifact root: `apps/mobile/artifacts/maestro/T-20260527-01-issue-70-block-comparison/20260527-171543-24725`.
  - Default collapsed populated bar: `apps/mobile/artifacts/maestro/T-20260527-01-issue-70-block-comparison/20260527-171543-24725/maestro-output/screenshots/exercise-block-comparison-start-collapsed.png`.
  - Expanded populated comparison: `apps/mobile/artifacts/maestro/T-20260527-01-issue-70-block-comparison/20260527-171543-24725/maestro-output/screenshots/exercise-block-comparison-expanded.png`.
  - Re-collapsed populated bar: `apps/mobile/artifacts/maestro/T-20260527-01-issue-70-block-comparison/20260527-171543-24725/maestro-output/screenshots/exercise-block-comparison-collapsed.png`.
  - Older previous-block navigation: `apps/mobile/artifacts/maestro/T-20260527-01-issue-70-block-comparison/20260527-171543-24725/maestro-output/screenshots/exercise-block-comparison-older.png`.
  - Empty collapsed bar: `apps/mobile/artifacts/maestro/T-20260527-01-issue-70-block-comparison/20260527-171543-24725/maestro-output/screenshots/exercise-block-history-empty-collapsed.png`.
  - Empty expanded state: `apps/mobile/artifacts/maestro/T-20260527-01-issue-70-block-comparison/20260527-171543-24725/maestro-output/screenshots/exercise-block-history-empty-expanded.png`.
  - Error-state visual limitation: no existing Maestro fixture/harness path forces `loadRecentExerciseBlocks` to reject without adding new harness behavior; the error state is covered by RNTL interaction assertions for inline text, collapse, and continued set entry.
- Manual verification summary:
  - Reviewed the Maestro screenshots for default collapsed, expanded, re-collapsed, older, and empty states. The default collapsed state is a slim `Past blocks` bar, expanded comparison shows `Previous` and live `Current` values after unsaved set entry, and empty collapsed state no longer spends vertical space on `No previous blocks`.
- Deferred/manual hosted checks summary:
  - N/A; no hosted/backend work.

## Completion note

- What changed: Agent 2A implemented the recorder past-blocks UI as collapsed-by-default slim `Past blocks` bars, removed the visible Hide/Show button in favor of tapping the bar/header, added an expanded previous/current table with live current metrics from unsaved set rows, preserved older/newer history navigation, compacted loading/empty/error states, updated targeted RNTL coverage, updated Maestro fixture selectors/screenshots, and updated `docs/specs/ui/ux-rules.md` plus `docs/specs/ui/screen-map.md`.
- What tests ran: see `Evidence` above.
- What remains: task intentionally not closed or archived per handoff request. Error-state simulator screenshot remains unproduced because the current Maestro fixture does not provide a history-load failure injection path; RNTL covers the error behavior.
- Data model/sync impact: no data-model, schema, sync, outbox, or backend changes.
- RUNBOOK.md reviewed: no changes required. `docs/specs/ui/components-catalog.md` unchanged because no reusable component/API was extracted or changed. `docs/specs/ui/navigation-contract.md` unchanged because route/param/transition behavior did not change.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- For UI/UX tasks, update the relevant `docs/specs/ui/*.md` files or record explicit no-update rationale.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260527-01-issue-70-block-comparison.md` or document why `N/A` before handoff.
