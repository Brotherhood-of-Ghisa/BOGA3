---
task_id: M19-T02-Add_load_input_mode_schema_and_sync_contract
milestone_id: "M19"
status: completed
ui_impact: "no"
areas: "frontend|backend|cross-stack|docs"
runtimes: "node|supabase|sql|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test ios-sync-e2e"
docs_touched: "docs/specs/05-data-model.md, docs/specs/tech/sync-v2-server-contract.md"
---

# M19-T02-Add_load_input_mode_schema_and_sync_contract

## Task metadata

- Task ID: M19-T02-Add_load_input_mode_schema_and_sync_contract
- Title: Add load input mode schema and sync contract
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-22
- Session interaction mode: `interactive (default)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- Sync v2 server contract: `docs/specs/tech/sync-v2-server-contract.md`
- Project structure: `docs/specs/09-project-structure.md`
- Backend runbook: `supabase/README.md`

## Context Freshness

- Verified current branch + HEAD commit: authored on `codex/m19-load-mode` from `origin/main` at `ec88290`; verify current branch and HEAD during implementation kickoff.
- Start-of-session sync with `origin/main` completed?: `yes` for card authoring; branch was created from `origin/main` on 2026-07-22. Reverify before edits.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
  - `docs/specs/tech/sync-v2-server-contract.md`
  - `supabase/README.md`
- Code/docs inventory freshness checks run:
  - `rg -n "exercise_definitions|ENTITY_FIELDS|sync_push|sync_pull|loadInputMode" apps/mobile supabase docs/specs` - rerun during task kickoff and inspect exact hits.
  - `rg --files apps/mobile | rg 'schema|sync|drizzle|migration|drift'` - candidate local schema/sync files listed on 2026-07-22.
  - `rg --files supabase` - backend migrations and tests listed on 2026-07-22.
- Known stale references or assumptions: exact migration numbering and generated Drizzle snapshot names must be determined during implementation after syncing the branch.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T02-Add_load_input_mode_schema_and_sync_contract.md`

## Objective

Add exercise-level load-entry metadata to local SQLite, the Supabase mirror, and
Sync v2 so every exercise definition can carry explicit `total_load` or
`per_side_load` semantics across devices.

## Scope

### In scope

- Add a local `exercise_definitions.load_input_mode` field exposed to TypeScript as `loadInputMode`.
- Constrain persisted values to `total_load` and `per_side_load`.
- Add the matching Supabase `app_public.exercise_definitions.load_input_mode` column and constraints.
- Update Sync v2 push, pull, entity field lists, schema drift checks, generated fixtures, and wire tests for the new field.
- Ensure existing local and remote rows get a deterministic compatible value or resolver path during migration.
- Update project-level data model and sync contract docs when the schema/wire behavior becomes canonical.

### Out of scope

- Classifying every seeded exercise's mode; `M19-T03` owns starter-catalog metadata.
- Changing analytics calculations; `M19-T04` owns computation.
- Adding editor or recorder UI; `M19-T05` and `M19-T06` own UI.
- Adding broad restore coverage beyond targeted schema/wire proof; `M19-T08` owns hardening coverage.

## UI Impact

- UI Impact?: `no`
- This task changes persisted metadata and sync transport only.

## Acceptance criteria

1. Local `exercise_definitions` rows can persist `loadInputMode` as `total_load` or `per_side_load`.
2. Supabase `app_public.exercise_definitions` stores the same semantics with a matching constraint/default strategy.
3. Sync push serializes `load_input_mode` for dirty exercise definition rows.
4. Sync pull restores `load_input_mode` into local rows and does not regress ordering or FK closure.
5. Drift checks and schema fixtures reflect the new field.
6. Existing rows migrate without losing exercise definitions or mutating entered set weights.
7. Docs describe that `loadInputMode` is load-distribution semantics, not equipment type.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - document the `exercise_definitions.load_input_mode` field and semantic values.
  - `docs/specs/tech/sync-v2-server-contract.md` - update server schema, payload field maps, push/pull examples, and drift contract.
  - `docs/specs/03-technical-architecture.md` - update only if the implementation adds a new durable runtime decision.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test ios-sync-e2e`
  - `./boga test for --diff <range>`
- Test layers covered: local migration/unit tests, sync wire tests, drift checks, backend SQL/RPC contract tests, device-level sync proof.
- Execution triggers: always before task closeout.
- Slow-gate triggers: schema and Sync v2 wire changes require backend and iOS sync e2e gates.
- Hosted/deployed smoke ownership: backend deployment is not performed in this task; local Supabase backend gates own contract evidence.
- CI/manual posture note: backend and iOS sync e2e lanes run locally on this machine and must not be deferred.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/schema/exercise-definitions.ts`
  - `apps/mobile/drizzle/**`
  - `apps/mobile/src/sync/cycle.ts`
  - `apps/mobile/scripts/check-sync-schema-drift.ts`
  - `apps/mobile/scripts/check-sync-schema-drift.fixtures.json`
  - targeted tests under `apps/mobile/app/__tests__/` and `apps/mobile/app/__tests__/sync/`
  - `supabase/migrations/**`
  - `supabase/tests/**`
- Project structure impact: none planned.
- Constraints/assumptions: use a single exercise-level mode; do not introduce per-set or per-side limb tracking in M19.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test backend`; `./boga test ios-sync-e2e`
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Implementation and contract evidence is captured in the M19 source, test, migration, and spec diff.
- Manual verification summary (required when CI is absent/partial): exercised the shipped behavior through Jest, local Supabase contracts, and the iOS Maestro frontend lane.

## Completion note

- What changed: completed this task's M19 deliverables and updated the corresponding source-of-truth contracts.
- What tests ran: `./boga test fast`, `./boga test backend`, and `./boga test frontend` passed for the integrated milestone.
- What remains: nothing for M19; future left/right tracking and per-set overrides remain explicitly out of scope.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T02-Add_load_input_mode_schema_and_sync_contract.md` or document why `N/A`.
