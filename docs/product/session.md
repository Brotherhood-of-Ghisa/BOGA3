# Session

### session.history-weeks · presentation · accepted

Sessions lists the completed sessions newest first in the calendar weeks of
[[comparison.window]], each in the week it completed, as Progress and Today
count it.

| Element | Shown |
| --- | --- |
| Week heading | `This week` and `Last week` with Today's range, then the count (`Mon 6 – Sun 12 · 2 sessions`); an older week is its range with the month (and the year when not this one), then the count |
| Count | the sessions that count ([[set.eligibility]]); a deleted session shown by `Show deleted sessions`, or one without a working set, is listed, never counted |
| Empty weeks | no heading: each run of them is one line, `No sessions · N weeks`, above the next listed week, and above the first when the weeks since it are empty |
| Row | Today's session row (stamp · duration @ gym, working sets · exercises, the PR line) without a chevron; the whole row opens the completed session and has no other action |
| Show deleted sessions | a switch row behind the header's ⋮; a deleted row is faded and tagged `Deleted`, and is restored on the completed session |

Examples, read on Thu 8 Oct 2026 at 12:00, sessions completing at 18:00
unless a time is given; `/` separates the lines shown, top to bottom.

<!-- fact-table: session.history-weeks -->
| Sessions completed | Shown |
| --- | --- |
| Wed 7 Oct, Mon 5 Oct | This week · Mon 5 – Sun 11 · 2 sessions |
| Mon 5 Oct 00:00, Sun 4 Oct 23:59 | This week · Mon 5 – Sun 11 · 1 session / Last week · Mon 28 Sep – Sun 4 Oct · 1 session |
| Wed 7 Oct, Wed 9 Sep | This week · Mon 5 – Sun 11 · 1 session / No sessions · 3 weeks / Mon 7 – Sun 13 Sep · 1 session |
| Sat 3 Oct | No sessions · 1 week / Last week · Mon 28 Sep – Sun 4 Oct · 1 session |
| Thu 3 Sep | No sessions · 5 weeks / Mon 31 Aug – Sun 6 Sep · 1 session |
| Wed 7 Oct, Mon 5 Oct deleted | This week · Mon 5 – Sun 11 · 1 session |
| Wed 7 Oct, Mon 5 Oct no working set | This week · Mon 5 – Sun 11 · 1 session |
| Wed 31 Dec 2025 | No sessions · 40 weeks / Mon 29 Dec 2025 – Sun 4 Jan 2026 · 1 session |
| Wed 15 Oct 2025 | No sessions · 51 weeks / Mon 13 – Sun 19 Oct 2025 · 1 session |

Why: one week means one thing across Progress, Today and Sessions, and a
break in training reads as one line instead of a run of empty headings.
Code: `groupSessionsByWeek`, `historyWeekHeading` and `formatEmptyWeeks` in
`apps/mobile/components/session-list/history-weeks.ts`; `HistoryList` in
`apps/mobile/components/session-list/history-list.tsx`.
Signature: `No sessions · `

### session.history-open · presentation · accepted

A tap on an exercise or muscle history grid opens the sessions behind it.

| Tapped | Opens |
| --- | --- |
| A day with one session | that completed session |
| A day with several sessions | Sessions, at that day's newest session |
| A Daily Week tile or a Weekly row with training | Sessions, at that week's heading |
| A rest day or a rest week | nothing: it is not a button |

Sessions opens whole, as [[session.history-weeks]] lists it, only scrolled:
nothing is filtered or hidden. A day without a listed session opens at its
week's heading; a week without one opens at the top.

Why: the grid shows where training happened; a tap should reach those
sessions in the one history the user already knows.
Code: `DailyHeatmap` in `apps/mobile/components/heatmaps/DailyHeatmap.tsx`;
`historyDayHref` in `apps/mobile/src/navigation/routes.ts`;
`historyJumpLocation` in `apps/mobile/components/session-list/history-jump.ts`;
the openers in `apps/mobile/app/progress-history.tsx`.

### session.volume-comparison · presentation · accepted

Session Summary, live comparison and the share image use the same volume
card. The name and set count share a row.
After six known prior comparable sessions, show P25, Median and P75 as
vertical marks, current Volume as a black dot and its median delta. Genuine zero history
counts. Prior sessions use Settings' History look-back and
[[comparison.history-window]], anchored to the completed session's End or now
while active. The start is inclusive; the target and later sessions are excluded,
with earlier IDs breaking equal-End ties. Set eligibility is unchanged; record
baselines remain all-time.

The linear scale centers the median and includes the current reading.
Each reference label sits above its mark, its value below. If annotations
overlap or extend beyond the bar, keep only Median and its value; the marks
and current dot remain. Equal quartiles collapse to one mark.

A card is drawn only for an exercise or muscle that has the observations.
The rest get no card: one secondary card closes the section, stating
`Comparison unavailable — needs at least 6 sessions` and listing their names
in session order, names only. An unavailable Volume is listed there too. A
session with nothing to compare shows that card alone; the share image
carries the drawn cards only and omits its volume section when there are
none. There is no prior-session subtitle or comparison footnote.

A pending or failed history read is never drawn as a session without
history: the section says `Loading comparisons…` or
`Comparisons unavailable. Return to this session to retry.`, on the
completion screen as on Session Summary. The facts, sets by muscle, records
and the share image do not wait on that read.

Why: an empty distribution plot reads as a broken card, so the section shows
a comparison or says plainly that it has none.
Code: `ExerciseVolumeCard` in
`apps/mobile/components/session-complete/exercise-volume-card.tsx`;
`ComparisonUnavailableCard` in
`apps/mobile/components/session-complete/comparison-unavailable-card.tsx`;
`partitionVolumeComparisons` in
`apps/mobile/src/session-insights/volume-reference.ts`;
`apps/mobile/src/session-insights/calculations.ts`;
`apps/mobile/src/utils/history-reference.ts` shares the cutoff with the
weekly heatmap.
Signature: `Comparison unavailable`
