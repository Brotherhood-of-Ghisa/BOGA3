---
task_id: M16-T06-qa-visual-evidence-and-doc-closeout
milestone_id: "M16"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/milestones/M16-muscle-group-calendar-heatmap.md,docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,docs/specs/ui/components-catalog.md,docs/specs/ui/navigation-contract.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M16-T06-qa-visual-evidence-and-doc-closeout`
- Title: M16 QA, visual evidence, and docs closeout
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-28`
- Session interaction mode: `interactive (default)`
- Required branch: `codex/m16-t06-qa-visual-evidence-and-doc-closeout`
- Branch/worktree rule: create or switch to the required branch before edits, preferably via `./scripts/worktree-create.sh <branch-name>` from the main checkout. Do not complete this task directly on `main`.

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Maestro runtime/testing contract: `docs/specs/11-maestro-runtime-and-testing-conventions.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes | no | N/A` (explain)
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirm M16 implementation tasks `T02` through `T05` are completed and moved to `docs/tasks/complete/`.
  - Re-check implementation against M16 acceptance criteria.
  - Re-check UI docs against the current route/component behavior.
  - Re-check no backend/schema/sync changes landed without reopening the sync gate.
- Known stale references or assumptions (must be explicit; write `none` if none):
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M16-T06-qa-visual-evidence-and-doc-closeout.md`

## Objective

Close M16 by validating the integrated muscle-group calendar heatmap flow, capturing visual/runtime evidence, and aligning milestone/UI docs with the implemented behavior.

## Scope

### In scope

- Verify all M16 acceptance criteria across analytics, heatmap layout, overlay behavior, and selected-day details.
- Run frontend fast gate and required slow frontend gate at milestone closeout.
- Capture visual evidence for populated heatmap, empty/no-training state, selected-day details, today highlight, and an error state where feasible.
- Confirm UI docs and milestone docs match implementation.
- Confirm M16 v1 introduced no backend/sync/schema changes; if any slipped in, enforce the data-model sync gate before closeout.
- Mark M16 completed only if no required behavior remains open.

### Out of scope

- Adding new product features beyond fixing closeout gaps.
- Backend hosted deployment or hosted smoke.
- Certification workflow/schema.
- Maps, social features, fatigue/recovery modeling, or cross-muscle comparison views.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - This task validates and may make narrow closeout fixes to user-facing heatmap UI behavior.

## UX Contract

### Key user flows

1. Flow name: Heatmap happy path evidence
   - Trigger: User opens Stats / History and taps a muscle row/header with history.
   - Steps: Overlay opens, shows latest 8 visible weeks, user selects a trained date, and details explain the effort.
   - Success outcome: Captured evidence shows populated heatmap, selected cell, and detail panel.
   - Failure/edge outcome: Any missing behavior is fixed or the milestone remains blocked.
2. Flow name: Empty and error evidence
   - Trigger: User opens the overlay for no-history or simulated load-failure data.
   - Steps: Overlay renders the corresponding state and remains dismissible.
   - Success outcome: Captured evidence shows clear empty/error feedback without breaking dismissal.
   - Failure/edge outcome: Any missing feedback is fixed or documented as a blocker.

### Interaction + appearance notes

- Keep closeout fixes narrowly scoped to M16 acceptance gaps.
- Do not introduce new UI patterns unless required to satisfy existing M16 contracts.
- Preserve in-route overlay behavior and avoid route-level navigation for v1.

## Acceptance criteria

1. Existing Stats muscle table behavior remains preserved.
2. Heatmap daily effort uses the same contribution helper as Stats muscle totals.
3. Muscle rows and collapsed single-muscle family headers are actionable.
4. Overlay opens in-route, starts at latest weeks, occupies roughly 75% screen height, scrolls vertically, and dismisses on backdrop press.
5. Heatmap uses Monday-start columns and shows 8 visible week rows at initial open.
6. Today highlight is visibly separate from green effort intensity.
7. Selected-day detail explains the selected date's effort.
8. Empty/no-training dates have clear feedback.
9. Date alignment, same-day aggregation, multi-muscle contribution, warm-up exclusion, and invalid set handling are covered by tests.
10. UI docs are current for route state, semantics, component inventory, and navigation no-change rationale.
11. Frontend fast and slow gates pass, or exact environmental blockers with artifact paths are recorded.
12. M16 milestone status is set to `completed` only if no required behavior remains open.

## Docs touched (required)

- `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md` - final status, task breakdown, completion note, and evidence summary.
- `docs/specs/ui/screen-map.md` - verify/update Stats / History overlay state.
- `docs/specs/ui/ux-rules.md` - verify/update heatmap and selected-day detail semantics.
- `docs/specs/ui/components-catalog.md` - verify/update reusable heatmap component entry.
- `docs/specs/ui/navigation-contract.md` - verify no route/param changes; update if implementation changed navigation behavior.
- `docs/specs/05-data-model.md` - expected `N/A`; update only if a data-model or sync-scope change landed.
- `RUNBOOK.md` - review; update only if operator workflow, commands, or artifact locations changed.
- UI docs update required?: `yes`
  - Trigger: milestone closeout verifies final UI docs against implemented behavior.
- Tokens/primitives compliance statement:
  - Reuse plan: closeout should verify all M16 UI uses existing/new documented tokens and heatmap component contracts.
  - Exceptions: record any raw literal or one-off styling exceptions with file and rationale before closeout.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` and milestone closeout.
  - Planned captures/artifacts: populated heatmap, today highlight, selected-day details, empty/no-training date, and error state where feasible.
  - If not required, why optional/non-blocking here: `N/A`

## Testing and verification approach

- Planned checks/commands:
  - targeted analytics/layout/UI tests as needed for closeout gaps.
  - `./scripts/quality-fast.sh frontend`
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./scripts/quality-slow.sh frontend` if local Java setup requires the prefix.
  - `git diff --check`
  - `./scripts/task-closeout-check.sh docs/tasks/M16-T06-qa-visual-evidence-and-doc-closeout.md`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Frontend slow gate is mandatory at milestone closeout.
- Test layers covered:
  - unit/domain analytics.
  - RNTL component and route interactions.
  - simulator/Maestro or equivalent visual/runtime evidence.
- Execution triggers:
  - milestone closeout after T02-T05 complete.
- Slow-gate triggers:
  - required for this closeout task.
- Hosted/deployed smoke ownership:
  - `N/A` unless earlier M16 tasks unexpectedly changed backend/deployment behavior.
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - docs listed above.
  - narrow app/test fixes required to satisfy M16 acceptance criteria.
  - no backend/sync/schema files unless reopening the data-model sync gate.
- Project structure impact:
  - No new canonical paths expected.
- Constraints/assumptions:
  - Depends on all implementation tasks.
  - Prefer fixing missing behavior over weakening milestone acceptance criteria.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M16-T06-qa-visual-evidence-and-doc-closeout.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
  - Record screenshot/capture paths for populated heatmap, selected-day details, empty/no-training, today highlight, and error state where feasible.
- Manual verification summary (required when CI is absent/partial):
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Ensure all completed M16 task cards are moved to `docs/tasks/complete/`.
- Update M16 milestone status, task breakdown, and completion note.
- Record `RUNBOOK.md reviewed (no changes required)` if commands/workflows did not change.
