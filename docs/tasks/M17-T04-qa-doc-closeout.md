---
task_id: M17-T04-qa-doc-closeout
milestone_id: "M17"
status: planned
ui_impact: "yes"
areas: "docs,frontend"
runtimes: "docs,expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "./scripts/quality-slow.sh frontend"
docs_touched: "docs/specs/milestones/M17-exercise-calendar-heatmap.md"
---

# M17-T04 — QA, visual evidence and doc closeout

## Task metadata

- Task ID: M17-T04-qa-doc-closeout
- Title: QA, visual evidence capture, and milestone closeout
- Status: `planned`
- File location: `docs/tasks/M17-T04-qa-doc-closeout.md`
- Session date: TBD
- Session interaction mode: `interactive`
- Required branch: `codex/m17-t04-qa-doc-closeout`
- Depends on: M17-T02 and M17-T03 merged

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M17-exercise-calendar-heatmap.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`

## Context Freshness

- Verified current branch + HEAD commit: (verify at session start; T02 and T03 must be merged)
- Parent refs to open: milestone spec, `docs/specs/08-ux-delivery-standard.md`
- Known stale references: none

## Objective

Run final integration/visual QA on the M17 exercise calendar heatmap feature, capture required evidence, update milestone docs, and close the milestone.

## Scope

### In scope

- `./scripts/quality-slow.sh frontend` gate
- Screenshot/visual evidence capture (simulator or device)
- `docs/specs/milestones/M17-exercise-calendar-heatmap.md` status and completion note
- Move completed task cards to `docs/tasks/complete/`

### Out of scope

- Code changes (if QA fails, open a new fix task)

## UI Impact

- UI Impact?: `yes`

## Acceptance criteria

1. `./scripts/quality-slow.sh frontend` passes.
2. Screenshots captured: populated exercise heatmap, empty history state, week selected state, error state.
3. Milestone `Status` updated to `completed`.
4. All T01–T04 task cards moved to `docs/tasks/complete/`.
5. Milestone task breakdown reflects final states.

## Docs touched

- `docs/specs/milestones/M17-exercise-calendar-heatmap.md` — completion note + status → `completed`

## Testing and verification approach

- `./scripts/quality-slow.sh frontend`
- Manual device/simulator test: open Stats/History, tap Heatmap, tap an exercise, verify heatmap, switch metrics, tap week, dismiss overlay

## Mandatory verify gates

- `./scripts/quality-slow.sh frontend`

## Evidence

- Screenshot: exercise list in Heatmap mode
- Screenshot: `ExerciseHistoryOverlay` populated with heatmap
- Screenshot: empty state (exercise with no history)
- Screenshot: week selected state (banner shows date range + value)

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed` and move to `docs/tasks/complete/`.
- Update milestone `Status` to `completed`.
- Move all M17 task cards to `docs/tasks/complete/`.
