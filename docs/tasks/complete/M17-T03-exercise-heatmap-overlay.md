---
task_id: M17-T03-exercise-heatmap-overlay
milestone_id: "M17"
status: completed
ui_impact: "yes"
areas: "frontend"
runtimes: "expo"
gates_fast: "./scripts/quality-fast.sh frontend"
gates_slow: "N/A"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/ux-rules.md, docs/specs/ui/components-catalog.md"
---

# M17-T03 — Exercise heatmap overlay

## Task metadata

- Task ID: M17-T03-exercise-heatmap-overlay
- Title: Heatmap mode chip, exercise list, and ExerciseHistoryOverlay in stats-history.tsx
- Status: `planned`
- File location: `docs/tasks/M17-T03-exercise-heatmap-overlay.md`
- Session date: TBD
- Session interaction mode: `non_interactive`
- Required branch: `codex/m17-t03-exercise-heatmap-overlay`
- Depends on: M17-T02 merged

## Parent references

- Project directives: `docs/specs/README.md`
- Milestone spec: `docs/specs/milestones/M17-exercise-calendar-heatmap.md`
- UX standard: `docs/specs/08-ux-delivery-standard.md`
- UI docs bundle index: `docs/specs/ui/README.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- UI components catalog: `docs/specs/ui/components-catalog.md`
- UX rules: `docs/specs/ui/ux-rules.md`
- Architecture: `docs/specs/03-technical-architecture.md`

## Context Freshness

- Verified current branch + HEAD commit: (verify at session start; M17-T02 must be merged)
- Parent refs to open: `docs/specs/milestones/M17-exercise-calendar-heatmap.md`, `apps/mobile/app/(tabs)/stats-history.tsx`, `apps/mobile/src/data/index.ts` (post-T02), `apps/mobile/src/exercise-catalog/cache.ts`, `apps/mobile/src/exercise-catalog/stats-cache.ts`, `apps/mobile/components/muscle-analytics/calendar-heatmap.tsx`
- Known stale references: none

## Objective

Add a **Heatmap** mode to the `Stats / History` screen: a chip that switches the body from the muscle stats table to a flat exercise list, and an `ExerciseHistoryOverlay` that shows the `CalendarHeatmap` for the selected exercise.

## Scope

### In scope

- `apps/mobile/app/(tabs)/stats-history.tsx` (add viewMode, exercise list, overlay)
- `apps/mobile/app/__tests__/stats-screen.test.tsx` (add integration tests)
- `docs/specs/ui/screen-map.md` (update)
- `docs/specs/ui/ux-rules.md` (update)
- `docs/specs/ui/components-catalog.md` (confirm `CalendarHeatmap` entry)

### Out of scope

- `apps/mobile/components/muscle-analytics/calendar-heatmap.tsx` — no changes
- `apps/mobile/src/data/muscle-analytics.ts` — no changes
- New routes or navigation params

## UI Impact

- UI Impact?: `yes`

## UX Contract

### Key user flows

1. Enter Heatmap mode:
   - Trigger: tap **Heatmap** chip on `Stats / History`
   - Steps: viewMode switches to `'heatmap'`; exercise list appears below the period chips; muscle family cards are hidden
   - Success: exercise list visible, sorted by all-time session count descending, each row shows name + sessions + volume + 1RM
   - Failure/edge: if no exercises trained, show empty state panel

2. Open exercise overlay:
   - Trigger: tap an exercise row in Heatmap mode
   - Steps: `ExerciseHistoryOverlay` renders on top; calls `computeSelectedExerciseWeeklyEffort`; shows loading state while fetching
   - Success: overlay title = exercise name; `CalendarHeatmap` shows 365-day history; metric chips switch intensity
   - Failure/edge: network/DB error → error state inside overlay

3. Dismiss overlay:
   - Trigger: tap backdrop or close button
   - Steps: overlay disappears; exercise list remains visible
   - Success: back to exercise list in Heatmap mode

4. Return to Muscle stats mode:
   - Trigger: tap period chip (Last 7 days / Last 30 days) while in Heatmap mode, OR implement explicit back — simplest: selecting a period chip resets viewMode to `'stats'`
   - Success: muscle family cards visible again

### Interaction + appearance notes

- The **Heatmap** chip is a separate pressable row below the period SegmentedChips; it acts as a mode toggle.
- When `viewMode === 'heatmap'` the chip has a selected/active visual state (use `uiColors.actionPrimaryBg` or equivalent token for pressed/active state — do not use raw literals).
- Overlay card: same styles as `MuscleHistoryOverlay` (`overlayRoot`, `overlayBackdrop`, `overlayCard`, etc.).
- Exercise list rows: use `styles.familyCard`-like cards or a simpler flat-list item pattern consistent with existing list styles.
- No raw color literals in `.tsx` files.

## Acceptance criteria

1. Tapping the Heatmap chip switches the body to the exercise list without navigating away.
2. Exercise list is sorted by all-time session count descending; shows session count, volume, and 1RM per row.
3. Tapping an exercise opens the `ExerciseHistoryOverlay`.
4. Overlay renders `CalendarHeatmap` unmodified with data from `computeSelectedExerciseWeeklyEffort`.
5. Metric chips (Volume / Near failure / 1RM / Top weight) update the heatmap intensity.
6. Week selection banner updates on cell tap.
7. Loading, error, and empty states are handled in the overlay.
8. Backdrop press dismisses the overlay.
9. No raw color literals introduced.
10. UI docs updated (`screen-map.md`, `ux-rules.md`, `components-catalog.md`).
11. `./scripts/quality-fast.sh frontend` passes.

## Docs touched

- `docs/specs/ui/screen-map.md` — add Heatmap viewMode state and exercise overlay state for `Stats / History`
- `docs/specs/ui/ux-rules.md` — Heatmap chip as mode switch, exercise overlay semantics
- `docs/specs/ui/components-catalog.md` — confirm `CalendarHeatmap` is documented as general-purpose; note `ExerciseHistoryOverlay` is screen-local (no entry needed)

Tokens/primitives compliance statement:
- Reuse: `uiColors`, `uiSpace`, `uiBorder` tokens; `SegmentedChips`, `CalendarHeatmap`, overlay card styles copied from existing `MuscleHistoryOverlay` in same file.
- Exceptions: none planned.

UI artifacts/screenshots expectation:
- Required by `docs/specs/08-ux-delivery-standard.md`?: deferred to T04 (QA task).

## Testing and verification approach

- Add to `apps/mobile/app/__tests__/stats-screen.test.tsx`:
  - Heatmap chip is rendered
  - Pressing Heatmap chip shows exercise list
  - Exercise list renders exercise rows
  - Pressing an exercise row opens the overlay
  - Overlay shows loading state
  - Overlay shows populated state with CalendarHeatmap
  - Overlay shows error state
  - Overlay shows empty state (no history)
  - Pressing backdrop dismisses overlay
  - Metric chip selection is reflected
  - Week selection updates banner

## Implementation notes

### State added to `StatsRoute` (default export)

```typescript
const [viewMode, setViewMode] = useState<'stats' | 'heatmap'>('stats');
const [selectedExercise, setSelectedExercise] = useState<ExerciseHeatmapTarget | null>(null);
const [exerciseHistoryWeeklyEffort, setExerciseHistoryWeeklyEffort] = useState<SelectedExerciseWeeklyEffort[]>([]);
const [isExerciseHistoryLoading, setIsExerciseHistoryLoading] = useState(false);
const [exerciseHistoryErrorMessage, setExerciseHistoryErrorMessage] = useState<string | null>(null);
const [selectedExerciseHistoryWeekKey, setSelectedExerciseHistoryWeekKey] = useState<string | null>(null);
const [exerciseHistoryMetric, setExerciseHistoryMetric] = useState<CalendarHeatmapMetric>('totalVolume');
const exerciseHistoryRequestIdRef = useRef(0);
```

### New type

```typescript
export type ExerciseHeatmapTarget = {
  exerciseDefinitionId: string;
  displayName: string;
};
```

### Hooks added to `StatsRoute`

```typescript
const catalogSnapshot = useExerciseCatalog();
const statsSnapshot = useExerciseCatalogStats('all');
```

Both hooks are already used in `exercise-catalog.tsx` so the pattern is proven.

### Exercise list data

```typescript
const exerciseListItems = useMemo(() => {
  const { exercises } = catalogSnapshot;
  const { aggregatesById, everDoneIds } = statsSnapshot;
  return exercises
    .filter((ex) => everDoneIds.has(ex.id))
    .map((ex) => ({
      id: ex.id,
      name: ex.name,
      aggregate: aggregatesById.get(ex.id) ?? null,
    }))
    .sort((a, b) => (b.aggregate?.sessionCount ?? 0) - (a.aggregate?.sessionCount ?? 0));
}, [catalogSnapshot, statsSnapshot]);
```

### History window

```typescript
const EXERCISE_HISTORY_WINDOW_DAYS = 365;
```

### Imports to add

```typescript
import { computeSelectedExerciseWeeklyEffort, type SelectedExerciseWeeklyEffort } from '@/src/data';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseCatalogStats } from '@/src/exercise-catalog/stats-cache';
```

### Shell component changes

Pass the new props into `StatsScreenShell` via `shellProps` and render:
- the Heatmap chip (or a separate row in the screen header area)
- `ExerciseListView` when `viewMode === 'heatmap'`
- `ExerciseHistoryOverlay` when `selectedExercise !== null`

## Mandatory verify gates

- `./scripts/quality-fast.sh frontend`

## Evidence

- `./scripts/quality-fast.sh frontend` passes.
- Screenshots: deferred to T04.

## Completion note

- What changed:
- What tests ran:
- What remains:

## Status update checklist

- Update `Status` to `completed` and move to `docs/tasks/complete/` when done.
- Update milestone task breakdown.
- Update UI docs in the same session.
