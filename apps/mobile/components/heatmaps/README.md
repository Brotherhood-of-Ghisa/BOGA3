# BoGa Heatmaps — Progress history integration

Two heatmap views and a Timeline chart for the exercise and muscle history sheets on Progress
(`components/stats/history-sheet.tsx`). They replace the older month-grid
`CalendarHeatmap`.

| File | What it is |
|------|-----------|
| `heatmap-metric.ts` | Pure, RN-free helpers: `getMetricValue`, `getCalendarHeatmapBucket`, `getCurrentLocalDateKey`, `HEAT_RAMP` (the `viz0`…`viz4` roles). |
| `heatmapData.ts`    | `buildHeatmapData(dailyMetrics, metric, opts)` → `HeatmapData` (`{ daily, weekly, todayDateKey }`). Pure adapter; no RN imports. |
| `heatmap-style.ts`  | Shared title, micro-label and Week-column spacing styles. |
| `HeatmapLegend.tsx` | The metric legend and the Less…More ramp under both views. |
| `DailyHeatmap.tsx`  | **Daily** — read-only month calendars stacked newest first, Monday–Sunday plus Week tiles. |
| `timeline.ts`       | `buildTimelineSeries(weekly, metric)` → per-week values, y ticks and month labels; `timelineGeometry` → columns, line runs and fitting labels. Pure. |
| `TimelineHeatmap.tsx` | **Timeline** — the metric week by week ([[comparison.timeline-history]]): readout, y axis with unit, columns or line, month axis; sideways scroll past `MIN_TIMELINE_COLUMN_WIDTH`. |
| `WeeklyHeatmap.tsx` | **Weekly** — one horizontal bar per week, stacked newest first in a virtualized vertical list; zero-based proportional length, independent colour, dashed percentile references; selection lifted to the host. |

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
highestWeight }`) comes from the muscle/exercise analytics in `src/data`; the
weekly effort the same screen already loads determines its empty state.
Muscle history offers per-side, role-weighted `totalVolume`, and
`workingSetCount` ([[muscle.set-count]]); exercise Volume and 1RM use the current private calculation
policy and as-of reading. Missing personal reading uses zero. Top weight remains
raw entered kg, and every exercise uses the same labels.

**Exercise metrics and Volume buckets** are min–max over the window (`getCalendarHeatmapBucket`): the
smallest positive value is bucket 1, the largest bucket 4, and zero is bucket 0.
`hasTraining` distinguishes a known zero from rest in tiles and accessibility;
`unavailable` marks a figure that cannot be shown (a Volume sum that is not
finite) instead of treating it as zero.
Muscle Sets colour uses per-muscle working counts (`workingSetCountsByMuscle`)
against one shared weekly target, capped before group averaging and including
zero muscles. Daily and weekly cells use that same target, independent of look-back;
the legend then reads `Weekly target`, `0%` to `100%`, and accessible labels
report each cell's share. Displayed metrics and
eligibility retain their existing rules.
Volume / working sets aggregate (sum) per week; 1RM / top weight are best-of
(max). Weekly lengths share a zero origin and the known window maximum;
unknown load never gets a filled length. Figure visibility follows
[[copy.blank-history]]; Weekly reference calculations follow
[[comparison.weekly-reference]] across [[comparison.history-window]]. A Volume sum that is not finite is never
plotted: Daily and Weekly values are blank and announce `Volume unavailable`;
Daily retains a neutral dashed rule.

## Props & selection

Daily tiles are read-only; Weekly bars select a row:

```tsx
<DailyHeatmap
  data={data}
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap", "<prefix>-heatmap-cell-<dateKey>"
  metricLabel="Volume"                  // tile accessibility
  formatValue={(v) => String(v)}
  legendLabel="Volume per day"
/>

<WeeklyHeatmap
  data={data}
  selectedWeekKey={selectedWeekKey}     // string | null
  onSelectWeek={onSelectWeek}           // (weekStartDateKey | null) => void
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap-cell-<weekStartDateKey>", "-bar-<key>"
  formatValue={formatValue}             // rows, axis and accessible values
  formatReferenceValue={formatReferenceValue} // optional; defaults to formatValue
  metricLabel="Sets"
/>
```

- **Daily** follows [[comparison.daily-history]]. `daily-calendar.ts` builds
  the month/row framing without changing adapter values or colours. Tiles are
  read-only, without selection or black outlines. Figure visibility follows
  [[copy.blank-history]]. Missing/future positions are empty spacers without
  accessible day values. A vertical `rule` centres in a wider Sun/Week gap;
  the eight tile columns shrink independently of the outside date gutter.
  Full dates, today/current week and rest are announced accessibly.
- **Weekly** lifts selection to the host; a second tap clears the selected
  row. No selected-week banner is displayed; figure visibility follows [[copy.blank-history]].
  Rest/current semantics remain accessible; selected rows retain their caret, including zero/rest/unknown rows.

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
- **No black outlines:** current and selected tiles/bars have no black border.
  Weekly selection retains its accessible state and filled `ink` caret.
  Current-week wording remains beside its row.
  `__tests__/heatmap-marks.test.tsx` holds this.
- **Warm switching:** the history sheet mounts each view on first use and keeps visited views mounted. Its inactive
  layer is transparent, non-interactive, and hidden from accessibility, avoiding
  a chart rebuild when the saved view changes while preserving Weekly selection
  and body scroll state.
- **One active vertical scroller.** The weekly `FlatList` owns the sheet body;
  Daily owns a virtualized `FlatList` of month calendars. Inline loading/error/empty
  states share the active body. Row targets are at least 44pt; old-year labels
  disambiguate multi-year windows and value columns cap their width and wrap.
- **No new dependencies.** RN primitives and the existing `Icon` / `Card`.
- Weekly references use discrete vertical dashes on the same zero-based scale
  as the bars ([[comparison.weekly-reference]]). Accessible values use whole
  Volume or the canonical one-decimal formatter for Sets/1RM/Top weight; row values
  retain the selected metric format. Axis marks announce the saved window, each
  reference and value accessibly, including coincident references; no visible
  label stack is drawn. References and displayed weeks use the same look-back.
- Daily and Weekly follow [[copy.no-subtitles]] and share title typography. Window/Metric captions, metric
  subtitles and visible reference labels are omitted. Selected metric controls
  use fixed black `selection` with white `surface` labels in every theme.
