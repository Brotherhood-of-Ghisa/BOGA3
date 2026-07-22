---
task_id: M19-T08-Add_backend_and_sync_contract_coverage
milestone_id: "M19"
status: completed
ui_impact: "no"
areas: "backend|frontend|cross-stack|docs"
runtimes: "node|supabase|sql|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test ios-sync-e2e"
docs_touched: "docs/specs/tech/sync-v2-server-contract.md, docs/specs/06-testing-strategy.md"
---

# M19-T08-Add_backend_and_sync_contract_coverage

## Task metadata

- Task ID: M19-T08-Add_backend_and_sync_contract_coverage
- Title: Add backend and sync contract coverage
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
  - `rg -n "load_input_mode|exercise_definitions|sync_push|sync_pull|drift|cycle-round-trip|sync-cycle-wire" apps/mobile supabase` - rerun during task kickoff after schema changes land.
  - `rg --files apps/mobile/app/__tests__/sync supabase/tests` - candidate contract tests listed on 2026-07-22.
- Known stale references or assumptions: this task depends on schema/wire implementation from `M19-T02`; update scope if `M19-T02` already delivered equivalent coverage.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T08-Add_backend_and_sync_contract_coverage.md`

## Objective

Add hardening coverage that proves `loadInputMode` survives local sync cycles,
server push/pull contracts, drift checks, and restore/reinstall-style flows.

## Scope

### In scope

- Add or extend local sync wire tests for `exercise_definitions.loadInputMode`.
- Add or extend backend `sync_push` and `sync_pull` contract tests for `load_input_mode`.
- Add drift/as-built checks proving the local and server schemas agree.
- Prove a changed exercise load mode round-trips across Sync v2 and is restored to a clean local database.
- Cover both `total_load` and `per_side_load` values.
- Confirm invalid values are rejected at the correct layer.

### Out of scope

- Adding the schema column itself; `M19-T02` owns implementation.
- Adding seeded defaults; `M19-T03` owns seed metadata.
- Adding UI behavior; `M19-T05` and `M19-T06` own UI.
- Reworking sync topology unless the new field exposes a real ordering bug.

## UI Impact

- UI Impact?: `no`
- This task is contract and sync coverage only.

## Acceptance criteria

1. Local sync wire tests include `loadInputMode` on `exercise_definitions`.
2. Backend push contract persists `load_input_mode` for exercise definitions.
3. Backend pull contract returns `load_input_mode` for exercise definitions.
4. Drift checks fail if the field is missing or has mismatched type/nullability/constraint expectations.
5. Restore-style coverage proves both load modes survive a sync round trip.
6. Invalid load modes are rejected or normalized according to the schema contract.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/tech/sync-v2-server-contract.md` - update if coverage clarifies required payload/constraint behavior.
  - `docs/specs/06-testing-strategy.md` - update if this introduces a recurring named sync coverage expectation.
  - `docs/specs/05-data-model.md` - update only if coverage reveals a data contract correction.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test backend`
  - `./boga test ios-sync-e2e`
  - `./boga test for --diff <range>`
- Test layers covered: Jest sync wire/roundtrip tests, Supabase SQL/RPC contract tests, drift checks, iOS sync e2e lane.
- Execution triggers: always before task closeout.
- Slow-gate triggers: sync contract and restore behavior require backend and iOS sync e2e gates.
- Hosted/deployed smoke ownership: `N/A`; local Supabase contract gates own backend proof.
- CI/manual posture note: backend and iOS sync e2e gates are local-only and must run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/__tests__/sync-cycle-wire.test.ts`
  - `apps/mobile/app/__tests__/sync/cycle-round-trip.test.ts`
  - `apps/mobile/app/__tests__/sync/drift-check.test.ts`
  - `apps/mobile/scripts/check-sync-schema-drift.fixtures.json`
  - `supabase/tests/sync-push-contract.sh`
  - `supabase/tests/sync-pull-contract.sh`
  - `supabase/tests/sync-v2-drift-asbuilt.sh`
  - targeted sync fixtures/helpers
- Project structure impact: none planned.
- Constraints/assumptions: read `apps/mobile/app/__tests__/sync/README.md` before editing sync tests.

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
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T08-Add_backend_and_sync_contract_coverage.md` or document why `N/A`.
