---
task_id: M19-T06-Rollout_and_closeout_catalog_prune
milestone_id: "M19"
status: planned
ui_impact: "no"
areas: "cross-stack|docs"
runtimes: "docs|node|supabase|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/milestones/M19-prune-starter-exercise-catalog.md, docs/specs/02-quality-and-test-gates.md"
---

# M19-T06-Rollout_and_closeout_catalog_prune

## Task metadata

- Task ID: M19-T06-Rollout_and_closeout_catalog_prune
- Title: Rollout and closeout catalog prune
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
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
  - `docs/specs/02-quality-and-test-gates.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run final diff and gate-trigger inventory during closeout kickoff.
- Known stale references or assumptions: old app builds can seed the previous long catalog until retired.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T06-Rollout_and_closeout_catalog_prune.md`

## Objective

Close the M19 milestone with verified gates, documented rollout notes, and a
clear account of remote cleanup and old-client caveats.

## Scope

### In scope

- Run `./boga test for --diff <range>` and all required gates for the final M19 diff.
- Confirm milestone task statuses and completion notes are current.
- Record final duplicate suppression summary and active seed counts.
- Record hosted cleanup status, owner, and any deferred rerun trigger.
- Move completed M19 task cards to `docs/tasks/complete/` as appropriate.
- Update the M19 milestone completion note and status when all slices are complete.

### Out of scope

- Implementing any remaining M19 behavior not already completed by prior tasks.
- Changing test lanes unless a prior task explicitly introduced or changed a lane.

## UI Impact

- UI Impact?: `no`
- Closeout/documentation task only.

## Acceptance criteria

1. All M19 implementation task cards are either completed or explicitly blocked/outdated with rationale.
2. The milestone completion note records what changed, what gates ran, hosted cleanup status, and any old-client follow-up.
3. PR body evidence lists every required gate with result and N/A rationale where applicable.
4. No source-of-truth docs remain stale for behavior changed during M19.
5. The final diff contains no unplanned implementation scope.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md` - closeout status and completion note.
  - `docs/specs/02-quality-and-test-gates.md` - update only if lane registry/triggers changed.
  - Other project-level docs only if earlier M19 tasks changed canonical behavior without updating them.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test for --diff <range>`
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test frontend`
  - `./boga test ios-sync-e2e` if required by final trigger output or sync changes
  - `./boga pr check --body <body-file>` before PR open/update
- Test layers covered: final gate set required by actual changed paths.
- Execution triggers: milestone closeout.
- Slow-gate triggers: backend/frontend/sync changes made by M19.
- Hosted/deployed smoke ownership: this task records whether hosted cleanup was run or deferred, and who owns any rerun.
- CI/manual posture note: local-only gates must be run locally and cited in PR evidence.

## Implementation notes

- Planned files/areas allowed to change:
  - M19 milestone/task docs
  - PR body artifact if stored outside the repo or as a temporary file
- Project structure impact: none planned.
- Constraints/assumptions: do not reopen completed implementation slices unless closeout verification finds a regression.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test backend`; `./boga test frontend`
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
