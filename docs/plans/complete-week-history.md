# Complete-week history windows

Status: planned; implementation not started. Prepared on 2026-10-09 against
`origin/main` at `5c35714d`. This is one implementation change; delete this
plan when that work ships. This branch contains planning only: the operator
requested a commit and push, with no tests and no PR.

## Objective and agreed scope

Daily and Weekly heatmaps must load at least the saved number of complete
calendar weeks. The same saved `historyLookbackWeeks` must select the prior
sessions used for the completed-session Volume card's P25, Median and P75.
The operator clarified that “session summary” means that comparison bar,
and chose the saved heatmap look-back instead of its current all-history sample.

A week is Monday–Sunday in the device's local calendar. It is complete when
Sunday is in the past or the anchor day is Sunday. Completion here describes
calendar coverage, not the number of workouts or eligible observations.

| Anchor day | Start for N weeks | Data included |
| --- | --- | --- |
| Monday–Saturday | Monday N weeks before the current Monday | N complete weeks, followed by the current partial week |
| Sunday | Monday N − 1 weeks before the current Monday | N weeks, including the current Sunday |

For example, N=4 on Friday 9 October 2026 starts on Monday 7 September;
N=4 on Sunday 11 October starts on Monday 14 September. Daily data stops at
today; future positions remain empty.

Planning assumption: heatmaps and live comparisons anchor to now; a completed
session's comparison anchors to its `completedAt`, retaining the existing
earlier-session ordering boundary. Opening an old session must never introduce
later workouts into its baseline.

## Current implementation and product authority

- `apps/mobile/components/heatmaps/daily-calendar.ts` already implements
  [[comparison.daily-history]]: whole rows belong to Monday's month, each
  sampled date appears once, and a Daily Week tile requires all seven dates
  through Sunday. September 2026 therefore includes 1–4 October in its final
  row; October's first row starts on 5 October. Keep this layout and verify it.
- `apps/mobile/src/utils/calendar-weeks.ts` and the independent grid start in
  `apps/mobile/components/heatmaps/heatmapData.ts` currently count the ongoing
  week toward N. Before Sunday they therefore provide only N − 1 complete weeks.
- `apps/mobile/components/stats/use-history.ts` loads the sample used by
  `apps/mobile/components/stats/history-view.tsx`. Timeline consumes the same
  data as Daily and Weekly and must remain compatible with the expanded window.
- `apps/mobile/src/session-insights/repository.ts` currently reads every
  earlier completed session for comparisons. The exercise and muscle
  projections in `apps/mobile/src/session-insights/calculations.ts` already
  calculate P25/Median/P75. PR #633 introduced the median-centred card of
  [[session.volume-comparison]], matching the operator's screenshot.
- Weekly reference calculations now follow [[comparison.weekly-reference]],
  over the whole saved sample. The previous planning discussion's 12-week
  average and weekly-selection banner were based on an outdated checkout.

The Sunday-only Week-tile rule concerns the Daily calendar's aggregate tile.
Keep the Weekly view's existing current-week row and Timeline's current-week
readout; the requested change is sufficient complete-week history in their
shared sample. Keep existing sample eligibility and reference calculations.

## Implementation

1. Add one narrowly scoped complete-week history-bounds helper beside the
   existing calendar utilities. Reuse local calendar arithmetic so both DST
   transitions preserve Monday midnight. Keep `calendarWeekBounds`'s existing
   Progress semantics: [[comparison.window]] governs a different period.
   Use the helper for history reads and for the heatmap adapter's grid start.
   Respect the deterministic `todayDateKey` seam without converting a calendar
   date to a different day in another timezone. Numeric, default and `all`
   adapter windows must all satisfy the complete-week minimum.
2. Update `use-history.ts` and `heatmapData.ts` together: the queried range
   and generated dates must agree. Rest days still occupy the sample. Let
   Daily, Weekly and Timeline consume the expanded history using their existing
   layouts, colours, references and session-opening actions. The saved N
   continues to denote the minimum complete-week span.
3. Thread `historyLookbackWeeks` into the session comparison reads. Extend
   the earlier-session query with an inclusive lower bound from the shared
   helper; preserve its existing `(completedAt, sessionId)` upper boundary,
   target exclusion, completed status and deletion filters. Load the target
   graph independently of the historical cutoff. Compute both exercise and
   muscle quartiles from the bounded prior sample. Keep PR baseline reads
   all-time: a comparison window must not create false records.
4. Update every caller and data-client signature: the completed-session route
   at `apps/mobile/app/completed-session/[sessionId].tsx`, the shared history
   reader in `apps/mobile/src/session-recorder/use-session-view.ts`, and their
   test clients. Completion, historical Summary, live comparison and share
   must use the same sample. React to the active account's saved look-back;
   include it in refresh context so superseded reads cannot publish after a
   preference, target or account change. Preserve optional-enrichment errors.
5. In the implementation change, amend [[comparison.history-window]] in
   `docs/product/comparison.md` with the operator's complete-week rule and
   [[session.volume-comparison]] in `docs/product/session.md` with the chosen
   saved-window scope and time anchor. Cite those facts from affected component
   comments and the heatmap README. Follow `docs/specs/README.md` when editing
   persistent docs. The daily presentation fact already matches the request.

No new setting, dependency, schema, sync change, persisted statistic or chart
redesign is needed. The open muscle set-count decision is outside this change;
existing set eligibility and muscle weighting remain the inputs.

## UX contract and acceptance

| Flow | Trigger and steps | Success | Edge outcome |
| --- | --- | --- | --- |
| Inspect history | Open exercise or muscle history; use Daily or Weekly | N complete weeks are available; daily carry-over dates appear once; day/week taps open their existing destinations | Future positions stay empty; the current Daily Week tile appears on Sunday; loading/error/empty states retain their current behaviour |
| Inspect a session's Volume | Complete a session or open historical Summary; inspect exercise/muscle comparisons or share | P25, Median and P75 derive from eligible earlier sessions in the saved complete-week window | Fewer than six known comparable observations produce the existing low-history state; zero, equal quartiles and unavailable values retain their current handling |
| Change look-back | Save another look-back in Settings; return to history or session comparison | Queries, dates and comparison samples refresh to the same saved value | Old responses cannot replace the new account/window; an out-of-range Timeline selection clears |

The design input is the current production Daily/Weekly layouts and the
operator's Session complete screenshot with P25/Median/P75. Capture boundary
states in the running app during implementation, including small and large
phones. Store captures as ignored runtime evidence; do not commit the attachment.

## Verification for implementation

Read `apps/mobile/__tests__/README.md` and, when writing tests,
`docs/specs/writing-tests.md` first. Extend the existing suites:

- Calendar/window and heatmap data: all seven anchor weekdays, N=1, default
  and maximum windows, `all`, empty history, inclusive Monday start, month/year
  carry-over, leap February and both DST transitions. Daily calendar tests
  prove one occurrence per date and Week-tile absence before Sunday.
- History integration: real local data at both range edges, matching query
  and adapter bounds, expanded Weekly references, Timeline compatibility,
  sample changes and stale-read rejection. Use the existing daily calendar,
  heatmap data, weekly bars and progress-history suites.
- Session insights and completed-session integration: prior observations just
  inside/outside the lower bound, completion-date anchoring, same-instant ID
  ordering, excluded target/later/active/deleted sessions, exercise/muscle
  quartiles, the six-observation threshold, account preference refresh, live/
  completed/share agreement, failed optional reads and all-time PR baselines.

Proposed future lane set: `fast`, `jest-coverage`, `complexity`, `dependencies`,
`ios-data-smoke` and `ios-session-view`. Confirm lanes beyond `fast` with the
operator before running them. The two iOS lanes exercise the affected flows;
the date rules belong in Jest. New Maestro scenarios require separate
justification and approval. Run the agreed set to green before any implementation
PR; this planning branch runs none and opens none.

## Risks

The longer heatmap sample can change window-relative colours and references.
Replacing all-history session samples can change quartiles, median deltas and
whether a card has enough observations to show its bar. This changes derived
presentation only; raw sessions and sets are not rewritten.
