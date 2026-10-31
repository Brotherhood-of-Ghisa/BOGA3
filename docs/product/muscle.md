# Muscle

### muscle.set-count · definition · accepted

Each Primary muscle gets one working set; each Secondary gets ½ when included
([[muscle.secondary-filter]]). A reported muscle counts each physical set once
at its strongest role. Family buckets deduplicate likewise; overlapping muscle
counts never form a physical-session total.

Volume independently shares its unchanged base equally among Primaries, plus
a shared ½ pool among Secondaries when included. Allocation precedes filtering
and Broad grouping; hidden entries never redistribute shares. A merged muscle
sums surviving Volume, including mixed roles. Absent role pools remain unused.
Stabilizers and stored weights add nothing. Exercise figures are unchanged.

Figures and spoken labels show at most one decimal. Today and Progress draw
whole sets, rounded down (`½`, `<1` below one); a change is the difference of
the drawn figures.

<!-- fact-table: muscle.set-count -->
| Working sets mapped to one muscle | It gets |
| --- | --- |
| 3 primary | 3 |
| 3 secondary | 1.5 |
| 2 primary, 3 secondary | 3.5 |
| 1 set, duplicate roles on the same raw muscle | 1 |
| 3 sets, one of two primaries | 3 |
| 1 set, one of three primaries | 1 |
| 3 sets, one of two secondaries | 1.5 |
| 4 stabilizer | 0 |

Why: Sets describe direct work with optional secondary half-credit; Volume
describes attributed work with bounded role pools.
Code: `collectMuscleSetContributions`, `countMuscleSets` and `applyMuscleReport`
in `apps/mobile/src/data/muscle-analytics.ts`; the whole-set display is
`formatWholeSetCount` in `apps/mobile/src/exercise-calculations/format.ts`.

### muscle.secondary-filter · presentation · accepted

Two account-synced settings govern every muscle figure: `Sets: Primary only`
(new-account default on) and `Volume: Primary only` (default off). Existing
accounts preserve their old secondary Sets choice; the new Volume choice
starts off. Explicit saved choices survive upgrades. Targets stay unchanged.
Progress offers independent visit overrides; history inherits both and its
`Sec`/`Pri` chip changes only the displayed metric. Filtering never redistributes
Volume. Secondary-only work may show zero Sets in Recovery and positive Volume.

Code: `apps/mobile/src/preferences/`; `collectMuscleSetContributions` in
`apps/mobile/src/data/muscle-analytics.ts`.

### muscle.report-groups · definition · accepted

Settings → Muscles offers **Detailed** (default: one muscle per
anatomy entry) or **Broad**, per account, synced. Enabled muscles is always
available, with individual anatomy switches and their enabled/total count,
regardless of breakdown. A preset changes merging, never a switch; merges
matching neither read `Custom`. Broad merges entries (first listed is the anchor);
Other entries and custom muscles stay their own.
A merged muscle counts its tracked entries as [[muscle.set-count]] says; untracked entries' work still drops. Each muscle stays in one family.


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
it once, labelled by the strongest role. Adding a muscle maps its anchor, or a tracked
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
