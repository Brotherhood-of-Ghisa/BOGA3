# M32-T05 — Accept and close the Progress tables

- Status: `planned`
- Depends on: `M32-T04`
- Milestone: `docs/plans/milestones/M32-progress-tables-and-individual-history.md`
- Areas: frontend verification, docs; UI impact: yes

## Objective

Validate the integrated Progress replacement with the operator and close the
milestone. Reuse evidence from shipped tasks where still current; fix only gaps
or regressions discovered in the integrated experience.

## Scope

- In: native acceptance, missing meaningful regressions, durable-doc consistency,
  accepted target status, plan cleanup.
- Out: a new design direction, speculative analytics/features, a release build
  or automatic full sweep, redundant tests or broad gate repetition.

## Decided

Milestone D1–D7 and T01's final target are fixed unless the user revises them.
This is human acceptance and lifecycle closeout, not a substitute for each
earlier task's passing checks and screenshots.

## Deliverables and acceptance

1. Review running iOS states on small/large layouts: table default, selected
   contributions, zero-current/previous-only, all-zero, Volume coverage,
   loading/error/Retry, individual muscle history and exercise history.
2. Demonstrate no family heatmap, no in-sheet Daily/Weekly toggle, Daily for unset
   preference, a valid saved Weekly view, and retained Weekly interaction. Name
   presses do not also select the muscle. Dismissing restores table context.
3. Confirm period/settings persistence, account isolation and edit/refocus
   recalculation, with no change to set eligibility, Volume kernel, sync or
   backend. Long names, numeric columns, scroll and accessibility remain usable.
4. Obtain human acceptance of material target differences; record native
   captures, gate results and deviations in the PR, not in ephemeral cards.
   Carry unresolved material differences forward rather than claiming closeout.
5. Update owning UI contracts/target status to describe only shipped behaviour.
   Ensure no production/spec reference points to these planning files or IDs.
6. Delete this card, the completed milestone and any remaining milestone-only
   planning image copies. Retain only accepted target images in their durable
   location. Offer no uncompleted dependent task as ready.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Integrated acceptance | Operator reviews table, contribution and name-history paths | Accepted screenshots and reconciled values in both metrics | Material mismatch fixed or explicitly left open; no false completion |
| View preference | Fresh choice, saved Weekly, account change, reopen history | Daily default; persisted view and restored context | Failure/Retry and isolation proven; Weekly not removed |

## Specs to update

- `docs/specs/ui/design-targets/`, `README.md`, `screen-map.md`, `ux-rules.md` and
  `navigation-contract.md`: acceptance status and any final shipped correction.
- Other owning specs only for actual implementation gaps; do not copy task IDs
  or plan paths into durable documentation.

## Gates

Query `./boga test for` on the actual closeout diff. Mandatory fast for code
changes; agree any additional lanes, using current prior evidence for unchanged
areas. Run `jest-coverage`, `complexity`, `dependencies` before the final PR.
A full sweep is only required for a release; suggest it if the diff flags it.
No new Maestro scenario without justification and approval. After the human
merges this task's PR, release its worktree/stack in the same session.
