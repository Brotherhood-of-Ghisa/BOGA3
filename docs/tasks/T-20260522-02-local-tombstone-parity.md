---
task_id: T-20260522-02-local-tombstone-parity
milestone_id: "M13"
status: planned
ui_impact: "no"
areas: "frontend|cross-stack|docs"
runtimes: "node|expo|supabase"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/05-data-model.md,docs/specs/tech/client-sync-engine.md,docs/specs/tech/sync-schema-dependency-map.md,supabase/session-sync-api-contract.md,docs/tasks/fix-sync/follow-ups.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260522-02-local-tombstone-parity`
- Title: Local Tombstone Parity
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-22`
- Session interaction mode: `interactive (default)`
- Source issue: `https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/50`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md` (completed baseline; this is post-M13 sync hardening)
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- API auth/authz guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- Sync schema dependency map: `docs/specs/tech/sync-schema-dependency-map.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Human run/test/debug guide: `RUNBOOK.md`
- Related existing sync redesign docs:
  - `docs/tasks/fix-sync/plan.md`
  - `docs/tasks/fix-sync/status.md`
  - `docs/tasks/fix-sync/follow-ups.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `main` at `6dcfe35d12736f78035773417741bc5ab819b305`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes`
  - `git fetch origin` completed on `2026-05-22`.
  - Local `main` was already even with `origin/main`; no fast-forward pull was needed.
  - Existing uncommitted issue #50 planning/docs changes were present before this card was authored and must be preserved.
- Parent refs opened in this planning session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/10-api-authn-authz-guidelines.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/milestones/M13-simple-backend-sync.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/specs/tech/sync-schema-dependency-map.md`
  - `supabase/session-sync-api-contract.md`
  - `docs/tasks/complete/T-20260522-01-issue-50-sync-schema-dependency-map.md`
  - `docs/tasks/fix-sync/follow-ups.md`
  - `docs/tasks/fix-sync/status.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - GitHub issue #50 opened through GitHub web; issue is open and asks for a disciplined user-owned sync rewrite with explicit tombstone/soft-delete handling.
  - GitHub issue #50 comments fetched through the GitHub connector; no issue comments were present.
  - `find docs/tasks -maxdepth 2 -type f | sort | tail -80` reviewed current task-card landscape.
  - `find apps/mobile/src/data/schema -maxdepth 1 -type f | sort` verified local schema modules.
  - `find apps/mobile/src/sync apps/mobile/src/data -maxdepth 2 -type f | sort` verified local data/sync implementation surfaces.
  - `rg -n "deletedAt|deleted_at|deletedAtMs|includeRemote|buildConvergenceEvents|..." apps/mobile/src apps/mobile/app/__tests__ apps/mobile/drizzle` checked current tombstone and merge surfaces.
  - `apps/mobile/src/data/schema/gyms.ts` has no local `deleted_at`.
  - `apps/mobile/src/data/schema/session-exercises.ts` has no local `deleted_at` and uses a total unique index on `(session_id, order_index)`.
  - `apps/mobile/src/data/schema/exercise-sets.ts` has no local `deleted_at` and uses a total unique index on `(session_exercise_id, order_index)`.
  - `apps/mobile/src/sync/bootstrap.ts` already normalizes remote `deleted_at` for `gyms`, `session_exercises`, and `exercise_sets`, but `buildMergePlan` filters remote tombstones out for those entities because local storage cannot persist them today.
- Known stale references or assumptions:
  - M13 is completed. Treat this as post-M13 hardening for issue #50 rather than reopening the completed milestone baseline.
  - Local repo remote is `dinoderek/BOGA3`; the source issue URL is under `Brotherhood-of-Ghisa/BOGA3`. Use the explicit source issue link for issue context and the local checkout for implementation truth.
  - Existing uncommitted docs/planning files may already include the issue #50 dependency map. Do not revert or overwrite those changes while executing this card.
- Optional helper command (recommended at execution start):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260522-02-local-tombstone-parity.md`

## Objective

Bring local mobile tombstone behavior into parity with backend projection semantics for the sync-scoped entities that currently lose remote deletes locally: `gyms`, `session_exercises`, and `exercise_sets`.

After this task, local SQLite must be able to persist tombstoned rows for those entities, bootstrap/merge must retain remote tombstones instead of filtering them away, convergence must emit delete events for local tombstones, and restore-parity tests must prove active and deleted rows round-trip coherently.

## Scope

### In scope

- Add local `deleted_at` support for:
  - `gyms`
  - `session_exercises`
  - `exercise_sets`
- Add Drizzle schema updates, migration SQL/meta artifacts, and runtime migration-bundle updates for those columns.
- Add or adjust local indexes so tombstone queries are efficient.
- Replace total order uniqueness for `session_exercises` and `exercise_sets` with active-row uniqueness that matches backend behavior, so tombstoned rows do not block reused order indexes.
- Update local repository/session-graph mutation paths so delete/archive/remove operations that represent sync-domain deletes persist tombstones where required before or instead of physical deletion.
- Update bootstrap merge to retain tombstoned remote `gyms`, `session_exercises`, and `exercise_sets` in local state.
- Update merge/apply ordering and filtering so child rows remain coherent when parents are tombstoned.
- Update convergence event generation so local tombstones emit `delete` events with stable `deleted_at_ms` and do not resurrect deleted rows through later `upsert` events.
- Update normalized snapshot/restore-parity helpers so tombstoned rows are included in sync-state comparison while presentation queries can continue hiding them by default.
- Add tests for remote tombstone pull, local tombstone convergence, order-index reuse with tombstoned rows, and reinstall restore parity.
- Update project docs and follow-ups so issue #50 no longer lists this local tombstone slice as unplanned once completed.

### Out of scope

- Backend schema/RLS changes; backend projection already has tombstones for the three entities.
- New sync entities or event types.
- Multi-device conflict resolution beyond proving the current single-device M13 contract handles tombstones coherently.
- Local `owner_user_id` migration or user-switch stream reset; keep that as a separate issue #50 slice.
- Composite edge identity contract changes for `exercise_muscle_mappings` or `session_exercise_tags`.
- FK restoration for `session_exercises.exercise_definition_id`.
- Tag normalized-name tombstone uniqueness changes.
- UI redesign or route/navigation changes.
- Hosted Supabase reset or hosted smoke unless implementation unexpectedly changes backend behavior.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task changes local data-model, repository, and sync semantics. It may affect which rows are visible through existing screens, but it does not introduce new routes, components, interaction patterns, visual states, or copy. Existing UI should continue to hide tombstoned rows by default unless a pre-existing archived/deleted view intentionally shows them.

## Acceptance criteria

1. Local Drizzle schema and generated/runtime migrations add nullable `deleted_at` timestamp columns to `gyms`, `session_exercises`, and `exercise_sets`.
2. Existing local databases migrate idempotently and preserve all existing active rows with `deleted_at = null`.
3. `gyms`, `session_exercises`, and `exercise_sets` have local `deleted_at` indexes or equivalent query support.
4. Local active-order uniqueness for `session_exercises` and `exercise_sets` matches backend semantics: active rows cannot collide on order, but tombstoned rows do not block active row order reuse.
5. Repository/session-graph mutation paths persist tombstones for sync-domain deletes where local delete intent must survive bootstrap/restore and convergence.
6. Presentation/read paths that should show only active rows explicitly filter `deleted_at is null`; historical/detail paths that need deleted row names/shape can still resolve tombstoned rows when necessary.
7. Bootstrap merge retains remote tombstones for `gyms`, `session_exercises`, and `exercise_sets` instead of dropping them through `includeRemote: row.deletedAtMs === null`.
8. Merge/apply does not create orphaned active children when a remote parent is tombstoned; child tombstones and parent tombstones are applied in a deterministic order.
9. Convergence event generation emits `delete` events for local tombstoned `gyms`, `session_exercises`, and `exercise_sets` with stable `deleted_at_ms`.
10. Upsert paths clear tombstones only for intentional undelete/recreate flows and include tests proving accidental resurrection does not happen during merge/convergence.
11. Reinstall restore-parity coverage includes active and tombstoned rows for the three entities in the normalized sync snapshot.
12. Cross-device delete propagation is covered by deterministic tests: a remote tombstone pulled during bootstrap/merge stays deleted locally and hidden from default active reads.
13. Sync event contract remains unchanged unless a real implementation need is discovered; if unchanged, record `supabase/session-sync-api-contract.md reviewed (no changes required)` in the completion note.
14. `docs/specs/05-data-model.md`, `docs/specs/tech/client-sync-engine.md`, and `docs/specs/tech/sync-schema-dependency-map.md` reflect the new local tombstone parity once implemented.
15. `docs/tasks/fix-sync/follow-ups.md` is narrowed so P4 no longer lists this completed tombstone-parity slice as outstanding.
16. `RUNBOOK.md` is reviewed. If no operator workflow changes, completion note records `RUNBOOK.md reviewed (no changes required)`.
17. Required targeted tests and local gates pass, or blockers are documented with exact failing command, failure summary, and next action.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - update local schema inventory and M13 sync data-model notes for local tombstones on `gyms`, `session_exercises`, and `exercise_sets`.
  - `docs/specs/tech/client-sync-engine.md` - update bootstrap/merge/convergence behavior if tombstone merge semantics or snapshot parity expectations change.
  - `docs/specs/tech/sync-schema-dependency-map.md` - change the three entities from "local tombstone missing" to implemented parity, and update remaining issue #50 gap list.
  - `docs/tasks/fix-sync/follow-ups.md` - narrow P4 after implementation so remaining follow-ups do not duplicate completed work.
  - `supabase/session-sync-api-contract.md` - review; update only if payload/event semantics change.
  - `RUNBOOK.md` - review; update only if local run/test/operator workflow changes.
- Cross-cutting docs rule:
  - This is a sync-scoped local data-model change. Stable behavior must be promoted to project-level/data-model docs in the same session, not left only in this task card.
- UI docs update required?: `no`
  - No route, navigation, component API, or reusable UI semantics are intended to change.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-bootstrap-merge.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-domain-event-emission.test.ts`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/sync-reinstall-restore-parity.test.ts`
  - `cd apps/mobile && npm run db:generate:canary`
  - `cd apps/mobile && npm run test:sync:reinstall-parity`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` is mandatory because this task changes mobile schema/data/sync code.
  - `./scripts/quality-slow.sh frontend` is mandatory because this task changes local SQLite migrations/bootstrap behavior and restore-parity confidence.
  - `./scripts/quality-slow.sh backend` is `N/A` unless backend files change; if backend migration/function/contract behavior changes, promote backend slow gate to mandatory.
- Test layers covered:
  - schema/migration tests or canary
  - repository/session-domain unit tests
  - sync bootstrap/merge unit tests
  - outbox/convergence event tests
  - cross-stack reinstall restore-parity integration against local Supabase
  - frontend slow gate for native SQLite/runtime confidence
- Execution triggers:
  - Run targeted tests after schema/repository changes.
  - Run merge/convergence tests after sync changes.
  - Run restore-parity after normalized snapshot or bootstrap behavior changes.
  - Run full mandatory gates before closeout.
- Slow-gate triggers:
  - Required for this task due local SQLite migration/runtime and restore behavior changes.
- Hosted/deployed smoke ownership:
  - N/A unless backend schema/API behavior changes unexpectedly.
- CI/manual posture note:
  - Current CI is partial. Local gate and restore-parity evidence must be recorded in the completion note.
- Notes:
  - Use source inspection and tests to identify the actual current test filenames at execution time; if a named test file has moved, run the runtime-equivalent targeted suite and record the substitution.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/schema/gyms.ts`
  - `apps/mobile/src/data/schema/session-exercises.ts`
  - `apps/mobile/src/data/schema/exercise-sets.ts`
  - `apps/mobile/src/data/migrations/index.ts`
  - `apps/mobile/drizzle/**`
  - `apps/mobile/src/data/local-gyms.ts`
  - `apps/mobile/src/data/session-drafts.ts`
  - `apps/mobile/src/data/session-list.ts`
  - `apps/mobile/src/sync/bootstrap.ts`
  - `apps/mobile/src/sync/types.ts`
  - `apps/mobile/app/__tests__/**` sync/data tests relevant to merge, outbox, migrations, and restore parity
  - `docs/specs/05-data-model.md`
  - `docs/specs/tech/client-sync-engine.md`
  - `docs/specs/tech/sync-schema-dependency-map.md`
  - `docs/tasks/fix-sync/follow-ups.md`
  - `RUNBOOK.md`
- Project structure impact:
  - No new top-level paths or conventions expected. Migration artifacts remain under existing mobile Drizzle/runtime migration locations.
- Constraints/assumptions:
  - Keep the current M13 event envelope and entity-event mapping.
  - Backend `deleted_at` semantics are already implemented for the three entities; local parity should adapt to that contract rather than changing backend shape.
  - Local storage remains implicit single-user projection for this task. Do not introduce local `owner_user_id` here.
  - Be careful with physical deletes: some table clears during bootstrap are implementation mechanics, but domain delete intent for sync-scoped rows must be durable as a tombstone after this task.
  - Existing uncommitted issue #50 docs/planning changes are not owned by this task unless execution explicitly updates them.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260522-02-local-tombstone-parity.md`
- Additional gates:
  - `cd apps/mobile && npm run db:generate:canary`
  - `cd apps/mobile && npm run test:sync:reinstall-parity`

## Evidence

- To be filled during implementation.
- Manual verification summary:
  - Record targeted tests, generated migration/canary results, restore-parity command, and frontend fast/slow gate outcomes.
- Deferred/manual hosted checks summary:
  - Expected `N/A`; if backend files change, document local backend/hosted validation posture explicitly.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- If the task changed significant cross-cutting behavior, ensure the relevant project-level docs (`03`, `04`, `05`, `06`) were updated in the same session rather than only the milestone/task docs.
- Update `docs/specs/tech/sync-schema-dependency-map.md` and `docs/tasks/fix-sync/follow-ups.md` so remaining issue #50 work is accurate.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260522-02-local-tombstone-parity.md` (or document why `N/A`) before handoff.
