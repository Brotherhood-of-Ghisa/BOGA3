# BoGa Heatmaps — Stats screen integration

Two heatmap views for the muscle/exercise history overlays on the Stats screen.
They replace the older month-grid `CalendarHeatmap`.

| File | What it is |
|------|-----------|
| `heatmap-metric.ts` | Pure, RN-free helpers: `getMetricValue`, `getCalendarHeatmapBucket`, `getCurrentLocalDateKey`, `HEAT_RAMP` (token-driven). |
| `heatmapData.ts`    | `buildHeatmapData(dailyMetrics, metric, opts)` → `HeatmapData` (`{ daily, weekly, todayDateKey }`). Pure adapter; no RN imports. |
| `DailyHeatmap.tsx`  | **Daily** — 7 weekday rows × 52 week columns, one square per day, today anchored right. |
| `WeeklyHeatmap.tsx` | **Weekly** — one bar per week, height = selected-metric value, color = intensity, 12-wk average baseline. |

## Data flow

These components do **not** take raw sessions. The Stats screen fetches the app's
pre-aggregated per-day metrics and feeds them through the adapter:

```ts
import { computeSelectedMuscleDailyEffortMetrics } from '@/src/data';
import { buildHeatmapData } from '@/components/heatmaps';

const dailyMetrics = await computeSelectedMuscleDailyEffortMetrics({ muscleGroupIds, start, end });
// or computeSelectedExerciseDailyEffort({ exerciseDefinitionId, start, end })

const data = buildHeatmapData(dailyMetrics, metric); // metric: 'totalVolume' | 'nearFailureCount' | 'estimatedRM1' | 'highestWeight'
```

`DailyEffortMetrics` (`{ dateKey, totalVolume, nearFailureCount, estimatedRM1,
highestWeight }`) comes from the muscle/exercise analytics in `src/data`; the
weekly effort the same screens already load powers the `WeekSelectionBanner`.
The Muscle History overlay intentionally selects only `nearFailureCount`; the
Exercise History overlay exposes all four metrics.

**Buckets** use max-of-window ratios (`getCalendarHeatmapBucket`), matching the rest
of the stats screen. Volume / near-failure aggregate (sum) per week; 1RM / top weight
are best-of (max).

## Props & selection

Selection is **lifted** to the overlay so the shared `WeekSelectionBanner` shows the
detail. Both components take the same props:

```tsx
<WeeklyHeatmap
  data={data}
  selectedWeekKey={selectedWeekKey}              // string | null
  onSelectWeek={onSelectWeek}                    // (weekStartDateKey | null) => void
  testIDPrefix="stats-muscle-history"            // → "<prefix>-heatmap", "<prefix>-heatmap-cell-<key>"
/>
```

In the daily grid a day tap maps to its Monday `weekStartDateKey` and calls
`onSelectWeek`, so both views drive the same banner. `buildHeatmapData` accepts an
optional `todayDateKey` (`opts.todayDateKey`) as a determinism seam for tests.

## Notes

- **Theme-driven:** colors/space come from `@/components/ui` tokens (`uiColors`,
  including `heatmapBucket1..4`). No hard-coded palette beyond the token ramp.
- **No new dependencies.** Pure RN primitives (`View`, `Text`, `Pressable`).
- **RN ≥ 0.71** for flexbox `gap`. Dashed baseline (Weekly) renders on iOS; some
  Android versions fall back to solid (cosmetic).
