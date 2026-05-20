---
task_id: T-20260520-01-session-recorder-weight-autofocus
milestone_id: "M1"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/ui/ux-rules.md or none with rationale"
---

# Task Card

## Task metadata

- Task ID: `T-20260520-01-session-recorder-weight-autofocus`
- Title: Focus new set weight input after logging exercise or adding set
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-20`
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
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/session-recorder-weight-autofocus` at `687d246`.
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - fetched `origin/main` on 2026-05-20; branch `codex/session-recorder-weight-autofocus`, local `main`, and `origin/main` were all at `687d24689bbe015035cef5747b49fa550376e6ac` before code edits.
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
  - `docs/specs/milestones/M1-ui-session-recorder.md`
  - `docs/specs/templates/task-card-template.md`
  - `docs/tasks/T-20260516-01-session-recorder-keyboard-avoidance.md`
- Code/docs inventory freshness checks run:
  - `rg` inventory for session-recorder set/add/focus/input paths run against `apps/mobile/app`, `apps/mobile/components`, and `apps/mobile/src`.
  - Source review of `apps/mobile/app/session-recorder.tsx` identified `applySelectedExerciseSelection`, `addSetToExercise`, and set row `TextInput` rendering as the primary implementation points.
  - Source review of `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx` identified existing coverage for adding an exercise, adding a copied set, and validating weight/reps inputs.
  - UI docs review confirmed current set-entry semantics in `docs/specs/ui/ux-rules.md`.
- Known stale references or assumptions:
  - No branch sync/fetch was performed during task-card creation; implementation session must refresh before edits.
  - React Native focus/keyboard behavior should receive manual iOS simulator or device verification because Jest can assert props but not native keyboard presentation.
- Optional helper command (recommended):
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260520-01-session-recorder-weight-autofocus.md`

## Objective

Make set entry faster in the session recorder by automatically focusing the new set's `Weight` input after a new exercise is logged or a new set is added, with any prefilled weight selected so the user can overwrite it immediately.

## Scope

### In scope

- Focus the first set's weight input after adding a new exercise from the recorder exercise picker or inline-created exercise flow.
- Focus the new set's weight input after tapping `Add set`.
- Select any prefilled weight value on focus so copied previous-set values can be overwritten quickly.
- Preserve existing set input validation, previous-set default copying, set type behavior, autosave/structural mutation behavior, and completed-edit behavior.
- Add targeted React Native Testing Library coverage for the focus/selection prop wiring and existing add-set behavior.
- Record manual iOS simulator or device verification at implementation closeout.

### Out of scope

- Data model, persistence, sync, backend, or migration changes.
- Route, query-param, navigation, or completed-session detail behavior changes.
- Broad visual redesign of the recorder or set rows.
- Generic form/input primitive extraction unless it becomes necessary to keep the implementation small and reliable.
- Maestro slow-gate automation for this focus behavior.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale: this changes active session-recorder input focus behavior and native keyboard entry flow, but it does not change route structure, visual hierarchy, or persisted data.

## UX Contract

### Key user flows

1. Flow name: Log an exercise and enter weight immediately
   - Trigger: User opens `Log new exercise` and selects an exercise.
   - Steps: Open `/session-recorder` -> tap `Log new exercise` -> select an exercise -> the new exercise row appears.
   - Success outcome: The first set's `Weight` input is focused, the numeric keyboard opens, and the user can type weight without an extra tap.
   - Failure/edge outcome: If native focus cannot be applied immediately, the row still renders normally and remains manually editable.
2. Flow name: Add a copied set and overwrite weight
   - Trigger: User taps `Add set` on an exercise that already has a completed or partially completed set.
   - Steps: Enter values in set 1 -> tap `Add set` -> the new set copies the previous set values.
   - Success outcome: The new set's `Weight` input is focused, and the copied weight value is selected for quick overwrite.
   - Failure/edge outcome: If the previous set had an empty weight, the empty weight field still receives focus and is ready for entry.

### Interaction + appearance notes

- Keep existing route-local styles, `SessionContentLayout`, and UI tokens; this is an input behavior change, not a redesign.
- Use existing weight input keyboard configuration (`inputMode="decimal"`, `keyboardType="decimal-pad"`).
- Select text on weight-input focus so prefilled copied values can be replaced without manual deletion.
- Do not change reps field focus behavior in this task.
- Do not introduce raw color literals.

## Acceptance criteria

1. Adding a new exercise to the active recorder marks the first set's weight input for focus.
2. Adding a set marks only the newly added set's weight input for focus.
3. Weight inputs select their current value on focus so copied/prefilled weights can be overwritten quickly.
4. Existing repeated-set defaults still copy previous `Weight`, `Reps`, and `Type` values.
5. Existing weight/reps validation behavior remains unchanged.
6. Existing autosave/structural mutation behavior for adding exercises and sets remains unchanged.
7. Completed-edit metadata fields and existing tag/gym/exercise modals are not functionally changed.
8. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
9. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
10. Relevant `docs/specs/ui/*.md` docs are updated in the same task, or explicit no-update rationale is recorded.
11. `docs/specs/ui/navigation-contract.md` is not updated unless routes, params/query behavior, redirects, or transitions change.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/ui/ux-rules.md` - update only if implementation makes auto-focus/select-on-focus a stable recorder set-entry semantic worth documenting alongside current set row rules; otherwise record explicit no-update rationale in the completion note.
  - `RUNBOOK.md` - update only if implementation changes local/manual verification commands or operator workflow.
- UI docs update required?: `maybe`
- UI docs trigger map:
  - `docs/specs/ui/README.md` says UI semantics/pattern expectation changes require `docs/specs/ui/ux-rules.md`.
  - No `screen-map.md` update expected because route purpose/states do not change.
  - No `navigation-contract.md` update expected because route/path/query behavior does not change.
  - No `components-catalog.md` update expected unless a reusable input/focus primitive is introduced.
- Tokens/primitives compliance statement:
  - Reuse plan: existing route styles, `SessionContentLayout`, set row `TextInput` configuration, and UI tokens.
  - Exceptions: none expected; no raw color literals.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts:
    - Manual iOS simulator or device note confirming new exercise weight focus opens the keyboard.
    - Manual iOS simulator or device note confirming copied set weight focus selects the prefilled value.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx`
  - `cd apps/mobile && npm run typecheck`
  - `./scripts/quality-fast.sh frontend`
  - Manual iOS simulator or device check: log a new exercise and add a copied set; verify keyboard opens on `Weight` and copied value is selected.
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` required.
  - `./scripts/quality-slow.sh frontend` not required for this task because no Maestro flow, runtime setup, navigation, persistence, or layout geometry behavior is being changed.
- Test layers covered:
  - React Native Testing Library for add-exercise/add-set interaction assertions and focus/selection prop wiring.
  - TypeScript typecheck for route/component typing.
  - Manual native verification for keyboard pop-up and selection behavior.
- Execution triggers:
  - Always for this task.
- Slow-gate triggers:
  - N/A - slow Maestro coverage is optional unless implementation unexpectedly changes keyboard avoidance, scroll geometry, or route navigation.
- Hosted/deployed smoke ownership:
  - N/A.
- CI/manual posture note:
  - CI is absent/partial; local targeted tests, typecheck, fast gate, and manual native focus verification must be recorded before closeout.
- Notes:
  - Jest can confirm `autoFocus`/`selectTextOnFocus` prop wiring but cannot prove native keyboard presentation.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/session-recorder.tsx`
  - `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`
  - `docs/specs/ui/ux-rules.md` only if documenting the new stable semantic
  - `RUNBOOK.md` only if local verification workflow changes
- Project structure impact:
  - No new paths or conventions expected.
- Constraints/assumptions:
  - No data model or sync impact.
  - "New exercise is logged" means appending a new exercise card from the recorder exercise picker or inline-created exercise, not changing an existing exercise's definition.
  - Selecting prefilled values on manual focus of weight fields is acceptable and matches the desired quick-overwrite behavior.
  - Keep focus state scoped to a pending set id so rerenders do not repeatedly steal focus after the intended field has focused.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `N/A` - no slow/runtime gate required unless implementation scope expands into keyboard avoidance, scroll geometry, navigation, persistence, or Maestro-owned behavior.
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/T-20260520-01-session-recorder-weight-autofocus.md`
- Additional gate(s):
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx`
  - `cd apps/mobile && npm run typecheck`
  - Manual iOS simulator or device focus/keyboard verification for the two UX flows.

## Evidence

- Targeted Jest output:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/session-recorder-interactions.test.tsx` passed (`17` tests).
- Typecheck output:
  - `cd apps/mobile && npm run typecheck` passed.
- Fast gate output:
  - `./scripts/quality-fast.sh frontend` passed (`46` suites, `294` tests; lint had `0` errors and the existing unrelated `10` warnings).
- UI/UX task visual artifacts note:
  - Simulator screenshot captured at `/tmp/boga-weight-autofocus-20260520.png`.
  - Maestro hierarchy after the native probe confirmed the numeric keyboard was visible and `Weight for exercise 1 set 2` had value/text `70`.
- Manual verification summary:
  - Ran a focused native probe on simulator `BOGA wt1` (`8EE7AAC8-0DD9-4EFA-852A-737A7C5746F8`), iOS `26.4`, dev-client app `com.phano.boga3.dev`.
  - Flow: reset data through `boga3://maestro-harness?reset=data&teleport=session-recorder`, opened exercise picker, selected `Barbell Back Squat`, typed `135.5` into the first set without manually tapping the weight field, entered `8` reps, tapped `Add set`, then typed `70` without manually tapping the new weight field.
  - Outcome: first-set autofocus opened the numeric keyboard; second-set autofocus kept the keyboard open; copied second-set weight was replaced with `70` (not appended), while copied reps remained `8`.
- Deferred/manual hosted checks summary:
  - N/A.
- Manual verification summary (required when CI is absent/partial): completed on iOS `26.4` simulator `BOGA wt1`; first-set weight autofocus accepted `135.5`, and copied second-set weight autofocus replaced the copied value with `70` while keyboard stayed open.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: session-recorder set entry now tracks a pending weight set id when logging a new exercise or adding a set, focuses that weight input, and forces the copied value selection range until edit/blur. Weight inputs use `selectTextOnFocus`; repeated-set defaults and existing validation/autosave mutation calls are unchanged. `docs/specs/ui/ux-rules.md` now documents the stable recorder set-entry autofocus/selection semantic.
- What tests ran: targeted interaction Jest suite, `npm run typecheck`, `./scripts/quality-fast.sh frontend`, and a focused native iOS simulator probe with screenshot/hierarchy evidence.
- What remains: no follow-up required for this task. `RUNBOOK.md` reviewed; no local operator workflow changes were needed. No data model, sync, route, component-catalog, screen-map, or navigation-contract updates were needed.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- Update `docs/specs/ui/ux-rules.md` or record explicit no-update rationale.
- Update `docs/specs/ui/navigation-contract.md` only if route/path/query behavior changes.
- Update `RUNBOOK.md` only if local/manual verification workflow changes.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status if the project convention for the chosen milestone requires it.
- Run `./scripts/task-closeout-check.sh docs/tasks/T-20260520-01-session-recorder-weight-autofocus.md` or document why `N/A` before handoff.
