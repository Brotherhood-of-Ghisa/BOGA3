# M17 - Exercise Calendar Heatmap

## Milestone metadata

- Milestone ID: `M17`
- Title: Exercise calendar heatmap
- Status: `in_progress`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`
- Worktree/runtime isolation: `docs/specs/12-worktree-config-and-isolation.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- Human run/test/debug guide: `RUNBOOK.md`
- Prior art: `docs/specs/milestones/M16-muscle-group-calendar-heatmap.md`

## Milestone objective

Reuse the M16 muscle-group calendar heatmap infrastructure to display per-exercise weekly effort history. A user opens the `Stats / History` screen, taps the **Heatmap** mode button, browses a list of exercises they have trained, taps one, and sees the same calendar heatmap overlay — weekly cells colored green by intensity — filtered to that specific exercise.

The M17 feature must not modify the M16 muscle analytics engine or the `CalendarHeatmap` component. It introduces a separate exercise analytics module that follows the same aggregation contract (Mon-start weeks, 4 weeks per month, same metric set) and wires a new overlay into the existing `Stats / History` screen.

## Product / UX contract

### Heatmap mode entry

- Trigger: user taps the **Heatmap** chip on the `Stats / History` screen.
- Steps:
  - the period chip row (Last 7 days / Last 30 days) remains visible;
  - below it, an exercise list replaces the muscle family cards;
  - the list is flat (not grouped), ordered by all-time session count descending;
  - each row shows the exercise name, session count, volume, and estimated 1RM.
- Success outcome: user sees a scrollable list of exercises they have trained.
- Failure/edge: if no exercises have been trained, show a clear empty state.

### Exercise overlay flow

- Trigger: user taps an exercise row in Heatmap mode.
- Steps:
  - the app shows the `ExerciseHistoryOverlay` — a card occupying ~75% of screen height;
  - the overlay title shows the exercise name;
  - the metric chips (Volume / Near failure / 1RM / Top weight) let the user switch what drives cell intensity;
  - the `CalendarHeatmap` component renders the 365-day history for that exercise;
  - tapping a week cell updates the week-selection banner.
- Success outcome: exercise heatmap is visible with correct intensities; metric switch recalculates bucket colors.
- Failure/edge: loading / error / empty states are visible; backdrop press dismisses the overlay.

### Overlay behavior

- Card occupies ~75% of screen height (identical to muscle overlay).
- Tapping outside the card (backdrop) dismisses it.
- Internal content scrolls vertically.
- Dismissing the overlay returns to the exercise list in Heatmap mode.

## In scope

- New `apps/mobile/src/data/exercise-analytics.ts` module with pure aggregation logic and DB-backed repository function.
- New `SelectedExerciseWeeklyEffort` type (same shape as `SelectedMuscleWeeklyEffort`; the `CalendarHeatmap` accepts it as-is).
- Export of the new public API surface through `apps/mobile/src/data/index.ts`.
- Heatmap mode chip and exercise list view in `apps/mobile/app/(tabs)/stats-history.tsx`.
- `ExerciseHistoryOverlay` component (local to `stats-history.tsx`) reusing `CalendarHeatmap` and the same overlay card structure as `MuscleHistoryOverlay`.
- Unit tests for the exercise analytics engine (weekly aggregation, Mon-start boundary, empty history, warm-up exclusion, metric calculations).
- Integration tests for the new overlay/mode in the existing `stats-screen.test.tsx`.
- UI docs updates for the new viewMode and overlay.

## Out of scope

- Modifications to `CalendarHeatmap`, `muscle-analytics.ts`, or `stats.ts`.
- New database schema changes.
- Backend, Supabase, or sync changes.
- Cross-exercise comparison views.
- Animations.
- Certification display.

## Data model / sync impact

`out of sync scope`. No new user-authored data, durable preferences, or backend projections. The exercise heatmap is a read-only derived view over existing synced/local entities.

## Analytics contract

### Exercise volume

Exercise volume is `weight × reps` (raw set volume, no muscle-role weighting). Warm-up sets (`setType = 'warm_up'`) are excluded, matching the existing Stats behavior.

### Metrics

Same four metrics as the muscle heatmap:

| Metric | Aggregation |
|--------|-------------|
| `totalVolume` | Sum of `weight × reps` across non-warm-up sets in the week |
| `nearFailureCount` | Count of sets with `setType` in `{rir_0, rir_1, rir_2}` |
| `estimatedRM1` | Max Epley one-rep-max estimate across non-warm-up sets |
| `highestWeight` | Max weight across non-warm-up sets |

### Weekly bucketing

Same contract as M16:
- Mon-start weeks (UTC-based).
- 4 weeks per month; 5th week clipped.
- `weekStartDateKey` as `YYYY-MM-DD` of the Monday.
- 365-day history window.

## Deliverables

1. `apps/mobile/src/data/exercise-analytics.ts` — analytics engine + repository function.
2. Updated `apps/mobile/src/data/index.ts` — exports new public API.
3. Updated `apps/mobile/app/(tabs)/stats-history.tsx` — Heatmap mode chip, exercise list, `ExerciseHistoryOverlay`.
4. Unit tests for exercise analytics engine.
5. Integration tests for Heatmap mode and overlay.
6. Updated UI docs.

## Acceptance criteria

1. Tapping the Heatmap chip on `Stats / History` switches the body to the exercise list without leaving the screen.
2. The exercise list is sorted by all-time session count descending and shows session count, volume, and 1RM per row.
3. Tapping an exercise opens the `ExerciseHistoryOverlay` with the calendar heatmap for that exercise.
4. The `CalendarHeatmap` component is used unmodified; no changes to M16 component or muscle analytics files.
5. Metric chips (Volume / Near failure / 1RM / Top weight) recalculate heatmap intensity correctly.
6. Week selection banner updates on cell tap.
7. Loading / error / empty states are handled in the overlay.
8. Backdrop press dismisses the overlay and returns to the exercise list.
9. No raw color literals in screen or component `.tsx` files.
10. No backend/sync/data-model change introduced.
11. `./scripts/quality-fast.sh frontend` passes.

## Task breakdown

1. `docs/tasks/complete/M17-T01-exercise-heatmap-milestone-spec.md` - create milestone spec and task cards. (`completed`)
2. `docs/tasks/complete/M17-T02-exercise-weekly-effort-analytics.md` - new exercise analytics engine + exports + unit tests. (`completed`)
3. `docs/tasks/complete/M17-T03-exercise-heatmap-overlay.md` - Heatmap mode chip, exercise list, and overlay in stats-history.tsx + integration tests + UI docs. (`completed`)
4. `docs/tasks/M17-T04-qa-doc-closeout.md` - QA, visual evidence, doc closeout. (`planned`)

## Dependencies and parallelization

- T01 must land first.
- T02 (analytics) and T03 (UI) are sequential: T03 imports the API from T02.
- T04 depends on T02 and T03.

Suggested branch names:

- `codex/m17-t02-exercise-weekly-effort-analytics`
- `codex/m17-t03-exercise-heatmap-overlay`
- `codex/m17-t04-qa-doc-closeout`

## Testing / verification expectations

Default local fast gate:

```bash
./scripts/quality-fast.sh frontend
```

Required test coverage:

- Exercise weekly aggregation: multiple sessions same week, Mon-start boundary, empty history.
- Warm-up set exclusion and invalid set handling.
- `nearFailureCount`, `estimatedRM1`, `highestWeight` aggregation correctness.
- Heatmap mode chip switches viewMode.
- Exercise list renders with exercises from catalog stats.
- Tap on exercise opens overlay.
- Overlay loading / error / empty / populated states.
- Metric switch recalculates displayed bucket.
- Week selection banner updates on cell tap.
- Backdrop press dismisses overlay.

Slow gate (`./scripts/quality-slow.sh frontend`) is not mandatory per task but required for T04 milestone closeout.

## Docs maintenance expectations

- `docs/specs/ui/screen-map.md` — new Heatmap viewMode and exercise overlay state on `Stats / History`.
- `docs/specs/ui/ux-rules.md` — Heatmap chip as a mode switch, exercise overlay semantics.
- `docs/specs/ui/components-catalog.md` — confirm `CalendarHeatmap` is documented as general-purpose; no new component to add (ExerciseHistoryOverlay is screen-local).

## Risks / open questions

- The exercise list uses `useExerciseCatalog()` (names) + `useExerciseCatalogStats('all')` (counts). Both are already cached by the exercise catalog screen; no extra loading on `Stats / History` unless cache is cold.
- The 365-day exercise history window mirrors M16. Aggregating a full year of sets for one exercise should be fast enough on local SQLite; no cap needed for v1.
- Exercises without an `exerciseDefinitionId` (session-local exercises) will not appear in the heatmap list since the catalog cache only includes definition-linked exercises.

## Completion note

- What changed:
- Verification summary:
- What remains:

## Status update checklist

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state.
- Move completed task cards to `docs/tasks/complete/` and update references here.
