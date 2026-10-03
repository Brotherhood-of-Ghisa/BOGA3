# Training metrics contract

The one definition of what counts toward a training statistic, for the app, the
group evaluator and the coaching API. Other specs say which figures a screen
shows and link here for what they mean; they do not restate these rules.

| § | Definition | Code |
| --- | --- | --- |
| 1 | Counted set (a *working set*) | `isWorkingSet`, `apps/mobile/src/exercise-calculations/set-semantics.ts` |
| 2 | Counted session | `isCountedSession` / `countedSessionIds`, same file |
| 3 | Records (Volume, 1RM, Weight) | Owned for now by `05-data-model.md`, "Exercise session facts" |
| 4 | Calculations (load, volume, 1RM, top weight) | Owned for now by `tech/bodyweight-load-contract.md` |

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
  (`apps/mobile/src/config/training.ts` only shapes the effort picker).
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
