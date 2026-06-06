# Data Model (Authoritative)

## Purpose

Define the canonical data model boundaries for local mobile storage, backend persistence, ownership, and sync scope.

This document is project-level source of truth for what data exists and how it is expected to move.

## Relationship to other specs

- Architecture/runtime behavior lives in `docs/specs/03-technical-architecture.md`.
- Testing requirements live in `docs/specs/06-testing-strategy.md`.
- Milestone/task docs may add detail but must not override this document.

## Current model layers

1. Mobile local data layer (`SQLite` via Drizzle)
- primary runtime store for app behavior.
- includes user-owned domain data plus static seeded taxonomy data.
- production bootstrap must enable SQLite `PRAGMA foreign_keys = ON` for the app
  connection before normal repository/sync writes run, and must run
  `PRAGMA foreign_key_check` after migrations/seeds so local graph violations
  are diagnosed at startup instead of surfacing only during backend sync.

2. Backend auth/profile layer (`Supabase Auth` + `app_public.user_profiles`)
- auth identity and account profile management.
- not the same as generic sync-domain backup.

3. Backend sync/projection layer (M13 implemented baseline)
- event ingest + projection for user-domain backup/restore.

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

### Static/system data (not user backup scope)

- `muscle_groups` (seeded, non-editable taxonomy)

### Test/runtime-only data (not user backup scope)

- `smoke_records`
- `sync_outbox_events`
- `sync_delivery_state`
- `sync_runtime_state`
- `sync_quarantine` — local-only push-side quarantine bookkeeping. One row per
  dirty entity the FK closure preflight found structurally orphaned, keyed
  `(entity_type, entity_id)` with `error_code`, diagnostic FK context
  (`parent_type`, `parent_id_field`, `parent_id`), `first_seen_at_ms`,
  `last_seen_at_ms`, and `occurrence_count`. Never synced and FK-free (its ids
  point at possibly-missing rows); excluded from push selection so one orphan
  cannot wedge the backlog. See `docs/specs/tech/client-sync-engine.md` §15.

## Backend schema inventory (current)

### Auth/profile

- `auth.users` (identity)
- `app_public.user_profiles` (username profile data, `1:1` with `auth.users(id)`)

### Sync-domain projection tables (M13 backend baseline)

- `app_public.gyms` (`deleted_at` projection support plus nullable private coordinate metadata)
- `app_public.sessions`
- `app_public.session_exercises` (`exercise_definition_id` + `deleted_at` projection support)
- `app_public.exercise_sets` (`deleted_at` projection support; optional `set_type` metadata projection)
- `app_public.exercise_definitions`
- `app_public.exercise_muscle_mappings`
- `app_public.exercise_tag_definitions`
- `app_public.session_exercise_tags`

### Ingest metadata tables (M13 backend baseline)

- `app_public.sync_device_ingest_state`
- `app_public.sync_ingested_events`

### Diagnostics tables (M14 baseline)

- `public.app_logs`
  - minimal app diagnostics for auth/sync failure investigation.
  - authenticated clients may insert only.
  - client-side `SELECT`, `UPDATE`, and `DELETE` are intentionally unavailable.
  - sync impact decision: `out of sync scope`; logs are operational diagnostics, not user-domain backup/restore data.

## Ownership and identity invariants

1. User-owned backend rows are auth-scoped and backend-enforced (`RLS`/constraints).
2. Mobile clients never use `service_role` credentials.
3. Sync transport must be idempotent for repeated delivery attempts.
4. Single-device assumptions are valid for M13; multi-device semantics are deferred.
5. Diagnostic log rows are write-only from authenticated clients and are manually inspected through backend operator tooling.
6. All eight sync-domain projection tables use composite primary key `(id, owner_user_id)`. Every user owns their own `id` keyspace, so two users may legitimately hold rows with the same `id` (for example, the same seeded `exercise_definitions.id`) without conflict. Cross-owner row-level conflicts are not possible by construction, and the backend has no cross-owner rejection path. Each user's seed catalog is per-user data from day one; no shared/global catalog of these entities exists on the backend.
7. Gym coordinate metadata is private, user-owned data stored on `gyms`, not a shared/public location entity.

## Local integrity contract

1. Local SQLite foreign-key enforcement is required for the production mobile
   database connection. Repository and sync write paths should assume declared
   local FK constraints are active, so invalid child rows fail at the local write
   or pull-apply boundary.
2. Bootstrap FK pragma/integrity failures are logged through `public.app_logs`
   diagnostics with sanitized context and then rethrown; logging failure must
   not mask the original SQLite failure.
3. Tests that assert FK-sensitive data or sync behavior must enable FK
   enforcement in their SQLite fixture instead of relying on SQLite's default
   per-connection FK-off mode.

## M13 sync data-model contract (implemented baseline)

1. Client emits granular outbox events for user-domain mutations.
2. Backend ingests events with idempotency key `(owner_user_id, device_id, event_id)` and strict per-device ordering via `sequence_in_device`.
3. Backend projects applied events into restorable user-state models.
4. Restore/bootstrap must be coherent across all user-owned entities listed in this document.
5. `exercise_sets` metadata includes optional `set_type` (`warm_up | rir_0 | rir_1 | rir_2 | null`) and remains nullable for legacy/unspecified sets.
6. `gyms` may include nullable coordinate metadata: `latitude`, `longitude`, `coordinate_accuracy_m`, and `coordinates_updated_at`. The sync impact decision is `in sync scope`; these fields are carried by `gyms.upsert`, bootstrap fetch/merge, convergence events, and reinstall restore parity.
7. Gym coordinate fields are either all null or all non-null. Valid ranges are latitude `-90..90`, longitude `-180..180`, accuracy `>= 0`, and non-negative `coordinates_updated_at` epoch milliseconds. Clearing saved coordinates sets all four coordinate fields to null.

### Canonical event envelope invariants

- Request-level required fields:
  - `device_id`
  - `batch_id`
  - `sent_at_ms`
  - `events` (`1..100`)
- Event-level required fields:
  - `event_id`
  - `sequence_in_device`
  - `occurred_at_ms`
  - `entity_type`
  - `entity_id`
  - `event_type`
  - `payload`
- Event-level optional fields:
  - `schema_version` (default `1`)
  - `trace_id`

### M13 entity-event coverage (locked; undelete is supported for all entities)

| Entity | Supported event types |
| --- | --- |
| `gyms` | `upsert`, `delete` (`upsert` handles undelete) |
| `sessions` | `upsert`, `delete`, `complete` (`upsert` handles undelete/reopen) |
| `session_exercises` | `upsert`, `delete`, `reorder` (`upsert` handles undelete) |
| `exercise_sets` | `upsert`, `delete`, `reorder` (`upsert` handles undelete) |
| `exercise_definitions` | `upsert`, `delete` (`upsert` handles undelete) |
| `exercise_muscle_mappings` | `attach`, `detach` (`attach` recreates detached edges) |
| `exercise_tag_definitions` | `upsert`, `delete` (`upsert` handles undelete) |
| `session_exercise_tags` | `attach`, `detach` (`attach` recreates detached edges) |

### M13 ingest/ack invariants (locked)

1. Backend processes batch events strictly in request order and stops on the first failing event.
2. Response contract is minimal:
   - `SUCCESS` for full-batch success.
   - `FAILURE` with `error_index`, `should_retry`, and free-text `message` (optional `error_event_id`).
3. Events before `error_index` are committed; the failed event and all later events are not applied.
4. Duplicate submit with same event body is a no-op success.
5. Reuse of `event_id` with a different event body fails with `should_retry=false`.

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

Modifying any file under `apps/mobile/src/data/schema/` for the eight user-owned
entities (`gyms`, `sessions`, `session_exercises`, `exercise_sets`,
`exercise_definitions`, `exercise_muscle_mappings`, `exercise_tag_definitions`,
`session_exercise_tags`) to add a domain column requires a paired server
migration under `supabase/migrations/` that adds the matching
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
`designs/t1.md` §7.7) — adding a new entity table or FK without updating that
list also fails the gate.

This rule does NOT apply to: `muscle_groups` (client-only taxonomy),
`smoke_records`, `sync_outbox_events`, `sync_delivery_state`,
`sync_runtime_state`, `sync_quarantine` (test/runtime scaffolding and local sync
bookkeeping — no server counterpart, so the drift checker, which walks the
server's `owner_user_id` entity tables, never expects them), or the two
local-only sync-bookkeeping columns (`local_dirty`, `local_updated_at_ms`) on
each entity table. The column-level exemptions are listed under `exemptions` in
`sync-extras.json`.

If your client change adds a value to an existing column (e.g., a new enum literal),
the rule does not apply because the column already exists on both sides; the client
is free to validate the enum and the server stores arbitrary text per the v2
no-server-validation policy in `docs/plans/sync-v2/designs/t1.md` §1.
