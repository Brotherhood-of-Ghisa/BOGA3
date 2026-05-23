---
task_id: M15-T04-recorder-gps-suggestion-ui
milestone_id: "M15"
status: completed
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
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/m15-t04-recorder-gps-suggestion @ 636bd21`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `partial`
  - Ran `git fetch origin --prune`, switched to `main`, and confirmed `git pull --ff-only origin main` was already up to date.
  - Recreated this task branch from `codex/m15-t03-location-service-matching` because `main` does not yet contain the completed M15-T02/T03 task cards or GPS service implementation required by T04.
- Parent refs opened in this session:
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/components-catalog.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - Confirmed `docs/tasks/complete/M15-T02-gym-coordinate-data-sync-contract.md` and `docs/tasks/complete/M15-T03-mobile-location-service-and-matching.md` are completed on the active M15 branch lineage.
  - Ran `./scripts/task-bootstrap.sh docs/tasks/M15-T04-recorder-gps-suggestion-ui.md`.
  - Re-checked current recorder gym picker state after `T-20260517-01-personal-gym-list-sync.md`: that task card is still `planned`; the recorder still uses route-local `SEEDED_LOCATIONS`, while `local-gyms` only exposes `upsertLocalGym()` and `loadLocalGymById()`.
- Known stale references or assumptions:
  - `main` is behind the M15 dependency branch lineage; T04 is intentionally based on T03 until prerequisite branches land.
  - Personal database-backed gym picker work is not present; GPS suggestion UI will consume nullable coordinate fields on the current `SessionLocation` shape and remain compatible with later persisted gym-list work.
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
  - Idle recorder state with the new Detect affordance: `apps/mobile/artifacts/maestro/ad-hoc/20260523-151328-47479/maestro-output/screenshots/02-session-recorder-visible.png`
  - Edge-state inline feedback after tapping Detect on a stale dev client without `ExpoLocation`: `apps/mobile/artifacts/maestro/M15-T04-recorder-gps-suggestion-ui/20260523-150200-38785/maestro-output/screenshots/gps-read-failure-inline.png`
  - Matched-confirmation success state is covered by RNTL interaction assertions with mocked location/matcher inputs; a native matched screenshot is deferred until T05 provides coordinate save/replace controls or seeded coordinate-bearing personal gyms.
- Manual verification summary (required when CI is absent/partial): local frontend GPS suggestion tests and gates passed.
  - Targeted red/green path: new recorder GPS suggestion tests failed on the missing detect affordance, then passed after implementation.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-screen.test.tsx --runInBand` passed.
  - `./scripts/quality-fast.sh frontend` passed: lint, typecheck, and 49 Jest suites / 346 tests.
  - Initial `./scripts/quality-slow.sh frontend` attempt failed because Maestro could not locate Java; reran with `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk"`.
  - During slow-gate evidence, the stale dev client exposed a missing `ExpoLocation` native module crash on Detect; added a lazy native-module guard so Detect degrades to inline read-failure feedback instead of redboxing.
  - One repeat slow-gate attempt hit a transient Maestro keyboard-hide failure in data-smoke; rerunning the same gate passed.
  - Final `./scripts/quality-slow.sh frontend` with the Java env prefix passed all lanes: smoke (`apps/mobile/artifacts/maestro/ad-hoc/20260523-151328-47479`), data-smoke (`apps/mobile/artifacts/maestro/ad-hoc/20260523-151431-48638`), and auth/profile (`apps/mobile/artifacts/maestro/ad-hoc/20260523-151609-49855`).
  - Ad-hoc GPS edge evidence flow passed: `TASK_ID=M15-T04-recorder-gps-suggestion-ui MAESTRO_RESET_STRATEGY=full ./scripts/maestro-ios-run-flow.sh --flow <tmp-flow> --scenario gps-detect-edge`, artifacts under `apps/mobile/artifacts/maestro/M15-T04-recorder-gps-suggestion-ui/20260523-150200-38785`.
  - `RUNBOOK.md` reviewed; no changes required.
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: added confirmation-gated recorder GPS gym suggestion UI and lazy native-location loading.
  - Added recorder GPS detection UI beside the gym selector, with loading, matched, permission-denied, unavailable, low-accuracy, no-match, ambiguous, and read-failure feedback states.
  - Confirmation is required before a matched GPS suggestion updates `session.locationId`; manual gym selection remains available and clears any outstanding suggestion.
  - Added a lazy foreground-location loader so stale dev clients without `ExpoLocation` keep the recorder usable and show inline read-failure feedback instead of crashing.
  - Extended recorder `SessionLocation` with nullable coordinate fields and top-aligned the shared recorder metadata row for variable-height gym feedback.
  - Updated UI docs for recorder GPS suggestion semantics.
- What tests ran: targeted RNTL, frontend fast gate, frontend slow gate, and an ad-hoc Maestro GPS edge capture.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-screen.test.tsx --runInBand`
  - `./scripts/quality-fast.sh frontend`
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./scripts/quality-slow.sh frontend`
  - `TASK_ID=M15-T04-recorder-gps-suggestion-ui MAESTRO_RESET_STRATEGY=full ./scripts/maestro-ios-run-flow.sh --flow <tmp-flow> --scenario gps-detect-edge`
- What remains: T05 still owns save/replace/clear gym coordinate controls and native matched-state visual proof with coordinate-bearing gyms.
  - T05 still owns save/replace/clear gym coordinate controls; until then, matched native GPS screenshots require mocked RNTL coverage rather than an end-to-end coordinate-bearing gym path.
  - This branch is based on `codex/m15-t03-location-service-matching` because prerequisite M15 branches are not yet on `main`.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update UI docs and milestone task breakdown/status.
