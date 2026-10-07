# M35-T01-Inventory_and_test_map — Inventory and test map

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M35-retire-pre-v4-group-competitions.md`
- Areas: docs (plan-only output) + read-only hosted checks; UI impact: no

## Objective

Produce the facts T02 and T03 build on: every pre-V4 server object and who
still calls it, hosted evidence that nothing pre-V4 is live, and an
assertion-by-assertion port/delete map the operator approves.

## Scope

- In: inventory, hosted read-only verification, the test map, measuring an
  active local baseline, updating the T02/T03 cards with the results.
- Out: any code, test or migration change.

## Decided

M35 D1–D6.

## Open — resolve with the user at session start

- How hosted checks run: Supabase MCP (needs authorising) or the operator
  runs the SQL.
- Permission to activate the session's own slot stack (one-way; restored by
  `./boga db reset`) for the measurement in deliverable 4.

## Deliverables and acceptance

1. **Object inventory.** Every pre-V4 function, `*_pre_competition`
   implementation, trigger and activation-flag branch in `supabase/migrations`,
   with its callers: app, V4 RPCs (internal reuse), workers, edge function,
   scripts, tests. Mark each: drop, fold into V4, or keep (D3 history).
2. **Hosted evidence** (production, and BOGA_DEV if it serves anyone):
   activation flag set; no queued or claimable protocol-3 evaluation graph;
   no pre-V4 RPC calls in the API logs since activation.
3. **Test map** for `groups-contract.sh`, `groups-leaderboards.sh`,
   `groups-boards.sh`, `groups-certification.sh`, `groups-bodyweight.sh`,
   `groups-week-summary.sh`, `groups-competitions.sh`,
   `groups-competition-live.sh` and the groups Jest live suites: per
   assertion — keep, keep + header, port to <V4 RPC> (naming the inner logic
   it still guards), or delete (reason). The operator approves every delete.
4. **Measured baseline:** on the session's slot, activation cost after a
   reset, and each default backend lane run on an active stack (direct, not
   via `./boga test`, so nothing enters the timing store) with pass/fail.
5. T02 and T03 cards updated with the inventory and map.

## Gates

`./boga test fast` (docs-check).
