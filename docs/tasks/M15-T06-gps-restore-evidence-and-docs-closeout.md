---
task_id: M15-T06-gps-restore-evidence-and-docs-closeout
milestone_id: "M15"
status: planned
ui_impact: "yes"
areas: "frontend|backend|cross-stack|docs"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./scripts/quality-fast.sh frontend && ./scripts/quality-fast.sh backend"
gates_slow: "./scripts/quality-slow.sh frontend && ./scripts/quality-slow.sh backend"
docs_touched: "docs/specs/milestones/M15-gps-gym-location-support.md,docs/specs/03-technical-architecture.md,docs/specs/05-data-model.md,docs/specs/06-testing-strategy.md,docs/specs/tech/client-sync-engine.md,docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M15-T06-gps-restore-evidence-and-docs-closeout`
- Title: GPS restore parity, runtime evidence, and docs closeout
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
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
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
  - Confirm T02-T05 are completed and moved to `docs/tasks/complete/`.
  - Re-check current GPS coordinate docs against implementation.
- Known stale references or assumptions: none
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
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M15-T06-gps-restore-evidence-and-docs-closeout.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
- Manual verification summary:
- Deferred/manual hosted checks summary:

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update M15 milestone status and completion note.
