---
task_id: T-20260606-04-sync-push-fk-preflight
milestone_id: "M13"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/03-technical-architecture.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260606-04-sync-push-fk-preflight`
- Title: Add push-side FK closure preflight and diagnostics
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
  - Inspect `apps/mobile/src/sync/cycle.ts` `selectPushBatch` and `runPushLeg`.
  - Inspect `apps/mobile/src/sync/topo-order.ts` and drift checker FK graph handling.
  - Inspect FK-enabled tests for dirty entities and sync-cycle push behavior.
- Known stale references or assumptions:
  - This task is single-device hardening. It should prevent local orphan rows from blocking sync, not solve multi-device conflicts.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-04-sync-push-fk-preflight.md`

## Objective

Before calling `sync_push`, detect dirty child rows whose required FK parents are missing locally or cannot be proven safe for the selected batch, and log actionable diagnostics instead of sending a batch that will predictably fail on the server.

## Scope

### In scope

- Define the local FK dependency graph for syncable entities in one reusable place or derive it from existing schema/topo-order metadata.
- Add preflight validation for selected push batches.
- Detect missing local parents for dirty child rows.
- Detect selected children whose required dirty parents were excluded from the batch due to cap/order, if applicable.
- Add structured logs for preflight failures.
- Decide whether this task blocks the whole push with a structured error or skips only the offending row; if skipping requires persistence, defer that to the quarantine task and clearly document the temporary behavior.

### Out of scope

- Persistent quarantine table and skip-and-continue behavior unless the implementation remains small and fully tested.
- UI repair flows.
- Server RPC changes.
- Multi-device conflict resolution.

## UI Impact (required checkpoint)

- UI Impact?: `no`

## Acceptance criteria

1. Push selection/preflight checks required FK parent existence for dirty child rows before `sync_push` is called.
2. An orphan dirty `session_exercises` row referencing a missing `sessions` parent is detected client-side in tests.
3. At least one layer-3 child case is tested, for example orphan `exercise_sets` or `session_exercise_tags`.
4. A valid parent plus child dirty graph still pushes in topological order.
5. A valid independent dirty row is not incorrectly blocked by an unrelated valid graph.
6. The RPC spy proves predictable orphan batches are not sent to `sync_push`.
7. Preflight failure records a structured cycle error code that downstream status surfaces can distinguish from server `FK_VIOLATION`.
8. Preflight failure logs a structured event through `logEvent` with safe context: child type/id hash or id if policy permits, parent type, missing parent field, batch size, and error code. Do not log full row payloads or user-entered names.
9. Logger failure does not replace the sync preflight error.
10. Docs state the temporary behavior clearly: whether preflight blocks all push until the row is repaired, or whether valid rows continue.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/03-technical-architecture.md` - record push preflight behavior if it changes runtime semantics.
  - `docs/specs/06-testing-strategy.md` - record preflight coverage expectations.
  - `docs/specs/tech/client-sync-engine.md` - document FK closure preflight and temporary limitation before quarantine.
  - `RUNBOOK.md` - review; update only if log/operator workflow changes.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-push.test.ts app/__tests__/sync-cycle-convergence.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync/dirty-bit-per-entity.test.ts`
  - `./scripts/quality-fast.sh frontend`
- Test layers covered:
  - sync push unit tests with FK-enabled in-memory SQLite
  - logger spy/unit coverage
- Slow-gate triggers:
  - `N/A` unless native runtime, schema migration, or UI behavior changes.
- CI/manual posture note:
  - frontend fast gate is CI-covered; record local targeted tests in evidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/sync/cycle.ts`
  - possibly `apps/mobile/src/sync/fk-graph.ts` if a focused helper is warranted
  - sync push/convergence tests
  - docs listed above
- Project structure impact:
  - if adding `apps/mobile/src/sync/fk-graph.ts`, no project-structure doc update is expected because it stays inside existing sync ownership.
- Constraints/assumptions:
  - Keep batch selection deterministic.
  - Do not weaken server-side FK checks; client preflight is defense in depth.
  - Do not log row payloads or user-entered values.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless risk triggers change during implementation.
- Additional gate(s): targeted Jest commands above.

## Evidence

- Record targeted Jest output.
- Record `./scripts/quality-fast.sh frontend` output.
- Manual verification summary:
  - include RPC-not-called assertion for orphan preflight and logger assertion summary.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-04-sync-push-fk-preflight.md` or document why `N/A`.
