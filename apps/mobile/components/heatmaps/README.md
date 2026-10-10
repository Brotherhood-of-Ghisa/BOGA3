# BoGa Heatmaps — Progress history integration

Two heatmap views and a Timeline chart for the exercise and muscle history page
Progress pushes (`components/stats/history-view.tsx`, route
`app/progress-history.tsx`). They replace the older month-grid `CalendarHeatmap`.

| File | What it is |
|------|-----------|
| `heatmap-metric.ts` | Pure, RN-free helpers: `getMetricValue`, `getCalendarHeatmapBucket`, `getCurrentLocalDateKey`, `HEAT_RAMP` (the `viz0`…`viz4` roles). |
| `heatmapData.ts`    | `buildHeatmapData(dailyMetrics, metric, opts)` → `HeatmapData` (`{ daily, weekly, todayDateKey }`). Pure adapter; no RN imports. |
| `heatmap-style.ts`  | Shared micro-label and Week-column spacing styles. |
| `HeatmapLegend.tsx` | The metric legend and the Less…More ramp under both views. |
| `DailyHeatmap.tsx`  | **Daily** — month calendars stacked newest first, Monday–Sunday plus Week tiles; a training day or week opens its sessions. |
| `timeline.ts`       | `buildTimelineSeries(weekly, metric)` → per-week values, zero-based y ticks and month labels; `timelineGeometry` → columns and the month labels that fit. Pure. |
| `TimelineHeatmap.tsx` | **Timeline** — the metric week by week as columns ([[comparison.timeline-history]]): readout with `View sessions`, y axis, month axis, the selected column in `ink`; sideways scroll past `MIN_TIMELINE_COLUMN_WIDTH`; `children` (the week's sets, `components/stats/week-set-list.tsx`) below. The only view that selects a week; the host keeps the selection. |
| `WeeklyHeatmap.tsx` | **Weekly** — newest-first horizontal bars in a virtualized list; lengths and references follow [[comparison.weekly-reference]], colour is independent; a training week opens its sessions. |

## Data flow

These components do **not** take raw sessions. The history page fetches the
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
weekly effort the same page already loads determines its empty state.
Muscle history offers per-side, role-weighted `totalVolume`, and
`workingSetCount` ([[muscle.set-count]]); exercise Volume and 1RM use the current private calculation
policy and as-of reading. Missing personal reading uses zero. Top weight remains
raw entered kg, and every exercise uses the same labels.

**Exercise metrics and Volume buckets** are min–max over the window (`getCalendarHeatmapBucket`): the
smallest positive value is bucket 1, the largest bucket 4, and zero is bucket 0.
`hasTraining` distinguishes a known zero from rest in tiles and accessibility;
`unavailable` marks a figure that cannot be shown (a Volume sum that is not
finite) instead of treating it as zero.
Exercise history also carries all-time session-fact PR counts into the selected
metric's cells ([[comparison.history-prs]]); muscle history carries none.
Muscle Sets colour uses per-muscle working counts (`workingSetCountsByMuscle`)
against one shared weekly target, capped before group averaging and including
zero muscles. Daily and weekly cells use that same target, independent of look-back;
the legend then reads `Weekly target`, `0%` to `100%`, and accessible labels
report each cell's share. Displayed metrics and
eligibility retain their existing rules.
Volume / working sets aggregate (sum) per week; 1RM / top weight are best-of
(max). Weekly lengths follow [[comparison.weekly-reference]];
unknown load never gets a filled length. Figure visibility follows
[[copy.blank-history]]; Weekly reference calculations follow
[[comparison.weekly-reference]] across [[comparison.history-window]]. A Volume sum that is not finite is never
plotted: Daily and Weekly values are blank and announce `Volume unavailable`;
Daily retains a neutral dashed rule.

## Props & opening

A day or week with training opens its sessions ([[session.history-open]]): the
host passes the openers and routes; a rest day or week stays text.

```tsx
<DailyHeatmap
  data={data}
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap", "<prefix>-heatmap-cell-<dateKey>"
  metricLabel="Volume"                  // tile accessibility
  formatValue={(v) => String(v)}
  legendLabel="Volume per day"
  onOpenDay={onOpenDay}                 // (day: DayCell) => void; day.sessionIds names its sessions
  onOpenWeek={onOpenWeek}               // (weekStartDateKey) => void; the Week tiles
/>

<WeeklyHeatmap
  data={data}
  onOpenWeek={onOpenWeek}               // (weekStartDateKey) => void
  testIDPrefix="stats-muscle-history"   // → "<prefix>-heatmap-cell-<weekStartDateKey>", "-bar-<key>"
  formatValue={formatValue}             // rows, axis and accessible values
  formatReferenceValue={formatReferenceValue} // optional; defaults to formatValue
  metricLabel="Sets"
/>
```

- **Daily** follows [[comparison.daily-history]]. `daily-calendar.ts` builds
  the month/row framing without changing adapter values or colours. Tiles have no
  selection or black outlines. Figure visibility follows
  [[copy.blank-history]]. Missing/future positions are empty spacers without
  accessible day values. A vertical `rule` centres in a wider Sun/Week gap;
  the eight tile columns shrink independently of the outside date gutter.
  Full dates, today/current week and rest are announced accessibly.
- **Weekly** rows hold no selection and draw no banner; figure visibility
  follows [[copy.blank-history]]. Rest/current semantics remain accessible.

`buildHeatmapData` accepts an optional `todayDateKey` (`opts.todayDateKey`) as a
determinism seam for tests.

The history page's view selector (`Timeline` | `Grid` | `Weekly`, icons) is
the sole view choice, and it writes the saved `heatmapView` preference
(`timeline`, `daily`, `weekly`): Settings has no such row. Missing or invalid
choices use Daily; a valid saved choice survives restart and account
switching. The Timeline's week list is read only while that view shows. Progress history targets
one muscle ID or one exercise definition, never a family.
Numeric `weeks` controls query/grid coverage under [[comparison.history-window]];
short windows have no implicit 52-week minimum.

## Look

- **Design language only** (`docs/specs/ui/design-language.md` §2): cells and
  bars on `HEAT_RAMP` (`uiRoles.viz0`…`viz4`); an empty day is `viz0` with a
  `rule` hairline. No legacy palette and no hard-coded colours.
- **No black outlines:** current tiles/bars have no black border.
  Current-week wording remains beside its row.
  `__tests__/heatmap-marks.test.tsx` holds this.
- **Warm switching:** the history page mounts each view on first use and keeps visited views mounted. Its inactive
  layer is transparent, non-interactive, and hidden from accessibility, avoiding
  a chart rebuild when the chosen view changes while preserving each view's
  scroll state.
- **One active vertical scroller.** The weekly `FlatList` owns the page body;
  Daily owns a virtualized `FlatList` of month calendars. Inline loading/error/empty
  states share the active body. Row targets are at least 44pt; old-year labels
  disambiguate multi-year windows and value columns cap their width and wrap.
- **No new dependencies.** RN primitives and the existing `Icon` / `Card`.
- Weekly references use discrete vertical dashes on the same scale
  as the bars ([[comparison.weekly-reference]]). Accessible values use whole
  Volume or the canonical one-decimal formatter for Sets/1RM/Top weight; row values
  retain the selected metric format. Axis marks announce the saved window, each
  reference and value accessibly, including coincident references; no visible
  label stack is drawn. References and displayed weeks use the same look-back.
- Daily and Weekly follow [[copy.no-subtitles]] and share title typography. Window/Metric captions, metric
  subtitles and visible reference labels are omitted. Selected metric controls
  use fixed black `selection` with white `surface` labels in every theme.
