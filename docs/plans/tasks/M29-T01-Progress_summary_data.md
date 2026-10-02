# M29-T01-Progress_summary_data — Local progress summary for Today

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend (data layer, no UI); UI impact: no

## Objective

Give Today one local read that returns everything the Progress card shows:
this week's and last week's sessions, working sets and PRs; this month's and
the previous month's cumulative working sets by day; and the latest completed
session's summary. Pure TypeScript over the local database, covered by Jest.

## Scope

- In: a progress-summary module (repository + pure aggregation), a local
  calendar-week/month bounds helper, a PR-in-window counter, the latest-session
  summary, Jest.
- Out: any UI (T02); group data (T03); top-weight PRs.

## Decided

- D2 working sets, D3 local calendar weeks/months and "same day of month", D4
  the existing 1RM PR rule (milestone).
- Reuse, don't fork: `createDrizzleStatsStore().loadAggregationInput` +
  `aggregateStats` (`src/data/stats.ts`) for sessions and working sets; the
  working-set rule is `isWorkingSetType` / `countMuscleAnalyticsWorkingSets`;
  PRs build on `deriveSessionPersonalRecords` and the session-insights
  repository (`src/session-insights/`).

## Open — resolve with the user at session start

1. **PR counting cost.** Replay all completed sessions up to the window end
   with a running best per exercise definition, or persist/cached bests?
   Measure on a large fixture history first.
2. **Module shape.** One `loadTodayProgress(now)` returning a view model, or
   separate week / month / latest reads the card composes?
3. **Latest session fields.** Extend `createDrizzleSessionListStore` (working
   sets, exercise names) or call `loadCompletedSessionInsights` for the one
   session (gives PRs too)?
4. **Projection.** Linear (`so far / day × days in month`) or something
   smarter? The target shows a single projected total.

## Deliverables and acceptance

1. Local Monday-start week bounds and calendar-month bounds (DST-safe), exported
   and tested across a DST change and a month boundary.
2. This week / last week: `sessions`, `workingSets`, `prs`.
3. This month / previous month: per-day cumulative working sets, the previous
   month's value at the same day, its full-month total, session and PR counts to
   date, and the projection.
4. Latest completed session: id, start stamp, duration, gym, working sets,
   exercise count, leading exercise names, PR count.
5. Deleted sessions, active sessions, warm-ups and unconfirmed sets excluded
   per the existing rules; empty history returns an explicit empty state.
6. Jest covers each of the above, including the PR rule's edge cases (first
   session of an exercise, a tie, two PRs on one exercise in one session).

## Specs to update

- None: no UI changes. The counting rules (D3/D4) graduate into `ux-rules.md`
  with T02, which ships them to users.

## Gates

Expected from `./boga test for`: `fast`; before the PR `jest-coverage` and
`complexity` (AGENTS.md rule 3).
