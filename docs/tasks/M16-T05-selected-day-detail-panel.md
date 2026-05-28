---
task_id: M16-T05-selected-day-detail-panel
milestone_id: "M16"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,docs/specs/milestones/M16-muscle-group-calendar-heatmap.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M16-T05-selected-day-detail-panel`
- Title: Selected-day muscle detail panel
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-28`
- Session interaction mode: `interactive (default)`
- Required branch: `codex/m16-t05-selected-day-detail-panel`
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
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
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
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirm `M16-T02` daily aggregation output includes contributing exercise/set details or extend it without changing scoring semantics.
  - Confirm `M16-T04` overlay selected-date state and data flow are complete.
  - Re-check current completed-session/exercise/set display helpers for formatting consistency.
- Known stale references or assumptions (must be explicit; write `none` if none):
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M16-T05-selected-day-detail-panel.md`

## Objective

Add the selected-day detail content inside the muscle heatmap overlay so users can understand which exercises and sets contributed to a date's effort score.

## Scope

### In scope

- Render selected local date, selected muscle group, effort score/bucket, contributing exercises, and contributing sets.
- Show a clear empty state when the selected date has no selected-muscle training.
- Keep set detail concise enough for the overlay and avoid duplicating the completed-session detail screen.
- Preserve the same shared analytics contribution math as the heatmap cells.
- Include optional certification marker shape only if a real source exists; otherwise render no certification UI.
- Add tests for populated details, multiple exercises/sessions, zero-effort day, warm-up exclusion, invalid set handling, and optional marker absence.
- Update UI docs for selected-day detail behavior.

### Out of scope

- Adding certification schema, fake certification state, or certification workflow.
- Adding route navigation from detail rows to completed sessions unless explicitly discovered as existing and low-risk.
- Changing heatmap component internals except narrow props needed for detail integration.
- Backend, sync, schema, durable preference, or RLS changes.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - Adds explanatory detail content inside the Stats / History muscle overlay.

## UX Contract

### Key user flows

1. Flow name: Inspect trained day
   - Trigger: User taps a heatmap cell with selected-muscle effort.
   - Steps: Overlay marks the cell and shows detail rows for contributing exercises and sets.
   - Success outcome: User can see date, muscle, effort score/bucket, exercises, and sets that explain the cell.
   - Failure/edge outcome: Any detail load/shape issue falls back to a clear inline error or no-detail state without closing the overlay.
2. Flow name: Inspect untrained day
   - Trigger: User taps a heatmap cell with zero selected-muscle effort.
   - Steps: Overlay marks the cell and renders the selected date detail area.
   - Success outcome: Detail area states that no selected-muscle training exists for that date.
   - Failure/edge outcome: Empty state remains compact and does not hide the calendar.

### Interaction + appearance notes

- Use compact row/table-like detail formatting so the overlay remains readable on small phones.
- Show enough set information to explain score, not the entire completed-session screen.
- Keep date and muscle identity visible while scrolling detail content.
- Do not display certification markers unless backed by a real data source.
- Avoid raw color literals in `.tsx`.

## Acceptance criteria

1. Selecting a trained date renders date, selected muscle, effort score/bucket, contributing exercises, and contributing sets.
2. Multiple sessions and exercises on the same date render coherently.
3. Warm-up and invalid sets do not appear as scored contributions except where existing Stats semantics would count them.
4. Selecting a zero-effort date renders a clear empty state for that date.
5. Detail content uses the same shared contribution helper as Stats and heatmap cells.
6. No fake certification state is displayed.
7. Tests cover populated, multiple-contributor, empty, and contribution-filtering states.
8. Screen UI uses documented tokens/primitives/shared components or records a justified exception.
9. No raw color literals are introduced in screen files unless explicitly allowed with rationale.
10. Relevant `docs/specs/ui/*.md` docs are updated in the same task.

## Docs touched (required)

- `docs/specs/ui/screen-map.md` - update Stats / History overlay detail state if not already covered by T04.
- `docs/specs/ui/ux-rules.md` - document selected-day detail semantics and certification constraint.
- `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md` - update only if detail behavior changes milestone assumptions.
- `docs/specs/05-data-model.md` - expected `N/A`; update only if a data-model or sync-scope change is introduced, which is out of scope.
- `RUNBOOK.md` - review; update only if local run/test/debug commands or artifact paths change.
- UI docs update required?: `yes`
  - Trigger: overlay state/detail semantics change.
- Tokens/primitives compliance statement:
  - Reuse plan: existing UI tokens/text styles, overlay styles from T04, heatmap selection state from T03, and compact row/list patterns.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` and this task.
  - Planned captures/artifacts: trained selected-day details, no-training selected-day empty state, and any inline error state if feasible.
  - If not required, why optional/non-blocking here: `N/A`

## Testing and verification approach

- Planned checks/commands:
  - targeted Stats/overlay tests, for example `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/stats-screen.test.tsx --runInBand`
  - targeted analytics tests if detail output shape changes.
  - `./scripts/quality-fast.sh frontend`
  - `git diff --check`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Frontend slow gate is not mandatory unless the implementation adds Maestro flows, changes native/runtime assumptions, or needs simulator evidence to satisfy acceptance.
- Test layers covered:
  - domain/detail aggregation tests when needed.
  - RNTL overlay interaction/rendering tests.
- Execution triggers:
  - always.
- Slow-gate triggers:
  - Run `./scripts/quality-slow.sh frontend` if simulator-dependent visual evidence is required or runtime-sensitive behavior changes.
- Hosted/deployed smoke ownership:
  - `N/A`
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/stats-history.tsx`
  - any overlay/detail component extracted under `apps/mobile/components/**`
  - `apps/mobile/src/data/muscle-analytics.ts` or equivalent if detail output requires extension.
  - mobile tests under current conventions.
  - relevant `docs/specs/ui/**`
- Project structure impact:
  - No new routes or top-level folders expected.
- Constraints/assumptions:
  - Depends on completed `M16-T02` and should integrate after `M16-T04` establishes overlay selected-date state.
  - Preserve M16 v1 `out of sync scope` decision.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless slow-gate triggers fire.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M16-T05-selected-day-detail-panel.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
  - Record screenshot/capture paths for trained date detail and no-training date detail when feasible.
- Manual verification summary (required when CI is absent/partial):
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update relevant UI docs and M16 milestone task breakdown/status.
- Record `RUNBOOK.md reviewed (no changes required)` if commands/workflows did not change.
