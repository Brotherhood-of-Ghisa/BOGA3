---
task_id: M16-T01-muscle-heatmap-milestone-spec
milestone_id: "M16"
status: planned
ui_impact: "yes"
areas: "docs"
runtimes: "docs"
gates_fast: "N/A"
gates_slow: "N/A"
docs_touched: "docs/specs/milestones/M16-muscle-group-calendar-heatmap.md,docs/tasks/M16-T02-shared-muscle-analytics-engine.md,docs/tasks/M16-T03-calendar-heatmap-component.md,docs/tasks/M16-T04-stats-history-muscle-overlay.md,docs/tasks/M16-T05-selected-day-detail-panel.md,docs/tasks/M16-T06-qa-visual-evidence-and-doc-closeout.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M16-T01-muscle-heatmap-milestone-spec`
- Title: Muscle heatmap milestone spec and task-card lock
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-28`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Milestone spec: `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
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
  - `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirm no existing M16 task cards or superseding task breakdown.
  - Re-check GitHub Issue `https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/79` if issue context has changed.
- Known stale references or assumptions (must be explicit; write `none` if none):
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M16-T01-muscle-heatmap-milestone-spec.md`

## Objective

Lock the M16 milestone plan and produce executable task cards for the muscle-group calendar heatmap work.

## Scope

### In scope

- Review the M16 milestone spec for consistency with project, data, testing, worktree, and UI docs.
- Confirm the v1 sync impact remains `out of sync scope`.
- Confirm the task breakdown, dependency order, and gate expectations.
- Create or revise M16 task cards for `T02` through `T06`.
- Update the milestone task breakdown if filenames, ordering, or task scope changes.

### Out of scope

- Implementing the analytics engine, heatmap component, overlay, or detail panel.
- Changing mobile app source code.
- Adding schema, backend, sync, or route behavior.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - This is documentation-only, but it defines future UI behavior for the Stats / History muscle heatmap overlay.

## UX Contract

### Key user flows

1. Flow name: Planning handoff
   - Trigger: A future agent starts M16 implementation.
   - Steps: Agent opens the milestone spec and relevant task card, loads parent refs, and follows the scoped card.
   - Success outcome: The agent can execute one M16 slice without rediscovering milestone scope.
   - Failure/edge outcome: Ambiguous scope, missing docs, or stale issue references are corrected before implementation begins.

### Interaction + appearance notes

- Document UX behavior in milestone/task cards only; do not invent screenshots or implementation evidence in this planning task.
- Preserve the planned in-route overlay contract rather than adding route-level navigation.
- Keep certification behavior explicitly conditional on a real data source.

## Acceptance criteria

1. `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md` is internally consistent with the source-of-truth docs.
2. M16 task cards exist for all implementation and closeout slices named by the milestone.
3. Each task card has parent refs, scope, acceptance criteria, docs-touch plan, gate posture, and UI artifact expectations.
4. The milestone task breakdown points at the final active task-card paths.
5. The v1 data-model/sync decision remains explicit: no new durable schema or sync-scope change unless a later task reopens the gate.
6. `RUNBOOK.md` is reviewed; update only if planning changes operator commands or evidence locations.

## Docs touched (required)

- `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md` - verify and update only if task breakdown or milestone contract changes.
- `docs/tasks/M16-T02-shared-muscle-analytics-engine.md` - executable analytics engine card.
- `docs/tasks/M16-T03-calendar-heatmap-component.md` - executable reusable heatmap component card.
- `docs/tasks/M16-T04-stats-history-muscle-overlay.md` - executable overlay integration card.
- `docs/tasks/M16-T05-selected-day-detail-panel.md` - executable selected-day detail card.
- `docs/tasks/M16-T06-qa-visual-evidence-and-doc-closeout.md` - executable closeout card.
- `RUNBOOK.md` - review; update only if operator workflow changes.
- UI docs update required?: `no`
  - Rationale: this planning task does not change implemented UI behavior. Implementation tasks own the UI docs updates when behavior lands.
- Tokens/primitives compliance statement:
  - Reuse plan: future implementation tasks should use existing `apps/mobile/components/ui/**` primitives/tokens and add heatmap color tokens before consuming new colors.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `no`
  - Planned captures/artifacts: `N/A`
  - If not required, why optional/non-blocking here: docs-only planning task.

## Testing and verification approach

- Planned checks/commands:
  - `git diff --check`
  - `./scripts/task-closeout-check.sh docs/tasks/M16-T01-muscle-heatmap-milestone-spec.md`
- Standard local gate usage:
  - `./scripts/quality-fast.sh`: `N/A` because this task changes docs only.
  - `./scripts/quality-slow.sh`: `N/A` because no runtime behavior changes.
- Test layers covered:
  - docs/task-card validation only.
- Execution triggers:
  - always for this planning task.
- Slow-gate triggers:
  - `N/A`
- Hosted/deployed smoke ownership:
  - `N/A`
- CI/manual posture note:
  - Current repo has no CI pipeline; local docs validation is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`
  - `docs/tasks/M16-T*.md`
  - `RUNBOOK.md` only if operator workflow changes.
- Project structure impact:
  - No new canonical paths; uses existing `docs/tasks/` active-card convention.
- Constraints/assumptions:
  - Do not mark implementation tasks complete from this planning task.

## Mandatory verify gates

- Standard local fast gate: `N/A` - docs-only planning.
- Standard local slow gate: `N/A`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M16-T01-muscle-heatmap-milestone-spec.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note: `N/A` - docs-only planning task.
- Manual verification summary (required when CI is absent/partial):
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update M16 milestone status/task breakdown in the same session.
- Run closeout helper or document why `N/A`.
