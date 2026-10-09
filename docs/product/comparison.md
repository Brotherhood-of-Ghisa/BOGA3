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
| Progress, N > 1 | the last N calendar weeks, from the Monday N − 1 weeks back until now; N is Settings' `Progress period (weeks)` | the immediately preceding N full calendar weeks, ending at the current period's start |
| Progress, This week (N = 1) | this calendar week until now; the alternative to the configured period, and the only choice when N is 1 | the same span one week earlier, cut at the same elapsed time |
| Today, week figures | this calendar week until now | the whole previous calendar week |
| Today, month pace | this month through today | the previous month through the same day (its last day when it is shorter) |

Why: Progress's multiweek totals compare with the whole preceding block;
This week compares week-to-date spans. Today's week bar shows progress toward
last week's whole total.
Code: `calendarWeekBounds`, `shiftCalendarWeeks` in `apps/mobile/src/utils/calendar-weeks.ts`; `computeProgressComparisons` in `apps/mobile/src/data/stats.ts`; the week and month windows in `apps/mobile/src/progress-summary/calculations.ts`.

### comparison.history-window · definition · accepted

Exercise and muscle history use Settings' History look-back (weeks): the Monday
N − 1 weeks before the current week through today. Both displayed weeks and
Weekly reference calculations use this entire window.

Why: a history setting must select the same sample for the chart and its baseline.
Code: `HistoryHeatmap` in `apps/mobile/components/stats/history-sheet.tsx`.

### comparison.daily-history · presentation · accepted

Daily history months and their rows are newest first. Each sampled day appears
once, in its own month; future and out-of-sample positions have no tile. The
month's first day is in its bottom row and its last sampled day in its top row.

A Week tile appears beside its Sunday's row, in Sunday's month, only when
Sunday has arrived and all seven Monday–Sunday dates are in the full sample.
Rest days count; a week may span two months. Today counts when it is Sunday.
Use the whole week's value and colour; a missing date or partial first sample
week omits its Week tile while retaining sampled daily tiles.

Why: each daily figure and completed weekly total should appear once in the calendar.
Code: `apps/mobile/components/heatmaps/daily-calendar.ts`; `apps/mobile/components/heatmaps/DailyHeatmap.tsx`.

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
