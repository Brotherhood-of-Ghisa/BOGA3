# Muscle

### muscle.set-count · definition · accepted

Every screen counts working sets per muscle as **primary 1, secondary ½**.
Decided 2026-10-09.

A repeated mapping counts at its strongest role. Totals use half-steps (`1.5`),
unlike the session's physical `Sets` ([[set.count-display]]). Whether to show
secondaries is separate ([[muscle.secondary-filter]]).

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

### muscle.map-area · presentation · superseded-by: muscle.progress-layout

Progress dropped the Map view.

### muscle.map-colour · presentation · superseded-by: muscle.progress-layout

Progress dropped the Map view.

### muscle.progress-layout · presentation · accepted

Both Progress breakdowns use Settings → Progress → Progress view (`List` /
`3D`, default `List`), remembered per account on this device. Exercise
and Muscle share it; Exercise 1RM uses List for 3D.
3D shades each muscle on the 5-step `viz0..viz4` ramp relative to
the period's top muscle (`0`/unavailable → `viz0`; Exercise sums filtered
exercises by [[muscle.set-count]]), and tapping a muscle scopes the exercise
list below. Progress has no layout selector; changing layout keeps filters,
selection and scroll. Approved 2026-10-20.

A saved retired Map choice falls back to List. 3D contribution tables show
individual exercises without subtotals.

Why: keep List/3D choice in Settings and shade the 3D body by relative distribution.
Code: `apps/mobile/components/preferences/progress-settings.tsx`,
`apps/mobile/components/stats/muscle-body-projection.ts` and `apps/mobile/app/(tabs)/progress.tsx`.

### muscle.secondary-filter · presentation · accepted

Progress and muscle history Filters offer `Count secondary sets`, on each visit;
history opens on Progress's choice. Off, muscle figures count primary work only.
Approved 2026-10-23.

Why: direct muscle work alone.
Code: `withoutSecondaryMappings` in `apps/mobile/src/data/muscle-analytics.ts`.

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


### muscle.exercise-map-area · presentation · superseded-by: muscle.progress-layout

Progress dropped the Map view.

### muscle.exercise-map-colour · presentation · superseded-by: muscle.progress-layout

Progress dropped the Map view.

### muscle.catalog-names · presentation · accepted

Catalog labels use the following names; custom names remain. Approved 2026-10-21.

| Muscle ID | Label |
| --- | --- |
| `forearms_grip` | Forearms |
| `abs_rectus` | Abs |
| `hip_abductors` | Hip Abductors |

Why: keep muscle labels concise.
Code: `apps/mobile/src/data/exercise-catalog-seeds.ts` and `apps/mobile/src/data/bundle-migrations.ts`.
