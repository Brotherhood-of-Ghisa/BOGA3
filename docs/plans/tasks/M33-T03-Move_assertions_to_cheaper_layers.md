# M33-T03-Move_assertions_to_cheaper_layers — enforce the cheapest-layer rule

- Status: `planned`
- Depends on: `M33-T02-Cut_drain_setup_cost`
- Milestone: `docs/plans/milestones/M33-test-gate-principles.md`
- Areas: backend + frontend (test layers); UI impact: no

## Objective

Spec `06` has always said to pick the cheapest layer that can prove a claim
(D2). Audit the backend bodies against it and move what a Jest layer can hold,
leaving the backend lanes proving only what needs real Postgres, PostgREST or
the Edge runtime: RLS, SQL function behaviour, wire shapes, migrations over
populated data, and failure isolation.

## Scope

- In: the `supabase/tests/**` bodies and the Jest suites that would receive
  moved assertions.
- Out: deleting coverage (D5); the two renames (D6); Maestro lanes — spec `06`'s
  Maestro scope policy already governs them.

## Decided

- D5: assertions change layer, never disappear. A proposed deletion stops and
  asks the operator.
- The backend layer legitimately owns real auth context and RLS, RPC wire
  contracts, SQL functions and constraints — per spec `06`'s *Test layers*
  table. A pure-calculation assertion in a backend body is the smell.
- `groups-competitions.sh` is **not** a candidate: its 137.8s is a populated
  one-way migration read back under four identities, which no unit test can
  hold. The competition scoring maths is already unit-tested in
  `apps/mobile/__tests__/groups-competition-evaluation.test.ts` and
  `groups-competition-contract.test.ts`. Confirm this pattern before moving
  anything — the expensive bodies may already be correctly placed.

## Measured cost profile (at `39cd6f8f`)

Profiled per command (a timing wrapper, which adds its own overhead) over the
five `groups-leaderboards` bodies (86s unwrapped): `docker exec psql` 771 calls
/ 37.6s (38–69 ms each), PostgREST 674 / 8.8s, `group-eval` drains 218 / 8.3s
(curl's own timer, unwrapped; 22–61 ms each), `node -e` 48 / 8.3s (up to 0.45s
each), `jq` 2528 / 7.0s, auth 78 / 4.7s. An assertion's cost is mostly the
`run_psql` calls around it, not the drain that reaches its state. Host `psql`
over TCP measured 24 ms vs 38 ms for `docker exec`.

## Open — resolve with the user at session start

1. **The audit output.** Agree the shape: per body, which assertions are
   layer-misplaced, with the cost each would stop paying. Present it before
   moving anything.
2. **How far to go.** The audit may find little, if the backend bodies are
   mostly proving genuinely-integration facts (as the competitions body turned
   out to be). Agree up front that "the suite is already correctly layered" is
   an acceptable outcome that closes this card — the audit is the deliverable,
   the moves are conditional.
3. Whether a moved assertion needs the real-data Jest helper
   (`apps/mobile/__tests__/helpers/local-data.ts`) or is a pure unit test.

## Deliverables and acceptance

1. The audit, in the PR body: per backend body, misplaced assertions and the
   cost of each.
2. Any agreed moves, with the receiving Jest tests passing and the backend body
   shortened accordingly.
3. Measured before/after for every lane whose body changed.
4. Last card in M33: this PR deletes the milestone and the remaining cards, and
   runs `./boga docs gen` so the lane matrix reflects the milestone's final
   timings.

## Specs to update

- `docs/specs/06-testing-strategy.md` — "What each backend lane is for", if a
  lane's purpose narrows once assertions move out.

## Gates

`./boga test for` is authoritative. Expect `fast` + `backend`; add
`groups-protocol4` if a group body changes, and `jest-coverage` since
assertions arrive in Jest.
