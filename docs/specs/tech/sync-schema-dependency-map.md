# Sync Schema Dependency Map

## Purpose

This is the canonical schema classification and dependency map for the post-M13 sync hardening requested by [GitHub issue #50](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/50).

It complements:

- `docs/specs/03-technical-architecture.md`
- `docs/specs/05-data-model.md`
- `docs/specs/10-api-authn-authz-guidelines.md`
- `docs/specs/tech/client-sync-engine.md`
- `supabase/session-sync-api-contract.md`

The map is a discovery and planning artifact. It does not change runtime behavior by itself.

## Classification Model

| Class | Meaning | Sync rule |
| --- | --- | --- |
| `user-owned` | Belongs to exactly one authenticated app user. | Sync through auth-scoped M13 event ingest/projection. |
| `local-only` | Device runtime/cache/test state. | Never push as user domain backup. |
| `backend-only` | Server, auth, ingest, diagnostics, or operator state. | Pull only where explicitly consumed, or ignore locally. |
| `static reference` | App-owned dictionary data. | Seed/migrate locally; do not sync as shared backend state. |

## Ownership Summary

Current mobile storage is an implicit single-user projection: user-domain rows do not carry `owner_user_id` or `user_id` locally. Backend projection rows are explicit-owner rows with `owner_user_id default auth.uid()`, RLS policies using `owner_user_id = auth.uid()`, and immutable ownership triggers.

For the next rewrite phase, local row-level ownership is a required decision point, not an automatic migration. The current app can keep implicit ownership only if the runtime guarantees one authenticated projection per local DB and fully resets/re-merges on user switch. If the app must support multiple signed-in users sharing one local database without destructive swaps, add local `owner_user_id` to every syncable user-owned table and scope all local reads/writes by current user.

## Local Table Inventory

| Table | Class | Ownership path | PK | FKs and indexes | Delete/tombstone shape | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `gyms` | `user-owned` | Implicit local current-user projection. | `id text`, client/local generated. | `gyms_name_idx(name)`. No FK parents. | No local `deleted_at`; backend has tombstone. | Local delete/archive cannot be represented as a durable local tombstone today. |
| `sessions` | `user-owned` | Implicit local current-user projection. | `id text`, client/local generated. | `gym_id -> gyms.id on delete set null`; indexes on `status`, `completed_at`, `deleted_at`; status and duration checks. | `deleted_at` soft delete. | Parent for logged exercise graph. |
| `session_exercises` | `user-owned` | Derived through `sessions.session_id`, implicit current-user projection. | `id text`, client/local generated. | `session_id -> sessions.id on delete cascade`; nullable `exercise_definition_id -> exercise_definitions.id on delete no action`; indexes on `session_id`, `exercise_definition_id`; unique `(session_id, order_index)`. | No local `deleted_at`; backend has tombstone. | Nullable/no-action exercise-definition FK is intentional current tolerance but is a rewrite decision point. |
| `exercise_sets` | `user-owned` | Derived through `session_exercises.session_exercise_id`, implicit current-user projection. | `id text`, client/local generated. | `session_exercise_id -> session_exercises.id on delete cascade`; index on `session_exercise_id`; unique `(session_exercise_id, order_index)`. | No local `deleted_at`; backend has tombstone. | Physical replacement during recorder saves emits delete events for removed sets. |
| `exercise_definitions` | `user-owned` | Implicit local current-user projection. | `id text`, seed or client/local generated. | Indexes on `name`, `deleted_at`; name non-empty check. | `deleted_at` soft delete. | Seeded rows are per-user data after sync, not a backend global catalog. |
| `exercise_muscle_mappings` | `user-owned` | Derived through `exercise_definitions.exercise_definition_id`; `muscle_group_id` is static reference. | `id text`, client/local generated. | `exercise_definition_id -> exercise_definitions.id on delete cascade`; `muscle_group_id -> muscle_groups.id`; indexes on both; unique `(exercise_definition_id, muscle_group_id)`; weight/role checks. | Physical delete locally; backend attach/detach physically deletes/recreates. | Sync `entity_id` is composite pair, while payload also carries `row_id`. |
| `exercise_tag_definitions` | `user-owned` | Derived through `exercise_definitions.exercise_definition_id`. | `id text`, client/local generated. | `exercise_definition_id -> exercise_definitions.id on delete cascade`; indexes on `exercise_definition_id`, `deleted_at`; unique `(exercise_definition_id, normalized_name)`. | `deleted_at` soft delete. | Unique normalized-name behavior currently includes tombstoned rows locally and on backend. |
| `session_exercise_tags` | `user-owned` | Derived through both `session_exercises` and `exercise_tag_definitions`. | `id text`, client/local generated. | FKs to `session_exercises.id` and `exercise_tag_definitions.id` with cascade; indexes on both; unique `(session_exercise_id, exercise_tag_definition_id)`. | Physical delete locally; backend attach/detach physically deletes/recreates. | No `updated_at`; ordering/conflict decisions use `created_at`. Sync `entity_id` is composite pair, payload carries `row_id`. |
| `muscle_groups` | `static reference` | None/static. | Stable seeded `id`. | Indexes on `family_name`, `sort_order`, `display_name`; guards enforce non-editable rows. | No tombstone. | Required parent/reference for exercise muscle mappings, but not user backup scope. |
| `smoke_records` | `local-only` | None. | Autoincrement integer. | None. | Physical/runtime only. | Local runtime smoke artifact. |
| `sync_outbox_events` | `local-only` | Device-local sync queue. | Autoincrement integer. | Unique `event_id`, unique `sequence_in_device`, `created_at` index; payload and sequence guards. | Removed after ack/prefix commit. | Contains user-domain events but is not itself a backup entity. |
| `sync_delivery_state` | `local-only` | Device-local sync delivery stream. | Singleton-ish `id text`. | Guard checks for sequence, failure count, retry blocked boolean. | Reset/updated by runtime. | Holds `device_id` and next local sequence; currently shared across local user switches unless reset by runtime. |
| `sync_runtime_state` | `local-only` | Device-local sync preference/bootstrap state. | Singleton-ish `id text`. | Boolean guard on `is_enabled`. | Updated/reset by runtime/dev reset. | Includes `bootstrap_user_id`, bootstrap timestamps/errors, and `seeds_applied_at`. |

## Backend Table Inventory

| Table | Class | Ownership/RLS | PK and identity | FKs and indexes | Delete/tombstone shape | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `auth.users` | `backend-only` | Supabase Auth owns identity. | `id uuid` backend-generated. | Referenced by app-owned tables. | Auth account lifecycle. | Source of `auth.uid()` for sync ownership. |
| `app_public.user_profiles` | `backend-only` | RLS `id = auth.uid()`. | `id uuid`, same as `auth.users.id`. | `id -> auth.users(id) on delete cascade`; timestamp trigger. | Physical auth/profile lifecycle. | Account profile path, not generic sync backup. |
| `app_public.gyms` | `user-owned` | Direct `owner_user_id`; RLS owner policies; immutable owner trigger. | Composite PK `(id, owner_user_id)`; `id` client/local generated. | `owner_user_id -> auth.users`; indexes on owner, name, origin scope, deleted_at. | `deleted_at` soft delete; missing delete is idempotent no-op after `20260515190609`. | Backend still has `origin_scope_id`/`origin_source_id` defaults for compatibility. |
| `app_public.sessions` | `user-owned` | Direct `owner_user_id`; RLS owner policies. | Composite PK `(id, owner_user_id)`; `id` client/local generated. | `gym_id, owner_user_id -> gyms`; indexes on owner, status, completed_at, deleted_at. | `deleted_at` soft delete; missing delete is idempotent no-op. | Backend accepts legacy `draft` plus current `active/completed`. |
| `app_public.exercise_definitions` | `user-owned` | Direct `owner_user_id`; RLS owner policies. | Composite PK `(id, owner_user_id)`; seed/client IDs in user keyspace. | `owner_user_id -> auth.users`; indexes on owner, name, deleted_at. | `deleted_at` soft delete; missing delete is idempotent no-op. | No shared/global exercise catalog on backend. |
| `app_public.session_exercises` | `user-owned` | Direct `owner_user_id`; RLS owner policies. | Composite PK `(id, owner_user_id)`; `id` client/local generated. | `session_id, owner_user_id -> sessions on delete cascade`; `exercise_definition_id` is indexed but no FK after relaxation; active-order unique index `(owner_user_id, session_id, order_index) where deleted_at is null`. | `deleted_at` soft delete; missing delete is idempotent no-op. | FK to exercise definitions is deliberately relaxed today for first-sync ordering tolerance. |
| `app_public.exercise_sets` | `user-owned` | Direct `owner_user_id`; RLS owner policies. | Composite PK `(id, owner_user_id)`; `id` client/local generated. | `session_exercise_id, owner_user_id -> session_exercises on delete cascade`; active-order unique index `(owner_user_id, session_exercise_id, order_index) where deleted_at is null`; set type guard. | `deleted_at` soft delete; missing delete is idempotent no-op. | Backend can tombstone order collisions while local physically replaces rows. |
| `app_public.exercise_muscle_mappings` | `user-owned` | Direct `owner_user_id`; RLS owner policies. | Composite PK `(id, owner_user_id)`; row ID from payload `row_id`. | `exercise_definition_id, owner_user_id -> exercise_definitions on delete cascade`; unique `(exercise_definition_id, muscle_group_id, owner_user_id)`; indexes on owner, exercise definition, muscle group. | Physical delete/reinsert for detach/attach. | `muscle_group_id` references local static taxonomy by stable ID, not a backend table. |
| `app_public.exercise_tag_definitions` | `user-owned` | Direct `owner_user_id`; RLS owner policies. | Composite PK `(id, owner_user_id)`; `id` client/local generated. | `exercise_definition_id, owner_user_id -> exercise_definitions on delete cascade`; unique `(exercise_definition_id, normalized_name, owner_user_id)`; indexes on owner, exercise definition, deleted_at. | `deleted_at` soft delete; missing delete is idempotent no-op. | Unique normalized name does not exclude tombstoned tags. |
| `app_public.session_exercise_tags` | `user-owned` | Direct `owner_user_id`; RLS owner policies. | Composite PK `(id, owner_user_id)`; row ID from payload `row_id`. | FKs to `session_exercises` and `exercise_tag_definitions`; unique `(session_exercise_id, exercise_tag_definition_id, owner_user_id)`; indexes on owner and both parents. | Physical delete/reinsert for detach/attach. | No `updated_at`, matching local shape. |
| `app_public.sync_device_ingest_state` | `backend-only` | Direct `owner_user_id`; RLS owner policies. | `(owner_user_id, device_id)`. | `owner_user_id -> auth.users`; referenced by ingested events. | Updated in place. | Per-owner/per-device ordering cursor. |
| `app_public.sync_ingested_events` | `backend-only` | Direct `owner_user_id`; RLS owner select/insert. | `(owner_user_id, device_id, event_id)`. | FK to `sync_device_ingest_state`; unique `(owner_user_id, device_id, sequence_in_device)`; entity lookup and ingested-at indexes. | Append-only metadata. | Idempotency store; duplicate same canonical event succeeds, duplicate changed event fails. |
| `public.app_logs` | `backend-only` | Authenticated clients can insert only; service role can inspect. | `id uuid default gen_random_uuid()`. | Indexes on created_at, level, event, user_id. | Operational diagnostics. | Out of sync scope. |
| `public.dev_fixture_principals` | `backend-only` | Local fixture RLS. | `fixture_key text`. | `subject_uuid uuid unique`. | Local test fixture state. | Matters to tests, not app sync. |
| `public.local_runtime_bootstrap_markers` | `backend-only` | Local bootstrap marker. | `marker text`. | None. | Local runtime marker. | Not app sync scope. |

## Sync Entity Details

| Entity | Local shape | Backend shape | Canonical ID source | Ownership path | Current event coverage | Current gaps |
| --- | --- | --- | --- | --- | --- | --- |
| `gyms` | PK `id`, `name`, timestamps; no `deleted_at`. | Composite PK, direct owner, backend tombstone. | Client/local generated. | Local implicit; backend direct `owner_user_id`. | `upsert`, `delete`. | Local tombstone missing; backend accepts origin fields still present in historical SQL/tests. |
| `sessions` | PK `id`, nullable `gym_id`, lifecycle fields, `deleted_at`. | Composite PK, direct owner, FK to owner-scoped `gyms`. | Client/local generated. | Local implicit; backend direct. | `upsert`, `delete`, `complete`. | Backend allows `draft`; local current enum is `active/completed`. |
| `exercise_definitions` | PK `id`, `name`, `deleted_at`. | Composite PK, direct owner, backend tombstone. | Hybrid/currently mixed: stable seed IDs plus client/local IDs. | Local implicit; backend direct. | `upsert`, `delete`. | Seed version drift and user-edit semantics remain follow-ups. |
| `exercise_muscle_mappings` | PK row `id`, FK to exercise definition and static muscle group. | Composite PK row `id`; owner-scoped FK to exercise definition; no backend muscle group FK. | Row ID client/local; sync entity key is `exercise_definition_id:muscle_group_id`. | Derived from exercise definition; backend direct. | `attach`, `detach`. | Composite edge entity ID versus row ID needs a locked contract decision. |
| `exercise_tag_definitions` | PK `id`, FK to exercise definition, normalized-name unique, `deleted_at`. | Composite PK, direct owner, owner-scoped FK, normalized-name unique, tombstone. | Client/local generated. | Derived from exercise definition; backend direct. | `upsert`, `delete`. | Tombstoned names still block reuse; this may be desired but must be explicit. |
| `sessions -> session_exercises` | `session_exercises.session_id` required FK; nullable exercise definition FK. | Owner-scoped FK to sessions; exercise definition reference is nullable/indexed but not FK. | Client/local generated. | Derived through session; backend direct. | `upsert`, `delete`, `reorder`. | Local no tombstone; backend tombstone. Exercise definition dependency is currently soft on backend and nullable locally. |
| `session_exercises -> exercise_sets` | Required FK to session exercise; unique active order local without tombstone. | Owner-scoped FK to session exercise; active unique order excludes tombstones. | Client/local generated. | Derived through session exercise; backend direct. | `upsert`, `delete`, `reorder`. | Local no tombstone; physical replacement can diverge from backend soft-delete/order semantics. |
| `session_exercise_tags` | PK row `id`, two cascade FKs, `created_at`; no `updated_at`. | Composite PK row `id`, two owner-scoped FKs, `created_at`; no `updated_at`. | Row ID client/local; sync entity key is `session_exercise_id:exercise_tag_definition_id`. | Derived through session exercise and tag definition; backend direct. | `attach`, `detach`. | No updated timestamp; composite edge entity ID versus row ID needs contract lock. |

## Dependency Order

### Backend Pull / Bootstrap Fetch

Fetch can run concurrently because RLS scopes rows by authenticated user, but validation and merge must treat this dependency order as authoritative:

1. `auth.users` / current session context.
2. `app_public.user_profiles` only for profile UI, not sync projection restore.
3. Static local references: `muscle_groups` must already be seeded before user mapping rows are applied.
4. User exercise catalog: `exercise_definitions`.
5. Exercise metadata children: `exercise_muscle_mappings`, `exercise_tag_definitions`.
6. Workout parents: `gyms`, then `sessions`.
7. Logged workout children: `session_exercises`, then `exercise_sets`.
8. Assignment edges: `session_exercise_tags`.
9. Runtime metadata: sync ingest/outbox/delivery state is never part of projection restore.

### Local Merge / Apply

The local bootstrap merge currently clears and reinserts projection tables. The safe apply order is:

1. Delete child/edge tables first: `session_exercise_tags`, `exercise_sets`, `session_exercises`.
2. Delete session/gym and catalog child tables: `sessions`, `gyms`, `exercise_tag_definitions`, `exercise_muscle_mappings`, `exercise_definitions`.
3. Insert parents/references: `gyms`, `exercise_definitions`, `sessions`.
4. Insert dependent rows: `session_exercises`, `exercise_sets`, `exercise_muscle_mappings`, `exercise_tag_definitions`, `session_exercise_tags`.
5. Re-run the one-shot local exercise catalog seeder after merge so a fresh empty remote does not erase local seed availability.

Note: the current implementation inserts `sessions` before `session_exercises` and inserts exercise definitions before their mappings/tags. It sanitizes missing `gym_id`, missing session parents, missing exercise definitions, and missing assignment parents during merge rather than preserving orphans.

### Convergence Event Generation

Convergence events must be generated in parent-first order:

1. `exercise_definitions`
2. `exercise_muscle_mappings`
3. `exercise_tag_definitions`
4. `gyms`
5. `sessions`
6. `session_exercises`
7. `exercise_sets`
8. `session_exercise_tags`

This is the current `buildConvergenceEvents` order. It relies on static `muscle_groups` existing locally and on backend accepting `session_exercises.exercise_definition_id` without a FK.

### Outbound Push / Ingest

Backend ingest processes request events strictly in order. The client outbox therefore must preserve dependency order within a generated batch:

1. Parent `upsert` before child `upsert`.
2. Attach after both parent rows exist.
3. Reorder after target row upsert where both are emitted in one save.
4. Delete/tombstone child rows before hard-deleting or replacing local rows where local state cannot retain tombstones.
5. Retry duplicate submissions with identical event body only; changed body under same `event_id` is a non-retryable failure.

## Current Integrity Gaps

1. Local `gyms`, `session_exercises`, and `exercise_sets` lack `deleted_at` while backend supports tombstones. Cross-device delete propagation for those rows is lossy in local merge.
2. Local relation/child rows use physical deletes for `exercise_muscle_mappings` and `session_exercise_tags`, and physical replace for session graph children; backend uses attach/detach or soft-delete depending on entity.
3. `session_exercises.exercise_definition_id` is nullable locally and not FK-enforced on backend after the hosted hotfix/migration relaxation. This prevents bootstrap ordering failures but weakens logged-exercise integrity.
4. `session_exercise_tags` lacks `updated_at` locally and on backend; merge can only use `created_at`/presence semantics.
5. `exercise_muscle_mappings` and `session_exercise_tags` use composite edge IDs in `entity_id`, while projection rows have separate row IDs. This is workable but must stay explicit in tests and contract docs.
6. `exercise_tag_definitions` normalized-name uniqueness includes tombstoned rows. That preserves a simple invariant but prevents reusing a deleted tag name until undelete/rename semantics are defined.
7. Local implicit ownership is not enough for multiple-user local coexistence. Current runtime must keep destructive user-switch/bootstrap behavior correct or migrate to explicit local ownership.
8. Historical/backend compatibility SQL and tests still mention `origin_scope_id` / `origin_source_id`; mobile source no longer carries those columns after Drizzle migration `0011_drop_origin_columns.sql`.
9. Backend soft-delete events for missing rows are idempotent after `20260515190609`, but attach/detach missing-parent behavior still depends on FK/order discipline rather than silent repair.
10. Existing local databases need idempotent migrations and repair checks before adding stricter local tombstones, local ownership columns, or non-null/FK constraints.

## Existing Fix-Sync Reconciliation

| Item | Current repo state after inspection | Issue #50 disposition |
| --- | --- | --- |
| `docs/tasks/fix-sync/plan.md` T1 backend composite PK rewrite | Implemented by `20260514120000_user_scoped_pk_redesign.sql`. | Remains valid as completed background. Do not reopen. |
| T2 origin column cleanup | Mobile schema/migration cleanup landed, but backend historical migrations and backend tests still mention origin fields for compatibility. | Superseded as an active task; remaining references are historical/backend-compat notes, not mobile sync blockers. |
| T3 bootstrap/runtime hardening | Runtime state includes `last_bootstrap_attempt_at`; scheduler/runtime docs show adopted baseline. | Remains valid as completed background. |
| T4 seed survival | Bootstrap calls `seedSystemExerciseCatalog` after merge. | Remains valid as completed background. |
| T5 backend tests | Backend contract tests include same-ID/two-user coverage. | Remains valid as completed background. |
| T6 documentation updates | Project-level docs already describe composite PK and no shared catalog. | Mostly completed; this map becomes the detailed companion doc. |
| T7 hosted DB/runbook cleanup | Git history shows PR #17 merged and `supabase/README.md` says the stale hosted bootstrap blob was removed. | Mark old blocked status as stale; no new operator workflow from this map. |
| T8 seed once/dev reset | `seeds_applied_at`, dev reset helper, and seed-once tests exist. | Remains valid as completed background. |
| T9 coverage gaps | Git history shows PR #18 merged with sync invariant tests. | Treat as completed background even though old status doc did not list it. |
| Follow-up P4 tombstones | Still valid; now sharpened by issue #50 as the highest schema rewrite slice. | Keep and split into implementation task(s). |
| Follow-up P3 device/user stream hygiene | Still valid if local implicit ownership remains. | Keep; dependency after ownership decision. |

## Recommended Follow-On Split

1. Local tombstone parity and merge semantics
   - Owner: mobile data/sync agent.
   - Scope: add `deleted_at` to local `gyms`, `session_exercises`, and `exercise_sets`; update physical delete/replacement paths; update bootstrap merge filters and convergence delete generation; cover reinstall restore parity and cross-device delete scenarios.
   - Depends on this map only.

2. Local ownership decision and user-switch hardening
   - Owner: mobile sync/runtime agent.
   - Scope: choose implicit destructive projection versus explicit local `owner_user_id`; if implicit, test reset/merge behavior on user switch and reset device stream; if explicit, migrate local tables and scope every query.
   - Depends on tombstone design if schema migrations are combined.

3. Edge identity contract lock
   - Owner: cross-stack sync contract agent.
   - Scope: document and test composite edge `entity_id` plus `row_id` semantics for `exercise_muscle_mappings` and `session_exercise_tags`; decide whether row ID or pair key is canonical for future APIs.
   - Can run in parallel with tombstone work if it stays docs/tests first.

4. FK restoration and orphan repair plan
   - Owner: backend + mobile schema agent.
   - Scope: decide whether `session_exercises.exercise_definition_id` becomes required/FK-backed again; add local/backend repair reports; create idempotent migrations and negative tests for orphan insertion.
   - Depends on dependency-ordered push tests and seed/catalog guarantees.

5. Tag tombstone uniqueness semantics
   - Owner: mobile data/domain + backend schema agent.
   - Scope: decide whether tombstoned tag names block reuse; if not, introduce partial unique indexes/repair behavior on local and backend.
   - Can run independently after edge identity is locked.

6. CI/quality-gate enforcement
   - Owner: infrastructure agent.
   - Scope: promote sync/backend gates and Drizzle journal/orphan checks into CI per `docs/tasks/fix-sync/follow-ups.md`.
   - Independent of schema design, but should land before risky migrations.

## Source Inspection Record

Inspected on 2026-05-22 after fast-forwarding local `main` from `c4f9440` to `6dcfe35`.

Primary code evidence:

- Local schema: `apps/mobile/src/data/schema/*.ts`
- Local migrations: `apps/mobile/src/data/migrations/index.ts`, `apps/mobile/drizzle/*.sql`
- Local write/sync boundaries: `apps/mobile/src/data/local-gyms.ts`, `session-drafts.ts`, `session-list.ts`, `exercise-catalog.ts`, `exercise-tags.ts`
- Client sync: `apps/mobile/src/sync/types.ts`, `bootstrap.ts`, `runtime.ts`, `outbox.ts`
- Backend schema/RLS/ingest: `supabase/migrations/20260306170000_m13_sync_events_ingest_projection.sql`, `20260514120000_user_scoped_pk_redesign.sql`, `20260515190609_idempotent_missing_sync_deletes.sql`
- Backend diagnostics/profile: `supabase/migrations/20260304153000_m11_user_profiles.sql`, `20260507120000_create_app_logs.sql`
- Existing redesign notes: `docs/tasks/fix-sync/plan.md`, `status.md`, `follow-ups.md`
