# M35-T02-Port_tests_to_V4_on_an_active_baseline — Port tests to V4 on an active baseline

- Status: `planned`
- Depends on: `M35-T01-Inventory_and_test_map`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: backend tests + test infrastructure; UI impact: no

## Objective

Every local gate runs on a V4-active stack, as production does, and the
groups tests assert V4 behaviour. No server code changes in this task.

## Scope

- In: activate after reset/seed in the local baseline; the test `rpc()`
  header; the T01 port/delete map; moving the post-activation chapters of
  `groups-competitions.sh` and `groups-competition-api-live.test.ts` into a
  default `slow-backend` lane; the reset rule and wrappers.
- Out: migrations and server functions (T03); app code (T04).

## Decided

- M35 D4, D5. The T01 map is the authority for every port and delete.
- `rpc()` in `supabase/tests/lib/groups-fixtures.sh` sends
  `x-boga-group-contract: 4`.
- The baseline full path activates after seeding, and the activation state
  joins the baseline stamp's state hash
  (`supabase/scripts/ensure-local-runtime-baseline.sh`).
- `stack_reset_reason` stops treating "protocol 4 active" as a reset reason;
  the one-way marker stays for the old-migration reset.
- `ios-groups-e2e` and `groups-competition-live.sh` stop wrapping in
  `with-local-group-competitions.sh`.
- groups-protocol4 shrinks to the cutover chapters (reset to the
  pre-publication migration → protocol-3 fixtures → push → pending checks →
  activation); it retires in T03.

## Open — resolve with the user at session start

- Which default lane hosts the moved V4 chapters (an existing one, or a new
  `groups-competitions` row in `scripts/lanes.tsv`).

## Deliverables and acceptance

1. `boga test backend` green on an active baseline, with the moved V4
   chapters in it.
2. No default-lane assertion calls a pre-V4 RPC except as the T01 map allows.
3. Timing records before/after for every changed lane (`./boga timings`).
4. Stale comments fixed: `apps/mobile/__tests__/groups-api-live.test.ts:6-8`,
   `apps/mobile/__tests__/groups-competition-api-live.test.ts:2-3`.

## Specs to update

- `docs/specs/02-quality-and-test-gates.md`, `docs/specs/06-testing-strategy.md`
  — lane matrix and the groups-protocol4 description.
- `docs/specs/01-worktree-and-environment.md` /
  `docs/specs/12-worktree-config-and-isolation.md` if they describe the reset rule.

## Gates

`fast` + `backend` + `groups-protocol4` + `ios-groups-e2e` + the three quality
targets; confirm with `./boga test for`.
