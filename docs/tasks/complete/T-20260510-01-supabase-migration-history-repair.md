---
task_id: T-20260510-01-supabase-migration-history-repair
milestone_id: "M14"
status: completed
ui_impact: "no"
areas: "backend|docs"
runtimes: "supabase|sql"
gates_fast: "./scripts/quality-fast.sh backend"
gates_slow: "./scripts/quality-slow.sh backend"
docs_touched: "RUNBOOK.md, supabase/README.md, docs/specs/milestones/M14-observability-and-diagnostics.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260510-01-supabase-migration-history-repair`
- Title: Supabase migration history repair for FK relaxation and app logs
- Status: `completed`
- File location rule:
  - author active card in `docs/tasks/T-20260510-01-supabase-migration-history-repair.md`
  - move the file to `docs/tasks/complete/T-20260510-01-supabase-migration-history-repair.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-10`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M14-observability-and-diagnostics.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Runbook: `RUNBOOK.md`
- Backend operations docs: `supabase/README.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `main @ 7642e51`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - `git fetch origin main` completed; local `main` and `origin/main` were even at `7642e51`.
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/specs/milestones/M14-observability-and-diagnostics.md`
  - `RUNBOOK.md`
  - `supabase/README.md`
- Code/docs inventory freshness checks run:
  - `rg --files supabase docs/tasks docs/specs | sort` - confirmed canonical Supabase migration files and ad hoc SQL locations.
  - `rg -n "app_logs|relax_session_exercise|session_exercises_exercise_definition_owner_fk|hosted-hotfix|migration" supabase docs apps scripts` - confirmed docs/tests/code references.
  - `git status --short --branch` - clean worktree at authoring time.
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260510-01-supabase-migration-history-repair.md` - confirmed task metadata and parent references.
  - `./scripts/worktree-doctor.sh` - initially reported missing generated Supabase config/env links; passed after `./scripts/worktree-setup.sh`.
- Relevant migration/source files confirmed:
  - `supabase/migrations/20260505213500_relax_session_exercise_definition_fk.sql`
  - `supabase/migrations/20260507120000_create_app_logs.sql`
  - `supabase/hosted-hotfix-relax-session-exercise-definition-fk.sql`
  - `supabase/snippets/Untitled query 283.sql`
- Known stale references or assumptions:
  - The hosted database may already have the schema changes but not the matching entries in Supabase migration history.
  - `supabase/hosted-hotfix-relax-session-exercise-definition-fk.sql` is historical/emergency SQL and must not become the canonical path for future hosted schema changes.
  - Hosted credentials live in machine-local config and must not be printed or committed.
  - Hosted credentials live in machine-local config and must not be printed or committed.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260510-01-supabase-migration-history-repair.md`

## Objective

Repair the mistake where two hosted database changes were applied manually instead of being applied and tracked through the Supabase migration workflow.

The end state must be boring and explicit: local Supabase instances, fresh local resets, and the hosted Supabase database all have the intended schema and matching migration-version records for the FK relaxation and `public.app_logs`.

## Scope

### In scope

- Audit the current local migration chain and hosted migration history.
- Verify hosted schema state for:
  - `app_public.session_exercises.exercise_definition_id` FK relaxation.
  - `public.app_logs` table, RLS, grants, policy, and indexes.
- Repair hosted migration history so Supabase records both migration versions:
  - `20260505213500`
  - `20260507120000`
- Apply any missing hosted migration SQL through the Supabase migration path when the schema is not already present.
- Use `supabase migration repair --status applied <version>` only when hosted schema inspection proves the migration's effects already exist and should not be replayed.
- Refresh local Supabase runtimes through existing project wrappers.
- Document the exact commands and SQL checks used in the completion note.
- Update docs so future hosted schema changes use migrations first, with direct SQL limited to emergency/historical cases.

### Out of scope

- Redesigning either schema change.
- Adding new database entities, columns, policies, or sync behavior.
- Changing mobile app behavior or UI.
- Committing hosted credentials or printing Supabase keys.
- Rewriting the full hosted deployment strategy.
- Running destructive hosted operations such as table drops, data truncation, or rollback restores unless a separate human-approved recovery plan is created.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task reconciles Supabase schema and migration history only.
  - It does not change app screens, routes, navigation, copy, styling, or user interaction flows.

## Acceptance criteria

1. Hosted migration history shows both `20260505213500` and `20260507120000` as applied.
2. Hosted schema confirms `app_public.session_exercises` no longer has `session_exercises_exercise_definition_owner_fk`.
3. Hosted schema confirms `public.app_logs` exists with expected columns, RLS enabled, authenticated insert-only client access, service-role access, and expected indexes.
4. The hosted repair path is chosen based on inspection:
   - run pending migration SQL through Supabase when effects are missing;
   - mark migration versions as applied only when effects already exist.
5. A clean local Supabase reset successfully replays the full migration chain.
6. Existing running local Supabase instances can be brought to the same state through `./supabase/scripts/ensure-local-runtime-baseline.sh` without manual SQL.
7. Active local worktrees are identified and either refreshed or explicitly recorded as needing owner follow-up.
8. Backend contract tests validate `public.app_logs` insert-only behavior and sync projection behavior after the repair.
9. `RUNBOOK.md` and `supabase/README.md` describe the canonical migration-history repair/check flow.
10. Historical direct SQL files/snippets are documented as historical/emergency-only and not the source of truth.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `RUNBOOK.md` - add operator steps for hosted migration drift inspection/repair and local parity checks.
  - `supabase/README.md` - replace direct hotfix guidance with migration-first hosted repair guidance.
  - `docs/specs/milestones/M14-observability-and-diagnostics.md` - add this operational follow-up to task breakdown if it remains part of M14 closeout.
- Project-level docs:
  - `docs/specs/03-technical-architecture.md` - no update expected unless the task changes the logging or sync architecture contract.
  - `docs/specs/05-data-model.md` - no update expected unless schema shape changes beyond reconciling the existing migrations.
  - `docs/specs/06-testing-strategy.md` - no update expected unless new recurring verification expectations are introduced.
  - `docs/specs/09-project-structure.md` - no update expected; no new canonical paths should be introduced.

## Testing and verification approach

- Planned checks/commands:
  - `git fetch origin main`
  - `git status --short --branch`
  - `./scripts/worktree-doctor.sh`
  - `./supabase/scripts/reset-local.sh`
  - `./supabase/scripts/ensure-local-runtime-baseline.sh`
  - `./scripts/quality-fast.sh backend`
  - `./scripts/quality-slow.sh backend`
  - hosted inspection: `supabase migration list --linked`
  - hosted repair, only after inspection: `supabase db push --linked --include-all`
  - hosted repair fallback, only when schema effects already exist: `supabase migration repair --status applied <version>`
- Hosted SQL inspection checklist:
  - Check remote migration history includes `20260505213500` and `20260507120000`.
  - Check FK absence:
    - query `pg_constraint` for `session_exercises_exercise_definition_owner_fk` in `app_public`.
  - Check `public.app_logs` existence:
    - `select to_regclass('public.app_logs');`
  - Check RLS:
    - query `pg_class.relrowsecurity` for `public.app_logs`.
  - Check policy:
    - query `pg_policies` for `app_logs_authenticated_insert`.
  - Check grants:
    - authenticated has `INSERT`;
    - authenticated does not have `SELECT`, `UPDATE`, or `DELETE`;
    - anon does not have app-log write/read grants.
  - Check indexes:
    - `app_logs_created_at_idx`
    - `app_logs_level_created_at_idx`
    - `app_logs_event_created_at_idx`
    - `app_logs_user_id_created_at_idx`
- Standard local gate usage:
  - `./scripts/quality-fast.sh backend` is required.
  - `./scripts/quality-slow.sh backend` is required because this task touches hosted/local Supabase migration integrity and RLS contract confidence.
- Test layers covered:
  - SQL migration replay.
  - Supabase local contract tests.
  - Hosted manual smoke/inspection.
- Execution triggers:
  - Always for this task.
- Slow-gate triggers:
  - Required; do not mark complete without either running it or recording an environment blocker such as unavailable Docker.
- Hosted/deployed smoke ownership:
  - This task owns hosted inspection and hosted migration-history repair.
- CI/manual posture note:
  - CI is absent/partial. Record local command output summaries and hosted SQL/CLI inspection results in the completion note without secrets.

## Implementation notes

- Planned files/areas allowed to change:
  - `docs/tasks/T-20260510-01-supabase-migration-history-repair.md`
  - `RUNBOOK.md`
  - `supabase/README.md`
  - `docs/specs/milestones/M14-observability-and-diagnostics.md` if adding the follow-up to milestone tracking
  - no migration SQL changes unless inspection proves the existing migrations do not represent the intended state
- Project structure impact:
  - No structure changes expected.
- Constraints/assumptions:
  - Treat checked-in files under `supabase/migrations/**` as the source of truth.
  - Do not run direct hosted SQL to recreate already-tracked migrations unless the Supabase migration path cannot be used and a human explicitly approves the fallback.
  - Use schema inspection before `migration repair`; never mark a migration applied merely because the file exists locally.
  - Do not expose `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or hosted connection strings in task notes.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh backend`
- Standard local slow gate: `./scripts/quality-slow.sh backend`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/T-20260510-01-supabase-migration-history-repair.md`
- Additional gates:
  - hosted migration-history inspection through Supabase CLI
  - hosted SQL inspection for FK absence and `public.app_logs` contract

## Evidence

- Branch/HEAD and sync status:
  - `main @ 7642e51`; `git fetch origin main` completed; `main...origin/main` was `0 0`.
- Worktree/runtime setup:
  - `./scripts/worktree-doctor.sh` initially failed because generated Supabase config/env links were missing.
  - `./scripts/worktree-setup.sh` repaired `supabase/config.toml`, `supabase/.env.local`, and `supabase/functions/.env.local`.
  - `./scripts/worktree-doctor.sh` then passed for slot `0`; no additional active worktrees were listed by `git worktree list --porcelain`.
- Local Docker/WSL note:
  - Docker Desktop was running, but Docker access needed sandbox escalation from WSL; `docker info --format '{{.ServerVersion}} {{.OperatingSystem}}'` succeeded outside the sandbox with Docker Desktop.
  - RUNBOOK now includes the Docker Desktop WSL integration preflight link and check.
- Local reset result:
  - `./supabase/scripts/reset-local.sh` initially failed while containers were settling; rerunning `supabase db reset --local --yes --debug` succeeded and replayed through `20260505213500_relax_session_exercise_definition_fk.sql` and `20260507120000_create_app_logs.sql`.
  - Subsequent `./supabase/scripts/ensure-local-runtime-baseline.sh` passed.
- Backend gates:
  - `./scripts/quality-fast.sh backend` passed.
  - `./scripts/quality-slow.sh backend` passed, including auth/authz, sync API contract, and sync events ingest contract suites.
- Hosted evidence:
  - `supabase link --project-ref <redacted> --yes` succeeded using the saved `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN`.
  - `supabase migration list --linked` initially showed `20260505213500` and `20260507120000` as local-only.
  - `supabase db dump --linked --schema public,app_public --file /tmp/boga-hosted-schema.sql` completed.
  - Hosted schema dump confirmed the target effects already existed:
    - `session_exercises_exercise_definition_owner_fk` was absent.
    - `app_public.session_exercises.exercise_definition_id` had the durable metadata comment.
    - `public.app_logs` existed with expected columns/checks, RLS enabled, `app_logs_authenticated_insert`, authenticated `INSERT`, service-role access, and expected indexes.
  - `supabase migration repair --status applied 20260505213500 20260507120000 --linked` succeeded.
  - Post-repair `supabase migration list --linked` showed both `20260505213500` and `20260507120000` in the Remote column.
- Required local evidence:
  - branch/HEAD and sync status
  - local reset result
  - backend fast/slow gate result
  - worktree/local-instance refresh notes
- Required hosted evidence:
  - migration list summary showing both versions applied
  - FK absence SQL result summary
  - `public.app_logs` contract SQL result summary
  - repair action taken (`db push`, `migration repair`, or no-op) with rationale
- Manual verification summary (required when CI is absent/partial): local Supabase reset/baseline plus backend fast/slow gates passed; hosted schema inspection proved the target effects already existed, and hosted migration history was repaired metadata-only for `20260505213500` and `20260507120000`.
- Deferred/manual hosted checks summary:
  - `none`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: documented the hosted migration drift repair flow and repaired hosted migration history metadata for the two target versions.
  - Documented the hosted migration drift repair flow in `RUNBOOK.md` and `supabase/README.md`, including migration-first repair rules and WSL/Docker Desktop preflight guidance.
  - Added M14 task tracking for this operational follow-up.
  - Confirmed hosted schema effects already existed and marked `20260505213500` and `20260507120000` as applied in hosted Supabase migration history.
- What tests ran: local Supabase reset/baseline plus backend fast and slow gates passed.
  - `git fetch origin main`
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260510-01-supabase-migration-history-repair.md`
  - `./scripts/worktree-doctor.sh`
  - `./scripts/worktree-setup.sh`
  - `docker info --format '{{.ServerVersion}} {{.OperatingSystem}}'`
  - `supabase db reset --local --yes --debug`
  - `./supabase/scripts/ensure-local-runtime-baseline.sh`
  - `./scripts/quality-fast.sh backend`
  - `./scripts/quality-slow.sh backend`
  - `supabase link --project-ref <redacted> --yes`
  - `supabase migration list --linked`
  - `supabase db dump --linked --schema public,app_public --file /tmp/boga-hosted-schema.sql`
  - `supabase migration repair --status applied 20260505213500 20260507120000 --linked`
  - `supabase migration list --linked`
- What remains: none for this task.
  - Older local-only migration rows still appear in `supabase migration list --linked`; they include local/bootstrap history outside this task's acceptance criteria and were not repaired in this task.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If cross-cutting behavior changes, update project-level docs (`03`, `04`, `05`, `06`) in the same session.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update `docs/specs/milestones/M14-observability-and-diagnostics.md` if this task becomes part of M14 closeout.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260510-01-supabase-migration-history-repair.md` or document why it is unavailable.
