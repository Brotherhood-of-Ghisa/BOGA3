# M30 — Stats count working sets only

- Status: `planned`
- Created: 2026-10-02, planning baseline `9eee0122` on `origin/main`

## Objective

Warm-ups stop counting toward any stat, everywhere: volume, 1RM, top weight,
records and PRs, heatmaps, muscle volume, comparisons, favourites and "done",
the agent API, and new group results. A set count with no qualifier means
working sets. Today the rule is the opposite (`ux-rules.md` §5.11: warm-ups
count toward every stat except working sets).

## Scope

- In:
  - The rule and one shared predicate.
  - Every local aggregate and PR derivation.
  - The exercise session facts (rules version 3).
  - Every set-count label.
  - The agent API's metrics.
  - Group boards, records and certifications from now on.
  - The specs that state the old rule, with Jest and server tests to match.
- Out:
  - Re-evaluating group results already stored (D6).
  - Changing what a warm-up *is*: `set_type = 'warm_up'`, the effort cycle, and
    the logging UI stay as they are.
  - Row counts that are not stats: the session view card's `n/m` progress
    ("n of m sets done") and the remove-exercise alert's "its N sets" still
    count every row.

## Agreed design direction

### D1. A stat counts working sets only

A **working set** is a valid, confirmed performed set whose type is not a
warm-up: `isConfirmedPerformedSet` plus `isWorkingSessionSetType`. Every stat
reads working sets only. That covers:

- volume, estimated 1RM and top weight;
- records, PRs and PR baselines;
- daily and weekly heatmaps, muscle volume and failure intensity;
- comparisons, medians and ranges;
- the volume coverage note;
- favourites recency, "done" / `Last:` and per-exercise session counts;
- the agent API's personal records, volume and counts;
- group boards, records and certifications (D6).

Today's warm-ups-count statements are rewritten: `ux-rules.md` §5.11, :180,
:621–668, :685–688, :761 and :809; `design-language.md` :318–321;
`screen-map.md` :163–180, :216–217 and :441; `05-data-model.md` :134 and :439;
`bodyweight-load-contract.md` :110; `groups-contract.md` :1264, :1317–1319 and
§2.11. The task that changes each behaviour also changes its spec.

### D2. A warm-up-only exercise did not happen, as far as stats go

An exercise with only warm-ups in a session has no stat footprint for that
session:

- it is not "done", sets no `Last:` and adds no favourites recency;
- it adds no session to that exercise's count;
- it gets no exercise-session facts row.

Its rows still appear in the session itself.

### D3. Warm-up rows keep their own figures but are never a record

Per-set rows on the exercise page, session view, View Session, exercise history
and friend sessions still show a warm-up's own 1RM and volume. Those figures
describe that set. The row is never a record highlight (brass) and feeds no
stat. `design-language.md` :318 keeps "presented like working sets" and drops
"counts toward 1RM and records".

### D4. One "Sets" figure

Every unqualified set count is working sets, labelled `Sets`:

- The `N (W)` pairs collapse to one figure: Progress `Sets (W/Sets)`, the muscle
  and family rows, and the Progress exercise table.
- The `W/sets` label becomes `Sets`: the exercise history card and the
  heatmap metric.
- The duplicate sort mode goes (sets and working sets become one mode).
- The completion screen's separate `Working` fact goes.
- Exercise and muscle comparison cards drop `· W working`.
- The share image shows one set count.

The other counts change value, not label: the session list and Today recents,
the session view and View Session `Sets`, the exercise history card header, the
group stream card and friend session, and the records panel's `Vol` detail.

### D5. Per-set maths stays; aggregation filters

The server edge functions (`group-eval`, `agent-api`) import the mobile
calculation kernel. `calculateSetMetrics` therefore keeps computing a warm-up's
own 1RM and volume (D3 needs them anyway). One exported predicate in
`src/exercise-calculations/` gates every aggregate:

- `summarizeExerciseLoad` and `summarizeVolume` callers;
- PR candidates and baselines;
- the facts derivation;
- the per-feature aggregators.

The group pipeline therefore changes only in its own task. The dead
`includeWarmUps` option in `src/exercise-calculations/index.ts` (no production
caller) is removed in T01.

### D6. Groups: forward only

New and re-evaluated group results ignore warm-ups. Results already stored
(board entries, records and their `group_events`, certifications, metric scores)
are not re-evaluated, backfilled or voided because of this rule change, and no
requeue runs. Old and new results stay mixed until a session is evaluated
again. The group week summary's `exercise_count` follows D2.

### D7. Exercise session facts move to rules version 3

T01 bumps `EXERCISE_SESSION_FACTS_RULES_VERSION` to 3, so every device rebuilds
the facts once. The facts' bests, volume, PR flags and row eligibility all
follow D1/D2, and the 1RM flags still equal `deriveSessionPersonalRecords`.

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| `M30-T01-Working_set_rule_and_records` | Shared predicate; facts v3; every PR, record and best excludes warm-ups; rule specs | none | completed |
| `M30-T02-Working_set_measures` | Volume, heatmaps, muscle analytics, comparisons, favourites and "done" exclude warm-ups | T01 | planned |
| `M30-T03-Sets_mean_working_sets` | Every unqualified set count is working sets; the pairs collapse | T02 | planned |
| `M30-T04-Agent_API_working_sets` | Agent API and MCP metrics and counts exclude warm-ups | T01 | completed |
| `M30-T05-Group_results_working_sets` | Group boards, records, certifications and week summary exclude warm-ups, forward only | T01 | planned |

T01 decisions (2026-10-03): the predicate is `isWorkingSet` (plus
`isWorkingSetType`) in `src/exercise-calculations/set-semantics.ts`, and
`isWorkingSessionSetType` re-exports it. `summarizeExerciseLoad` is unchanged
and callers filter, so `agent-api` output is untouched until T04. The records
panel's `Last` skips a warm-up-only session (D2). T01 also moved exercise
history's per-session 1RM and `Top set`, and block history's 1RM and top weight,
because the bests read them. T02 keeps their volume.

T04 decisions (2026-10-03): `agent-api` filters in its own adapter
(`projectTrainingSets`), and the kernel is unchanged. `metric_revision` is now
`working_sets_v1`. `exercises[].set_count` counts working sets, and
`exercise_count` counts blocks with a working set. A warm-up-only session drops
out of exercise context (D2).

T02, T04 and T05 can run in parallel after T01. T03 follows T02 because both
edit the same aggregators and Progress screens. `M29-T08` (exercise records on
facts) waits for T01. The task that merges last deletes this milestone.

## Risks / dependencies

- **M29 overlap.** `M29-T06` and `M29-T07` move completion and session-view PRs
  onto the facts, in the same `src/session-insights/` files that T01 changes.
  Run them one after the other in either order, not at the same time. Whichever
  lands second rebases onto the other. `M29-T02` (PR #466) already counts
  working sets.
- **Forward-only drift (D6).** Re-evaluating one member can move a board when a
  warm-up that was their best stops counting. T05 must say what the evaluator
  emits then (lead change, void or silent), never fabricate a `record`, and
  stay within `groups-contract.md`'s void reasons, or extend them on purpose.
- **Edge-function coupling (D5).** Any T01–T03 change to a function that
  `supabase/functions/**` imports changes server output on the next deploy.
  T01 keeps the kernel's per-set maths and `summarizeExerciseLoad`'s server
  behaviour unchanged, or covers `agent-api` in the same PR.
- **Test churn.** About 22 Jest files and 2 server test scripts pin "warm-ups
  count". Each task updates the tests for the behaviour it changes, and none
  deletes a warm-up case: each one flips to assert the exclusion.
- **Old app versions.** Group results are server-side, so a client that has not
  updated still sees the new group results, while its own local stats keep the
  old rule until it updates. That is acceptable: no synced data changes.
