# Sync v2 Server Contract

> **Owns:** the Sync v2 server schema rules (Part A) and the `sync_push` /
> `sync_pull` protocol (Part B). **Not here:** sync scope, entity list, local
> bookkeeping columns, the account wipe and the client schema drift rule →
> `docs/specs/05-data-model.md`; the OAuth agent boundary →
> `docs/specs/10-api-authn-authz-guidelines.md`. **Load when:** changing the
> server sync schema, the sync RPCs, or `apps/mobile/src/sync/**`.

This doc states invariants and their reasons; the code is the ground truth
for the how (fix the doc when they disagree):
`supabase/migrations/20260525120000_sync_v2_clean_room.sql`, the sync RPC
migrations, `apps/mobile/src/sync/` and
`apps/mobile/scripts/check-sync-schema-drift.ts`.

Authenticated app push and pull require the header `x-boga-sync-protocol: 4`
(see `sync_push`, "Update-required cutoff").

---

# Part A — Server schema

The server is a typed mirror: one `app_public.<entity>` table per client
Drizzle table (`apps/mobile/src/data/schema/`), no projection, no event log,
written only through `sync_push`.

## Ground rules

- **Composite PK `(owner_user_id, id)`, owner first,** so the canonical pull
  query (`where owner_user_id = … order by server_received_at`) leads with the
  PK column.
- **Composite FKs only.** Every cross-entity FK references the parent's
  `(owner_user_id, id)`, so cross-owner references cannot exist.
- **Timestamps are `bigint` epoch ms.** The only `timestamptz` is the
  server-set `server_received_at`, the pull cursor axis.
- **Minimal server validation.** The client is the only writer, so the server
  validates nothing it could not itself cause:
  - No CHECK constraints on enum text, numeric ranges or text content. The one
    exception is `exercise_definitions_load_input_mode_valid`
    (`total_load | per_side_load`): analytics consume that field directly, so
    both stores reject invalid values.
  - Domain columns are nullable wherever the client may write NULL. Only the
    structural columns (PK, `owner_user_id`, `client_updated_at_ms`) are
    NOT NULL.
  - No content-validating triggers, except the M23 provenance trigger
    (`exercise_sets_source_plan_provenance`, see "Per-entity rules"): Sync v2's
    other triggers are the two structural ones (group triggers follow "Out of
    scope").
  - No uniqueness beyond the PK, except the three M23 provenance guards
    (`sessions_owner_source_plan_unique`,
    `session_exercises_owner_source_block_unique`,
    `exercise_sets_owner_source_set_unique`; see "Per-entity rules"). Slot and
    pair uniqueness is otherwise client-enforced (see "Client-enforced
    constraints") with non-unique btree indexes for speed only.
- **Typed columns only.** No `extras jsonb` blob anywhere: schema, wire or
  drift checker.
- **Tombstones keep the full row.** A delete sets `deleted_at` and clears
  nothing else. `deleted_at IS NOT NULL` is the only tombstone marker; there is
  no `deleted` boolean.
- **Future-clock clamp.** `sync_push` stores
  `least(client_updated_at_ms, now_ms + 5 min)`, so a fast-clock client cannot
  write an unbeatable LWW value. The clamp is silent so an NTP glitch is not a
  sync error.

### LWW and undelete

Last-writer-wins on `client_updated_at_ms` is the conflict rule for every
entity, with the row as the unit. For an incoming write `T_in` against stored
`T_db`: `T_in <= T_db` is a row-level no-op (the push still acks it);
`T_in > T_db` overwrites every column in the payload, `deleted_at` included.
Deletion is `deleted_at` going non-null; undelete is the same id with
`deleted_at` back to null, under the same rule. There is no special path.

- **Stale undelete loses.** An undelete stamped earlier than a stored tombstone
  is a no-op, and the next pull tells the device the row is deleted. This is
  the accepted cost of trusting client clocks.
- **Newer undelete restores.** Re-emitting the original id with a fresh
  timestamp and a full payload restores the row losslessly. Reusing the id
  (relink, a future restore UI) is the only undelete path.

### Migration-in-flight contract

Migrations on `app_public.<entity>` tables are additive-only
(`ADD COLUMN`) during normal operation. A destructive change needs a quiesced,
coordinated window: ship a compatibility client first, stop normal sync with
`UPDATE_REQUIRED`, convert the server, then let only new-protocol clients
resume. The protocol-3 kg-only cutover
(`docs/specs/tech/bodyweight-load-contract.md`, section 5) was such a window.

## Universal columns, index and triggers

Every entity table carries these server-only columns, which no client schema
declares:

| Column | Type | Purpose |
| --- | --- | --- |
| `owner_user_id` | `uuid` not null, default `auth.uid()` | Row owner; leads the PK; cascades from `auth.users`. |
| `client_updated_at_ms` | `bigint` not null | The LWW key. |
| `server_received_at` | `timestamptz` not null, default `now()` | Set on every insert/update; the pull cursor axis. |

Every table also has the index `<table>_owner_received_idx` on
`(owner_user_id, server_received_at)` and two structural triggers:
`<table>_touch_server_received_at` (BEFORE UPDATE when the row changed) and
`<table>_owner_user_id_immutable` (see "RLS and owner immutability"). The drift
checker asserts all of them per table.

## Per-entity rules

Column mappings live in the Drizzle schema files and the migrations, and the
drift checker enforces their parity. Only the rules the columns do not show are
listed here:

- **`session_exercise_tags`** has no client `updated_at`; it still carries the
  universal server columns.
- **`user_settings`** is a singleton whose client id is `settings`. The
  singleton is client-enforced; the server is a plain LWW mirror.
- **`exercise_group_links`** is the member's own data, not a group table. Only
  the member's client writes it; server code (the group evaluator included)
  only reads it. Its id must stay `<group_id>:<exercise_definition_id>`: a local
  CHECK enforces that form, so a pulled row that breaks it fails the layer-1
  page apply with `INTERNAL` and pull cannot advance past it. Its sync scope and
  FK-free group columns are owned by `docs/specs/05-data-model.md`.
- **M23 planning** adds `training_programmes`, `session_plans`,
  `session_plan_exercises` and `session_plan_sets`, and three performed-domain
  provenance columns (`sessions.source_plan_id`,
  `session_exercises.source_plan_exercise_id`,
  `exercise_sets.source_plan_set_id`). The columns, wire shapes and lifecycle
  are owned by `docs/specs/tech/session-planning-contract.md`; this doc adds the
  server rules: the three partial-unique guards and a DEFERRABLE constraint
  trigger `exercise_sets_source_plan_provenance` rejecting a source-derived set
  whose `source_plan_set_id` is not under its card's source block.

## Deferrable foreign keys

All eighteen cross-entity FKs (ten pre-M23 plus the eight M23 planning edges)
are `DEFERRABLE INITIALLY DEFERRED`, so the checks run at COMMIT. A push may
write a child before its parent in one transaction, and any unsatisfied FK at
COMMIT rolls back the whole batch. Names, targets and on-delete actions are in
the migrations and are asserted by
`supabase/tests/sync-v2-deferrable-fk.sh` and
`supabase/tests/sync-v2-schema-smoke.sh`.

A child whose parent is neither in the batch nor on the server is a client
batching bug, not a normal event (see "Client-enforced constraints"). The
COMMIT-time failure is a backstop with no retry path.

## RLS and owner immutability

Every entity table has RLS enabled with four permissive owner policies
(`<table>_owner_select|insert|update|delete`, all `owner_user_id = auth.uid()`
for `authenticated`). It also has one restrictive policy,
`<table>_direct_app_only`, that requires the JWT `client_id` to be null. The
restrictive policy keeps OAuth agent tokens out of both the tables and the
sync RPCs (rule 13 of `docs/specs/10-api-authn-authz-guidelines.md`).

The sync RPCs are `security invoker`, so these `authenticated` policies govern
RPC writes and direct access alike. No `service_role` or RPC-owner policy is
needed; `service_role` bypasses RLS and is for ops scripts only.

`owner_user_id` is immutable: a BEFORE UPDATE trigger
(`app_public.enforce_owner_user_id_immutable()`) refuses any change to it and
refuses a NULL `auth.uid()`. It uses `IS DISTINCT FROM`, so NULL cannot slip
through. It is an authorization boundary, not validation, and the only Sync v2 trigger
that inspects row content.

The drift checker hashes each policy body and the trigger function body
against `apps/mobile/scripts/check-sync-schema-drift.fixtures.json`. A
regression such as `owner_user_id = auth.uid()` turning into `true` fails the
backend gate.

## Topological layers

Push batching and pull draining both use the layering in
`apps/mobile/src/sync/topo-order.ts`:

| Layer | Tables |
| --- | --- |
| 0 | `gyms`, `exercise_definitions`, `muscle_groups`, `user_settings`, `training_programmes` |
| 1 | `session_plans`, `exercise_muscle_mappings`, `exercise_tag_definitions`, `exercise_group_links` |
| 2 | `sessions`, `session_plan_exercises` |
| 3 | `session_exercises`, `session_plan_sets` |
| 4 | `exercise_sets`, `session_exercise_tags`, `body_weight_measurements` (an independent root) |

Any order within a layer is safe because no FK joins two tables in one layer
and every FK points to a strictly earlier layer (or is a self-edge). The drift
checker asserts both against the live FK graph, and that every entity sits in
exactly one layer. Adding an entity or FK means updating
`topo-order.ts` and the `sync_pull` layer mapping together. M23 moved
`sessions` L1→L2, `session_exercises` L2→L3 and `exercise_sets` L3→L4; an
upgraded client resets `pull_cursor` and the server gates the new mapping on
protocol 4 (`docs/specs/tech/session-planning-contract.md`).

## Drift checker

`apps/mobile/scripts/check-sync-schema-drift.ts` (`npm run check:sync-drift`,
run by the backend gate with `--strict`) resets the local Postgres, replays the
Drizzle schema into in-memory SQLite, and diffs the live catalogs. Its header
holds the algorithm, flags and exit codes. It guarantees:

- Every client column maps to a typed server column of a compatible type.
- Server columns with no client counterpart warn, and fail under `--strict`.
- The ground rules and universal objects above hold per table.
- The topological layers match the FK graph.

Local-only client columns are exempt through
`apps/mobile/src/data/schema/sync-extras.json`. The rule that a domain column
must land on the server first is owned by `docs/specs/05-data-model.md`
("Client schema drift rule").

---

# Part B — Push/pull RPC protocol

| RPC | Purpose |
| --- | --- |
| `app_public.sync_push` (`POST /rest/v1/rpc/sync_push`) | Upload a batch of dirty rows; LWW upsert in one transaction. |
| `app_public.sync_pull` (`POST /rest/v1/rpc/sync_pull`) | Download one layer's rows newer than its cursor. |

Both RPCs are `security invoker`, so `owner_user_id` comes from `auth.uid()`
and never crosses the wire. There is no snapshot RPC (a snapshot is a pull
with a null cursor), no event log, and no device, sequence or batch ids: the
data is the event. `bigint` values cross the wire as JSON integers (epoch ms
fits below 2^53).

## Wire envelope

Push requests and pull responses carry rows in one shape:

```json
{
  "type": "exercise_sets",
  "id": "01HXYZ...",
  "client_updated_at_ms": 1733000000123,
  "fields": { "session_exercise_id": "01HX...", "order_index": 0, "weight_value": "100", "deleted_at": null }
}
```

- `type` is one of the sixteen entity table names.
- `id` is client-assigned (a ULID, or a slug for seeds) and stable forever.
- `client_updated_at_ms` comes from the clock-monotonicity guard.
- `fields` holds every typed column of the entity, keyed by its snake_case
  server column name, with JSON null for null values. `deleted_at` is an
  ordinary LWW field.

No `owner_user_id`, no `extras` and no top-level `deleted` flag appear.

## Errors

| Token | Cause | Client behaviour |
| --- | --- | --- |
| `AUTH_REQUIRED` | No or expired JWT, or RLS denies the row. | Refresh the token. If that fails, keep dirty bits and surface "Sign in again". |
| `FK_VIOLATION` | A deferred FK failed at COMMIT. Structural bug. | Non-retriable. Log it, keep dirty bits, surface the error; the fix ships in an app update. |
| `UPDATE_REQUIRED` | The server's minimum sync protocol is above this build's. | Keep dirty rows and cursors; show "Update BoGa to continue syncing". Setup offers no retry. |
| `INTERNAL` | Anything else (transport, 5xx, malformed payload). | End the cycle with an error, keep dirty bits, and let the next scheduler tick retry. No backoff. |

`sync_pull` returns `{"error":{"code","message"}}`; `sync_push` raises
SQLSTATE `P0001` with the token as message prefix (any FK failure becomes
`FK_VIOLATION:`). The client matches on the token.

## `sync_push`

**Request:** `{"entities": Entity[]}`, with 1 to 200 entities. Longer dirty
streams go up in sequential batches. `anon` may execute the RPC only so that an
unauthenticated call reaches the function's own `auth.uid()` check and returns
`AUTH_REQUIRED` instead of a PostgREST 42501.

**Atomicity.** Entities may arrive in any order, but the batch must be closed
under FKs: every parent is in the batch or already on the server. The RPC runs
in one transaction with deferred constraints, forces the FK check before it
returns (so it can raise `FK_VIOLATION`), and commits or rolls back the whole
batch.

**`fields`.** Protocol-4 writers send every typed column. Any extra key is
rejected as drift rather than preserved. Local-only columns are never sent.
LWW stays per row; there are no per-field clocks.

**Update-required cutoff.** A normal authenticated call whose
`x-boga-sync-protocol` is missing, old or malformed fails with `P0001`
`UPDATE_REQUIRED: …` before it touches any row. The cutoff is compatibility
enforcement, not authorization; auth and OAuth denial are unchanged. The app
client (`apps/mobile/src/auth/supabase.ts`) and the import CLI send
protocol 4.

**Batch building.** The client takes dirty rows layer by layer up to the cap,
so no child ships without its parent: each FK target of a batched row is in an
earlier layer of the same batch, clean (so on the server), or dirty in a layer
not yet reached, in which case the row is not batched either.

**Ack:** `{"ok": true, "server_received_at": "<ISO-8601>"}`, one per batch
with no per-row outcomes (every row was applied or an LWW no-op).
`server_received_at` is one `now()` per transaction, for observability only.

## `sync_pull`

**Request:** `{"layer": 0..4, "cursor": null | {server_received_at,
owner_user_id, type, id}, "limit": 1..200}`. `limit` defaults to 200. A null
cursor is a snapshot of that layer. The cursor is opaque: send back what the
server returned. Anything else is `INTERNAL`.

**Response:** `{"entities": Entity[], "next_cursor": …, "has_more": bool}`.
`entities` are the layer's rows whose `(server_received_at, owner_user_id,
type, id)` row value is greater than the cursor, in that order, so pages never
repeat or skip a row within a stable snapshot. `next_cursor` is always present
(it echoes the input on an empty page, null on an empty snapshot).

**Known race.** `server_received_at` is stamped before COMMIT, so two
concurrent pushes can commit out of stamp order and a pull between them can
skip the earlier row. It self-heals: the row's next edit moves it past the
cursor.

**Drain and apply.** The cycle drains layers 0 to 4 in order, so when a layer-K
page applies, layers 0 to K-1 are already local and every FK resolves without
deferral. Each page applies in one SQLite transaction with this per-row rule:

- **Row absent:** insert it.
- **Incoming `client_updated_at_ms` > local `local_updated_at_ms`:** overwrite
  every field.
- In both of those cases, set `local_dirty = 0` and `local_updated_at_ms` to
  the incoming value.
- **Otherwise:** no-op, and the dirty bit stays set because the local write is
  newer.

The page transaction holds the connection, so a concurrent local edit resolves
correctly in either order. A per-row FK failure rolls back the page and leaves
the cursor where it was.

**Cursors.** One per layer (`sync_runtime_state.pull_cursor`), each moving
only after its page commits, so an aborted drain resumes where it stopped; push
never moves one. A single cursor could not land parents first; per-table
cursors add nothing, since no FK joins two tables in a layer.

## First sign-in

The first cycle is an ordinary one: null cursors pull everything, dirty rows
push, LWW reconciles; no modal.
`bootstrap_completed_at` is set the first time all five layers drain to
`has_more = false` in one cycle. It gates cold-start UX only; the protocol
never branches on it. The local store must hold only the signed-in account's
rows; the wipe that ensures this is owned by `docs/specs/05-data-model.md`
("Sign-out / account-switch wipe").

## The cycle

`apps/mobile/src/sync/cycle.ts` runs PULL → PUSH → PULL and repeats until a
whole round is quiet: both pull legs wrote nothing and the push leg sent
nothing. Quiet counts rows **applied**, not returned, so an echo of
rows already held is quiet. The first-sign-in seed decision instead counts rows
**received**, so a resumed bootstrap is not mistaken for an empty account.

Guarantees:

- Per-batch commits: an interruption leaves the store consistent, and
  re-running from the same state reaches the same end state.
- Batch N's ack is applied before batch N+1 is built; otherwise N+1 would
  re-send the same rows.
- **There is no round cap and no wall-clock deadline.** Convergence and each
  request's HTTP timeout are the only bounds: a round cap would report a
  non-converging spin as converged, hiding bugs and truncating legitimate
  update streams. A cycle resumes from persisted state, so a long one may span
  scheduler ticks.

## Dirty-bit lifecycle

The two local-only columns are defined in `docs/specs/05-data-model.md`
("Local sync bookkeeping"). `local_dirty = 0` means the server has the row.

| Event | `local_dirty` | `local_updated_at_ms` |
| --- | --- | --- |
| Repository write (create, update, soft delete, cascade) | `1` | `nowMonotonic()` |
| Pull apply, incoming wins | `0` | incoming `client_updated_at_ms` |
| Pull apply, incoming loses | unchanged | unchanged |
| Push ack, row unchanged since send | `0` | unchanged |
| Push ack, row edited since send | stays `1` | unchanged |
| Push error | unchanged | unchanged |

Every repository write sets the dirty bit in the same transaction as the row;
there is no "mark dirty later" path.

**Push-in-flight race.** At send time the cycle records each row's
`local_updated_at_ms`. On the ack it clears `local_dirty` only for rows whose
value is unchanged. A row edited in the meantime stays dirty for the next push.

## Clock-monotonicity guard

`nowMonotonic()` (`apps/mobile/src/data/clock.ts`) returns
`max(Date.now(), last_emitted_ms + 1)` and backs every dirtying write.
`last_emitted_ms` persists on `sync_runtime_state` **in the same transaction as
the row write**. If it were written fire-and-forget, a crash between the two
could let the next launch emit a timestamp the server rejects under LWW. The
counter is device-global and survives every wipe.

## Client-enforced constraints

The server enforces only the PK and the FKs. The invariants below belong to
the client. A duplicate that reaches the server is a client bug the protocol
does not reject.

1. Active `session_exercises` never share `(session_id, order_index)`.
2. Active `exercise_sets` never share `(session_exercise_id, order_index)`.
3. `exercise_muscle_mappings` has no duplicate
   `(exercise_definition_id, muscle_group_id)`.
4. Active `exercise_tag_definitions` has no duplicate
   `(exercise_definition_id, normalized_name)`.
5. `session_exercise_tags` has no duplicate
   `(session_exercise_id, exercise_tag_definition_id)`.
6. No orphan-child push: the topological batch builder guarantees it.
7. `exercise_group_links` has at most one row per
   `(group_id, exercise_definition_id)`, through its deterministic id; relink
   reuses that id.

## Out of scope

- Server-side retention or GC of tombstoned rows; they stay as ordinary rows.
- The group domain (`docs/specs/tech/groups-contract.md`). Group tables are
  server-authoritative, reached only through group RPCs, and have no
  `owner_user_id`, so the drift checker skips them. Group triggers on Sync v2
  tables (session share, stream events, evaluator enqueue) must meet four
  rules:
  - be failure-isolated, so they can never abort `sync_push`;
  - never write a Sync v2 table;
  - never fire on DELETE;
  - leave the wire contract, RLS and the two structural triggers unchanged.
