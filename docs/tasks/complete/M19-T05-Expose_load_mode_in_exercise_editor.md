---
task_id: M19-T05-Expose_load_mode_in_exercise_editor
milestone_id: "M19"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/README.md, docs/specs/ui/screen-map.md"
---

# M19-T05-Expose_load_mode_in_exercise_editor

## Task metadata

- Task ID: M19-T05-Expose_load_mode_in_exercise_editor
- Title: Expose load mode in exercise editor
- Status: `completed`
- File location rule:
  - author active cards in `docs/tasks/<task-id>.md`
  - move the file to `docs/tasks/complete/<task-id>.md` when `Status` becomes `completed` or `outdated`
- Session date: 2026-07-22
- Session interaction mode: `interactive (default)`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Quality gates: `docs/specs/02-quality-and-test-gates.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: authored on `codex/m19-load-mode` from `origin/main` at `ec88290`; verify current branch and HEAD during implementation kickoff.
- Start-of-session sync with `origin/main` completed?: `yes` for card authoring; branch was created from `origin/main` on 2026-07-22. Reverify before edits.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
  - `docs/specs/ui/README.md`
- Code/docs inventory freshness checks run:
  - `rg -n "ExerciseEditorModal|exercise-catalog|loadInputMode|exercise definition" apps/mobile/components apps/mobile/app apps/mobile/src` - rerun during task kickoff and inspect exact hits.
  - `rg --files apps/mobile | rg 'exercise-catalog|exercise-editor|catalog'` - candidate editor and catalog files listed on 2026-07-22.
- Known stale references or assumptions: exact shared UI primitives must be verified against the current UI docs and source before implementation.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T05-Expose_load_mode_in_exercise_editor.md`

## Objective

Add a visible exercise-editor control for load-entry semantics so custom
exercises can be saved as either total-load or per-side-load movements.

## Scope

### In scope

- Add a load-entry mode control to the exercise editor using existing UI primitives.
- Support create and edit flows for custom exercise definitions.
- Persist `loadInputMode` through the existing exercise-definition save path.
- Provide clear option labels that map to the stored values:
  - `total_load` means entered weight is total shared load.
  - `per_side_load` means entered weight is already one side/hand/stack/working limb.
- Include unit/interaction tests proving the selected mode is loaded, changed, and saved.
- Update UI docs if the editor contract or screen inventory changes.

### Out of scope

- Changing session recorder set-row labels; `M19-T06` owns recorder copy.
- Changing analytics math; `M19-T04` owns computation.
- Adding per-set overrides or left/right tracking.
- Inferring a default from the exercise name or equipment text.

## UI Impact

- UI Impact?: `yes`
- This task changes a user-facing editor modal and must satisfy the UI delivery standard.

## UX Contract

### Key user flows

1. Create custom exercise with total load:
   - Trigger: user opens the exercise editor for a new exercise.
   - Steps: user enters required exercise details and selects the total-load option.
   - Success outcome: saved exercise stores `loadInputMode = total_load`.
   - Failure/edge outcome: validation errors use the existing editor error pattern and do not clear the selected mode.
2. Edit custom exercise to per-side load:
   - Trigger: user opens an existing custom exercise.
   - Steps: current mode is preselected; user changes it to per-side load and saves.
   - Success outcome: exercise metadata updates and future muscle analytics recompute from the new mode.
   - Failure/edge outcome: save failure keeps the modal state visible with existing error handling.

### Interaction + appearance notes

- Prefer an existing segmented/toggle control pattern if present; otherwise use the nearest documented shared button/list primitive.
- Keep labels short and concrete: `kg total` and `kg per side` are the canonical concepts.
- Do not add instructional paragraphs inside the modal.
- Preserve existing editor density and scrolling behavior on mobile.

## Acceptance criteria

1. New custom exercises can be saved with `total_load` or `per_side_load`.
2. Editing an existing custom exercise preselects the current stored `loadInputMode`.
3. Changing the editor control updates the persisted exercise definition and marks it dirty for sync if the existing save path syncs custom exercise edits.
4. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
5. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
6. Relevant `docs/specs/ui/*.md` docs are updated in the same task, or explicit no-update rationale is recorded.
7. `docs/specs/ui/navigation-contract.md` is updated if routes, params/query behavior, redirects, or transitions change.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/ui/README.md` - inspect maintenance trigger map during implementation.
  - `docs/specs/ui/screen-map.md` - update if exercise editor behavior inventory is documented there.
  - `docs/specs/ui/components-catalog.md` - update if a reusable load-mode control is introduced or an existing component contract changes.
  - `docs/specs/05-data-model.md` - update only if editor behavior changes persisted data semantics beyond `M19-T02`.
- UI docs update required?: `yes` if the editor modal behavior contract is documented; otherwise record a no-update rationale during closeout.
- Tokens/primitives compliance statement:
  - Reuse plan: existing exercise editor modal layout, typography, form field, and button primitives.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`.
  - Planned captures/artifacts: exercise editor modal on create and edit paths, including both selected modes when practical.
  - If not required, why optional/non-blocking here: N/A.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test frontend`
  - `./boga test for --diff <range>`
- Test layers covered: component/screen interaction tests and Maestro frontend gate for real-device UI behavior.
- Execution triggers: always before task closeout.
- Slow-gate triggers: UI screen/component changes require the frontend gate.
- Hosted/deployed smoke ownership: `N/A`; no backend deployment occurs.
- CI/manual posture note: frontend Maestro gate is local-only and must be run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/components/exercise-catalog/exercise-editor-modal.tsx`
  - `apps/mobile/app/(tabs)/exercise-catalog.tsx`
  - `apps/mobile/app/(tabs)/session-recorder.tsx` only if it embeds the same editor save path
  - `apps/mobile/src/data/exercise-catalog.ts`
  - targeted tests under `apps/mobile/app/__tests__/`
  - relevant `docs/specs/ui/*.md`
- Project structure impact: none planned.
- Constraints/assumptions: the control edits exercise-level semantics only; no per-set override is introduced.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test frontend`
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Implementation and contract evidence is captured in the M19 source, test, migration, and spec diff.
- UI/UX task visual artifacts note: the passing frontend lane captured simulator artifacts under `apps/mobile/artifacts/maestro/ad-hoc/20260722-223927-42726/`; focused editor state assertions live in `exercise-catalog-screen.test.tsx`.
- Manual verification summary (required when CI is absent/partial): exercised the shipped behavior through Jest, local Supabase contracts, and the iOS Maestro frontend lane.

## Completion note

- What changed: completed this task's M19 deliverables and updated the corresponding source-of-truth contracts.
- What tests ran: `./boga test fast`, `./boga test backend`, and `./boga test frontend` passed for the integrated milestone.
- What remains: nothing for M19; future left/right tracking and per-set overrides remain explicitly out of scope.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T05-Expose_load_mode_in_exercise_editor.md` or document why `N/A`.
