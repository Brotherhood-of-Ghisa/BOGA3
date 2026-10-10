# Comparison

### comparison.history-prs · presentation · accepted

Exercise history PRs follow the selected metric — Volume, 1RM or Top weight —
from the all-time session records. Sets and muscle history have no PRs. Daily
marks a day holding any with one top-right triangle, whatever the count, and
no detail box. Weekly shows the count beneath the metric value when positive.
Accessibility announces it.

Why: the record mark must describe the figure being viewed.
Code: `computeSelectedExerciseHistoryEffort` in `apps/mobile/src/data/exercise-analytics.ts`;
`apps/mobile/components/heatmaps/heatmapData.ts`, `calendar-tile.tsx`, `WeeklyHeatmap.tsx`.

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
| Progress, N weeks | the last N calendar weeks, from the Monday N − 1 weeks back until now; N is Settings' `Progress period (weeks)` | the immediately preceding N full calendar weeks, ending at the current period's start |
| Progress, This week (N = 1) | this calendar week until now; the alternative to the configured period, and the only choice when N is 1 | the whole previous calendar week |
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

### comparison.daily-history · presentation · accepted

Daily history months and week rows are newest first. Each Monday–Sunday row
belongs to the month its Monday falls in, adjoining-month days included. Each
sampled day appears once; future and out-of-sample positions have no tile. The
week's start-day number is its row label, outside the tiles; month headings are
smaller secondary text.

A Week tile appears only once Sunday has arrived with all seven dates in the
full sample. Rest days count; a week may span two months; today counts when it
is Sunday. It takes the whole week's value and colour. A missing date or a
partial first week omits the Week tile and keeps its daily tiles.

Why: each daily figure and completed weekly total appears once, in its starting week.
Code: `apps/mobile/components/heatmaps/daily-calendar.ts`; `apps/mobile/components/heatmaps/DailyHeatmap.tsx`.

### comparison.timeline-history · presentation · accepted

The Timeline history view plots one value per Monday week across
[[comparison.history-window]], oldest on the left, as columns on a zero-based
scale. A month is labelled at the first week that starts in it, as in
[[comparison.daily-history]]; a label that would overlap another is left out,
January's and the first one kept, and those two carry the year.

| Metric | Week value | Rest week | Unavailable week |
| --- | --- | --- | --- |
| Volume, Sets | the week's sum | no column; the readout says `0` | no column; the readout says `Unavailable` |
| 1RM, Top weight | the week's best | no column; the readout says `No sets` | no column; the readout says `Unavailable` |

The readout above the chart shows the selected week, else the newest: its
figure and unit (`volume`, `set`/`sets`, `kg`), and `View sessions` for a week
with training, which opens Sessions there as a Weekly row does
([[session.history-open]]). Tapping a week selects it and fills its column in
`ink`; a second tap clears it. Unlike Daily and Weekly
([[copy.blank-history]]), the readout writes a rest week's figure.

That week's sets follow the chart as View Session's cards, record highlights
and bands included, Monday first. An exercise's cards are its session blocks
holding a performed set, titled by day with the gym; a muscle's are the
exercise blocks whose sets counted for it, titled by exercise with the day.

Why: one form reads the same for every metric; a week without training sums
to zero, and a best has no value without sets.
Code: `apps/mobile/components/heatmaps/timeline.ts`; `apps/mobile/components/heatmaps/TimelineHeatmap.tsx`; `apps/mobile/components/stats/week-sets.ts`.

### comparison.weekly-reference · calculation · accepted

Within [[comparison.history-window]], known training weeks form the reference
population — genuine zeros included, rest, future and unavailable weeks
excluded. It needs six eligible weeks and a positive window maximum; otherwise
omit references.

| Metric | Reference lines |
| --- | --- |
| Sets | Median |
| Volume, 1RM, Top weight | 25th percentile, median, 75th percentile |

Percentiles are linear interpolation on sorted weekly values. Lines sit on the
bars' shared zero-based scale, keeping exact positions even when they coincide.
Values stay accessible without visible reference labels.

Why: the middle half of the selected history supplies a consistent reference range.
Code: `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`; `calculateLinearPercentile` in `apps/mobile/src/session-insights/calculations.ts`.
