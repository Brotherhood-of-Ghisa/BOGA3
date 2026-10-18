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
Code: `countMuscleSets` in `apps/mobile/src/data/muscle-analytics.ts`, read by
the session summary, Progress, the muscle heatmaps and Stats.
Signature: `primary + ½ secondary`

### muscle.map-area · presentation · accepted

Progress muscle-map area represents fixed reference anatomy, independent of
training, period and metric. Each family's outer area is proportional to its
sum of reference muscle volumes; readability adjustments stay inside that
family. Zero-activity muscles remain represented. Approved 2026-10-17.

The reference uses published MRI means, estimated deltoid/trapezius
subdivisions and an external-oblique-only proxy for Obliques. It represents
the mapped anatomy, not personal measurements or percentages of all body muscle.

Why: a muscle must remain findable when no work was recorded for it.
Code: `apps/mobile/components/stats/muscle-map-reference.ts` and
`apps/mobile/components/stats/muscle-map-layout.ts`.

### muscle.map-colour · presentation · accepted

Progress muscle-map Sets fills grade each muscle's current working-set count
against Settings' weekly working-set target multiplied by the number of
calendar weeks selected; an unfinished week still has its full weekly target.
Active Sets tiles use the existing target ramp, capped at target attainment.
Volume fills follow the reference-period comparison. Tiles with no contributing
sets for the selected metric use the loss fill regardless of the reference
period. Volume uses volume-included-set count, so a recorded zero-load set
still counts as activity. Change values retain [[comparison.change-display]].
Approved 2026-10-18.

Why: Sets shows progress toward the configured target; unused muscles remain visible.
Code: `apps/mobile/components/stats/muscle-map.tsx`.

### muscle.progress-layout · presentation · accepted

Progress's Muscle breakdown uses Settings → Progress → Muscle view, offering
List / Map and defaulting to List. The choice is remembered per account on this
device, including new launches. Progress has no layout selector. Changing the
choice keeps period, metric and muscle selection. Returning from history retains
the chosen layout and scroll. Approved 2026-10-18.

Why: keep the optional map in Settings and the Progress controls focused on filters.
Code: `apps/mobile/components/preferences/progress-settings.tsx`,
`apps/mobile/src/preferences/model.ts` and `apps/mobile/app/(tabs)/progress.tsx`.

### muscle.comparison-primary-only · presentation · accepted

A session's by-muscle volume comparison covers only muscles the session worked
as **primary**. A muscle trained only as a secondary has no comparison, and a
past session that trained it only as a secondary adds no baseline reading. A
primary muscle's Volume still includes its secondary work at ½
([[muscle.set-count]]). Decided 2026-10-18.

Why: a secondary mapping is real work but not the muscle the lift is for, so
comparing it against sessions that targeted it misleads.
Code: `deriveSessionMuscleVolumeComparisons` in
`apps/mobile/src/session-insights/calculations.ts`.
