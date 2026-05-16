---
task_id: T-20260516-02-exercise-editor-keyboard-muscle-selector
milestone_id: "M6"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/ui/ux-rules.md, RUNBOOK.md"
---

# Task Card

## Task metadata

- Task ID: `T-20260516-02-exercise-editor-keyboard-muscle-selector`
- Title: Fix iOS keyboard overlap in exercise editor muscle selector
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: `2026-05-16`
- Session interaction mode: `interactive (default)`

## Parent references (required)

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M6-exercise-taxonomy-and-muscle-analytics-foundation.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI route semantics: `docs/specs/ui/ux-rules.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- Runbook: `RUNBOOK.md`

## Context Freshness (required at session start; update before edits)

- Verified current branch + HEAD commit: `codex/T-20260516-02` at `5dda6ad4bf8ac2c05d4495fd80323dd9c688667b` before implementation edits.
- Start-of-session sync completed per `docs/specs/04-ai-development-playbook.md` git sync workflow?: `yes` - fetched `origin` and confirmed `origin/main` matched local `HEAD` before edits.
- Parent refs opened in this execution session:
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
  - `docs/specs/milestones/M6-exercise-taxonomy-and-muscle-analytics-foundation.md`
  - `RUNBOOK.md`
- Code/docs inventory freshness checks run:
  - `rg` inventory for `KeyboardAvoidingView`, `ScrollView`, `automaticallyAdjustKeyboardInsets`, `keyboardShouldPersistTaps`, exercise editor, and muscle selector usage under `apps/mobile/**`.
  - Source review of `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`, `apps/mobile/app/exercise-catalog.tsx`, `apps/mobile/app/session-recorder.tsx`, and related UI tests.
  - Existing active task card `docs/tasks/T-20260516-01-session-recorder-keyboard-avoidance.md` reviewed to avoid duplicating the broader recorder keyboard task.
  - `./scripts/task-bootstrap.sh docs/tasks/T-20260516-02-exercise-editor-keyboard-muscle-selector.md`
  - `git fetch origin`; `origin/main` and local `HEAD` both resolved to `5dda6ad4bf8ac2c05d4495fd80323dd9c688667b`.
- Known stale references or assumptions:
  - None remaining for this task. The stale Expo dev-launcher blocker was resolved by using the current `boga3://maestro-harness` scheme in the task-specific Maestro flows.
  - This card is related to, but narrower than, `docs/tasks/T-20260516-01-session-recorder-keyboard-avoidance.md`; no overlapping recorder screen edits were made.

## Objective

Fix the shared exercise editor so iOS users can open and fully scroll the primary/secondary muscle selector while the keyboard is involved. The immediate reported failure is that the keyboard overlaps the selector in the exercise editor, preventing access to all muscle groups.

## Scope

### In scope

- Fix `ExerciseEditorModal` keyboard behavior for both entry points:
  - `exercise-catalog` create/edit flow.
  - `session-recorder` inline `Add new` exercise flow.
- Ensure opening the primary or secondary muscle selector does not leave the exercise-name keyboard blocking selector content.
- Make the muscle selector list resilient on iOS by adding keyboard-aware scroll insets and/or bottom padding where appropriate.
- Preserve existing create/edit validation, save behavior, duplicate muscle prevention, and selected-primary/secondary exclusion rules.
- Add focused regression coverage for keyboard-aware selector wiring where it is testable.
- Capture manual or Maestro iOS evidence that the last muscle-group option is reachable with the keyboard initially opened by the exercise-name field.

### Out of scope

- Redesigning the exercise editor UI.
- Changing exercise/muscle data model semantics, weights, roles, persistence, sync, or seed data.
- Broad modal primitive extraction unless it is the smallest safe way to share the fix.
- Fixing every keyboard-bearing recorder screen; broader recorder keyboard issues are tracked separately by `T-20260516-01-session-recorder-keyboard-avoidance`.
- Android-specific behavior changes beyond avoiding regressions.

## UI Impact (required checkpoint)

- UI Impact?: `yes`
- Rationale: this changes native mobile interaction behavior for a user-facing form modal and its nested muscle selector overlay.

## UX Contract

### Key user flows

1. Flow name: Select primary muscle after typing an exercise name
   - Trigger: User opens `Create Exercise` or `Edit Exercise`; the exercise-name input auto-focuses and the iOS keyboard opens.
   - Steps: Type an exercise name -> tap `Primary muscle` -> scroll the selector to the bottom -> select any muscle group.
   - Success outcome: The selector opens in a usable state, all muscle groups are reachable, and selected value returns to the editor.
   - Failure/edge outcome: If the keyboard was open before the selector, it is dismissed or accounted for without leaving selector rows hidden behind it.
2. Flow name: Add secondary muscle after typing an exercise name
   - Trigger: User opens the exercise editor with the keyboard open and taps `Add secondary muscle`.
   - Steps: Type or edit the exercise name -> tap `Add secondary muscle` -> scroll to the last available muscle group -> select one.
   - Success outcome: The user can reach every available secondary option and the chosen secondary row appears in the editor.
   - Failure/edge outcome: Already-selected primary and secondary muscles remain excluded from the selector, with no keyboard-related scroll trap.
3. Flow name: Create an exercise inline from the recorder
   - Trigger: User opens `session-recorder` -> `Log new exercise` -> inline `+`.
   - Steps: Type a custom exercise name -> open primary muscle selector -> choose a muscle -> save.
   - Success outcome: The editor works the same inside the recorder as it does in the catalog, and the new exercise is logged into the session.
   - Failure/edge outcome: Closing the selector or editor returns to the prior modal/screen state without stale keyboard offset or hidden controls.

### Interaction + appearance notes

- Prefer dismissing the keyboard before opening a non-text selector overlay.
- Add keyboard-aware scroll support to the selector as a defense against iOS timing/layout edge cases.
- Keep the existing modal visual design, token usage, labels, validation text, and action semantics.
- Preserve `keyboardShouldPersistTaps="handled"` on scroll containers that include pressable rows.
- Do not introduce raw color literals.

## Acceptance criteria

1. On iPhone or iOS simulator, after the exercise-name field auto-focuses, opening `Primary muscle` allows scrolling to and selecting the last muscle group.
2. On iPhone or iOS simulator, after the exercise-name field auto-focuses, opening `Add secondary muscle` allows scrolling to and selecting the last available secondary muscle.
3. The same behavior works from `exercise-catalog` and from `session-recorder` inline exercise creation.
4. The implementation prevents the keyboard from obscuring the selector by dismissing it before opening the selector and/or making the selector `ScrollView` keyboard-inset aware.
5. Existing create/edit validation remains intact:
   - exercise name is required,
   - primary muscle is required,
   - duplicate secondary links are prevented,
   - selected primary is excluded from secondary options.
6. Existing tests for exercise catalog and recorder inline creation continue to pass.
7. Add at least one targeted Jest assertion for the new keyboard/selector behavior that can be verified without native keyboard geometry.
8. Screen/component UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
9. No raw color literals are introduced in screen/component files unless explicitly allowed by the task and documented with rationale.
10. Relevant `docs/specs/ui/*.md` docs are updated in the same task, or explicit no-update rationale is recorded.
11. `docs/specs/ui/navigation-contract.md` is updated only if routes, params/query behavior, redirects, or transitions change.

## Docs touched (required)

- Planned docs/spec files to update and why:
  - `docs/specs/ui/ux-rules.md` - document the exercise editor keyboard-aware selector expectation if the fix becomes a stable UI semantic.
  - `docs/specs/ui/components-catalog.md` - update only if `ExerciseEditorModal`'s reusable component contract materially changes.
  - `RUNBOOK.md` - update only if new local/manual iOS verification commands or workflow become canonical.
- For significant cross-cutting behavior changes:
  - N/A expected; this is a UI behavior fix with no architecture, data-model, sync, backend, or project-structure change.
- UI docs update required?: `yes`
- UI docs trigger map:
  - `docs/specs/ui/README.md` says UI semantics/pattern expectation changes require `docs/specs/ui/ux-rules.md`.
  - No `screen-map.md` update expected unless the task changes route states.
  - No `navigation-contract.md` update expected unless route/path/query behavior changes.
  - No `components-catalog.md` update expected unless the reusable `ExerciseEditorModal` contract changes.
- Tokens/primitives compliance statement:
  - Reuse plan: keep existing `ExerciseEditorModal`, route entry points, `uiColors`, and current modal/list styles.
  - Exceptions: none expected; no raw color literals.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`
  - Planned captures/artifacts:
    - iOS simulator or physical iPhone capture showing primary muscle selector scrolled to the last option after keyboard was opened by exercise-name auto-focus.
    - iOS simulator or physical iPhone capture showing secondary muscle selector scrolled to the last available option after keyboard was opened by exercise-name auto-focus.
    - Recorder inline create capture or concise manual evidence confirming parity.

## Testing and verification approach

- Planned checks/commands:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-catalog-screen.test.tsx app/__tests__/session-recorder-interactions.test.tsx`
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - `./scripts/quality-fast.sh frontend`
  - `./scripts/quality-slow.sh frontend` if the implementation adds Maestro coverage or uses the standard simulator lane for runtime evidence.
  - Manual iOS simulator or physical iPhone verification for the UX flows above.
- Standard local gate usage:
  - `./scripts/quality-fast.sh frontend` required.
  - `./scripts/quality-slow.sh frontend` required unless replaced with narrower documented iOS simulator/manual evidence that directly proves the keyboard/muscle-selector behavior.
- Test layers covered:
  - React Native Testing Library for selector behavior and prop wiring.
  - Native iOS simulator or physical iPhone manual/runtime evidence for keyboard geometry.
- Execution triggers:
  - Always for this task.
- Slow-gate triggers:
  - Required or explicitly replaced because this is native keyboard/runtime-sensitive and cannot be fully proven in Jest.
- Hosted/deployed smoke ownership:
  - N/A.
- CI/manual posture note:
  - CI is absent/partial; manual iOS evidence is mandatory before closeout.
- Notes:
  - Jest can verify that selector-opening handlers dismiss the keyboard and that selector scroll containers receive keyboard-aware props, but not the actual screen geometry.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`
  - `apps/mobile/app/__tests__/exercise-catalog-screen.test.tsx`
  - `apps/mobile/app/__tests__/session-recorder-interactions.test.tsx`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/ui/components-catalog.md` only if reusable component contract changes
  - `RUNBOOK.md` only if verification workflow changes
- Project structure impact:
  - No new paths or conventions expected.
- Constraints/assumptions:
  - No data model or sync impact.
  - The suspected root cause is in `ExerciseEditorModal`: `TextInput` has `autoFocus`, selector buttons open a non-text overlay without dismissing the keyboard, and the selector overlay is absolutely positioned with a fixed-height card plus a `ScrollView` that does not adjust keyboard insets.
  - Prefer the smallest safe fix: dismiss keyboard before opening selectors, then add selector scroll inset/padding if runtime evidence shows it is still needed.
  - Coordinate with `T-20260516-01-session-recorder-keyboard-avoidance` if both tasks edit `session-recorder.tsx` or shared modal patterns in the same worktree.

## Mandatory verify gates

- Standard local fast gate: `./scripts/quality-fast.sh frontend`
- Standard local slow gate: `./scripts/quality-slow.sh frontend` or documented narrower iOS simulator/manual keyboard evidence with rationale.
- Optional closeout validation helper:
  - `./scripts/task-closeout-check.sh docs/tasks/complete/T-20260516-02-exercise-editor-keyboard-muscle-selector.md`
- Additional gate(s):
  - Targeted Jest command listed above.
  - Manual iOS simulator or physical iPhone keyboard verification for catalog create/edit and recorder inline create.

## Evidence

- Targeted Jest output:
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-catalog-screen.test.tsx app/__tests__/session-recorder-interactions.test.tsx` - passed (`2` suites, `24` tests).
- UI guardrail output:
  - `cd apps/mobile && npm run lint:ui-guardrails` - passed (`0` violations).
- Fast gate output:
  - `./scripts/quality-fast.sh frontend` - passed (`lint`, `typecheck`, `test`; existing lint warnings only, `42` Jest suites / `246` tests passed).
- Slow/native runtime evidence:
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260516-02 MAESTRO_RESET_STRATEGY=data ./scripts/maestro-ios-run-flow.sh --flow /tmp/boga-maestro/t-20260516-02-catalog-selector.yaml --scenario t-20260516-02-catalog-selector` - passed (`1` flow, `0` failures); artifact root: `apps/mobile/artifacts/maestro/T-20260516-02/20260516-220949-24816/`.
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260516-02 MAESTRO_RESET_STRATEGY=data ./scripts/maestro-ios-run-flow.sh --flow /tmp/boga-maestro/t-20260516-02-recorder-selector.yaml --scenario t-20260516-02-recorder-selector` - passed (`1` flow, `0` failures); artifact root: `apps/mobile/artifacts/maestro/T-20260516-02/20260516-220816-23920/`.
- UI/UX task visual artifacts note:
  - Catalog primary selector scrolled to bottom after name input opened keyboard: `apps/mobile/artifacts/maestro/T-20260516-02/20260516-220949-24816/maestro-output/screenshots/01-catalog-primary-calves-visible-after-keyboard.png`.
  - Catalog secondary selector scrolled to the last available secondary after name input opened keyboard and `Calves` was selected as primary: `apps/mobile/artifacts/maestro/T-20260516-02/20260516-220949-24816/maestro-output/screenshots/02-catalog-secondary-adductors-visible-after-keyboard.png`.
  - Recorder inline create primary selector scrolled to bottom after name input opened keyboard: `apps/mobile/artifacts/maestro/T-20260516-02/20260516-220816-23920/maestro-output/screenshots/01-recorder-inline-primary-calves-visible-after-keyboard.png`.
- Manual verification summary:
  - Native iOS proof completed through Maestro on simulator `BOGA wt1` (`8EE7AAC8-0DD9-4EFA-852A-737A7C5746F8`) using the Expo dev-client runtime on port `8083`.
  - The catalog flow typed in the auto-focused exercise-name input, opened the primary selector, scrolled to `Calves`, selected it, opened the secondary selector, and scrolled to `Adductors` as the last available secondary option.
  - The recorder inline flow typed in the auto-focused exercise-name input, opened the primary selector from `Log new exercise` -> inline create, and scrolled to `Calves`.
- Manual verification summary (required when CI is absent/partial): completed; native iOS keyboard/selector evidence is captured in the passing `boga3://maestro-harness` task flows above.
- Deferred/manual hosted checks summary:
  - N/A.

## Completion note (fill at end per `docs/specs/04-ai-development-playbook.md`)

- What changed: implemented the shared exercise editor keyboard/selector fix and documented the stable UI semantic.
  - Implemented the shared `ExerciseEditorModal` fix: opening primary/secondary muscle selectors now dismisses the text keyboard, and the selector list uses keyboard-aware scroll props plus extra bottom padding.
  - Added stable non-visual test IDs for the editor name field, selector triggers, selector list, and muscle option rows to support regression tests and deterministic Maestro/manual verification.
  - Added focused Jest coverage that verifies keyboard dismissal and keyboard-aware selector scroll wiring.
  - Updated `docs/specs/ui/ux-rules.md` with the stable exercise editor keyboard-aware selector expectation.
  - Updated `RUNBOOK.md` with the Homebrew OpenJDK env needed when Maestro cannot locate Java.
- What tests ran: targeted Jest, UI guardrails, the frontend fast gate, and task-specific native Maestro selector flows passed.
  - `cd apps/mobile && npm test -- --runTestsByPath app/__tests__/exercise-catalog-screen.test.tsx app/__tests__/session-recorder-interactions.test.tsx`
  - `cd apps/mobile && npm run lint:ui-guardrails`
  - `./scripts/quality-fast.sh frontend`
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260516-02 MAESTRO_RESET_STRATEGY=data ./scripts/maestro-ios-run-flow.sh --flow /tmp/boga-maestro/t-20260516-02-catalog-selector.yaml --scenario t-20260516-02-catalog-selector`
  - `PATH="/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH" JAVA_HOME="/opt/homebrew/opt/openjdk" TASK_ID=T-20260516-02 MAESTRO_RESET_STRATEGY=data ./scripts/maestro-ios-run-flow.sh --flow /tmp/boga-maestro/t-20260516-02-recorder-selector.yaml --scenario t-20260516-02-recorder-selector`
- What remains: no task-specific follow-up remains.
  - Parent milestone `M6` now references this post-completion UI fix as completed with native iOS selector evidence.

## Status update checklist (mandatory at closeout)

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Ensure completion note is filled before handoff.
- Update `docs/specs/ui/ux-rules.md` or record explicit no-update rationale.
- Update `docs/specs/ui/components-catalog.md` only if reusable component contract changes.
- Update `docs/specs/ui/navigation-contract.md` only if route/path/query behavior changes.
- Update `RUNBOOK.md` only if local/manual verification workflow changes.
- If significant project-structure changes were made, update `docs/specs/09-project-structure.md` and mention it in completion note.
- Update parent milestone task breakdown/status if the project convention for the chosen milestone requires it.
- Run `./scripts/task-closeout-check.sh docs/tasks/complete/T-20260516-02-exercise-editor-keyboard-muscle-selector.md` or document why `N/A` before handoff.
