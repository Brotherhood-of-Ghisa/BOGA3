---
task_id: M16-T02-shared-muscle-analytics-engine
milestone_id: "M16"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/milestones/M16-muscle-group-calendar-heatmap.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M16-T02-shared-muscle-analytics-engine`
- Title: Shared muscle analytics engine
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-28`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
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
  - `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Re-check `apps/mobile/src/data/stats.ts` for current Stats aggregation behavior.
  - Re-check `apps/mobile/app/__tests__/stats-repository.test.ts` for current behavior-lock tests.
  - Re-check `apps/mobile/src/data/index.ts` exports before adding new public data APIs.
  - Re-check completed session data/query helpers used by Stats and exercise history.
- Known stale references or assumptions (must be explicit; write `none` if none):
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M16-T02-shared-muscle-analytics-engine.md`

## Objective

Extract the current Stats muscle contribution math into a shared local analytics engine and add daily selected-muscle aggregation for the future heatmap.

## Scope

### In scope

- Preserve current Stats period summary behavior while moving shared contribution logic out of `apps/mobile/src/data/stats.ts`.
- Add a canonical helper/API for daily selected-muscle effort aggregation over completed local session history.
- Keep contribution math shared between period summary and daily heatmap output.
- Include enough detail in daily output for later selected-day exercise/set explanation.
- Add deterministic tests for role contribution weights, warm-up exclusion, invalid set handling, local date bucketing, multi-session same-day aggregation, and multi-muscle exercises.

### Out of scope

- Building the visual heatmap component.
- Wiring the overlay into `Stats / History`.
- Adding selected-day detail UI.
- Adding persistent analytics tables, durable preferences, backend changes, sync changes, or RLS changes.
- Changing Stats scoring semantics unless explicitly documented as a decision and approved by the milestone.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task changes data/domain helpers only. Existing Stats UI should render the same values after the refactor.

## Acceptance criteria

1. Existing Stats summary output is preserved after the refactor.
2. One shared contribution helper is used by both Stats period totals and selected-muscle daily aggregation.
3. Current role-based scoring is preserved unless the task records and implements an intentional milestone decision to use mapping `weight` instead.
4. Daily aggregation groups completed sessions by local calendar date with deterministic Monday/Sunday and month-boundary behavior.
5. Multiple sessions on the same local date aggregate into one daily entry.
6. Warm-up sets and invalid set values follow existing Stats semantics.
7. Daily output can identify contributing exercises and sets sufficiently for `M16-T05`.
8. No schema, backend, sync contract, or durable data-model changes are introduced.
9. `apps/mobile/src/data/index.ts` exports any new public analytics APIs needed by later tasks.

## Docs touched (required)

- `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md` - update only if the scoring decision, APIs, or task dependency assumptions change.
- `docs/specs/05-data-model.md` - expected `N/A`; update only if this task introduces a data-model or sync-scope change, which is out of scope.
- `RUNBOOK.md` - review; update only if local run/test/debug commands change.
- UI docs update required?: `no`
  - Rationale: no implemented UI behavior changes.

## Testing and verification approach

- Planned checks/commands:
  - targeted Jest for analytics/stats repository behavior, for example `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/stats-repository.test.ts --runInBand`
  - add/run a focused muscle analytics test file if extraction creates a new module.
  - `./scripts/quality-fast.sh frontend`
  - `git diff --check`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Slow frontend gate is not mandatory because this task does not change UI runtime, Maestro flows, native code, or simulator-dependent behavior.
- Test layers covered:
  - unit/domain analytics tests.
  - repository-level behavior lock for Stats summary.
- Execution triggers:
  - always.
- Slow-gate triggers:
  - Run `./scripts/quality-slow.sh frontend` only if the task unexpectedly changes Maestro flows, native runtime setup, or simulator-dependent behavior.
- Hosted/deployed smoke ownership:
  - `N/A`
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/stats.ts`
  - new shared module such as `apps/mobile/src/data/muscle-analytics.ts`
  - `apps/mobile/src/data/index.ts`
  - `apps/mobile/app/__tests__/stats-repository.test.ts`
  - optional new analytics test file under current mobile test conventions.
- Project structure impact:
  - No new top-level folders. A new data module under `apps/mobile/src/data/` is within existing ownership.
- Constraints/assumptions:
  - M16 v1 sync impact remains `out of sync scope`.
  - Keep historical metadata semantics retroactive per `docs/specs/00-product.md`.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless slow-gate triggers fire.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M16-T02-shared-muscle-analytics-engine.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note: `N/A` - no UI impact.
- Manual verification summary (required when CI is absent/partial):
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update M16 milestone task breakdown/status in the same session.
- Record `RUNBOOK.md reviewed (no changes required)` if commands/workflows did not change.
