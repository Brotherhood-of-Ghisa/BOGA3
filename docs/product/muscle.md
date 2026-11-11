# Muscle

### muscle.set-count · definition · accepted

Each Primary muscle gets one working set; each Secondary gets ½ when included
([[muscle.secondary-filter]]). A reported muscle counts each physical set once
at its strongest role. Recovery family totals sum unrounded eligible child
muscle counts for each day and the week; other family figures deduplicate.
Neither sum is a physical-session total.

Volume shares its base equally among Primaries, plus a shared ½ pool among
included Secondaries. Allocation precedes filtering and combining; hidden
entries never redistribute shares. Combined muscles sum surviving Volume, including
mixed roles. Absent pools remain unused. Stabilizers and stored weights add
nothing. Exercise figures are unchanged.

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

Each muscle (catalogue entry or custom) is Off, On on its own, or in one
**combined muscle**, per account, synced. A combined muscle has a name and one
family; only that family's muscles join it, one member is enough, and a member
of another family reads as its own muscle. It reports under its own id, never an
entry's. Detailed is no combined muscles; "Start from Broad" replaces them with
the Broad template's 11, leaving Off muscles out. Deleting one returns its
members to their own muscles. A combined muscle counts its tracked members as
[[muscle.set-count]] says; untracked members' work still drops.
Accounts set up before combined muscles read their Broad choice as the template's
combined muscles until a device stores it (once: after its first sync or setup change); older
app builds then see those members as their own muscles.
The separate `Group by muscle family` switch arranges reported muscles in
Progress and Recovery; it never exposes anatomy inside a combined muscle.

Why: users merge what they train together, without a fixed preset.
Code: `apps/mobile/src/data/combined-muscles.ts`; `apps/mobile/src/data/muscle-report-setup.ts`; `apps/mobile/src/data/muscle-report-settings.ts`; `applyMuscleReport` in `apps/mobile/src/data/muscle-analytics.ts`.

### muscle.weekly-targets · definition · accepted

Weekly working-set targets repeat until changed, per account, synced: a
change reaches every signed-in device on its next sync. On upgrade the first
device to sync uploads its targets (of two at once, the later wins); a device
finding them adopts them, replacing its own. Single uses the default for
every muscle; Per muscle uses an override or the live default. Overrides are
one map by reported muscle, kept across setup changes, so a combined muscle has
its own target and its members keep theirs for when they are on their own.
Older per-setup overrides migrate once: the setup the account was in keeps its
targets, Broad ones moving to their combined muscle. Mode changes and disabling
a muscle retain its overrides. Targets list only enabled reported muscles,
including custom muscles. Clearing an override restores inheritance; targets
are positive whole numbers.

History Sets target grading and Today's Plan week column use the effective
target of each reported muscle, scaled to the period.
Counting is unchanged.

Why: individual training goals without losing a shared fallback.
Code: `apps/mobile/src/preferences/muscle-targets.ts`; `legacyMuscleTargets` in `apps/mobile/src/data/combined-muscles.ts`; `deriveRecoveryRows` in `apps/mobile/src/today-plan/calculations.ts`; `apps/mobile/src/sync/muscle-target-adoption.ts`.

### muscle.no-breakdown · presentation · accepted

Every screen, the exercise editor and search show only the user's muscles, never
an entry inside its muscle. An exercise mapped to two entries of one muscle shows
it once, labelled by the strongest role. Adding a muscle maps its first tracked
member by sort order. Changing a role or removing it rewrites
tracked entries of the muscle. Mappings to untracked muscles are hidden and kept.

Why: a merged entry is gone, and an edit never deletes what the user cannot see.
Code: `resolveEditorMappings`: `apps/mobile/src/exercise-catalog/editor-model.ts`; `buildMuscleSetup`: `apps/mobile/src/exercise-catalog/muscle-setup.ts`; `apps/mobile/src/exercise-catalog/reported-muscles.ts`; searches: `apps/mobile/src/exercise-catalog/search.ts`.

### muscle.untracked · definition · accepted

An untracked muscle adds nothing to any muscle figure and is not shown. Exercise
figures (sets, Volume, records, 1RM) do not change. No line reports the dropped work.

Why: the user chose not to follow that muscle.
Code: `applyMuscleReport` in `apps/mobile/src/data/muscle-analytics.ts`.
