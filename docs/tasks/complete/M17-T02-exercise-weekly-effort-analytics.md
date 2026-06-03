---
task_id: M17-T02-exercise-weekly-effort-analytics
milestone_id: "M17"
status: completed
ui_impact: "no"
areas: "frontend"
runtimes: "expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "none"
---

# M17-T02 — Exercise weekly effort analytics engine

## Task metadata

- Task ID: M17-T02-exercise-weekly-effort-analytics
- Title: New exercise analytics engine with weekly effort aggregation
- Status: `planned`
- File location: `docs/tasks/M17-T02-exercise-weekly-effort-analytics.md`
- Session date: TBD
- Session interaction mode: `non_interactive`
- Required branch: `codex/m17-t02-exercise-weekly-effort-analytics`

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M17-exercise-calendar-heatmap.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Context Freshness

- Verified current branch + HEAD commit: (verify at session start)
- Start-of-session sync completed: (verify at session start)
- Parent refs to open: `docs/specs/milestones/M17-exercise-calendar-heatmap.md`, `apps/mobile/src/data/muscle-analytics.ts`, `apps/mobile/src/data/stats.ts`, `apps/mobile/src/data/index.ts`, `apps/mobile/src/data/schema/`
- Known stale references: none

## Objective

Create `apps/mobile/src/data/exercise-analytics.ts` with a pure aggregation function and a DB-backed repository function for computing exercise-level weekly effort history. Export the public API through `apps/mobile/src/data/index.ts`.

## Scope

### In scope

- `apps/mobile/src/data/exercise-analytics.ts` (new file)
- `apps/mobile/src/data/index.ts` (add exports)
- `apps/mobile/app/__tests__/exercise-analytics.test.ts` (new test file)

### Out of scope

- Modifications to `muscle-analytics.ts`, `stats.ts`, or `CalendarHeatmap`
- UI changes

## UI Impact

- UI Impact?: `no`

## Acceptance criteria

1. `SelectedExerciseWeeklyEffort` type has the same shape as `SelectedMuscleWeeklyEffort`.
2. `aggregateExerciseWeeklyEffort(sessions, timeZone?)` is a pure function (no DB calls).
3. `computeSelectedExerciseWeeklyEffort({ exerciseDefinitionId, start, end, timeZone? })` loads from local SQLite and delegates to the pure function.
4. Warm-up sets (`setType = 'warm_up'`) are excluded from all metrics.
5. `totalVolume` is `weight × reps` (no role weighting).
6. `nearFailureCount` counts sets with `setType` in `{rir_0, rir_1, rir_2}`.
7. `estimatedRM1` is the max Epley estimate across non-warm-up sets in the week.
8. `highestWeight` is the max weight across non-warm-up sets in the week.
9. Weeks start on Monday (UTC). 5th week per month is clipped.
10. `./scripts/quality-fast.sh frontend` passes.

## Docs touched

- `none` — no project-level docs change expected (no new runtime, route, or cross-cutting behavior)

## Testing and verification approach

- Unit tests in `apps/mobile/app/__tests__/exercise-analytics.test.ts`
- Test cases:
  - single session, single working set → correct volume / RM / weight
  - warm-up set excluded
  - two sessions in same week → aggregated into one week entry
  - two sessions in different weeks → two week entries
  - Mon/Sun boundary: session on Sunday vs. Monday
  - `nearFailureCount` for rir_0, rir_1, rir_2 sets
  - empty sessions array → empty result
  - invalid weight/reps → excluded from metrics
  - 5th week of month → clipped
  - multiple months → `weekOfMonth` resets per month

## Implementation notes

### Data flow

```
DB query: sessions (completed, not deleted, in date range)
  → session_exercises (filtered by exerciseDefinitionId)
  → exercise_sets (for those session_exercises)
  → aggregate per local date
  → aggregate per Mon-start week
  → clip 5th week per month
```

### Key reuse points

- `estimateOneRepMax(weight, reps)` from `@/src/exercise-calculations`
- `parseSetWeight(value)` from `@/src/exercise-calculations`
- `parseSetReps(value)` from `@/src/exercise-calculations`
- `bootstrapLocalDataLayer()` from `./bootstrap`
- Drizzle schema tables: `sessions`, `sessionExercises`, `exerciseSets` from `./schema`
- Drizzle operators: `and`, `eq`, `gte`, `inArray`, `isNull`, `lt` from `drizzle-orm`

### Date helpers to implement locally

The following pure helpers from `muscle-analytics.ts` should be duplicated (not imported — they are not exported) in `exercise-analytics.ts`:
- `formatLocalDateKey(date, timeZone?)` — local YYYY-MM-DD from a Date
- `dateKeyToUtcDate(dateKey)` — inverse
- `formatUtcDateKey(date)` — UTC YYYY-MM-DD from a Date
- `startOfMondayWeek(date)` — UTC Monday of the week

### Type contract

```typescript
export type SelectedExerciseWeeklyEffort = {
  weekStartDateKey: string;  // YYYY-MM-DD of Monday (UTC)
  monthKey: string;          // YYYY-MM of weekStart
  weekOfMonth: number;       // 1-4 (5th clipped)
  totalVolume: number;
  nearFailureCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};
```

### Export surface

Add to `apps/mobile/src/data/index.ts`:

```typescript
export {
  aggregateExerciseWeeklyEffort,
  computeSelectedExerciseWeeklyEffort,
  type SelectedExerciseWeeklyEffort,
} from './exercise-analytics';
```

## Mandatory verify gates

- `./scripts/quality-fast.sh frontend`

## Evidence

- Tests pass.
- `./scripts/quality-fast.sh frontend` passes.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed` and move to `docs/tasks/complete/` when done.
- Update milestone task breakdown.
