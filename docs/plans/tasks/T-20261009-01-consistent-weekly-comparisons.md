# T-20261009-01 — Consistent weekly comparisons

- Status: `in_progress`
- Depends on: none
- Areas: frontend, product facts; UI impact: accessibility wording only

## Objective

Use one previous-period rule for every weekly Progress comparison. Preserve the
unfinished current week and compare it with the complete preceding calendar
block, matching Today's weekly baseline.

## Decided

The product owner approved this rule in the task conversation on 2026-10-09:

- Weeks start Monday at local midnight.
- Current N weeks run from Monday N − 1 weeks ago until now.
- Previous N weeks are the immediately preceding N complete weeks, ending at
  the current period's start, including when N = 1.
- Month pace and historical session distributions keep their existing rules.

## Scope

Change the shared Progress bounds, its accessibility wording, meaningful Jest
boundary coverage and the owning `comparison.window` product fact. No schema,
sync, record-kernel, stored-facts or dependency change is needed.

## Deliverables and acceptance

1. This week and configured N weeks use adjacent Monday-aligned blocks with no
   overlap; only the current block is unfinished.
2. Real SQLite tests include late previous-week sessions and exclude current
   sessions exactly at now. Cover Monday midnight, year boundaries and both DST
   changes; retain the four-week totals regression.
3. Progress controls announce the complete preceding baseline accurately.
4. Product facts and Ponytail reviews find no unresolved issue before the PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Compare weekly work | Open Progress; choose This week or configured N weeks | Existing table shows the current partial block against the previous complete block; accessibility names the rule | Monday begins an empty current week; previous-only rows and existing retry states remain |

## Documentation

Update `docs/product/comparison.md` (`comparison.window`) with the approved
decision. Preserve this card in its own commit, then delete it in the completion
commit; the PR carries validation evidence.

## Gates

Proposed: `fast`, `jest-coverage`, `complexity`, `dependencies`. Lower the default
`backend` and `frontend-ui` lanes as `covered-by-jest`: this is local calendar
arithmetic and accessibility copy with no server or device-specific behavior.
Operator agreement is pending in the task conversation.
