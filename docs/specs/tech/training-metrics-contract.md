# Training metrics contract

How the app, the group evaluator and the coaching API implement the product
facts on sets and 1RM (`docs/product/`), and the rules for sessions, records
and totals that have no fact yet. A fact is cited as `[[id]]`, never restated
here; other specs link here for the code.

| § | Definition | Code |
| --- | --- | --- |
| 1 | Counted set (a *working set*) | `isWorkingSet`, `apps/mobile/src/exercise-calculations/set-semantics.ts` |
| 2 | Counted session | `isCountedSession` / `countedSessionIds`, same file |
| 3 | Records (Volume, 1RM, Weight) | `apps/mobile/src/exercise-calculations/records.ts`; session bests in `best-set.ts` |
| 4 | Calculations and display (parse, load, Volume, 1RM, top weight, precision) | `parse.ts`, `load-metrics.ts`, `index.ts` (`estimateOneRepMax`), `format.ts` in `apps/mobile/src/exercise-calculations/` |

`apps/mobile/__tests__/metrics-single-source.test.ts` fails when the rules
below are re-implemented. It checks for an effort-label comparison outside
the effort labels, `isWorkingSetType` read alone outside the settled-performance
sites, and the Wathan constants outside the 1RM estimate.

## 1. Counted set

What a confirmed performed set is: [[set.performed]]. Which of them are
*working sets* and *volume-included sets*, personally and for groups and
coaching: [[set.eligibility]].

- **Valid** is decided by one parser, `apps/mobile/src/exercise-calculations/parse.ts`
  ([[set.performed]]): `42.` and `.5` are valid Weights; `1e3`, `0x10` and
  negatives are not. The input fields' validation, the performed check and
  every calculation all call it.
- **Personal effort policy** ([[set.eligibility]] gives its defaults):
  Settings has fixed Warm-up, Unspecified, RIR-4 through RIR-0, Technique and
  Cooldown rows, with independent Display, Working set and Volume columns.
  All labels default displayed. At least one Display choice is required;
  either calculation column may be empty. Hidden labels can contribute, and
  visible labels can be excluded. Recorded labels stay intact and do not
  become selectable options.
- **Scope**: these choices are account-local on this device. Personal adapters
  pass the durable active policy explicitly to the kernel. Groups and coaching
  receive no device policy: the kernel's default, `SHARED_EFFORT_POLICY`
  (`effort-policy.ts`), applies; no group settings are displayed. The weekly
  muscle target grades working-set counts and never changes eligibility.
- Per-set figures ignore the policy ([[set.row-figures]],
  `calculateSetMetrics`). Changing the policy recalculates personal history
  and records without rewriting workouts.

**Code.** The predicates are `isWorkingSet` and `isVolumeSet`, taking an optional
explicit effort policy. Its working-set effort half, `isWorkingSetType`,
is read alone only where performance is already settled:

- the group evaluator's stored `working` flag on each set fact;
- projections of performed sets.

Aggregations apply the two policies at the source:

- `workingSetsOnly` (`exercise-calculations/analytics.ts`);
- `collectMuscleSetContributions` (`data/muscle-analytics.ts`), which carries
  independent working and volume eligibility;
- `eligibleSetsByBlockInSessionOrder` (`exercise-calculations/best-set.ts`).

The agent API imports the same modules with the shared default. SQL never
re-implements the rule: group functions read the evaluator's `working` flag
(`tech/groups-contract.md`). A change to the shared rule reaches stored group
facts only as that contract's rules-version section says. Changing personal derivation bumps
`EXERCISE_SESSION_FACTS_RULES_VERSION`; each facts read also compares its stored
canonical policy key, rebuilding all definitions when the active choices differ.

## 2. Counted session

A completed, non-deleted session counts as [[set.eligibility]] says. Scoped
to one exercise, or to one muscle, the same rule applies to that exercise's
sets, or to the sets mapped to that muscle. A scope with no working set adds no counted session, working-set cell,
strength record, comparison baseline or `Last` date. It may still contribute to
volume totals, volume heatmap cells and Volume records when it has a
volume-included set. A scope with neither kind contributes nothing.

**Code.**

- `isCountedSession(sets, read)` decides one session from its sets.
- `countedSessionIds(rows, read)` collects the counted sessions from set rows.
- `countedMuscleAnalyticsSessionIds` applies the rule to the stats
  aggregation input.

An aggregate that reads only working sets may instead count the distinct
sessions those sets come from. That is the same rule, not a second one: the
facts table, catalog stats, heatmaps and session comparisons work this way.
Nothing counts sessions from `sessions.length` or from session status alone.

**Counted-session statistics.**

| Figure | Scope |
| --- | --- |
| Stats `Sessions` and its previous-period delta | whole session |
| Today week and month `Sessions` | whole session |
| Exercise row `Last:` and `<n> sessions`, favourites, Stats exercise table session count | per exercise |
| Exercise and muscle heatmap cells, exercise block history (and its `limit`), session-comparison baselines | per exercise / per muscle |
| Exercise session facts rows | per exercise, with either working or volume-included sets; rows with zero working sets do not imply a counted session |
| Agent API exercise context, `exercise_count` | per exercise |
| Group week summary and board counts | the group functions over facts with `working` (`tech/groups-contract.md`) |

**Lists, not statistics.** These show sessions, not counts:

- the sessions list;
- Today's latest-session card and its empty state;
- exercise history cards;
- a group's latest session.

They follow their own listing rules and may include a session that does not
count. A filter chip counts the cards it would show: the exercise history's tag
and gym chips count rows with a performed set.

## 3. Records

A record is a lifter's all-time best for one exercise definition. Which sets
can take each kind is [[set.eligibility]]; a Volume record may come from a
session with zero working sets. There are three kinds:

| Record | A session's value | Beats the record when |
| --- | --- | --- |
| 1RM | its best estimated 1RM ([[1rm.formula]]), over every block | strictly higher |
| Weight | its top Weight: the highest raw entered kg, and at that kg the most reps | heavier, or as heavy with more reps |
| Volume | its total volume-included volume, every block summed; only when complete | strictly higher |

- **Order.** Sessions are folded by `completed_at`, then session id. Within a
  session, a tie between sets goes to the first set in session order (block,
  then set).
- **Baseline.** The first session with a value sets the record and is not a
  record itself. A tie never takes a record, so a record tied across sessions
  belongs to the earliest session.
- **Zero.** A zero 1RM ([[1rm.formula]]), Weight or Volume is never a record,
  never a baseline and never ranks. Nothing beats a zero, and a zero beats nothing. An
  incomplete volume neither sets nor raises the Volume record.
- **Scope.** By default every gym's sessions count. Where a screen offers the
  current-gym filter (today only the exercise page), only that gym's sessions
  count. A completed session being edited, and an active session, are compared
  only with the sessions before it.
- **A session's PRs** are one per record kind each exercise took, so one
  exercise adds up to three (1RM, Weight and Volume). Every screen that counts
  a session's PRs, or PRs over a period, counts these
  (`sessionRecordKinds`). A group session's count is its group records, one
  per board taken (`tech/groups-contract.md`).
- **The record set of a session** is the one set the share image lists for an
  exercise. Among the session's working sets of the exercise,
  across every block, it is the highest 1RM that beats the 1RM record. When no
  1RM does, it is the heaviest Weight that beats the Weight record. A tie keeps
  the set that reached the value first. Volume has no set: its record is a
  whole session's.
- **A session's record sets** ([[set.row-figures]]) are every set that took a
  record: the session's best 1RM when it beats the 1RM record, and its top
  Weight when it beats the Weight record. One set may take both. Volume adds no set
  (`deriveExercisePersonalRecord`).

**Code.** `records.ts` holds the whole rule:

- `beatsRecord` and `beatsWeightRecord` decide what beats a record (the zero
  rule included);
- `createRecordBook` is the fold. It returns each session's flags and the
  holders;
- `sessionRecordKinds` lists the PRs an exercise's flags make;
- `deriveExercisePersonalRecord` (`session-insights`) takes a session's
  record sets and Volume;
- `compareRecordOrder` is the fold's order.

`summarizeSessionBests` (`best-set.ts`) gives a session's values. These all
read the rule:

- the exercise session facts' PR flags (`05-data-model.md`);
- the records panel and all-time bests (`loadExerciseBests`);
- the comparison baselines (`loadEarlierBestsByDefinition`);
- the exercise page, session view and completion markers;
- the agent API's `personal_records`.

Changing personal derivation bumps `EXERCISE_SESSION_FACTS_RULES_VERSION`.
Changing the shared coaching rule also bumps the agent API's `metric_revision`.

**What each screen shows.**

| Screen | Records shown |
| --- | --- |
| Exercise page records panel, exercise history `All-time bests` | All three holders, each with its session and gym |
| Exercise page set list, session view, completed-session cards and completion | Every record kind: the record sets and Volume (`deriveExercisePersonalRecord`; the session cards from `loadEarlierBestsByDefinition`) |
| Share image | The record set: 1RM, else Weight. An exercise with only a Volume record is not listed |
| Today `PRs` and the latest session's PR line | Every record kind (`pr_e1rm`, `pr_weight`, `pr_volume`), one PR each. The line names a single PR (`Bench Press 1RM 102.5 · PR`) and only counts several (`3 PRs`) |

Every screen that shows a record set highlights it as [[set.row-figures]]
says: the 1RM record's 1RM and the Weight record's Weight. Every band reads the same words
(`session-insights/record-band.ts`).

Group boards keep their own contract (`tech/groups-contract.md`), but follow
the same zero rule.

## 4. Calculations

**Parsing** (`parse.ts`) implements the validity of [[set.performed]]; blank
Weight becomes `0` in `canonicalizeWeightForReps`. Invalid input never becomes
zero. The parser is the only one: field validation, the performed check (§1)
and every figure call it.

**Load** (`load-metrics.ts`). The definitions:

- `E` is the entered Weight in kg;
- `B` is the applicable bodyweight in kg;
- `c` is the applicable contribution fraction;
- `F = 1` for `total_load` and `F = 2` for `per_side_load`.

The bodyweight policy (`tech/bodyweight-load-contract.md`) decides `c` and `B`.

Ordinary policy, a disabled preference, or `c = 0`:

```text
calculated load = E
Volume          = E × reps
displayed 1RM   = estimateOneRepMax(E, reps)
```

`loadInputMode` does not rescale ordinary Volume or 1RM.

The enabled preference with `c > 0`:

```text
calculated load = c × B + F × E
Volume          = calculated load × reps
total 1RM       = estimateOneRepMax(calculated load, reps)
displayed 1RM   = (total 1RM - c × B) / F
```

Bodyweight is counted once. Per-side entry doubles only the external Weight in
the positive-contribution branch. Screens show Weight, 1RM and Volume, never
the calculated-load breakdown.

**1RM** (`estimateOneRepMax`, `index.ts`) implements [[1rm.formula]].

- Only positive integer reps are eligible.
- Negative or non-finite Weight is rejected, as are a contribution outside
  `[0, 1]`, an invalid distribution and non-finite or overflowing results.
  The contribution range and the load-mode check also guard the exercise
  editor in `src/exercise-core`. That layer stays import-free for Deno, so it
  keeps its own one-line copy on purpose (agreed 2026-10-03).
- A zero load gives Volume `0` too: valid, but never a record (§3).

**Top weight** is the highest raw entered Weight in kg, and at that weight the
most reps among working sets (§3). It never includes the bodyweight contribution.
Bodyweight contribution and reading edits do not change it; Working set effort
choices may change which recorded set qualifies.

**Totals.**

- A session's or exercise's Volume is the sum over its volume-included sets (§1)
  (`summarizeVolume`).
- When a set's load is unknown, the total is a known subtotal, with coverage
  shown as `Known subtotal from X of Y included sets`. Decided to go: such a
  set is left out and no note shows ([[copy.no-inline-explanation]],
  `Pending:`).

**Muscle volume.**

- It is per side.
- Ordinary total input contributes `E / 2` per side, and per-side input
  contributes `E`.
- With a positive contribution, it first resolves the total `c × B + F × E`,
  then halves it.
- The mapping role factor (primary `1`, secondary `0.5`) applies afterwards.

**A muscle's set count** is [[muscle.set-count]], an open fact: today the
session summary's Sets by muscle and Progress muscle comparisons count
differently, as its table shows. In both, a set counts once per muscle at its
strongest role (duplicate mappings use the strongest role for that
exercise/muscle pair), and a stabilizer adds nothing
(`summarizeCurrentSessionMuscleLoad`; `progress-comparisons.ts`). In
Progress the role factor applies only to Volume. Family counts deduplicate
physical sets; overlapping individual muscle counts must never be summed into
a global total.

`computeProgressComparisons` (`src/data/stats.ts`) loads one local graph and
durable active effort-policy snapshot in one read transaction for both calendar periods, using the
same bounds as `computeStatsSummary`. `aggregateProgressComparisons`
(`src/data/progress-comparisons.ts`) derives individual muscles and their
exercise contributions together. It retains the whole taxonomy, joins repeated
blocks by definition ID, and keeps the union of contributing exercises in
either period. Current definition names label those IDs; a recorded name is a
fallback, never an identity join. Current mappings reinterpret both periods.
Unlinked sets contribute no muscle/exercise row, as in the existing muscle
analytics. A volume-only exercise remains a contributor even at zero load.

Every period exposes working-set count, complete Volume or `null`, known
subtotal, and known/included Volume-set counts. Counts, Volume and coverage
reconcile with the contribution rows; unknown Volume stays incomplete rather
than becoming zero (today's code; the decision to leave such sets out is
[[copy.no-inline-explanation]], `Pending:`). Working-set changes are signed absolute differences.
Volume changes use each row's own baseline: `empty` for two zeros, `new` for
positive Volume after zero, rounded percentage otherwise, `incomplete` when
either total is unknown, and `increased` if the percentage overflows. Row
percentages are never summed. Calculation-column eligibility is independent
of Display (§1); zero working sets alone cannot establish Volume emptiness.

No derived figure is written back to a set or session.

**Display** (`format.ts`). Every figure has one format on every screen, the
groups' included. Figures have no unit and no thousands separators; a sentence
adds ` kg` itself.

| Figure | Format | Example |
| --- | --- | --- |
| Weight (entered, top, group Weight) | as entered, one decimal on whole kg | `60.0`, `82.5`, `2.25` |
| 1RM (personal and group) | one decimal ([[1rm.formula]]) | `104.7` |
| Volume | whole kg·reps | `2560` |

The agent API, the group evaluator and the SQL group functions call this
kernel rather than copying it; the SQL load factor matches
`metric-contract.ts` (`groups-bodyweight.sh` vector).

## 5. Versioned group competition representation

[The competition contract](group-competition-contract.md) specifies best
**single-set** Volume rankings, distinct from personal session-total Volume
records in §3. It uses this kernel's effective total-load Volume/estimated 1RM
and the same private dated B for public percentages; ordinary group scores
convert source entered units to the declared group target. Display rounding does
not determine competitive rank. Versioned worker/publication and safe readers
are implemented and remain pending after installation until service-only
activation. Compatible UI and authorized hosted release remain separate.
Personal/coaching calculations,
raw kg storage and existing records retain their current semantics.
