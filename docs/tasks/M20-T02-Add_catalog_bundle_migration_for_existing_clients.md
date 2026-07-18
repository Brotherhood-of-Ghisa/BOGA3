---
task_id: M20-T02-Add_catalog_bundle_migration_for_existing_clients
milestone_id: "M20"
status: planned
ui_impact: "no"
areas: "frontend|cross-stack|docs"
runtimes: "node|supabase|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test ios-sync-e2e"
docs_touched: "docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/tech/sync-v2-server-contract.md"
---

# M20-T02-Add_catalog_bundle_migration_for_existing_clients

## Task metadata

- Task ID: M20-T02-Add_catalog_bundle_migration_for_existing_clients
- Title: Add catalog bundle migration for existing clients
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-18
- Session interaction mode: `non_interactive`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M20-prune-starter-exercise-catalog.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M20-prune-starter-exercise-catalog.md`
  - `docs/specs/tech/sync-v2-server-contract.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run bundle-migration, bootstrap, and sync-cycle inventory during implementation kickoff.
- Known stale references or assumptions: old client builds may still seed the
  long catalog locally; `M20-T07` owns the server-side guard that prevents known
  deprecated seed rows from persisting remotely as active rows.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M20-T02-Add_catalog_bundle_migration_for_existing_clients.md`

## Objective

Make already-seeded local clients converge to the M20 starter catalog by
dirtying kept-row renames and tombstoning suppressed seed rows through the
existing bundle-migration mechanism.

## Scope

### In scope

- Bump the catalog bundle generation.
- Add bundle migration repo helpers for seed definition renames and soft-delete tombstones.
- Tombstone suppressed `seed_*` exercise definitions and their seed mappings.
- Apply changes only when rows still match prior bundled values, preserving user-renamed seed rows.
- Ensure migrated rows push through normal Sync v2 dirty-bit flow.
- Ensure no-sync/local bootstrap paths apply relevant bundle migrations.

### Out of scope

- Supabase hosted cleanup migration.
- Pruning the seed bundle itself.
- Rewriting historical completed session exercise references.
- Adding schema columns or changing Sync v2 wire shape.

## UI Impact

- UI Impact?: `no`
- This task changes local data migration/sync behavior, not route or component UI.

## Acceptance criteria

1. Bundle migration is idempotent and marker advancement remains transactional.
2. Kept seed rows are renamed only when still holding the prior bundle name.
3. Suppressed seed rows and their mappings are soft-deleted and marked dirty.
4. Non-`seed_*` user-created rows are never touched.
5. Sync pushes migrated tombstones/renames and clears dirty bits on success.
6. Project-level docs are updated if the catalog-bundle migration contract changes.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/03-technical-architecture.md` - update catalog bundle migration behavior if materially changed.
  - `docs/specs/05-data-model.md` - update seed/tombstone sync impact if source-of-truth behavior changes.
  - `docs/specs/tech/sync-v2-server-contract.md` - update only if Sync v2 lifecycle guidance changes.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test ios-sync-e2e`
  - `./boga test for --diff <range>`
- Test layers covered: bundle migration unit tests, sync-cycle push coverage, backend sync convergence, device-level sync proof.
- Execution triggers: always before task closeout.
- Slow-gate triggers: sync/bootstrap/data migration behavior requires backend and iOS sync e2e lanes.
- CI/manual posture note: slow sync gates are local-only and must be run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/bundle-migrations.ts`
  - `apps/mobile/src/data/exercise-catalog-seeds.ts`
  - `apps/mobile/src/data/bootstrap.ts` if no-sync migration application is needed
  - targeted tests under `apps/mobile/app/__tests__/`
- Project structure impact: none planned.
- Constraints/assumptions: use soft-delete tombstones, not hard deletes.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test backend`; `./boga test ios-sync-e2e`
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
