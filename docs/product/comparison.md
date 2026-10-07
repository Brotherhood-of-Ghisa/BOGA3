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
