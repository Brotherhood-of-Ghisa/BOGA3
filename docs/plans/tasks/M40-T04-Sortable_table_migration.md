# M40-T04 — SortableTable and Muscle table migration

- Status: `planned`
- Depends on: `M40-T03-List_card_and_shared_rows`
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: frontend; UI impact: yes

## Objective

Extend the existing StatsTable family to enforce the accepted compact row
contract, then migrate Progress by Muscle and the individual muscle contributor
view. Human review must confirm that list and table spacing match in native UI.

## Decided and scope

Load `docs/plans/M40-pattern-contracts.md` for the operator-approved native
templates and shared row contract. This selection is settled; recheck current
main for drift, and obtain a new template decision only for a material deviation
or new derivative. Coded-result acceptance remains required for this migration.

Follow D1–D6. Reuse StatsTable, its sort headers and ComparisonHeaders/Values;
do not create a parallel table framework. Share the accepted row recipe with
ListCard. Column structure, sorting indicators and disclosure are table concerns;
calculation, formatting, grouping and sort arithmetic retain their current owners.
Existing contributor headers inherit the parent context; do not add independent
sorting or new metrics to them solely because the family is called SortableTable.

## Open — resolve with the human at session start

- Confirm the actual Muscle and single-muscle consumer paths after sibling
  changes, including the accepted inline/stacked narrow-screen layouts.
- Settle the minimal column/row API, sort-state ownership and grouping/disclosure
  slots. Keep the table's existing title-free composition where the screen
  already supplies its context.
- Present any necessary derivation from the shared row recipe before coding.

## Deliverables and acceptance

1. Evolve StatsTable exports with constrained shared presentation; migrated
   consumers use the accepted row recipe without local spacing/type overrides.
2. Preserve header ordering/direction, grouping, ties and missing values;
   preserve separate name/history and contribution-disclosure actions and focus
   return. Keep existing figure formatting and responsive stacking behavior.
3. Extend the native gallery with the production table and the same row fixture
   rendered as ListCard rows beside it. Cover long names, wide figures, nested
   contributions, multiple sort directions, empty/error and narrow layouts.
4. Jest proves list/table row-style parity and wrapping rules plus real sorting,
   disclosure and navigation behavior. Guardrails reject an unauthorized local
   density/type override in adopted table consumers.
5. Present current before/after captures, paired list/table native rows and the
   running Progress screens. Obtain explicit human acceptance at the reviewed
   commit per D5. A green suite alone does not complete the migration.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Sort Muscle rows | Open Muscle List; activate the existing sortable headers | Existing order/direction behavior with compact aligned figures | Ties/missing values retain the current stable handling |
| Inspect one muscle | Expand a muscle or open its existing detail; inspect contributors; follow history and return | Parent/contributors share the accepted row rhythm and focus returns correctly | Long rows use the accepted wrap/stack layout; empty contributors retain the current state |

## Specs and gates

Update `docs/specs/ui/components-catalog.md`, owning component contracts and
accepted shared rules in `docs/specs/ui/design-language.md`. Load
`docs/specs/tech/training-metrics-contract.md` for preserved figures and
`apps/mobile/__tests__/README.md` before editing tests. Start from fast + relevant
frontend-ui lanes via `./boga test for`; agree adjustments with the reviewer.
Add no new Maestro flow without the written rationale required by spec 06.
Run jest-coverage, complexity, dependencies and independent code/product review.
Link human acceptance in the PR; delete this card in the shipping PR.
