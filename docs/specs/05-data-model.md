# Data Model (Authoritative)

> **Owns:** the canonical data model, entity boundaries, sync scope, ownership invariants. **Not here:** the server wire contract → `tech/sync-v2-server-contract.md`. **Load when:** schema, migration, or sync-scope work.

## Purpose

Define the canonical data model boundaries for local mobile storage, backend persistence, ownership, and sync scope.

This document is project-level source of truth for what data exists and how it is expected to move.

## Relationship to other specs

- Architecture/runtime behavior lives in `docs/specs/03-technical-architecture.md`.
- Testing requirements live in `docs/specs/06-testing-strategy.md`.
- The verified-accurate, normative Sync v2 reference (server schema, the
  push/pull RPC protocol, LWW/undelete semantics, drift control) is
  `docs/specs/tech/sync-v2-server-contract.md`. This document owns the
  data-model boundaries and ownership invariants; it defers deep wire/RPC detail
  to that contract by anchor (`§A.x` server schema, `§B.x` push/pull protocol).
- Milestone/task docs may add detail but must not override this document.

## Current model layers

1. Mobile local data layer (`SQLite` via Drizzle)
- primary runtime store for app behavior.
- holds user-owned domain data; the seeded taxonomies (`exercise_definitions`,
  `muscle_groups`) are system-seeded starter catalogs that then sync as ordinary
  per-user entities, not static read-only data.
- production bootstrap must enable SQLite `PRAGMA foreign_keys = ON` for the app
  connection at connection-open (the moment the database handle is opened, before
  any migrations or seeding run) so enforcement is active for both migrations and
  seed inserts — and must run `PRAGMA foreign_key_check` after migrations/seeds so
  local graph violations are diagnosed at startup instead of surfacing only
  during backend sync.

2. Backend auth/profile layer (`Supabase Auth` + `app_public.user_profiles`)
- auth identity and account profile management.
- not the same as generic sync-domain backup.

3. Backend sync mirror layer (Sync v2)
- one typed `app_public.<entity>` table per client entity table, written by the
  `sync_push` RPC and read by the `sync_pull` RPC under per-row last-write-wins.
- there is no projection function and no event log: the data is the event.

## Local schema inventory (current)

### User-owned domain data (sync/backups expected)

- `gyms` (user-owned personal gym rows; nullable private coordinate metadata is in sync scope)
- `sessions`
- `session_exercises`
- `exercise_sets` (optional `set_type` metadata: `warm_up | rir_0 | rir_1 | rir_2 | null`)
- `exercise_definitions`
- `exercise_muscle_mappings`
- `exercise_tag_definitions`
- `session_exercise_tags`
- `muscle_groups` (per-user taxonomy; system-seeded as a starter catalog, then
  synced like any other entity — modeled on `exercise_definitions`)

### Test/runtime-only data (not user backup scope)

- `smoke_records`
- `sync_runtime_state` (singleton row; see *Local sync bookkeeping* below)
- `sync_quarantine` — local-only push-side quarantine bookkeeping for dirty rows
  whose required FK parents are missing locally. Never synced and FK-free.

### Local sync bookkeeping (Sync v2)

v2 keeps no separate outbox/delivery tables. Per-row sync state is two local-only
columns on each of the nine user-owned entity tables:
`local_dirty` (1 iff the row needs pushing) and `local_updated_at_ms` (the
monotonic client timestamp, sent as `client_updated_at_ms`). Neither crosses the
wire. Device-global sync state lives on the `sync_runtime_state` singleton row:
`pull_cursor` (per-layer JSON cursor map), `last_emitted_ms` (the monotonic-clock
high-water mark), and `bootstrap_completed_at`. Deep detail:
`docs/specs/tech/sync-v2-server-contract.md` §B.9.

`sync_quarantine` stores one row per quarantined dirty entity, keyed by
`(entity_type, entity_id)` with `error_code`, diagnostic FK context
(`parent_type`, `parent_id_field`, `parent_id`), `first_seen_at_ms`,
`last_seen_at_ms`, and `occurrence_count`. Push selection excludes quarantined
rows so one local orphan cannot wedge the backlog.

## Backend schema inventory (current)

### Auth/profile

- `auth.users` (identity)
- `app_public.user_profiles` (username profile data, `1:1` with `auth.users(id)`)

### Sync-domain mirror tables (Sync v2)

One typed `app_public.<entity>` table per client entity table. Each is a direct
mirror of its client Drizzle table (no projection layer): composite primary key
`(owner_user_id, id)`, all nine composite cross-entity FKs declared
`DEFERRABLE INITIALLY DEFERRED`, and the universal sync columns
`client_updated_at_ms` (the LWW key), `server_received_at` (the pull-cursor axis),
and a nullable `deleted_at` tombstone. Per-column mapping is in
`docs/specs/tech/sync-v2-server-contract.md` §A.2.

- `app_public.gyms` (carries the four nullable private coordinate columns)
- `app_public.sessions`
- `app_public.session_exercises`
- `app_public.exercise_sets` (optional `set_type` metadata)
- `app_public.exercise_definitions`
- `app_public.exercise_muscle_mappings`
- `app_public.exercise_tag_definitions`
- `app_public.session_exercise_tags`
- `app_public.muscle_groups` (per-user taxonomy mirror; FK parent of
  `exercise_muscle_mappings.muscle_group_id`)

There are no backend ingest-metadata tables: with no event log there is nothing
to deduplicate per device, so idempotency falls out of per-row LWW.

### Diagnostics tables (M14 baseline)

- `public.app_logs`
  - minimal app diagnostics for auth/sync failure investigation.
  - authenticated clients may insert only.
  - client-side `SELECT`, `UPDATE`, and `DELETE` are intentionally unavailable.
  - sync impact decision: `out of sync scope`; logs are operational diagnostics, not user-domain backup/restore data.

## Ownership and identity invariants

1. User-owned backend rows are auth-scoped and backend-enforced (`RLS`/constraints).
2. Mobile clients never use `service_role` credentials.
3. Sync transport must be idempotent for repeated delivery attempts. Under v2 this
   follows from per-row last-write-wins: re-pushing a row with the same
   `client_updated_at_ms` is a server no-op (the ack still clears the dirty bit).
4. Concurrent multi-device writes are resolved by per-row last-write-wins keyed on
   `client_updated_at_ms`; there is no central ordering authority, no per-device
   sequence, and no event log. Acknowledged trade-off: a stale-clock write can lose
   to a newer stored value (including the undelete-loses case in
   `docs/specs/tech/sync-v2-server-contract.md` §A.1.1.2 Scenario A).
5. Diagnostic log rows are write-only from authenticated clients and are manually inspected through backend operator tooling.
6. All nine sync-domain mirror tables use composite primary key
   `(owner_user_id, id)` — **owner-first**. The column order is load-bearing: the
   canonical pull query (`where owner_user_id = … order by server_received_at`)
   leads with the PK column, and the per-layer pull cursor depends on it (contract
   §A.1, §B.4.3). Every user owns their own `id` keyspace, so two users may
   legitimately hold rows with the same `id` (for example, the same seeded
   `exercise_definitions.id`) without conflict. Cross-owner row-level conflicts are
   not possible by construction, and the backend has no cross-owner rejection path.
   Each user's seed catalog is per-user data from day one; no shared/global catalog
   of these entities exists on the backend.
7. Gym coordinate metadata is private, user-owned data stored on `gyms`, not a shared/public location entity.

## Local integrity contract

1. Local SQLite foreign-key enforcement is required for the production mobile
   database connection. The app enables it explicitly via
   `PRAGMA foreign_keys = ON` at **connection-open** — immediately after the
   database handle is opened, before migrations and seeding run — so enforcement
   is active for both. expo-sqlite does not enforce FKs by default, so this pragma
   is what makes the declared local FK constraints active. After migrations and
   seeds complete, bootstrap runs `PRAGMA foreign_key_check` to surface any local
   graph violations at startup. Repository and sync write paths assume enforcement
   is on, so invalid child rows fail at the local write or pull-apply boundary.
2. **Client FKs only reference synced parents.** Every declared local FK points
   at a table that is itself a per-user synced entity, so a wiped/reinstalled
   client re-pulls the parent (its earlier topological layer) before the child
   and the FK holds under enforcement. There is no local FK into a static or
   client-only table that could brick on a cross-version skew. (This is why
   `muscle_groups` — the FK parent of `exercise_muscle_mappings.muscle_group_id`
   — is a synced entity rather than a version-bundled taxonomy.)
3. Bootstrap FK pragma/integrity failures are logged through `public.app_logs`
   diagnostics with sanitized context and then rethrown; logging failure must
   not mask the original SQLite failure.
4. Tests that assert FK-sensitive data or sync behavior must enable FK
   enforcement in their SQLite fixture instead of relying on SQLite's default
   per-connection FK-off mode.

## Sync v2 data-model contract

Deep wire/RPC detail lives in `docs/specs/tech/sync-v2-server-contract.md`; this
section states only the data-model-level invariants.

1. The nine user-owned entity tables are mirrored 1:1 on the backend as typed
   `app_public.<entity>` tables. The client marks a mutated row dirty
   (`local_dirty = 1`, `local_updated_at_ms = nowMonotonic()`) and pushes the full
   typed row — not a granular event. There is no outbox, no projection, no event
   log: the data is the event.
2. Conflict resolution is per-row last-write-wins keyed on `client_updated_at_ms`,
   resolved identically on both ends (the `sync_push` upsert predicate and the
   client pull-apply). Row identity is the composite PK `(owner_user_id, id)`;
   idempotency follows from LWW (contract §A.1.1, §B.10).
3. The backend stores each pushed row directly under LWW upsert. Deletion is
   `deleted_at` going non-null; undelete is the same row with `deleted_at` returning
   to null under the same LWW rule. There is no separate `deleted` flag and no
   special delete/undelete path (contract §A.1.1).
4. Restore/bootstrap is a full `sync_pull` drain across all four topological layers
   (first sign-in or wiped-client reinstall). It must be coherent across all
   user-owned entities listed in this document, with FK integrity preserved at every
   layer boundary (parents drain before children).
5. `exercise_sets` metadata includes optional `set_type` (`warm_up | rir_0 | rir_1 | rir_2 | null`) and remains nullable for legacy/unspecified sets.
6. `gyms` may include nullable coordinate metadata: `latitude`, `longitude`, `coordinate_accuracy_m`, and `coordinates_updated_at`. The sync impact decision is `in sync scope`; all four columns are carried verbatim by the `gyms` push/pull wire envelope, the first-full-pull bootstrap, and reinstall restore parity.
7. Gym coordinate fields are either all null or all non-null. Valid ranges are latitude `-90..90`, longitude `-180..180`, accuracy `>= 0`, and non-negative `coordinates_updated_at` epoch milliseconds. Clearing saved coordinates sets all four coordinate fields to null. These ranges are client-enforced — the server runs no validation (contract §A.1).

### Wire envelope (Sync v2)

Push request and pull response share **one** envelope shape per row:

```json
{ "type": "<entity>", "id": "...", "client_updated_at_ms": 0, "fields": { } }
```

`fields` carries every typed column for the entity (including `deleted_at`, which
is a normal LWW column); `owner_user_id` never crosses the wire (the RPCs are
`security invoker`, so it is derived from `auth.uid()` via RLS). The envelope
carries no event-log metadata — no device, sequence, or event ids — because there
is no event log. Field-by-field detail: contract §B.2.

### Entity coverage (Sync v2)

There are no per-entity event types. Every one of the nine entities moves through
the same LWW upsert path. A delete is a row whose `deleted_at` is non-null; an
undelete is that same row with `deleted_at` back to null. A reorder or complete is
an ordinary field change (`order_index` / `status`); an attach is the join-table
row (`exercise_muscle_mappings` / `session_exercise_tags`) being inserted or
undeleted, and a detach is that same row soft-deleted via `deleted_at`.

### Push/pull contract (Sync v2)

- `sync_push` uploads a batch of `1..200` dirty rows and upserts them under LWW in
  **one transaction**, returning a single `{ "ok": true, "server_received_at": … }`
  ack — no per-row outcomes, no partial-batch commit. The whole batch either
  commits or rolls back (deferrable FKs are checked at COMMIT). Failures surface as
  exactly one of `AUTH_REQUIRED`, `FK_VIOLATION`, or `INTERNAL` (contract §B.2.2,
  §B.3).
- `sync_pull` downloads rows newer than a per-layer cursor, draining the four
  topological layers in order so a child page never lands before its parents
  (contract §B.4). The four per-layer cursors persist in
  `sync_runtime_state.pull_cursor`.

## Maintenance rule (mandatory)

Update this file in the same task/session when any of the following change:

- local schema entities or ownership classification,
- backend schema entities participating in user backup/sync,
- sync data-scope boundaries,
- identity/ownership invariants that affect data integrity.

Sync impact gate (mandatory for every data-model change):

- EVERY time a data model entity/relationship/ownership boundary is added or changed, sync impact MUST be explicitly addressed in the same task/session.
- The task must record one explicit decision:
  - `in sync scope` (with contract/mapping + implementation/test updates), or
  - `out of sync scope` (with explicit rationale and guardrails).
- Do not leave new/changed data-model elements with undefined sync behavior.

## Client schema drift rule (Sync v2)

Modifying any file under `apps/mobile/src/data/schema/` for the nine user-owned
entities (`gyms`, `sessions`, `session_exercises`, `exercise_sets`,
`exercise_definitions`, `exercise_muscle_mappings`, `exercise_tag_definitions`,
`session_exercise_tags`, `muscle_groups`) to add a domain column requires a
paired server migration under `supabase/migrations/` that adds the matching
`app_public.<entity>` column with a compatible Postgres type, **and the server
migration must be deployed to production before the client change ships**.

Why "server first": a client that depends on a typed server column not yet
deployed will fail to round-trip that column; the server has nowhere typed to
store it. Server-ahead-of-client is always safe (the column sits unwritten
until the client catches up).

The drift checker (`apps/mobile/scripts/check-sync-schema-drift.ts`, invoked via
`npm run check:sync-drift` and gated by `./scripts/quality-slow.sh backend`)
enforces the rule by booting a local Postgres, applying every migration, and
introspecting the live schema. PRs failing the gate cannot merge. The checker
also asserts the hardcoded topological table order in
`apps/mobile/src/sync/topo-order.ts` against the live FK graph (see
`docs/specs/tech/sync-v2-server-contract.md` §A.7.7) — adding a new entity table
or FK without updating that list also fails the gate.

This rule does NOT apply to: `smoke_records`, `sync_runtime_state`, or
`sync_quarantine` (test/runtime scaffolding and local sync bookkeeping) — these
have no server counterpart and are out of the checker's scope, which introspects
only the nine `app_public.<entity>` mirror tables. Nor does it apply to the two
local-only sync-bookkeeping columns (`local_dirty`, `local_updated_at_ms`) on
each entity table: those are listed under `exemptions.local_only_columns` in
`sync-extras.json`. (`muscle_groups` is no longer exempt — it is one of the nine
synced entities, and `exercise_muscle_mappings.muscleGroupId` is a typed,
FK-checked column like any other.)

If your client change adds a value to an existing column (e.g., a new enum literal),
the rule does not apply because the column already exists on both sides; the client
is free to validate the enum and the server stores arbitrary text per the v2
no-server-validation policy in `docs/specs/tech/sync-v2-server-contract.md` §A.1.
