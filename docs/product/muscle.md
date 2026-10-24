# Muscle

### muscle.set-count · definition · accepted

Every screen counts working sets per muscle as **primary 1, secondary ½**.
Decided 2026-10-09.

A muscle counts a set once, at the strongest role any of its entries has
([[muscle.report-groups]]): squat × 3 under Broad is Quads 3, Glutes & Hams 1.5.
Totals use half-steps (`1.5`), unlike the session's physical `Sets`
([[set.count-display]]). Whether to show secondaries is separate
([[muscle.secondary-filter]]).

<!-- fact-table: muscle.set-count -->
| Working sets mapped to one muscle | It gets |
| --- | --- |
| 3 primary | 3 |
| 3 secondary | 1.5 |
| 2 primary, 3 secondary | 3.5 |
| 1 set, primary and secondary to that muscle | 1 |
| 4 stabilizer | 0 |

Why: a secondary mapping is real work, but not what the lift is for.
Code: `countMuscleSets` in `apps/mobile/src/data/muscle-analytics.ts`, read by
the session summary, Progress, the muscle heatmaps and Stats.
Signature: `primary + ½ secondary`

### muscle.map-area · presentation · superseded-by: muscle.progress-layout

Map view dropped.

### muscle.map-colour · presentation · superseded-by: muscle.progress-layout

Map view dropped.

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

Code: `apps/mobile/components/preferences/progress-settings.tsx`,
`apps/mobile/components/stats/muscle-body-projection.ts` and `apps/mobile/app/(tabs)/progress.tsx`.

### muscle.secondary-filter · presentation · accepted

Progress and muscle history Filters offer `Count secondary sets`, on each visit;
history opens on Progress's choice. Off, muscle figures count primary work only.
Approved 2026-10-23.

Code: `withoutSecondaryMappings` in `apps/mobile/src/data/muscle-analytics.ts`.

### muscle.comparison-primary-only · presentation · accepted

A session's by-muscle volume comparison covers only muscles the session worked
as **primary for any of their entries**. A muscle trained only as a secondary has no comparison, and a
past session that trained it only as a secondary adds no baseline reading. A
primary muscle's Volume still includes its secondary work at ½
([[muscle.set-count]]). Decided 2026-10-18.

Why: a secondary mapping is real work but not the muscle the lift is for, so
comparing it against sessions that targeted it misleads.
Code: `deriveSessionMuscleVolumeComparisons` in
`apps/mobile/src/session-insights/calculations.ts`.
Pending: compares entries.


### muscle.exercise-map-area · presentation · superseded-by: muscle.progress-layout

Map view dropped.

### muscle.exercise-map-colour · presentation · superseded-by: muscle.progress-layout

Map view dropped.

### muscle.report-groups · definition · accepted

Settings → Progress → Muscles offers **Detailed** (default: every anatomy entry
is its own muscle) or **Broad**, per account, synced, with a Track switch per
muscle. Broad merges entries, the first listed being the anchor, and leaves
three untracked. Each muscle stays inside one family; custom muscles stay their own. Decided 2026-10-24.

| Broad muscle | Entries |
| --- | --- |
| Chest | Pectoralis, Serratus Anterior |
| Back | Lats, Upper back, Upper Traps, Lower Traps |
| Biceps | Biceps, Brachialis |
| Core | Abs, Obliques |
| Quads | Quads, Adductors, Hip flexors |
| Glutes & Hams | Glute Max, Hamstrings, Hip Abductors |
| Calves | Calves, Tibialis Anterior |
| Front, Lateral, Rear Delts; Triceps | one entry each |
| Untracked | Rotator Cuff, Forearms, Spinal Erectors |

Why: fewer, coarser muscles for users who want a simpler view; exercises keep their detailed mappings.
Code: `BROAD_MUSCLE_PRESET` in `apps/mobile/src/data/muscle-report-presets.ts`; `applyMuscleReport` in `apps/mobile/src/data/muscle-analytics.ts`.
Pending: Settings screen.

### muscle.no-breakdown · presentation · accepted

Every screen, the exercise editor and search show only the user's muscles, never
an entry inside its muscle. An exercise mapped to two entries of one muscle shows
it once, at the strongest role. Adding a muscle maps its anchor; changing a role
or removing it rewrites every entry of the muscle. Mappings to untracked muscles
are hidden and kept.

Why: a merged entry is gone, and an edit never deletes what the user cannot see.
Code: `apps/mobile/src/exercise-catalog/reported-muscles.ts`.
Pending: editor, search, session screens.

### muscle.untracked · definition · accepted

An untracked muscle adds nothing to any muscle figure and is not shown. Exercise
figures (sets, Volume, records, 1RM) do not change. No line reports the dropped work.

Why: the user chose not to follow that muscle.
Pending: session screens.

### muscle.family-sections · presentation · accepted

In any list of muscles a family header shows only above two or more of the user's
muscles; catalogue and picker cards stay one per family. A family without a
header lists first.

Why: a header over one muscle repeats it.
Code: `apps/mobile/components/stats/progress-tables.tsx`.
Pending: catalogue and picker lists.

### muscle.catalog-names · presentation · accepted

Catalog labels use the following names; custom names remain. Approved 2026-10-21.

| Muscle ID | Label |
| --- | --- |
| `forearms_grip` | Forearms |
| `abs_rectus` | Abs |
| `hip_abductors` | Hip Abductors |

Why: keep muscle labels concise.
Code: `apps/mobile/src/data/exercise-catalog-seeds.ts` and `apps/mobile/src/data/bundle-migrations.ts`.
