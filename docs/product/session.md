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
