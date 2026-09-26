# BoGa Heatmaps — Progress history integration

Two heatmap views for the exercise and muscle history sheets on Progress
(`components/stats/history-sheet.tsx`). They replace the older month-grid
`CalendarHeatmap`. Semantics: `docs/specs/ui/ux-rules.md` §11.

| File | What it is |
|------|-----------|
| `heatmap-metric.ts` | Pure, RN-free helpers: `getMetricValue`, `getCalendarHeatmapBucket`, `getCurrentLocalDateKey`, `HEAT_RAMP` (the `viz0`…`viz4` roles). |
| `heatmapData.ts`    | `buildHeatmapData(dailyMetrics, metric, opts)` → `HeatmapData` (`{ daily, weekly, todayDateKey }`). Pure adapter; no RN imports. |
| `heatmap-style.ts`  | The shared look: the `ink` today / selected marks (`HEAT_MARK`) and the title, caption and micro-label styles. |
| `HeatmapLegend.tsx` | The metric legend and the Less…More ramp under both views. |
| `DailyHeatmap.tsx`  | **Daily** — 7 weekday rows × one column per week, one square per day, today at the right; owns its day selection and detail card. |
| `WeeklyHeatmap.tsx` | **Weekly** — one bar per week, height and colour = the selected metric, 12-wk average baseline; selection lifted to the host. |

## Data flow

These components do **not** take raw sessions. The history sheet fetches the
app's pre-aggregated per-day metrics and feeds them through the adapter:

```ts
import { computeSelectedMuscleDailyEffortMetrics } from '@/src/data';
import { buildHeatmapData } from '@/components/heatmaps';

const dailyMetrics = await computeSelectedMuscleDailyEffortMetrics({ muscleGroupIds, start, end });
// or computeSelectedExerciseDailyEffort({ exerciseDefinitionId, start, end })

const data = buildHeatmapData(dailyMetrics, metric, { weeks: 'all' });
// metric: 'totalVolume' | 'workingSetCount' | 'estimatedRM1' | 'highestWeight'
```

`DailyEffortMetrics` (`{ dateKey, totalVolume, workingSetCount, estimatedRM1,
highestWeight }`) comes from the muscle/exercise analytics in `src/data`; the
weekly effort the same screen already loads powers the sheet's week banner.
Muscle history offers per-side, role-weighted `totalVolume` and
`workingSetCount`; exercise history offers all four metrics with entered-load
semantics.

**Buckets** are min–max over the window (`getCalendarHeatmapBucket`): the
smallest positive value is bucket 1, the largest bucket 4, and zero is 0 (rest).
Volume / working sets aggregate (sum) per week; 1RM / top weight are best-of
(max). The weekly bar heights use the same min–max band.

## Props & selection

The two views select differently:

```tsx
<DailyHeatmap
  data={data}
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap", "<prefix>-heatmap-cell-<dateKey>"
  metricLabel="Volume"                  // the day detail's "<metric>: <value>"
  formatValue={(v) => String(v)}
  legendLabel="Volume per day"
/>

<WeeklyHeatmap
  data={data}
  selectedWeekKey={selectedWeekKey}     // string | null
  onSelectWeek={onSelectWeek}           // (weekStartDateKey | null) => void
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap-cell-<weekStartDateKey>", "-bar-<key>"
/>
```

- **Daily** keeps its own selection: it starts on today, and a tap selects that
  day and shows the detail card (`<prefix>-heatmap-day-detail`). It does not
  call the host.
- **Weekly** lifts selection to the host, so the sheet's week banner can show
  the week's value. A second tap on the selected week clears it.

`buildHeatmapData` accepts an optional `todayDateKey` (`opts.todayDateKey`) as a
determinism seam for tests.

## Look

- **Design language only** (`docs/specs/ui/design-language.md` §2): cells and
  bars on `HEAT_RAMP` (`uiRoles.viz0`…`viz4`); an empty day is `viz0` with a
  `rule` hairline. No legacy palette and no hard-coded colours.
- **Today and selected differ** (DLM-T09-D3): today (the current week) is a 1px
  `ink` ring, the selected cell a 2px `ink` border with the selected
  accessibility state; the selected week also gets a filled `ink` caret.
  `app/__tests__/heatmap-marks.test.tsx` holds this.
- **Warm switching:** the history sheet keeps both views mounted. Its inactive
  layer is transparent, non-interactive, and hidden from accessibility, avoiding
  a one-year chart rebuild on every toggle while preserving view-local selection
  and scroll state.
- **No new dependencies.** Pure RN primitives (`View`, `Text`, `Pressable`,
  `ScrollView`) and the `Icon` / `Card` primitives.
- The weekly 12-wk average is drawn as discrete dash segments (a zero-height
  dashed border renders unreliably on iOS).
