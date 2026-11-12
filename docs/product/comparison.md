# Comparison

### comparison.change-display · presentation · accepted

| Figure | Shown as | Examples |
| --- | --- | --- |
| Set/session count (Progress, Today pace) | the signed difference, never a percentage | `+4`, `−3`, `0` |
| Volume (Progress tables, Today pace) | the rounded percentage of the earlier period's Volume | `+12%`, `−5%`, `0%`; `new` when the earlier period is 0; `—` when both are 0 |
| 1RM (Progress exercise table) | the signed difference in kg, in 1RM's format | `+4.7`, `−5.0`, `0`; `new` without an earlier estimate, `—` without a current one |
| Group records log, vs the member's previous best | the signed gain in the board's unit | `+4.1 on best` |

More is better; zero is unsigned; colour never replaces the sign.

Today's week figures and a group's At a glance total show none: each fills a
bar in laps of the previous week's total.

Why: counts and strength differences read directly; ratios make Volume changes comparable.
Code: `formatCountDelta`, `formatVolumeDelta`, `formatOneRepMaxDelta` in `apps/mobile/components/stats/comparison-format.ts`; `changeToneColourIn` in `apps/mobile/components/ui/change-tone.ts`; `weekShare` in `apps/mobile/components/today/progress-format.ts`; `apps/mobile/components/today/period-pace.tsx`; `apps/mobile/components/groups/group-week-totals.tsx`.

### comparison.allowed-periods · principle · accepted

Personal analytics use Settings’ Progress period or History look-back. Fixed
alternatives: one calendar week, Today’s periods and the Plan page's three
days before today, plus today so far (it never reorders the rows). Comparisons
default to Progress or Settings' This week; history, reference samples and Favourites to History.
Groups use calendar weeks only.

- Bad: a 30-day default, fixed 4/12/24-week presets or a monthly group view.
- Good: changing either setting changes every consumer of that period.
- Kept: lifetime record baselines and catalogue metadata, individual-session
  views, calendar-date navigation, explicit coaching query bounds and an
  explicit expansion of exercise session history beyond History look-back.

Why: consistent periods.
Code: `apps/mobile/app/exercise-history.tsx`; `apps/mobile/src/rm-curve/model.ts`; `apps/mobile/src/groups/home-periods.ts`; `todayPlanWindow` in `apps/mobile/src/today-plan/calculations.ts`.

### comparison.window · definition · accepted

Weeks start Monday. Presentation uses local time; CoW uses the authoritative
group calendar of [[groups.cow-calendar]].

| Screen | Current period | Compared with |
| --- | --- | --- |
| Progress, N weeks | the last N calendar weeks, from the Monday N − 1 weeks back until now; N is Settings' `Progress period (weeks)` | the preceding N full calendar weeks |
| Progress, This week (N = 1) | this calendar week until now; the only choice when N is 1 | the whole previous calendar week |
| Today, week figures | this calendar week until now | the whole previous calendar week |
| Groups, At a glance total | the stepper's calendar week (until now when current), every current member | that week's whole previous calendar week, the same members |

Why: include the unfinished week; Today's bar targets last week's whole total.
Code: `calendarWeekBounds`, `shiftCalendarWeeks` in `apps/mobile/src/utils/calendar-weeks.ts`; `computeProgressComparisons` in `apps/mobile/src/data/stats.ts`; the week window in `apps/mobile/src/progress-summary/calculations.ts`; `buildGroupWeekTotals` in `apps/mobile/src/groups/home-view-model.ts`.

### comparison.history-window · definition · accepted

Settings' History look-back selects N complete
Monday–Sunday weeks through today. On Monday–Saturday start on the Monday N
weeks before this week's Monday; on Sunday, N − 1 weeks before it. The current
partial week follows them. History display compaction never shortens this
window or the Weekly reference sample. Progress history remains bounded by it; only explicit exercise session
history expansion reads beyond it.

Why: chart and baseline share one sample.
Code: `historyWeekBounds` in `apps/mobile/src/utils/calendar-weeks.ts`;
`HistoryHeatmap` in `apps/mobile/components/stats/history-view.tsx`.

### comparison.colour-scale · presentation · accepted

Progress 3D Sets grade [[muscle.weekly-targets]] over [[comparison.window]],
capped at 100%: zero neutral, positive weak-to-strong. Volume grades rounded
percentage changes against body-wide finite extrema: middle-to-strong gains,
middle-to-weak losses; displayed −100% neutral while scaling losses. Filters
may rescale Volume; rotation/selection cannot. Unchanged middle;
empty/unavailable neutral; `new`/overflow strongest, outside extrema.
Strong darkens in light mode, lightens in dark. Wireframe colours edges on opaque
grey; Patches colours fills. Both reveal the same selected muscle surface.
Selection has its own colour and Now/Prev/Change;
no legend.

History legends precede charts: muscle Sets `% of target`, capped at the
effective weekly target; others `% of max` over History look-back, daily Grid
values, weekly Sets/Volume sums or weekly strength bests. Empty/all-zero samples
stay neutral.

Why: Sets show goal attainment; Volume shows period change; history shows training intensity.
Code: `apps/mobile/components/heatmaps/heatmap-metric.ts`;
`apps/mobile/components/stats/muscle-body-projection.ts`;
`apps/mobile/components/stats/muscle-wireframe-renderer.ts`.
