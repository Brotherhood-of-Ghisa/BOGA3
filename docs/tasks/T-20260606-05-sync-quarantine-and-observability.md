---
task_id: T-20260606-05-sync-quarantine-and-observability
milestone_id: "M13"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/03-technical-architecture.md,docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260606-05-sync-quarantine-and-observability`
- Title: Add sync quarantine for FK-blocked dirty rows
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-06-06`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- Review input: `docs/reviews/db-sync-offline-fk-review-2026-06-06.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes | no | N/A` (explain)
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/tech/client-sync-engine.md`
  - `docs/reviews/db-sync-offline-fk-review-2026-06-06.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Inspect completed output of `T-20260606-04-sync-push-fk-preflight` if landed.
  - Inspect local schema/migration conventions for adding sync runtime tables.
  - Inspect sync status/gate state tests for blocked error surfacing.
- Known stale references or assumptions:
  - This task assumes single-device-per-user. Quarantine handles local structural defects, not multi-device conflict resolution.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-05-sync-quarantine-and-observability.md`

## Objective

Prevent one structurally bad dirty row from permanently blocking an otherwise valid offline backlog by persisting a quarantine record, skipping quarantined rows during push selection, continuing valid pushes, and logging enough diagnostics to repair the defect.

## Scope

### In scope

- Add a local sync quarantine table or equivalent persisted runtime state.
- Persist quarantined row identity, entity type, error code, first/last seen timestamps, occurrence count, and safe diagnostic context.
- Exclude quarantined rows from normal push batch selection.
- Continue pushing valid independent dirty rows after quarantining an orphan row.
- Add status/gate surface data for "blocked rows exist" without building a full repair UI.
- Add structured logging for quarantine creation, repeated detection, and successful non-offending push continuation.

### Out of scope

- Full user-facing repair workflow.
- Automatic destructive local graph repair.
- Multi-device conflict resolution.
- Backend schema changes unless the chosen design unexpectedly needs them.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task may expose blocked-row state to existing status surfaces, but should not introduce new screens or visual repair flows. If visible UI text/layout changes are needed, update `ui_impact` to `yes` and load UI refs before editing UI.

## Acceptance criteria

1. A dirty orphan child row detected by push preflight or server `FK_VIOLATION` is persisted in local quarantine state.
2. Quarantine records include entity type, entity id, error code, first seen time, last seen time, and occurrence count.
3. Quarantined rows are skipped by future push selection until repaired or explicitly cleared.
4. A test with one orphan row and one valid independent dirty row proves the valid row still pushes and clears dirty.
5. A repeated quarantine detection updates `last_seen`/count instead of creating unbounded duplicates.
6. Quarantine state survives app restart/local database reopen.
7. Existing status/gate composition can report that blocked sync rows exist, even if full repair UI is deferred.
8. Quarantine creation logs a structured event through `logEvent` with safe context and no row payload/user-entered values.
9. Continued push after quarantine logs a structured event indicating non-offending rows continued.
10. Logger failure never prevents quarantine persistence or valid row push continuation.
11. Schema/migration tests cover the new quarantine table if added.
12. Docs record quarantine semantics, repair limitations, and operator log expectations.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/03-technical-architecture.md` - record quarantine as sync runtime behavior.
  - `docs/specs/05-data-model.md` - add quarantine table under test/runtime/sync bookkeeping, not user backup scope.
  - `docs/specs/06-testing-strategy.md` - record quarantine coverage expectations.
  - `docs/specs/tech/client-sync-engine.md` - document quarantine flow and status semantics.
  - `RUNBOOK.md` - add log inspection/operator notes if new diagnostics are useful to humans.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-push.test.ts app/__tests__/sync-cycle-convergence.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/domain-schema-migrations.test.ts app/__tests__/bundle-migrations.test.ts`
  - `cd apps/mobile && npm run db:generate:canary`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
- Test layers covered:
  - local schema/migration tests
  - sync push/quarantine Jest tests
  - status/gate mapping tests if state is surfaced
  - native runtime smoke through frontend slow gate if schema changes
- Slow-gate triggers:
  - required if this task adds a SQLite table/migration or changes runtime persistence.
- Hosted/deployed smoke ownership:
  - `N/A`; quarantine is local runtime state unless implementation changes backend contracts.
- CI/manual posture note:
  - local slow frontend evidence is mandatory for local migration/runtime confidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/schema/**`
  - `apps/mobile/drizzle/**`
  - `apps/mobile/src/sync/**`
  - sync/status tests
  - docs listed above
- Project structure impact:
  - no new top-level paths expected.
- Constraints/assumptions:
  - Quarantine state is local runtime bookkeeping, not synced user data.
  - Do not clear user dirty rows silently.
  - Do not log full row payloads, exercise names, gym names, or other user-entered values.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Additional gate(s): targeted Jest commands and `npm run db:generate:canary`

## Evidence

- Record targeted Jest output.
- Record `npm run db:generate:canary` output.
- Record `./scripts/quality-fast.sh frontend` output.
- Record `./scripts/quality-slow.sh frontend` output.
- Manual verification summary:
  - include quarantine persistence, skip/continue behavior, and logger assertion summary.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-05-sync-quarantine-and-observability.md` or document why `N/A`.
