---
task_id: M18-T02-Design_group_domain_data_model
milestone_id: "M18"
status: planned
ui_impact: "no"
areas: "docs|backend"
runtimes: "docs|sql"
gates_fast: "./boga test backend"
gates_slow: "./boga test backend"
docs_touched: "docs/specs/05-data-model.md"
---

# M18-T02-Design_group_domain_data_model

## Task metadata

- Task ID: M18-T02-Design_group_domain_data_model
- Title: Design group/domain data model
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-06-22
- Session interaction mode: `non_interactive`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M18-group-exercise-catalogue-private-mapping.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M18-group-exercise-catalogue-private-mapping.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run schema/runtime/UI inventory commands during implementation kickoff as applicable.
- Known stale references or assumptions: none recorded at card creation.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M18-T02-Design_group_domain_data_model.md`

## Objective

Define the canonical group, membership, catalogue, mapping, request, and projection entities before implementation.

## Scope

### In scope

- Deliver the slice named in the task title.
- Preserve the milestone privacy rule that private exercise definitions stay private unless intentionally mapped/projected.
- Propose concrete RLS policy structures and helper functions that explicitly avoid infinite recursion during membership and role checks.
- Update source-of-truth docs listed below when behavior becomes canonical.

### Out of scope

- Completing other M18 task-card slices.
- Building competitions, leaderboards, PR certification, comments, notifications, or public/global catalogues.

## UI Impact

- UI Impact?: `no`
- No direct UI impact planned for this slice; remove UI-only sections if implementation remains non-UI.

## Acceptance criteria

1. The task slice is implemented according to the M18 milestone privacy and authorization rules.
2. Positive-path behavior is covered by targeted tests or documented verification.
3. Negative privacy/authorization/projection behavior is covered when the slice touches backend data, RLS, mappings, or share projections.
4. Project-level docs are updated when this slice changes source-of-truth behavior.
5. The designed data model includes RLS policy templates and security definer functions (or equivalent strategies) that are verified to be recursion-free.

## Docs touched

- Planned docs/spec files to update and why:
  - docs/specs/05-data-model.md - add accepted group-domain model; docs/specs/03-technical-architecture.md - record group-sharing architecture decision if adopted; docs/specs/10-api-authn-authz-guidelines.md - add group role authorization rules.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test backend`
  - `./boga test backend`
- Test layers covered: targeted unit/integration/contract/E2E coverage as appropriate to this slice.
- Execution triggers: run required gates before marking task complete.
- Slow-gate triggers: backend for schema/RLS/projection changes; frontend for UI route/screen changes.
- CI/manual posture note: local slow gates are required where triggered by changed paths.

## Implementation notes

- Planned files/areas allowed to change: determined during task kickoff.
- Project structure impact: no new canonical top-level path planned unless task implementation identifies one and updates `docs/specs/09-project-structure.md`.
- Constraints/assumptions: maintain explicit separation between private source data and group-visible projections.

## Mandatory verify gates

- Standard local fast gate: `./boga test backend`
- Standard local slow gate: `./boga test backend`
- Additional gate(s), if any: run `./boga test for --diff <range>` before closeout and follow its output.

## Evidence

- Fill during implementation.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
