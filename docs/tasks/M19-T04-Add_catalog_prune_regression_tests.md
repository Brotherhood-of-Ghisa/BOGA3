---
task_id: M19-T04-Add_catalog_prune_regression_tests
milestone_id: "M19"
status: planned
ui_impact: "no"
areas: "frontend|backend|cross-stack|docs"
runtimes: "node|supabase|sql|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend"
docs_touched: "docs/specs/06-testing-strategy.md"
---

# M19-T04-Add_catalog_prune_regression_tests

## Task metadata

- Task ID: M19-T04-Add_catalog_prune_regression_tests
- Title: Add catalog prune regression tests
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
- Mobile test directory README: `apps/mobile/app/__tests__/README.md`
- Sync test directory README: `apps/mobile/app/__tests__/sync/README.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
  - `apps/mobile/app/__tests__/README.md`
  - `apps/mobile/app/__tests__/sync/README.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run seed/bootstrap/sync test inventory during implementation kickoff.
- Known stale references or assumptions: none recorded at card creation.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T04-Add_catalog_prune_regression_tests.md`

## Objective

Add regression tests that make the catalog prune durable across seed validation,
local bootstrap, Sync v2 migration/push/pull, and remote cleanup.

## Scope

### In scope

- Assert 70 exercise definitions and 232 mappings in the pruned bundle.
- Assert suppressed IDs are absent from active seed definitions and mappings.
- Assert duplicate singular/plural groups resolve to the intended kept rows.
- Cover bundle migration idempotency, user-renamed preservation, and tombstone dirtying.
- Cover sync-cycle push of tombstones and no re-population after pull.
- Update existing fixtures/tests that hard-code old counts or old seed names.

### Out of scope

- Implementing seed pruning, bundle migration, or Supabase cleanup if those slices are not already complete.
- Adding new test lanes.
- UI screenshot capture.

## UI Impact

- UI Impact?: `no`
- Test-only work unless existing UI test fixtures require seed name updates.

## Acceptance criteria

1. Tests fail against the old long catalog and pass against the M19 pruned catalog.
2. Tests protect user-created and user-renamed exercise preservation.
3. Tests cover local and backend sync behavior relevant to tombstone propagation.
4. Existing seed-count assertions are updated to the M19 counts.
5. Testing docs are updated if a new coverage policy or lane is introduced.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/06-testing-strategy.md` - update only if this task adds or changes a canonical test entry point or coverage policy.
  - `docs/specs/02-quality-and-test-gates.md` - update only if lane registry/triggers change.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test for --diff <range>`
- Test layers covered: Jest seed/unit tests, sync-cycle tests, local Supabase backend contract/drift where applicable.
- Execution triggers: always before task closeout.
- Slow-gate triggers: backend/sync behavior coverage requires backend gate.
- CI/manual posture note: backend gate is local-only here and must be run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/__tests__/**`
  - `apps/mobile/app/__tests__/sync/**`
  - `supabase/tests/**` only if backend contract coverage needs a scenario
- Project structure impact: none planned.
- Constraints/assumptions: do not add a lane unless there is a clear maintenance need and update gate docs if so.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test backend`
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
