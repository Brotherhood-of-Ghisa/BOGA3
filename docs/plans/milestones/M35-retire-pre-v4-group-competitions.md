# M35 — Retire pre-V4 group competitions

- Status: `in_progress`
- Created: 2026-10-07, planning baseline `2d5e3385` on `origin/main`

## Objective

Group competition protocol 4 (V4) is the only representation production
serves (hosted activation, PR #524). Remove every older group representation —
the M25 `group_*` board/certification RPCs and protocol 3 (`group_metric_*`,
`*_v2`) — from the server, the evaluator, the app and the tests; make V4
unconditional so a fresh install and the local gate baseline are V4 like
production; and simplify what remains.

## Why (findings, 2026-10-07)

- The default backend gate (groups-contract, groups-leaderboards,
  groups-api-live) runs on a pending stack, so it tests the protocol-3
  representation and the pending branch of shared SQL. Production runs the
  other branch. V4 behaviour (authz matrix, payload privacy, correction
  matrix, publication fences, week summary) runs only in the `extra` lane
  groups-protocol4. `ios-groups-e2e` and the dev stack already run active.
- Since activation, every pre-V4 RPC returns `UPDATE_REQUIRED` in
  production; the app calls only V4 and the membership/settings RPCs
  (`apps/mobile/src/groups/api.ts:97-143`, since #551/#557).
- The protocol-3 tests were kept by inertia: written before V4 (#294, #297,
  #370), kept as "server rules" by #557 and #566.
- What they still reach: several V4 RPCs call renamed `*_pre_competition`
  implementations internally (`…group_competition_publication.sql:546-579,
  611, 670, 932`), and the evaluator/publish code branches on the activation
  flag (15 sites in that migration).
- Most default-lane files break on an active stack only because the test
  `rpc()` helper (`supabase/tests/lib/groups-fixtures.sh:119`) omits the
  `x-boga-group-contract: 4` header that `group_require_app_user()` requires
  once active.

## Scope

- In: server SQL (old public RPCs, `*_pre_competition` implementations,
  activation flag and branches, activation RPC), the group-eval protocol-3
  path, protocol-3 TS in `apps/mobile/src/groups`, every groups backend test
  and lane, the activation scripts and baseline rules, the owning specs, the
  hosted rollout of the removal.
- Out: Sync v2's own protocol 3 (`x-boga-sync-protocol`, a different thing —
  untouched); historical data (D3); any V4 wire-shape change (D4); RPC
  renames; new competition features.

## Agreed design direction

### D1. V4 is the only group representation

No pre-V4 code path survives: no protocol-3 RPCs, readers, writers or
evaluator branches, and no pending state. V4 becomes unconditional; the
activation table, `group_competition_activate` and every
`group_competition_active()` branch go.

### D2. Drop the old public RPCs; no stubs

Operator decision. Pre-V4 builds map both `UPDATE_REQUIRED` and PostgREST's
function-not-found to the same generic `INTERNAL` group error (their
`GROUP_SERVER_ERROR_CODES` has no `UPDATE_REQUIRED`), and they already fail
every group screen on the active stack. Stubs would buy nothing.

### D3. Remove code, keep history

Contract rule stands: preserve immutable audit, never relabel or rescore
history. Tables, columns and stored protocol-3-era rows (frozen entries,
witness aliases, `representation_version` 3 revisions) stay, as do the V4
read paths that present them.

### D4. V4 wire shapes are frozen

Shipped clients decode V4 payloads with exact-key guards
(`competition-wire-guards.ts`). Simplification is internal only; every V4
response keeps its exact shape (including `group_competition_contract`'s
`activation_state`, which now always reads `active`).

### D5. Port before delete

Tests move to V4 on an active local baseline (T02, T03) before any server
code is removed (T04). Each protocol-3 assertion is ported to the V4 RPC that
runs the same logic, or deleted with a stated reason. The operator approved
the map in T01 (O1). State-independent assertions stay.

### D6. Fail loud on a populated pending database

The removal migration refuses to run if the database is pending and holds
group data (no silent skip of the cutover).

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| M35-T01-Inventory_and_test_map | Pre-V4 object inventory with callers, hosted verification, assertion port/delete map ([results](../M35-pre-v4-inventory-and-test-map.md)) | none | completed |
| [M35-T02-Port_light_suites_to_V4](../tasks/M35-T02-Port_light_suites_to_V4.md) | Header; port groups-contract, leaderboards, week-summary; V4 competitions chapters to a default lane; SQL-seeded history fixture | T01 | planned |
| [M35-T03-Port_heavy_suites_and_flip_the_baseline](../tasks/M35-T03-Port_heavy_suites_and_flip_the_baseline.md) | Port boards, certification, bodyweight; local baseline active; groups-protocol4 down to cutover chapters | T02 | planned |
| [M35-T04-Remove_pre_V4_server_code](../tasks/M35-T04-Remove_pre_V4_server_code.md) | Removal migration, group-eval protocol-3 path, activation tooling, specs | T03 | planned |
| [M35-T05-Simplify_the_V4_client](../tasks/M35-T05-Simplify_the_V4_client.md) | Delete protocol-3 TS and dead V4 client surface | T04 | planned |
| [M35-T06-Hosted_rollout](../tasks/M35-T06-Hosted_rollout.md) | Operator-authorised hosted deploy and verification of T04 | T04 | planned |

T05 and T06 can run in parallel. T01's results, including the operator's
decisions O1–O4, live in `docs/plans/M35-pre-v4-inventory-and-test-map.md`;
delete it with the milestone.

## Risks / dependencies

- M34-T02 (group workout notifications) touches rank movement and
  publication SQL that T04 rewrites. Whichever lands second rebases;
  check M34's status before starting T04.
- T04 is irreversible on hosted. T06 needs the operator's explicit authority
  (group-competition contract §5) and hosted access (Supabase MCP or the
  operator running SQL).
- groups-leaderboards just dropped to 45–49s (#609) and groups-protocol4 to
  72–99s (#610). T02 and T03 record before/after timings for every changed lane; no
  cost claim without a record.
