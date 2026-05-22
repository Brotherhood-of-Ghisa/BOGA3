---
task_id: T-20260522-01-issue-50-sync-schema-dependency-map
milestone_id: "M13"
status: completed
ui_impact: "no"
areas: "docs|frontend|backend|cross-stack"
runtimes: "docs|node|supabase|sql"
gates_fast: "N/A - docs/planning artifact only; see replacement checks"
gates_slow: "N/A - no runtime behavior change in this task"
docs_touched: "docs/specs/tech/sync-schema-dependency-map.md,docs/specs/05-data-model.md,docs/specs/tech/client-sync-engine.md,docs/tasks/fix-sync/follow-ups.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260522-01-issue-50-sync-schema-dependency-map`
- Title: Issue #50 sync schema dependency map and rewrite task split
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-22`
- Session interaction mode: `interactive (default)`
- Source issue: `https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/50`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M13-simple-backend-sync.md` (completed baseline; this is post-M13 redesign planning/hardening)
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- API auth/authz guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Human run/test/debug guide: `RUNBOOK.md`
- Related existing sync redesign docs:
  - `docs/tasks/fix-sync/plan.md`
  - `docs/tasks/fix-sync/status.md`
  - `docs/tasks/fix-sync/follow-ups.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `main` at `6dcfe35d12736f78035773417741bc5ab819b305`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes`
  - `git fetch origin` advanced `origin/main` from `c4f9440` to `6dcfe35`.
  - `git pull --ff-only origin main` fast-forwarded local `main` to `6dcfe35`.
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
  - `docs/specs/tech/client-sync-engine.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/plans/README.md`
  - `docs/tasks/fix-sync/plan.md`
  - `docs/tasks/fix-sync/status.md`
  - `docs/tasks/fix-sync/follow-ups.md`
  - `supabase/session-sync-api-contract.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - GitHub issue #50 fetched through GitHub web; issue is open and requests a local/backend sync rewrite plan centered on user-owned data, table classification, ownership enforcement, dependency order, FK restoration, and idempotent migrations.
  - `find docs/tasks -maxdepth 2 -type f` reviewed active/completed task-card landscape.
  - `find docs/specs/milestones -maxdepth 1 -type f` reviewed milestone landscape.
  - `find apps/mobile/src/data/schema -maxdepth 1 -type f` verified current local schema modules.
  - `find apps/mobile/src/sync apps/mobile/src/data -maxdepth 2 -type f` verified current local data/sync implementation surfaces.
  - `find supabase -maxdepth 3 -type f` verified backend migrations/tests/scripts surface.
  - `rg` inventory for `owner_user_id`, `deleted_at`, FK references, `sync_events_ingest`, and sync-scope entities run across `apps/mobile/src/data`, `supabase`, and sync docs.
  - Read-only local-schema agent summarized local ownership, table class, dependency, tombstone, and identity gaps.
  - Read-only backend-schema agent summarized backend ownership, RLS, composite PKs, dependency, idempotency, and tombstone gaps.
- Known stale references or assumptions:
  - Local git remote is `dinoderek/BOGA3`, while source issue #50 is under `Brotherhood-of-Ghisa/BOGA3`; use the explicit GitHub issue URL as the issue source of truth and local checkout as the implementation source.
  - Existing `docs/tasks/fix-sync/**` docs already cover and partially complete an earlier sync redesign wave; this task must reconcile with that state instead of duplicating completed work.
  - `docs/tasks/fix-sync/status.md` was last updated `2026-05-14`; execution must refresh actual repo/PR state before declaring existing wave tasks complete or obsolete.
  - `gh` is not installed in this environment; use the GitHub connector or web/GitHub UI for issue/PR state.
- Optional helper command (recommended at execution start):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260522-01-issue-50-sync-schema-dependency-map.md`

## Objective

Produce the required schema dependency map for GitHub issue #50 before any further sync rewrite coding. The output should classify every local and backend table, document explicit ownership and dependency paths, identify integrity/tombstone/idempotency gaps, and split the remaining rewrite into small implementation task cards or follow-ups.

This task is intentionally a discovery/design/documentation job. It must not rewrite the sync engine, change migrations, or alter app behavior.

## Scope

### In scope

- Create a canonical sync schema dependency map, preferably at `docs/specs/tech/sync-schema-dependency-map.md`.
- Inventory all local mobile tables and classify each as:
  - `user-owned`
  - `local-only`
  - `backend-only`
  - `static reference`
- Inventory all backend tables relevant to auth/profile/sync/diagnostics and classify each under the same ownership/sync model.
- For every syncable entity, document:
  - current local primary key, foreign keys, indexes, nullable fields, and delete/tombstone shape,
  - current backend primary key, foreign keys, indexes, RLS/ownership enforcement, and delete/tombstone shape,
  - canonical ID source (`client-generated`, `backend-generated`, or `hybrid/currently mixed`),
  - ownership path (`direct owner_user_id`, `derived through parent`, `implicit local current-user projection`, or `none/static`),
  - sync rule and current event coverage.
- Produce an explicit dependency order for pull, merge, convergence event generation, and push.
- Identify rows or table relationships that can currently violate expected dependencies, including orphan tolerance and missing tombstone columns.
- Decide which existing `docs/tasks/fix-sync/**` items remain valid, obsolete, or need replacement after issue #50.
- Create or update follow-up task cards only if the map reveals separable implementation work that should not be bundled here.
- Record a recommended multi-agent implementation split for follow-on work.

### Out of scope

- Implementing the sync rewrite.
- Adding or removing local columns, backend columns, constraints, indexes, RLS policies, migrations, or runtime sync code.
- Changing event payload contracts.
- Running hosted Supabase resets or deployment operations.
- UI changes.
- Multi-device conflict resolution beyond documenting current assumptions and follow-up needs.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task creates docs/task-planning artifacts only. It may describe future UI-visible sync consequences, but it does not change user-facing screens, navigation, or interaction patterns.

## Acceptance criteria

1. `docs/specs/tech/sync-schema-dependency-map.md` exists and links back to issue #50 plus the current parent specs.
2. The map classifies every current local table: `gyms`, `sessions`, `session_exercises`, `exercise_sets`, `exercise_definitions`, `exercise_muscle_mappings`, `exercise_tag_definitions`, `session_exercise_tags`, `muscle_groups`, `smoke_records`, `sync_outbox_events`, `sync_delivery_state`, and `sync_runtime_state`.
3. The map classifies backend tables in `auth`, `app_public`, and `public` that matter to app ownership/sync, including `auth.users`, `app_public.user_profiles`, all eight sync projection tables, sync ingest metadata tables, and `public.app_logs`.
4. For each sync-scope entity, the map records local vs backend ownership, PK/FK/index shape, tombstone/delete behavior, ID generation, and current event mapping.
5. The map explicitly calls out local implicit ownership versus backend explicit `owner_user_id` ownership and states whether row-level local ownership is required for the next rewrite phase.
6. The map includes a dependency order for:
   - backend pull/bootstrap,
   - local merge/apply,
   - convergence event generation,
   - outbound push/ingest.
7. The map identifies current integrity gaps, at minimum:
   - local `gyms`, `session_exercises`, and `exercise_sets` lacking `deleted_at` while backend supports tombstones,
   - local physical deletes for child/relation rows versus backend soft-delete or attach/detach semantics,
   - nullable/no-action `session_exercises.exercise_definition_id`,
   - `session_exercise_tags` lacking `updated_at`,
   - composite edge entity IDs versus row IDs in payloads,
   - `exercise_tag_definitions` normalized-name uniqueness and tombstone behavior.
8. The map reconciles existing `docs/tasks/fix-sync/plan.md`, `status.md`, and `follow-ups.md` with issue #50 and records which items should remain, be superseded, or become new task cards.
9. Follow-up implementation work is split into small cards or an explicit task list with dependencies and suggested agent ownership. Do not leave the next step as a vague "rewrite sync."
10. `docs/specs/05-data-model.md` and `docs/specs/tech/client-sync-engine.md` are updated if the dependency map becomes a stable source of truth or changes the documented model. If no updates are needed, the task completion note records the no-change rationale.
11. `RUNBOOK.md` is reviewed. If no local operator workflow changes, the completion note says `RUNBOOK.md reviewed (no changes required)`.
12. Task closeout records exactly what was inspected, what docs changed, and what implementation work remains.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/tech/sync-schema-dependency-map.md` - new canonical schema classification and dependency map for issue #50.
  - `docs/specs/05-data-model.md` - update only if the map changes stable ownership/sync-scope wording or adds a link to the new map as a source-of-truth companion.
  - `docs/specs/tech/client-sync-engine.md` - update only if pull/merge/convergence/push order or sync-engine maintenance guidance changes.
  - `docs/tasks/fix-sync/follow-ups.md` - update or append issue #50 follow-ups if current P-items are superseded or need sharper task ownership.
  - `docs/tasks/<new-follow-up>.md` - create only for separable implementation work discovered by the map.
  - `RUNBOOK.md` - review; update only if this task changes local run/test/operator workflow.
- Cross-cutting docs rule:
  - Because issue #50 is about sync ownership, dependency order, FK discipline, and data-model boundaries, any stable decision must be promoted to project-level docs rather than living only in this task card.
- UI docs update required?: `no`
  - No route, navigation, component, or UI semantics change in this docs-only task.

## Testing and verification approach

- Planned checks/commands:
  - `git status --short --branch`
  - `find apps/mobile/src/data/schema -maxdepth 1 -type f | sort`
  - `find supabase/migrations -maxdepth 1 -type f | sort`
  - `rg -n "owner_user_id|deleted_at|references\\(|foreign key|sync_events_ingest" apps/mobile/src/data apps/mobile/src/sync supabase docs/specs`
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260522-01-issue-50-sync-schema-dependency-map.md`
- Standard local gate usage:
  - `./scripts/quality-fast.sh` is `N/A` for this task because no runtime code, migrations, tests, or app behavior should change.
  - If implementation files are changed despite the intended scope, promote the relevant `./scripts/quality-fast.sh <frontend|backend>` gate to mandatory before closeout.
  - `./scripts/quality-slow.sh <frontend|backend>` is `N/A` unless backend migrations, Supabase runtime behavior, Maestro flows, or UI behavior unexpectedly change.
- Test layers covered:
  - Docs/inventory verification only.
- Execution triggers:
  - Always run inventory commands before authoring the map.
  - Always run task closeout check before marking complete.
- Slow-gate triggers:
  - N/A unless scope expands into implementation. If it does, stop and either split a follow-up card or explicitly update this card's gates before coding.
- Hosted/deployed smoke ownership:
  - N/A. No hosted operation belongs in this task.
- CI/manual posture note:
  - CI is not a substitute for the manual schema inventory because the deliverable is a human-readable dependency map and task split.
- Notes:
  - Prefer structured source inspection over ad hoc prose. Cite file paths and current code/doc evidence for each table classification.

## Implementation notes

- Planned files/areas allowed to change:
  - `docs/specs/tech/sync-schema-dependency-map.md` (new)
  - `docs/specs/05-data-model.md` (only if stable model/link updates are needed)
  - `docs/specs/tech/client-sync-engine.md` (only if stable engine-order/link updates are needed)
  - `docs/tasks/fix-sync/follow-ups.md` (only to reconcile issue #50 follow-ups)
  - `docs/tasks/*.md` (only for new follow-up implementation cards)
  - `RUNBOOK.md` (only if operator workflow changes)
- Project structure impact:
  - No new top-level paths or conventions expected. A new file under `docs/specs/tech/` fits existing subsystem deep-dive conventions.
- Constraints/assumptions:
  - Treat `docs/brainstorms/**` as non-authoritative unless explicitly needed for background; issue #50 and specs are authoritative.
  - Existing M13 docs describe an implemented baseline, not necessarily the desired final issue #50 rewrite.
  - Local mobile storage is currently single-user/implicit-owner; backend projection is explicit-owner. The map must name this mismatch without silently deciding the implementation.
  - Do not weaken backend RLS or client-safe credential rules from `docs/specs/10-api-authn-authz-guidelines.md`.

## Recommended agent split

If execution is delegated, split the work across read-only discovery agents first, then merge into one doc update:

1. Agent A - local mobile schema and repository audit
   - Owns `apps/mobile/src/data/schema/**`, `apps/mobile/src/data/**`, local migrations, local tests, and local tombstone/FK/index notes.
   - Produces local table classification plus local dependency graph.
2. Agent B - backend schema/RLS/ingest audit
   - Owns `supabase/migrations/**`, `supabase/tests/**`, `supabase/session-sync-api-contract.md`, RLS/constraint/index notes, and backend dependency graph.
   - Produces backend table classification plus ownership enforcement summary.
3. Agent C - sync runtime and test coverage audit
   - Owns `apps/mobile/src/sync/**`, sync tests, `docs/specs/tech/client-sync-engine.md`, and current bootstrap/merge/convergence/push order.
   - Produces event-order, retry/idempotency, and verification-gap summary.
4. Coordinator - final map and task split
   - Merges the three audits into `docs/specs/tech/sync-schema-dependency-map.md`.
   - Reconciles `docs/tasks/fix-sync/**`.
   - Creates follow-up task cards only where the implementation work is clearly separable.

## Mandatory verify gates

- Standard local fast gate: `N/A` for docs/planning only; if code/migration/test files change, run the relevant area-specific fast gate.
- Standard local slow gate: `N/A`; no runtime behavior change.
- Replacement docs closeout gate:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260522-01-issue-50-sync-schema-dependency-map.md`
- Additional validation:
  - Re-run schema/backend inventory commands listed in `Testing and verification approach` and record the key output in the completion note.

## Evidence

- GitHub issue #50 source:
  - Fetched via GitHub web on `2026-05-22`; issue remains open and asks for a schema dependency map before coding a sync rewrite.
- Local schema inventory:
  - Reviewed `apps/mobile/src/data/schema/*.ts`, local migration bundle, and local repository write boundaries. Current tables match acceptance list; user-owned local rows remain implicit-owner, with missing local tombstones on `gyms`, `session_exercises`, and `exercise_sets`.
- Backend schema inventory:
  - Reviewed `supabase/migrations/*.sql`, especially M13 ingest/projection, user-scoped composite PK redesign, idempotent missing-delete patch, user profiles, and app logs. Backend user-domain tables carry direct `owner_user_id`, composite `(id, owner_user_id)` PKs, RLS owner policies, and immutable owner triggers.
- Sync runtime/order inventory:
  - Reviewed `apps/mobile/src/sync/types.ts`, `bootstrap.ts`, `runtime.ts`, `outbox.ts`, and current sync docs. Recorded pull/merge/convergence/push dependency order in `docs/specs/tech/sync-schema-dependency-map.md` and linked it from `client-sync-engine.md`.
- Docs closeout check:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260522-01-issue-50-sync-schema-dependency-map.md` passed after completion-note formatting correction.
  - `./scripts/task-closeout-check.sh docs/tasks/complete/T-20260522-01-issue-50-sync-schema-dependency-map.md` passed after moving the completed card.
- Manual verification summary (required when CI is absent/partial): Manual docs/schema audit completed; no runtime code, migrations, or app behavior changed.
- Deferred/manual hosted checks summary:
  - N/A.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: Added `docs/specs/tech/sync-schema-dependency-map.md` with local/backend table classification, ownership paths, sync entity details, dependency ordering, integrity gaps, existing fix-sync reconciliation, and a concrete follow-on split.
  - Linked the map from `docs/specs/05-data-model.md` and `docs/specs/tech/client-sync-engine.md`; refreshed `docs/tasks/fix-sync/status.md` and `follow-ups.md` for issue #50; added the post-M13 task to the M13 task breakdown.
  - RUNBOOK.md reviewed (no changes required).
- What tests ran: Inventory commands listed in this task card plus closeout checks on both the active task-card path before move and completed task-card path after move.
  - `git status --short --branch`
  - `find apps/mobile/src/data/schema -maxdepth 1 -type f | sort`
  - `find supabase -maxdepth 3 -type f | sort`
  - `rg -n "owner_user_id|deleted_at|references\\(|foreign key|sync_events_ingest" apps/mobile/src/data apps/mobile/src/sync supabase docs/specs`
- What remains: Implementation remains intentionally deferred. The next slices are local tombstone parity, local ownership/user-switch decision, composite edge identity contract, FK/orphan repair planning, tag tombstone uniqueness semantics, and CI quality-gate enforcement.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- Update `docs/specs/05-data-model.md` if the dependency map changes stable data-model/ownership wording or becomes a referenced companion doc.
- Update `docs/specs/tech/client-sync-engine.md` if the dependency map changes stable sync runtime ordering or maintenance guidance.
- Update `docs/tasks/fix-sync/follow-ups.md` if issue #50 supersedes or sharpens existing follow-ups.
- Create follow-up task cards for implementation slices only after the dependency map makes the slice boundaries concrete.
- Record `RUNBOOK.md reviewed (no changes required)` unless operator workflows changed.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260522-01-issue-50-sync-schema-dependency-map.md` or document why it is unavailable.
