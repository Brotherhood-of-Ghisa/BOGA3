---
task_id: M15-T07-hidden-gps-gym-ux-correction
milestone_id: "M15"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/milestones/M15-gps-gym-location-support.md,docs/specs/ui/screen-map.md,docs/specs/ui/ux-rules.md,RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `M15-T07-hidden-gps-gym-ux-correction`
- Title: Hide GPS gym UX behind quiet gym preselection and editor controls
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-24`
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

- Verified current branch + HEAD commit: `codex/m15-t07-hidden-gps-gym-ux-correction` @ `a623e98`
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - fetched `origin/main` (`6fae7bb`) before edits; user had already created the task branch, so execution stays on the branch.
- Parent refs opened in this planning session:
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
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run in planning:
  - `rg -n "M15|GPS|location|gym" docs/specs docs/tasks RUNBOOK.md apps/mobile/app apps/mobile/src apps/mobile/components -g '!docs/brainstorms/**'` - confirmed current docs still describe visible recorder GPS suggestion and manage-list coordinate controls.
  - `rg -n "gps|GPS|Detect|Use this gym|save current|Save current|coordinate|location|gym" apps/mobile/app/\(tabs\)/session-recorder.tsx` - confirmed current recorder implementation contains a visible Detect button, confirmation suggestion panel, and manage-list coordinate actions.
- Known stale references or assumptions:
  - `docs/tasks/T-20260517-01-personal-gym-list-sync.md` remains planned. At execution start, re-check whether the recorder is still using route-local gym state or has moved to the database-backed personal gym list.
  - M15 is functionally complete but is being reopened for this corrective UX follow-up because the visible GPS feature surface is not aligned with the desired product feel.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M15-T07-hidden-gps-gym-ux-correction.md`

## Objective

Revise M15 GPS gym behavior so GPS quietly assists gym selection and coordinate capture without becoming a visible recorder feature surface.

The recorder should try to preselect a gym only once when a brand-new session starts. If no single confident match exists, the gym remains empty. After session creation, the app must never force the detected gym back onto the session. Users can manually choose another gym, choose `No gym`, or long-press the gym box to explicitly retry GPS detection.

## Scope

### In scope

- Remove the visible recorder `Detect` button and matched suggestion panel.
- Add one-shot startup GPS gym preselection for brand-new active sessions only.
- Add a long-press gesture on the gym box to explicitly run a fresh GPS detection for the current active session.
- Add a `No gym` picker option that sets `session.locationId = null` and persists/submits `gym_id = null`.
- Show the null-gym state as `No gym` once a session is active, not as an unresolved `Choose gym` prompt.
- When adding a new gym, attempt to save current foreground coordinates automatically if an acceptable position is available; still create/select the gym if GPS is unavailable, denied, low accuracy, ambiguous, or fails.
- Remove `Save current location`, `Replace`, and `Clear` coordinate actions from the multi-gym Manage screen.
- Add `Save current location` to the single gym editor screen. For an existing gym, it saves or replaces that gym's private coordinates.
- Keep coordinate clearing available from the single gym editor if current implementation already supports clearing coordinates, using an explicit destructive control and confirmation.
- Update recorder UI tests and UI docs.

### Out of scope

- Data model, local schema, backend projection, RLS, or sync contract changes.
- Background location, continuous tracking, geofencing, maps, geocoding, address display, Places APIs, public gym discovery, anti-cheat, or social location sharing.
- Full database-backed personal gym list work; adapt to it only if `T-20260517-01-personal-gym-list-sync.md` has landed by execution time.
- New routes.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale:
  - The recorder removes a visible GPS suggestion surface, changes gym picker semantics, adds a hidden long-press retry gesture, and moves coordinate controls from the manage list to the single gym editor.

## UX Contract

### Key user flows

1. Flow name: Brand-new session starts with quiet gym preselection
   - Trigger: User starts a brand-new active session from the empty recorder state.
   - Steps: App attempts one foreground location read, matches eligible saved gyms, and creates the active draft.
   - Success outcome: If exactly one eligible gym matches, the draft starts with that gym selected.
   - Failure/edge outcome: Permission denied, unavailable services, timeout, read failure, low accuracy, no match, ambiguous match, or no coordinate-bearing gyms leave the draft with `locationId = null` and visible label `No gym`.
2. Flow name: Auto-detection does not override the user
   - Trigger: User manually selects another gym or selects `No gym` after the session starts.
   - Steps: User opens the gym picker with a short press and chooses a row.
   - Success outcome: Manual selection wins and is persisted through normal draft autosave. Startup auto-detection does not run again for this active draft.
   - Failure/edge outcome: Restoring an existing active draft, reopening the recorder, or editing a completed session never triggers startup auto-detection.
3. Flow name: User explicitly retries GPS via long press
   - Trigger: User long-presses the gym box during an active session.
   - Steps: App performs a foreground location read and runs the same matcher.
   - Success outcome: If exactly one eligible gym matches, the current session gym is set to that gym immediately.
   - Failure/edge outcome: Permission denied, unavailable services, timeout, read failure, low accuracy, no match, or ambiguous match leave the current gym unchanged. No persistent GPS suggestion panel is shown.
4. Flow name: User chooses no gym
   - Trigger: User short-presses the gym box and chooses `No gym`.
   - Steps: App sets `session.locationId = null` and dismisses the picker.
   - Success outcome: The session submits or autosaves with `gym_id = null`; no `gyms` row is created, edited, synced, archived, or shown in Manage.
   - Failure/edge outcome: If a GPS retry later selects a gym, the user can still return to `No gym` manually.
5. Flow name: Add a gym with automatic coordinate capture
   - Trigger: User adds a new gym from the gym editor.
   - Steps: User enters a name; app creates/selects the gym and silently attempts to attach current coordinates if foreground GPS yields an acceptable position.
   - Success outcome: The new gym is selected and persisted. If coordinates were available, they are saved on the gym and included in the normal `gyms.upsert` payload.
   - Failure/edge outcome: GPS failure does not block gym creation or selection; the user can later use `Save current location` in the single gym editor.
6. Flow name: Save coordinates from the single gym editor
   - Trigger: User opens the editor for one gym and taps `Save current location`.
   - Steps: App reads foreground location, validates accuracy, and persists coordinates for that gym.
   - Success outcome: Coordinates are saved or replaced for that gym, with concise inline success feedback in the editor.
   - Failure/edge outcome: Permission denied, unavailable services, timeout, read failure, low accuracy, or persistence failure stays inline and leaves existing coordinates unchanged.

### Interaction + appearance notes

- The default recorder surface should show only the gym box. GPS should not be presented as a primary visible action.
- Short press on the gym box opens the picker. Long press retries GPS detection.
- The gym picker includes `No gym` at the top as a null selection, not a database row.
- The Manage screen should focus on list management: edit, archive/unarchive, archived visibility. It should not contain coordinate actions.
- The single gym editor owns per-gym coordinate actions and concise inline feedback.

## Acceptance criteria

1. No visible recorder `Detect` button, `Use this gym`, `Ignore`, or persistent GPS suggestion panel remains.
2. Brand-new active session creation attempts GPS gym detection at most once.
3. Startup auto-detection runs only for brand-new active sessions created from the empty state.
4. Startup auto-detection does not run when restoring an existing active draft.
5. Startup auto-detection does not run in completed-session edit mode.
6. If startup detection returns exactly one match, the new active draft is created with that gym selected.
7. If startup detection fails, is low accuracy, finds no match, or is ambiguous, the new active draft is created with `gym_id = null`.
8. Manual gym selection and `No gym` selection are never overwritten by startup auto-detection.
9. Long-pressing the gym box explicitly retries GPS detection and may select a single matched gym.
10. A failed/ambiguous long-press detection leaves the current gym unchanged.
11. The gym picker includes a `No gym` option that sets `session.locationId = null`.
12. `No gym` is not inserted into `gyms`, not synced, not editable, not archived, and not shown in Manage.
13. A null gym state displays as `No gym` in an active session instead of `Choose gym`.
14. Adding a new gym silently attempts to attach current GPS coordinates when an acceptable foreground position is available.
15. Adding a new gym succeeds and selects the gym even when GPS is unavailable, denied, low accuracy, ambiguous, or fails.
16. Manage no longer shows `Save current location`, `Replace`, or `Clear` coordinate controls on each row.
17. The single gym editor shows `Save current location` for the gym being added or edited.
18. Existing gym coordinate save/replace errors remain inline and leave existing coordinates unchanged.
19. Existing coordinate clear behavior, if retained, is available only from the single gym editor and remains destructive/confirmation-gated.
20. Coordinate mutations still use `upsertLocalGym` and normal coordinate-bearing `gyms.upsert` behavior.
21. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
22. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
23. `docs/specs/ui/screen-map.md` and `docs/specs/ui/ux-rules.md` are updated in the same task.
24. `docs/specs/ui/navigation-contract.md` is updated only if route/path/query/transition behavior changes; no update is expected.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/milestones/M15-gps-gym-location-support.md` - replace visible advisory GPS suggestion as the stable product contract with hidden GPS assistance, one-shot preselection, long-press retry, `No gym`, and editor-owned coordinate controls.
  - `docs/specs/ui/screen-map.md` - update recorder state summary to remove visible suggestion states and describe hidden startup preselection plus editor coordinate control placement.
  - `docs/specs/ui/ux-rules.md` - update recorder/gym-management semantics for hidden GPS assistance, long press, `No gym`, and editor-owned coordinate actions.
  - `RUNBOOK.md` - review; update only if local/manual evidence workflow changes.
- Cross-cutting project-level docs:
  - `docs/specs/03-technical-architecture.md` - likely no change required because foreground-only location service, pure matcher, and private coordinates remain the architecture.
  - `docs/specs/05-data-model.md` - no change expected because `No gym` maps to existing nullable `gym_id` and no new entity/field is added.
  - `docs/specs/06-testing-strategy.md` - update only if verification expectations change beyond existing M15 GPS UI coverage.
- UI docs update required?: `yes`
- UI docs maintenance trigger map:
  - `screen-map.md`: recorder key state set changes.
  - `ux-rules.md`: UI semantics/pattern expectations change.
  - `navigation-contract.md`: expected `no update`, because no route, param, redirect, or transition behavior changes.
- Tokens/primitives compliance statement:
  - Reuse plan: existing recorder modal, picker, editor, inline feedback, button, and token styles.
  - Exceptions: none planned; if long-press needs a screen-local affordance or feedback style, document it.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` because this is a UI task.
  - Planned captures/artifacts:
    - active session with auto-detected gym selected,
    - active session with null gym shown as `No gym`,
    - gym picker showing `No gym`,
    - manage screen without coordinate actions,
    - single gym editor with `Save current location` and one inline error or success state.

## Testing and verification approach

- Planned checks/commands:
  - Targeted recorder RNTL tests for startup preselection, startup failure/no-op, manual override, `No gym`, long-press retry, and editor coordinate controls.
  - Targeted repository/event tests only if coordinate payload behavior changes. No payload contract change is expected.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-screen.test.tsx --runInBand`
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend`
  - `git diff --check`
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` is mandatory.
  - `./scripts/quality-slow.sh frontend` is mandatory unless execution narrows to tests/docs only. Default to required because this changes foreground permission-facing recorder behavior.
- Test layers covered:
  - RNTL UI interaction tests with mocked location service and matcher.
  - Existing deterministic matcher/service tests remain unchanged unless refactoring requires updates.
  - Simulator/Maestro or equivalent visual evidence for the changed recorder/gym editor surfaces.
- Execution triggers:
  - Always run targeted recorder tests after each behavior slice.
  - Run full frontend fast gate before closeout.
  - Run frontend slow gate before closeout when implementation changes runtime-facing UI behavior.
- Slow-gate triggers:
  - Required for permission-facing UI behavior, long-press GPS retry, and editor coordinate capture unless the task is intentionally reduced to documentation only.
- Hosted/deployed smoke ownership:
  - `N/A`; no hosted backend or deployment behavior changes expected.
- CI/manual posture note:
  - Current repo has no CI pipeline; local evidence is required.
- Notes:
  - Red tests should first assert that visible `Detect` / `Use this gym` affordances are absent and that startup detection is one-shot.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/components/session-recorder/**` only if extraction is needed for clarity
  - `apps/mobile/app/__tests__/session-recorder-screen.test.tsx`
  - `apps/mobile/app/__tests__/sync-domain-event-emission.test.ts` only if coordinate upsert expectations need adjustment
  - `docs/specs/milestones/M15-gps-gym-location-support.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/ux-rules.md`
  - `RUNBOOK.md` only if local/manual evidence workflow changes
- Project structure impact:
  - No new routes, top-level folders, or canonical path conventions expected.
- Constraints/assumptions:
  - Keep foreground-only location behavior.
  - Treat GPS results as private assistance, not user-visible proof or check-in behavior.
  - `No gym` is a UI option over existing nullable session `gym_id`, not a gym entity.
  - Startup preselection belongs in the new-session creation path, not a screen-mount effect.
  - Long-press retry is user-initiated and therefore separate from the one-shot automatic startup rule.
  - Preserve manual selection as the user's authoritative choice.
  - If database-backed personal gym list work lands before this task, use its repository list APIs instead of route-local seeded state.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend`
- Optional closeout validation helper: `./scripts/task-closeout-check.sh docs/tasks/M15-T07-hidden-gps-gym-ux-correction.md`
- Additional gate(s): `git diff --check`

## Evidence

- UI/UX task visual artifacts note:
  - Maestro smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260524-141934-51434/`
    - recorder screenshot: `apps/mobile/artifacts/maestro/ad-hoc/20260524-141934-51434/maestro-output/screenshots/02-session-recorder-visible.png`
  - Maestro data smoke: `apps/mobile/artifacts/maestro/ad-hoc/20260524-142042-52619/`
  - Maestro auth/profile: `apps/mobile/artifacts/maestro/ad-hoc/20260524-142222-53852/`
- Manual verification summary:
  - Focused RNTL assertions cover quiet startup GPS preselection, startup no-op/null gym, restored-draft no startup detection, `No gym`, long-press retry success/failure, and editor-owned coordinate controls.
  - Runtime evidence came from the required frontend slow gate lanes above. No hosted/deployed smoke was in scope.
- Manual verification summary (required when CI is absent/partial): focused RNTL coverage plus frontend fast/slow local gates passed; CI is `N/A` because the repo has no configured pipeline.
- Deferred/manual hosted checks summary: `N/A`

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: recorder GPS is now quiet assistance with one-shot startup preselection, long-press retry, `No gym`, and editor-owned coordinate controls.
  - Removed the recorder-visible GPS `Detect` button, matched suggestion panel, `Use this gym`, and `Ignore` controls.
  - Added quiet one-shot startup gym preselection for brand-new active sessions and explicit long-press retry from the gym box.
  - Added `No gym` picker/null-state semantics and kept `No gym` out of gym persistence/management.
  - Moved coordinate mutation controls out of Manage and into the single gym editor, while keeping coordinate clearing confirmation-gated.
  - Added opportunistic current-coordinate capture when adding a new gym without blocking gym creation/selection.
  - Updated M15 and UI source-of-truth docs for the corrected GPS/gym UX. `RUNBOOK.md reviewed (no changes required)`.
- What tests ran: focused recorder/submit Jest suites, UI guardrails, typecheck, frontend fast gate, frontend slow gate, and `git diff --check`.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-screen.test.tsx --runInBand`
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-submit.test.tsx --runInBand`
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - `cd apps/mobile && npm run typecheck`
  - `./scripts/quality-fast.sh frontend`
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" ./scripts/quality-slow.sh frontend`
  - `git diff --check`
- What remains: personal database-backed gym-list sync is still a separate planned task; no hosted/deployed checks were required.
  - `docs/tasks/T-20260517-01-personal-gym-list-sync.md` remains planned; this task adapted the current route-local gym list.
  - No hosted/deployed checks were required for this frontend/docs correction.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/`.
- Ensure completion note is filled before handoff.
- Update `docs/specs/milestones/M15-gps-gym-location-support.md` task breakdown/status in the same session.
- Update relevant `docs/specs/ui/*.md` files and keep entries synthetic/overview-first.
- Review `RUNBOOK.md`; update if local operator workflow changes or record `RUNBOOK.md reviewed (no changes required)` in the completion note.
- Run `./scripts/task-closeout-check.sh docs/tasks/M15-T07-hidden-gps-gym-ux-correction.md` or document why `N/A`.
