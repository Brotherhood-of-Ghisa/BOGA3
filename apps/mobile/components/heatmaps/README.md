# BoGa Heatmaps — Progress history integration

Two heatmap views for the exercise and muscle history sheets on Progress
(`components/stats/history-sheet.tsx`). They replace the older month-grid
`CalendarHeatmap`.

| File | What it is |
|------|-----------|
| `heatmap-metric.ts` | Pure, RN-free helpers: `getMetricValue`, `getCalendarHeatmapBucket`, `getCurrentLocalDateKey`, `HEAT_RAMP` (the `viz0`…`viz4` roles). |
| `heatmapData.ts`    | `buildHeatmapData(dailyMetrics, metric, opts)` → `HeatmapData` (`{ daily, weekly, todayDateKey }`). Pure adapter; no RN imports. |
| `heatmap-style.ts`  | The shared title, caption and micro-label styles, plus the Weekly view's `ink` current / selected marks (`HEAT_MARK`). |
| `HeatmapLegend.tsx` | The metric legend and the Less…More ramp under both views. |
| `DailyHeatmap.tsx`  | **Daily** — read-only month calendars stacked newest first, Monday–Sunday plus Week tiles. |
| `WeeklyHeatmap.tsx` | **Weekly** — one horizontal bar per week, stacked newest first in a virtualized vertical list; zero-based proportional length, independent colour, vertical 12-wk average; selection lifted to the host. |

## Data flow

These components do **not** take raw sessions. The history sheet fetches the
app's pre-aggregated per-day metrics and feeds them through the adapter:

```ts
import { computeSelectedMuscleDailyEffortMetrics } from '@/src/data';
import { buildHeatmapData } from '@/components/heatmaps';

const dailyMetrics = await computeSelectedMuscleDailyEffortMetrics({ muscleGroupIds, start, end });
// or computeSelectedExerciseDailyEffort({ exerciseDefinitionId, start, end })

const data = buildHeatmapData(dailyMetrics, metric, { weeks: savedLookbackWeeks });
// metric: 'totalVolume' | 'workingSetCount' | 'estimatedRM1' | 'highestWeight'
```

`DailyEffortMetrics` (`{ dateKey, totalVolume, workingSetCount, estimatedRM1,
highestWeight, knownVolume? }`) comes from the muscle/exercise analytics in `src/data`; the
weekly effort the same screen already loads powers the sheet's week banner.
Muscle history offers per-side, role-weighted `totalVolume` and
`workingSetCount`; exercise Volume and 1RM use the current private calculation
policy and as-of reading. Missing personal reading uses zero. Top weight remains
raw entered kg, and every exercise uses the same labels.

**Exercise metrics and Volume buckets** are min–max over the window (`getCalendarHeatmapBucket`): the
smallest positive value is bucket 1, the largest bucket 4, and zero is bucket 0.
`hasTraining` distinguishes a known zero from rest in tiles and accessibility;
`unavailable` preserves missing or incomplete load instead of treating it as zero.
Muscle Sets colour uses per-muscle working counts (`workingSetCountsByMuscle`)
against one shared weekly target, capped before group averaging and including
zero muscles. Daily and weekly cells use that same target, independent of look-back;
legends and accessible labels report the target share. Displayed metrics and
eligibility retain their existing rules.
Volume / working sets aggregate (sum) per week; 1RM / top weight are best-of
(max). Weekly lengths share a zero origin and the known window maximum;
unknown load never gets a filled length, rest reads `Rest`, and known zero reads `0`.
Only known training weeks contribute to the 12-week average (including zeros);
rest and unavailable weeks do not. Incomplete volume is never plotted as a full
total: daily cells are dashed, weekly cells show `?`, and accessible labels retain known coverage.

## Props & selection

Daily tiles are read-only; Weekly bars select a detail banner:

```tsx
<DailyHeatmap
  data={data}
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap", "<prefix>-heatmap-cell-<dateKey>"
  metricLabel="Volume"                  // tile accessibility and metric heading
  formatValue={(v) => String(v)}
  legendLabel="Volume per day"
/>

<WeeklyHeatmap
  data={data}
  selectedWeekKey={selectedWeekKey}     // string | null
  onSelectWeek={onSelectWeek}           // (weekStartDateKey | null) => void
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap-cell-<weekStartDateKey>", "-bar-<key>"
  formatValue={formatValue}             // rows, axis and accessible values
  formatAverageValue={formatAverageValue} // optional; defaults to formatValue
  metricLabel="Sets"
/>
```

- **Daily** displays figures inside read-only tiles, without selection or
  black outlines. Adjacent
  months repeat the same full week value/colour. Rest tiles are blank, zero is
  numeric, unknown load is `?`, future days are blank and future weeks are `—`.
  Full dates, today/current week, rest and known incomplete subtotals are announced accessibly.
- **Weekly** lifts selection to the host, so the sheet's week banner can show
  the full range/value. A second tap clears it and removes the band. No instruction
  is displayed. Current and selected marks remain visible for zero/rest/unknown rows.

`buildHeatmapData` accepts an optional `todayDateKey` (`opts.todayDateKey`) as a
determinism seam for tests.

Settings is the sole Daily/Weekly selector. Missing or invalid choices use
Daily; valid saved Daily or Weekly choices survive restart and account
switching. Progress history targets one muscle ID or one exercise definition,
never a family. Progress renders the saved choice
without an in-chart switch. Numeric `weeks` controls the exact query/grid span;
short windows have no implicit 52-week minimum. Weekly selection returns to
the current week when excluded and survives look-back edits while in range.

## Look

- **Design language only** (`docs/specs/ui/design-language.md` §2): cells and
  bars on `HEAT_RAMP` (`uiRoles.viz0`…`viz4`); an empty day is `viz0` with a
  `rule` hairline. No legacy palette and no hard-coded colours.
- **Weekly current and selected differ**: the current week is a 1px
  `ink` ring, the selected row a 2px `ink` border with the selected
  accessibility state and a filled `ink` caret. Daily tiles have neither mark.
  `__tests__/heatmap-marks.test.tsx` holds this.
- **Warm switching:** the history sheet keeps both views mounted. Its inactive
  layer is transparent, non-interactive, and hidden from accessibility, avoiding
  a chart rebuild when the saved view changes while preserving Weekly selection
  and body scroll state.
- **One active vertical scroller.** The weekly `FlatList` owns the sheet body;
  Daily has one outer `ScrollView` containing vertical month calendars. Inline loading/error/empty
  states share the active body. Row targets are at least 44pt; old-year labels
  disambiguate multi-year windows and value columns cap their width and wrap.
- **No new dependencies.** RN primitives and the existing `Icon` / `Card`.
- The weekly average uses discrete vertical dashes on the same scale, plus
  a formatted label. At least six known training weeks among the latest twelve
  are required; an all-zero scale has no misleading reference. Averages use whole
  volume or the canonical one-decimal formatter for Sets/1RM/Top weight; row
  values retain the selected metric format.
- Current-week wording stays beside its row and the average stays above its
  reference; the footer omits the repeated current-week and average sentences.
