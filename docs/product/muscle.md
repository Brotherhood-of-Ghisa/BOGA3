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

Both Progress breakdowns use Settings → Progress → Progress view, offering
List / Map and defaulting to List. The choice is remembered per account on this
device, including new launches. Exercise Sets/Volume and Muscle share it;
Exercise 1RM uses List without changing the saved choice. Progress has no layout
selector. Changing the choice keeps period, metric and selection. Returning from
history retains the chosen layout and scroll. Approved 2026-10-18.

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


### muscle.exercise-map-area · presentation · accepted

Progress Exercise's heatmap keeps the fixed family frames ([[muscle.map-area]]).
Within each family, named primary exercises get full current-period Volume or
working-set area, once per exercise. Each primary family repeats that value.
One Secondary aggregate sums half the full exercise values for exercises with
secondary mappings and no primary anywhere in that family, once per exercise
regardless of mapped muscle count. Both use the same exercise units and
independent metric eligibility ([[set.eligibility]]). Zero/unavailable values
have no area; detail rows retain them. Secondary contributor rows show weighted
figures but open full exercise history. Approved 2026-10-18.

Why: exercise size shows its work while secondary work remains visible without duplicating primary work within a family.
Code: `apps/mobile/components/stats/exercise-map-data.ts`.

### muscle.exercise-map-colour · presentation · accepted

Exercise-map Volume colours compare each primary exercise's own periods and
Secondary's combined weighted periods. Unavailable operands or overflow keep
an aggregate unavailable. Sets colours average capped muscle target attainment:
primary tiles use their primary muscles in that family; Secondary uses muscles
reached by secondary-only exercises with working sets in either period,
selected before search/gym filtering. Muscle counts follow [[muscle.set-count]]
over all gyms. Neither search nor gym changes target colour. Settings' weekly
target multiplies by selected calendar weeks, including the unfinished week
in full. Readable Sets rows show and announce target attainment. Approved 2026-10-18.

Why: target colour describes the represented muscles while Volume compares the work shown.
Code: `apps/mobile/components/stats/exercise-map-data.ts` and
`apps/mobile/src/preferences/targets.ts`.
