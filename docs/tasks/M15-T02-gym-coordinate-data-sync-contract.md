---
task_id: M15-T02-gym-coordinate-data-sync-contract
milestone_id: "M15"
status: planned
ui_impact: "no"
areas: "frontend|backend|cross-stack|docs"
runtimes: "node|supabase|sql"
gates_fast: "./scripts/quality-fast.sh frontend && ./scripts/quality-fast.sh backend"
gates_slow: "./scripts/quality-slow.sh backend"
docs_touched: "docs/specs/03-technical-architecture.md,docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,supabase/session-sync-api-contract.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M15-T02-gym-coordinate-data-sync-contract`
- Title: Gym coordinate data model and sync contract
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-23`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M15-gps-gym-location-support.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes | no | N/A` (explain)
- Parent refs opened in this session:
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
- Code/docs inventory freshness checks run:
  - Re-check `docs/tasks/T-20260517-01-personal-gym-list-sync.md` status and current gym schema/repository behavior before edits.
- Known stale references or assumptions: none
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T02-gym-coordinate-data-sync-contract.md`

## Objective

Add nullable user-owned gym coordinate metadata to local SQLite, backend projection, and sync contracts so later GPS UI work has a stable storage/restore surface.

## Scope

### In scope

- Add local `gyms` coordinate fields per the M15 milestone proposal, including Drizzle schema and migration artifacts.
- Add backend `app_public.gyms` coordinate fields, constraints, ingest/projection mapping, and contract tests.
- Extend `gyms.upsert` event payloads and bootstrap/merge/convergence mapping for coordinate metadata.
- Update reinstall restore parity normalization for coordinate-bearing gyms.
- Update source-of-truth docs for data model, sync contract, architecture/testing expectations, and client sync behavior.

### Out of scope

- Adding `expo-location` or native permission config.
- Calling native location APIs.
- Recorder GPS suggestion UI.
- Gym-management coordinate controls.
- Maps/geocoding/social exposure.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This is storage/sync plumbing only. UI tasks consume the new data after it exists.

## Acceptance criteria

1. Local `gyms` supports nullable coordinate metadata with validated `latitude`, `longitude`, `coordinate_accuracy_m`, and `coordinates_updated_at` behavior.
2. Backend `app_public.gyms` supports the same coordinate metadata with range/shape constraints.
3. `gyms.upsert` outbox payloads include coordinate metadata and preserve existing name/timestamp/tombstone behavior.
4. Backend ingest/projection accepts valid coordinate payloads, rejects invalid ranges, clears coordinates when requested by the chosen contract, and stays idempotent.
5. Bootstrap fetch/merge/convergence includes coordinate metadata for local and remote winners.
6. Reinstall restore parity covers active, archived/deleted, and coordinate-bearing gyms.
7. RLS/composite owner key behavior remains unchanged.
8. Project-level docs and `supabase/session-sync-api-contract.md` are updated in the same branch.

## Docs touched (required)

- `docs/specs/03-technical-architecture.md` - record stable M15 data/sync behavior if adopted by implementation.
- `docs/specs/05-data-model.md` - add gym coordinate fields and sync-scope decision.
- `docs/specs/06-testing-strategy.md` - add GPS gym coordinate data/sync verification expectations if they become stable policy.
- `docs/specs/tech/client-sync-engine.md` - update bootstrap/merge/convergence notes for gym coordinates.
- `supabase/session-sync-api-contract.md` - extend `GymRecord` and `gyms.upsert` payload contract.
- `RUNBOOK.md` - review; update only if operator commands/workflows change.

## Testing and verification approach

- Planned checks/commands:
  - targeted mobile schema/repository/sync tests for `gyms`
  - `cd apps/mobile && npm run db:generate:canary`
  - `cd apps/mobile && npm run test:sync:reinstall-parity`
  - backend ingest/projection contract tests covering valid/invalid coordinates
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-fast.sh backend`
  - `./scripts/quality-slow.sh backend`
- Standard local gate usage:
  - Fast frontend and backend gates are mandatory.
  - Backend slow gate is mandatory because Supabase migrations/projection contracts change.
  - Frontend slow gate is not mandatory unless mobile runtime behavior beyond restore parity changes.
- Test layers covered:
  - SQLite migration/repository
  - sync outbox/bootstrap/restore parity
  - Supabase migration/contract/RLS/projection
- Hosted/deployed smoke ownership:
  - This task owns local backend proof. If hosted schema deployment is performed, record hosted smoke evidence or create an explicit follow-up owner.
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/schema/gyms.ts`
  - `apps/mobile/src/data/local-gyms.ts`
  - `apps/mobile/src/data/migrations/**`
  - `apps/mobile/drizzle/**`
  - `apps/mobile/src/sync/**`
  - `apps/mobile/app/__tests__/**`
  - `supabase/migrations/**`
  - `supabase/tests/**`
  - `supabase/session-sync-api-contract.md`
  - `docs/specs/**`
- Project structure impact:
  - No new top-level folders expected.
- Constraints/assumptions:
  - Re-check personal gym catalog task status before editing `gyms`.
  - Keep M13 event ingest as the primary mobile sync path.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend && ./scripts/quality-fast.sh backend`
- Standard local slow gate: `./scripts/quality-slow.sh backend`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M15-T02-gym-coordinate-data-sync-contract.md`
- Additional gate(s): `git diff --check`

## Evidence

- Manual verification summary:
- Deferred/manual hosted checks summary:

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update `docs/specs/milestones/M15-gps-gym-location-support.md` task breakdown/status.
- Run closeout helper or document why `N/A`.
