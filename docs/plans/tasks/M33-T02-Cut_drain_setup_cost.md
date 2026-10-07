# M33-T02-Cut_drain_setup_cost — the group bodies' drain setup cost

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M33-test-gate-principles.md`
- Areas: backend (test bodies); UI impact: no

## Objective

The group bodies call `drain` — one HTTP POST to the `group-eval` Edge
Function — 213 times (`groups-boards.sh` 68, `groups-leaderboards.sh` 40,
`groups-certification.sh` 33, `groups-bodyweight.sh` 30, `groups-competitions.sh`
25, `groups-week-summary.sh` 17). Most are there to *reach* an asserted state,
not to assert on the drain. That is the setup trap under spec `06`'s rule 5.
Measure the split, then cut the setup share.

## Scope

- In: the group bodies and `supabase/tests/lib/groups-fixtures.sh`.
- Out: changing the evaluator or any server behaviour; this card changes how
  tests reach a state, never what the product does.

## Decided

- D5: no assertion is lost. A drain that is itself under test stays a drain.
- D3: measure first. The card does not start cutting before it knows the split.

## Open — resolve with the user at session start

1. **The measurement.** Agree how to attribute the 213 calls between "the drain
   is the subject" (coalescing, claim-generation guard, lease expiry, retry and
   parking, kick failure isolation) and "the drain is setup" (get boards into a
   state, then read them). Report the split before proposing cuts.
2. **The cheaper path.** Agree what replaces a setup drain: calling the
   evaluator's apply RPC directly, seeding `group_board_entries` and
   `group_eval_queue` with SQL, or a fixture helper that does one drain for
   many assertions. Seeding board state risks asserting on rows the real
   pipeline would never produce — that risk is the main thing to settle.
3. Whether any body is better served by moving wholesale to Jest, which would
   make it T03's problem instead.

## Deliverables and acceptance

1. The measured setup/assertion split of all 213 calls, in the PR body.
2. A reduced setup share with the same assertions passing, and measured
   before/after for `groups-leaderboards` (88.3s at baseline `2d4f0e7c`).
3. Evidence that each retained drain is load-bearing: the inventory lists which
   rule each one proves.
4. No new fixture that seeds a state the real pipeline cannot produce, or an
   explicit note in the PR where one was unavoidable and why.

## Specs to update

- `docs/specs/tech/groups-contract.md` — only if a rule's proof moves; the
  contract itself must not change.

## Gates

`./boga test for` is authoritative. Expect `fast` + `backend`, plus
`groups-protocol4` if `groups-competitions.sh` or the shared fixtures change.
