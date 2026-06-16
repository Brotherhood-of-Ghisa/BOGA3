# Sync v2 Server Contract

> **Promoted from the sync-v2 plan; this is the authoritative sync-v2 server
> contract.** It merges the two former design docs (`t1` — server schema &
> drift control; `t2` — push/pull RPC protocol) into one normative reference
> and has been verified against the as-built code: the clean-room migration
> (`supabase/migrations/20260525120000_sync_v2_clean_room.sql`), the push/pull
> RPCs (`20260525130000_sync_v2_push_rpc.sql`,
> `20260525130100_sync_v2_pull_rpc.sql`), the drift checker
> (`apps/mobile/scripts/check-sync-schema-drift.ts`), and the `supabase/tests/`
> contract suites.
>
> The document is in two parts. Both former docs numbered their sections
> "§1, §2, …"; on merge they are disambiguated to **A.x** (server schema) and
> **B.x** (push/pull protocol). Cross-references inside the text use those
> anchors. Where a normative claim differs from the as-built code, the code is
> ground truth and the discrepancy is called out in a **Build note**.

**Contents — this doc is ~1,200 lines; load the part your task needs, not all
of it.**

- **Part A — Server schema**: A.1 ground rules · A.2 per-entity mapping ·
  A.3 local schema additions · A.5 deferrable FKs · A.6 RLS policies ·
  A.7 drift-detection mechanism · A.8 agent-reminder mechanism · A.9 worked
  example (adding a column).
- **Part B — Push/pull RPC protocol**: B.2 wire types · B.3 `sync_push` ·
  B.4 `sync_pull` · B.5 first sign-in · B.6 the cycle interface · B.7 dirty-bit
  lifecycle · B.8 clock-monotonicity guard · B.9 local-only bookkeeping
  columns · B.10 client-enforced constraints · B.11 out of scope.

---

# Part A — Server schema

The server is a typed mirror of the nine client entity tables. One
`app_public.<entity>` table per client Drizzle table; no projection function,
no event log, no per-row dispatch. Every write reaches the tables through the
push RPC (Part B); the server is otherwise not a write source.

## A.1 Ground rules

These invariants hold for every table below.

- **Server schema mirrors client.** One `app_public.<entity>` table per client
  Drizzle table for the nine user-owned entities.
- **Composite PK `(owner_user_id, id)`** on every table. Column order is
  owner-first so the canonical pull query (`where owner_user_id = … order by
  server_received_at`) leads with the PK column.
- **Composite FKs only.** Every cross-entity FK references the parent's
  composite PK `(owner_user_id, <parent_id>)`. No cross-owner references exist
  by construction.
- **All FKs are `DEFERRABLE INITIALLY DEFERRED`** (see A.5). Push transactions
  can write a child before its parent; constraints are checked at COMMIT.
- **Timestamps are `bigint` (epoch ms), not `timestamptz`.** The only
  `timestamptz` on these tables is `server_received_at` (server-set, the pull
  cursor axis — see B.4).
- **No `origin_scope_id` / `origin_source_id`.** Every row is per-user.
- **No server-side validation.** The client is the only writer; the server
  validates nothing it cannot also be the cause of. Concretely:
    - **No CHECK constraints** on enum text (`sessions.status`,
      `exercise_sets.set_type`, `exercise_muscle_mappings.role`), numeric ranges
      (`order_index >= 0`, `weight > 0`, …), or text content.
    - **No NOT NULL beyond the wire envelope.** Domain columns are nullable when
      the client may legitimately write NULL. Structural columns
      (`owner_user_id`, `client_updated_at_ms`, the PK columns) stay NOT NULL.
    - **No content-validating triggers.** The only triggers are structural: the
      `server_received_at` touch on UPDATE, and the `owner_user_id` immutability
      guard (A.6.3).
  What the server *does* enforce is structural, not validation: PK uniqueness,
  the nine composite FKs (A.5), and the RLS policies (A.6).
  **No other uniqueness constraints.** The `(session_id, order_index)` /
  `(session_exercise_id, order_index)` slot uniqueness and the join-table pair
  uniqueness are **not** enforced as UNIQUE — they exist as **non-unique btree
  indexes** for query performance only. The invariants are client-enforced
  (Part B; see B.10).
- **RLS:** `owner_user_id = auth.uid()` for select/insert/update/delete,
  identical shape per table (A.6).
- **Typed columns only — no `extras jsonb`.** Every entity column lands as a
  typed server column. There is no `extras` blob anywhere (schema, wire,
  drift checker).
- **Tombstones preserve the full row; undelete is lossless.** A delete sets
  `deleted_at = Date.now()` but clears nothing else. There is **no separate
  `deleted boolean` column** — `deleted_at IS NOT NULL` is the only tombstone
  marker, present on every entity table including the join tables. See A.1.1.
- **Hard cut from v1.** The clean-room migration drops every v1 server object
  (the M13/M14 projection family, `sync_events_ingest`(+`_impl`),
  `sync_apply_projection_event`, the device/ingested-events tables, the eight
  legacy entity tables, the in-flight user-scoped-PK shape) and recreates the
  v2 shape clean. The hosted DB is wiped post-merge; there is no rollback path.
- **Future-clock clamp.** The push RPC clamps incoming `client_updated_at_ms`
  to `min(incoming, now_ms() + 5 * 60 * 1000)` — silently storing the clamped
  value for timestamps more than five minutes in the future. This stops a
  fast-clock client from writing an unbeatable LWW value. Clamping is silent so
  a transient NTP glitch does not surface as a sync error.
- **Migration-in-flight contract.** Schema migrations against
  `app_public.<entity>` tables are **additive-only during normal operation**
  (`ALTER TABLE … ADD COLUMN …`). Destructive operations need a quiesced deploy
  window (out of scope for v2 ship). The hard-cut migration runs against a wiped
  DB, so additive-only does not apply to it.

> **Build note (verified).** A.1's schema rules are confirmed against the
> clean-room migration: composite PKs, `bigint` timestamps, `deleted_at bigint`
> on all nine tables, zero CHECK constraints, no `extras` column, no `deleted`
> boolean, and the non-unique form of every slot/pair index. The drift checker
> independently asserts no-CHECK, no-`extras`, no-`deleted` (see A.7).

### A.1.1 LWW and undelete semantics

LWW (last-writer-wins) is the conflict-resolution rule for every entity column,
keyed on `client_updated_at_ms`. It applies uniformly to live writes, deletes,
and undeletes — there is no special-case path. **Deletion is `deleted_at` going
non-null; undeletion is `deleted_at` going back to null.**

#### A.1.1.1 The rule

For an incoming write to `(owner_user_id, id)` with
`client_updated_at_ms = T_in` against a stored row with
`client_updated_at_ms = T_db`:

- If `T_in <= T_db`: the write is a **no-op** at the row level. (The push RPC
  may still ack the row to clear the client's dirty bit; no columns change.)
- If `T_in > T_db`: every column in the payload is written verbatim, including
  `deleted_at`. There is no per-column comparison; the unit of LWW is the row.

A consequence: `deleted_at` can flip from a timestamp back to `null` purely by
LWW. That is undelete.

#### A.1.1.2 The two undelete scenarios

**Scenario A — server has a newer tombstone, client locally undeletes (older).**
Device 1 deletes row X at T=100 (server: `deleted_at=100, T_db=100`); Device 2,
offline with a stale clock, undeletes at T=90 and pushes. `T_in=90 < T_db=100`,
so the write is a no-op; the server keeps the tombstone and the next pull tells
Device 2 the row is deleted. **The undelete loses.** Acknowledged v2
trade-off of trusting client clocks.

**Scenario B — client has a newer undelete, server has an older tombstone.**
Device 1 deletes row X at T=100 (`deleted_at=100, T_db=100`); a later write at
T=200 sets `deleted_at=null` with a full payload and pushes. `T_in=200 >
T_db=100`, so every column overwrites the stored row including
`deleted_at=null`. **The row is fully restored — undelete by LWW.**

#### A.1.1.3 Reuse of `id` is the only practical undelete path

Scenario B occurs via a future "restore from history" UI re-emitting the
original id with a fresh `client_updated_at_ms`, a narrow-window id-reuse bug,
or a test fixture. All converge on the same wire shape and LWW resolution; no
special API is needed.

## A.2 Per-entity mapping

Notation: "Server type" is the Postgres type; "Null" `NO`=not null, `YES`=
nullable; "Indexed" names a standalone btree index; "FK" gives the composite FK
target. All FKs are `DEFERRABLE INITIALLY DEFERRED`.

Every entity table additionally carries these **identical** server columns
(not present in any client schema):

| Server column | Type | Null | Default | Purpose |
| --- | --- | --- | --- | --- |
| `owner_user_id` | `uuid` | NO | `auth.uid()` | Row owner; part of PK; `references auth.users(id) on delete cascade`. |
| `client_updated_at_ms` | `bigint` | NO | — | Client wall-clock at write; the LWW key. No CHECK. |
| `server_received_at` | `timestamptz` | NO | `now()` | Server-set on every insert/update; the pull cursor's monotonic axis. |

Every table also gets the **identical** index
`<table>_owner_received_idx` on `(owner_user_id, server_received_at)` and the
**identical** triggers `<table>_touch_server_received_at` (BEFORE UPDATE,
`WHEN (NEW IS DISTINCT FROM OLD)`, sets `server_received_at = now()`) and
`<table>_owner_user_id_immutable` (A.6.3). These are not repeated per entity
below.

> **Build note (verified).** All three universal columns, the
> `<table>_owner_received_idx` index, and both triggers exist on all nine
> tables in the clean-room migration; the drift checker asserts the index and
> both triggers per entity.

### A.2.1 `gyms`

Source: `apps/mobile/src/data/schema/gyms.ts`.

| Client column | Server column | Server type | Null | Indexed | FK |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | part of PK |
| `name` | `name` | `text` | NO | yes (`gyms_name_idx`) | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | yes (`gyms_deleted_at_idx`) | — |
| `latitude` | `latitude` | `double precision` | YES | — | — |
| `longitude` | `longitude` | `double precision` | YES | — | — |
| `coordinateAccuracyM` | `coordinate_accuracy_m` | `double precision` | YES | — | — |
| `coordinatesUpdatedAt` | `coordinates_updated_at` | `bigint` | YES | — | — |

PK `(owner_user_id, id)`. No CHECK constraints.

> **Build note (verified).** The four M15 carry-over coordinate columns
> (`latitude`, `longitude`, `coordinate_accuracy_m`, `coordinates_updated_at`)
> are present on the as-built `app_public.gyms` table because the client schema
> carries them. The push RPC writes them and the pull RPC projects them — the
> round-trip is symmetric. Any `gyms`-touching wire logic must include all four.

### A.2.2 `sessions`

Source: `apps/mobile/src/data/schema/sessions.ts`.

| Client column | Server column | Server type | Null | Default | Indexed | FK |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | — | part of PK |
| `gymId` | `gym_id` | `text` | YES | — | yes (`sessions_gym_id_idx`) | `(owner_user_id, gym_id) → gyms(owner_user_id, id)` `on delete set null` deferred |
| `status` | `status` | `text` | NO | `'active'` | yes (`sessions_status_idx`) | — |
| `startedAt` | `started_at` | `bigint` | NO | — | — | — |
| `completedAt` | `completed_at` | `bigint` | YES | — | yes (`sessions_completed_at_idx`) | — |
| `durationSec` | `duration_sec` | `integer` | YES | — | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | — | yes (`sessions_deleted_at_idx`) | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — | — |

PK `(owner_user_id, id)`. No CHECK constraints — the legacy
`('draft','active','completed')` CHECK on `status` is dropped.

### A.2.3 `session_exercises`

Source: `apps/mobile/src/data/schema/session-exercises.ts`.

| Client column | Server column | Server type | Null | Indexed | FK |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | part of PK |
| `sessionId` | `session_id` | `text` | NO | yes (`session_exercises_session_id_idx`) | `(owner_user_id, session_id) → sessions(owner_user_id, id)` `on delete cascade` deferred |
| `exerciseDefinitionId` | `exercise_definition_id` | `text` | YES | yes (`session_exercises_exercise_definition_id_idx`) | `(owner_user_id, exercise_definition_id) → exercise_definitions(owner_user_id, id)` `on delete no action` deferred |
| `orderIndex` | `order_index` | `integer` | NO | — | — |
| `name` | `name` | `text` | NO | — | — |
| `machineName` | `machine_name` | `text` | YES | — | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | yes (`session_exercises_deleted_at_idx`) | — |

PK `(owner_user_id, id)`. No CHECK constraints.
**Non-unique** partial btree index
`session_exercises_session_order_active_idx` on
`(owner_user_id, session_id, order_index) WHERE deleted_at IS NULL` —
performance only; slot uniqueness is client-enforced (B.10 #1).

### A.2.4 `exercise_sets`

Source: `apps/mobile/src/data/schema/exercise-sets.ts`.

| Client column | Server column | Server type | Null | Default | Indexed | FK |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | — | part of PK |
| `sessionExerciseId` | `session_exercise_id` | `text` | NO | — | yes (`exercise_sets_session_exercise_id_idx`) | `(owner_user_id, session_exercise_id) → session_exercises(owner_user_id, id)` `on delete cascade` deferred |
| `orderIndex` | `order_index` | `integer` | NO | — | — | — |
| `weightValue` | `weight_value` | `text` | NO | `''` | — | — |
| `repsValue` | `reps_value` | `text` | NO | `''` | — | — |
| `setType` | `set_type` | `text` | YES | — | — | — |
| `plannedWeightValue` | `planned_weight_value` | `text` | YES | — | — | — |
| `plannedRepsValue` | `planned_reps_value` | `text` | YES | — | — | — |
| `plannedSetType` | `planned_set_type` | `text` | YES | — | — | — |
| `performanceStatus` | `performance_status` | `text` | YES | — | — | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | — | yes (`exercise_sets_deleted_at_idx`) | — |

PK `(owner_user_id, id)`. No CHECK constraints (including `set_type`).
**Non-unique** partial index `exercise_sets_session_exercise_order_active_idx`
on `(owner_user_id, session_exercise_id, order_index) WHERE deleted_at IS NULL`
— performance only; slot uniqueness is client-enforced (B.10 #2).

### A.2.5 `exercise_definitions`

Source: `apps/mobile/src/data/schema/exercise-definitions.ts`.

| Client column | Server column | Server type | Null | Indexed | FK |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | part of PK |
| `name` | `name` | `text` | NO | yes (`exercise_definitions_name_idx`) | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | yes (`exercise_definitions_deleted_at_idx`) | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — |

PK `(owner_user_id, id)`. No CHECK constraints. `id` may be a slug
(`seed:bench-press`) or a hex token; the server treats it as opaque text.

### A.2.6 `exercise_muscle_mappings`

Source: `apps/mobile/src/data/schema/exercise-muscle-mappings.ts`.

| Client column | Server column | Server type | Null | Indexed | FK |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | part of PK |
| `exerciseDefinitionId` | `exercise_definition_id` | `text` | NO | yes (`exercise_muscle_mappings_exercise_definition_id_idx`) | `(owner_user_id, exercise_definition_id) → exercise_definitions(owner_user_id, id)` `on delete cascade` deferred |
| `muscleGroupId` | `muscle_group_id` | `text` | NO | yes (`exercise_muscle_mappings_muscle_group_id_idx`) | `(owner_user_id, muscle_group_id) → muscle_groups(owner_user_id, id)` `on delete cascade` deferred (A.2.9) |
| `weight` | `weight` | `double precision` | NO | — | — |
| `role` | `role` | `text` | YES | — | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | yes (`exercise_muscle_mappings_deleted_at_idx`) | — |

PK `(owner_user_id, id)`. No CHECK constraints (including `role`, `weight`).
**Non-unique** btree index `exercise_muscle_mappings_exercise_muscle_idx` on
`(owner_user_id, exercise_definition_id, muscle_group_id)` — pair uniqueness is
client-enforced (B.10 #3). `deleted_at` present so the LWW upsert path is
uniform; local readers filter `WHERE deleted_at IS NULL`.

#### A.2.6.1 `muscle_group_id` is a synced-parent FK

`muscle_groups` is one of the nine user-owned synced entities (A.2.9), seeded as
a starter catalog and then synced per-user like `exercise_definitions`. So
`muscle_group_id` is **not** opaque text: it is a real composite FK into
`app_public.muscle_groups(owner_user_id, id)` (constraint
`exercise_muscle_mappings_muscle_group_fk`, `on delete cascade`, deferred —
listed in A.5.2). Because the parent is Layer 0 and the mapping is Layer 1, a
bootstrap/restore pulls the muscle group before the mapping, so the FK holds
under enforcement. There is no `untyped_text_references` exemption in
`sync-extras.json` for this column anymore — the drift checker enforces the
typed-column and FK rule on it like any other.

### A.2.7 `exercise_tag_definitions`

Source: `apps/mobile/src/data/schema/exercise-tag-definitions.ts`.

| Client column | Server column | Server type | Null | Indexed | FK |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | part of PK |
| `exerciseDefinitionId` | `exercise_definition_id` | `text` | NO | yes (`exercise_tag_definitions_exercise_definition_id_idx`) | `(owner_user_id, exercise_definition_id) → exercise_definitions(owner_user_id, id)` `on delete cascade` deferred |
| `name` | `name` | `text` | NO | — | — |
| `normalizedName` | `normalized_name` | `text` | NO | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | yes (`exercise_tag_definitions_deleted_at_idx`) | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — |

PK `(owner_user_id, id)`. No CHECK constraints. **Non-unique** partial index
`exercise_tag_definitions_exercise_normalized_active_idx` on
`(owner_user_id, exercise_definition_id, normalized_name) WHERE deleted_at IS
NULL` — normalized-name uniqueness is client-enforced (B.10 #4).

### A.2.8 `session_exercise_tags`

Source: `apps/mobile/src/data/schema/session-exercise-tags.ts`.

| Client column | Server column | Server type | Null | Indexed | FK |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | part of PK |
| `sessionExerciseId` | `session_exercise_id` | `text` | NO | yes (`session_exercise_tags_session_exercise_id_idx`) | `(owner_user_id, session_exercise_id) → session_exercises(owner_user_id, id)` `on delete cascade` deferred |
| `exerciseTagDefinitionId` | `exercise_tag_definition_id` | `text` | NO | yes (`session_exercise_tags_exercise_tag_definition_id_idx`) | `(owner_user_id, exercise_tag_definition_id) → exercise_tag_definitions(owner_user_id, id)` `on delete cascade` deferred |
| `createdAt` | `created_at` | `bigint` | NO | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | yes (`session_exercise_tags_deleted_at_idx`) | — |

PK `(owner_user_id, id)`. No CHECK constraints. **Non-unique** btree index
`session_exercise_tags_pair_idx` on
`(owner_user_id, session_exercise_id, exercise_tag_definition_id)` — pair
uniqueness is client-enforced (B.10 #5). This is the one entity with no client
`updated_at`; on the server it still carries the universal
`client_updated_at_ms` / `server_received_at` envelope columns.

### A.2.9 `muscle_groups`

Source: `apps/mobile/src/data/schema/muscle-groups.ts`. A per-user synced
taxonomy modeled on `exercise_definitions` (A.2.5): system-seeded as a starter
catalog, then synced per-user. It is a **Layer 0** entity (no FK dependencies)
and the FK parent of `exercise_muscle_mappings.muscle_group_id` (A.2.6, A.5.2).

| Client column | Server column | Server type | Null | Indexed | FK |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | `text` | NO | — | part of PK |
| `displayName` | `display_name` | `text` | NO | yes (`muscle_groups_display_name_idx`) | — |
| `familyName` | `family_name` | `text` | NO | yes (`muscle_groups_family_name_idx`) | — |
| `sortOrder` | `sort_order` | `integer` | NO | yes (`muscle_groups_sort_order_idx`) | — |
| `isEditable` | `is_editable` | `integer` | NO | — | — |
| `createdAt` | `created_at` | `bigint` | NO | — | — |
| `updatedAt` | `updated_at` | `bigint` | NO | — | — |
| `deletedAt` | `deleted_at` | `bigint` | YES | yes (`muscle_groups_deleted_at_idx`) | — |

PK `(owner_user_id, id)`. **Zero CHECK constraints** on the server (the
no-server-validation rule, A.1): the client-side `sort_order >= 0` and
`is_editable in (0,1)` guards stay client-only. The client seeds stable ids
(e.g. `chest_sternal`); the server treats `id` as opaque text. The two
client-only bookkeeping columns (`local_dirty`, `local_updated_at_ms`) never
cross the wire (A.3).

## A.3 Local schema additions (mechanism)

Sync v2 adds local-only sync-bookkeeping columns to the nine client tables.
They are set/cleared by the sync engine and **never travel on the wire**. The
canonical names and types are owned by Part B (B.9): `local_dirty` and
`local_updated_at_ms` on each entity table, plus singleton state on
`sync_runtime_state`. The schema-side mechanism is:

1. Local-only columns are registered in
   `apps/mobile/src/data/schema/sync-extras.json` under
   `exemptions.local_only_columns`.
2. The drift checker (A.7) skips any client column listed there.
3. The push serialiser (B.3) omits any local-only column from the wire.

**Server-first deploy is unconditional for every schema addition.** Every new
entity column lands on the server (a deployed migration) *before* the client.
A client that ships a typed column ahead of its server counterpart fails the
drift check at PR time. See A.9 for the worked example.

`sync-extras.json` shape:

```jsonc
{
  "exemptions": {
    "local_only_columns": ["local_dirty", "local_updated_at_ms"]
  }
}
```

> **Build note (verified).** The as-built `sync-extras.json` matches: only the
> two `local_only_columns` remain. There is no `untyped_text_references` entry —
> the former `muscleGroupId` waiver was removed when `muscle_groups` became a
> typed synced entity (A.2.9) and `muscle_group_id` gained its real FK (A.5.2),
> so the checker now enforces the typed-column and FK rule on that column like
> any other. The drift checker still tolerates an optional `server_only_columns`
> exemption list (none currently used).

### A.3.1 `deleted_at` columns

All nine tables carry `deleted_at` (`bigint`, nullable) plus a
`<table>_deleted_at_idx` index. The tables that previously lacked it on the
client (`gyms`, `session_exercises`, `exercise_sets`,
`exercise_muscle_mappings`, `session_exercise_tags`) gained it in the v2 build
wave; `sessions`, `exercise_definitions`, `exercise_tag_definitions` already
had it; `muscle_groups` gained it when it became a synced entity (A.2.9).

## A.5 Deferrable foreign keys

### A.5.1 What `INITIALLY DEFERRED` means

With `DEFERRABLE INITIALLY DEFERRED`, FK checks are postponed to COMMIT. Inside
one transaction a child may be inserted before its parent, or
`session_id`/`sessions.id` updated in either order, without an intermediate
violation. At COMMIT all FKs are re-checked; any unsatisfied constraint rolls
back the entire transaction. From the client's view the push RPC is atomic per
batch.

### A.5.2 The nine deferrable FKs

| Constraint | From | To | On delete |
| --- | --- | --- | --- |
| `sessions_gym_fk` | `sessions(owner_user_id, gym_id)` | `gyms(owner_user_id, id)` | `set null` |
| `session_exercises_session_fk` | `session_exercises(owner_user_id, session_id)` | `sessions(owner_user_id, id)` | `cascade` |
| `session_exercises_exercise_definition_fk` | `session_exercises(owner_user_id, exercise_definition_id)` | `exercise_definitions(owner_user_id, id)` | `no action` |
| `exercise_sets_session_exercise_fk` | `exercise_sets(owner_user_id, session_exercise_id)` | `session_exercises(owner_user_id, id)` | `cascade` |
| `exercise_muscle_mappings_exercise_definition_fk` | `exercise_muscle_mappings(owner_user_id, exercise_definition_id)` | `exercise_definitions(owner_user_id, id)` | `cascade` |
| `exercise_muscle_mappings_muscle_group_fk` | `exercise_muscle_mappings(owner_user_id, muscle_group_id)` | `muscle_groups(owner_user_id, id)` | `cascade` |
| `exercise_tag_definitions_exercise_definition_fk` | `exercise_tag_definitions(owner_user_id, exercise_definition_id)` | `exercise_definitions(owner_user_id, id)` | `cascade` |
| `session_exercise_tags_session_exercise_fk` | `session_exercise_tags(owner_user_id, session_exercise_id)` | `session_exercises(owner_user_id, id)` | `cascade` |
| `session_exercise_tags_exercise_tag_definition_fk` | `session_exercise_tags(owner_user_id, exercise_tag_definition_id)` | `exercise_tag_definitions(owner_user_id, id)` | `cascade` |

All nine declared `DEFERRABLE INITIALLY DEFERRED`. Migration template:

```sql
constraint <name>
  foreign key (owner_user_id, <child_col>)
  references app_public.<parent>(owner_user_id, id)
  on delete <action>
  deferrable initially deferred
```

> **Build note (verified).** All nine FK names, targets, on-delete actions,
> and the `DEFERRABLE INITIALLY DEFERRED` flag match the clean-room migration.
> `supabase/tests/sync-v2-deferrable-fk.sh` asserts each is
> `is_deferrable='YES' / initially_deferred='YES'` and that a
> child-before-parent transaction commits;
> `supabase/tests/sync-v2-schema-smoke.sh` asserts the on-delete `confdeltype`
> for each (`n`/`c`/`a`).

### A.5.3 Child arriving with no parent

If a child's parent is in the same batch, deferral covers it (COMMIT finds the
parent). If the parent is **neither in the batch nor already on the server**,
COMMIT fails and the push RPC rolls back with an error. This is a **Part B
batching-invariant violation, not a normal occurrence** — B's batching must
guarantee every dirty child ships with its dirty ancestors (B.10 #6). The
COMMIT-time failure is a defense-in-depth backstop only; there is no retry path.

## A.6 RLS policies

### A.6.1 Universal shape

Identical for all nine tables (substitute `<table>`):

```sql
alter table app_public.<table> enable row level security;

create policy <table>_owner_select on app_public.<table>
  for select to authenticated using (owner_user_id = auth.uid());
create policy <table>_owner_insert on app_public.<table>
  for insert to authenticated with check (owner_user_id = auth.uid());
create policy <table>_owner_update on app_public.<table>
  for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy <table>_owner_delete on app_public.<table>
  for delete to authenticated using (owner_user_id = auth.uid());
```

### A.6.2 Why no service-role policies

The push/pull RPCs are `security invoker` (see Build note below), so the
`authenticated` policies apply to RPC writes and to direct client access alike.
`service_role` grants exist for ops scripts only; RLS is bypassed for
`service_role` by Postgres convention.

> **Build note — DRIFT (doc-said-X → code-is-Y).** The former t1 §6.2 / t2 §1
> described the push/pull RPCs as `security definer`. The as-built
> `app_public.sync_push` and `app_public.sync_pull` are both
> **`security invoker`** — RLS evaluates as the calling `authenticated` user,
> which is why the universal `authenticated` policies are sufficient and no
> `service_role`/RPC-owner policy is needed. This text has been updated to match
> the code. The drift checker asserts RLS is enabled with the four owner
> policies, and SHA-256 hashes each policy's `qual`/`with_check` against a
> checked-in fixture so an `owner_user_id = auth.uid()` → `true` regression
> fails CI.

### A.6.3 Immutability of `owner_user_id`

A `BEFORE UPDATE` trigger on every table guards `owner_user_id` against silent
re-homing. The body is NULL-safe and refuses NULL `auth.uid()`:

```sql
CREATE OR REPLACE FUNCTION app_public.enforce_owner_user_id_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is NULL; owner_user_id check cannot proceed';
  END IF;
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'owner_user_id is immutable';
  END IF;
  RETURN NEW;
END $$;
```

`IS DISTINCT FROM` (not `<>`) plus the explicit `auth.uid() IS NULL` guard
closes the three-valued-logic bypass that `<>` left open. Trigger name
convention: `<table>_owner_user_id_immutable`. This is the only trigger that
touches row content; it is an authorisation boundary, not validation.

> **Build note (verified).** The as-built function body matches verbatim. The
> drift checker reads `pg_proc.prosrc`, normalises and SHA-256-hashes it, and
> asserts it against `check-sync-schema-drift.fixtures.json`.

## A.7 Drift-detection mechanism

### A.7.1 Choice

**DB-to-DB introspection on both sides.** The checker spins up the local
Supabase Postgres (server side) and an in-memory SQLite materialised from the
Drizzle schema (client side), introspects live catalogs
(`information_schema`/`pg_catalog`/`pg_policies`/`pg_proc`/`pg_trigger` on
Postgres; `pragma table_info`/`index_list`/`foreign_key_list` on SQLite), and
diffs. Drizzle's `getTableConfig` metadata is a tie-breaker only (A.7.6).

- **Server side:** `supabase db reset --local` applies every migration from
  scratch — what ends up in `information_schema` is what production gets.
- **Client side:** `drizzle-kit export` emits the schema DDL, replayed into a
  fresh `better-sqlite3` `:memory:` database.

Location: `apps/mobile/scripts/check-sync-schema-drift.ts`. Command:
`npm run check:sync-drift`. Wired into `quality-slow.sh backend`.

### A.7.3 Algorithm (summary)

1. Reset the local Postgres (apply all migrations) unless `--skip-reset`.
2. `drizzle-kit export` → in-memory SQLite; introspect via PRAGMAs.
3. Derive `ENTITY_TABLES` = every `app_public` table with an `owner_user_id`
   column (do **not** hardcode the count — there are nine today — A.7.7).
4. Per entity: walk client→server (every client column must map to a typed
   server column of compatible type, unless `local_only` or
   `untyped_text_references`), and server→client (a server column with no client
   counterpart warns, or fails under `--strict`). Then run the **4f sanity
   checks**: `<entity>_owner_received_idx` present; both structural triggers
   present; RLS enabled with the four named policies whose `qual`/`with_check`
   hashes match the fixture; zero CHECK constraints; no `extras` column; no
   `deleted` boolean.
5. Run the A.7.7 topological FK-order assertion.

Type-compatibility map (narrow): `text`↔`text`; client `integer`↔`int4`|`int8`;
client `real`↔`float8`|`numeric`. Nullability and default-expression equality
are **not** compared. The 4f sanity checks ARE strict (they assert A.1).

### A.7.4 Failure output / exit codes

- `0` — no drift, no warnings.
- `1` — drift (client column without server counterpart; or an A.1 ground-rule
  regression such as a CHECK constraint appearing). The output lists the
  entity's server columns and a `alter table … add column …` fix template,
  noting server-first deploy is unconditional.
- `2` — server has columns absent on the client (warn-only by default; promoted
  to `1` under `--strict`, which the slow gate uses).

### A.7.6 Drizzle metadata (tie-breaker only)

`getTableConfig` reliably exposes column names, wire names, base type,
nullability, FK targets, index tuples, and PK tuples. It is unreliable for SQL
`DEFAULT` expressions, `text({ enum })` literal sets, the integer `mode`
discriminator (`timestamp_ms`/`boolean`), generated columns, and post-`ALTER`
column ordering. For those, the in-memory SQLite catalog is authoritative; the
`mode` discriminator is read directly off the column builder
(`column.config.mode`).

### A.7.7 Topological FK-order assertion

The push batch builder (B.3.4) walks the entity tables in **layered**
topological order. The checker asserts the hardcoded layering in
`apps/mobile/src/sync/topo-order.ts` is consistent with the live FK graph:

```ts
export const TOPO_LAYERS: readonly (readonly string[])[] = [
  ['gyms', 'exercise_definitions', 'muscle_groups'],                    // Layer 0
  ['sessions', 'exercise_muscle_mappings', 'exercise_tag_definitions'], // Layer 1
  ['session_exercises'],                                                // Layer 2
  ['exercise_sets', 'session_exercise_tags'],                           // Layer 3
];
```

Each layer must satisfy (a) **no intra-layer FK** and (b) **every FK points to a
strictly earlier layer or is a self-edge**. The assertion:

1. Build `layer(table)` from `TOPO_LAYERS`.
2. Derive `ENTITY_TABLES` from the live schema (every `app_public` table with
   `owner_user_id`).
3. Membership: every entity appears exactly once in `TOPO_LAYERS` and vice
   versa; mismatch → FAIL.
4. For every FK edge `child → parent`: skip self-edges; if
   `layer(parent) >= layer(child)` → FAIL (names both endpoints).

> **Build note (verified).** `exercise_tag_definitions` is in **Layer 1**, not
> Layer 0, because it FKs into `exercise_definitions` (Layer 0) and an
> intra-layer FK is forbidden. `muscle_groups` is in **Layer 0**: it declares no
> FK to any other entity and is the parent of `exercise_muscle_mappings`
> (Layer 1, via `muscle_group_id`), so the child's FK points to a strictly
> earlier layer. The as-built `topo-order.ts`, the `sync_pull` SQL `case` (B.4),
> and the `sync-v2-pull-fk-closure.sh` partition assertion all encode this.
> Self-edges are allowed (a future `replaced_by_id` self-FK would be
> deferred-safe in one batch); same-layer cross-table FKs are forbidden because
> B.3.4.1's "any intra-layer order is safe" depends on it.

## A.8 Agent-reminder mechanism

The client-schema-drift rule lives in `docs/specs/05-data-model.md`
("Client schema drift rule (Sync v2)") because that file is always-loaded for
agents and already owns the sync-impact gate. The rule requires a paired,
deployed-first server migration for any new domain column on the nine entity
tables, enforced by the drift checker. It does not apply to adding a value to an
existing column (the column exists on both sides; the server stores arbitrary
text per A.1).

## A.9 Worked example — add `notes text` to `exercise_sets`

Server-first, two PRs in order:

1. **Server PR (lands first).** Migration
   `alter table app_public.exercise_sets add column notes text;`. Merge,
   deploy, confirm healthy. Older clients leave the column NULL.
2. **Client PR (lands second).** Add `notes: text('notes')` to
   `exercise-sets.ts`, `drizzle-kit generate` the local migration, run
   `npm run check:sync-drift` (passes — both sides have the column), update read
   code, ship. The push serialiser then emits `notes` under `fields`
   automatically because it closes over the typed server-column list.

The developer never edits a projection function, wires an outbox event type,
updates multiple API-contract docs, or coordinates across service repos.

---

# Part B — Push/pull RPC protocol

Two PostgREST RPCs under `app_public`. Both POST; both `security invoker` so
`owner_user_id` is derived from the JWT via RLS and never sent on the wire.

| RPC | Purpose |
| --- | --- |
| `sync_push` (`POST /rest/v1/rpc/sync_push`) | Upload a batch of dirty rows; server upserts with LWW in one transaction. |
| `sync_pull` (`POST /rest/v1/rpc/sync_pull`) | Download rows newer than a per-layer cursor, ordered by `(server_received_at, owner_user_id, type, id)`. |

There is no third "snapshot" RPC (snapshot is `sync_pull` with `cursor=null`),
no event log, no sequence numbers, no device ids, no batch ids, no `sent_at`
clock. **The data is the event.**

**Bigint serialization (B.1).** All `bigint` columns and
`client_updated_at_ms` cross the wire as JSON integers, never strings (epoch-ms
< 2^53 fits in a JS Number).

> **Build note (verified).** The bundled PostgREST (CLI pin) returns `bigint` as
> a JSON integer by default; no role-config change is required.
> `supabase/tests/sync-push-contract.sh` asserts a stored `client_updated_at_ms`
> and `created_at` return as JSON numbers, and that `sync_push`'s
> `server_received_at` returns as an ISO-8601 string.

## B.2 Wire types (shared)

### B.2.1 `Entity` envelope

Every row — push request and pull response — uses the same shape. The envelope
carries the LWW key; `fields` carries every typed column (including
`deleted_at`).

```json
{
  "type": "exercise_sets",
  "id": "01HXYZ...ULID",
  "client_updated_at_ms": 1733000000123,
  "fields": {
    "session_exercise_id": "01HX...",
    "order_index": 0,
    "weight_value": "100",
    "reps_value": "8",
    "set_type": "rir_2",
    "created_at": 1732999999000,
    "updated_at": 1733000000123,
    "deleted_at": null
  }
}
```

- `type` — one of the nine entity names (plural, snake_case), matching the
  Part A table names.
- `id` — client-assigned (ULID for user rows, slug for seeds), stable forever.
- `client_updated_at_ms` — epoch ms, the LWW key, `>= 0`, produced by the
  monotonicity guard (B.8).
- `fields` — per-entity typed columns; keys are wire-canonical snake_case
  matching A.2. The client MUST emit every typed column for the entity (JSON
  null for nullable columns). `deleted_at` is one of them under LWW like any
  other.

**No `owner_user_id` on the wire** (derived from `auth.uid()`; pull omits it
too). **No `extras` blob, no top-level `deleted` flag** — deletion is
`fields.deleted_at != null`.

### B.2.2 Error shape

```json
{ "error": { "code": "FK_VIOLATION", "message": "…" } }
```

| `code` | Cause | Client behaviour |
| --- | --- | --- |
| `AUTH_REQUIRED` | No/expired JWT, RLS denies the row. | Refresh token; if it fails, keep dirty bits, surface "Sign in again." |
| `FK_VIOLATION` | Deferrable-FK check failed at COMMIT (A.5). Structural bug. | **Non-retriable.** Log; leave dirty bits; surface non-recoverable error. Fix lands by app update. |
| `INTERNAL` | Anything else (transport, 5xx, malformed payload). | Cycle returns with error; dirty bits stay set; next scheduler tick re-pushes. No backoff. |

**The server validates hierarchy (FKs) only** — no enum/range/length/format/
business-rule validation. Schema-level malformation is caught at PR time by the
drift gate (A.7).

> **Build note — DRIFT (doc-said-X → code-is-Y).** The former t2 §2.2 implied
> both RPCs return the `{"error":{"code","message"}}` JSON envelope uniformly.
> As-built they differ in transport while keeping the same wire *tokens*:
> - **`sync_pull`** returns the `{"error":{"code":…,"message":…}}` JSON body
>   directly (codes `AUTH_REQUIRED`, `INTERNAL`).
> - **`sync_push`** signals failure by `RAISE EXCEPTION` with `errcode = P0001`
>   and a message string carrying the literal token (`AUTH_REQUIRED: …`,
>   `FK_VIOLATION: …`, `INTERNAL: …`). PostgREST surfaces this as its standard
>   error JSON; the client pattern-matches the token prefix. FK-closure failures
>   are caught from `foreign_key_violation` at `SET CONSTRAINTS ALL IMMEDIATE`
>   and re-raised as `FK_VIOLATION:` so the token is stable regardless of which
>   FK tripped.
>
> Either way the client keys off the `AUTH_REQUIRED` / `FK_VIOLATION` /
> `INTERNAL` token. The push contract test asserts the raised-token behaviour;
> the pull contract test asserts the JSON-envelope behaviour.

## B.3 `sync_push`

### B.3.1 Request

```json
{ "entities": [ { "type": "...", "id": "...", "client_updated_at_ms": 0, "fields": { } } ] }
```

`entities` is an array of length `1..200` (the v2 batch cap). Larger streams are
split into sequential batches client-side.

> **Build note (verified).** The as-built RPC signature is
> `app_public.sync_push(entities jsonb default '[]'::jsonb)` — a **named**
> parameter, so PostgREST maps the `{"entities":[…]}` body key directly. It is
> `security invoker`, granted `execute` to `anon`, `authenticated`, and
> `service_role` (revoked from `public`). The `anon` grant lets PostgREST route
> an unauthenticated call into the body so the function's own `auth.uid() IS
> NULL` check (the first statement) emits `AUTH_REQUIRED` instead of a PostgREST
> 42501. The length check is enforced as `1..200`.

### B.3.2 Ordering inside the batch

Clients may send entities in any order; the full hierarchy must be present
(in the batch or already on the server — "closure"). The server runs one
transaction with `SET CONSTRAINTS ALL DEFERRED`; all FKs are checked at COMMIT
(forced early via `SET CONSTRAINTS ALL IMMEDIATE` so a `FK_VIOLATION` token can
be raised from inside the function). Any unsatisfied FK rolls back the whole
batch.

### B.3.3 What goes in `fields`

For each typed server column on the entity (A.2), put its current local value
under `fields.<wire_key>` (snake_case Postgres column name); nullable columns
get JSON null. Local-only sync columns (B.9) must not appear; any other client
column is drift, caught at PR time.

### B.3.4 Building the batch

The client must never push a child whose parent is neither in the batch nor on
the server (B.10 #6). It satisfies this by walking the nine tables in a fixed
**topological order** when collecting dirty rows.

#### B.3.4.1 Topological order

| Layer | Tables (any intra-layer order) | FKs to earlier layers |
| --- | --- | --- |
| 0 | `gyms`, `exercise_definitions`, `muscle_groups` | none |
| 1 | `sessions`, `exercise_muscle_mappings`, `exercise_tag_definitions` | `sessions → gyms`; `exercise_muscle_mappings → exercise_definitions`, `→ muscle_groups`; `exercise_tag_definitions → exercise_definitions` |
| 2 | `session_exercises` | `→ sessions`, `→ exercise_definitions` |
| 3 | `exercise_sets`, `session_exercise_tags` | `exercise_sets → session_exercises`; `session_exercise_tags → session_exercises`, `→ exercise_tag_definitions` |

No table has a within-layer FK and none is self-referential, so any intra-layer
order is safe. This layering is hardcoded in
`apps/mobile/src/sync/topo-order.ts` and asserted against the live FK graph by
the drift checker (A.7.7).

> **Build note — corrected mapping (verified).** `exercise_tag_definitions` is
> in **Layer 1**, not Layer 0. The earlier draft placing it in Layer 0 was
> structurally impossible against the A.5.2 FK graph. `muscle_groups` is in
> **Layer 0** (no FK dependencies) and is the FK parent of
> `exercise_muscle_mappings` in Layer 1. The as-built `topo-order.ts` and the
> `sync_pull` SQL `case` both encode these placements.

#### B.3.4.2 `selectPushBatch(batchCap = 200) → Entity[]`

```
batch = []
for table in TOPO_ORDER:
  if len(batch) >= batchCap: break
  rows = SELECT * FROM <table> WHERE local_dirty = 1
         ORDER BY local_updated_at_ms ASC LIMIT (batchCap - len(batch))
  for row in rows: batch.append(serialize(row))
return batch
```

Called repeatedly by the cycle until it returns an empty array. Intra-table
`local_updated_at_ms ASC` ordering is FIFO quality-of-life; the FK guarantee
does not depend on it.

#### B.3.4.3 Why this gives no-orphan-child

For any dirty row `R`, every FK target is either (a) in the same batch from an
earlier layer (deferred FK resolves at COMMIT), (b) `local_dirty = 0` and
therefore already on the server (B.7.2 lifecycle), or (c) dirty but in a
not-yet-reached layer — in which case `R` is not in this batch either.

### B.3.5 Success response

```json
{ "ok": true, "server_received_at": "2026-05-23T10:14:32.871Z" }
```

A single ack; no per-row outcomes. The whole batch committed (each row either
LWW-applied or LWW-no-op — either way the server is at-or-newer than what the
client sent). `server_received_at` is the single transaction `now()` as an
ISO-8601 string; the client uses it for observability only. The client clears
`local_dirty` for each row subject to the B.7.3 concurrent-edit check.

> **Build note (verified).** The RPC captures one `now()` at entry, reuses it
> for `server_received_at` on every row, clamps each `client_updated_at_ms` to
> `least(incoming, now_ms + 5*60*1000)` (A.1 future-clock clamp), and upserts
> with `ON CONFLICT (owner_user_id, id) DO UPDATE … WHERE
> excluded.client_updated_at_ms > <table>.client_updated_at_ms` (A.1.1.1 LWW).
> Every column from `fields` — including `deleted_at` — is overwritten on the
> winning branch. `supabase/tests/sync-push-contract.sh` exercises LWW, the
> future-clock clamp, and Scenario-B undelete.

### B.3.6 Idempotency

A re-pushed row with the same `client_updated_at_ms` is a server-side no-op
under LWW; the ack still clears the dirty bit.

### B.3.7 Batch size

`batchCap = 200`. Fits well under the Supabase 1 MiB RPC request cap; the cycle
issues multiple sequential batches (B.6.3) when the dirty stream exceeds 200.

## B.4 `sync_pull`

Pull is symmetric to push: 200-row batches and topological-layer ordering. The
server drains layer-by-layer so a child page never lands before its parents are
on the client.

### B.4.1 Request

```json
{ "layer": 0, "cursor": null, "limit": 200 }
```

| Field | Type | Notes |
| --- | --- | --- |
| `layer` | integer `0..3` | The topological layer being drained (mapping = B.3.4.1). |
| `cursor` | object or `null` | Opaque; round-trip the value the server emitted. `null` = snapshot/initial pull of this layer. Each layer has its own cursor. |
| `cursor.{server_received_at, owner_user_id, type, id}` | — | The four tiebreak axes from the last row of the previous page. |
| `limit` | integer `1..200` | Default 200. |

> **Build note (verified).** The as-built RPC signature is
> `app_public.sync_pull(jsonb)` — an **unnamed** parameter; PostgREST's
> single-jsonb fallback routes the raw body, and the body reads `payload->'layer'`,
> `payload->'cursor'`, `payload->'limit'`. It is `security invoker`, granted
> `execute` to `authenticated`, `service_role`, and `anon` (same `AUTH_REQUIRED`
> rationale as push). `layer` must be an integer `0..3`; `limit` an integer
> `1..200` defaulting to 200; `cursor` either null/absent or an object carrying
> all four keys with a `type` that is one of the nine entity types — otherwise
> `INTERNAL`.

### B.4.2 Response

```json
{
  "entities": [ { "type": "...", "id": "...", "client_updated_at_ms": 0, "fields": {} } ],
  "next_cursor": { "server_received_at": "...", "owner_user_id": "...", "type": "...", "id": "..." },
  "has_more": true
}
```

- `entities` — up to `limit` envelopes, all from tables in the requested
  `layer`, ordered by `(server_received_at, owner_user_id, type, id)` ascending.
- `next_cursor` — the cursor for the next pull of this same layer; always
  present (echoes input on an empty page; JSON `null` on an empty snapshot of a
  layer that holds no rows for this owner).
- `has_more` — `true` iff the layer has at least one more row strictly greater
  than `next_cursor`.

### B.4.3 Pagination — monotonicity and tiebreak

```sql
WHERE owner_user_id = auth.uid()
  AND type IN (<tables in :layer>)
  AND ( :cursor IS NULL
        OR (server_received_at, owner_user_id, type, id)
           > (:cursor.server_received_at, :cursor.owner_user_id, :cursor.type, :cursor.id) )
ORDER BY server_received_at ASC, owner_user_id ASC, type ASC, id ASC
LIMIT :limit
```

The row-value `>` ensures the next pull strictly advances past the last-emitted
row — never repeats, never skips within a stable snapshot. The cursor carries
`owner_user_id` for forward-compat with multi-owner pulls.

**Known limitation: concurrent-commit cursor race.** `server_received_at` is
set before COMMIT, while `now()` is transaction-start time, so two concurrent
pushes for the same owner can commit in inverted order vs their
`server_received_at`. A pull landing between the two commits can advance past
the later value and skip the earlier row. **Self-healing**: any subsequent edit
of the skipped row bumps `server_received_at` past the cursor. Acknowledged v2
limitation; future hardening could use `pg_xact_commit_timestamp(xmin)`.

> **Build note (verified).** The as-built query fetches `limit + 1` rows to
> compute `has_more`, then trims the overshoot row and strips the cursor-axis
> fields (`owner_user_id`, `server_received_at`) off each emitted envelope. The
> static `UNION ALL` over all nine tables is scoped to the layer by
> `type = any(v_types)`; each leg also carries an explicit
> `where owner_user_id = auth.uid()` to pin the planner on
> `<table>_owner_received_idx`. The known race is documented in the migration
> header. `supabase/tests/sync-pull-contract.sh` covers snapshot, paginated
> drain, and layer→type mapping.

### B.4.4 Layer-by-layer drain (corrected mapping)

The cycle drains layers in topological order. By the time a layer-K page
applies, layers 0..K-1 are fully local, so every FK resolves immediately — no
`PRAGMA defer_foreign_keys` needed.

```
for layer in [0, 1, 2, 3]:
  while True:
    resp = sync_pull({ layer, cursor: cursors[layer], limit: 200 })
    applyPage(resp.entities)          // B.4.5
    cursors[layer] = resp.next_cursor // persist after each COMMIT
    if not resp.has_more: break
```

Layer→type mapping (as-built `sync_pull` `case`): 0 = `gyms`,
`exercise_definitions`, `muscle_groups`; 1 = `sessions`,
`exercise_muscle_mappings`, `exercise_tag_definitions`; 2 = `session_exercises`;
3 = `exercise_sets`, `session_exercise_tags`. (See the B.3.4.1 corrected-mapping
note.)
Per-layer cursors persist after every page COMMIT, so an aborted drain resumes
from where it stopped; the DB is FK-consistent at every commit boundary.

### B.4.5 Applying a pull page

Each page applies in one SQLite transaction. No deferred FKs are needed (layers
0..K-1 are fully local; no intra-layer FKs). Per-row LWW:

1. SELECT by `(type, id)`.
2. Row absent → INSERT all `fields`; set `local_dirty=0`,
   `local_updated_at_ms = incoming.client_updated_at_ms`.
3. Row present and `incoming.client_updated_at_ms > local.local_updated_at_ms` →
   UPDATE all `fields`; set `local_dirty=0`,
   `local_updated_at_ms = incoming.client_updated_at_ms`.
4. Otherwise → no-op (do not clear `local_dirty`; the local write is newer).

A per-row FK violation rolls back the page; the cursor does not advance; the
cycle terminates with a logged error (same posture as push `FK_VIOLATION`).

### B.4.6 Pull and concurrent local edits

A local mutation during a page apply flips `local_dirty=1` and bumps
`local_updated_at_ms`. The page-apply LWW (B.4.5) resolves correctly in both
orderings because the page transaction holds the SQLite connection for the whole
page.

### B.4.7 Cursor lifecycle

There are **four cursors**, one per layer, advancing independently; push affects
none of them. A cursor advances only after its layer's page COMMIT succeeds; a
rolled-back apply leaves all cursors unchanged. The four are stored in
`sync_runtime_state.pull_cursor` as a JSON object keyed by layer index
(`"0".."3"`); see B.9.2.

## B.5 First sign-in

On first successful sign-in (no `bootstrap_completed_at` in
`sync_runtime_state`), the runtime simply starts the scheduler. The first cycle
pulls everything (each layer's cursor = null) and pushes whatever is locally
dirty; LWW reconciles. No modal, no user choice.

`bootstrap_completed_at` is set the first time all four layers drain to
`has_more = false` in one cycle. It is a cold-start UX surface only; the
protocol does not branch on it.

**Auth precondition.** The local entity tables must hold rows owned by the
currently-signed-in user. Residue from a previous account would push to the new
account (RLS sets `owner_user_id = auth.uid()`) and break B.3.4.3's
"clean ⇒ server has the row" invariant. Wiping local entity tables on sign-out
(or `auth.uid()` change) is the auth layer's responsibility.

## B.6 The cycle interface

### B.6.1 What a cycle does

1. **Pull** — drain all four layers in order (B.4.4), applying each page (B.4.5)
   and advancing `cursors[layer]` after each.
2. **Push** — repeatedly `selectPushBatch` (B.3.4) + `sync_push` until the dirty
   stream is exhausted.
3. **Re-pull** — drain all four layers again; if a full round APPLIED no rows in
   either direction — every re-pull page empty or a pure no-op (re-delivering
   rows the device already holds at an equal-or-older timestamp), and the push
   leg sent nothing — the cycle converged; otherwise apply and continue.
4. **Repeat** until a full round is quiet.

Recommended order is PULL → PUSH → PULL; the scheduler only requires
convergence.

Quietness is keyed on **rows actually applied, not rows the server returned.** A
re-pull that hands back only rows already local (a benign echo — this device's
own just-pushed row, or a row a second device re-stamped to an equal-or-older
value) writes nothing and counts as quiet. Keying on `entities.length` would read
such a no-op as motion and spin a pointless extra round.

> **Build note — DRIFT (doc-said-X → code-is-Y).** An earlier draft of step 3
> tested `entities.length = 0` (rows RETURNED) for convergence. The as-built
> client (`apps/mobile/src/sync/cycle.ts`) keys the quiet-round test on rows
> CHANGED: `applyPullPage` returns the count it wrote and the loop converges when
> both pull legs wrote 0 and the push leg sent 0. The first-sign-in SEED decision
> still keys on rows RECEIVED (so a resumed bootstrap re-pulling already-local
> rows does not look empty and re-seed) — the two counts are intentionally
> distinct (`PullLegResult.received` vs `.changed`).

### B.6.2 What a cycle MUST guarantee

- **Drain to empty** (or aborted with forward progress in ≥1 batch).
- **Per-batch commits** — each `sync_push` is one transaction; each pull page
  commits before its cursor advances; an interruption leaves the DB consistent
  at the last committed batch.
- **Idempotency** — re-running from the same start state yields the same final
  state.
- **Surviving state** — only `local_dirty`, `local_updated_at_ms`, the four
  per-layer cursors, and the bootstrap flag survive between cycles (all in
  SQLite).
- **Duration** — the cycle runs PULL → PUSH → PULL until a full round is quiet
  (B.6.1); there is **no round cap and no wall-clock cycle deadline.** It is
  bounded by convergence itself plus each batch's own HTTP request timeout, so a
  sustained external write stream (a second device editing live) is followed to
  convergence rather than truncated, and a row re-edited in every push-in-flight
  window keeps re-pushing its latest value until the edits stop. Each cycle is
  retriable and resumable, so a long-running one need not finish in a single
  scheduler tick — the next tick resumes from the persisted cursors and dirty
  bits.

> **Build note — DRIFT (doc-said-X → code-is-Y).** An earlier draft promised a
> hard cycle duration ("abort cleanly within ~20s; the cycle checks elapsed time
> after each batch") and a round cap (`MAX_CYCLES_PER_CALL`). Neither is in the
> as-built v2: there is no per-batch elapsed-time check, and the former 5-round
> cap was removed because it silently rewrote any non-converging spin into a
> `'converged'` outcome — masking bugs and truncating a legitimate update stream
> — rather than surfacing it. The loop is now bounded purely by convergence and
> per-request HTTP timeouts. A hard cycle-level duration budget (abort-within-N
> with a per-batch elapsed check) remains possible future hardening; if added it
> must persist cursors/dirty bits on abort so the next tick resumes cleanly.

### B.6.3 Multi-batch push

When the dirty stream exceeds 200 rows, batch N's ack must be applied (dirty
bits cleared on committed rows) before batch N+1 is built, else N+1 re-sends.

### B.6.4 Why four cursors

Per-layer cursors give the FK-closure guarantee on apply (each layer-K page
applies after layers 0..K-1 are local). One cursor can't; per-table cursors give
nothing extra because the topological layers have no intra-layer FKs.

## B.7 Dirty-bit lifecycle

### B.7.1 The dirty bit

Every entity table has two local-only columns: `local_dirty integer not null
default 0` (1 iff the row needs pushing) and `local_updated_at_ms integer not
null default 0` (the row's client-monotonic timestamp, sent as
`client_updated_at_ms`). Neither crosses the wire. `local_dirty = 0` ⇒ the
server has the row (it only clears via push ack or pull apply).

### B.7.2 Setting and clearing

| Event | `local_dirty` | `local_updated_at_ms` |
| --- | --- | --- |
| Repo write (create/update/softDelete/cascade) | `1` | `nowMonotonic()` |
| Pull apply (incoming wins) | `0` | `incoming.client_updated_at_ms` |
| Pull apply (incoming loses) | unchanged | unchanged |
| Push ack (no concurrent edit) | `0` | unchanged |
| Push ack (concurrent edit detected) | unchanged (stays `1`) | unchanged |
| Push error | unchanged | unchanged |

Every repo write runs in a single Drizzle transaction that updates the row AND
sets the dirty bit; there is no "set dirty later" path.

### B.7.3 Push-in-flight race

At request time the cycle captures `Map<(type,id), sent_at_ms>` where
`sent_at_ms` is `local_updated_at_ms` at serialise time. On the success ack, per
row in one transaction: SELECT current `local_updated_at_ms`; if `==
sent_at_ms`, clear `local_dirty`; if `!=` (in practice `>`, the row was edited
again), leave it dirty for the next cycle.

## B.8 Clock-monotonicity guard

```
local_updated_at_ms = max(Date.now(), last_emitted_ms + 1)
```

A single helper in `apps/mobile/src/data/clock.ts` (`nowMonotonic()`) backs
every dirtying write. `last_emitted_ms` is persisted on the `sync_runtime_state`
singleton **synchronously, in the same SQLite transaction as the row write** —
fire-and-forget is unsafe (a crash between row commit and counter persist would
let the next launch emit a timestamp the server LWW-rejects). The counter is
device-global; any future account-switch wipe must leave it alone. A
module-scoped cache mirrors the persisted value for tight loops.

## B.9 Local-only sync-bookkeeping columns

### B.9.1 The two entity columns

All nine entity tables gain `local_dirty` (SQLite 0/1, default 0) and
`local_updated_at_ms` (epoch ms, default 0) — snake_case in SQLite,
`localDirty` / `localUpdatedAtMs` in Drizzle. Both are local-only: the push
serialiser omits them (B.3.3); the pull apply writes them (B.4.5).

### B.9.2 The pull cursors

Stored as a single JSON column `pull_cursor` (default `{}`) on
`sync_runtime_state`, keyed by layer index `"0".."3"`. Each entry is absent/null
(snapshot) or the opaque blob `{server_received_at, owner_user_id, type, id}`.
Each advances independently after that layer's page COMMIT (B.4.7).

### B.9.3 The monotonic-clock state

`last_emitted_ms integer default 0` on `sync_runtime_state` — the largest
`local_updated_at_ms` this device has emitted (B.8.3).

### B.9.4 Drift-checker registration

The two entity columns are registered globally in `sync-extras.json` under
`exemptions.local_only_columns`. `sync_runtime_state` is **not** in the drift
checker's scope (it has no server counterpart by design — the checker scans only
the nine entity tables), so `pull_cursor`, `last_emitted_ms`, and
`bootstrap_completed_at` need no registration.

### B.9.5 Push serialiser exclusion

The serialiser routes through one `entityToWire` function per entity that closes
over the typed server-column list (A.2); `local_only` columns are not in that
list, so they are never emitted.

## B.10 Client-enforced constraints (server does not enforce)

Per the no-server-validation rule (A.1), the server enforces only PK and FK
uniqueness. The remaining invariants are the client's responsibility — the
server has a **non-unique** index for each (A.2) and a duplicate landing on the
server is a client bug the protocol simply does not reject:

1. **Active `session_exercises`**: no two rows with `deleted_at IS NULL` sharing
   `(session_id, order_index)`. Reorder writes are serialised through one push
   batch per session.
2. **Active `exercise_sets`**: same for `(session_exercise_id, order_index)`.
3. **`exercise_muscle_mappings`**: no duplicate
   `(exercise_definition_id, muscle_group_id)` per owner.
4. **`exercise_tag_definitions`**: no duplicate active
   `(exercise_definition_id, normalized_name)` per owner.
5. **`session_exercise_tags`**: no duplicate
   `(session_exercise_id, exercise_tag_definition_id)` per owner.
6. **No orphan-child pushes** (A.5.3): the client must never push a child whose
   parent is neither in the same batch nor already on the server. B.3.4's
   topological batch builder guarantees this.

Row-level LWW on `client_updated_at_ms` (A.1.1.1) is implemented on both ends:
the server-side `sync_push` UPSERT predicate (B.3.5) and the client-side pull
apply (B.4.5).

## B.11 Out of scope

- Server-side retention/GC of `deleted_at IS NOT NULL` rows (stored as regular
  rows in v2).
- Group/sharing semantics (future work).
- Web client and MCP read paths against the typed schema (they consume Part A's
  schema directly with no Part B protocol involvement).
