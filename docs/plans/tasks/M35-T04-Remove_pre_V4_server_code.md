# M35-T04-Remove_pre_V4_server_code — Remove pre-V4 server code

- Status: `planned`
- Depends on: `M35-T03-Port_heavy_suites_and_flip_the_baseline`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: backend (migration, edge function) + test infrastructure; UI impact: no

## Objective

One forward migration makes V4 unconditional and removes every pre-V4 server
path; the evaluator loses its protocol-3 path; the activation tooling and the
cutover lane retire.

## Scope

- In:
  - The removal migration.
  - The protocol-3 dispatch in `supabase/functions/group-eval`, and the TS
    only it imports (T01 doc §4.8).
  - The activation tooling: `group-competitions-activate.sh` and the two
    steps that run it (`ensure-dev-baseline.sh`; the local baseline's full
    path in `ensure-local-runtime-baseline.sh`, plus the
    `group_competition_active()` term in its stamp state hash and the matching
    pins in `scripts/tests/baseline-stamp.test.sh`), and the bodies' guard
    `require_active_group_competitions` (`supabase/tests/lib/groups-fixtures.sh`
    and its callers). T03 already removed `with-local-group-competitions.sh`
    and its pins.
  - Retire the groups-protocol4 lane (its trigger rows in
    `scripts/triggers.tsv`, and the cutover-only rows in map §8.1).
  - Specs.
- Out: hosted deploy (T06); app client (T05).

## Decided

- M35 D1–D4, D6; operator decision O3 (drop the M25 board engine).
- The object inventory in the T01 doc
  (`docs/plans/M35-pre-v4-inventory-and-test-map.md` §4, summary §4.12) is
  the drop/fold/keep list:
  - **drop**: 27 old public RPCs (no stubs, D2); 19 `*_pre_competition`
    bodies with no V4 caller; the 5 activation objects; 18 helpers reachable
    only from dropped code; 5 helpers dead after the folds; the 14-function
    M25 board engine incl. `group_metric_is_legacy`.
  - **fold into V4**: the 11 pairs in §4.12. Eight `*_pre_competition` bodies
    go into `group_competition_exercise_create`/`_update`/`_archive`,
    `_certify`, `_certification_end` and `_week_summary`. Also
    `group_metric_eval_source_graph_v3` → `group_metric_eval_source_graph`,
    `group_competition_require_active` → `group_competition_require_capability`,
    and `group_metric_names` → constant.
  - **keep, fold the active branch in place**: the 9 functions in §4.12.
    `group_rule_revisions.representation_version` gets column default 4 and
    the trigger goes.
  - **keep**: every worker RPC (`group_eval_*` and `group_metric_eval_*` are
    live in production), all other triggers, the D3 readers and the tables.
- Build each fold from the **final** function definition, not migration
  text. `group_metric_eval_source_graph_v3` was made by an anchor-patch DO
  block, and dropping it unfolded breaks the live evaluator (§4.11 item 2).
- `group_week_summary_pre_competition` is SECURITY INVOKER; its fold runs
  under the V4 function's definer context (§4.11 item 5).
- Replace the pre-V4 "rejects even with a forged header" tests with one
  catalog assertion: no pre-V4 function exists or is granted.
- `group_competition_contract` keeps its response shape (D4).
- The SQL-seeded history fixture from T02 (O2) must stay green unchanged. It
  is the proof that the D3 read paths survive.

## Open — resolve with the user at session start

- Whether `group_competition_activate` and the activation table are dropped
  or kept as a no-op for the hosted rollout's verification.
- Ordering against M34-T02 if it is in flight.

## Deliverables and acceptance

1. Fresh `./boga db reset` yields V4 with no activation step.
2. The migration fails loud on a pending database holding group data (D6).
3. `boga test backend` green with the V4 tests from T02/T03 unchanged except
   removed activation scaffolding.
4. No `group_competition_active()` reference and no pre-V4 RPC left in the
   final schema (catalog assertion).

## Specs to update

- `docs/specs/tech/group-competition-contract.md`: remove the pending,
  activation and cutover-procedure rules; keep metric meaning, disclosure and
  history rules.
- `docs/specs/tech/groups-contract.md`: one RPC generation, not three.
- `docs/specs/02-quality-and-test-gates.md`, `docs/specs/06-testing-strategy.md`:
  retire groups-protocol4.

## Gates

`fast` + `backend` + `ios-groups-e2e` + the three quality targets; confirm with
`./boga test for`.
