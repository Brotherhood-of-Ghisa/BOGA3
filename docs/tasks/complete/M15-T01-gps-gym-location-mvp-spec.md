---
task_id: M15-T01-gps-gym-location-mvp-spec
milestone_id: "M15"
status: completed
ui_impact: "no"
areas: "docs|cross-stack"
runtimes: "docs"
gates_fast: "N/A - docs/design-only task"
gates_slow: "N/A - docs/design-only task"
docs_touched: "docs/specs/milestones/M15-gps-gym-location-support.md,docs/tasks/M15-T02-*,docs/specs/00-product.md,docs/specs/03-technical-architecture.md,docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,supabase/session-sync-api-contract.md,docs/specs/ui/README.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M15-T01-gps-gym-location-mvp-spec`
- Title: GPS gym location MVP spec and task breakdown
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-23`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Milestone spec: `docs/specs/milestones/M15-gps-gym-location-support.md` (to be created by this task)
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/m15-t01-gps-gym-location-spec` at `46f58ed`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes`
  - `origin/main`, `main`, and the task branch all pointed at `46f58ed` at execution start.
- Parent refs opened in this session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/templates/milestone-spec-template.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/plans/README.md`
  - `docs/operations/task-execution.md`
  - `RUNBOOK.md`
  - `docs/specs/templates/milestone-spec-template.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/plans/README.md`
  - `docs/operations/task-execution.md`
- Code/docs inventory freshness checks run:
  - `apps/mobile/package.json` - `expo-location` is not currently listed.
  - `apps/mobile/src/data/schema/gyms.ts` - local `gyms` currently has `id`, `name`, `created_at`, and `updated_at`; no coordinate fields.
  - `apps/mobile/src/data/local-gyms.ts` - `upsertLocalGym()` currently persists and emits `gyms.upsert` with only `id`, `name`, `created_at_ms`, and `updated_at_ms`.
  - `supabase/migrations/**` - backend `app_public.gyms` is an existing user-owned sync projection table with RLS/composite owner key behavior.
  - `apps/mobile/src/sync/bootstrap.ts` - gym bootstrap/parity currently parses and emits only name/timestamp/tombstone fields for gyms.
  - `docs/tasks/T-20260517-01-personal-gym-list-sync.md` - active planned task may change gym catalog/list/tombstone behavior before GPS implementation; M15 spec must treat it as a dependency.
- Known stale references or assumptions:
  - GPS implementation tasks must re-check the state of `T-20260517-01-personal-gym-list-sync.md` before editing gym UI/data code.
  - The direct branch flow is selected for M15 per user request; orchestrator mode remains opt-in only.
- Optional helper command (recommended at execution start):
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T01-gps-gym-location-mvp-spec.md`

## Objective

Create the source-of-truth specification and downstream task breakdown for GPS gym location support. The agreed MVP boundary is:

> Foreground-only GPS, user-confirmed gym detection, user-owned synced gym coordinates, no social/location sharing yet.

This task should make the later implementation work unambiguous across product behavior, privacy boundaries, data model, sync contract, native permission handling, recorder UI, gym management UI, and verification.

## Scope

### In scope

- Create `docs/specs/milestones/M15-gps-gym-location-support.md` using the milestone template.
- Record the accepted MVP boundary and privacy posture:
  - foreground-only location access,
  - no background tracking,
  - no automatic check-ins,
  - no social visibility or location sharing,
  - no shared/public gym registry,
  - user confirmation required before a GPS suggestion changes session state or persists coordinates.
- Specify the user flows and product behavior for:
  - requesting foreground location permission,
  - detecting current location,
  - suggesting the nearest eligible gym,
  - handling denied permission,
  - handling unavailable/low-accuracy/no-match states,
  - manually overriding a suggestion,
  - saving, replacing, and clearing gym coordinates in gym management.
- Specify the data-model proposal for nullable user-owned gym coordinate metadata.
- Explicitly decide sync scope for the new gym coordinate metadata. The expected decision is `in sync scope`.
- Specify the sync contract, bootstrap/merge/restore, and backend projection changes required for gym coordinates.
- Specify required mobile dependency/native config work, likely including `expo-location`.
- Specify pure domain matching rules:
  - distance formula,
  - default match radius,
  - required accuracy threshold,
  - tie handling,
  - no-match behavior,
  - invalid/missing coordinate handling.
- Produce downstream implementation task cards for steps 2-6, with acceptance criteria and gates:
  - data model + sync contract/backend projection,
  - mobile GPS service and matching domain logic,
  - session recorder GPS suggestion UI,
  - gym management coordinate controls,
  - cross-stack restore parity, E2E/runtime evidence, and docs closeout.
- Decide whether orchestration should be recommended for the implementation phase per `docs/plans/README.md`.

### Out of scope

- Implementing `expo-location` or native permission config.
- Editing SQLite/Drizzle schema or generated migration artifacts.
- Editing Supabase migrations, RLS policies, RPC/projection functions, or backend tests.
- Editing session recorder UI or gym management UI.
- Adding maps, geocoding, Places APIs, address lookup, public gym discovery, shared gym records, or social visibility.
- Building background location, continuous tracking, automatic check-ins, or anti-cheat enforcement.
- Committing/pushing the downstream implementation branches.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task is docs/design only. It will specify later UI work, UX contracts, and UI docs maintenance requirements, but it must not change application UI code.

## Acceptance criteria

1. `docs/specs/milestones/M15-gps-gym-location-support.md` exists and follows the milestone template.
2. The milestone objective states the agreed MVP boundary exactly enough that future tasks do not reinterpret it:
   - foreground-only GPS,
   - user-confirmed gym detection,
   - user-owned synced gym coordinates,
   - no social/location sharing yet.
3. The milestone spec clearly marks out of scope: background location, continuous tracking, automatic check-ins, public/shared gym registry, maps/geocoding, and social visibility.
4. The product/privacy section explains when location is requested, what is stored, and that a GPS match is a suggestion until the user confirms it.
5. The data-model section proposes concrete nullable coordinate metadata for `gyms` and records the sync impact decision as `in sync scope`.
6. The sync section describes required updates to local outbox payloads, backend ingest/projection, bootstrap pull, merge, convergence events, and reinstall restore parity.
7. The location-matching section defines radius, accuracy threshold, tie handling, distance calculation, missing-coordinate behavior, and no-match behavior.
8. The UI/UX section defines recorder and gym-management flows at task-card level without implementing UI code.
9. The testing section names expected coverage across domain unit tests, mobile UI tests, SQLite migration tests, Supabase/local contract tests, sync restore parity, and runtime/mobile permission evidence.
10. The spec explicitly depends on the personal gym catalog work in `docs/tasks/T-20260517-01-personal-gym-list-sync.md` or records how GPS tasks should adapt if that task is still incomplete.
11. Downstream planned task cards exist under `docs/tasks/` for implementation steps 2-6, or the milestone spec records a deliberate reason for leaving them inline only.
12. Downstream task cards use the project task template fields, include required parent refs, and state mandatory fast/slow gates per runtime.
13. Cross-cutting docs that need source-of-truth updates are either updated in this task or listed as explicit deliverables in downstream tasks.
14. `RUNBOOK.md` is reviewed; if no operator workflow changes are made by this docs-only task, the completion note records `RUNBOOK.md reviewed (no changes required)`.
15. No application code, migrations, generated artifacts, package manifests, or lockfiles are changed by this task.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/milestones/M15-gps-gym-location-support.md` - new source-of-truth milestone spec for GPS gym location support.
  - `docs/tasks/M15-T02-*.md` through `docs/tasks/M15-T06-*.md` - downstream implementation task cards for the agreed GPS MVP slices.
  - `docs/specs/00-product.md` - update only if the accepted GPS/privacy boundary should become product-level source of truth immediately.
  - `docs/specs/03-technical-architecture.md` - update only if this task records stable architecture decisions rather than deferring them to implementation tasks.
  - `docs/specs/05-data-model.md` - update only if this task records the coordinate metadata model as adopted; otherwise require the data-model implementation task to update it.
  - `docs/specs/06-testing-strategy.md` - update only if new stable testing expectations are adopted at planning time; otherwise require downstream implementation tasks to update it.
  - `supabase/session-sync-api-contract.md` - do not change unless the sync payload contract is adopted in this docs task; otherwise list it in downstream data/sync task deliverables.
  - `docs/specs/ui/README.md` and relevant `docs/specs/ui/*.md` - review maintenance triggers for downstream UI tasks; update only if docs inventory/contract changes now.
  - `RUNBOOK.md` - review; update only if this docs task changes operator-facing workflows.
- Rule:
  - milestone/task docs are not substitutes for project-level source-of-truth docs once behavior is adopted. If this task marks GPS data/sync behavior as adopted, update the relevant project-level docs in the same session.

## Testing and verification approach

- Planned checks/commands:
  - `git status --short --branch`
  - `rg -n "gps|GPS|latitude|longitude|location" docs/specs docs/tasks supabase/session-sync-api-contract.md`
  - `./scripts/task-closeout-check.sh docs/tasks/M15-T01-gps-gym-location-mvp-spec.md` if the helper supports docs-only task cards in the current repo state.
- Standard local gate usage:
  - `./scripts/quality-fast.sh`: `N/A` for this docs/design-only task unless executable docs checks are added during execution.
  - `./scripts/quality-slow.sh <area>`: `N/A` for this docs/design-only task.
- Test layers covered:
  - Docs/spec verification only.
  - Implementation test layers are specified in the M15 milestone spec and downstream task cards.
- Execution triggers:
  - Always run docs inventory checks and task closeout helper if available.
- Slow-gate triggers:
  - `N/A` for this task; downstream GPS implementation tasks must declare slow-gate requirements individually.
- Hosted/deployed smoke ownership:
  - `N/A` for this task; downstream backend/sync task must name hosted smoke ownership if schema changes need hosted validation.
- CI/manual posture note:
  - Current repo has no CI pipeline configured; record manual docs verification in the completion note.
- Notes:
  - Do not use this docs-only task to sneak in package, schema, or migration changes.

## Implementation notes

- Planned files/areas allowed to change:
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
  - `docs/tasks/M15-T02-*.md` through `docs/tasks/M15-T06-*.md`
  - limited source-of-truth docs listed under `Docs touched`, only when the task adopts stable GPS decisions immediately.
- Project structure impact:
  - No new top-level folders or canonical path conventions expected.
- Constraints/assumptions:
  - The GPS MVP should extend the existing user-owned `gyms` model, not create a parallel location/check-in entity unless the milestone spec documents a strong reason.
  - Coordinates belong to the user's personal gym records for this MVP.
  - Social features may use these coordinates later, but no social exposure is included in M15.
  - Use foreground permission only; do not design background tasks or continuous tracking.
  - Treat GPS suggestions as advisory until the user confirms.
  - Re-check current Supabase docs/changelog before implementation tasks that touch Supabase schema, RLS, or API behavior.
  - Re-check current Expo docs before implementation tasks that add `expo-location` or native permission configuration.

## Mandatory verify gates

- Standard local fast gate: `N/A - docs/design-only task; no runtime code changes expected`
- Standard local slow gate: `N/A - docs/design-only task; downstream tasks must declare their own slow gates`
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/M15-T01-gps-gym-location-mvp-spec.md`
- Additional gate(s), if any:
  - `git diff --check`

## Evidence

- Created/updated milestone spec:
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
- Created downstream task cards:
  - `docs/tasks/M15-T02-gym-coordinate-data-sync-contract.md`
  - `docs/tasks/M15-T03-mobile-location-service-and-matching.md`
  - `docs/tasks/M15-T04-recorder-gps-suggestion-ui.md`
  - `docs/tasks/M15-T05-gym-management-coordinate-controls.md`
  - `docs/tasks/M15-T06-gps-restore-evidence-and-docs-closeout.md`
- Docs inventory check:
  - `rg -n "gps|GPS|latitude|longitude|location" docs/specs docs/tasks supabase/session-sync-api-contract.md`
  - `git diff --check`
- Task closeout helper:
  - `./scripts/task-closeout-check.sh docs/tasks/complete/M15-T01-gps-gym-location-mvp-spec.md`
- RUNBOOK review:
  - `RUNBOOK.md reviewed (no changes required)`
- Manual verification summary (required when CI is absent/partial): Docs-only task. Created the milestone spec, recorded direct branch flow, created downstream cards, and deferred implementation/source-of-truth adoption updates to the owning implementation tasks.
- Deferred/manual hosted checks summary:
  - `N/A` for this docs-only task unless downstream backend work is moved into scope, which should not happen.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: Created the M15 milestone spec and downstream direct-branch task cards.
  - Created the M15 milestone spec for foreground-only, user-confirmed GPS gym location support.
  - Added the requested direct branch flow and downstream task cards for data/sync, location service/matching, recorder UI, gym-management controls, and closeout evidence.
  - Left project-level adopted docs updates to downstream implementation tasks because this task did not change runtime code, schemas, contracts, or operator workflows.
- What tests ran: Bootstrap/context helper, docs inventory search, whitespace diff check, and task closeout helper.
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T01-gps-gym-location-mvp-spec.md` (expected failure before milestone spec creation because the parent spec did not exist yet)
  - `rg -n "gps|GPS|latitude|longitude|location" docs/specs docs/tasks supabase/session-sync-api-contract.md`
  - `git diff --check`
  - `./scripts/task-closeout-check.sh docs/tasks/complete/M15-T01-gps-gym-location-mvp-spec.md`
- What remains: Execute M15-T02 through M15-T06 on direct branches after the personal gym catalog dependency is resolved or re-checked.
  - Execute M15-T02 through M15-T06 on direct branches after the personal gym catalog dependency is resolved or re-checked.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the file to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- Ensure `docs/specs/milestones/M15-gps-gym-location-support.md` task breakdown/status reflects created downstream task cards.
- If this task adopted stable cross-cutting GPS behavior, ensure the relevant project-level docs (`00`, `03`, `05`, `06`) were updated in the same session rather than only the milestone/task docs.
- For downstream UI/UX tasks, ensure the task cards require updates to relevant `docs/specs/ui/*.md` files and screenshots/artifacts per `docs/specs/08-ux-delivery-standard.md`.
- Run `./scripts/task-closeout-check.sh docs/tasks/M15-T01-gps-gym-location-mvp-spec.md` or document why `N/A`.
