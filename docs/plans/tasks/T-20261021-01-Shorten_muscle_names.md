# T-20261021-01 — Shorten muscle names

- Status: in_progress
- Depends on: none
- Milestone: none
- Areas: frontend/data; UI impact: copy only
- Issue: https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/818
- Implementation owner: delegated Codex implementation agent; reviewer/gates/PR: parent Codex agent.

## Objective

Use Forearms, Abs and Hip Abductors consistently for the three marked muscles.
Existing accounts and fresh installs receive the names without changing muscle
identity, mapping, training figures or history.

## Decided

The operator approved these replacements and this implementation on 2026-10-21:

| Stable ID | Previous label | New label |
| --- | --- | --- |
| forearms_grip | Forearms / Grip | Forearms |
| abs_rectus | Abs (Rectus Abdominis) | Abs |
| hip_abductors | Hip Abductors (Glute Med/Min) | Hip Abductors |

Latest main already provides `reviseMuscleGroupName`; reuse it. Advance the
current generation from 6 to 7 and append a migration. Do not duplicate the
helper, reseed existing catalogs, or change earlier migrations.

## Deliverables and acceptance

1. Update only the three seed display names and catalog generation.
2. Append generation 7 with ID-and-old-name guarded updates. Preserve custom
   names, absent/deleted rows, IDs, family/order/editability, mappings and figures.
   Reuse dirty stamping, transaction/marker atomicity and cache invalidation.
3. Extend existing Jest suites for exact fresh names, older-catalog upgrade,
   repeat-run idempotency, custom/deleted/unrelated rows, local-only bootstrap
   and renamed muscle rows pushing to convergence. Reuse existing fixtures.
4. Record the owner-approved naming decision in `docs/product/muscle.md`,
   following fact authoring and persistent-doc budgets.
5. Parent reviews the finished diff and product facts, runs agreed gates and
   verifies the names in the running iOS app against the issue screenshot.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Browse muscles | Open Progress's Muscle list; find each renamed row; open its history. | Short labels appear consistently; the same muscle history opens. | Empty history keeps its existing state. |
| Upgrade catalog | Launch/sync an existing catalog or start a local-only build. | Matching old labels change once and refresh readers. | Custom/deleted/missing rows are preserved; transaction failure leaves marker and data retryable. |

Design input: annotated screenshot in issue 818, with the replacements above.
Keep existing layout, navigation and accessibility behavior.

## Gates and review

Operator agreed: `./boga test fast`, `backend`, `jest-coverage`, `complexity`,
`dependencies`, plus screenshot comparison. Parent owns execution. No additional
Maestro scenarios; this change reuses the catalog write/sync path and changes copy.
Run `./boga test for` against the final diff and record evidence in the PR.
Run code review and `docs/procedures/product-review.md` before opening the PR.

## Workflow

The operator requested card creation and immediate delegated execution together.
Keep the card in branch history and delete it in the implementation commit before
opening the single PR, rather than blocking on a separate planning PR.
Do not merge the PR. Parent stops this worktree's stack after opening it and
retains the worktree until merge confirmation.
