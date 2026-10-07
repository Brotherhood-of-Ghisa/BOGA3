# M35-T03-Remove_pre_V4_server_code — Remove pre-V4 server code

- Status: `planned`
- Depends on: `M35-T02-Port_tests_to_V4_on_an_active_baseline`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: backend (migration, edge function) + test infrastructure; UI impact: no

## Objective

One forward migration makes V4 unconditional and removes every pre-V4 server
path; the evaluator loses its protocol-3 path; the activation tooling and the
cutover lane retire.

## Scope

- In: the removal migration; `supabase/functions/group-eval` protocol-3
  dispatch (and the TS it alone imports, e.g. `metric-evaluation.ts`);
  `group-competitions-activate.sh`, `with-local-group-competitions.sh`, the
  dev-baseline activation step, the groups-protocol4 lane and its trigger rows
  (`scripts/triggers.tsv`); specs.
- Out: hosted deploy (T05); app client (T04).

## Decided

- M35 D1–D4, D6.
- Drop the old public RPCs outright (D2). Fold each `*_pre_competition`
  implementation a V4 RPC still calls into that V4 function (T01 inventory).
- Replace the pre-V4 "rejects even with a forged header" tests with one
  catalog assertion: no pre-V4 function exists or is granted.
- `group_competition_contract` keeps its response shape (D4).

## Open — resolve with the user at session start

- Whether `group_competition_activate` and the activation table are dropped
  or kept as a no-op for the hosted rollout's verification.
- Ordering against M34-T02 if it is in flight.

## Deliverables and acceptance

1. Fresh `./boga db reset` yields V4 with no activation step.
2. The migration fails loud on a pending database holding group data (D6).
3. `boga test backend` green with the V4 tests from T02 unchanged except
   removed activation scaffolding.
4. No `group_competition_active()` reference and no pre-V4 RPC left in the
   final schema (catalog assertion).

## Specs to update

- `docs/specs/tech/group-competition-contract.md` — remove pending/activation
  and cutover-procedure rules; keep metric meaning, disclosure and history rules.
- `docs/specs/tech/groups-contract.md` — one RPC generation, not three.
- `docs/specs/02-quality-and-test-gates.md`, `docs/specs/06-testing-strategy.md`
  — retire groups-protocol4.

## Gates

`fast` + `backend` + `ios-groups-e2e` + the three quality targets; confirm with
`./boga test for`.
