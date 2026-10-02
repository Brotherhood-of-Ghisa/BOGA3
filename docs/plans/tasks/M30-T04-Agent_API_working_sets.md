# M30-T04-Agent_API_working_sets — Agent API metrics read working sets only

- Status: `planned`
- Depends on: `M30-T01-Working_set_rule_and_records`
- Milestone: `docs/plans/milestones/M30-working-sets-only-stats.md`
- Areas: backend (edge function `agent-api`), MCP docs; UI impact: no

## Objective

The coaching API's derived figures follow M30 D1. In `get_exercise_context`
these are `personal_records` (1RM, top weight, best session volume) and the
per-session volume, 1RM and `volume_series`. In `get_recent_workouts` they are
`completed_set_count`, `total_volume`, and per-exercise volume and `set_count`.
Raw per-set output still lists warm-ups with their `set_type`.

## Scope

- In:
  - `supabase/functions/agent-api/{index.ts,training-metrics.ts}`.
  - `agent-api/README.md`, including fixing the non-canonical
    `"set_type": "working"` example (`:139`).
  - `services/boga-mcp` tool descriptions and README where they describe these
    figures.
  - `supabase/tests/agent-api-contract.sh`: add warm-up fixtures, and fix its
    `set_type 'working'` seeds.
- Out:
  - Group functions (T05).
  - The mobile app (T01–T03).

## Decided

- M30 D1 and D2, using T01's predicate from the shared kernel.
- `METRIC_REVISION` changes if the API exposes it as a meaning-of-figures
  version.

## Open — resolve with the user at session start

1. `exercises[].set_count` today is a raw row count. Should it become working
   sets (D4) or be renamed to make it clear it counts rows?

## Deliverables and acceptance

1. Contract tests seed warm-ups heavier than the working sets and assert that
   they are excluded from every derived figure and present in the raw sets.
2. The README and MCP docs state the rule.

## Specs to update

- `supabase/functions/agent-api/README.md`, and whatever coaching-API contract
  spec owns these fields.

## Gates

Expected from `./boga test for`: `fast` + `backend` + `mcp-smoke`.
