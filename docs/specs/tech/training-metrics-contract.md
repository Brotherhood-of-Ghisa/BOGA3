# Training metrics contract

The one definition of what counts toward a training statistic, for the app, the
group evaluator and the coaching API. Other specs say which figures a screen
shows and link here for what they mean; they do not restate these rules.

| § | Definition | Code |
| --- | --- | --- |
| 1 | Counted set (a *working set*) | `isWorkingSet`, `apps/mobile/src/exercise-calculations/set-semantics.ts` |
| 2 | Counted session | `isCountedSession` / `countedSessionIds`, same file |
| 3 | Records (Volume, 1RM, Weight) | `apps/mobile/src/exercise-calculations/records.ts`; session bests in `best-set.ts` |
| 4 | Calculations and display (parse, load, Volume, 1RM, top weight, precision) | `parse.ts`, `load-metrics.ts`, `index.ts` (`estimateOneRepMax`), `format.ts` in `apps/mobile/src/exercise-calculations/` |

`apps/mobile/__tests__/metrics-single-source.test.ts` fails when the rules
below are re-implemented. It checks for a `'warm_up'` comparison outside
§1's code, `isWorkingSetType` read alone outside the settled-performance
sites, and the Wathan constants outside the 1RM estimate.

## 1. Counted set

A set counts toward a statistic when it is a **working set**. A working set
is a **confirmed performed set** whose `set_type` is not `warm_up`.

- **Confirmed performed** means valid reps and Weight, and no
  `performance_status`. Planned, unperformed and legacy-skipped rows are not
  sets for any statistic.
- **Valid** is decided by one parser, `apps/mobile/src/exercise-calculations/parse.ts`.
  - Weight is digits with an optional decimal point (`42.` and `.5` are
    valid; `1e3`, `0x10` and negatives are not).
  - Blank Weight with valid reps is `0`.
  - Reps is a positive integer.

  The input fields' validation, the performed check and every calculation all
  call this parser, so a value is valid everywhere or nowhere.
- **Effort**: untagged sets, every RIR and unrecognised stored values are
  working sets. Only `warm_up` is excluded. The rule is not configurable
  (Settings’ visible effort labels only shape the picker and tap cycle).
  One shared weekly working-set target grades each muscle’s resulting count; neither visibility nor targets
  alter eligibility, Volume, 1RM, records or counted sessions.
- A **warm-up** keeps its own per-set figures (1RM, volume) wherever sets are
  listed (`calculateSetMetrics`). It feeds no aggregate, count, record, best,
  PR or baseline.

**Code.** The predicate is `isWorkingSet`. Its effort half, `isWorkingSetType`,
is read alone only where performance is already settled:

- the group evaluator's stored `working` flag on each set fact;
- projections of performed sets.

Aggregations filter at the source, so their consumers never re-check:

- `workingSetsOnly` (`exercise-calculations/analytics.ts`);
- `collectMuscleSetContributions` (`data/muscle-analytics.ts`), which emits
  working sets only;
- `eligibleSetsByBlockInSessionOrder` (`exercise-calculations/best-set.ts`).

The agent API imports the same modules. SQL never re-implements the rule: the
group functions read the evaluator's `working` flag
(`tech/groups-contract.md`, §2.9). Changing the rule needs a
`GROUP_EVAL_RULES_VERSION` bump and an `EXERCISE_SESSION_FACTS_RULES_VERSION`
bump.

## 2. Counted session

A completed, non-deleted session counts toward a statistic when it holds **at
least one working set** (§1).

Scoped to one exercise, or to one muscle, the session counts for that scope
when it holds a working set of that exercise, or a working set mapped to that
muscle. A session, exercise or muscle with only warm-ups (or with no confirmed
set) did not happen as far as statistics go. It adds no session, cell,
baseline, comparison observation or `Last` date.

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
| Exercise session facts rows | per exercise |
| Agent API exercise context, `exercise_count` | per exercise |
| Group week summary and board counts | the group functions over facts with `working` (`tech/groups-contract.md`, §4.7) |

**Lists, not statistics.** These show sessions, not counts:

- the sessions list;
- Today's latest-session card and its empty state;
- exercise history cards;
- a group's latest session.

They follow their own listing rules and may include a session that does not
count. A filter chip counts the cards it would show: the exercise history's tag
and gym chips count rows with a performed set.

## 3. Records

A record is a lifter's all-time best for one exercise definition, over its
counted sessions (§2) and their working sets (§1). There are three kinds:

| Record | A session's value | Beats the record when |
| --- | --- | --- |
| 1RM | its best estimated 1RM (§4 formula), over every block | strictly higher |
| Weight | its top Weight: the highest raw entered kg, and at that kg the most reps | heavier, or as heavy with more reps |
| Volume | its total working-set volume, every block summed; only when complete | strictly higher |

- **Order.** Sessions are folded by `completed_at`, then session id. Within a
  session, a tie between sets goes to the first set in session order (block,
  then set).
- **Baseline.** The first session with a value sets the record and is not a
  record itself. A tie never takes a record, so a record tied across sessions
  belongs to the earliest session.
- **Zero.** A zero 1RM, Weight or Volume is never a record, never a baseline
  and never ranks. Nothing beats a zero, and a zero beats nothing. An
  incomplete volume neither sets nor raises the Volume record.
- **Scope.** By default every gym's sessions count. Where a screen offers the
  current-gym filter (today only the exercise page), only that gym's sessions
  count. A completed session being edited, and an active session, are compared
  only with the sessions before it.
- **The record set of a session** is the one set a screen highlights
  (`design-language.md` §5). Among the session's working sets of the exercise,
  across every block, it is the highest 1RM that beats the 1RM record. When no
  1RM does, it is the heaviest Weight that beats the Weight record. A tie keeps
  the set that reached the value first. Volume has no set: its record is a
  whole session's.

**Code.** `records.ts` holds the whole rule:

- `beatsRecord` and `beatsWeightRecord` decide what beats a record (the zero
  rule included);
- `createRecordBook` is the fold. It returns each session's flags and the
  holders;
- `pickSessionRecordSet` picks the record set;
- `compareRecordOrder` is the fold's order.

`summarizeSessionBests` (`best-set.ts`) gives a session's values. These all
read the rule:

- the exercise session facts' PR flags (`05-data-model.md`);
- the records panel and all-time bests (`loadExerciseBests`);
- the comparison baselines (`loadEarlierBestsByDefinition`);
- the exercise page, session view and completion markers;
- the agent API's `personal_records`.

Changing the rule bumps `EXERCISE_SESSION_FACTS_RULES_VERSION` and the agent
API's `metric_revision`.

**What each screen shows.**

| Screen | Records shown |
| --- | --- |
| Exercise page set list and band | The record set: 1RM, else Weight |
| Exercise page records panel, exercise history `All-time bests` | All three holders, each with its session and gym |
| Session view, completed-session cards, completion and share | The record set: 1RM, else Weight (`deriveExercisePersonalRecord`, from `loadEarlierBestsByDefinition`) |
| Today `PRs` | 1RM records (`pr_e1rm`) |

Every screen that shows the record set highlights the figures it beat. A 1RM
record set that is also heavier (or as heavy with more reps) than the Weight
record highlights both. Every band reads the same words
(`session-insights/record-band.ts`).

Group boards keep their own contract (`tech/groups-contract.md`), but follow
the same zero rule.

## 4. Calculations

**Parsing** (`parse.ts`). Weight is digits with an optional decimal point, and
must be non-negative. Reps is a positive integer. A performed set with blank
Weight and valid reps has Weight `0` (`canonicalizeWeightForReps`). Invalid
input never becomes zero. The parser is the only one: field validation, the
performed check (§1) and every figure call it.

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

**1RM** (`estimateOneRepMax`, `index.ts`) is Wathan:

```text
1RM = 100 × load / (48.8 + 53.8 × exp(-0.075 × reps))
```

- Only positive integer reps are eligible.
- Negative or non-finite Weight is rejected, as are a contribution outside
  `[0, 1]`, an invalid distribution and non-finite or overflowing results.
  The contribution range and the load-mode check also guard the exercise
  editor in `src/exercise-core`. That layer stays import-free for Deno, so it
  keeps its own one-line copy on purpose (agreed 2026-10-03).
- A zero load gives Volume `0` and 1RM `0`. Both are valid figures, but never
  records (§3).

**Top weight** is the highest raw entered Weight in kg, and at that weight the
most reps (§3). It never includes the bodyweight contribution and never changes
after a preference, contribution or reading edit.

**Totals.**

- A session's or exercise's Volume is the sum over its working sets (§1)
  (`summarizeVolume`).
- When a set's load is unknown, the total is a known subtotal, with coverage
  shown as `Known subtotal from X of Y working sets`.

**Muscle volume.**

- It is per side.
- Ordinary total input contributes `E / 2` per side, and per-side input
  contributes `E`.
- With a positive contribution, it first resolves the total `c × B + F × E`,
  then halves it.
- The mapping role factor (primary `1`, secondary `0.5`) applies afterwards.

**Sets by muscle** (a session's summary) applies the same role factor to
working sets: a muscle's sets are its primary sets plus half its secondary
sets. A set counts once per muscle, at its strongest role; a stabilizer adds
nothing (`summarizeCurrentSessionMuscleLoad`).

No derived figure is written back to a set or session.

**Display** (`format.ts`). Every figure has one format on every screen, the
groups' included. Figures have no unit and no thousands separators; a sentence
adds ` kg` itself.

| Figure | Format | Example |
| --- | --- | --- |
| Weight (entered, top, group Weight) | as entered, one decimal on whole kg | `60.0`, `82.5`, `2.25` |
| 1RM (personal and group) | one decimal | `104.7` |
| Volume | whole kg·reps | `2560` |

The agent API, the group evaluator and the SQL group functions call this
kernel rather than copying it; the SQL load factor matches
`metric-contract.ts` (`groups-bodyweight.sh` vector).
