---
task_id: T-20260624-02-recorder-picker-preselection
milestone_id: "MVP"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md"
---

# Recorder Picker Preselection

## Task metadata

- Task ID: `T-20260624-02-recorder-picker-preselection`
- Title: Recorder Picker Preselection
- Status: `completed`
- Session date: 2026-06-24
- Session interaction mode: `interactive`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: N/A - user-requested UX improvement, no milestone spec.
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`

## Context Freshness

- Verified current branch + HEAD commit: pending at implementation start.
- Start-of-session sync with `origin/main` completed?: pending at implementation start.
- Parent refs opened in planning session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/08-ux-delivery-standard.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/ui/README.md`
  - `docs/specs/ui/screen-map.md`
  - `docs/specs/ui/navigation-contract.md`
  - `docs/specs/ui/ux-rules.md`
  - `docs/specs/templates/task-card-template.md`
- Code/docs inventory freshness checks run:
  - Existing recorder picker selection path reviewed, 2026-06-24.
  - Existing completed-session exercise append repository path reviewed,
    2026-06-24.
  - Existing exercise-block history repository reviewed, 2026-06-24.
- Known stale references or assumptions: none known; re-check source at
  implementation start.

## Objective

Change the recorder exercise picker add flow so selecting an exercise opens an
in-place preselection panel with `Add empty set` and `Append plan`. The suggested
plan comes from completed exercise history and appends planned rows using the
same behavior as existing completed-session block append actions.

## Scope

### In scope

- Apply the preselection flow only when adding a new exercise in the recorder
  picker.
- Keep edit/replace exercise actions direct with no preselection.
- Always show the preselection panel after tapping an add-row exercise.
- Show `Append plan` ghosted/disabled while loading or when no valid historical
  block exists.
- Keep `Add empty set` always available, listed first, and behaviorally identical
  to the current add flow.
- Load a suggested plan from the most recent completed session containing the
  selected exercise, regardless of picker date range.
- If that completed session has multiple blocks of the same exercise, combine
  valid sets from those blocks in session order into one continuous plan.
- Reuse existing completed-session append repository behavior where practical,
  including planned quality.
- Close the picker and scroll/focus the exercise card that receives the appended
  rows.

### Out of scope

- New plan-generation algorithm beyond copying the most recent completed block.
- Editing the preview before append.
- Changing existing completed-session detail append behavior except through
  shared helper extraction if needed.
- Syncing preferences or adding new synced data.

## UI Impact

- UI Impact?: `yes`
- Reuse existing recorder modal, row, button, and planned-set display patterns.
- No raw color literals should be introduced in screen/component `.tsx` files.
- UI docs update is required because recorder picker add semantics change.

## UX Contract

### Key user flows

1. Flow name: Add Empty Exercise
   - Trigger: user opens recorder picker and taps an exercise while adding a new
     exercise.
   - Steps: in-place preselection panel opens; user taps `Add empty set`.
   - Success outcome: picker closes, the exercise is added with one empty set,
     and the first weight input receives focus as today.
   - Failure/edge outcome: if the user changes search text, the preview closes
     and the filtered list returns.
2. Flow name: Append Historical Plan
   - Trigger: user opens recorder picker, taps an exercise with valid completed
     history, and sees the preview panel.
   - Steps: panel shows `From YYYY-MM-DD HH:mm`, continuous set preview rows,
     and user taps `Append plan`.
   - Success outcome: planned rows append using the same semantics as current
     completed-session exercise append, picker closes, and the receiving card is
     scrolled/focused.
   - Failure/edge outcome: `Append plan` stays ghosted/disabled while loading or
     when no valid historical block exists; no error text is shown.
3. Flow name: Dismiss Preview
   - Trigger: preview panel is open.
   - Steps: user taps elsewhere inside the picker window.
   - Success outcome: preview closes and the exercise list returns with the same
     filter/grouping/options state.
   - Failure/edge outcome: tapping outside the picker modal still closes the
     entire picker, preserving current modal behavior.

### Interaction + appearance notes

- Search input remains visible while the preview is open.
- The preview is read-only; users edit, log, or skip rows after appending in the
  recorder.
- Preview should comfortably show about six set rows and scroll for additional
  rows.
- `Add empty set` is listed first but is not visually forced as the only primary
  action.
- Keep recorder picker header actions for Manage and Add new exercise.

## Acceptance criteria

1. Adding a recorder exercise opens preselection instead of immediately adding.
2. Replacing/changing an existing exercise keeps current direct selection
   behavior and does not show preselection.
3. `Add empty set` uses the current behavior: one empty set, picker closes, first
   weight input focused.
4. Creating a new exercise from recorder picker bypasses preselection, selects
   the created exercise, returns to recorder, and adds a blank set.
5. `Append plan` is visible but ghosted/disabled while suggestion data loads.
6. If no valid completed-history block exists, `Append plan` remains ghosted and
   no error text is shown.
7. Suggested source ignores picker/catalog date range and uses completed history
   only.
8. Suggested source excludes active drafts, current session content, and
   unperformed planned rows.
9. Valid suggested sets require non-negative numeric weight and positive integer
   reps; `0kg` is valid.
10. If the latest matching completed session has multiple blocks for the same
    exercise, valid sets are combined in original session order.
11. Preview date uses completed-session `completedAt` and the existing
    exercise-history date-time style, e.g. `2026-06-10 18:42`.
12. Preview rows are numbered continuously after combining blocks.
13. Preview may show historical quality, and append copies quality because it
    uses the same behavior as current append actions.
14. Appending planned rows follows existing append semantics: append to the last
    active exercise card only when it has the same exercise definition;
    otherwise create a new exercise card.
15. After append, the picker closes and the receiving exercise card is
    scrolled/focused.
16. Screen UI uses documented tokens/primitives/shared components for common
    buttons/text/layout/list patterns, or records a justified exception.
17. No raw color literals are introduced in screen files unless explicitly
    allowed by the task and documented with rationale.
18. Relevant `docs/specs/ui/*.md` docs are updated in the same task.

## Docs touched

- `docs/specs/ui/ux-rules.md` - update recorder picker preselection and append
  plan semantics.
- `docs/specs/ui/screen-map.md` - update session-recorder picker state summary.
- `docs/specs/ui/navigation-contract.md` - no update expected because this is
  in-route modal state, not a route transition.
- UI docs update required?: `yes`
- Tokens/primitives compliance statement:
  - Reuse plan: existing recorder modal/list/action styles and ui token colors.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md`: `yes`.
  - Planned captures/artifacts: picker list, preselection with loading/ghosted
    append, preselection with valid preview, and recorder after append.

## Testing and verification approach

- Planned checks/commands:
  - Targeted Jest for suggested block aggregation/filtering.
  - Targeted React Native tests for recorder picker preselection, add empty,
    disabled append, valid append, and replace-without-preselection.
  - `./boga test fast`
  - `./boga test frontend`
- Test layers covered: unit, component interaction, Maestro frontend gate.
- Slow-gate triggers: mobile UI screen/component changes require frontend gate.
- CI/manual posture note: frontend Maestro lanes are local-only and must be run
  locally before PR.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/src/data/session-drafts.ts`
  - `apps/mobile/src/data/exercise-block-history.ts`
  - shared recorder/exercise-list components under `apps/mobile/components/**`
    if needed.
- Project structure impact: no new top-level paths expected.
- Constraints/assumptions:
  - Prefer shared repository logic with existing completed-session append path.
  - Add TODO comments only for future plan-generation refinements where the
    implementation has an obvious extension point.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test frontend`
- Additional gate(s): run `./boga test for` before closeout to confirm required
  lanes from the final diff.

## Evidence

- Targeted Jest for the combined exercise-list/recorder changes passed:
  7 suites, 102 tests.
- `./boga test fast` passed.
- `./boga test backend` passed.
- `./boga test docs-check` passed.
- `./boga test meta-tests` passed.
- `./boga doctor` passed after restarting Docker Desktop.
- `./boga test frontend` passed:
  - `ios-smoke`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151246-13257`
  - `ios-data-smoke`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151334-14376`
  - `ios-auth-profile`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151501-15809`
  - `ios-sync-e2e`: `apps/mobile/artifacts/maestro/ad-hoc/20260624-151648-17338`
- UI/UX task visual artifacts note: Maestro artifacts above cover the required
  simulator interaction evidence for picker preselection and append behavior.
- Manual verification summary:
  - Frontend Maestro lanes were run locally because
  they are local-only.

## Completion note

- What changed: added recorder picker preselection for add-new exercise picks,
  with `Add empty set`, disabled/loading `Append plan`, completed-history plan
  preview, and append semantics shared with existing completed-session block
  append behavior.
- What tests ran: targeted Jest, `./boga test fast`, `./boga test backend`,
  `./boga test docs-check`, `./boga test meta-tests`, `./boga doctor`, and
  `./boga test frontend`.
- What remains: no implementation follow-up for this task.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to
  `docs/tasks/complete/`.
- Fill completion note and evidence.
- Update relevant UI docs.
- Run `./scripts/task-closeout-check.sh <task-card-path>` or document why N/A.
