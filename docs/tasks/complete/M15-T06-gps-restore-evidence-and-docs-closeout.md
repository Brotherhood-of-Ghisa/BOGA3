---
task_id: M15-T06-gps-restore-evidence-and-docs-closeout
milestone_id: "M15"
status: completed
ui_impact: "yes"
areas: "frontend|backend|cross-stack|docs"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./scripts/quality-fast.sh frontend && ./scripts/quality-fast.sh backend"
gates_slow: "./scripts/quality-slow.sh frontend && ./scripts/quality-slow.sh backend"
docs_touched: "docs/specs/milestones/M15-gps-gym-location-support.md,docs/specs/03-technical-architecture.md,docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,supabase/session-sync-api-contract.md,docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M15-T06-gps-restore-evidence-and-docs-closeout`
- Title: GPS restore parity, runtime evidence, and docs closeout
- Status: `completed`
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
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- Sync contract: `supabase/session-sync-api-contract.md`
- Client sync engine deep-dive: `docs/specs/tech/client-sync-engine.md`
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/m15-t06-gps-restore-evidence-closeout @ 03414c1`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `partial`
  - Ran `git fetch --prune origin`.
  - Created this task branch from `codex/m15-t05-gym-coordinate-controls` because M15 prerequisites are not on `main` yet.
- Parent refs opened in this session:
  - `AGENTS.md`
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
  - `docs/tasks/M15-T06-gps-restore-evidence-and-docs-closeout.md`
  - `docs/specs/tech/client-sync-engine.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/11-maestro-runtime-and-testing-conventions.md`
  - `supabase/session-sync-api-contract.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirmed T02-T05 are completed and moved to `docs/tasks/complete/`.
  - Re-checked GPS coordinate docs against implementation-level references in mobile sync, backend contract tests, restore parity, and UI docs.
  - Confirmed `docs/tasks/T-20260517-01-personal-gym-list-sync.md` is still `planned`; M15 closeout does not claim full personal gym-list sync is complete.
- Known stale references or assumptions:
  - M15 branches remain stacked on the T02-T05 lineage until prerequisites land on `main`.
  - Full database-backed personal gym-list sync remains deferred to `docs/tasks/T-20260517-01-personal-gym-list-sync.md`.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T06-gps-restore-evidence-and-docs-closeout.md`

## Objective

Close M15 by proving coordinate restore parity and permission-aware runtime behavior, then aligning milestone and project docs to the implemented GPS gym-location behavior.

## Scope

### In scope

- Run/repair restore parity coverage for coordinate-bearing gyms.
- Run cross-stack backend/frontend gates required by the changed data/sync/UI surfaces.
- Capture runtime UI evidence for recorder GPS suggestion and gym coordinate controls.
- Ensure project-level docs reflect the stable implemented behavior.
- Mark M15 completed if all acceptance criteria are satisfied.

### Out of scope

- New product behavior beyond closing gaps found in T02-T05.
- Hosted deployment unless a prior M15 task changed hosted schema and left smoke validation deferred to this task.
- Maps/geocoding/social/background location.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - This task verifies and documents user-facing GPS UI behavior, but should only make bugfix-level UI changes if evidence reveals a gap.

## UX Contract

### Key user flows

1. Flow name: Recorder GPS suggestion evidence
   - Trigger: Run simulator/manual or Maestro flow for recorder detect.
   - Steps: Exercise success and at least one denied/unavailable/edge state through mocks, harness, or documented manual setup.
   - Success outcome: Evidence paths show user-confirmed suggestion behavior.
   - Failure/edge outcome: Any missing state is fixed or documented as a blocker.
2. Flow name: Gym coordinate management evidence
   - Trigger: Run simulator/manual or Maestro flow for save/replace/clear controls.
   - Steps: Exercise coordinate status and mutation feedback.
   - Success outcome: Evidence paths show coordinate controls without exposing social/location sharing.
   - Failure/edge outcome: Any missing state is fixed or documented as a blocker.

### Interaction + appearance notes

- Keep closeout fixes scoped to evidence gaps.
- Do not introduce new UI patterns during closeout unless required to satisfy existing M15 contracts.

## Acceptance criteria

1. Reinstall restore parity proves coordinate-bearing gyms survive sync/restore.
2. Backend contract evidence includes coordinate projection validation.
3. Frontend fast and backend fast gates pass.
4. Frontend slow gate passes or an exact blocker with artifact paths is recorded.
5. Backend slow gate passes or an exact blocker with command output summary is recorded.
6. UI evidence covers recorder suggestion and gym coordinate controls.
7. `docs/specs/03-technical-architecture.md`, `docs/specs/05-data-model.md`, `docs/specs/06-testing-strategy.md`, `docs/specs/tech/client-sync-engine.md`, `supabase/session-sync-api-contract.md`, and relevant UI docs are consistent with implementation.
8. `RUNBOOK.md` is reviewed and updated if operator workflows changed.
9. All M15 task cards are moved to `docs/tasks/complete/` or explicitly marked blocked/outdated.
10. M15 milestone status is set to `completed` only if no required behavior remains open.

## Docs touched (required)

- `docs/specs/milestones/M15-gps-gym-location-support.md` - status/task breakdown/completion note.
- `docs/specs/03-technical-architecture.md` - final stable GPS/sync architecture summary if not already updated.
- `docs/specs/05-data-model.md` - final coordinate field/sync-scope summary if not already updated.
- `docs/specs/06-testing-strategy.md` - final GPS test policy if not already updated.
- `docs/specs/tech/client-sync-engine.md` - final coordinate bootstrap/restore notes if not already updated.
- `supabase/session-sync-api-contract.md` - verify final `GymRecord` contract is current.
- `docs/specs/ui/screen-map.md` and `docs/specs/ui/ux-rules.md` - verify final UI behavior docs are current.
- `RUNBOOK.md` - review/update if operator workflows changed.
- UI docs update required?: `yes`
  - Verified `docs/specs/ui/screen-map.md` and `docs/specs/ui/ux-rules.md` already describe recorder GPS suggestion and gym-management coordinate-control behavior from T04/T05; no additional UI doc changes were required in T06.
- Tokens/primitives compliance statement: closeout made no UI code changes and introduced no new UI pattern or token usage.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm run test:sync:reinstall-parity`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-fast.sh backend`
  - `./scripts/quality-slow.sh frontend`
  - `./scripts/quality-slow.sh backend`
  - task-specific UI/runtime evidence commands from T04/T05
- Standard local gate usage:
  - Frontend and backend fast gates are mandatory.
  - Frontend and backend slow gates are mandatory at milestone closeout unless an exact environmental blocker is documented.
- Test layers covered:
  - unit/UI/integration
  - local Supabase contract
  - restore parity
  - simulator/Maestro/manual visual evidence
- Hosted/deployed smoke ownership:
  - If hosted schema deployment was deferred by T02, this task owns either hosted smoke evidence or an explicit release-blocking follow-up.
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - tests/evidence helpers needed to prove M15
  - docs listed above
  - narrow bugfixes in GPS/location/recorder/gym-management code if closeout evidence exposes a contract miss
- Project structure impact:
  - No new canonical paths expected.
- Constraints/assumptions:
  - Prefer fixing missing M15 behavior over weakening docs.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend && ./scripts/quality-fast.sh backend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend && ./scripts/quality-slow.sh backend`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/complete/M15-T06-gps-restore-evidence-and-docs-closeout.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
  - Recorder GPS suggestion UI evidence remains covered by T04 RNTL interaction coverage and recorded runtime artifacts:
    - idle Detect affordance: `apps/mobile/artifacts/maestro/ad-hoc/20260523-151328-47479/maestro-output/screenshots/02-session-recorder-visible.png`
    - inline GPS read-failure edge state: `apps/mobile/artifacts/maestro/M15-T04-recorder-gps-suggestion-ui/20260523-150200-38785/maestro-output/screenshots/gps-read-failure-inline.png`
  - Gym coordinate controls evidence remains covered by T05 RNTL interaction coverage for save, replace, clear/cancel, permission denied, unavailable services, low accuracy, and persistence failure states.
  - Final green frontend slow-gate simulator artifacts from this closeout:
    - smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260524-081944-13493/`
    - data smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260524-082047-14652/`
    - auth/profile: `apps/mobile/artifacts/maestro/ad-hoc/20260524-082225-15858/`
- Manual verification summary (required when CI is absent/partial): local closeout gates passed after repairing local environment state.
  - `cd apps/mobile && npm run test:sync:reinstall-parity` passed; this suite includes coordinate-bearing gyms in the normalized restore snapshot.
  - `./scripts/quality-fast.sh frontend` passed: lint, typecheck, and 49 Jest suites / 353 tests.
  - `./scripts/quality-fast.sh backend` passed: local runtime start/reset, schema lint, health smoke, and seed smoke.
  - First frontend slow attempt passed smoke and data-smoke but failed during auth fixture provisioning because Kong held a stale Auth upstream after local Supabase reset; restarted `supabase_kong_BOGA-BOGA3-wt1` to refresh routing, then auth/profile and the full frontend slow wrapper passed.
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./scripts/quality-slow.sh frontend` passed.
  - `./scripts/quality-slow.sh backend` passed, including auth/RLS contracts, sync API contracts, coordinate projection validation, invalid-coordinate rejection, and per-owner shared-id projection checks.
  - `RUNBOOK.md` reviewed; no operator workflow changes required.
- Deferred/manual hosted checks summary: `N/A` - M15 closeout used local Supabase/runtime evidence; hosted deployment was not part of the scoped task.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: closed M15 docs/status after verifying restore parity, backend contracts, frontend runtime evidence, and project-doc consistency for foreground-only GPS gym support.
  - Updated the M15 milestone to completed, recorded final verification evidence, and kept the planned personal gym-list sync task explicitly out of M15 completion scope.
- What tests ran: restore parity, frontend/backend fast gates, frontend/backend slow gates, whitespace check, and closeout checker.
  - `./scripts/worktree-setup.sh`
  - `cd apps/mobile && npm run test:sync:reinstall-parity`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-fast.sh backend`
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./scripts/quality-slow.sh frontend`
  - `./scripts/quality-slow.sh backend`
  - `git diff --check`
  - `./scripts/task-closeout-check.sh docs/tasks/complete/M15-T06-gps-restore-evidence-and-docs-closeout.md`
- What remains: personal gym-list sync remains planned and the M15 branch stack still needs to land in order.
  - `docs/tasks/T-20260517-01-personal-gym-list-sync.md` is still `planned`; full persisted gym-list sync is not claimed as complete by M15.
  - M15 branches remain stacked until prerequisite branches land on `main`.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update M15 milestone status and completion note.
