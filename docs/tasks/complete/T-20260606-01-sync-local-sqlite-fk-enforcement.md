---
task_id: T-20260606-01-sync-local-sqlite-fk-enforcement
milestone_id: "M13"
status: completed
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260606-01-sync-local-sqlite-fk-enforcement`
- Title: Enable and verify local SQLite foreign-key enforcement
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

- Verified current branch + HEAD commit: `codex/review-db-sync-functionalities-for-issues` at `695940b`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - ran `./scripts/task-bootstrap.sh docs/tasks/T-20260606-01-sync-local-sqlite-fk-enforcement.md` and `git fetch --prune origin`; branch was `0	0` vs upstream and `2	1` vs `origin/main`, so no rebase/merge was performed.
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
  - `docs/specs/milestones/M13-simple-backend-sync.md`
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md`
- Code/docs inventory freshness checks run:
  - Inspect `apps/mobile/src/data/bootstrap.ts` for production SQLite open/bootstrap behavior.
  - Inspect `apps/mobile/app/__tests__/helpers/in-memory-db.ts` for current FK-enabled test helper behavior.
  - Inspect local schema FK declarations under `apps/mobile/src/data/schema/**`.
  - Inspect `apps/mobile/.maestro/flows/{smoke-launch,data-runtime-smoke}.yaml` and `apps/mobile/scripts/maestro-ios-{run-flow,gates}.sh` while diagnosing required slow-gate launcher/selector failures.
- Known stale references or assumptions:
  - Single-device-per-user is the product assumption for this hardening pass; do not introduce multi-device conflict resolution.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260606-01-sync-local-sqlite-fk-enforcement.md`

## Objective

Make local SQLite FK enforcement explicit in production bootstrap and prove it in tests, so invalid local graphs fail near the write that created them instead of surfacing only later as server-side sync failures.

## Scope

### In scope

- Enable `PRAGMA foreign_keys = ON` when the production Expo SQLite connection is opened.
- Add a small production-bootstrap-adjacent test or abstraction test proving FK enforcement is enabled.
- Add or adjust representative FK-enabled repository/sync tests so they run against the same enforcement expectation.
- Add startup diagnostics for FK pragma/integrity failures through the existing app logger.
- Update data-model/testing/sync docs to record that local FK enforcement is required.

### Out of scope

- Multi-device conflict resolution.
- Push quarantine or pull recovery behavior; later task cards own those.
- Any schema relationship redesign.
- UI changes.

## UI Impact (required checkpoint)

- UI Impact?: `no`

## Acceptance criteria

1. `bootstrapLocalDataLayer()` or the SQLite open path explicitly enables `PRAGMA foreign_keys = ON` before normal repository/sync writes can run.
2. A test proves the production bootstrap/open abstraction has FK enforcement enabled, not only the in-memory helper's optional `{ foreignKeys: true }` mode.
3. A negative FK insert/update test fails locally with FK enforcement enabled.
4. Existing representative repository write tests that depend on parent rows continue to pass with FK enforcement enabled.
5. On bootstrap FK pragma/integrity failure, the code logs a structured event through the existing app logger (`logEvent`) with safe context such as `source: "sync"` or `source: "data"`, operation name, pragma state, and sanitized error message.
6. Logging is non-blocking: logger failure must not mask the original bootstrap/FK failure.
7. `docs/specs/05-data-model.md` records local FK enforcement as part of the local data integrity contract.
8. `docs/specs/06-testing-strategy.md` records that FK-sensitive sync/data tests should enable FK enforcement.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - record required local SQLite FK enforcement.
  - `docs/specs/06-testing-strategy.md` - record FK-enabled test expectations for sync/data paths.
  - `docs/specs/tech/client-sync-engine.md` - mention local FK enforcement as a guard before push.
  - `RUNBOOK.md` - review; update only if operator workflow changes.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/local-data-bootstrap.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-pull.test.ts app/__tests__/sync/dirty-bit-per-entity.test.ts`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
- Test layers covered:
  - unit/integration tests against local SQLite
  - native runtime Maestro/data-smoke via frontend slow gate
- Slow-gate triggers:
  - required because the task changes production SQLite bootstrap behavior.
- CI/manual posture note:
  - frontend fast gate is CI-covered; frontend slow gate is local/manual and must be recorded in evidence.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/bootstrap.ts`
  - `apps/mobile/app/__tests__/**`
  - docs listed above
- Project structure impact:
  - no new canonical paths expected.
- Constraints/assumptions:
  - Preserve local tracker usability; FK failures should be loud for diagnostics but not converted into broad app crashes beyond the failing operation.
  - Do not log row payloads, exercise names, gym names, or user-entered values.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Additional gate(s): targeted Jest commands above

## Evidence

- Targeted Jest:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/local-data-bootstrap.test.ts` - PASS, 11 tests.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-cycle-pull.test.ts app/__tests__/sync/dirty-bit-per-entity.test.ts` - PASS, 17 tests after rebuilding `better-sqlite3` for the active Node ABI.
- Typecheck:
  - `cd apps/mobile && npm run typecheck` - PASS.
- Script syntax:
  - `bash -n apps/mobile/scripts/maestro-ios-run-flow.sh apps/mobile/scripts/maestro-ios-gates.sh` - PASS.
- Standard fast gate:
  - `./scripts/quality-fast.sh frontend` - PASS; lint reported 11 existing warnings and 0 errors; Jest reported 85 passed suites, 754 passed tests, 1 snapshot.
- Standard slow gate:
  - `./scripts/quality-slow.sh frontend` - PASS.
  - Artifacts:
    - smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260606-193419-58849`
    - data-smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260606-193559-60403`
    - launch-requires-sign-in: `apps/mobile/artifacts/maestro/ad-hoc/20260606-193853-62341`
    - sync-gate-first-cycle: `apps/mobile/artifacts/maestro/ad-hoc/20260606-194108-63810`
    - settings-sync-status: `apps/mobile/artifacts/maestro/ad-hoc/20260606-194330-65281`
    - auth-profile-happy-path: `apps/mobile/artifacts/maestro/ad-hoc/20260606-194535-61919`
- Manual verification summary (required when CI is absent/partial): FK pragma enablement and diagnostic logging were verified in production-bootstrap-adjacent tests.
  - FK pragma was observed through production-bootstrap-adjacent mock assertions: `PRAGMA foreign_keys = ON`, `PRAGMA foreign_keys`, and `PRAGMA foreign_key_check` all run during bootstrap.
  - Logger assertions passed for pragma-off, integrity-check violation, and non-blocking logger rejection cases.
  - `RUNBOOK.md` was reviewed; no operator workflow change was needed.

## Completion note

- What changed: Production Expo SQLite bootstrap now enables/verifies FK enforcement, runs `PRAGMA foreign_key_check` after migrations/seeds, emits safe non-blocking structured app-log diagnostics on FK bootstrap failures, adds bootstrap tests for pragma/integrity/logging behavior, records the local FK contract in docs, and hardens Maestro smoke/data-smoke launcher assertions needed to complete the slow gate.
- What tests ran: Targeted Jest, typecheck, script syntax check, `./scripts/quality-fast.sh frontend`, and `./scripts/quality-slow.sh frontend` as recorded above.
- What remains: Nothing for this contract.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`. - done
- If completed/outdated, move this file to `docs/tasks/complete/`. - done
- Run `./scripts/task-closeout-check.sh docs/tasks/complete/T-20260606-01-sync-local-sqlite-fk-enforcement.md` or document why `N/A`. - done; PASS
