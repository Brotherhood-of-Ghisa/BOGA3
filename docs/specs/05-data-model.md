# Data Model (Authoritative)

> **Owns:** the data-model layering, per-table sync/backup scope, the ownership
> and local-integrity invariants, the client schema drift rule.
> **Not here:** the wire envelope and RPC protocol →
> `docs/specs/tech/sync-v2-server-contract.md`; column shapes → the Drizzle
> schema (`apps/mobile/src/data/schema/`) and `supabase/migrations/`.
> **Load when:** adding or changing a table, a migration, or a sync-scope
> boundary.

Columns, checks and FK targets are the code's to state. This doc states what
the schema cannot: which layer a table belongs to, whether it is in sync/backup
scope, and the invariants a migration could break silently.

## Layers

1. **Mobile local SQLite** (Drizzle, `apps/mobile/src/data/schema/`) — the
   primary runtime store.
2. **Backend auth/profile** (`Supabase Auth` + `app_public.user_profiles`) —
   identity and account profile, not sync-domain backup.
3. **Backend sync mirror** (Sync v2) — one typed `app_public.<entity>` table
   per client entity table, written by `sync_push` and read by `sync_pull`
   under per-row last-write-wins. No projection function and no event log: the
   data is the event.

The seeded taxonomies (`exercise_definitions`, `muscle_groups`) are
system-seeded *starter catalogs* that then sync as ordinary per-user entities,
not static read-only data.

The kg-only wire uses `x-boga-sync-protocol: 3`; a missing, malformed or
unsupported version receives `UPDATE_REQUIRED` before row access. Group
projections and calculated metrics stay outside the mirror: no derived
Volume/1RM column is ever stored.

Load [`tech/bodyweight-load-contract.md`](tech/bodyweight-load-contract.md)
when changing bodyweight storage or policy. Its data-model consequence:
sessions store no bodyweight tuple and no override — the latest valid reading
at or before the exact start is selected on read, so preference, contribution
and reading changes recalculate derived history without touching raw sets.

## Scope classification

Every table sits in exactly one bucket: `in sync scope` means Sync v2 mirrors
it and a reinstall restores it; `out of sync scope` means it does not
round-trip and the drift checker ignores it.

| Table group | Scope | Owning path |
| --- | --- | --- |
| The sixteen user-owned entities (`apps/mobile/src/sync/topo-order.ts` names all sixteen with their FK layers) | **in** — mirrored 1:1; the user's backup/restore scope | `apps/mobile/src/data/schema/`, `supabase/migrations/` |
| Device-local browsing and Progress preferences (key-value, not SQL tables) | out — device choices | `apps/mobile/src/preferences/` |
| The three `exercise_session_facts*` tables | out — derived, rebuildable local facts | `apps/mobile/src/data/schema/exercise-session-facts.ts` |
| `group_cache` | out — disposable cache of server group-RPC results, readable only by the signed-in `user_id` | `apps/mobile/src/data/schema/group-cache.ts` |
| `sync_runtime_state`, plus the two local-only columns on each entity table | out — local sync bookkeeping | `apps/mobile/src/data/schema/sync-runtime-state.ts` |
| `sync_quarantine` | out — local push-side quarantine | `apps/mobile/src/data/schema/sync-quarantine.ts` |
| `smoke_records` | out — test scaffolding | `apps/mobile/src/data/schema/smoke.ts` |
| `app_public.user_profiles` (`training_unit`, `time_zone` included) | out — auth/profile layer, explicitly outside the sixteen-table mirror | `supabase/migrations/` |
| `public.app_logs` | out — operational diagnostics. Authenticated clients **insert only**; client `SELECT`/`UPDATE`/`DELETE` are intentionally unavailable and rows are read through operator tooling | `supabase/migrations/` |
| `public.agent_access_audit` | out — security metadata only; service-side insert only; an app session reads only its own rows and an OAuth token cannot read it at all | `supabase/migrations/` |
| Every `app_public.group_*` table | out — server-authoritative, multi-reader rows with no per-owner LWW, so they can never be Sync v2 entities | `supabase/migrations/`, [`tech/groups-contract.md`](tech/groups-contract.md) |

No group table carries `owner_user_id` or an FK into a Sync v2 table, so the
group domain is invisible to `sync-drift --strict`; its only Sync v2 touch
point is failure-isolated triggers on `sessions` that can never abort
`sync_push`. Group projections add no Sync v2 entity and no session snapshot
and never rewrite source kg or readings. Load
[`tech/groups-contract.md`](tech/groups-contract.md) for group tables, triggers
and RPCs, and
[`tech/group-competition-contract.md`](tech/group-competition-contract.md) for
competition scoring. `exercise_group_links` is the one exception above (Sync v2
rule 8). There are no backend ingest-metadata tables either: with no event log,
nothing needs per-device deduplication.

## Device-local preferences

`apps/mobile/src/preferences/` owns the typed account-local browsing and
Progress choices. Fields, defaults, ranges, validation and the legacy-key
migration are that directory's to state;
[`tech/training-metrics-contract.md`](tech/training-metrics-contract.md) owns
what the effort selections mean.

- **Out of sync scope.** No dirty bits, no sync nudges, no `user_settings`
  column, no server counterpart; groups and coaching never read these keys
  ([[set.eligibility]]). The private bodyweight toggle, by contrast, is
  account-synced through `user_settings`.
- Keys live in `expo-sqlite/kv-store` scoped to the authenticated account id,
  with a distinct profile for local-only builds, so they **survive sign-out,
  account switches and sync database rebuilds** — the wipe below empties SQL
  rows, not the key-value store.
- **Any future explicit preference reset must address only its intended
  profile and fields** — never clear the whole key-value store.

## Exercise session facts (local-only, derived)

One row per completed, non-deleted session and linked exercise definition with
at least one working- or volume-included set, holding that session's bests and
its personal-record flags (`apps/mobile/src/data/schema/exercise-session-facts.ts`;
rebuild, drain and reads in `apps/mobile/src/data/exercise-session-facts.ts`).
Eligibility, 1RM and the record rules the flags encode are
[`tech/training-metrics-contract.md`](tech/training-metrics-contract.md) §1–§3.
Each device derives its own rows from its own synced raw rows, so devices on
different rules versions never mix values.

- **Grain.** Repeated blocks of one definition in a session fold into one row;
  unlinked legacy session exercises, active sessions and deleted sessions have
  none. A row with zero working sets may still hold a Volume record, and
  `volume_kg` is a subtotal, not a total, when `volume_complete` is false.
- **Records are always read from strictly earlier sessions** — those before the
  viewed session's `completed_at`, or before now while it is active — so a
  session never counts toward its own markers and later sessions never count.
  Every reader obeys this, so an old session's live marker matches its stored
  `pr_e1rm` / `pr_weight` flags; without an earlier record there is no marker.
- **Staleness.** SQLite triggers on the raw tables and on the policy inputs
  (load mode, contribution, the bodyweight toggle, readings) queue affected
  definition ids in `exercise_session_facts_stale` whatever path wrote the row,
  sync pull-apply and imports included; writes inside an active session queue
  nothing, and completing it queues its definitions. Every facts read drains
  the queue first in one transaction, rebuilding each queued definition's whole
  history, so a read never returns stale rows.
  `exercise_session_facts_state` holds the rules version and effort-policy key
  the table was fully built under; a missing row, another version, or a
  different active-account policy forces a full rebuild first.
- **Changing any rule that feeds the derivation — including one in the shared
  calculation kernel or the working-set rule (`isWorkingSet`) — must bump
  `EXERCISE_SESSION_FACTS_RULES_VERSION`**, or rows built under the old rule
  survive the change. A Jest fixture pins the values the current version
  derives and fails when a rule moves under it.
- **Oracle.** A full rebuild from the raw rows defines the truth; Jest asserts
  the incremental drain equals it after each kind of write.

## Sign-out / account-switch wipe

The local store holds one account's data; `sync_runtime_state.account_user_id`
records which (null on a fresh or signed-out store). One complete wipe,
`wipeLocalDatabaseRows` (`apps/mobile/src/data/local-wipe.ts`), empties it in
one transaction — the sixteen entity tables child before parent, `group_cache`,
`sync_quarantine`, then the three facts tables last, after the raw deletes have
fired their triggers — resets `bootstrap_completed_at`, `pull_cursor` and
`applied_seed_migration_app_version`, sets `account_user_id`, keeps
`last_emitted_ms`, and issues no server delete. Jest fails if a table is
neither wiped nor listed as preserved.

Three paths use it (`apps/mobile/src/sync/account-wipe.ts`,
`apps/mobile/src/data/dev-reset.ts`):

- **Sign-out** wipes and leaves the store unowned.
- **The sync cycle's ownership guard** runs first in every cycle with a
  session. A store owned by a different account is wiped and stamped with the
  signed-in account, so the bootstrapper restores that account from scratch
  (logged as `sync.local_store_owner_mismatch_wipe`, unpushed rows discarded).
  It keys off the session the cycle syncs with, not an in-memory record of the
  previous user, so it catches a switch the app never saw — a session that
  expired or could not be read back, then a sign-in as someone else. An unowned
  store that never synced is simply stamped; one that *has* synced (written
  before the owner was recorded) is wiped when nothing waits to push, and
  otherwise kept with every pull cursor reset
  (`sync.local_store_unowned_wipe` / `sync.local_store_unowned_repull`). While
  the store belongs to another account the first-sync gate is up, whatever the
  bootstrap flag says.
- **The developer reset** ("Reset local data and re-seed") wipes, keeps the
  owner, and re-seeds the starter catalog; the next cycle re-pulls the rest.

Pull cursors are reset with the rows because they are positions in the server's
change stream: kept over an emptied (or another account's) store they skip
every older server row, so a child layer can return rows whose parents the
parent layer skipped — a local FK failure on every retry. Every wipe runs under
the sync cycle's lock, so it never lands between two pages of a pull.

## Local sync bookkeeping (Sync v2)

Per-row sync state is two local-only columns on each of the sixteen user-owned
entity tables — `local_dirty` (1 iff the row needs pushing) and
`local_updated_at_ms` (the monotonic client timestamp, sent as
`client_updated_at_ms`). Neither crosses the wire, and there is no outbox or
delivery table.

Device-global state lives on the `sync_runtime_state` singleton row:
`pull_cursor` (per-layer JSON cursor map), `last_emitted_ms` (the
monotonic-clock high-water mark), `bootstrap_completed_at`, and
`account_user_id` (the account whose data the store holds).

`sync_quarantine` holds one row per quarantined dirty entity with its error
code and diagnostic FK context. Push selection excludes quarantined rows so
one local orphan cannot wedge the backlog.

## Ownership and identity invariants

1. User-owned backend rows are auth-scoped and backend-enforced
   (`RLS`/constraints).
2. Mobile clients never use `service_role` credentials.
3. Sync transport must be idempotent for repeated delivery attempts. Under v2
   this follows from per-row LWW: re-pushing a row with the same
   `client_updated_at_ms` is a server no-op, and the ack still clears the dirty
   bit.
4. Concurrent multi-device writes are resolved by per-row LWW keyed on
   `client_updated_at_ms`. There is no central ordering authority, no
   per-device sequence and no event log. Acknowledged trade-off: a stale-clock
   write can lose to a newer stored value (including the undelete-loses case in
   `docs/specs/tech/sync-v2-server-contract.md`, "LWW and undelete").
5. Diagnostic log rows are write-only from authenticated clients, inspected
   through backend operator tooling.
6. All sixteen mirror tables use composite primary key `(owner_user_id, id)` —
   **owner-first**. The order is load-bearing: the canonical pull query
   (`where owner_user_id = … order by server_received_at`) leads with the PK
   column and the per-layer cursor depends on it. Every user owns their own
   `id` keyspace, so two users may legitimately hold the same `id` (the same
   seeded `exercise_definitions.id`, say) without conflict — cross-owner row
   conflicts are impossible by construction and the backend has no cross-owner
   rejection path. Each user's seed catalog is per-user data from day one; no
   shared or global catalog exists.
7. Gym coordinate metadata is private, user-owned data on `gyms`, not a shared
   or public location entity.

## Local integrity contract

1. Local SQLite foreign-key enforcement is required for the production mobile
   database connection. expo-sqlite does not enforce FKs by default, so the app
   enables `PRAGMA foreign_keys = ON` at **connection-open** — before
   migrations and seeding run, so enforcement covers both. Bootstrap then runs
   `PRAGMA foreign_key_check`, so local graph violations surface at startup
   rather than during backend sync. Write paths assume enforcement is on, so
   invalid child rows fail at the local write or pull-apply boundary.
2. **Client FKs only reference synced parents,** so a wiped or reinstalled
   client re-pulls the parent (its earlier topological layer) before the child
   and the FK holds under enforcement. No local FK points at a static or
   client-only table that could brick on a cross-version skew. Hence
   `muscle_groups` — the FK parent of
   `exercise_muscle_mappings.muscle_group_id` — is a synced entity rather than
   a version-bundled taxonomy, and `exercise_group_links` has an FK only to
   `exercise_definitions` (its group columns reference server-only tables, so
   they are plain text). Every `out of sync scope` local table above is FK-free
   for the same reason, and inner-joins the live rows instead.
3. Bootstrap FK pragma/integrity failures are logged through `public.app_logs`
   with sanitized context, then rethrown; a logging failure must not mask the
   original SQLite failure.
4. Tests asserting FK-sensitive data or sync behaviour must enable FK
   enforcement in their SQLite fixture; SQLite defaults to FK-off per
   connection.

## Sync v2 data-model contract

Wire and RPC detail is `docs/specs/tech/sync-v2-server-contract.md`; these are
the data-model-level invariants.

1. The client marks a mutated row dirty (`local_dirty = 1`,
   `local_updated_at_ms = nowMonotonic()`) and pushes the full typed row, not a
   granular event.
2. Row identity is the composite PK `(owner_user_id, id)`, and invariant 4's
   LWW rule is applied identically on both ends: the `sync_push` upsert
   predicate and the client pull-apply.
3. Under protocol 3, restore/bootstrap is a full `sync_pull` drain across all
   five topological layers (first sign-in, or a wiped-client reinstall),
   coherent across every user-owned entity, with parents draining before
   children at each layer boundary.
4. **Effort labels cost nothing to add.** `exercise_sets.set_type` and
   `planned_set_type` are nullable text in sync scope, so a new label needs no
   wire or server migration, and hidden historical or prescribed labels stay
   readable. Personal Working set and Volume choices are device-local (above;
   [[set.eligibility]]).
5. **Planned targets and performance state are `in sync scope`** —
   `exercise_sets.planned_weight_value`, `planned_reps_value`,
   `planned_set_type` and `performance_status` ride the existing envelope,
   adding no column, server migration or envelope field. `performance_status`
   is nullable unconstrained text carrying the whole state: `planned`,
   `unperformed`, and `null` on a valid actual row meaning confirmed/performed
   ([[set.performed]]).
   Legacy `skipped` is still read, as an untouched `planned` row, and never
   written again. On upgrade a valid pre-existing row with legacy `null` stays
   confirmed, while a blank or partial legacy draft row with `null` reads as
   `unperformed`, so later entry cannot silently confirm it.
6. Only valid confirmed actual rows ([[set.performed]]) become completed
   history, and **every reader with performed/completed semantics filters to
   valid actual values plus confirmed status** — planned, legacy-skipped, unperformed, blank,
   partial, invalid, deleted and tombstoned rows contribute to no count,
   record, list, analytic or the agent coaching API. Blank and partial active
   rows are lossless drafts keeping their ids and order across save, hydration
   and navigation, and a blank `weight_value` with positive `reps_value`
   canonicalizes to `"0"` as a valid zero-load set — normalization inside
   existing columns, no migration, no wire change.
7. `gyms` coordinate metadata (`latitude`, `longitude`,
   `coordinate_accuracy_m`, `coordinates_updated_at`) is `in sync scope`,
   carried verbatim by the envelope, the first-full-pull bootstrap and
   reinstall restore parity. Its shape and range rules are local CHECKs and
   **client-enforced only** — the server validates nothing.
8. `exercise_group_links` is `in sync scope` — the member's own link from one
   of their exercises to a group exercise. Its id is `<group_id>:<exercise_definition_id>`, so
   a personal exercise links to at most one group exercise per group; unlink
   tombstones the row and relink undeletes the same id. Its only FK is to
   `exercise_definitions`; `group_id` and `group_exercise_id` are opaque text,
   so a link to a group the member has left, or to a group exercise that no
   longer exists, is kept and simply inert.
9. **No derived figure is persisted.** Every figure is computed at read time
   from current exercise metadata and the applicable private policy
   (`tech/training-metrics-contract.md` §4), so current metadata reinterprets
   history; persisted `exercise_muscle_mappings.weight` is *not* an input to
   it. One-arm/one-leg rows imply both sides were performed in v1.
   Personal-record presentation takes its exercise name from the current linked
   `exercise_definitions` row, falling back to the captured session-exercise
   name only for an unlinked legacy row, which stays isolated and reports no
   history. The session-share PNG is not a database or sync entity.

### Entity coverage (Sync v2)

All sixteen entities move through that same typed-envelope LWW upsert path: no
bespoke paths, no per-entity event types. Deletion is `deleted_at` going
non-null and undelete is the same row with `deleted_at` back to null; reorder
and complete are ordinary field changes; attach and link insert or undelete the
join or link row, and detach and unlink soft-delete it. The envelope,
`sync_push` / `sync_pull` and their error tokens are owned by
`docs/specs/tech/sync-v2-server-contract.md`.

## Sync impact gate (mandatory)

Update this file in the same task/session that changes a schema entity, an
ownership classification, a sync-scope boundary or an identity invariant. EVERY
such change MUST record one explicit decision — `in sync scope` (with
contract/mapping plus implementation and test updates) or `out of sync scope`
(with rationale and guardrails). Never leave a data-model element with
undefined sync behaviour.

## Client schema drift rule (Sync v2)

Modifying any file under `apps/mobile/src/data/schema/` for the sixteen
user-owned entities to add a domain column requires a paired server migration
under `supabase/migrations/` that adds the matching `app_public.<entity>`
column with a compatible Postgres type, **and the server migration must be
deployed to production before the client change ships**.

Why server first: a client depending on a typed server column not yet deployed
cannot round-trip it, because the server has nowhere typed to store it.
Server-first additions must also preserve old writers that omit new fields and
keep unknown entity types out of old-reader pulls; adding columns alone is not
a complete compatibility policy. The kg-only removal/rename was a protocol-3
hard cutover, not an additive change.

The drift checker (`apps/mobile/scripts/check-sync-schema-drift.ts`, run by
`npm run check:sync-drift` and gated by `./scripts/quality-slow.sh backend`)
enforces this by booting a local Postgres, applying every migration and
introspecting the live schema; PRs failing the gate cannot merge. It also
asserts the hardcoded topological order in `apps/mobile/src/sync/topo-order.ts`
against the live FK graph, so adding an entity table or FK without updating
that list fails too.

The rule does NOT apply to any `out of sync scope` local table above: no
server counterpart, and the checker introspects only the sixteen
`app_public.<entity>` mirror tables. Nor does it apply to the two local-only
bookkeeping columns, listed under `exemptions.local_only_columns` in
`apps/mobile/src/data/schema/sync-extras.json`. Nor does it assert indexes:
every entity table carries a nullable `deleted_at` and an unchecked
`<table>_deleted_at_idx` on both sides — add it by hand with each new entity
table.

Adding a value to an existing column (a new enum literal) is out of scope: the
column exists on both sides already and the server stores arbitrary text per
the v2 no-server-validation policy
(`docs/specs/tech/sync-v2-server-contract.md`, "Ground rules").
