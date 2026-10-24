# Comparison

### comparison.change-display · presentation · accepted

| Figure | Shown as | Examples |
| --- | --- | --- |
| Set/session count (Progress, Today pace) | the signed difference, never a percentage | `+4`, `−3`, `0` |
| Volume (Progress tables) | the rounded percentage of the earlier period's Volume | `+12%`, `−5%`, `0%`; `new` when the earlier period is 0; `—` when both are 0 |
| 1RM (Progress exercise table) | the signed difference in kg, in 1RM's format | `+4.7`, `−5.0`, `0`; `new` without an earlier estimate, `—` without a current one |

More is better; zero is unsigned; colour never replaces the sign.

Today's week figures show none: each fills a bar in laps of last week's total.

Why: counts and strength differences read directly; ratios make Volume changes comparable.
Code: `formatCountDelta`, `formatVolumeDelta`, `formatOneRepMaxDelta` in `apps/mobile/components/stats/comparison-format.ts`; `changeToneColour` in `apps/mobile/components/ui/change-tone.ts`; `weekShare` in `apps/mobile/components/today/progress-format.ts`; `apps/mobile/components/today/period-pace.tsx`.

### comparison.allowed-periods · principle · accepted

Personal analytics use Settings’ Progress period or History look-back. Fixed
alternatives: one calendar week and Today’s periods. Comparisons
default to Progress or Settings' This week; history, reference samples and Favourites to History.
Groups use calendar weeks only.

- Bad: a 30-day default, fixed 4/12/24-week presets or a monthly group view.
- Good: changing either setting changes every consumer of that period.
- Kept: lifetime record baselines and catalogue metadata, individual-session
  views, calendar-date navigation and explicit coaching query bounds.

Why: consistent periods.
Code: `apps/mobile/app/exercise-history.tsx`; `apps/mobile/src/rm-curve/model.ts`; `apps/mobile/src/groups/home-periods.ts`.

### comparison.window · definition · accepted

Weeks start Monday, local time.

| Screen | Current period | Compared with |
| --- | --- | --- |
| Progress, N weeks | the last N calendar weeks, from the Monday N − 1 weeks back until now; N is Settings' `Progress period (weeks)` | the preceding N full calendar weeks |
| Progress, This week (N = 1) | this calendar week until now; the only choice when N is 1 | the whole previous calendar week |
| Today, week figures | this calendar week until now | the whole previous calendar week |
| Today, period pace | N-week periods from Mon 29 Dec 2025: to today or a selected day, projected at today's rate | the previous period to that day; its daily series |

Why: include the unfinished week; Today's bar targets last week's whole total.
Code: `calendarWeekBounds`, `shiftCalendarWeeks` in `apps/mobile/src/utils/calendar-weeks.ts`; `computeProgressComparisons` in `apps/mobile/src/data/stats.ts`; the week and period windows in `apps/mobile/src/progress-summary/calculations.ts`.

### comparison.history-window · definition · accepted

Settings' History look-back selects N complete
Monday–Sunday weeks through today. On Monday–Saturday start on the Monday N
weeks before this week's Monday; on Sunday, N − 1 weeks before it. The current
partial week follows them. Displayed weeks and Weekly reference calculations
use the whole window.

Why: chart and baseline share one sample.
Code: `historyWeekBounds` in `apps/mobile/src/utils/calendar-weeks.ts`;
`HistoryHeatmap` in `apps/mobile/components/stats/history-view.tsx`.

### comparison.weekly-reference · calculation · accepted

Known training weeks in [[comparison.history-window]] supply references, zeros
included; exclude rest/future/unavailable weeks. Require six observations and a
positive maximum.

| Metric | Scale | Reference lines |
| --- | --- | --- |
| Sets | Zero to window maximum | Median |
| Volume | Zero to window maximum | P25, median, P75 |
| 1RM, Top weight | Symmetric linear range around median | P25, median, P75 |

For strength minimum `a`, median `m` and maximum `b`, radius is
`max(m − 0.9a, b − m)`; position is `50 + 50 × (value − m) / radius` percent.
Compute the median even below six observations. Percentiles interpolate sorted
values; coincident positions and accessible values remain. Empty/all-zero
windows show `0`, without fill or references. Genuine zeros stay unfilled.

Why: readable strength, proportional counts and Volume.
Code: `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`; `calculateLinearPercentile` in `apps/mobile/src/session-insights/calculations.ts`.


### comparison.muscle-ticker-window · calculation · accepted

Muscle List Sets/Volume tickers use [[comparison.history-window]], current gym
scope, mappings and personal effort policy. Each metric has its own eligible
training days and first-history date. Each local training day contributes one
observation at its last eligible completed session; active sessions do not.
Its total covers the trailing configured Progress N weeks, shifted by local
calendar time across DST, through that instant. A complete reading requires N
weeks since that muscle's first eligible session. Read N weeks before the
visible start for calculation only. This week changes table figures alone.
Connect real observations across rest days without inventing samples; unavailable
training observations break the line.

Why: show comparable rolling effort without inventing history.
Code: `apps/mobile/src/data/progress-muscle-tickers.ts`.

### comparison.muscle-ticker-reference · calculation · accepted

Sets reference is configured weekly working-set target × configured N.
Volume reference is the median of overlapping complete N-week observations
inside the visible history. Include known numeric zeros; exclude missing, rest
and unavailable observations. Require six valid observations; a zero median is
valid. Graph visibility follows [[comparison.muscle-ticker-extent]]. Reference
colour compares the observation with its reference independently of the table's
signed Change.

Code: `apps/mobile/src/data/progress-muscle-tickers.ts`.

### comparison.muscle-ticker-extent · presentation · accepted

Sets and Volume require at least six complete observations spanning the
configured Progress N weeks in local calendar time, including a positive value.
Otherwise the graph stays blank; figures and history links remain. Flat positive
histories qualify.

Muscle List tickers retain the full configured history time scale. Available
history is right-aligned and shortened in proportion to elapsed time, preserving
its real dates and internal unavailable gaps. The complete plot fits within
one-third of its actual table width. Charts mark only the latest valid
observation, even if earlier than today.

Why: sparse history must not imply a trend or longer coverage.
Code: `apps/mobile/components/stats/muscle-ticker.tsx`.
