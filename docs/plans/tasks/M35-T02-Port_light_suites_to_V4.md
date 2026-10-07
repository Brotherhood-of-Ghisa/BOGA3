# M35-T02-Port_light_suites_to_V4 — Port the light suites to V4

- Status: `planned`
- Depends on: `M35-T01-Inventory_and_test_map`
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: backend tests + test infrastructure; UI impact: no

## Objective

The first half of moving the groups tests to V4: the suites with few ports
assert V4 behaviour on an active stack, the V4 chapters of
groups-competitions.sh run in a default lane, and stored protocol-3 history
is proven through the V4 readers by a fixture that survives server removal.
No server code changes.

## Scope

- In:
  - The contract header in `supabase/tests/lib/groups-fixtures.sh`: `rpc()`,
    `eval_drain()` and `sign_in()` send `x-boga-group-contract: 4`.
  - Port `groups-contract.sh`, `groups-leaderboards.sh` and
    `groups-week-summary.sh` per the T01 map.
  - Move the V4 chapters of `groups-competitions.sh` (map §8.1: F–J, L, M
    and the V4 parts of A/E) into a default `slow-backend` lane, with the V4
    refixture the `move*` rows need. Fix the kick-URL/sweep leak at
    `groups-competitions.sh:35-36` (save and restore, as
    `groups-boards.sh:51-63` does).
  - The SQL-seeded history fixture (T01 doc §3 O2).
  - The stale comments at `apps/mobile/__tests__/groups-api-live.test.ts:6-8`
    and `groups-competition-api-live.test.ts:2-4` (map §8.4 gives the text).
- Out:
  - `groups-boards.sh`, `groups-certification.sh`, `groups-bodyweight.sh`
    and the baseline flip (T03).
  - Migrations and server functions (T04). App code (T05).

## Decided

- M35 D4, D5. The T01 doc (`docs/plans/M35-pre-v4-inventory-and-test-map.md`)
  is the authority for every keep, port and delete: §5 groups-contract,
  §6 leaderboards, §7 week-summary, §8 competitions and Jest. The operator
  approved every delete there (O1).
- The ported expectations change where the map says the V4 shapes differ.
  Examples: session cards nest under `.session`; stream cursors are opaque;
  anon gets 42501, not `AUTH_REQUIRED`; exercise-list order differs;
  unarchive returns `rebuilding:true`; `group_eval_session_targets` now
  includes previously evaluated exercises (leaderboards.sh 558, 593, 602,
  671, 708).
- The ported exercise updates in groups-contract must not change rules, or a
  `rules_change` event breaks the backfill counts (groups-contract.sh:1763-1766).
- The baseline stays pending in this task. Ported bodies run active through
  a one-way activation step that marks the stack for reset
  (`with-local-group-competitions.sh` pattern).

## Open — resolve with the user at session start

- Which lane hosts the moved V4 competitions chapters: an existing lane, or a
  new `groups-competitions` row in `scripts/lanes.tsv`.
- How ported and unported bodies share the `groups-leaderboards` lane until
  T03 (e.g. order the pending bodies first and activate before the ported
  ones). Measure the cost.

## Deliverables and acceptance

1. `boga test backend` green, with the three ported suites and the moved V4
   chapters running on an active stack.
2. No assertion in the ported files calls a pre-V4 RPC.
3. The history fixture reads the seeded rev-3 revisions, M25 certification,
   witness alias and frozen entries through `group_competition_board`,
   `_history`, `_certification_get` and `_stream`, without any pre-V4 RPC.
4. Before/after timings for every changed lane (`./boga timings`).

## Specs to update

- `docs/specs/02-quality-and-test-gates.md`, `docs/specs/06-testing-strategy.md`:
  the lane matrix and what each groups lane proves.

## Gates

`fast` + `backend` + `groups-protocol4` + the three quality targets; confirm with
`./boga test for`.
