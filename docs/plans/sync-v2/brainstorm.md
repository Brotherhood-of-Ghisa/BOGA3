# Sync v2 — high-level design (first iteration)

> Status: foundational sketch. Has been superseded in places by discussion outcomes
> recorded in [plan.md](plan.md). Read this for context, read plan.md for the active
> direction.

## Discussion outcomes since this was written

- **Server data shape (revises §3.1):** dropped the opaque-blob model in favour of a
  **typed schema mirroring the client Drizzle schemas**, plus a per-table `extras jsonb`
  column for forward-compatible field additions. FK ordering is solved with
  `DEFERRABLE INITIALLY DEFERRED`. Reasoning: stats / MCP / future groups all want SQL,
  and the v1 pain was the projection function, not the schema awareness.
- **Seed IDs (revises §6):** confirmed **fixed slug IDs** (`seed:bench-press`) over
  UUIDs. The composite PK absorbs cross-user collisions; fixed IDs make device-reinstall
  and merge cases work naturally. Seed loader must be idempotent (insert-if-not-exists
  by ID, runs on every launch so new-version seeds get added).
- **Dirty tracking (new):** every local entity table gets `local_dirty boolean` and
  `local_updated_at_ms bigint`. Replaces v1's outbox/event-log entirely. Current state
  IS the payload.
- **Push/pull cadence (new):** push triggers on debounced mutation (500ms), foreground,
  network online, 30s safety interval; pull triggers on startup, foreground, online,
  60s safety interval. Atomic per-batch server transactions with LWW upsert; idempotent
  retries.

Open questions remaining are now formal design tasks — see [plan.md](plan.md).

## 1. Why we're rebuilding (lessons from v1)

The v1 sync (M13) tried to make the server *understand* the data: per-entity tables,
FK relations, a 1500-line PL/pgSQL `sync_apply_projection_event` function with six
"belongs to a different owner" error branches. That choice cascaded into every problem
we've hit:

- **Shared-ID namespace bug**: stable seed IDs collided across users → "different owner"
  rejections. The in-flight redesign (composite PK `(id, owner_user_id)`, T1–T6 merged,
  T7 hosted reset pending) treats the symptom, not the disease.
- **FK ordering hazards**: `session_exercises → exercise_definitions` required a hotfix
  migration (`20260505213500_relax_session_exercise_definition_fk.sql`) because events
  arrive out of order on the wire.
- **Projection drift**: every new field is a migration on both ends + a projection-
  function edit + a contract update.
- **Bootstrap complexity**: per-entity merge with mixed `deletedAt` support across tables.
- **Sequence/device-id coupling**: persisted singletons across user switch on same device.

Diagnosis: **the server was solving problems it didn't need to solve for purpose #1
(device recovery).** Schema awareness is only required for purposes #3 (web stats),
#4 (MCP), #5 (groups) — all explicitly low-priority or future.

## 2. The new model in one paragraph

The server is an **opaque blob store** keyed by `(owner_user_id, entity_type, id)`. The
client is the only thing that knows what an Exercise or Session looks like. Writes are
full-entity blobs with a client-assigned `updated_at_ms`. The server stores, indexes by
owner+type, and hands them back on request. There is no projection, no FK, no per-field
validation. When we eventually need server-side querying (stats, MCP, groups), we add a
one-way projection job — but the blob is always the source of truth.

> Open question being deep-dived: whether to keep blobs or replicate the typed schema
> on the server. See section 11 / follow-up discussion.

## 3. Data model

### 3.1 Server (one table replaces all eight)

```
app_public.user_entities (
  owner_user_id   uuid         not null,
  entity_type     text         not null,        -- 'exercise_definition', 'session', etc.
  id              text         not null,        -- client-assigned (uuid or seed slug)
  payload         jsonb        not null,        -- the full client-side row, serialized
  client_updated_at_ms  bigint not null,        -- per-device clock, used for LWW
  deleted         boolean      not null default false,
  server_received_at timestamptz not null default now(),
  primary key (owner_user_id, entity_type, id)
)
-- index for snapshot pull: (owner_user_id, server_received_at)
-- RLS: row.owner_user_id = auth.uid()
```

No per-entity tables. No projection function. No "different owner" branches. No FKs
between entities.

**Tombstones**: deleted entity stays with `deleted = true` and latest payload (useful
for groups/audit later). Hard purge is a future maintenance job.

### 3.2 Client

Local SQLite tables stay as they are — Drizzle schemas, repos, queries. The blob is
only the wire/at-rest server format. One serialize/deserialize per entity per sync
direction.

## 4. The sync protocol

Three operations.

### 4.1 `push` (client → server)

```
POST /sync/push
{ entities: [{ type, id, payload, client_updated_at_ms, deleted }, ...] }
```

Server upserts each row with LWW by `client_updated_at_ms`. If incoming
`updated_at_ms <=` stored value, the upsert is a no-op. No event log, no sequence
numbers, no apply order — the data IS the event.

### 4.2 `pull` (incremental)

```
POST /sync/pull
{ since: <server_received_at_cursor>, limit: 500 }
→ { entities: [...], next_cursor, has_more }
```

Cursor is server-time, not client-time. Client persists the cursor.

### 4.3 `snapshot`

Same as `pull` with `since = 0`. The "give me everything" path.

No envelopes. No sequence counters. No device-ingest-state table.

## 5. The three conflict cases

| Scenario | Mechanism |
|---|---|
| Has local edits **+** remote data, on login | Modal: **"Keep local and merge with cloud"** vs **"Replace local with cloud."** |
| No local edits, remote data | Auto-snapshot, no prompt. |
| Two devices in use | LWW by `client_updated_at_ms`. Simultaneous edits can lose one side — accepted trade for low-pri #2. |

Decision logic lives entirely on the client. The server has no opinion.

## 6. Seeds

Seeds ship with the app and are written into the local DB on first launch with stable
slug IDs (`seed:bench-press`, etc.). They are immediately user-owned from the moment
they exist — there is no "system catalog" concept anywhere. On first push after login
they go to the server as ordinary blobs scoped to that user.

Seed-version drift (P5 in current fix-sync follow-ups) is handled by a local seed-
version pointer; the resulting writes flow through normal sync.

> Open question being deep-dived: whether fixed seed IDs are right or whether seeds
> should get UUIDs at install time. See follow-up discussion.

## 7. Wipe affordances

Two buttons behind a dev/settings gate:

- **Wipe local** — `DELETE FROM <every local table>`; reset cursor; next sync re-
  snapshots from server.
- **Wipe remote (for me)** — RPC: `DELETE FROM user_entities WHERE owner_user_id =
  auth.uid()`. RLS guarantees scope.

First-class part of v2, not a hack.

## 8. What we delete from v1

If we commit to this:

- `sync_apply_projection_event` (~1500 lines of PL/pgSQL)
- `sync_events_ingest_impl`, `sync_events_ingest`
- All eight per-entity tables on the server (and the in-flight
  `user_scoped_pk_redesign` migration — never deployed to hosted)
- `sync_device_ingest_state`, `sync_ingested_events`
- Outbox event types, sequence counters, batch envelopes
- Most of `apps/mobile/src/sync/engine.ts`, `outbox.ts`, per-entity enqueue calls
  scattered across domain layers
- `originScopeId`, `originSourceId`, `system catalog` naming
- `session-sync-api-contract.md` shrinks to ~50 lines

Keep:
- `bootstrap.ts` decision flow (adapted to new protocol)
- Local Drizzle schemas
- Auth-gated transport, online/offline detection, scheduler cadence
- Seed loader

## 9. Open trades (pre-executable)

1. **Push granularity**: per-row blobs vs per-aggregate (Session + Exercises + Sets in
   one blob). My take: per-row.
2. **Conflict UI on login**: always when local has data, or only when both sides have
   data? My take: only when both have data.
3. **What counts as "local edits"**: track a single "dirty since last successful push"
   bit per row.
4. **Clock skew on LWW**: trust client clocks for v2, revisit if purpose #2 (two-device)
   becomes important.
5. **Migration off v1**: clean cut, no carry-over. Drop v1 tables in same migration.
   Anyone who synced under v1 re-snapshots from v2 (empty), effectively "replace remote
   with local".
6. **Where v2 lives**: build alongside as `sync2/`, swap call sites once green.

## 10. Mapped to your purposes

| Purpose | How v2 serves it |
|---|---|
| #1 Device recovery (critical, now) | Snapshot pull on login. |
| #2 Two devices (low) | Pull cadence + LWW. |
| #3 Web stats (low) | Build a server-side projection job later: blob → typed tables. |
| #4 MCP access (low) | Projection job feeds MCP, or JSONB queries directly. |
| #5 Groups (future) | Add `groups`, `group_memberships` tables and `shared_to_groups text[]` on `user_entities`. Aggregator reads across owners. |

## 11. Next deep dives (in flight)

1. Replicated-schema-on-server vs opaque-blob trade — does typed mirroring buy enough
   to justify the complexity?
2. Seed ID strategy — fixed slugs vs UUIDs at install.
3. Push/pull cadence and reliability — what does "frequent and reliable" actually mean
   in triggers, retries, batch RPCs.

(Captured separately as we discuss; will fold conclusions back into this doc.)
