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

Progress's Muscle breakdown starts with the muscle list. A List / Heatmap
filter opts into the boxed map and switches back without changing period,
metric or muscle selection. This choice lasts for the current visit; a fresh
launch starts with the list. Returning from history retains the chosen layout
and its scroll. Approved 2026-10-18.

Why: the list is the familiar default; the map is available by choice.
Code: `apps/mobile/app/(tabs)/progress.tsx` and
`apps/mobile/components/stats/progress-muscle-view.tsx`.

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


### muscle.exercise-map-area · presentation · accepted

Progress Exercise's heatmap keeps the muscle map's fixed family frames
([[muscle.map-area]]). Within each family, an exercise's area is proportional
to its full current-period Volume or working-set count. Membership requires
at least one current primary muscle in that family. Multiple primary muscles
in one family produce one exercise tile; primary muscles in several families
repeat its full value once in each. Zero or unavailable values take no area;
readable detail rows retain those exercises. Approved 2026-10-18.

Why: exercise size shows its work while primary mappings place it in the familiar family map.
Code: `apps/mobile/components/stats/exercise-map-data.ts`.

### muscle.exercise-map-colour · presentation · accepted

Progress exercise-map Volume colours follow each exercise's own previous-period
comparison. Sets colours inherit target attainment from its primary muscles
within that family: cap each muscle's attainment at target, then average.
Those muscle counts follow [[muscle.set-count]] over every gym, unaffected by
exercise search or gym filters. The target is Settings' weekly target times
the selected calendar weeks, including the unfinished week in full. Readable
Sets rows also show and announce attainment. Approved 2026-10-18.

Why: exercises for the same primary muscle show the same progress toward its target.
Code: `apps/mobile/components/stats/exercise-map-data.ts` and
`apps/mobile/src/preferences/targets.ts`.
