# T-20261011-02 — Total load and group entry modes

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: cross-stack; UI impact: calculated figures only

## Objective

Apply the operator's agreed total-load formula to every exercise, including
ordinary exercises with no bodyweight contribution. Make equivalent performances
produce the same total Volume when a member's exercise and its linked group
exercise use different weight-entry modes.

## Scope

- In: the shared load kernel, personal and coaching consumers, muscle attribution,
  group scoring and session figures, derived-data refresh, and owning contracts.
- Out: changes to logged or planned weights, reps, effort eligibility, physical
  set counts, exercise links, the Wathan formula, new controls or dependencies.
- This branch records the plan only. The operator requested no tests and no PR
  for the planning commit; implementation and deployment are separate work.

## Decided

The operator approved this rule during planning on 2026-10-11. Let `W` be the
member's entered external weight, `B` the applicable bodyweight, `c` the effective
contribution fraction, and `F` the member's entry factor (`total_load = 1`,
`per_side_load = 2`):

```text
total load       = c × B + F × W
exercise Volume  = total load × reps
muscle Volume    = total load / 2 × reps × role factor
```

Effective `c` is zero when bodyweight calculations do not apply. The external
factor still applies then. Bodyweight contributes once; primary, secondary and
stabilizer muscle roles retain their current factors and mapping deduplication.

The member's mode interprets their stored weight. The group's mode determines an
equivalent external weight when a value must be expressed in group units:

```text
group external weight = W × member factor / group factor
```

This conversion never scales the bodyweight contribution or total Volume. Keep
raw shared sets as logged; do not rewrite them into group units.

Retain [[1rm.formula]] and existing 1RM presentation. Estimate strength from total
load, then project personal 1RM into entered external-weight units:

```text
personal displayed 1RM = (estimateOneRepMax(total load, reps) − c × B) / F
```

Use the entry factor even at zero contribution. Ordinary group kg 1RM converts
once from source units to group units. Normalized group Volume and 1RM continue
using physical total load and the same dated `B`, independent of target mode.
Group scoring uses the group's preference and contribution, never the member's
private choices. Existing missing-reading policies and disclosure remain intact.

## Acceptance examples

Each row represents eight reps and 20 kg of total external load:

| Member logs | Group mode | Equivalent group external weight | Ordinary Volume | Volume with B = 80 kg, c = 1 |
| --- | --- | --- | --- | --- |
| 20 kg total | Total | 20 kg | 160 | 800 |
| 20 kg total | Per side | 10 kg | 160 | 800 |
| 10 kg per side | Total | 20 kg | 160 | 800 |
| 10 kg per side | Per side | 10 kg | 160 | 800 |

The positive-contribution cases resolve to 100 kg total load. Primary-muscle
Volume is 80 without bodyweight and 400 with it; secondary-muscle Volume is 40
and 200 respectively. Physical sets and reps are not doubled.

## Deliverables and acceptance

1. Update `apps/mobile/src/exercise-calculations/load-metrics.ts` so ordinary and
   positive-contribution calculations apply the same external entry factor.
   Derive per-side load from total load and project displayed 1RM consistently.
   Preserve validation, finite-result guards, blank/zero handling and lazy
   bodyweight access when calculations are off or contribution is zero.
2. Trace every caller through `apps/mobile/src/exercise-calculations/analytics.ts`
   and its consumers. Logger, history, session totals, facts, records, coaching
   and permitted group session figures must agree. Verify that muscle Volume
   and displayed ordinary per-side 1RM retain their existing values while
   ordinary per-side exercise Volume doubles.
3. Remove the additional ordinary Volume conversion from
   `apps/mobile/src/groups/competition-score.ts`. Reuse
   `apps/mobile/src/groups/link-compatibility.ts` for conversions that still
   express external weight or ordinary 1RM in group units. Equivalent sets
   must have equal Volume in every source/target combination; prevent both
   double multiplication and target-mode halving of an already-total Volume.
4. Follow `docs/procedures/rule-upgrade.md`: bump personal facts, group evaluation
   and coaching revisions as required; invalidate affected disposable caches;
   enqueue current group comparisons for coherent publication. Preserve raw
   sets and historical record/certification audits and their original revisions.
   Re-check revision values against main before merge. A recompute-only migration
   runs after the updated evaluator is live, so the old worker cannot consume it
   using the old formula. Hosted deployment requires separate operator authority.
5. Update Jest vectors and consumer tests for all four mode combinations, off/on
   calculations, zero/decimal/positive contribution, and missing readings.
   Include same-performance equivalence, a single rep, zero load, invalid and
   overflowing inputs, no private-reading access off/zero, unchanged raw values
   and top Weight, and facts/cache refresh. Test group and personal 1RM units
   separately from total Volume. Read each test directory's README before edits.

## Contracts to load and update during implementation

- `docs/specs/tech/training-metrics-contract.md` — remove the ordinary per-side
  Volume exception and describe the shared total-load calculation.
- `docs/specs/tech/bodyweight-load-contract.md` — align source-mode arithmetic
  and retained bodyweight policy with the universal external factor.
- `docs/specs/tech/group-competition-contract.md` — ordinary Volume becomes
  total kg·reps, independent of the group's target entry mode; preserve
  normalized units and historical audit semantics.
- `docs/specs/tech/groups-contract.md` — reconcile affected scoring references,
  publication and derived refresh with the owning competition contract.
- Load all `docs/product/` facts and run its review on the implementation diff;
  the agreed load rule does not authorize unrelated product changes.

## Gates for implementation

No gates run for this planning commit, as requested. At implementation, use
`./boga test for` and agree the slower lane set with the operator before running
it. Start from `fast`, `backend`, `groups-api-live` and `ios-groups-e2e`; backend
includes `groups-competitions`. Add device lanes only for flows the final change
affects. Run `jest-coverage`, `complexity` and `dependencies` before the
implementation PR, plus code and product review. Delete this card when the
implementation ships; put verification evidence in the PR.

## Risk

Recalculation changes ordinary per-side personal Volume totals and may change
Volume records and comparisons. Ordinary group Volume currently expressed in
per-side target units changes too. Keep historical audit values distinguishable
from the new calculation and never alter logged weights to compensate.
