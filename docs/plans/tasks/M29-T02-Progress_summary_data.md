# M29-T02-Progress_summary_data — Local progress summary for Today

- Status: `planned`
- Depends on: `M29-T01-Exercise_session_facts`
- Milestone: `docs/plans/milestones/M29-today-landing-page.md`
- Areas: frontend (data layer, no UI); UI impact: no

## Objective

Give Today one local read that returns everything the Progress card shows:

- this week's and last week's sessions, working sets and PRs;
- this month's and the previous month's cumulative working sets by day;
- the latest completed session's summary.

Pure TypeScript over the local database, covered by Jest.

## Scope

- In: a progress-summary module (repository + pure aggregation), a local
  calendar-week/month bounds helper, PR counts per window read from T01's facts
  table, the latest-session summary, Jest.
- Out: any UI (T03); group data (T04); top-weight and volume PRs on Today (the
  facts table carries them, but Today shows 1RM only, D4).

## Decided

- D2 working sets, D3 local calendar weeks/months and "same day of month", D4
  the 1RM PR rule, D9 the facts table (milestone).
- **PRs come from T01's table:** the count of `pr_e1rm` rows in the window,
  which is at most one per exercise per session. Never replay history here.
- **Sessions and working sets reuse the existing aggregation, unforked:**
  `createDrizzleStatsStore().loadAggregationInput` + `aggregateStats`
  (`src/data/stats.ts`). The working-set rule is `isWorkingSetType` /
  `countMuscleAnalyticsWorkingSets`. The facts table's `working_sets` excludes
  unlinked legacy exercises, so it is not the source for Today's totals.

## From T01 (as built)

- Read API in `src/data/exercise-session-facts.ts`:
  `loadFlaggedExerciseSessionFacts({ from, to })` returns rows with any PR
  flag, `from <= achieved_at < to`, in history order (filter `prE1rm` for
  Today); `loadExerciseSessionFacts(definitionId)` returns one definition's
  rows. `achieved_at` is the session's `completed_at`.
- Each read drains the stale queue first, synchronously. There are no warm-up
  hooks: decide here whether Today needs one. Measured on an M4 Max in Node
  (better-sqlite3, median of 7), so a device will be slower: a full rebuild
  takes 51 ms on the dev rich history (221 sessions, 2,910 sets) and 582 ms at
  10× (2,210 sessions, 29,100 sets). An incremental drain after one completed
  session takes 2.5 ms and 21 ms; a warm read takes under 1 ms. A full rebuild
  runs on the first read after install, a wipe or a rules bump.

## Open — resolve with the user at session start

1. **Module shape.** One `loadTodayProgress(now)` returning a view model, or
   separate week / month / latest reads the card composes?
2. **Latest session fields.** Extend `createDrizzleSessionListStore` (working
   sets, exercise names) plus the facts table for its PR count, or call
   `loadCompletedSessionInsights` for the one session?
3. **Projection.** Linear (`so far / day × days in month`) or something
   smarter? The target shows a single projected total.
4. **Which timestamp places a session in a window.** Facts carry
   `completed_at`; check what `aggregateStats` buckets on. A session started
   Sunday 23:30 and finished Monday 00:40 must land in the same week for its
   sessions, sets and PRs. Pick one stamp and use it for all three.

## Deliverables and acceptance

1. Local Monday-start week bounds and calendar-month bounds (DST-safe), exported
   and tested across a DST change and a month boundary.
2. This week / last week: `sessions`, `workingSets`, `prs`.
3. This month / previous month:
   - per-day cumulative working sets;
   - the previous month's value at the same day, and its full-month total;
   - session and PR counts to date;
   - the projection.
4. Latest completed session: id, start stamp, duration, gym, working sets,
   exercise count, leading exercise names, PR count.
5. Deleted sessions, active sessions, warm-ups and unconfirmed sets are
   excluded per the existing rules; empty history returns an explicit empty
   state.
6. Jest covers each of the above. The PR rule's own edge cases live in T01;
   here, cover window edges (a PR exactly at a week or month boundary) and the
   Open-4 rule.

## Specs to update

- None: no UI changes. The counting rules (D3/D4) graduate into `ux-rules.md`
  with T03, which ships them to users.

## Gates

Expected from `./boga test for`: `fast`; before the PR `jest-coverage`,
`complexity` and `dependencies` (AGENTS.md rule 3).
