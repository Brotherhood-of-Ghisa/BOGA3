---
task_id: T-20260606-04-sync-push-fk-preflight
milestone_id: "M13"
status: completed
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
- Status: `completed`
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

- Verified current branch + HEAD commit: `codex/review-db-sync-functionalities-for-issues` @ `b6b4047`.
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `N/A` — continued on the existing feature branch where the sibling sync-hardening cards already landed; no rebase needed for this single-file-area change.
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

- Targeted Jest (new + adjacent suites):
  `npx jest --runTestsByPath app/__tests__/sync-cycle-push.test.ts app/__tests__/sync-cycle-convergence.test.ts app/__tests__/sync/dirty-bit-per-entity.test.ts app/__tests__/sync-cycle-push-preflight.test.ts`
  → `Test Suites: 4 passed, 4 total; Tests: 42 passed, 42 total`.
  - New `sync-cycle-push-preflight.test.ts`: 12 passed (7 unit + 5 integration).
- Fast gate: `./scripts/quality-fast.sh frontend` → lint (0 errors, 11 pre-existing warnings), typecheck clean,
  full Jest run `Test Suites: 86 passed, 86 total; Tests: 777 passed, 777 total`, `[quality-fast] done (frontend)`.
- Manual verification summary:
  - RPC-not-called proof: the orphan-batch integration test asserts `pushCalls()` (filtered `sync_push`
    spy calls) has length 0 while the cycle rejects with `LOCAL_FK_VIOLATION` and the orphan row's dirty bit
    stays set.
  - Logger assertions: `sync.push_fk_preflight_violation` emitted once at `error`/`source: 'sync'` with safe
    context only (operation, error_code, batch_size, violation_count, and a violations list of opaque
    child/parent ids + missing FK column — no names/payloads); a separate test injects a rejected `logEvent`
    and confirms the preflight `LOCAL_FK_VIOLATION` still propagates unchanged.
  - False-positive guard: valid parent+child graph, clean-on-server parent, independent valid row, and a null
    nullable FK all produce zero violations; the valid graph still pushes parents-before-children.

## Completion note

- What changed: added a push-side FK closure preflight (new `fk-graph.ts` + `cycle.ts` wiring) that blocks orphan dirty rows before `sync_push`, with tests and spec/RUNBOOK updates. Details:
  - New `apps/mobile/src/sync/fk-graph.ts`: declares the syncable FK dependency graph (`SYNCABLE_FK_GRAPH`,
    mirroring schema `.references(...)` edges whose parent is itself syncable; `muscle_groups` excluded as a
    bundled catalog) and `findPushBatchFkViolations(tx, batch)`, a pure-read closure check.
  - `apps/mobile/src/sync/cycle.ts`: `runPushLeg` now runs the preflight in the same read that snapshots the
    batch; a violation logs `sync.push_fk_preflight_violation` (best-effort, safe context only) and throws
    `SyncCycleError('LOCAL_FK_VIOLATION', …)` WITHOUT calling `sync_push`. The existing `runSyncCycle` catch
    already treats `LOCAL_FK_VIOLATION` as a thrown structural error (marks the cycle error, logs
    `structural_error`, leaves dirty bits/cursors set).
  - Decision (acceptance #10): preflight BLOCKS the whole push on any orphan — no skip-and-continue, no
    persistent quarantine (explicitly deferred to the quarantine task). Documented as temporary in the specs.
  - Tests: new `apps/mobile/app/__tests__/sync-cycle-push-preflight.test.ts`.
  - Docs: `docs/specs/tech/client-sync-engine.md` (new §14 push preflight + test overview entry),
    `docs/specs/03-technical-architecture.md` (decision row), `docs/specs/06-testing-strategy.md` (coverage +
    baseline suite entry), `RUNBOOK.md` (operator triage line for the new event).
- What tests ran: targeted Jest (4 suites / 42 tests) and `./scripts/quality-fast.sh frontend`
  (86 suites / 777 tests, lint + typecheck clean). See Evidence.
- What remains: persistent quarantine + skip-and-continue and a UI repair flow are out of scope here (future
  quarantine task). Server RPC and multi-device conflict resolution unchanged. `test:sync:infra` not exercised
  (branch-provisioned remote; no behavior change to the RPC contract).

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-04-sync-push-fk-preflight.md` or document why `N/A`.
