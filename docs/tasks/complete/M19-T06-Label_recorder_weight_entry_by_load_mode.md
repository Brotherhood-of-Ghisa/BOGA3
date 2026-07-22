---
task_id: M19-T06-Label_recorder_weight_entry_by_load_mode
milestone_id: "M19"
status: completed
ui_impact: "yes"
areas: "frontend|docs"
runtimes: "node|expo|maestro|docs"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/README.md, docs/specs/ui/screen-map.md"
---

# M19-T06-Label_recorder_weight_entry_by_load_mode

## Task metadata

- Task ID: M19-T06-Label_recorder_weight_entry_by_load_mode
- Title: Label recorder weight entry by load mode
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
  - `rg -n "weightValue|weight_value|Weight|session-recorder|record" apps/mobile/app apps/mobile/components apps/mobile/src` - rerun during task kickoff and inspect exact hits.
  - `rg --files apps/mobile | rg 'session-recorder|exercise-history|stats|record'` - candidate recorder/history files listed on 2026-07-22.
- Known stale references or assumptions: recorder internals may be large and actively changed; inspect current user/session changes before editing.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T06-Label_recorder_weight_entry_by_load_mode.md`

## Objective

Make session recorder weight-entry labels reflect the selected exercise's
resolved load-entry mode, without changing the saved set weight scalar or
entered-load record displays.

## Scope

### In scope

- Resolve the selected exercise's `loadInputMode` inside the recorder UI.
- Label weight entry as `kg total` for `total_load` exercises.
- Label weight entry as `kg per side` for `per_side_load` exercises.
- Preserve existing set save payloads and entered weight values.
- Preserve current-session record, per-exercise history, highest-weight, and estimated 1RM displays as entered-load semantics.
- Add tests for total-load, per-side-load, and fallback/unknown exercise behavior.

### Out of scope

- Adding the editor control; `M19-T05` owns that.
- Changing muscle analytics calculations; `M19-T04` owns that.
- Adding per-set load-mode overrides.
- Changing import contracts or historical set values.

## UI Impact

- UI Impact?: `yes`
- This task changes visible recorder labels in a high-frequency logging workflow.

## UX Contract

### Key user flows

1. Log total-load exercise:
   - Trigger: user adds or opens a `total_load` exercise in the recorder.
   - Steps: user enters set weight and reps.
   - Success outcome: the weight field label indicates `kg total`; saved value is the entered scalar.
   - Failure/edge outcome: missing exercise metadata falls back to the existing neutral label without blocking set entry.
2. Log per-side-load exercise:
   - Trigger: user adds or opens a `per_side_load` exercise in the recorder.
   - Steps: user enters set weight and reps.
   - Success outcome: the weight field label indicates `kg per side`; saved value is the entered scalar.
   - Failure/edge outcome: existing validation errors remain unchanged.

### Interaction + appearance notes

- Keep the set-row layout stable; labels must not resize or shift row controls while editing.
- Use the shortest clear copy available: `kg total` and `kg per side`.
- Do not add explanatory helper text to every row.
- Preserve existing keyboard and numeric input behavior.

## Acceptance criteria

1. Recorder weight labels derive from the exercise's resolved `loadInputMode`.
2. `total_load` exercises show `kg total`.
3. `per_side_load` exercises show `kg per side`.
4. Saved `exercise_sets.weight_value` remains exactly the user-entered scalar.
5. Current-session record and exercise-history volume displays remain entered-load volume.
6. Screen UI uses documented tokens/primitives/shared components for common buttons/text/layout/list patterns, or records a justified exception.
7. No raw color literals are introduced in screen files unless explicitly allowed by the task and documented with rationale.
8. Relevant `docs/specs/ui/*.md` docs are updated in the same task, or explicit no-update rationale is recorded.
9. `docs/specs/ui/navigation-contract.md` is updated if routes, params/query behavior, redirects, or transitions change.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/ui/README.md` - inspect maintenance trigger map during implementation.
  - `docs/specs/ui/screen-map.md` - update if recorder field behavior is documented there.
  - `docs/specs/ui/components-catalog.md` - update if a reusable set-row/input label contract changes.
  - `docs/specs/05-data-model.md` - update only if recorder copy creates or clarifies data semantics.
- UI docs update required?: `yes` if recorder field behavior is documented; otherwise record a no-update rationale during closeout.
- Tokens/primitives compliance statement:
  - Reuse plan: existing session recorder set-row layout, form inputs, typography, and validation primitives.
  - Exceptions: none planned.
- UI artifacts/screenshots expectation:
  - Required by `docs/specs/08-ux-delivery-standard.md` or task scope?: `yes`.
  - Planned captures/artifacts: session recorder showing a total-load exercise row and a per-side-load exercise row.
  - If not required, why optional/non-blocking here: N/A.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test frontend`
  - `./boga test for --diff <range>`
- Test layers covered: recorder interaction tests and Maestro frontend gate.
- Execution triggers: always before task closeout.
- Slow-gate triggers: recorder UI changes require the frontend gate.
- Hosted/deployed smoke ownership: `N/A`; no backend deployment occurs.
- CI/manual posture note: frontend Maestro gate is local-only and must be run on this machine.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/app/(tabs)/session-recorder.tsx`
  - `apps/mobile/components/session-recorder/**`
  - `apps/mobile/src/data/exercise-catalog.ts` only if recorder needs a query/projection helper
  - targeted tests under `apps/mobile/app/__tests__/`
  - relevant `docs/specs/ui/*.md`
- Project structure impact: none planned.
- Constraints/assumptions: labels communicate entry semantics only; analytics owns conversion.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `./boga test frontend`
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Implementation and contract evidence is captured in the M19 source, test, migration, and spec diff.
- UI/UX task visual artifacts note: the passing frontend lane captured simulator artifacts under `apps/mobile/artifacts/maestro/ad-hoc/20260722-224049-44558/`; focused row-label assertions live in `session-recorder-interactions.test.tsx`.
- Manual verification summary (required when CI is absent/partial): exercised the shipped behavior through Jest, local Supabase contracts, and the iOS Maestro frontend lane.

## Completion note

- What changed: completed this task's M19 deliverables and updated the corresponding source-of-truth contracts.
- What tests ran: `./boga test fast`, `./boga test backend`, and `./boga test frontend` passed for the integrated milestone.
- What remains: nothing for M19; future left/right tracking and per-set overrides remain explicitly out of scope.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T06-Label_recorder_weight_entry_by_load_mode.md` or document why `N/A`.
