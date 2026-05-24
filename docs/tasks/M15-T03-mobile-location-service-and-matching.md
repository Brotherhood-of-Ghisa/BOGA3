---
task_id: M15-T03-mobile-location-service-and-matching
milestone_id: "M15"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A - no simulator permission flow required unless native config/runtime behavior changes beyond dependency setup"
docs_touched: "docs/specs/03-technical-architecture.md,docs/specs/06-testing-strategy.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M15-T03-mobile-location-service-and-matching`
- Title: Mobile foreground location service and matching domain logic
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
- Human run/test/debug guide: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit:
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes | no | N/A` (explain)
- Parent refs opened in this session:
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
- Code/docs inventory freshness checks run:
  - Confirm whether `expo-location` is already installed.
  - Re-check current Expo foreground location and config plugin documentation before dependency/config edits.
- Known stale references or assumptions: none
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T03-mobile-location-service-and-matching.md`

## Objective

Add the mobile foreground-location service boundary and pure nearest-gym matching logic without changing user-facing recorder or gym-management UI.

## Scope

### In scope

- Add `expo-location` and any required native/app config for foreground-only permission.
- Add a small mobile location service wrapper with typed results for granted, denied, unavailable, timeout, and position success.
- Add pure matching logic using the M15 Haversine/radius/accuracy/tie rules.
- Add deterministic unit tests for matching behavior and service result normalization.
- Update docs for architecture/testing/runbook only if dependency or operator workflow changes require it.

### Out of scope

- Background permission or background tasks.
- Persisting coordinates from UI.
- Recorder suggestion UI.
- Gym-management controls.
- Supabase/schema/sync changes beyond consuming the fields from T02.

## UI Impact (required checkpoint)

- UI Impact?: `no`
- Rationale:
  - This task provides services/domain logic only. Later UI tasks call it.

## Acceptance criteria

1. Foreground-only location dependency/config is added after checking current Expo documentation.
2. The service wrapper never requests background permission.
3. Service results distinguish permission denied, unavailable services, timeout/read failure, low-level unexpected failure, and successful position.
4. Matching rejects missing/invalid gym coordinates and low-accuracy position readings.
5. Matching uses Haversine distance in meters.
6. Matching honors default `100m` accuracy, `150m` radius, and `25m` tie threshold unless constants are deliberately changed in docs/tests.
7. Ambiguous matches require manual selection and do not pick a winner silently.
8. Unit tests cover success, no match, low accuracy, invalid coordinates, and tie ambiguity.

## Docs touched (required)

- `docs/specs/03-technical-architecture.md` - update only if a stable new location-service boundary is adopted.
- `docs/specs/06-testing-strategy.md` - update only if GPS service/matching verification becomes shared policy.
- `RUNBOOK.md` - review; update only if dependency install/native rebuild/operator steps change.

## Testing and verification approach

- Planned checks/commands:
  - targeted Jest tests for matcher and service wrapper
  - `./scripts/quality-fast.sh frontend`
- Standard local gate usage:
  - Frontend fast gate is mandatory.
  - Slow frontend gate is `N/A` unless native runtime evidence is required by actual config changes; if required, promote to `./scripts/quality-slow.sh frontend`.
- Test layers covered:
  - pure unit tests
  - service normalization tests with mocked location API
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/package.json`
  - lockfile if present
  - `apps/mobile/app.json` or Expo config file if present/needed
  - `apps/mobile/src/location/**` or closest existing mobile service location
  - `apps/mobile/app/__tests__/**`
  - docs listed above
- Project structure impact:
  - If a new `apps/mobile/src/location/` folder is introduced, it is a normal mobile source subfolder and does not require `09-project-structure.md` unless the task makes it a broader canonical convention.
- Constraints/assumptions:
  - T02 should land first so matcher inputs can use the final gym coordinate shape.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` unless native runtime risk triggers are introduced during implementation
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M15-T03-mobile-location-service-and-matching.md`
- Additional gate(s): `git diff --check`

## Evidence

- Manual verification summary:
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Update `docs/specs/milestones/M15-gps-gym-location-support.md` task breakdown/status.
