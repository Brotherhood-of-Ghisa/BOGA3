---
task_id: M19-T04-Update_per_side_muscle_analytics
milestone_id: "M19"
status: completed
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|docs"
gates_fast: "./boga test fast"
gates_slow: "N/A"
docs_touched: "docs/specs/05-data-model.md"
---

# M19-T04-Update_per_side_muscle_analytics

## Task metadata

- Task ID: M19-T04-Update_per_side_muscle_analytics
- Title: Update per-side muscle analytics
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
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: authored on `codex/m19-load-mode` from `origin/main` at `ec88290`; verify current branch and HEAD during implementation kickoff.
- Start-of-session sync with `origin/main` completed?: `yes` for card authoring; branch was created from `origin/main` on 2026-07-22. Reverify before edits.
- Parent refs opened in this session:
  - `docs/specs/02-quality-and-test-gates.md`
  - `docs/specs/03-technical-architecture.md`
  - `docs/specs/05-data-model.md`
  - `docs/specs/06-testing-strategy.md`
  - `docs/specs/09-project-structure.md`
  - `docs/specs/milestones/M19-per-side-muscle-volume.md`
- Code/docs inventory freshness checks run:
  - `rg -n "MuscleAnalytics|muscleAnalytics|stats|exercise_muscle_mappings|weight_value" apps/mobile/src apps/mobile/app/__tests__` - rerun during task kickoff and inspect exact hits.
  - `rg --files apps/mobile | rg 'muscle-analytics|stats|exercise-history|exercise-analytics'` - candidate analytics files listed on 2026-07-22.
- Known stale references or assumptions: current aggregation behavior must be confirmed before edits; do not assume line-level details from card authoring.
- Optional helper command:
  - `./scripts/task-bootstrap.sh docs/tasks/M19-T04-Update_per_side_muscle_analytics.md`

## Objective

Update muscle-level analytics so every completed set contributes per-side
volume using resolved exercise load-entry semantics and
`exercise_muscle_mappings.weight`, while exercise-level history and record
panels keep entered-load semantics.

## Scope

### In scope

- Resolve each set's exercise `loadInputMode` for muscle analytics.
- Compute per-side muscle base volume as:
  - `weight * reps / 2` when mode is `total_load`
  - `weight * reps` when mode is `per_side_load`
- Apply `exercise_muscle_mappings.weight` after the per-side base volume is computed.
- Keep null-role and stabilizer mappings excluded from muscle volume totals unless the current source-of-truth says otherwise.
- Recompute existing completed history from current exercise metadata.
- Add tests for the barbell bench, dumbbell bench, combined chest, single-dumbbell pullover, one-arm row, secondary mapping weight, and stabilizer/null exclusion examples.

### Out of scope

- Persisting left/right side values.
- Adding per-set load-mode overrides.
- Changing per-exercise volume, highest-weight, estimated 1RM, or current-session record calculations.
- Adding UI controls or labels.
- Changing sync wire/schema beyond consuming the field created by `M19-T02`.

## UI Impact

- UI Impact?: `no`
- This task changes analytics data returned to screens; it must not change UI layout or copy.

## Acceptance criteria

1. Barbell bench `45 kg x 1` with primary chest mapping contributes `22.5` per-side chest volume.
2. Two-dumbbell bench `22 kg x 1` with primary chest mapping contributes `22` per-side chest volume.
3. Combining those sets reports `44.5` per-side chest volume.
4. Single-dumbbell two-arm pullover `22 kg x 1` resolves as `total_load` and contributes `11` per side before mapping weight.
5. One-arm dumbbell row `22 kg x 1` resolves as `per_side_load` and contributes `22` to each side in v1.
6. Secondary mappings multiply the per-side base by `exercise_muscle_mappings.weight`.
7. Existing per-exercise history and record tests continue to prove entered-load volume.

## Docs touched

- Planned docs/spec files to update and why:
  - `docs/specs/05-data-model.md` - document muscle analytics calculation if this task makes the formula source-of-truth.
  - `docs/specs/06-testing-strategy.md` - update only if a new required analytics test layer or fixture convention is added.

## Testing and verification approach

- Planned checks/commands:
  - `./boga test fast`
  - `./boga test for --diff <range>`
- Test layers covered: analytics unit tests, stats repository tests, history/regression tests for entered-load volume preservation.
- Execution triggers: always before task closeout.
- Slow-gate triggers: `N/A` unless analytics changes reach UI behavior that `./boga test for` routes to frontend.
- Hosted/deployed smoke ownership: `N/A`; no backend deployment occurs.
- CI/manual posture note: local fast gate is required and must include the targeted analytics tests.

## Implementation notes

- Planned files/areas allowed to change:
  - `apps/mobile/src/data/muscle-analytics.ts`
  - `apps/mobile/src/data/stats.ts`
  - `apps/mobile/src/data/exercise-history.ts` only if it feeds muscle analytics inputs
  - `apps/mobile/app/__tests__/muscle-analytics.test.ts`
  - `apps/mobile/app/__tests__/stats-repository.test.ts`
  - targeted history tests needed to preserve entered-load display semantics
- Project structure impact: none planned.
- Constraints/assumptions: v1 treats one-arm/one-leg exercise rows as both sides performed equally.

## Mandatory verify gates

- Standard local fast gate: `./boga test fast`
- Standard local slow gate: `N/A` unless `./boga test for --diff <range>` requires one.
- Additional gate(s), if any: follow `./boga test for --diff <range>`.

## Evidence

- Implementation and contract evidence is captured in the M19 source, test, migration, and spec diff.
- Manual verification summary (required when CI is absent/partial): exercised the shipped behavior through Jest, local Supabase contracts, and the iOS Maestro frontend lane.

## Completion note

- What changed: completed this task's M19 deliverables and updated the corresponding source-of-truth contracts.
- What tests ran: `./boga test fast`, `./boga test backend`, and `./boga test frontend` passed for the integrated milestone.
- What remains: nothing for M19; future left/right tracking and per-set overrides remain explicitly out of scope.

## Status update checklist

- Update `Status` to `completed`, `blocked`, or `outdated`.
- If `Status = completed` or `outdated`, move the task card to `docs/tasks/complete/` and update affected references in the same session.
- Update parent milestone task breakdown/status in the same session.
- Run `./scripts/task-closeout-check.sh docs/tasks/M19-T04-Update_per_side_muscle_analytics.md` or document why `N/A`.
