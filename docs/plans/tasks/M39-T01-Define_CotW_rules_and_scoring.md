# M39-T01 — Define CoW rules and shared scoring

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M39-group-challenge-of-the-week.md`
- Areas: frontend domain, docs; UI impact: no

## Objective

Turn the milestone's confirmed product choices into one implementable
weekly competition contract and a small, pure scoring boundary. Formalize the
delegated MVP choices so later PRs cannot invent different week, baseline,
submission-priority or correction rules.

## Scope

- In: milestone D1–D5 and D7–D10; pure aggregation of already calculated group scores;
  deterministic fixtures; durable ownership of cross-surface rules.
- Out: SQL tables/RPCs, a second load/1RM formula, group worker changes, UI,
  notification delivery and hosted deployment.

## Decided

- D1: one group exercise; independently selected metric rankings.
- D2: the member's pre-week best group-shared 1RM; no positive baseline means
  unranked improvement, not an invented 0% or personal-history fallback. Freeze
  eligible baseline versions at start; signed improvement includes zero and negatives.
- D3: ordinary/normalized units and existing privacy apply.
- D4: weekly Volume sums set volumes; existing lifetime Volume boards stay
  best-single-set. Retain unrounded scores until display.
- D7: group time zone defaults to the creator's; immutable shared week bounds;
  schedule next week only, before start, with one published CoW per group/week.
- D8: ended results are stored and final, never recalculated from later source
  changes; current history disclosure/access still applies. Server acceptance
  before cutoff is required, with no late-sync grace period.
- D9: roster fixed at start; later join/rejoin waits for the next CoW; leaving
  stops contributions but preserves results earned while a member.
- D10: completed sessions placed by start time; receipt-based tie priority,
  stable UUID last tie-break, before-start-only edit/cancel, one All ranking,
  finite values and unavailable outcome on an in-week scoring-context change.

## Implementation choices at session start

MVP product choices are settled in D2/D8/D10; do not reopen them as questions
requiring another operator answer. Trace existing scoring/intake/version
boundaries and choose the smallest implementation consistent with the
milestone's handoff. Define the authoritative acceptance point and how each
metric derives its submission time from D10's winning-set/aggregate receipts,
including removed contributions, despite delayed/coalesced evaluation. Do not
build a history of every intermediate aggregate score. Baseline and weekly scores use the start-bound context;
an in-week context change is unavailable, not a historical-rules evaluator.

## Deliverables and acceptance

1. Put the challenge contract beside the existing group technical contracts
   and route to it from `docs/specs/tech/groups-contract.md` only when changing
   CoW. Apply doc budgets. Record qualifying facts in
   `docs/product/groups.md` and extend the product-index trigger; highlight
   every added/changed/decided fact in this PR.
2. Add a small TS scoring module under `apps/mobile/src/groups/`, compatible
   with the existing worker's relative `.ts` import graph if it needs that
   caller. Inputs are authorized, eligible per-set group scores with explicit
   time and revision context. Reuse `competition-score.ts` if raw source
   scoring is necessary; never duplicate parsing, effort or load arithmetic.
3. Jest vectors prove weekly max versus weekly sum over several sessions and
   repeated blocks, the pre-week cutoff, shared-only baseline selection,
   missing/zero baseline and weekly results, signed negative/zero ordering,
   exact edges/DST, receipt-priority ties, deduplication, finite-result policy,
   and ordinary/%BW units. Prove earlier accepted equal scores beat later ones
   despite opposite client/performed/worker times, identical retries keep
   priority, scoring-input corrections use their new receipt time, Volume
   removals advance aggregate receipt, and identical times use UUID.
   Cover baseline uploads after start, membership-end crossing,
   completion after cutoff and transactions whose required writes cross cutoff.
   Latest accepted states include deletion/ineligibility: a pre-cutoff removal
   cannot resurrect an older qualifying version; a post-cutoff removal cannot rerank finals.
   State the deadline contract precisely enough for T03 to distinguish
   pre-deadline source versions from later writes despite evaluation lag, and
   scope the unavailable context-change outcome without rewriting prior finals.
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
