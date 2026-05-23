---
task_id: M15-T04-recorder-gps-suggestion-ui
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

- Task ID: `M15-T04-recorder-gps-suggestion-ui`
- Title: Session recorder GPS gym suggestion UI
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
  - Re-check current recorder gym picker/personal gym state after `T-20260517-01-personal-gym-list-sync.md`.
- Known stale references or assumptions: none
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T04-recorder-gps-suggestion-ui.md`

## Objective

Add recorder UI that lets the user ask for a GPS gym suggestion and confirm it before changing the active session gym.

## Scope

### In scope

- Add a detect/current-location affordance to the recorder's gym area.
- Wire the location service and matcher into recorder state.
- Render loading, permission denied, unavailable, low accuracy, no match, ambiguous, and matched states.
- Require confirmation before applying a suggested gym to the active session.
- Preserve manual gym picker override behavior.
- Add RNTL coverage and UI docs updates.

### Out of scope

- Saving/replacing/clearing gym coordinates.
- New routes.
- Background tracking, automatic check-ins, maps, geocoding, or social sharing.
- Backend/schema/sync changes.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - The session recorder gains a visible GPS suggestion flow and new inline feedback states.

## UX Contract

### Key user flows

1. Flow name: Suggest current gym
   - Trigger: User taps the recorder detect/current-location affordance.
   - Steps: App requests/uses foreground location, matches eligible personal gyms, and shows a suggestion.
   - Success outcome: User confirms the suggestion and the active session gym changes.
   - Failure/edge outcome: denied/unavailable/low-accuracy/no-match/ambiguous states show inline feedback and leave the session gym unchanged.
2. Flow name: Ignore or override GPS suggestion
   - Trigger: A suggestion is visible or already confirmed.
   - Steps: User dismisses the suggestion or opens the manual gym picker and selects a different gym.
   - Success outcome: Manual selection wins and the recorder remains usable.
   - Failure/edge outcome: persistence/autosave failures follow existing recorder feedback behavior.

### Interaction + appearance notes

- Reuse existing recorder tokens, modal/list patterns, and compact action styling.
- Do not add raw color literals in `.tsx` files.
- Keep GPS text short and operational.
- Do not show full coordinate values in the recorder.

## Acceptance criteria

1. The recorder exposes a clear current-location/detect affordance near gym selection.
2. Detecting current location never auto-selects a gym without confirmation.
3. Confirming a matched suggestion updates the active session gym.
4. Manual gym selection remains available and can override GPS.
5. Permission denied, unavailable, low accuracy, no match, and ambiguous states are covered by tests.
6. UI docs update recorder state semantics.
7. Screen UI uses documented tokens/primitives/shared components or records a justified exception.
8. Screenshots or equivalent captures are recorded for success and at least one edge state.

## Docs touched (required)

- `docs/specs/ui/screen-map.md` - update recorder key states.
- `docs/specs/ui/ux-rules.md` - document recorder GPS suggestion semantics.
- `RUNBOOK.md` - review; update only if local/manual evidence workflow changes.
- UI docs update required?: `yes`
- Tokens/primitives compliance statement:
  - Reuse plan: existing recorder UI tokens/styles and in-route modal/inline feedback patterns.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` and this task.

## Testing and verification approach

- Planned checks/commands:
  - targeted RNTL recorder tests for suggestion states
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Frontend slow gate is mandatory because this changes recorder UI and foreground permission-facing behavior.
- Test layers covered:
  - RNTL UI state/interaction tests
  - mocked location/matcher paths
  - simulator/Maestro or equivalent runtime screenshots
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - recorder-related components/types if extracted
  - `apps/mobile/app/__tests__/**`
  - `docs/specs/ui/**`
  - `RUNBOOK.md` only if needed
- Project structure impact:
  - No new routes or top-level folders expected.
- Constraints/assumptions:
  - T02 and T03 should land first.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M15-T04-recorder-gps-suggestion-ui.md`
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
