# Muscle

### muscle.set-count · definition · accepted

Every exercise shares one set of Primary work equally across its distinct raw
Primary mappings; each Secondary mapping gets ½, however many there are.
Decided 2026-10-30 (secondaries no longer share one ½ pool).
The same allocation applies to working sets and per-side muscle Volume.
Stabilizers contribute nothing. Stored mapping weights do not set shares.
Allocation happens before filtering or Broad grouping: merged entries add their
shares, and hidden/untracked entries never redistribute work. Exercise figures
stay unchanged ([[set.count-display]]).

Keep fractions through aggregation; every figure and spoken label shows at most
one decimal (`1.5`, `0.3`). Today and Progress show whole sets: Progress rounds,
and its change is the difference of the rounded figures. Today's Recovery floors
totals of at least one; below one, it shows `½` for a half and `<1` otherwise.

<!-- fact-table: muscle.set-count -->
| Working sets mapped to one muscle | It gets |
| --- | --- |
| 3 primary | 3 |
| 3 secondary | 1.5 |
| 2 primary, 3 secondary | 3.5 |
| 1 set, duplicate roles on the same raw muscle | 1 |
| 3 sets, one of two primaries | 1.5 |
| 1 set, one of three primaries | 0.3333333333333333 |
| 3 sets, one of two secondaries | 1.5 |
| 4 stabilizer | 0 |

Why: co-primary muscles share the lift; a secondary does half a set of work
whatever else assists.
Code: `collectMuscleSetContributions`, `countMuscleSets` and `applyMuscleReport`
in `apps/mobile/src/data/muscle-analytics.ts`; Recovery's display is `wholeSets`
in `apps/mobile/components/today/plan-cards.tsx`.

### muscle.secondary-filter · presentation · accepted

Progress's Filters (`Count secondary sets`) and muscle history's chip (`Sec` /
`Pri`, spoken `Count secondary sets`) offer counting secondary sets per visit:
Progress opens on Settings' default, history on Progress's. Off excludes Secondary sets and Volume without changing Primary shares. The default is per account, synced like [[muscle.weekly-targets]].

Code: `withoutSecondaryMappings` in `apps/mobile/src/data/muscle-analytics.ts`.

### muscle.report-groups · definition · accepted

Settings → Muscles offers **Detailed** (default: one muscle per
anatomy entry) or **Broad**, per account, synced. Enabled muscles is always
available, with individual anatomy switches and their enabled/total count,
regardless of breakdown. A preset changes merging, never a switch; merges
matching neither read `Custom`. Broad merges entries (first listed is the anchor);
Other entries and custom muscles stay their own.
A merged muscle sums its tracked entries' allocated shares; untracked entries' work still drops. Each muscle stays in one family.


Why: a simpler view.
Code: `BROAD_MUSCLE_PRESET` in `apps/mobile/src/data/muscle-report-presets.ts`; `deriveMuscleReportPreset` in `apps/mobile/src/data/muscle-report-setup.ts`; `applyMuscleReport` in `apps/mobile/src/data/muscle-analytics.ts`; `apps/mobile/components/preferences/muscle-settings.tsx`.

### muscle.weekly-targets · definition · accepted

Weekly working-set targets repeat until changed, per account, synced: a
change reaches every signed-in device on its next sync. On upgrade the first
device to sync uploads its targets (of two at once, the later wins); a device
finding them adopts them, replacing its own. Single uses the default for
every muscle; Per muscle uses an override or the live default. Broad and
Detailed remember separate overrides; Custom setups keep their own. Mode changes and disabling a muscle retain its overrides.
Targets list only enabled reported muscles, including custom muscles. Clearing
an override restores inheritance; targets are positive whole numbers.

History Sets target grading and Today's Plan week column use the effective
target of each reported muscle, scaled to the period.
Counting is unchanged.

Why: individual training goals without losing a shared fallback.
Code: `apps/mobile/src/preferences/muscle-targets.ts`; `deriveRecoveryRows` in `apps/mobile/src/today-plan/calculations.ts`; `apps/mobile/src/sync/muscle-target-adoption.ts`.

### muscle.no-breakdown · presentation · accepted

Every screen, the exercise editor and search show only the user's muscles, never
an entry inside its muscle. An exercise mapped to two entries of one muscle shows
it once, at the strongest role. Adding a muscle maps its anchor, or a tracked
entry when the anchor is untracked. Changing a role or removing it rewrites
tracked entries of the muscle. Mappings to untracked muscles are hidden and kept.

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
