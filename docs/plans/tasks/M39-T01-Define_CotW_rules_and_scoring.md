# M39-T01 — Define COW rules and shared scoring

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: frontend domain, docs; UI impact: no

## Objective

Turn the milestone's confirmed product choices into one implementable
weekly competition contract and a small, pure scoring boundary. Resolve the
remaining product questions before code so later PRs cannot invent different
week, baseline or correction rules.

## Scope

- In: milestone D1–D5 and D7–D9; pure aggregation of already calculated group scores;
  deterministic fixtures; durable ownership of cross-surface rules.
- Out: SQL tables/RPCs, a second load/1RM formula, group worker changes, UI,
  notification delivery and hosted deployment.

## Decided

- D1: one group exercise; independently selected metric rankings.
- D2: the member's pre-week best group-shared 1RM; no positive baseline means
  unranked improvement, not an invented 0% or personal-history fallback.
- D3: ordinary/normalized units and existing privacy apply.
- D4: weekly Volume sums set volumes; existing lifetime Volume boards stay
  best-single-set. Retain unrounded scores until display.
- D7: group time zone defaults to the creator's; immutable shared week bounds;
  schedule next week only, before start, with one published COW per group/week.
- D8: ended results are stored and final, never recalculated from later source
  changes; current history disclosure/access still applies.
- D9: roster fixed at start; later join/rejoin waits for the next COW; leaving
  stops contributions but preserves results earned while a member.

## Open — resolve with the operator at session start

Resolve only the remaining items under the milestone's "Decisions reserved
for T01": session placement and boundary cases, the proposed no-grace/server-
receipt cutoff (including baseline and source versions), editing/cancellation,
signed/positive-only improvement, ties/finite results, comparison revision
changes and certification scope. Do not reopen D7–D9 as undecided. A historical baseline must be calculated
under a compatible rule/unit; no mixing historical kg with current %BW.
Choose the narrowest contract consistent with D1–D3; update later cards if
its consequences change their scope or gates.

## Deliverables and acceptance

1. Put the challenge contract beside the existing group technical contracts
   and route to it from `docs/specs/tech/groups-contract.md` only when changing
   COW. Apply doc budgets. Record qualifying facts in
   `docs/product/groups.md` and extend the product-index trigger; highlight
   every added/changed/decided fact in this PR.
2. Add a small TS scoring module under `apps/mobile/src/groups/`, compatible
   with the existing worker's relative `.ts` import graph if it needs that
   caller. Inputs are authorized, eligible per-set group scores with explicit
   time and revision context. Reuse `competition-score.ts` if raw source
   scoring is necessary; never duplicate parsing, effort or load arithmetic.
3. Jest vectors prove weekly max versus weekly sum over several sessions and
   repeated blocks, the pre-week cutoff, shared-only baseline selection,
   missing/zero baseline and weekly results, signed/positive choice, exact
   edges/DST, ties, deduplication, finite-result policy, and ordinary/%BW units.
   State the deadline contract precisely enough for T03 to distinguish
   pre-deadline source versions from later writes despite evaluation lag.
   Put authorization assertions in T02/T03 rather than treating pure inputs
   as proof of access control.
4. Review current consumers of any existing helper changed. Existing board
   scoring, normalized privacy, certificates and personal calculations retain
   their behavior. Read `apps/mobile/__tests__/README.md` before test edits.

## Specs to update

- `docs/product/groups.md`, `docs/product/README.md` — new weekly decisions and load trigger.
- `docs/specs/tech/groups-contract.md` — route to the challenge contract.
- `docs/specs/tech/group-competition-contract.md` — distinguish weekly aggregates from its single-set boards if needed.
- `docs/specs/09-project-structure.md` only if module ownership changes.

## Gates and closeout

Expected: `./boga test fast`, `groups-api-live`, `ios-groups-e2e`,
`jest-coverage`, `complexity`, `dependencies`. Run `./boga test for` and agree
the set with the reviewer. For a new pure helper with no runtime consumer,
propose `covered-by-jest` lowering of the live/device lanes; it requires the
reviewer's agreement. If shared scoring or evaluator behavior changes, add
`backend`, including `groups-competitions`; do not claim existing publication
is unchanged merely because this PR is called a domain task.

Run independent code and product review, delete this card and mark T01
completed in the milestone. No milestone closure or issue closure here.
