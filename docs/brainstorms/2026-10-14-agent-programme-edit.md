# Brainstorm — Agents editing existing plans and programmes

- Date: 2026-10-14
- Status: `approved — adopted into milestone M38 (docs/plans/milestones/M38-agent-programme-and-plan-edits.md)`.
  All open decisions from §9 confirmed.
- Branch: `docs/agent-programme-edit-proposal`
- Author: OpenCode (DeepSeek V4.1 Flash).
- Not source-of-truth. Adopted content graduates into
  `docs/specs/tech/session-planning-contract.md` (§1.5, §6.1, §6.2, §7) and
  `docs/specs/10-api-authn-authz-guidelines.md`; the Connected Agents copy may
  touch `docs/product/copy.md`.

## 1. Problem

Today an agent can create plans and programmes but can never change one
afterwards. That makes a coaching agent effectively one-shot: correcting a
single target weight means authoring a replacement plan and asking the user to
delete the original. Real coaching is iterative — adjust next week's load,
reorder a wave, drop a block — so create-only is the main thing blocking a
useful agent loop.

This proposal asks: can we let agents **edit** authored plans and programmes,
without weakening the safety properties the current design deliberately bought
(§2)?

## 2. What exists today (grounded)

- **Create-only surface.** MCP exposes `create_session_plan` and
  `create_training_programme`; both annotated `readOnlyHint: false`,
  `idempotentHint: true`, `destructiveHint: false`
  (`services/boga-mcp/src/tools.ts:17-22`).
- **An explicit no-edit principle.** `session-planning-contract.md` §1.5:
  agents "can never edit or delete plans, start workouts, or mutate performed
  history." This proposal reverses the first clause, so it is a spec change,
  not an implementation detail.
- **Permission.** `public.agent_plan_permissions` — one row per
  `(owner_user_id, client_id)`, a single `plan_access_enabled boolean`, bound to
  the live OAuth grant timestamp
  (`supabase/migrations/20261010120000_m23_agent_plan_permission.sql:26-41`).
- **Idempotency.** `public.agent_plan_write_receipts` keys on
  `(owner, client, operation, idempotency_key)` and stores only a payload hash +
  emitted IDs. The `operation` CHECK currently allows exactly the two creates
  (`…:96-97`).
- **Write path.** Service-role-only, atomic RPCs
  (`agent_create_session_plan`, `agent_create_training_programme`) insert a whole
  graph with `provenance = 'agent'` and pending blocks. There is **no update
  RPC** — the write model is append-only by construction.
- **The edit boundary already exists.** §4.1: `pending` blocks are editable;
  `attached` and `resolved` are not. The token for violating that —
  `IMMUTABLE_BLOCK_MUTATION` — is already reserved in §7.2 as wire-stable, but
  **is not implemented anywhere** (grep finds zero code references). This
  proposal is where it would earn its keep.
- **The mutation vocabulary already exists.** The mobile store defines exactly
  the operations an editor needs, with the invariants spelled out
  (`apps/mobile/src/data/session-plan-store.ts:397-432`): `updatePlanMeta`,
  `savePlanExerciseGraph` ("a pending, unattached block only"), `insertPlanExercise`,
  `updateProgrammeMeta`, `reorderProgrammePlans`, `reorderPlanExercises`,
  `reorderPlanSets`, `tombstonePlan`, `tombstoneProgramme` (detaches live plans),
  `tombstonePlanExercise`.
- **Provenance is set once.** `session_plans.provenance` is `'human' | 'agent'`,
  written at creation only.

## 3. Why this is safe enough to attempt

The blueprint/performed split is what makes agent mutation tolerable, and it is
already in place:

- Plans are authored intent; performed rows link back only via nullable FKs with
  `ON DELETE SET NULL` (§2.2). **An agent editing a plan structurally cannot
  rewrite performed history.** That is the property that makes the whole idea
  worth doing.
- The `pending` vs `attached`/`resolved` boundary (§4.1) is the natural edit
  surface, so no new lifecycle rule is needed — only enforcement of the existing
  one.
- Permission + idempotency scaffolding generalises with a widened CHECK and new
  RPCs.

So the delta is mostly additive. The hard part is not the write; it is
concurrency (§4).

## 4. The hard problem: concurrent edits

Creates are conflict-free by construction — fresh IDs, append-only. Edits are
read-modify-write on rows the user is *also* editing on-device, and the agent
cannot see a device's unsynced local edits. Sync reconciles on
`client_updated_at_ms` last-write-wins, so an agent edit that lands while a user
has an offline draft can silently discard one side.

Two windows:

1. **Agent read → device push → agent write.** Solvable on the agent side with
   optimistic concurrency: the agent sends the base version it read, and the
   server rejects if the plan moved. **This is required.**
2. **Agent write → device pushes a stale offline edit.**
   - *Synced state:* The agent RPC strictly advances `client_updated_at_ms = greatest(stored.client_updated_at_ms + 1, now_ms)`, ensuring the key never regresses and preventing mobile clients from dropping the update on pull (`incoming <= local`).
   - *Offline / fast-clock residual:* Sync v2 permits device timestamps up to 5 minutes ahead of server time (`least(client_updated_at_ms, now_ms + 5 min)`). If an offline device made an edit *before* the agent write using a fast clock, its unseen timestamp could exceed both `stored + 1` and `now_ms`. When it later pushes, LWW will overwrite the agent edit. Conversely, an offline edit stamped with an older timestamp will be silently dropped by the agent write. This two-way data-loss residual is inherent to pure LWW without push-time conflict detection; it is an accepted trade-off here (see §9, Q4).

The design therefore needs a **version token** on plan/programme reads and a new
typed rejection, not just an update RPC.

## 5. Proposed design

### 5.1 Scope

An agent may mutate **pending, unattached, authored content only**, within the
existing graph limits (§7.1). It may never:

- touch an `attached` or `resolved` block (→ `IMMUTABLE_BLOCK_MUTATION`),
- touch the performed session/exercise/set graph,
- start, resume, complete or skip a workout,
- edit a plan or block whose live performed card has claimed it.

### 5.2 Mutation surface — mirror the mobile store

Server-side, expose exactly the operations the store already defines, so the
agent path and the app path share one invariant set rather than inventing a
second one. No full-graph replacement: delete-and-reinsert collides with the
per-block provenance partial-unique indexes (§4.5), churns IDs the device holds,
and orphans local edits.

| Agent operation | Mirrors store op | Invariants enforced server-side |
| :--- | :--- | :--- |
| `update_programme_meta` | `updateProgrammeMeta` | name 1..100, description 0..500 |
| `update_plan_meta` | `updatePlanMeta` | title 1..100; `gym_id` owned; `scheduled_for`; never touches blocks |
| `add_plan_block` | `insertPlanExercise` | append at next dense `order_index`; ≤30 blocks |
| `edit_plan_block` | `savePlanExerciseGraph` | block is **pending and unattached**; 1..30 sets |
| `reorder_programme_plans` | `reorderProgrammePlans` | exact set of live child plans; keeps 2..50 |
| `reorder_plan_blocks` | `reorderPlanExercises` | exact set of live blocks |
| `reorder_block_sets` | `reorderPlanSets` | exact set of live sets |
| `remove_plan_block` | `tombstonePlanExercise` | soft-delete block + live sets; pending only; requires ≥1 live blocks to remain (refuses 0-block plans) |
| `detach_plan_from_programme` | dedicated detach (not `tombstonePlan`) | clears `programme_id` and `programme_order_index`, redensifies siblings; plan remains live standalone; keeps performed history; ≥2 plans remain or the op is refused |
| `remove_plan` | `tombstonePlan` | soft-delete plan + live blocks + live sets; pending only; detaches from programme if attached |
| `remove_programme` | `tombstoneProgramme` | soft-delete programme, detach live child plans |

Removal is **always a tombstone (`deleted_at`)**, never a hard delete, so it
propagates through sync and preserves any provenance links. Detaching a plan from
a programme (`detach_plan_from_programme`) is distinct from deletion: it clears
`programme_id` and `programme_order_index` so the plan becomes standalone, leaving
the plan and its blocks/sets live. `remove_plan` tombstones the plan and its
blocks/sets.

### 5.3 Concurrency contract

- Reads that support editing (`get_upcoming_session_plans`, and a new
  programme-detail read) return a per-plan/programme **version token** covering
  the **entire plan graph** (root plan, blocks, and target sets). A root-only
  token (e.g. `session_plans.server_received_at`) is insufficient because Sync
  v2 updates child tables (`session_plan_exercises`, `session_plan_sets`)
  independently without advancing the root plan's timestamp; an agent editing a
  block would otherwise miss concurrent child-level device edits. The token can
  be derived from the maximum `server_received_at` across the graph (or a
  monotonic graph revision/hash).
- Every mutation carries the token it read as `base_version`.
- If the live row no longer matches, the server rejects with a new wire-stable
  `PLAN_CONCURRENT_MODIFICATION` (409) and writes nothing. The agent re-reads and
  retries.
- This makes the agent path at-most-once-per-version and turns a silent clobber
  into a retryable error for window 1. Window 2 (§4) stays open and is
  documented as a known residual.

### 5.4 Permission model

`plan_access_enabled` is a single boolean, but create and edit have very
different blast radii: create cannot destroy anything; edit can. A user should be
able to let an agent *draft new plans* without letting it *modify plans they have
already scheduled*.

Proposal: add `plan_edit_enabled boolean not null default false` to
`agent_plan_permissions`, default-denied, bound to the same live grant. Edit
tools require it; create tools keep requiring `plan_access_enabled`. The
Connected Agents screen gains a second toggle, and the 403 message
(`supabase/functions/agent-api/index.ts:1700`, currently "Plan creation is not
enabled for this coach.") needs an edit-specific variant.

### 5.5 Provenance and audit

`session_plans.provenance` is set once and cannot express "human plan later
edited by an agent". Two options:

- **(a) `last_modified_by` column** (`'human' | 'agent'`) on the four authored
  entities, advanced on every agent mutation. Cheap, but requires explicit
  wiring across the stack: mobile SQLite schemas (Drizzle), `ENTITY_FIELDS`
  mapping in `apps/mobile/src/sync/cycle.ts`, `sync_push`/`sync_pull` projections,
  and updating mobile store writes (`session-plan-store.ts`) to stamp `'human'`
  so human edits reset the attribution.
- **(b) A control-table edit log** (like the receipts table: owner, client,
  entity, operation, timestamp, no payload). Richer audit, not a synced entity.

Recommend (a) for the sync-visible fact plus reuse of the receipts row for the
audit trail; decide before shipping, because retrofitting an audit trail later is
worse than designing it now. Whether the UI shows "edited by coach" is a product
fact → ask (§7).

### 5.6 MCP tool metadata

Edit tools are **not** all non-destructive. `remove_plan_block`,
`detach_plan_from_programme`, `remove_plan` and `remove_programme` destroy
authored intent or structure, so their annotations must be
`destructiveHint: true`; MCP clients use that hint to gate user confirmation.
Reorder/meta tools stay `destructiveHint: false`. This is a real change to the
tool contract, not a copy tweak.

### 5.7 Error tokens

| Token | Status | Meaning |
| :--- | :--- | :--- |
| `PLAN_CONCURRENT_MODIFICATION` | **new** | `base_version` no longer matches the live graph. |
| `PLAN_EDIT_PERMISSION_REQUIRED` | **new** (or reuse `PLAN_PERMISSION_REQUIRED` with a distinct message) | edit not enabled for this coach. |
| `IMMUTABLE_BLOCK_MUTATION` | reserved §7.2, **unimplemented** | target block is attached or resolved. |
| `FOREIGN_RESOURCE_REFERENCE` | existing | referenced exercise/gym/plan not the user's. |
| `IDEMPOTENCY_CONFLICT` | existing | same key, different payload. |
| `INVALID_ARGUMENT` | existing | limits, reorder set mismatch, "<2 plans remain", "<1 blocks remain". |

## 6. Wire / RPC sketch

Routes (mirroring the existing create routes in §6.1):

| Route | Method | Purpose |
| :--- | :--- | :--- |
| `/v1/agent/session-plans/:planId` | `PATCH` | meta / block add-edit-reorder / remove |
| `/v1/agent/programmes/:programmeId` | `PATCH` | meta / reorder / remove |
| `/v1/agent/programmes/:programmeId` | `GET` | programme detail + per-plan version tokens (edit-enabling read) |

All `PATCH` routes require `Idempotency-Key`, re-check the current grant and
`plan_edit_enabled`, and validate the strict wire schema in the Edge Function
before calling a service-role RPC.

RPCs (service-role only, one transaction each, re-checking every referenced
owner row):

- `app_public.agent_update_plan_meta(owner, plan_id, base_version, patch, now_ms)`
- `app_public.agent_update_programme_meta(...)`
- `app_public.agent_insert_plan_block(...)`
- `app_public.agent_update_plan_block(...)` — refuses non-pending/non-attached
- `app_public.agent_reorder_plan_blocks(...)` / `…_programme_plans` / `…_block_sets`
- `app_public.agent_tombstone_plan_block(...)` — refuses non-pending/non-attached; refuses if plan would be left with <1 live blocks
- `app_public.agent_detach_programme_plan(...)` — detaches child plan without tombstoning; redensifies siblings; refuses if programme left with <2 plans
- `app_public.agent_tombstone_plan(...)` / `…_programme`

Every RPC sets `client_updated_at_ms = greatest(stored.client_updated_at_ms + 1,
now_ms)` on every mutated or tombstoned row. Writing bare `now_ms` would regress
the LWW key whenever a device wrote with a fast clock (Sync v2 allows clocks up
to 5 minutes ahead), causing mobile clients to drop the pull update and allowing
stale pushes to win.

Migration sketch (one new migration, no change to applied ones):

1. `alter table public.agent_plan_permissions add column plan_edit_enabled boolean not null default false;`
2. Widen `agent_plan_write_receipts_operation_valid` to include the new
   operations (drop + re-add the CHECK; existing rows stay valid).
3. If option 5.5a is adopted: `add column last_modified_by text` on the four
   authored entities, update `sync_push` / `sync_pull` projections, add mobile
   Drizzle migrations, wire `apps/mobile/src/sync/cycle.ts` (`ENTITY_FIELDS`),
   and update `session-plan-store.ts` human writes to set `'human'`.
4. The RPCs above; each claims/validates the idempotency key, checks
   graph-wide `base_version`, enforces pending-only and graph limits (≥1 block,
   ≥2 plans), advances `client_updated_at_ms` monotonically
   (`greatest(existing + 1, now_ms)`), tombstones or detaches appropriately,
   and re-checks ownership.
5. Extend `dev_wipe_my_data` parity if any new table is added (none if 5.5a).

## 7. Spec and product impact

- **Spec.** §1.5 (the no-edit principle), §6.1 (route table), §6.2 (tool
  surface: "Nine tools … two create-only"), §7.2 (new tokens). The doc is
  word-budgeted, so the edit is a rewrite of those clauses, not an append.
- **Product.** Two candidate `docs/product/` facts: (i) whether a separate edit
  consent is offered, (ii) whether the UI surfaces "edited by coach". Neither is
  mine to decide — stop and ask the product owner (`AGENTS.md`, "Always load").
- **Authz spec.** `docs/specs/10-api-authn-authz-guidelines.md` §114 describes the
  plan-permission gate; it needs the edit-permission clause.

## 8. Verification sketch

- **Jest (MCP):** tool registration/annotations (destructive hints), error
  mapping for the new tokens, permission-denied paths.
- **`boga test backend` (`supabase/tests/agent-api-contract.sh`):** default-denied
  edit → `PLAN_EDIT_PERMISSION_REQUIRED`; stale `base_version` →
  `PLAN_CONCURRENT_MODIFICATION` and no write; edit/remove an attached block →
  `IMMUTABLE_BLOCK_MUTATION`; idempotent replay and conflict; remove-plan detaches
  and preserves performed history; `<2 plans remain` refused; `<1 blocks remain` refused.
- **`boga test mcp-smoke`:** end-to-end edit round-trip through the MCP server.
- A stale-version write must be proven to write nothing, not just to error.

## 9. Open questions (decisions to confirm)

| # | Question | Lean |
| :--- | :--- | :--- |
| Q1 | Separate edit consent, or one `plan_access_enabled` covering both? | Separate (§5.4). |
| Q2 | Provenance: `last_modified_by` column, edit log, or both? | Column + receipt (§5.5a). |
| Q3 | Version token: graph-wide max(`server_received_at`) or a dedicated monotonic revision? | Decide with a spike; must cover root + child blocks + sets to detect child mutations. |
| Q4 | Do we accept the window-2 residual (two-way silent LWW overwrite on offline device push with clock skew), or scope Sync v2 conflict detection in? | Accept + surface in v1; revisit. |
| Q5 | New token `PLAN_EDIT_PERMISSION_REQUIRED`, or reuse `PLAN_PERMISSION_REQUIRED` with a distinct message? | Distinct token; clients gate on it. |
| Q6 | Is `scheduled_for` (rescheduling) in scope, or its own permission/tool? | In scope, but flag it — it is the most surprising edit. |
| Q7 | Should agents ever edit `provenance = 'human'` plans, or only agent-authored ones? | Both, gated by the edit consent. |

## 10. Rejected alternatives

- **Full-graph replacement** (`PUT` the whole programme): collides with the
  provenance partial-unique indexes, churns IDs, orphans local edits. Rejected.
- **Hard delete on removal:** breaks sync propagation and provenance. Rejected in
  favour of tombstones.
- **No version token** (trust the agent's read): guarantees eventual silent data
  loss (§4). Rejected.
- **Reusing the create RPC with an "upsert" flag:** hides the pending-only and
  concurrency rules behind a mode switch. Rejected in favour of explicit,
  addressable operations.

## Decision log

| # | Date | Decision |
| :--- | :--- | :--- |
| 1 | 2026-10-14 | Scope limited to pending, unattached, authored content; performed graph and attached/resolved blocks stay untouchable. |
| 2 | 2026-10-14 | Mutation surface mirrors `session-plan-store.ts` operations; no full-graph replacement. |
| 3 | 2026-10-14 | Optimistic concurrency (`base_version`) is mandatory; `PLAN_CONCURRENT_MODIFICATION` added. |
| 4 | 2026-10-14 | Removals are tombstones; programme removal detaches child plans. |
| 5 | 2026-10-14 | Destructive edit tools must carry `destructiveHint: true`. |
| 6 | 2026-10-15 | Agent mutation RPCs advance `client_updated_at_ms` monotonically (`greatest(stored + 1, now_ms)`) to prevent LWW regression under Sync v2's 5-minute future clamp. |
| 7 | 2026-10-15 | Detaching a plan from a programme (`detach_plan_from_programme`) is a dedicated operation distinct from plan deletion (`remove_plan`). |
| 8 | 2026-10-15 | Version tokens must cover the full graph (root plan + child blocks + sets) because Sync v2 updates child rows independently. |
| 9 | 2026-10-15 | `remove_plan_block` enforces a minimum of 1 live block remaining per plan. |
| 10 | 2026-10-15 | `last_modified_by` (if adopted) requires full mobile Drizzle + `cycle.ts` + sync projection + store wiring. |
| 11 | 2026-10-19 | Proposal approved and adopted into milestone M38 (`docs/plans/milestones/M38-agent-programme-and-plan-edits.md`). |
| 12 | 2026-10-19 | Q1: Separate edit consent (`plan_edit_enabled`), separate toggle in Connected Agents. |
| 13 | 2026-10-19 | Q2: Provenance tracked via `last_modified_by` column on the 4 authored tables + receipts row audit trail. |
| 14 | 2026-10-19 | Q3: Full-graph version token derived from max(`server_received_at`) covering root plan, blocks, and target sets. |
| 15 | 2026-10-19 | Q4: Window-2 LWW residual accepted for v1. |
| 16 | 2026-10-19 | Q5: Wire-stable token `PLAN_EDIT_PERMISSION_REQUIRED` (403) and `PLAN_CONCURRENT_MODIFICATION` (409). |
| 17 | 2026-10-19 | Q6: `scheduled_for` is editable in `update_plan_meta`. |
| 18 | 2026-10-19 | Q7: Agents can edit both agent-authored and human-authored plans (pending, unattached blocks only) when edit permission is enabled. |
