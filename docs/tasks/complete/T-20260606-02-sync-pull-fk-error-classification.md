---
task_id: T-20260606-02-sync-pull-fk-error-classification
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

- Task ID: `T-20260606-02-sync-pull-fk-error-classification`
- Title: Classify and log pull-side local FK failures
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

- Verified current branch + HEAD commit: `codex/review-db-sync-functionalities-for-issues @ 5569b86`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` (`git fetch --prune origin`; current branch is even with upstream at start)
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
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-02-sync-pull-fk-error-classification.md`
  - Inspected `apps/mobile/src/sync/cycle.ts` pull leg and `applyPullPage`.
  - Inspected `apps/mobile/app/__tests__/sync-cycle-pull.test.ts`.
  - Inspected `apps/mobile/src/sync/cycle-error-signal.ts` and logger patterns.
- Known stale references or assumptions:
  - Single-device-per-user reduces conflict-resolution needs but does not remove local corruption/migration/FK-drift handling.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-02-sync-pull-fk-error-classification.md`

## Objective

Convert pull-side local SQLite FK failures from raw database exceptions into structured sync errors with logged diagnostics, while preserving the existing atomic rollback and cursor-not-advanced guarantee.

## Scope

### In scope

- Catch local SQLite FK failures around pull page application.
- Classify them as a sync-cycle error code distinct enough for diagnostics, for example `LOCAL_FK_VIOLATION` or a documented `FK_VIOLATION` subtype.
- Include layer, entity type, page row count, and failing operation in logs when available.
- Preserve transaction rollback and cursor atomicity.
- Add tests that assert structured classification and logger emission.

### Out of scope

- Automatic cursor reset/full-repull recovery.
- Push-side quarantine/preflight.
- UI repair flows.
- Multi-device conflict resolution.

## UI Impact (required checkpoint)

- UI Impact?: `no`

## Acceptance criteria

1. A pull page containing a child row whose parent is missing under FK enforcement no longer surfaces as an unclassified raw SQLite exception to callers.
2. The sync cycle records a structured error code for local FK apply failure.
3. The failing pull transaction rolls back the whole page.
4. The pull cursor for the failed layer does not advance.
5. The code logs a structured `logEvent` event for the exception with safe context: layer, entity type(s), row count, error code, and sanitized exception message.
6. Logger failure is swallowed or isolated so it does not replace the original sync error.
7. Tests include a logger spy proving the pull FK failure emits the expected log event.
8. Existing successful pull LWW tests still pass.
9. Docs describe the classification behavior and explicitly state that recovery is deferred to a later task unless implemented in this task.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/03-technical-architecture.md` - record structured pull FK failure behavior if it becomes part of runtime semantics.
  - `docs/specs/06-testing-strategy.md` - record pull FK classification coverage.
  - `docs/specs/tech/client-sync-engine.md` - document pull failure classification and cursor behavior.
  - `RUNBOOK.md` - review; update only if log inspection/operator workflow changes.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-pull.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-convergence.test.ts app/__tests__/sync-gate-state-bridge.test.ts`
  - `./scripts/quality-fast.sh frontend`
- Test layers covered:
  - Jest sync-cycle tests with FK-enabled in-memory SQLite
  - logger spy/unit coverage
- Slow-gate triggers:
  - `N/A` unless implementation changes native SQLite bootstrap, Maestro flows, or UI.
- CI/manual posture note:
  - frontend fast gate is CI-covered; record local targeted tests in evidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/sync/cycle.ts`
  - `apps/mobile/src/sync/cycle-error-signal.ts` if new error codes are surfaced
  - `apps/mobile/app/__tests__/sync-cycle-pull.test.ts`
  - docs listed above
- Project structure impact:
  - no new canonical paths expected.
- Constraints/assumptions:
  - Do not log full row payloads or user-entered fields.
  - Keep cursor advancement in the same transaction as page application.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless risk triggers change during implementation.
- Additional gate(s): targeted Jest commands above.

## Evidence

- Red check:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-convergence.test.ts` initially failed on the new pull-FK assertions because the raw SQLite error code `SQLITE_CONSTRAINT_FOREIGNKEY` escaped instead of `LOCAL_FK_VIOLATION`.
- Targeted Jest:
  - `(cd apps/mobile && PATH="/Users/sboschi/.nvm/versions/node/v24.14.0/bin:$PATH" npm test -- --runTestsByPath app/__tests__/sync-cycle-pull.test.ts app/__tests__/sync-cycle-convergence.test.ts app/__tests__/sync-gate-state-bridge.test.ts app/__tests__/cycle-error-signal.test.ts app/__tests__/sync-gate-decision.test.ts)`
  - Result: `PASS` - 5 suites, 34 tests.
- Fast gate:
  - `PATH="/Users/sboschi/.nvm/versions/node/v24.14.0/bin:$PATH" ./scripts/quality-fast.sh frontend`
  - Result: `PASS` - lint/typecheck/full Jest (`85` suites, `756` tests). Lint emitted pre-existing warnings in unrelated tests but exited successfully.
- Manual verification summary (required when CI is absent/partial): verified structured code, cursor rollback, and logger behavior.
  - Pull-side local FK apply failures now throw `SyncCycleError` code `LOCAL_FK_VIOLATION`.
  - Failed pull transactions roll back and the failed layer cursor remains unadvanced.
  - Logger spy verifies event `sync.pull_local_fk_violation` with layer, entity types, row count, operation, error code, and sanitized exception message.
  - Logger rejection is isolated and does not replace the original sync error.
  - `RUNBOOK.md` reviewed; no changes required because app-log inspection workflow is unchanged.

## Completion note

- What changed: Added pull-side SQLite FK classification/logging in the sync cycle, propagated `LOCAL_FK_VIOLATION` through the existing gate error signal, and documented runtime/test behavior.
- What tests ran: Targeted Jest suites above plus `./scripts/quality-fast.sh frontend` under Node `v24.14.0` after rebuilding `better-sqlite3` for that ABI.
- What remains: Automatic recovery is intentionally deferred; this task does not reset cursors, full-repull, quarantine rows, wipe local data, or add UI repair flows.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-02-sync-pull-fk-error-classification.md` or document why `N/A`.
