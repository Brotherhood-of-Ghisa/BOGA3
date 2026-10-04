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

The platform layers below are current. Within them, the
[bodyweight contract](tech/bodyweight-load-contract.md) defines the kg-only
preference/contribution model. It includes an
owner-synced private preference, private dated kg readings and independent
personal/group contributions. Sessions store no bodyweight tuple or override;
the latest valid reading at/before the exact start is selected on read. Ordinary
math is the default. Personal opt-in uses a missing-reading zero fallback;
strict group opt-in omits dependent scores. Preference, contribution and reading
changes recalculate derived history without changing raw sets.

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

The kg-only wire uses `x-boga-sync-protocol: 3`; missing, malformed or
unsupported versions receive `UPDATE_REQUIRED` before row access. It includes
`user_settings`, carries readings as kg and carries exercise contributions.
Group projections and calculated metrics remain outside the mirror; no derived
Volume/1RM columns are stored. The derived exercise session facts (see *Local
schema inventory*) are a device-only table that each device rebuilds from its
own synced raw rows; they never cross the wire.

## Local schema inventory

### User-owned domain data (sync/backups expected)

- `gyms` (user-owned personal gym rows; nullable private coordinate metadata is in sync scope)
- `user_settings` (singleton id `settings`; synced
  `bodyweight_calculations_enabled`, default false)
- `body_weight_measurements` (owner-private dated readings; positive finite
  `weight_kg`, `measured_at`, timestamps and tombstone; no group access to
  reading history)
- `sessions` (recorded start/end/status and ordinary sync fields; bodyweight is a private read projection)
- `session_exercises`
- `exercise_sets` (actual entered `weight_value` / `reps_value` / `set_type`, plus optional planned target fields `planned_weight_value` / `planned_reps_value` / `planned_set_type` and `performance_status` for explicit planned/unperformed execution state; legacy `skipped` values remain readable)
- `exercise_sets` stores actual/planned Weight text in kg, parsed as
  `tech/training-metrics-contract.md` §4 says.
- `exercise_definitions` stores `bodyweight_contribution` (fraction in `[0,1]`,
  default 0). The private preference decides whether it participates.
  - `load_input_mode` is required metadata with values `total_load` and
    `per_side_load`. It describes whether the entered scalar is a shared load
    or already one-side load; it is not inferred from equipment names.
- `exercise_muscle_mappings`
- `exercise_tag_definitions`
- `session_exercise_tags`
- `muscle_groups` (per-user taxonomy; system-seeded as a starter catalog, then
  synced like any other entity — modeled on `exercise_definitions`)
- `exercise_group_links` (M25) — a member's link from one of their own
  exercises to a group exercise; deterministic id
  `<group_id>:<exercise_definition_id>` (see Sync v2 data-model contract #11)

### Device-local preferences

`apps/mobile/src/preferences/` owns typed account-local browsing and Progress choices:
exercise sort, Show never-done, detail date format, past-records gym filter, weekly
working-set target shared by all muscle groups, effort Display/Working set/Volume
selections, Progress-period weeks, history-look-back weeks (1–520), and the
Daily/Weekly heatmap view. Scalar and JSON keys in `expo-sqlite/kv-store` are scoped
to the authenticated account ID; local-only builds use a distinct local profile.
They are **out of sync scope**: device choices, without dirty bits, sync nudges,
`user_settings` columns or server counterparts. Hooks adapt the same durable
store for screens. The configuration boundary in `src/config/personal-effort.ts`
publishes the active account's calculation policy; persistence adapters pass it
explicitly to the pure kernel. Groups and coaching never read these keys.

Progress defaults are eight W/sets per muscle per week, a four-week Progress
period, a 52-week history look-back and Daily heatmaps. Missing or invalid view
choices use Daily; a valid saved Weekly choice remains unchanged. The fixed effort rows
are Warm-up, Unspecified, RIR-4 through RIR-0, Technique and Cooldown. All are
shown by default. Unspecified/RIR rows default on for both calculation columns;
Warm-up/Technique/Cooldown default off. The columns are independent: hidden
labels may contribute, and visible labels may be excluded. At least one Display
choice is required; either calculation column may be empty. Legacy visible-RIR
keys retain their selected fixed grades, with RIR-4/Technique/Cooldown added;
historical custom RIR values keep their labels and follow RIR-4 for calculations;
unrecognised stored effort follows Unspecified.

The target is a positive safe integer; Progress periods are 1–52 whole weeks.
Missing or malformed keys receive typed defaults. Failed writes preserve the
last durable configuration and pending edits, retried by Settings' existing
Data & Sync Refresh; validation errors share its Error row. Calculation edits
invalidate personal projections and rebuild facts under the new policy before
reading them. They never rewrite workouts. Eligibility, records and counted
sessions are defined by `tech/training-metrics-contract.md`.

Auth selects the scope before its snapshot reaches consumers. Sign-out hides
account values and clears failed input; saved keys survive sign-out, account
switches, and sync database rebuilds. Returning to an account restores them;
reinstallation starts from defaults. Any future explicit preference reset must
address only its intended profile and fields, never clear the whole key-value
store. The theme remains device-scoped under `boga3.themePreset.v1`, read
synchronously before tokens evaluate and applied on the next launch. The private
bodyweight toggle remains account-synced through `user_settings`.

The legacy SecureStore key `boga3.exerciseListPreferences.v1` has no owner.
Migration durably claims it for the first migrating authenticated account before
reading it; signed-out and local-only profiles defer the claim. The claim survives
failed reads and interrupted writes. Valid scoped values (including edits during
the async read) win; absent/invalid fields receive normalized legacy values,
including the `recentsOnTop` alias. Obsolete grouping/period fields are ignored.
The legacy source is deleted only after all four fields are durable, before
completion is recorded; failed cleanup remains retryable. This prevents a
keychain value that survives iOS reinstallation being claimed by another user. Late migration
results never update a different active profile. Read failures block edits until
a successful re-read; failed saves publish only durable scalar changes and retain
unsaved input for Retry.

### Test/runtime-only data (not user backup scope)

- `smoke_records`
- `sync_runtime_state` (singleton row; see *Local sync bookkeeping* below)
- `sync_quarantine` — local-only push-side quarantine bookkeeping for dirty rows
  whose required FK parents are missing locally. Never synced and FK-free.
- `group_cache` (M22) — local-only, disposable cache of server-authoritative
  group RPC results: `cache_key` PK, `user_id`, `payload_json`,
  `fetched_at_ms` (`apps/mobile/src/data/schema/group-cache.ts`, migration
  `0004`). Reads return nothing unless `user_id` matches the signed-in user.
  Sync impact decision: `out of sync scope` — no dirty columns, no FKs, no
  server counterpart, so it is outside the drift checker like
  `sync_quarantine`. Guardrails: FK-free (local integrity rule 2), cleared by
  the sign-out / account-switch wipe, and evicted per group on `NOT_FOUND`
  (`docs/specs/tech/groups-contract.md` §6.2).
- `exercise_session_facts`, `exercise_session_facts_stale`,
  `exercise_session_facts_state` — local-only, derived, rebuildable personal
  history facts (`apps/mobile/src/data/schema/exercise-session-facts.ts`,
  migrations `0011`–`0014`; rules in *Exercise session facts* below). Sync
  impact decision: `out of sync scope` — no dirty columns, no FKs, no server
  counterpart, outside the drift checker. Guardrails: FK-free (local integrity
  rule 2) with reads inner-joining the live session rows; cleared by the
  sign-out / account-switch wipe; each device derives its own rows from synced
  raw data, so devices on different rules versions never mix values; a read
  never returns stale rows (below).

### Exercise session facts (local-only, derived)

One row per completed, non-deleted session and linked exercise definition with
at least one working or volume-included set: `session_id`, `exercise_definition_id`,
`achieved_at` (the session's `completed_at`), `best_e1rm_kg` +
`best_e1rm_set_id`, `top_weight_kg` + `top_weight_set_id`, `volume_kg` +
`volume_complete`, `working_sets`, `volume_sets`, and the flags `pr_e1rm`, `pr_weight`,
`pr_volume`. Primary key `(exercise_definition_id, session_id)`; indexes
`(exercise_definition_id, achieved_at)` and `(achieved_at)`. Code:
`apps/mobile/src/data/exercise-session-facts.ts` (rebuild, drain, reads) and
`exercise-session-facts-derive.ts` (pure rules).

- **Grain.** Repeated blocks of one definition in a session fold into one row.
  Unlinked legacy session exercises, active sessions and deleted sessions have
  no rows.
- **Metrics** use independent personal working-set and volume eligibility (`tech/training-metrics-contract.md` §1).
  A row with zero working sets may hold a Volume record, but contributes no
  counted session or strength record (§2). 1RM uses the personal
  calculation policy (`tech/bodyweight-load-contract.md`). Top weight is the
  raw entered kg; an equal weight goes to the set with more reps. Volume is
  calculated load × reps, summed as the completed-session volume comparison
  does; `volume_kg` is the known subtotal when `volume_complete` is false.
  `working_sets` and `volume_sets` independently count the selected performed
  sets used for strength/counts and volume.
- **Bests and PR flags** are the record rules of
  `tech/training-metrics-contract.md` §3: a row holds the session's values
  (`summarizeSessionBests`), and a flag is set when the record book
  (`createRecordBook`) says the session set that record. The 1RM flag equals
  `deriveSessionPersonalRecords` on every session.
- **Completed-session PRs** (completion screen, completed-session route, share
  preview) read each definition's records from the sessions before the target
  (`loadEarlierBestsByDefinition`, the same fold as the records panel). The PR
  is the target's record set (`tech/training-metrics-contract.md` §3). A 1RM
  record set is the `pr_e1rm` best set. Otherwise a Weight record set is the
  `pr_weight` top-weight set. Jest holds the list equal to the replay
  `deriveSessionPersonalRecords`.
- **Live record markers** (the session view's `record` band, active and
  completed-edit, and the completed-session route's set cards) read the same
  earlier best: the sessions before the viewed session's `completed_at`, or
  before now while it is active, so its own row never counts. Later sessions
  never count, so an old session's marker matches its `pr_e1rm` / `pr_weight`
  flags. The in-memory session's record set comes from
  `deriveExercisePersonalRecord` (contract §3). A definition without an earlier
  record shows no marker.
- **Exercise records** (the exercise page's records panel, exercise history's
  `All-time bests`) fold one definition's rows through the record book
  (`loadExerciseBests`). One query joins each row's best sets and its
  session's gym. An optional gym scope (or no gym) and an optional completed
  session to count before narrow the rows; the newest row with a working set names the
  panel's `Last`, and only that session's sets are read.
- **Staleness.** SQLite triggers on `sessions`, `session_exercises`,
  `exercise_sets`, `exercise_definitions` (load mode, contribution),
  `user_settings` (the bodyweight toggle) and `body_weight_measurements` queue
  the affected definition ids in `exercise_session_facts_stale`, whatever path
  wrote the row (recorder, completed-edit, session list, sync pull-apply,
  imports, dev reset). Writes inside active sessions queue nothing; completing
  a session queues its definitions. Every facts read first drains the queue in
  one transaction, rebuilding each queued definition's whole history (cost
  bounded by that definition's history). `exercise_session_facts_state` holds
  the rules version and canonical effort-policy key the table was fully built
  under; a missing row (fresh install, wipe), another version, or a different
  active-account policy rebuilds every definition before the read. Local-only
  migrations add `effort_policy_key` to the state and `volume_sets` to facts,
  keeping volume record set counts independent of working-set counts.
  Changing a rule, including one in the shared calculation kernel or the
  working-set rule (`isWorkingSet`), bumps `EXERCISE_SESSION_FACTS_RULES_VERSION`; a Jest
  fixture pins the values the current version derives and fails when a rule
  changes under it. Reads return rows in the derivation's order, not SQLite
  collation order.
- **Oracle.** A full rebuild from the raw rows defines the truth; Jest asserts
  the incremental drain equals it after each kind of write.

### Sign-out / account-switch wipe

The local store holds one account's data; `sync_runtime_state.account_user_id`
records which (null on a fresh or signed-out store). One complete wipe,
`wipeLocalDatabaseRows` (`apps/mobile/src/data/local-wipe.ts`), empties it in
one transaction: the twelve user-owned entity tables (child before parent),
`group_cache`, `sync_quarantine`, and the three exercise-session-facts tables
(last, after the raw deletes have fired the facts triggers); then it resets
`bootstrap_completed_at`, `pull_cursor` and `applied_seed_migration_app_version`
and sets `account_user_id` on the `sync_runtime_state` row. It keeps
`last_emitted_ms` and issues no server delete. Jest fails if a table is neither
wiped nor listed as preserved.

Three paths use it (`apps/mobile/src/sync/account-wipe.ts`,
`apps/mobile/src/data/dev-reset.ts`):

- **Sign-out** wipes and leaves the store unowned.
- **The sync cycle's ownership guard** runs first in every cycle with a
  session: a store owned by a different account is wiped and stamped with the
  signed-in account, so the bootstrapper restores that account from scratch. It
  keys off the session the cycle syncs with, not an in-memory record of the
  previous user, so it catches a switch the app never saw (a session that expired
  or could not be read back, then a sign-in as someone else). The wipe is logged
  (`sync.local_store_owner_mismatch_wipe`, with the unpushed rows discarded). An
  unowned store that never synced is stamped with the signed-in account. An
  unowned store that has synced (written before the owner was recorded) is wiped
  when nothing waits to push, and otherwise kept with every pull cursor reset
  (`sync.local_store_unowned_wipe` / `sync.local_store_unowned_repull`). While
  the store belongs to a different account the first-sync gate is up, whatever
  the bootstrap flag says.
- **The developer reset** ("Reset local data and re-seed") wipes, keeps the
  owner, and re-seeds the starter catalog; the next cycle re-pulls the rest.

Pull cursors are reset with the rows because they are positions in the server's
change stream: kept over an emptied (or another account's) store, they skip
every older server row, and a child layer can then return rows whose parents
the parent layer skipped — a local FK failure on every retry. Every wipe runs
under the same lock as the sync cycle, so a wipe never lands between two pages
of a pull.

### Local sync bookkeeping (Sync v2)

v2 keeps no separate outbox/delivery tables. Per-row sync state is two local-only
columns on each of the twelve user-owned entity tables:
`local_dirty` (1 iff the row needs pushing) and `local_updated_at_ms` (the
monotonic client timestamp, sent as `client_updated_at_ms`). Neither crosses the
wire.
Device-global sync state lives on the `sync_runtime_state` singleton row:
`pull_cursor` (per-layer JSON cursor map), `last_emitted_ms` (the monotonic-clock
high-water mark), `bootstrap_completed_at`, and `account_user_id` (the account
whose data the store holds). Deep detail:
`docs/specs/tech/sync-v2-server-contract.md` §B.9.

`sync_quarantine` stores one row per quarantined dirty entity, keyed by
`(entity_type, entity_id)` with `error_code`, diagnostic FK context
(`parent_type`, `parent_id_field`, `parent_id`), `first_seen_at_ms`,
`last_seen_at_ms`, and `occurrence_count`. Push selection excludes quarantined
rows so one local orphan cannot wedge the backlog.

## Backend schema inventory

### Auth/profile

- `auth.users` (identity)
- `app_public.user_profiles` (username profile data, `1:1` with `auth.users(id)`)

### Sync-domain mirror tables (Sync v2)

One typed `app_public.<entity>` table per client entity table. Each is a direct
mirror of its client Drizzle table (no projection layer): composite primary key
`(owner_user_id, id)`, all ten composite cross-entity FKs declared
`DEFERRABLE INITIALLY DEFERRED`, and the universal sync columns
`client_updated_at_ms` (the LWW key), `server_received_at` (the pull-cursor axis),
and a nullable `deleted_at` tombstone. Per-column mapping is in
`docs/specs/tech/sync-v2-server-contract.md` §A.2.

- `app_public.gyms` (carries the four nullable private coordinate columns)
- `app_public.user_settings` (owner-private singleton preference mirror)
- `app_public.body_weight_measurements` (owner-private kg dated readings)
- `app_public.sessions`
- `app_public.session_exercises`
- `app_public.exercise_sets` (actual logged set values plus optional planned target fields and `performance_status`)
- `app_public.exercise_definitions`
- `app_public.exercise_muscle_mappings`
- `app_public.exercise_tag_definitions`
- `app_public.session_exercise_tags`
- `app_public.muscle_groups` (per-user taxonomy mirror; FK parent of
  `exercise_muscle_mappings.muscle_group_id`)
- `app_public.exercise_group_links` (M25; FK only to `exercise_definitions`;
  `group_id` / `group_exercise_id` are plain text with no FK into group tables)

There are no backend ingest-metadata tables: with no event log there is nothing
to deduplicate per device, so idempotency falls out of per-row LWW.

### Diagnostics tables (M14 baseline)

- `public.app_logs`
  - minimal app diagnostics for auth/sync failure investigation.
  - authenticated clients may insert only.
  - client-side `SELECT`, `UPDATE`, and `DELETE` are intentionally unavailable.
  - sync impact decision: `out of sync scope`; logs are operational diagnostics, not user-domain backup/restore data.

### Agent access metadata (M21)

- `public.agent_access_audit`
  - minimal metadata-only audit for authenticated BoGa3 agent API requests;
  - stores owner ID, OAuth client ID, tool/route name, timestamp, status,
    request ID, and duration only;
  - normal app sessions may read only their own rows; OAuth tokens cannot read
    the table directly; service-side insert only;
  - sync impact decision: `out of sync scope` because access audit is
    operational/security metadata, not user training backup data.
- `app_public.user_profiles.training_unit` and `time_zone`
  - training-relevant API preferences in the auth/profile layer;
  - sync impact decision: `out of sync scope` because `user_profiles` is
    explicitly outside the twelve-table Sync v2 mirror.

### Group domain (M22)

- The earlier M18 group text is superseded (M18 is `outdated`).
- Contract: `docs/specs/tech/groups-contract.md` §2.
- **As-built (M22-T01, `supabase/migrations/20260910120000_m22_groups_membership.sql`):**
  - `app_public.groups` — group header (`name`, `description`, `created_by`,
    timestamps, reserved `deleted_at`). Ownership is a membership role, not a
    column on this row.
  - `app_public.group_memberships` — one row per membership **period**
    (`role`, `joined_at`, `ended_at`, `end_reason`, `ended_by`), with at most
    one active period per user per group and at most one active owner.
  - `app_public.group_invites` — one active 8-character code per group.
  - All three: RLS on, no policies, no `anon`/`authenticated` privileges
    (access only through `app_public.group_*` RPCs); no `owner_user_id` column;
    no FK into the Sync v2 tables.
  - Sync impact decision: `out of sync scope`. These are server-authoritative,
    multi-reader rows with no per-owner LWW semantics, so they cannot be Sync v2
    entities (contract §1.1). The Sync v2 tables and their owner-only RLS
    are unchanged, and `sync-drift --strict` stays green because no group
    table carries `owner_user_id`.
- **As-built (M22-T02, `supabase/migrations/20260911120000_m22_group_record.sql`):**
  - `app_public.group_session_shares` is the group record: one row per
    `(group_id, member_user_id, session_id)`, plus `session_started_at` and
    `shared_at`.
  - It is written only by the `sessions_group_share_session` trigger on
    `app_public.sessions`, from session `started_at` vs. membership periods.
    Its rows are additive and permanent.
  - Group reads (`group_stream`, `group_session_detail`) read content through
    from the member's own Sync v2 rows, performed sets only. They never copy
    rows and never read GPS columns.
  - It follows the same posture as the other group tables: RLS on, no
    policies, no client grants, no `owner_user_id`, and no FK into Sync v2
    tables. A hard-deleted session leaves a dangling ledger row that reads
    ignore.
  - Sync impact decision: `out of sync scope`. It is server-authoritative with
    no per-owner LWW semantics. The only Sync v2 touch point is the
    failure-isolated `AFTER INSERT OR UPDATE` trigger on `sessions`, which can
    never abort `sync_push`. `sync_push`, `sync_pull`, the Sync v2 tables, and the
    wire envelope are unchanged (`sync-v2-server-contract.md` §B.11).
- **As-built (M22-T03):** the mobile `group_cache` table (local-only,
  disposable; see *Local schema inventory*), `out of sync scope`.
- **As-built (M25-T03):** `exercise_group_links` is the member's own link data,
  so unlike the tables above it is `in sync scope` — the tenth Sync v2 entity
  (Sync v2 data-model contract #11). It points at group rows only by plain-text
  id; no group table became a synced parent.
- **As-built (M25-T05, `supabase/migrations/20260914120000_m25_group_boards.sql`):**
  `app_public.group_board_entries` (one row per group exercise, member,
  metric, and certified flag: the member's best counting set, converted to
  the group exercise's load mode) and `app_public.group_board_state` (the
  exercises linked at the last evaluation). `group_events` gains the record,
  void, link, and lead-change columns. Both new tables follow the group
  posture (RLS on, no policies, no client grants, no `owner_user_id`, no FK
  into Sync v2 tables). Sync impact decision: `out of sync scope`; they are
  server-authoritative and written only by the group evaluator
  (`docs/specs/tech/groups-contract.md` §2.11).
- **As-built (M25-T06, `supabase/migrations/20260916120000_m25_group_certification.sql`):**
  `app_public.group_certifications` (one row per certification of a member's
  record set: the certifier, the pinned fingerprint and raw values, and
  `ended_at` / `end_reason` / `ended_by`), plus `group_board_state.certification_ids`.
  Same group posture (RLS on, no policies, no client grants, no `owner_user_id`,
  no FK into Sync v2 tables). Sync impact decision: `out of sync scope`; written
  only by the certification RPCs and the group evaluator
  (`docs/specs/tech/groups-contract.md` §2.12).

- **Group calculation model:** `groups` stores
  `bodyweight_calculations_enabled` and `group_exercises` stores
  `bodyweight_contribution`. Rules/revision, evaluation queue, scores, board
  state and certifications retain the server-only group posture. Metric
  certifications separate immutable observed audit from internal observed-set,
  reading and current-score pins. Optional legacy witness references preserve
  the original public ID across per-metric projections; rules rescore without
  ending witnesses, while actual set edits retain invalidation. Events retain
  private rule-rescore baselines so later evaluation preserves historic public
  scores without treating a rule change as a delayed performance correction. Sync impact
  decision: `out of sync scope`; these are multi-reader, server-authoritative
  rows and never become owner-LWW entities. The evaluator may read an applicable
  owner-private measurement internally, but no group table or public payload
  stores or exposes that value, date, identifier or dependency digest. See
  [`tech/groups-contract.md` §11](tech/groups-contract.md#11-optional-bodyweight-aware-group-calculations).

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
6. All twelve sync-domain mirror tables use composite primary key
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
   — is a synced entity rather than a version-bundled taxonomy. It is also why
   `exercise_group_links` declares an FK only to `exercise_definitions`: its
   `group_id` / `group_exercise_id` reference server-only group tables, so they
   are plain text with no FK.)
3. Bootstrap FK pragma/integrity failures are logged through `public.app_logs`
   diagnostics with sanitized context and then rethrown; logging failure must
   not mask the original SQLite failure.
4. Tests that assert FK-sensitive data or sync behavior must enable FK
   enforcement in their SQLite fixture instead of relying on SQLite's default
   per-connection FK-off mode.

## Sync v2 data-model contract

Deep wire/RPC detail lives in `docs/specs/tech/sync-v2-server-contract.md`; this
section states only the data-model-level invariants.

1. The twelve user-owned entity tables are mirrored 1:1 on the backend as typed
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
4. Under protocol 3, restore/bootstrap is a full
   `sync_pull` drain across all five topological layers
   (first sign-in or wiped-client reinstall). It must be coherent across all
   user-owned entities listed in this document, with FK integrity preserved at every
   layer boundary (parents drain before children).
5. `exercise_sets` metadata includes optional `set_type` (`warm_up | rir_<n> | technique | cooldown | null`, with canonical non-negative safe-integer RIR values). Actual and prescribed efforts remain nullable text in sync scope; the added labels need no wire or server migration. The fixed picker uses the account-local Display selection, in Warm-up → Unspecified → RIR-4–0 → Technique → Cooldown order. Hidden historical and prescribed labels remain readable. New rows use a visible inherited effort, the next harder visible RIR, or Unspecified/first visible choice; a hidden effort's explicit tap re-enters at the first visible choice. Personal Working set and Volume choices are independent, device-local policies (§ Device-local preferences); groups and coaching keep their shared rule. The owning eligibility contract is `tech/training-metrics-contract.md` §1–§2.
6. Planned workout execution targets and explicit performance state are `in sync scope`: `exercise_sets.planned_weight_value`, `planned_reps_value`, `planned_set_type`, and `performance_status` are carried in the existing push/pull wire envelope. `performance_status` is nullable unconstrained text; new writes use `planned` and `unperformed`, while a valid actual row with `null` is the confirmed/performed representation. The historical `skipped` value remains accepted for backward compatibility but hydrates as an untouched `planned` row and is never written by current session actions. This adds no column, server migration, or wire-envelope field.
   - New empty and copied/defaulted active rows use `unperformed`, even when copied values are already valid. For upgrade compatibility, a pre-existing valid row with legacy `null` remains confirmed; a blank or partial legacy draft row with `null` hydrates as `unperformed` so later entry cannot silently confirm it.
   - Active and completed-edit autosave preserve planned and unperformed rows losslessly. Completed-edit is the session view and exercise page editing a completed session (`/session/<id>`): their autosave writes the session back as `completed` through `persistCompletedSessionSnapshot`, never replaying completion. Legacy skipped rows normalize to planned on hydration. Final active-session submit and completed-edit save (the session view's `Done`) write completed workout history from valid confirmed actual rows only. Entered valid unconfirmed rows require a specific discard confirmation; they are never promoted or discarded implicitly.
   - Any reader with performed/completed semantics filters to valid actual values plus confirmed status. This includes session view and exercise page counts and records, session lists and completed detail, exercise catalog/history/records and suggested plans, muscle/exercise analytics and stats, and the agent coaching history API. Planned, legacy-skipped, unperformed, blank, partial, invalid, deleted, and tombstoned rows do not contribute.
7. Active `exercise_sets` rows are lossless draft data: fully blank and partial
   rows retain their IDs and order through save, hydration, and navigation.
   When `reps_value` is a positive integer, blank `weight_value` is canonicalized
   to `"0"` at input-commit, persistence, or completion boundaries and supplies
   valid actual values for a zero-load set; it becomes performed only after the
   row is explicitly confirmed. Blank or invalid reps remain incomplete and require
   explicit cleanup confirmation at completion. This is value normalization
   within the existing string column and Sync v2 field; it introduces no schema
   migration or wire-envelope change.
8. `gyms` may include nullable coordinate metadata: `latitude`, `longitude`, `coordinate_accuracy_m`, and `coordinates_updated_at`. The sync impact decision is `in sync scope`; all four columns are carried verbatim by the `gyms` push/pull wire envelope, the first-full-pull bootstrap, and reinstall restore parity.
9. Gym coordinate fields are either all null or all non-null. Valid ranges are latitude `-90..90`, longitude `-180..180`, accuracy `>= 0`, and non-negative `coordinates_updated_at` epoch milliseconds. Clearing saved coordinates sets all four coordinate fields to null. These ranges are client-enforced — the server runs no validation (contract §A.1).
10. Muscle volume, like every figure, is computed at read time from current
   exercise metadata and the applicable private policy; the calculation is
   `tech/training-metrics-contract.md` §4. Persisted
   `exercise_muscle_mappings.weight` does not alter this calculation; null-role
   and stabilizer mappings do not contribute. One-arm/one-leg rows imply both
   sides were performed in v1. Exercise history and records use the same
   current policy for Volume/1RM, with no muscle-role factor on 1RM. Live and
   completion personal-record
   presentation resolves its exercise name from the current linked
   `exercise_definitions` row, falling back to the captured session-exercise
   name only for an unlinked legacy row.
   Completed-session exercise-volume comparisons remain a read-time projection,
   not persisted data. They sum independently included Volume (contract §1, §4),
   combine repeated blocks by
   linked exercise definition, and compare only complete totals from earlier
   completed, nondeleted sessions for that definition. A definition with only
   sets excluded from Working set in a session is neither compared nor a baseline. Missing/invalid load preserves
   independent rep/set counts and an explicitly incomplete known subtotal;
   overflow is unavailable, never Infinity or a complete zero. P5, median, and P95 use linear interpolation over the prior
   per-session totals; unlinked legacy rows stay isolated and report no history.
   The generated session-share PNG and its temporary file URI are likewise not
   database or sync entities.
11. `exercise_group_links` (M25) is `in sync scope`: a member links one of their
   own exercises to a group exercise, and the link backs up, syncs, and works
   offline like the rest of their data (contract §A.2.10). Its id is
   `<group_id>:<exercise_definition_id>`, so a personal exercise links to at
   most one group exercise per group; unlink tombstones the row and relink
   undeletes the same id. Its only FK is `exercise_definition_id →
   exercise_definitions` (`on delete no action`, like
   `session_exercises.exercise_definition_id`); `group_id` and
   `group_exercise_id` are opaque text, so a link to a group the member has
   left or a group exercise that no longer exists is kept and simply inert.

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

There are no per-entity event types. Every one of the twelve entities moves through
the same LWW upsert path. A delete is a row whose `deleted_at` is non-null; an
undelete is that same row with `deleted_at` back to null. A reorder or complete is
an ordinary field change (`order_index` / `status`); an attach is the join-table
row (`exercise_muscle_mappings` / `session_exercise_tags`) being inserted or
undeleted, and a detach is that same row soft-deleted via `deleted_at`. A group
link follows the same shape: link inserts or undeletes the deterministic-id
`exercise_group_links` row, unlink soft-deletes it.

### Push/pull contract (Sync v2)

- `sync_push` uploads a batch of `1..200` dirty rows and upserts them under LWW in
  **one transaction**, returning a single `{ "ok": true, "server_received_at": … }`
  ack — no per-row outcomes, no partial-batch commit. The whole batch either
  commits or rolls back (deferrable FKs are checked at COMMIT). Failures surface as
  exactly one of `AUTH_REQUIRED`, `FK_VIOLATION`, or `INTERNAL` (contract §B.2.2,
  §B.3).
- `sync_pull` downloads rows newer than a per-layer cursor, draining the five
  topological layers in order so a child page never lands before its parents
  (contract §B.4). The five per-layer cursors persist in
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

Modifying any file under `apps/mobile/src/data/schema/` for the twelve user-owned
entities (`gyms`, `sessions`, `session_exercises`, `exercise_sets`,
`exercise_definitions`, `exercise_muscle_mappings`, `exercise_tag_definitions`,
`session_exercise_tags`, `muscle_groups`, `exercise_group_links`,
`body_weight_measurements`, `user_settings`) to add a
domain column requires a
paired server migration under `supabase/migrations/` that adds the matching
`app_public.<entity>` column with a compatible Postgres type, **and the server
migration must be deployed to production before the client change ships**.

Why "server first": a client that depends on a typed server column not yet
deployed will fail to round-trip that column; the server has nowhere typed to
store it. Server-first additions must also preserve old writers that omit new
fields and keep unknown entity types out of old-reader pulls. The kg-only
removal/rename is a protocol-3 hard cutover rather than an additive mixed-version
change. Adding columns alone is not a complete compatibility policy.

The drift checker (`apps/mobile/scripts/check-sync-schema-drift.ts`, invoked via
`npm run check:sync-drift` and gated by `./scripts/quality-slow.sh backend`)
enforces the rule by booting a local Postgres, applying every migration, and
introspecting the live schema. PRs failing the gate cannot merge. The checker
also asserts the hardcoded topological table order in
`apps/mobile/src/sync/topo-order.ts` against the live FK graph (see
`docs/specs/tech/sync-v2-server-contract.md` §A.7.7) — adding a new entity table
or FK without updating that list also fails the gate.

This rule does NOT apply to: `smoke_records`, `sync_runtime_state`,
`sync_quarantine`, `group_cache`, or the `exercise_session_facts*` tables
(test/runtime scaffolding, local sync bookkeeping, the disposable group cache,
and derived local facts) — these
have no server counterpart and are out of the checker's scope, which introspects
only the twelve `app_public.<entity>` mirror tables. Nor does it apply to the two
local-only sync-bookkeeping columns (`local_dirty`, `local_updated_at_ms`) on
each entity table: those are listed under `exemptions.local_only_columns` in
`sync-extras.json`. (`muscle_groups` is no longer exempt — it is one of the twelve
synced entities, and `exercise_muscle_mappings.muscleGroupId` is a typed,
FK-checked column like any other.)

If your client change adds a value to an existing column (e.g., a new enum literal),
the rule does not apply because the column already exists on both sides; the client
is free to validate the enum and the server stores arbitrary text per the v2
no-server-validation policy in `docs/specs/tech/sync-v2-server-contract.md` §A.1.
