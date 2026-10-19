# M38 — Connected Agent Programme and Plan Edits

- Status: `planned`
- Created: 2026-10-19, planning baseline `5e0ec67f23900c80a8b2f9eb0bd641e9ca6c5398` on `origin/main`

## Objective

Enable connected coaching agents to edit authored session plans and training programmes safely and iteratively via the agent API and MCP, without violating the blueprint/performed split, risking silent clobbering of user edits, or mutating performed workout history.

## Scope

- In:
  - Store-mirroring mutation operations: meta updates, block additions, block edits, block/plan reordering, block removals (tombstones), plan detachments from programmes, and plan/programme removals.
  - Optimistic concurrency control via graph-wide version tokens and wire-stable `PLAN_CONCURRENT_MODIFICATION` (409).
  - Explicit, default-denied edit permission (`plan_edit_enabled`) separate from create access, manageable via a new toggle in Connected Agents.
  - Provenance tracking via `last_modified_by` (`'human' | 'agent'`) across the four authored plan entities and receipt audit trails.
  - Monotonic `client_updated_at_ms` advances (`greatest(stored + 1, now_ms)`) to prevent LWW regression under Sync v2 clock skew.
  - New agent API routes (`PATCH /v1/agent/session-plans/:planId`, `PATCH /v1/agent/programmes/:programmeId`, `GET /v1/agent/programmes/:programmeId`).
  - MCP edit tools annotated with appropriate `destructiveHint` hints.
  - Wire-stable enforcement of `IMMUTABLE_BLOCK_MUTATION` for attached/resolved blocks.
- Out:
  - Agent mutation of active, completed, or deleted performed history (`sessions`, `session_exercises`, `exercise_sets`).
  - Starting, completing, or skipping workouts or blocks on behalf of the user.
  - Full-graph replacement (`PUT`) or hard deletion.
  - In-workout live plan adjustments while a workout card has claimed the block.

## Agreed design direction

### D1. Safety boundary and immutable blocks
Agents may mutate pending, unattached authored content only (`session_plans`, `training_programmes`, `session_plan_exercises`, `session_plan_sets`). If a target block is already attached to an active workout or resolved (`progress_status != 'pending'`), the write is rejected with `400 IMMUTABLE_BLOCK_MUTATION`. Agents can never touch performed rows or advance workout lifecycle.

### D2. Store-mirroring mutations (no full-graph replacement)
Server-side operations mirror mobile `session-plan-store.ts` operations instead of accepting full-graph JSON replacements. This avoids colliding with per-block partial-unique indexes, churning IDs held by client devices, or orphaning concurrent local edits. All removals are soft tombstones (`deleted_at`). Detaching a plan from a programme clears `programme_id` and `programme_order_index` while keeping the plan live standalone.

### D3. Optimistic concurrency with graph-wide version tokens
To protect against window-1 concurrency conflicts (agent read → device push → agent write), reads that support editing (`get_upcoming_session_plans` and `get_programme_detail`) return a version token computed as the maximum `server_received_at` across the entire plan graph (root plan, blocks, and target sets). Every mutation supplies `base_version`; if the live graph's version does not match, the server aborts with `409 PLAN_CONCURRENT_MODIFICATION`. Window-2 LWW residual under device clock skew is accepted for v1.

### D4. Monotonic timestamp advances
Agent mutation RPCs advance `client_updated_at_ms = greatest(stored.client_updated_at_ms + 1, now_ms)` on every mutated or tombstoned row. This prevents the LWW key from regressing when devices write with fast clocks within Sync v2's 5-minute future clamp, ensuring mobile clients pull the update.

### D5. Separate edit permission (`plan_edit_enabled`)
Create and edit have distinct blast radii. A new column `plan_edit_enabled boolean not null default false` is added to `public.agent_plan_permissions`. Edit tools require `plan_edit_enabled = true`; create tools continue requiring `plan_access_enabled = true`. When edit is disabled, edit requests fail with `403 PLAN_EDIT_PERMISSION_REQUIRED`. The Connected Agents screen gains an independent "Allow coach to edit plans" toggle.

### D6. Provenance and audit logging
A `last_modified_by text check (last_modified_by in ('human', 'agent'))` column is added to `training_programmes`, `session_plans`, `session_plan_exercises`, and `session_plan_sets`. Mobile Drizzle schemas, `apps/mobile/src/sync/cycle.ts` (`ENTITY_FIELDS`), and sync push/pull projections propagate it. Mobile store writes stamp `'human'`; agent RPCs stamp `'agent'`. `public.agent_plan_write_receipts` widens its operation CHECK to record idempotency receipts for all edit operations.

### D7. MCP tool metadata and destructive hints
Tools that soft-delete content or detach structure (`remove_plan_block`, `detach_plan_from_programme`, `remove_plan`, `remove_programme`) carry `destructiveHint: true` to trigger client-side confirmation. Reorder and meta tools carry `destructiveHint: false`.

### D8. Wire-stable error tokens
Stable error tokens:
- `PLAN_EDIT_PERMISSION_REQUIRED` (403): client lacks active edit permission.
- `PLAN_CONCURRENT_MODIFICATION` (409): graph version moved since agent read.
- `IMMUTABLE_BLOCK_MUTATION` (400): target block is attached or resolved.
- `FOREIGN_RESOURCE_REFERENCE` (400): referenced gym or exercise not owned by user.
- `IDEMPOTENCY_CONFLICT` (409): same idempotency key with differing payload.
- `INVALID_ARGUMENT` (400): structural violation (<1 block remains in plan, <2 plans remain in programme, out-of-range counts).

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| `M38-T01-Contract_specifications_and_schema_design` | Update session planning & authz specs; add DB migration for permissions, receipts, and `last_modified_by`; update sync projections and Drizzle schema | none | planned |
| `M38-T02-Service_role_atomic_mutation_RPCs` | Implement 9 atomic mutation RPCs with graph version check, pending checks, monotonic timestamps, and contract tests | T01 | planned |
| `M38-T03-Agent_API_edit_endpoints_and_validation` | Add PATCH/GET routes in Edge Function, wire validation, edit permission check, and version token emissions | T02 | planned |
| `M38-T04-MCP_edit_tools_and_smoke_verification` | Implement MCP edit tools, destructive hints, API client methods, and mcp-smoke tests | T03 | planned |
| `M38-T05-Mobile_Connected_Agents_edit_toggle_and_store_wiring` | Add Connected Agents edit switch, wire store human writes to stamp `last_modified_by = 'human'`, and mobile tests | T01 | planned |
| `M38-T06-Milestone_closeout_and_full_verification` | Run full quality gates (coverage, complexity, deps), update as-built specs, and archive cards | T04, T05 | planned |

## Risks / dependencies

- **Sync v2 schema expansion:** Adding `last_modified_by` across four synced tables requires strict alignment between Postgres, `sync_push`/`sync_pull` RPC projections, mobile Drizzle SQLite schema, and `ENTITY_FIELDS` in `cycle.ts`. Missing any projection site breaks sync round-trip.
- **Child-table mutations vs plan timestamp:** Graph version calculation must read the maximum timestamp across parent and child tables so changes to sets or blocks without root plan updates still trigger optimistic conflict detection.
