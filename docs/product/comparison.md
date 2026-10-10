# Comparison

### comparison.change-display · presentation · accepted

How a change between two periods is shown.

| Figure | Shown as | Examples |
| --- | --- | --- |
| A set or session count (Progress tables, Today's month pace) | the signed absolute difference, never a percentage | `+4`, `−3`, `±0` |
| Volume (Progress tables) | the rounded percentage of the earlier period's Volume | `+12%`, `−5%`, `±0%`; `new` when the earlier period is 0; `—` when both are 0 |

Today's week figures show none: each fills a bar in laps of last week's total
(up to it, twice, three times).

Why: a count is small and whole, so its difference reads directly; a Volume's
size depends on the lifter, so only a ratio compares.
Code: `formatCountDelta`, `formatVolumeDelta` in `apps/mobile/components/stats/comparison-format.ts`; `weekShare` in `apps/mobile/components/today/progress-format.ts`; `apps/mobile/components/today/month-pace.tsx`.

### comparison.window · definition · accepted

Which periods a comparison sets side by side. Weeks start on Monday, local
time.

| Screen | Current period | Compared with |
| --- | --- | --- |
| Progress, N weeks | the last N calendar weeks, from the Monday N − 1 weeks back until now; N is Settings' `Progress period (weeks)` | the preceding N full calendar weeks |
| Progress, This week (N = 1) | this calendar week until now; the only choice when N is 1 | the whole previous calendar week |
| Today, week figures | this calendar week until now | the whole previous calendar week |
| Today, month pace | this month through today | the previous month through the same day (its last day when it is shorter) |

Why: every weekly comparison includes the unfinished current week and uses the
whole preceding block as its baseline. Today's week bar shows progress toward
last week's whole total.
Code: `calendarWeekBounds`, `shiftCalendarWeeks` in `apps/mobile/src/utils/calendar-weeks.ts`; `computeProgressComparisons` in `apps/mobile/src/data/stats.ts`; the week and month windows in `apps/mobile/src/progress-summary/calculations.ts`.

### comparison.history-window · definition · accepted

Exercise and muscle history use Settings' History look-back (weeks): N complete
Monday–Sunday weeks through today. On Monday–Saturday start on the Monday N
weeks before this week's Monday; on Sunday, N − 1 weeks before it. The current
partial week follows them. Displayed weeks and Weekly reference calculations
use the whole window.

Why: a history setting must select the same sample for the chart and its baseline.
Code: `historyWeekBounds` in `apps/mobile/src/utils/calendar-weeks.ts`;
`HistoryHeatmap` in `apps/mobile/components/stats/history-view.tsx`.

### comparison.weekly-reference · calculation · accepted

Known training weeks in [[comparison.history-window]] supply references,
including genuine zeros; exclude rest, future and unavailable weeks. Require
six observations and a positive window maximum.

| Metric | Reference lines |
| --- | --- |
| Sets | Median |
| Volume, 1RM, Top weight | 25th percentile, median, 75th percentile |

Percentiles interpolate sorted values. Bars and lines use training min and
window max (at least 1): positive `12+88×(value−min)/(max−min)%`, collapsed
`100%`, zero `0%`. Axis: min/mid/max; collapsed one label, empty/all-zero `0`.
Coincident positions and accessible values remain; no visible reference labels.

Why: a consistent middle-half reference for selected history.
Code: `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`; `calculateLinearPercentile` in `apps/mobile/src/session-insights/calculations.ts`.
