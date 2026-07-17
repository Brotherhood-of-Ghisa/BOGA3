---
task_id: M19-T01-Prune_starter_catalog_seed_bundle
milestone_id: "M19"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|docs"
gates_fast: "./boga test fast"
gates_slow: "N/A"
docs_touched: "docs/specs/milestones/M19-prune-starter-exercise-catalog.md"
---

# M19-T01-Prune_starter_catalog_seed_bundle

## Task metadata

- Task ID: M19-T01-Prune_starter_catalog_seed_bundle
- Title: Prune starter catalog seed bundle
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-17
- Session interaction mode: `non_interactive`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run seed/schema/test inventory commands during implementation kickoff.
- Known stale references or assumptions: none recorded at card creation.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T01-Prune_starter_catalog_seed_bundle.md`

## Objective

Shrink the bundled starter exercise seed bundle to a curated keep set while
keeping seed validation, mapping coverage, documentation coverage, and the M19
incline-variant preservation rule intact.

## Scope

### In scope

- Audit the current `SYSTEM_EXERCISE_DEFINITION_SEEDS` and produce the final
  M19 keep/suppress table in the milestone before pruning.
- Prune `SYSTEM_EXERCISE_DEFINITION_SEEDS` to the finalized M19 keep set.
- Prune `SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS` to mappings whose
  `exerciseDefinitionId` remains in the keep set.
- Prune seed documentation and granular rationale rows for suppressed exercises.
- Rename kept bundled exercise names to the M19 singular/equipment-specific
  display names.
- Preserve all current `Incline` seed rows as active distinct exercises unless
  the milestone records an explicit user-approved exception.
- Update seed-count expectations in seed-only tests affected by the bundle size.

### Out of scope

- Bundle migrations for already-seeded clients.
- Supabase remote cleanup migration.
- Sync behavior changes.
- Frontend UI changes beyond test fixtures that reference seed names.

## UI Impact

- UI Impact?: `no`
- This task changes seed data only; visible catalog behavior is verified in a later M19 task.

## Acceptance criteria

1. The seed bundle validates with no duplicate exercise definition IDs/names.
2. The seed summary reports the finalized M19 exercise and mapping counts, and
   those counts are recorded in the milestone.
3. Every remaining exercise has at least one mapping and documentation row.
4. Every current `Incline` seed row remains active unless the milestone records
   an explicit user-approved exception.
5. No suppressed exercise ID remains in seed definitions, mappings, documentation, or rationale rows.
6. Project-level docs are updated only if implementation discovers a source-of-truth behavior change beyond this milestone.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md` - update task status/details if the finalized keep set changes during implementation.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test for --diff <range>`
- Test layers covered: seed validation, seed shape, bootstrap-adjacent unit coverage.
- Execution triggers: always before task closeout.
- Slow-gate triggers: `N/A` unless this task expands into sync/backend behavior.
- CI/manual posture note: fast lane is CI-covered; still run locally before closeout.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/exercise-catalog-seeds.ts`
  - seed-focused tests under `apps/mobile/app/__tests__/`
- Project structure impact: none planned.
- Constraints/assumptions: do not suppress incline variants unless the milestone
  is deliberately revised with explicit user approval.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `N/A` because this slice is seed-data/test-only unless implementation expands into sync/backend paths.
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Fill during implementation.
- Manual verification summary: fill during implementation.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
