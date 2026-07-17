---
task_id: M19-T03-Add_remote_catalog_cleanup_migration
milestone_id: "M19"
status: planned
ui_impact: "no"
areas: "backend|docs"
runtimes: "supabase|sql|docs"
gates_fast: "./boga test backend"
gates_slow: "./boga test backend"
docs_touched: "docs/specs/05-data-model.md, docs/specs/10-api-authn-authz-guidelines.md"
---

# M19-T03-Add_remote_catalog_cleanup_migration

## Task metadata

- Task ID: M19-T03-Add_remote_catalog_cleanup_migration
- Title: Add remote catalog cleanup migration
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
- AuthN/AuthZ guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`
- Supabase runtime guide: `supabase/README.md`

## Context Freshness

- Verified current branch + HEAD commit: fill during task kickoff.
- Start-of-session sync with `origin/main` completed?: `N/A` for planned card creation; verify during task kickoff.
- Parent refs opened in this session:
  - `docs/specs/milestones/M19-prune-starter-exercise-catalog.md`
  - `supabase/README.md`
- Code/docs inventory freshness checks run:
  - Task is planned only; run migration/RPC/schema inventory during implementation kickoff.
- Known stale references or assumptions: old app builds can reintroduce suppressed seeds for brand-new accounts until retired.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T03-Add_remote_catalog_cleanup_migration.md`

## Objective

Apply the catalog prune to existing remote Sync v2 mirror rows by tombstoning
suppressed bundled seed definitions and mappings, while preserving all
user-authored rows.

## Scope

### In scope

- Create the migration with `supabase migration new <name>`.
- Update exact known suppressed `seed_*` exercise definition rows in `app_public.exercise_definitions`.
- Update exact known suppressed seed mapping rows in `app_public.exercise_muscle_mappings`.
- Apply kept-row display-name renames remotely with LWW-safe `client_updated_at_ms`.
- Include verification SQL for before/after active counts and idempotency.
- Keep the migration limited to app-owned sync mirror tables.

### Out of scope

- Physical deletes of Sync v2 rows.
- Any change to RLS policy shape.
- Any change to sync RPC wire contract.
- Cleanup of non-`seed_*` user-created rows.

## UI Impact

- UI Impact?: `no`
- Backend data cleanup only.

## Acceptance criteria

1. Migration is generated through the Supabase CLI workflow required by repo guidance.
2. Migration is idempotent and safe to rerun.
3. Only exact known bundled seed IDs are tombstoned or renamed.
4. Suppressed remote rows pull as tombstones to clients rather than disappearing physically.
5. Local backend contract/smoke gates pass.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - update only if source-of-truth data-model behavior changes.
  - `docs/specs/10-api-authn-authz-guidelines.md` - update only if auth/RLS posture changes, which is not expected.

## Testing and verification approach

- Planned checks/commands:
  - `supabase --help` and relevant subcommand `--help` before migration commands.
  - `./boga test backend`
  - `./boga test for --diff <range>`
- Test layers covered: local Supabase migration application, schema smoke, sync pull/push contracts, drift.
- Execution triggers: always before task closeout.
- Slow-gate triggers: backend migration changes require backend gate.
- Hosted/deployed smoke ownership: this task owns documenting the hosted cleanup execution command and evidence if run.
- CI/manual posture note: backend gate is local-only here and must be run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `supabase/migrations/**`
  - backend contract tests only if needed for migration proof
- Project structure impact: none planned.
- Constraints/assumptions: do not use service-role credentials in mobile/client code.

## Mandatory verify gates

- Standard local fast gate: `./boga test backend`
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
