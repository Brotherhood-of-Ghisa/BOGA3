# Comparison

### comparison.change-display · presentation · accepted

How a change between two periods is shown.

| Figure | Shown as | Examples |
| --- | --- | --- |
| A set or session count (Progress tables, Today's month pace) | the signed absolute difference, never a percentage | `+4`, `−3`, `±0` |
| Volume (Progress tables) | the rounded percentage of the earlier period's Volume | `+12%`, `−5%`, `±0%`; `new` when the earlier period is 0; `—` when both are 0 |

Today's week figures show no change figure: each fills a bar in laps of last
week's total (up to it, twice it, three times it).

Why: a count is small and whole, so its difference reads directly; a Volume's
size depends on the lifter, so only a ratio compares.
Code: `formatCountDelta`, `formatVolumeDelta` in `apps/mobile/components/stats/comparison-format.ts`; `weekShare` in `apps/mobile/components/today/progress-format.ts`; `apps/mobile/components/today/month-pace.tsx`.

### comparison.window · definition · accepted

Which periods a comparison sets side by side. Weeks start on Monday, local
time.

| Screen | Current period | Compared with |
| --- | --- | --- |
| Progress | the last N calendar weeks, from the Monday N − 1 weeks back until now; N is Settings' `Progress period (weeks)`. `This week` is the alternative (N = 1), and the only choice when N is 1 | the same span N weeks earlier, cut at the same elapsed time |
| Today, week figures | this calendar week until now | the whole previous calendar week |
| Today, month pace | this month through today | the previous month through the same day (its last day when it is shorter) |

Why: Progress compares like with like, so a part week never looks like a
drop; Today's week bar shows progress toward last week's whole total.
Code: `calendarWeekBounds`, `shiftCalendarWeeks` in `apps/mobile/src/utils/calendar-weeks.ts`; `computeProgressComparisons` in `apps/mobile/src/data/stats.ts`; the week and month windows in `apps/mobile/src/progress-summary/calculations.ts`.

### comparison.history-window · definition · accepted

Exercise and muscle history use Settings' History look-back (weeks): the Monday
N − 1 weeks before the current week through today. Both displayed weeks and
Weekly reference calculations use this entire window.

Why: a history setting must select the same sample for the chart and its baseline.
Code: `HistoryHeatmap` in `apps/mobile/components/stats/history-view.tsx`.

### comparison.daily-history · presentation · accepted

Daily history months and week rows are newest first. Each Monday–Sunday row
belongs to the month in which Monday falls, including its adjoining-month
days. Each sampled day appears once; future and out-of-sample positions have
no tile. The week's start-day number sits outside the tiles as its row label;
month headings use smaller secondary text.

A Week tile appears on that row only when Sunday has arrived and all seven
Monday–Sunday dates are in the full sample. Rest days count; a week may span
two months. Today counts when it is Sunday. Use the whole week's value and
colour; a missing date or partial first sample week omits its Week tile while
retaining sampled daily tiles.

Why: each daily figure and completed weekly total appears once, in its starting week.
Code: `apps/mobile/components/heatmaps/daily-calendar.ts`; `apps/mobile/components/heatmaps/DailyHeatmap.tsx`.

### comparison.timeline-history · presentation · accepted

The Timeline history view plots one value per Monday week across
[[comparison.history-window]], oldest on the left, as columns on a zero-based
scale. A month is labelled at the first week that starts in it, as in
[[comparison.daily-history]].

| Metric | Week value | Rest week | Unavailable week |
| --- | --- | --- | --- |
| Volume, Sets | the week's sum | no column; the readout says `0` | no column; the readout says `Unavailable` |
| 1RM, Top weight | the week's best | no column; the readout says `No sets` | no column; the readout says `Unavailable` |

The readout above the chart shows the selected week, else the newest: its
figure and unit (`volume`, `sets`, `kg`), and `View sessions` for a trained
week. Tapping a week selects it and fills its column in `ink`; a second tap
clears it. The selected week's sets follow the chart. Unlike Daily and Weekly
([[copy.blank-history]]), the readout writes a rest week's figure.

Why: one form reads the same for every metric; a week without training sums
to zero, and a best has no value without sets.
Code: `apps/mobile/components/heatmaps/timeline.ts`; `apps/mobile/components/heatmaps/TimelineHeatmap.tsx`; `apps/mobile/components/stats/week-sets.ts`.

### comparison.weekly-reference · calculation · accepted

Within [[comparison.history-window]], known training weeks form the reference
population, including genuine zeros and excluding rest, future and unavailable
weeks. Require at least six eligible weeks and a positive window maximum;
otherwise omit references.

| Metric | Reference lines |
| --- | --- |
| Sets | Median |
| Volume, 1RM, Top weight | 25th percentile, median, 75th percentile |

Calculate percentiles by linear interpolation on sorted weekly values. Place
lines on the bars' shared zero-based scale, keeping exact positions even when
they coincide. Values remain accessible without visible reference labels.

Why: the middle half of the selected history supplies a consistent reference range.
Code: `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`; `calculateLinearPercentile` in `apps/mobile/src/session-insights/calculations.ts`.
