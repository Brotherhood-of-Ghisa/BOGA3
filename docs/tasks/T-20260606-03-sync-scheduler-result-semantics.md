---
task_id: T-20260606-03-sync-scheduler-result-semantics
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

- Task ID: `T-20260606-03-sync-scheduler-result-semantics`
- Title: Make scheduler success reflect real sync convergence
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

- Record targeted Jest output.
- Record `./scripts/quality-fast.sh frontend` output.
- Manual verification summary:
  - include scheduler result matrix and logger assertion summary.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-03-sync-scheduler-result-semantics.md` or document why `N/A`.
