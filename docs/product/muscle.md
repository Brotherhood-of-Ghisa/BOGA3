# Muscle

### muscle.set-count · definition · accepted

Every screen counts working sets per muscle as **primary 1, secondary ½**.
Decided 2026-10-09.

A muscle counts a set once, at the strongest role any of its entries has
([[muscle.report-groups]]).
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

### muscle.secondary-filter · presentation · accepted

Progress and muscle history Filters offer `Count secondary sets` per visit:
Progress opens on Settings' default, history on Progress's. Off counts primary
work only.

Code: `withoutSecondaryMappings` in `apps/mobile/src/data/muscle-analytics.ts`.

### muscle.report-groups · definition · accepted

Settings → Muscles offers **Detailed** (default: one muscle per
anatomy entry) or **Broad**, per account, synced. Detailed's Enabled muscles
page holds the switches. A preset changes merging, never a switch; merges
matching neither read `Custom`. Broad merges entries (first listed is the anchor);
Other entries and custom muscles stay their own.
A merged muscle is enabled while any entry is tracked; untracked entries' work still drops. Each muscle stays in one family.


Why: a simpler view.
Code: `BROAD_MUSCLE_PRESET` in `apps/mobile/src/data/muscle-report-presets.ts`; `applyMuscleReport` in `apps/mobile/src/data/muscle-analytics.ts`; `apps/mobile/components/preferences/muscle-settings.tsx`.

### muscle.weekly-targets · definition · accepted

Weekly working-set targets repeat until changed, per account on this device.
Single uses the default for every muscle; Per muscle uses an override or the
live default. Broad and Detailed remember separate overrides; Custom setups
keep their own. Mode changes and disabling a muscle retain its overrides.
Targets list only enabled reported muscles, including custom muscles. Clearing
an override restores inheritance; targets are positive whole numbers.

History Sets target grading, Progress Sets references and Today's Plan week
column use the effective target of each reported muscle, scaled to the period.
Counting is unchanged.

Why: individual training goals without losing a shared fallback.
Code: `apps/mobile/src/preferences/muscle-targets.ts`; `deriveRecoveryRows` in `apps/mobile/src/today-plan/calculations.ts`.

### muscle.no-breakdown · presentation · accepted

Every screen, the exercise editor and search show only the user's muscles, never
an entry inside its muscle. An exercise mapped to two entries of one muscle shows
it once, at the strongest role. Adding a muscle maps its anchor; changing a role
or removing it rewrites every entry of the muscle. Mappings to untracked muscles
are hidden and kept.

Why: a merged entry is gone, and an edit never deletes what the user cannot see.
Code: `resolveEditorMappings`: `apps/mobile/src/exercise-catalog/editor-model.ts`; `buildMuscleSetup`: `apps/mobile/src/exercise-catalog/muscle-setup.ts`; `apps/mobile/src/exercise-catalog/reported-muscles.ts`; searches: `apps/mobile/src/exercise-catalog/search.ts`.

### muscle.untracked · definition · accepted

An untracked muscle adds nothing to any muscle figure and is not shown. Exercise
figures (sets, Volume, records, 1RM) do not change. No line reports the dropped work.

Why: the user chose not to follow that muscle.
Code: `applyMuscleReport` in `apps/mobile/src/data/muscle-analytics.ts`.

### muscle.family-sections · presentation · accepted

In any list of muscles a family header shows only above two or more of the user's
muscles; catalogue and picker cards stay one per family.

Why: a header over one muscle repeats it.
Code: `apps/mobile/components/stats/progress-tables.tsx`.
