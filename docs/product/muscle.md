# Muscle

### muscle.set-count · definition · accepted

How many sets a muscle gets from a working set mapped to it: **primary 1,
secondary ½**. One rule, on every screen that shows sets per muscle. Decided
2026-10-09.

A set mapped to one muscle twice counts at its strongest role. A muscle's
total is the sum: a half-step figure (`1.5`), not a count of physical sets, so
the session's own `Sets` ([[set.count-display]]) does not match it. Whether
secondaries are shown at all is a separate question.

<!-- fact-table: muscle.set-count -->
| Working sets mapped to one muscle | It gets |
| --- | --- |
| 3 primary | 3 |
| 3 secondary | 1.5 |
| 2 primary, 3 secondary | 3.5 |
| 1 set, primary and secondary to that muscle | 1 |
| 4 stabilizer | 0 |

Why: one set meant two numbers depending on the screen; a secondary mapping is
real work, but not the muscle the lift is for.
Code: `summarizeCurrentSessionMuscleLoad` in
`apps/mobile/src/session-insights/calculations.ts`. Progress and the muscle
heatmaps still count every mapped set as 1 (issue #665):
`apps/mobile/src/data/progress-comparisons.ts`,
`apps/mobile/src/data/muscle-analytics.ts`, `apps/mobile/src/data/stats.ts`.
Signature: `primary + ½ secondary`
