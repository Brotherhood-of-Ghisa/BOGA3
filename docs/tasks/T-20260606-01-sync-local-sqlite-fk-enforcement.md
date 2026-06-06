---
task_id: T-20260606-01-sync-local-sqlite-fk-enforcement
milestone_id: "M13"
status: planned
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
  - Inspect `apps/mobile/src/data/bootstrap.ts` for production SQLite open/bootstrap behavior.
  - Inspect `apps/mobile/app/__tests__/helpers/in-memory-db.ts` for current FK-enabled test helper behavior.
  - Inspect local schema FK declarations under `apps/mobile/src/data/schema/**`.
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

- Record targeted Jest output.
- Record `./scripts/quality-fast.sh frontend` output.
- Record `./scripts/quality-slow.sh frontend` output.
- Manual verification summary:
  - include whether FK pragma was observed as enabled and whether logger assertions passed.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If completed/outdated, move this file to `docs/tasks/complete/`.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260606-01-sync-local-sqlite-fk-enforcement.md` or document why `N/A`.
