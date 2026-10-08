# BoGa Heatmaps — Progress history integration

Two heatmap views for the exercise and muscle history sheets on Progress
(`components/stats/history-sheet.tsx`). They replace the older month-grid
`CalendarHeatmap`.

| File | What it is |
|------|-----------|
| `heatmap-metric.ts` | Pure, RN-free helpers: `getMetricValue`, `getCalendarHeatmapBucket`, `getCurrentLocalDateKey`, `HEAT_RAMP` (the `viz0`…`viz4` roles). |
| `heatmapData.ts`    | `buildHeatmapData(dailyMetrics, metric, opts)` → `HeatmapData` (`{ daily, weekly, todayDateKey }`). Pure adapter; no RN imports. |
| `heatmap-style.ts`  | Shared title, micro-label and Week-column spacing styles. |
| `HeatmapLegend.tsx` | The metric legend and the Less…More ramp under both views. |
| `DailyHeatmap.tsx`  | **Daily** — read-only month calendars stacked newest first, Monday–Sunday plus Week tiles. |
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
unknown load never gets a filled length; rest and unknown values are blank, and known zero reads `0`.
Sets uses median only; other metrics use P25, median and P75 from known training weeks
(including zeros) across the full saved history window; rest, future and
unavailable weeks do not contribute. A Volume sum that is not finite is never
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

- **Daily** orders months and their week rows newest first: the month's first
  day is in the bottom row, its last observed week in the top row. Each month
  shows only its own day tiles; adjoining-month positions are empty spacers.
  A Week tile appears beside that month's Sunday once Sunday has arrived,
  provided all seven Monday–Sunday dates are present in the full data sample,
  including rest days and preceding-month days. A partial first sample week or
  missing date omits its Week tile while keeping the sampled daily tiles.
  The complete adapter value/colour spans month boundaries.
  The current Week tile appears only on Sunday; rows whose Sunday is in the
  next month have no Week tile. Tiles are read-only, without selection or black
  outlines. Rest and unknown load are blank, and zero is numeric.
  Future day positions are empty spacers with no tile or accessible day value.
  No visible Rest wording or question mark is displayed.
  No future week rows extend the saved history window.
  A vertical `rule` centres in a wider Sun/Week gap through each header and row;
  all eight read-only columns can shrink on narrow screens.
  Monday dates are small, top-left figures. Full dates, today/current week and rest are announced accessibly.
- **Weekly** lifts selection to the host; a second tap clears the selected
  row. No selected-week banner, visible Rest indicator or question mark is displayed.
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
- **Warm switching:** the history sheet keeps both views mounted. Its inactive
  layer is transparent, non-interactive, and hidden from accessibility, avoiding
  a chart rebuild when the saved view changes while preserving Weekly selection
  and body scroll state.
- **One active vertical scroller.** The weekly `FlatList` owns the sheet body;
  Daily has one outer `ScrollView` containing vertical month calendars. Inline loading/error/empty
  states share the active body. Row targets are at least 44pt; old-year labels
  disambiguate multi-year windows and value columns cap their width and wrap.
- **No new dependencies.** RN primitives and the existing `Icon` / `Card`.
- Weekly references use discrete vertical dashes on the same zero-based scale
  as the bars. At least six known training weeks within the saved history are
  required; an all-zero scale has no reference. Numeric labels use whole
  Volume or the canonical one-decimal formatter for Sets/1RM/Top weight; row values
  retain the selected metric format. Axis marks announce the saved window, each
  reference and value accessibly, including coincident references; no visible
  label stack is drawn. References and displayed weeks use the same look-back.
- Daily and Weekly share title typography. Window/Metric captions, metric
  subtitles and visible reference labels are omitted. Selected metric controls
  use fixed black `selection` with white `surface` labels in every theme.
