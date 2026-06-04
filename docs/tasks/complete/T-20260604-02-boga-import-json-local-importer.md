---
task_id: T-20260604-02-boga-import-json-local-importer
milestone_id: "M13"
status: completed
ui_impact: "no"
areas: "frontend|cross-stack|docs"
runtimes: "node|expo|supabase"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "RUNBOOK.md,docs/specs/09-project-structure.md as needed"
---

# Task Card

## Task metadata

- Task ID: `T-20260604-02-boga-import-json-local-importer`
- Title: Generic BOGA import JSON local SQLite importer
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-06-04`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md` (completed baseline; this is post-M13 import/sync-load tooling)
- Upstream task/card: `docs/tasks/complete/T-20260604-01-boga-import-json-contract-and-gymbook-digester.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/external-app-import-tool` at `5524515`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - ran `git fetch origin codex/external-app-import-tool`; local branch and fetched branch were even (`0 0`) before edits.
- Parent refs opened in this planning session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/tasks/README.md`
  - `RUNBOOK.md`
  - `supabase/session-sync-api-contract.md`
  - `apps/mobile/src/data/schema/sessions.ts`
  - `apps/mobile/src/data/schema/session-exercises.ts`
  - `apps/mobile/src/data/schema/exercise-sets.ts`
  - `apps/mobile/src/data/schema/gyms.ts`
  - `apps/mobile/src/data/schema/exercise-definitions.ts`
  - `apps/mobile/src/data/clock.ts`
  - `apps/mobile/src/sync/cycle.ts`
- Code/docs inventory freshness checks run:
  - Current local schema review - import target rows are `gyms`, `sessions`, `session_exercises`, `exercise_sets`, optional `exercise_definitions`, and optional `exercise_muscle_mappings`.
  - Sync review - local sync push is dirty-row based; imported sync-scoped rows should be written with `local_dirty = 1` and sync-safe `local_updated_at_ms` values so existing sync can push them later.
  - Generic importer depends on the JSON contract owned by `T-20260604-01-boga-import-json-contract-and-gymbook-digester`.
- Known stale references or assumptions:
  - Do not start this task until the BOGA-friendly JSON contract from `T-20260604-01` is reviewed/locked.
  - Local mobile SQLite rows do not carry a backend `owner_user_id`; the selected local app database/profile is the effective import target.
  - Remote import is explicitly out of scope, but imported local dirty rows should be usable as a large sync dataset in follow-up/manual validation.
- Optional helper command (recommended at execution start):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260604-02-boga-import-json-local-importer.md`

## Objective

Implement the generic local importer that consumes a locked BOGA-friendly JSON package and writes it into the target local BOGA SQLite/Drizzle database as normal dirty user-domain rows. This importer must not know about GymBook-specific XML; source-specific logic belongs in upstream digesters.

## Scope

### In scope

- Consume the BOGA-friendly JSON contract produced by `T-20260604-01`.
- Validate the JSON package before any write.
- Refuse packages with unresolved exercise decisions, unresolved gym decisions, unresolved duration warnings when configured as fatal, malformed rows, duplicate IDs, FK gaps, or unknown contract versions.
- Ask/confirm "who is importing?" and target database/profile before writing, matching the metadata in the JSON package.
- Add a generic local importer script with a meaningful name, for example `import-boga-json-local.ts`.
- Insert local rows in FK-safe order:
  - optional new `gyms`
  - optional new `exercise_definitions`
  - optional `exercise_muscle_mappings`
  - `sessions`
  - `session_exercises`
  - `exercise_sets`
- Mark imported sync-scoped rows dirty with valid `local_dirty = 1` and sync-safe `local_updated_at_ms` values so normal M13 sync can push them later.
- Preserve BOGA's existing timestamp semantics for `started_at`, `completed_at`, `duration_sec`, `created_at`, and `updated_at`.
- Treat skipped source rows as absent; importer should only see importable rows from the JSON package.
- Add idempotency protection so re-running the same import package does not duplicate already-imported sessions unless the user explicitly forces it.
- Add dry-run/report mode that prints row counts by table, warning counts, duplicate/imported counts, target database/profile information, and force/idempotency posture without writing.
- Add tests for JSON validation, FK-safe row ordering, dirty-bit stamping, idempotency, and dry-run no-write behavior against an in-memory SQLite fixture or test database using the real schema/migration bundle.
- Update `RUNBOOK.md` with the local import workflow and warning about backing up local data before destructive or force import runs.

### Out of scope

- GymBook XML parsing.
- Changing the BOGA-friendly JSON contract unless coordinated back into `T-20260604-01`.
- Remote Supabase import.
- Service-role/admin import.
- Hosted database writes.
- Schema changes to add notes, source import tables, or new ownership columns unless the implementation proves they are required and updates data-model/sync docs in the same session.
- UI changes.
- New mobile screens or in-app import flow.
- Importing skipped GymBook rows.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale: this task adds local command-line import tooling and tests only; it does not change screens, routes, navigation, visual appearance, or touch interactions.

## Acceptance criteria

1. The importer accepts the locked BOGA-friendly JSON contract from `T-20260604-01` and has no GymBook-specific parsing logic.
2. The importer validates contract version, source metadata, target/importing profile metadata, sessions, exercises, sets, gyms, timestamps, IDs, and FK references before writes.
3. The importer refuses unresolved exercise or gym mappings by default.
4. The importer asks/accepts confirmation of the target local database/profile before writing and reports mismatches with JSON metadata.
5. Dry-run mode reports intended row counts by table and performs no writes.
6. The importer writes rows in FK-safe order.
7. Imported `sessions` rows are completed sessions with valid `started_at`, `completed_at`, and `duration_sec`.
8. Imported `session_exercises` preserve exercise order and reference the intended exercise definitions.
9. Imported `exercise_sets` preserve set order, `weight_value`, `reps_value`, and `set_type` where present.
10. Optional new exercise definitions and muscle mappings are written only when explicitly present/resolved in the JSON package.
11. Optional gym references use existing target local gym IDs or explicitly created/imported gym rows from the JSON package.
12. Every imported sync-scoped row that should later push to remote is left with `local_dirty = 1` and a valid sync-safe `local_updated_at_ms`.
13. The importer is idempotent for the same import package by default and reports already-imported sessions rather than duplicating them.
14. A force/import-again mode, if added, is explicit and documented.
15. Targeted tests cover validation failure, dry-run no-write, successful insert, dirty-bit stamping, FK-safe ordering, and idempotent re-run.
16. `RUNBOOK.md` documents the local import sequence: review JSON, dry-run import, backup/target confirmation, import, and optional sync stress validation.
17. No private full export data or personal workout details are committed beyond small synthetic/redacted fixtures.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `RUNBOOK.md` - add operator workflow for generic local import, including dry-run, backup, target confirmation, and sync-load-test notes.
  - `docs/specs/09-project-structure.md` - update only if implementation introduces a new canonical import-tool folder or reusable import package location beyond existing `apps/mobile/scripts/**`.
  - `docs/specs/05-data-model.md` - update only if implementation adds import metadata tables/columns or otherwise changes data-model/sync boundaries; no schema change is expected.
  - `docs/specs/06-testing-strategy.md` - update only if importer verification becomes a stable new test layer or shared gate expectation; targeted tests plus existing gates are expected.
- Project-level docs rule:
  - If implementation changes schema, sync scope, or cross-cutting local operator workflow, promote stable behavior to the relevant project-level docs in the same session.

## Testing and verification approach

- Planned checks/commands:
  - targeted importer validation tests using the shared migration-backed SQLite test fixture
  - targeted dirty-bit and idempotency tests
  - `cd apps/mobile && npm test -- --runTestsByPath <new importer test files>`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend` after a successful real local import if using the imported dataset as a sync/e2e stress candidate
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` is mandatory because this changes mobile workspace TypeScript scripts/tests.
  - `./scripts/quality-slow.sh frontend` is risk-triggered/required when the implementation session performs the large local import and validates that the app still opens and sync-capable local data remains healthy.
- Test layers covered:
  - contract/JSON validation
  - data-layer import integration against local SQLite schema
  - optional/manual sync stress validation with imported dirty rows
- Execution triggers:
  - always run targeted tests and frontend fast gate for script changes.
  - run slow frontend gate after real local import or if import code touches mobile runtime/bootstrap/sync behavior.
- Slow-gate triggers:
  - Required if the imported dataset is written into a real local app database during implementation.
  - Required if importer changes sync code, bootstrap code, migrations, or app runtime wiring.
  - Otherwise document `N/A` with rationale in completion note.
- Hosted/deployed smoke ownership:
  - `N/A`; remote import and hosted writes are out of scope.
- CI/manual posture note:
  - CI does not cover local private export import. Record dry-run/import summaries and any manual sync stress evidence in the completion note.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/scripts/**` or a documented subfolder under it for import scripts
  - `apps/mobile/app/__tests__/**` or existing mobile test location for importer tests
  - `RUNBOOK.md`
  - `docs/specs/09-project-structure.md` only if new canonical import-tool placement needs documenting
- Project structure impact:
  - Prefer existing `apps/mobile/scripts/**` because the importer writes the mobile local data model.
  - If a reusable `apps/mobile/scripts/import/**` subfolder is introduced, decide whether that is minor enough to leave `09-project-structure` unchanged or update it as the canonical import-tool home.
- Constraints/assumptions:
  - The BOGA-friendly JSON contract from `T-20260604-01` is the only source input boundary.
  - Local-only import means no `owner_user_id` is written locally; the selected local app database/profile is the effective user target.
  - Imported data should use normal local dirty-row sync semantics rather than inventing a separate import outbox.
  - Remote import can be added later by reusing the BOGA-friendly JSON package.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend` when the real local database is imported or sync/runtime behavior is touched; otherwise document `N/A` with rationale.
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/T-20260604-02-boga-import-json-local-importer.md`
- Additional gate(s), if any:
  - targeted import parser/digester/importer tests
  - dry-run against a synthetic or reviewed BOGA-friendly JSON package
  - optional local import into a disposable or backed-up local SQLite database followed by row-count verification

## Evidence

- Implemented generic local importer CLI and module in `apps/mobile/scripts/import/import-boga-json-local.ts`.
- Added `npm run import:boga-json:local`.
- Added migration-backed in-memory SQLite importer tests covering:
  - unresolved/FK validation failure before writes,
  - duration warnings as optional fatal blockers,
  - dry-run no-write behavior,
  - successful FK-safe insert order,
  - dirty-bit and monotonic `local_updated_at_ms` stamping,
  - idempotent re-run reporting/skipping already-imported sessions.
- Updated `RUNBOOK.md`, `apps/mobile/scripts/README.md`, and `docs/specs/09-project-structure.md` for the local import workflow and import folder ownership.
Manual verification summary: No real private/local app database import was performed in this task; verification used synthetic in-memory packages only.
- Manual verification summary (required when CI is absent/partial): No real private/local app database import was performed in this task; verification used synthetic in-memory packages only.
  - No real private/local app database import was performed in this task; verification used synthetic in-memory packages only.
  - Dry-run behavior was verified in `app/__tests__/boga-json-local-importer.test.ts`.
  - Slow frontend gate: `N/A` because implementation did not import the large/private dataset into a real local app database and did not change mobile runtime, sync runtime, migrations, native dependencies, or UI.
- Deferred/manual hosted checks summary:
  - Remote import and hosted Supabase write validation are deferred out of scope.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: Added the source-neutral BOGA JSON local SQLite importer, exposed it as `npm run import:boga-json:local`, added targeted SQLite integration tests, and documented the local import workflow. The importer validates the locked v1 package, requires target profile/database confirmation for writes, rejects unresolved decisions/FK gaps/duplicate generated IDs, dry-runs without writes, writes completed sessions and optional created exercises/mappings in FK-safe order, marks imported sync-scoped rows dirty, and skips already-imported sessions by default.
- What tests ran: targeted importer suite, upstream digester regression suite, mobile typecheck, and frontend fast gate.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/boga-json-local-importer.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/gymbook-digester.test.ts`
  - `cd apps/mobile && npm run typecheck`
  - `./scripts/quality-fast.sh frontend`
- What remains: A real import of the private GymBook-derived JSON is still a manual/operator step after choosing target profile/gym/exercise decisions. Slow frontend gates should run after that real import if the imported dataset is used as a sync/e2e stress candidate.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If the task changed significant cross-cutting behavior, ensure the relevant project-level docs (`03`, `04`, `05`, `06`) were updated in the same session rather than only the milestone/task docs.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260604-02-boga-import-json-local-importer.md` (or document why `N/A`) before handoff.
