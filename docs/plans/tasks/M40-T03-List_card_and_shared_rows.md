# M40-T03 — ListCard and shared compact rows

- Status: `in_progress` — awaiting coded native acceptance before closeout
- Depends on: `M40-T02-Compact_card_and_gallery`
- Milestone: `docs/plans/milestones/M40-coded-ui-patterns.md`
- Areas: frontend; UI impact: yes

## Objective

Implement ListCard with a shared compact row recipe that the sortable table
will also consume. Migrate the accepted leaderboard references and obtain human
acceptance of real rows, figures, separators and long-content behavior.

## Decided and scope

Load `docs/plans/M40-pattern-contracts.md` for the operator-approved native
templates and shared row contract. This selection is settled; recheck current
main for drift, and obtain a new template decision only for a material deviation
or new derivative. Coded-result acceptance remains required for this migration.

Follow D1–D6 and the accepted T01/T02 contracts. Build on Card, ListRow and the
shared header; keep ranking/order and model construction with the feature.
The selected references are GroupHomeBoard and Today's weekly board. Preserve
whole-board versus row-level interaction semantics. This is not a ranking,
paging, scoring or certification rewrite.

## Open — resolve with the human at session start

- Recheck GroupHomeBoard and Today's weekly board against current main; retain
  the accepted passive/interactive row variants and report any drift.
- Settle the smallest shared row implementation and fixed leading/name/value/
  control slots; extend existing ListRow where possible.
- Reconfirm whether a new semantic variant is needed; obtain approval of its
  parent/delta before coding it.

## Deliverables and acceptance

### Session implementation choice

Carry forward the approved native after template; no new semantic variant.
Extend `ListRow` with compact density and own-row emphasis, leaving list/sheet
defaults intact. Content slots own 4pt vertical insets; the control column owns
its full 44pt target. `ListCard` composes the shared header, optional columns,
rows and footer in standalone or embedded form; its optional action wraps only
the board region. Keep fixed board-name ellipses and feature-sized figure
columns. Extract Today's board presenter for native gallery reuse without
changing its parent read or destinations. No product facts change intended.

Independent reviewer lane agreement: fast, ios-smoke, ios-groups-e2e,
jest-coverage, complexity, dependencies. Narrow unrelated frontend-ui flows as
covered-by-jest; retain native three-width before/after and edge/action evidence.

1. ListCard/header/optional column-label composition and one compact row recipe
   reusable by ListCard and StatsTable. Single-line and wrapped rows use the
   same insets/line-height policy for the same density; controls keep their
   full target without inflating rows through nested padding/minimum heights.
2. Reference migrations preserve rank/ties, own-member emphasis, fixed figure
   alignment, list order, refresh/state behavior and existing destinations.
3. Extend the native gallery with actual list components and fixtures for long
   names, large figures, selected/own rows, empty/failure states and multiline
   content. Include row-only fixtures that T04 can render beside table rows.
4. Jest proves the spacing contract, row identity, actions and preserved
   content. Exercise invalid overrides in the guardrails for adopted surfaces.
5. Show native before/after captures and the running gallery/reference screens
   at the agreed widths. Obtain explicit human acceptance per D5 before this
   migration ships or T04 adopts its row recipe.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Read a leaderboard | Open the accepted board; scan rank/name/figures; activate its existing target | Compact aligned rows, unchanged ordering and same destination | Long names wrap or truncate as agreed with full accessible text; figures retain their format |
| Empty or stale list | Open without rows or after a failed refresh; use the existing recovery action | Existing state feedback/retry remains usable | No stale row or empty state gains a misleading action |

## Specs and gates

Update `docs/specs/ui/components-catalog.md` and owning component contracts;
graduate shared row rules into `docs/specs/ui/design-language.md` once accepted.
Read `apps/mobile/__tests__/README.md` before editing tests. Use `./boga test for`:
fast + relevant native UI/group lanes, with reviewer-agreed adjustments and
native human evidence even for cosmetic scope. Run jest-coverage, complexity,
dependencies and independent code/product reviews. Link acceptance/evidence in
the PR, delete this card in the shipping PR and mark the milestone task completed.
