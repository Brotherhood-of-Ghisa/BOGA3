---
task_id: M15-T05-gym-management-coordinate-controls
milestone_id: "M15"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M15-T05-gym-management-coordinate-controls`
- Title: Gym-management coordinate save, replace, and clear controls
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
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes | no | N/A` (explain)
- Parent refs opened in this session:
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
- Code/docs inventory freshness checks run:
  - Confirm T02 and T03 status before edits.
  - Re-check personal gym management UI after `T-20260517-01-personal-gym-list-sync.md`.
- Known stale references or assumptions: none
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T05-gym-management-coordinate-controls.md`

## Objective

Let users save, replace, and clear private coordinates for their personal gyms from the gym-management flow.

## Scope

### In scope

- Add coordinate status and controls to gym management.
- Save current foreground location to a gym's coordinate fields.
- Replace existing coordinates after explicit confirmation.
- Clear existing coordinates after explicit confirmation.
- Emit coordinate-bearing `gyms.upsert` events through the repository layer.
- Add tests and UI docs updates.

### Out of scope

- Recorder GPS suggestion UI unless minor integration is required.
- Maps/geocoding/address display.
- Background tracking or automatic check-ins.
- Public/shared gym registry.
- Backend/schema/sync contract changes beyond using T02 behavior.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - Gym management gains user-facing coordinate status and coordinate mutation controls.

## UX Contract

### Key user flows

1. Flow name: Save current location to a gym
   - Trigger: User opens gym management for a gym with no coordinates and taps save current location.
   - Steps: App requests/uses foreground location, validates accuracy, and persists coordinates.
   - Success outcome: Gym shows that coordinates are saved and a sync event is queued.
   - Failure/edge outcome: denied/unavailable/low-accuracy/persistence failures stay inline and leave existing row state unchanged.
2. Flow name: Replace existing coordinates
   - Trigger: User taps replace coordinates on a gym that already has coordinates.
   - Steps: App asks for confirmation, reads current location, validates accuracy, and persists replacement.
   - Success outcome: Gym coordinate metadata updates and syncs.
   - Failure/edge outcome: cancel or read failure leaves previous coordinates intact.
3. Flow name: Clear coordinates
   - Trigger: User taps clear coordinates.
   - Steps: App confirms destructive intent and clears nullable coordinate metadata.
   - Success outcome: Gym no longer participates in GPS matching.
   - Failure/edge outcome: cancel or persistence failure leaves coordinates intact.

### Interaction + appearance notes

- Keep controls inside the existing gym management modal/pattern.
- Show coordinate presence without exposing high-precision values in the primary row.
- Use explicit danger styling for clear.
- Keep feedback inline and concise.

## Acceptance criteria

1. Users can save current location coordinates for a personal gym.
2. Users can replace coordinates only after confirmation.
3. Users can clear coordinates only after confirmation.
4. Coordinate mutations update `gyms.updated_at` and enqueue `gyms.upsert`.
5. Clearing coordinates prevents the gym from being considered by the matcher.
6. Permission denied, unavailable, low accuracy, cancel, and persistence failure states are tested.
7. UI docs update gym-management semantics.
8. Screenshots or equivalent captures are recorded for save and clear/replace states.

## Docs touched (required)

- `docs/specs/ui/screen-map.md` - update recorder/gym-management modal states if behavior changes current screen state inventory.
- `docs/specs/ui/ux-rules.md` - document coordinate save/replace/clear semantics.
- `RUNBOOK.md` - review; update only if local/manual evidence workflow changes.
- UI docs update required?: `yes`
- Tokens/primitives compliance statement:
  - Reuse plan: existing recorder/gym management modal/list/button styles and tokens.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` and this task.

## Testing and verification approach

- Planned checks/commands:
  - targeted RNTL tests for coordinate controls
  - targeted repository/event-emission tests for coordinate upserts
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Frontend slow gate is mandatory because this changes visible recorder/gym-management flows and foreground permission-facing behavior.
- Test layers covered:
  - RNTL UI interaction tests
  - repository/outbox tests
  - simulator/Maestro or equivalent runtime screenshots
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - gym/repository/location service files from T02/T03 as needed
  - `apps/mobile/app/__tests__/**`
  - `docs/specs/ui/**`
  - `RUNBOOK.md` only if needed
- Project structure impact:
  - No new routes or top-level folders expected.
- Constraints/assumptions:
  - T02 and T03 should land first.
  - T04 may land before or after this task if both branch from a shared T03 baseline and conflicts are managed carefully; default direct flow is sequential.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M15-T05-gym-management-coordinate-controls.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
- Manual verification summary:
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update UI docs and milestone task breakdown/status.
