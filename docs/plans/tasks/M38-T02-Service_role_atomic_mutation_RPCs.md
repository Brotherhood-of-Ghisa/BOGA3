# M38-T02 — Service role atomic mutation RPCs

- Status: `planned`
- Depends: `M38-T01-Contract_specifications_and_schema_design`
- Milestone: `docs/plans/milestones/M38-agent-programme-and-plan-edits.md`
- Areas: backend; UI impact: no

## Objective

Implement the service-role-only atomic PostgreSQL functions supporting agent plan and programme mutations, enforcing full-graph optimistic concurrency validation, monotonic timestamp updates, pending-block invariants, and structural graph limits.

## Scope

- In:
  - Database RPC functions in `app_public`:
    - `agent_update_plan_meta(owner, plan_id, base_version, patch, now_ms)`
    - `agent_update_programme_meta(owner, programme_id, base_version, patch, now_ms)`
    - `agent_insert_plan_block(owner, plan_id, base_version, block, now_ms)`
    - `agent_update_plan_block(owner, plan_id, exercise_id, base_version, block, now_ms)`
    - `agent_reorder_plan_blocks(owner, plan_id, base_version, exercise_ids, now_ms)`
    - `agent_reorder_programme_plans(owner, programme_id, base_version, plan_ids, now_ms)`
    - `agent_reorder_block_sets(owner, plan_id, exercise_id, base_version, set_ids, now_ms)`
    - `agent_tombstone_plan_block(owner, plan_id, exercise_id, base_version, now_ms)`
    - `agent_detach_programme_plan(owner, programme_id, plan_id, base_version, now_ms)`
    - `agent_tombstone_plan(owner, plan_id, base_version, now_ms)`
    - `agent_tombstone_programme(owner, programme_id, base_version, now_ms)`
  - Graph-wide version calculation covering max `server_received_at` across root plan, blocks, and target sets; rejecting stale versions with `PLAN_CONCURRENT_MODIFICATION`.
  - Rejection of edits/tombstones on non-pending or attached blocks with `IMMUTABLE_BLOCK_MUTATION`.
  - Monotonic timestamp advance: `client_updated_at_ms = greatest(stored.client_updated_at_ms + 1, now_ms)` and `last_modified_by = 'agent'` on all modified rows.
  - Idempotency receipt recording and replay validation against `public.agent_plan_write_receipts`.
  - Contract test coverage in `supabase/tests/agent-api-contract.sh`.
- Out:
  - Edge Function HTTP route handlers (owned by T03).
  - MCP client tooling (owned by T04).

## Decided

- D2: Operations mirror store mutations; soft tombstones used for removals; detach redensifies sibling orders.
- D3: Full-graph version check; stale version aborts the transaction with `PLAN_CONCURRENT_MODIFICATION`.
- D4: Monotonic `client_updated_at_ms` advance prevents LWW regression under clock skew.

## Open — resolve with the user at session start

- None.

## Deliverables and acceptance

1. All 11 atomic RPC functions defined with `security definer` and restricted to `service_role`.
2. Stale `base_version` writes fail atomically without writing partial rows.
3. Attempting to mutate an attached or resolved block raises `IMMUTABLE_BLOCK_MUTATION`.
4. Deleting a block when <1 block would remain, or detaching a plan when <2 plans would remain in a programme, raises `INVALID_ARGUMENT`.
5. Idempotent replays return identical result IDs; payload conflicts return `IDEMPOTENCY_CONFLICT`.
6. Backend contract suite (`supabase/tests/agent-api-contract.sh`) passes with new edit cases.

## Specs to update

- None (specs updated in T01).

## Gates

Expected from `./boga test for`:
`backend`, `fast`
