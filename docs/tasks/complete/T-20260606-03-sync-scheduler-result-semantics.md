---
task_id: T-20260606-03-sync-scheduler-result-semantics
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

- Task ID: `T-20260606-03-sync-scheduler-result-semantics`
- Title: Make scheduler success reflect real sync convergence
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

- Verified current branch + HEAD commit: `codex/review-db-sync-functionalities-for-issues` @ `cb0a076d4806b19cf5e1c9a7480647891f504956`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `N/A` (continued on the existing review branch; no upstream sync requested for this scoped frontend/docs change)
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
  - Inspect `apps/mobile/src/sync/cycle.ts` `runSyncCycle` return/error behavior.
  - Inspect `apps/mobile/src/sync/scheduler.ts` success/error state updates.
  - Inspect `apps/mobile/app/__tests__/sync-scheduler.test.ts`, `scheduler-state-table.test.ts`, and status accessor/composer tests.
- Known stale references or assumptions:
  - `AUTH_REQUIRED` is still a route-level/session state, not a successful data sync.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-03-sync-scheduler-result-semantics.md`

## Objective

Prevent scheduler/status surfaces from treating retryable or auth-required sync outcomes as successful convergence, and add structured logging for non-converged cycle results.

## Scope

### In scope

- Change `runSyncCycle` to return a result enum/object or otherwise expose `converged`, `auth_required`, `retryable_error`, and `structural_error` distinctly.
- Update scheduler status handling so `lastSuccessAtMs` updates only after real convergence/progress success.
- Keep retryable/internal failures visible in scheduler/status state.
- Keep `AUTH_REQUIRED` visible as auth-required without recording false success.
- Add structured logging for cycle results and exceptions.

### Out of scope

- Changing scheduler cadence/backoff policy.
- Push quarantine/preflight.
- UI redesign of sync status surfaces unless tests require small copy/state adjustments.
- Multi-device conflict resolution.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task changes status semantics and tests. If implementation changes visible profile/sync status text, update `ui_impact` to `yes` and load UI refs before editing UI.

## Acceptance criteria

1. `INTERNAL` or retryable sync failure does not update `lastSuccessAtMs`.
2. `INTERNAL` or retryable sync failure remains visible through scheduler/status accessors until a genuinely successful cycle clears it.
3. `AUTH_REQUIRED` does not update `lastSuccessAtMs`.
4. A converged cycle updates `lastSuccessAtMs` and clears prior retryable error state.
5. A thrown structural error still settles the state machine according to the existing cadence policy but does not record success.
6. Scheduler tests cover each result class.
7. Status accessor/composer tests cover the no-false-success behavior.
8. The code logs structured events for cycle completion, retryable failure, auth-required, and structural failure, with safe context and sanitized messages.
9. Logger failure does not change scheduler state transitions or mask the original result.
10. Docs describe the result semantics and distinguish scheduler cadence from sync success.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/03-technical-architecture.md` - record scheduler success semantics if changed.
  - `docs/specs/06-testing-strategy.md` - record coverage for result semantics.
  - `docs/specs/tech/client-sync-engine.md` - document cycle result contract and status behavior.
  - `RUNBOOK.md` - review; update only if log inspection/operator workflow changes.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-scheduler.test.ts app/__tests__/sync/scheduler-state-table.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/scheduler-status-accessor.test.ts app/__tests__/sync-status-composer.test.ts app/__tests__/sync-cycle-convergence.test.ts`
  - `./scripts/quality-fast.sh frontend`
- Test layers covered:
  - scheduler unit tests
  - status mapping tests
  - sync-cycle outcome tests
  - logger spy/unit coverage
- Slow-gate triggers:
  - `N/A` unless UI, native runtime, or Maestro-sensitive behavior changes.
- CI/manual posture note:
  - frontend fast gate is CI-covered; record local targeted tests in evidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/sync/cycle.ts`
  - `apps/mobile/src/sync/scheduler.ts`
  - `apps/mobile/src/sync/sync-status.ts` or status accessors if needed
  - sync/status tests
  - docs listed above
- Project structure impact:
  - no new canonical paths expected.
- Constraints/assumptions:
  - Do not change retry interval constants unless explicitly justified and tested.
  - Do not log payload values or user-entered data.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless risk triggers change during implementation.
- Additional gate(s): targeted Jest commands above.

## Evidence

- Targeted Jest (result-semantics suites):
  `npm test -- --runTestsByPath app/__tests__/sync-cycle-convergence.test.ts app/__tests__/scheduler-status-accessor.test.ts app/__tests__/sync-scheduler.test.ts app/__tests__/sync/scheduler-state-table.test.ts app/__tests__/sync-status-composer.test.ts`
  → `Test Suites: 5 passed, 5 total; Tests: 99 passed, 99 total`.
- Adjacent cycle suites (regression sweep):
  `npm test -- --runTestsByPath app/__tests__/background-sync-task.test.ts app/__tests__/sync-cycle-pull.test.ts app/__tests__/sync-cycle-push.test.ts app/__tests__/sync-cycle-race.test.ts app/__tests__/sync/cycle-round-trip.test.ts`
  → `Test Suites: 4 passed, 4 total; Tests: 31 passed, 31 total`.
- Fast gate: `./scripts/quality-fast.sh frontend` → lint + typecheck + jest green
  (`Test Suites: 85 passed, 85 total; Tests: 765 passed, 765 total`).
- Manual verification summary (required when CI is absent/partial): scheduler result matrix (observable status via `getSchedulerStatus`):
  - `converged` → `lastSuccessAtMs` advances, `lastCycleError` cleared.
  - `auth_required` → `lastSuccessAtMs` untouched (no false success); auth surfaced via auth-required signal.
  - `retryable_error` (`INTERNAL`) → `lastSuccessAtMs` untouched, `lastCycleError = 'INTERNAL'`, cleared only by a later converged cycle.
  - thrown structural (`FK_VIOLATION` / `LOCAL_FK_VIOLATION`) → `lastSuccessAtMs` untouched, `lastCycleError` retains the thrown message; cadence settles into the long backstop unchanged.
  - Logger assertions: `sync.cycle_result` emitted per finished cycle (info/warn/error by class, error code + sanitized message for error classes); a failed result log never masks a converged result or a thrown structural error.

## Completion note

- What changed: `runSyncCycle` now returns a classified result and the scheduler records success only on real convergence; full breakdown below.
  - `apps/mobile/src/sync/cycle.ts`: `runSyncCycle` now returns a classified `SyncCycleResult` (`converged` / `auth_required` / `retryable_error`); structural FK errors still throw `SyncCycleError`. Added a fire-and-forget `sync.cycle_result` structured log (sanitized) for every finished cycle, plus a `settleConverged` helper.
  - `apps/mobile/src/sync/scheduler.ts`: `startCycle` folds the result via a new `recordCycleResult` — `lastSuccessAtMs` advances only on `converged`; auth-required/retryable/thrown outcomes record no false success and a retryable error stays visible in `lastCycleError` until a later converged cycle clears it. Cadence/state machine unchanged.
  - Tests: extended `sync-cycle-convergence.test.ts` (result contract + `sync.cycle_result` logging + logger-failure isolation) and `scheduler-status-accessor.test.ts` (per-result-class success semantics).
  - Docs: `03-technical-architecture.md` (new decision row), `06-testing-strategy.md` (result-semantics coverage), `tech/client-sync-engine.md` (failure-mode entry 14 + test overview), `RUNBOOK.md` (sync-health triage via `sync.cycle_result`).
- What tests ran: the targeted Jest suites and `./scripts/quality-fast.sh frontend` above — all green.
- What remains: nothing for this card. Background-task behavior is unchanged (it ignores the return value; structural errors still throw → `Failed`). No slow-gate trigger (no UI/native/Maestro-sensitive change).

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-03-sync-scheduler-result-semantics.md` or document why `N/A`.
