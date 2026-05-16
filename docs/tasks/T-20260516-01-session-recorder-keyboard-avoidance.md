---
task_id: T-20260516-01-session-recorder-keyboard-avoidance
milestone_id: "M1"
status: planned
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/ui/ux-rules.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260516-01-session-recorder-keyboard-avoidance`
- Title: Fix session recorder keyboard-aware scrolling on iPhone
- Status: `planned`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-16`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M1-ui-session-recorder.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `main` at current session start; fill exact SHA before implementation.
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `no` - planning-only task-card authoring; execution session must sync `main` before edits.
- Parent refs opened in this planning session:
  - `docs/specs/README.md`
  - `docs/specs/00-product.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/04-ai-development-playbook.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/12-worktree-config-and-isolation.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/components-catalog.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - GitHub PR #20 inspected: merged fix `fix(ui): keep session recorder inputs visible above the keyboard` added `KeyboardAvoidingView` wrappers but left iPhone manual checks unchecked.
  - `rg` inventory for `KeyboardAvoidingView`, `ScrollView`, `automaticallyAdjustKeyboardInsets`, keyboard props, and session-recorder inputs run against `apps/mobile/**`.
  - Source review of `apps/mobile/app/session-recorder.tsx`, `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`, `apps/mobile/app/_layout.tsx`, and installed React Native keyboard/scroll-view implementation.
- Known stale references or assumptions:
  - The root cause is currently inferred from code review: the PR #20 root `KeyboardAvoidingView` runs inside a stack screen but does not account for native header height via `keyboardVerticalOffset`, so iOS padding can under-compensate by roughly the header height.
  - Execution must verify on an actual iPhone or iOS simulator because Jest cannot prove native keyboard geometry.
- Optional helper command (recommended):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260516-01-session-recorder-keyboard-avoidance.md`

## Objective

Make the session recorder and completed-edit form usable on iPhone when the soft keyboard is open, with the bottom-most set inputs and completed-edit time inputs scrollable above the keyboard instead of being obscured.

## Scope

### In scope

- Fix the root session-recorder keyboard avoidance/inset behavior introduced in PR #20 so focused `TextInput`s remain reachable on iPhone.
- Account for Expo Router / React Navigation stack header geometry when using `KeyboardAvoidingView`, or replace the current approach with a simpler proven native-scroll strategy if code review/testing shows that is safer.
- Preserve the existing active recorder and completed-edit screen layout, modal semantics, validation behavior, and autosave behavior.
- Add targeted regression coverage for the intended keyboard-aware prop wiring where it is testable in Jest.
- Capture manual iPhone or iOS simulator evidence focusing:
  - the last set's weight/reps inputs in a long active session,
  - completed-edit Start/End time inputs,
  - keyboard-bearing recorder modals that PR #20 touched.

### Out of scope

- Visual redesign of the recorder or modals.
- New data model, persistence, sync, or backend changes.
- Broad primitive extraction such as introducing a generic `ScreenScrollContainer`, unless needed to keep the fix small and reliable.
- Android keyboard behavior changes beyond avoiding regressions.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale: this changes mobile form behavior under the native iOS keyboard for the primary session-recorder route and completed-edit mode.

## UX Contract

### Key user flows

1. Flow name: Edit the bottom set while the iPhone keyboard is open
   - Trigger: User focuses a weight or reps input near the bottom of a long active session.
   - Steps: Open `session-recorder` -> create or load enough exercise/set rows to place an input near the bottom -> tap the bottom-most weight/reps input -> keyboard opens -> user scrolls if needed.
   - Success outcome: The focused input and nearby row controls remain visible above the keyboard and can be edited without dismissing the keyboard.
   - Failure/edge outcome: If the keyboard opens while already scrolled near the bottom, scroll position adjusts without trapping content behind the keyboard or hiding the submit action permanently.
2. Flow name: Edit completed-session timestamps with the keyboard open
   - Trigger: User opens `/session-recorder?mode=completed-edit&sessionId=<id>` and focuses Start or End time.
   - Steps: Focus Start time -> edit -> focus End time -> edit -> scroll as needed.
   - Success outcome: Timestamp inputs and inline validation messages remain reachable above the keyboard.
   - Failure/edge outcome: Invalid timestamp feedback remains visible/scrollable and autosave-paused notice is not obscured.
3. Flow name: Use recorder modals with text fields
   - Trigger: User opens a recorder modal with a text input, such as gym editor, exercise filter, inline exercise create, or tag search/rename.
   - Steps: Open modal -> focus input -> keyboard opens.
   - Success outcome: Modal input and primary modal actions stay visible or scrollable above the keyboard.
   - Failure/edge outcome: Dismissing the modal or keyboard does not leave the modal offset incorrectly.

### Interaction + appearance notes

- Keep existing tokens, route-local styles, and shared components; this is a behavioral layout fix, not a redesign.
- Prefer a single clear keyboard strategy per screen/modal to avoid double-applying keyboard padding and scroll insets.
- Use `keyboardVerticalOffset` when keeping `KeyboardAvoidingView` under a native stack header.
- Preserve `keyboardShouldPersistTaps="handled"` on keyboard-bearing scroll containers.
- Do not introduce raw color literals.

## Acceptance criteria

1. On iPhone or iOS simulator, the bottom-most active-session set weight/reps input is not blocked by the keyboard and remains editable in a long session.
2. On iPhone or iOS simulator, completed-edit Start/End time inputs and their validation/autosave messages remain visible or scrollable above the keyboard.
3. Recorder modals with `TextInput`s still lift or scroll correctly above the keyboard.
4. The fix accounts for the stack header height if a root `KeyboardAvoidingView` remains in `session-recorder`.
5. Avoid duplicate keyboard compensation that causes excessive blank space or jumpy scroll behavior when the keyboard opens/closes.
6. Existing recorder interactions, submit validation, completed-edit autosave, and modal dismissal tests continue to pass.
7. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
8. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
9. Relevant `docs/specs/ui/*.md` docs are updated in the same task, or explicit no-update rationale is recorded.
10. `docs/specs/ui/navigation-contract.md` is updated only if routes, params/query behavior, redirects, or transitions change.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/ui/ux-rules.md` - document the session-recorder keyboard-aware form expectation if it becomes a stable UI semantic.
  - `RUNBOOK.md` - update only if the implementation adds or changes local/manual iPhone or Maestro verification commands.
- UI docs update required?: `yes`
- UI docs trigger map:
  - `docs/specs/ui/README.md` says UI semantics/pattern expectations changes require `docs/specs/ui/ux-rules.md`.
  - No `screen-map.md` update expected unless the task changes recorder state inventory.
  - No `navigation-contract.md` update expected unless route/path/query behavior changes.
  - No `components-catalog.md` update expected unless a reusable keyboard-aware primitive is added.
- Tokens/primitives compliance statement:
  - Reuse plan: existing route styles, `SessionContentLayout`, `ExerciseEditorModal`, and UI tokens.
  - Exceptions: none expected; no raw color literals.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts:
    - iPhone or iOS simulator screenshot/video showing bottom active-session set input visible above keyboard.
    - iPhone or iOS simulator screenshot/video showing completed-edit timestamp input visible above keyboard.
    - Screenshot/video or concise manual evidence for at least one keyboard-bearing recorder modal.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-screen.test.tsx app/__tests__/session-recorder-interactions.test.tsx app/__tests__/session-recorder-submit.test.tsx`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend` if the task adds Maestro coverage or if native iOS simulator evidence is captured through the standard slow lane.
  - Manual iPhone or iOS simulator keyboard verification for the three UX flows above.
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` required.
  - `./scripts/quality-slow.sh frontend` required unless replaced with a narrower documented iOS simulator/manual verification path that captures equivalent keyboard evidence.
- Test layers covered:
  - React Native Testing Library for prop wiring/regression where possible.
  - Native iOS simulator or physical iPhone manual/runtime evidence for keyboard geometry.
- Execution triggers:
  - Always for this task.
- Slow-gate triggers:
  - Required because the bug is native keyboard/runtime-sensitive and PR #20 failed despite Jest/typecheck passing.
- Hosted/deployed smoke ownership:
  - N/A.
- CI/manual posture note:
  - CI is absent/partial; manual iPhone or iOS simulator evidence is mandatory before closeout.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/session-recorder.tsx`
  - `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx` if modal keyboard behavior needs adjustment
  - `apps/mobile/app/__tests__/session-recorder-screen.test.tsx`
  - `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`
  - `apps/mobile/app/__tests__/session-recorder-submit.test.tsx`
  - `docs/specs/ui/ux-rules.md`
  - `RUNBOOK.md` only if verification commands/workflow change
- Project structure impact:
  - No new paths or conventions expected.
- Constraints/assumptions:
  - No data model or sync impact.
  - Current suspected root cause from PR #20 review: root `KeyboardAvoidingView` uses `behavior="padding"` with no `keyboardVerticalOffset` even though the route sits below a stack header. `useHeaderHeight()` from `@react-navigation/elements` is already available transitively and can provide the header offset if this approach is kept.
  - Avoid relying solely on `automaticallyAdjustKeyboardInsets` plus `KeyboardAvoidingView` if runtime testing shows double compensation or unstable scroll behavior.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend` or documented narrower iOS simulator/manual keyboard evidence with rationale.
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260516-01-session-recorder-keyboard-avoidance.md`
- Additional gate(s):
  - Targeted Jest command listed above.
  - Manual iPhone or iOS simulator keyboard verification for active recorder, completed-edit, and one keyboard-bearing modal.

## Evidence

- Targeted Jest output:
  - Fill at implementation closeout.
- Fast gate output:
  - Fill at implementation closeout.
- Slow/native runtime evidence:
  - Fill at implementation closeout with screenshot/video paths or a concise manual iPhone verification note.
- UI/UX task visual artifacts note:
  - Required; attach or reference captures that show focused inputs above the keyboard.
- Manual verification summary:
  - Required because the previous PR merged without completing the manual iPhone checks and the bug remained reproducible.
- Deferred/manual hosted checks summary:
  - N/A.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed:
- What tests ran:
- What remains:

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- Update `docs/specs/ui/ux-rules.md` or record explicit no-update rationale.
- Update `docs/specs/ui/navigation-contract.md` only if route/path/query behavior changes.
- Update `RUNBOOK.md` only if local/manual verification workflow changes.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status if the project convention for the chosen milestone requires it.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260516-01-session-recorder-keyboard-avoidance.md` or document why `N/A` before handoff.
