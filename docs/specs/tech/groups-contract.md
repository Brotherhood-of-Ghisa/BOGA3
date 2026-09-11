# Groups Contract (M22)

> **Status: Partially built.** As-built: §2.1–§2.3, §3, and the
> membership/invite RPCs of §4 (M22-T01,
> `supabase/migrations/20260910120000_m22_groups_membership.sql`, proven by
> `./boga test groups-contract`), and the mobile client §6.1–§6.2 (M22-T03).
> The share ledger, stream reads, metrics, and UI are still planned. Each
> section gets an **As-built** note when its implementation task lands; the milestone spec
> (`docs/specs/milestones/M22-groups-and-foundations.md`) owns the product
> requirements and this doc owns the technical contract.

This doc covers:

- the group domain server schema;
- the rule that shares a session into a group;
- the group RPC wire contract;
- the stream-card metric semantics;
- the mobile group client architecture.

It is not the source for these:

| Topic | Source |
| --- | --- |
| Product requirements and acceptance | the M22 milestone spec |
| Sync v2 | `sync-v2-server-contract.md` |
| The authN/authZ baseline | `docs/specs/10-api-authn-authz-guidelines.md` |

## 1. Design summary

The **group record** (decision #16) is a server-side **share ledger**:
`app_public.group_session_shares`. It is written by a trigger on
`app_public.sessions` whenever a member's session reaches the server through
the existing `sync_push`. Session content is not copied. Group RPCs **read it
through** from the member's own Sync v2 rows at request time.

| Requirement | How the design meets it |
| --- | --- |
| #16 the group holds its own record | The ledger is group-owned and permanent. It records which sessions belong to the group, and nothing recomputes that from membership at read time. |
| #17 updates until complete | Nothing is copied, so every autosave the athlete pushes is visible on the next read. |
| #18 edits and deletes flow through | Same: reads see the live rows. A tombstoned session is hidden, and an undelete reappears. |
| #19 membership at logging time | Shares are decided by session `started_at` vs. membership periods (§2.5). When the server received the row is irrelevant. |
| Groups never break personal sync | No client sync change and no second push path. The trigger is failure-isolated (§2.5). |

All group access goes through `SECURITY DEFINER` RPCs (§3, §4). The group
tables are deny-all to direct client access. Devices **pull** (on focus, a
30 s poll, pull-to-refresh) into a disposable local cache (§6). There is no
Realtime in M22.

### 1.1 Alternatives rejected

| Alternative | Why not |
| --- | --- |
| Copy the session graph into per-group projection tables on every push | Every autosave re-pushes the whole graph, so this needs diffing and N copies. #18 requires propagating edits anyway, so a copy duplicates rows the ledger can point at. Phase 5 certification pins its own attested value and does not need copies either. |
| The client pushes a separate group projection | A second write path with its own offline retry. It risks personal sync, and the server already holds every row. |
| Assemble the stream by querying members' sessions by membership window | Rejected by #16. The ledger also gives the stream a stable index. |
| Make group rows Sync v2 entities | Sync v2 is per-owner LWW under `owner_user_id = auth.uid()` (contract §A.1). Multi-reader, server-authoritative rows do not fit it (contract §B.11). |
| An Edge Function group API (the M21 pattern) to reuse the TS calc module | It adds a deploy surface and a service-role boundary where authorization lives in app code. SQL RPCs keep authorization in the database (spec 10 rule 2). Metric drift is controlled by shared vectors (§5.3). |

## 2. Server schema (`app_public`)

Ground rules for every group table:

1. **No column named `owner_user_id`.** The drift checker derives Sync v2
   entity tables as "every `app_public` table with `owner_user_id`" (contract
   §A.7.3), so such a column would be misread as an unsynced entity. Group
   tables use `user_id`, `member_user_id`, and `created_by` instead.
2. **No FK into the nine Sync v2 tables.** This keeps the §A.7.7 topological
   assertion scoped to entity tables. Reads inner-join the live session rows,
   so a dangling ledger row (session hard-deleted by `dev_wipe_my_data` or
   account deletion) is invisible.
3. Ids are `uuid default gen_random_uuid()`. Group-domain timestamps are
   server-authored `timestamptz`. Session times stay the synced `bigint` epoch ms.
4. Row-level security is enabled with **no permissive policies**, and `all`
   privileges are revoked from `anon` and `authenticated` (§3).
5. Unlike Sync v2 tables, group tables *do* carry CHECK constraints. The
   server is their only writer.

### 2.1 `groups`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `name` | `text not null` | `name = btrim(name)` and `char_length(name) between 1 and 50` |
| `description` | `text null` | `char_length <= 280`; empty after trim is stored as null |
| `created_by` | `uuid null` → `auth.users(id) on delete set null` | Creation history only. Ownership lives on memberships. |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |
| `deleted_at` | `timestamptz null` | Reserved for soft delete (#3, #12 — deferred). Every read and the share trigger require `deleted_at is null`. |

### 2.2 `group_memberships` — one row per membership **period**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Also the stream key for the membership items of this period |
| `group_id` | `uuid not null` → `groups(id) on delete cascade` | |
| `user_id` | `uuid not null` → `auth.users(id) on delete cascade` | |
| `role` | `text not null` | `in ('owner','admin','member')`. It is frozen when the period ends. |
| `joined_at` | `timestamptz not null default now()` | |
| `ended_at` | `timestamptz null` | Null means current member |
| `end_reason` | `text null` | `in ('left','removed')`. It must be null exactly when `ended_at` is null. |
| `ended_by` | `uuid null` | The actor for `removed` |

Constraints and indexes:

- unique `(group_id, user_id) where ended_at is null`: at most one active
  period per person;
- unique `(group_id) where role = 'owner' and ended_at is null`: at most one
  owner, and the RPCs keep exactly one;
- index `(user_id, group_id, joined_at)` for the share trigger and "my groups".

Rejoining inserts a new period with role `member` (C3.5.6, #13). Former
membership is "has periods, none active". Later phases' "former member"
leaderboard marking reads the same rows.

### 2.3 `group_invites`

| Column | Type | Notes |
| --- | --- | --- |
| `group_id` | `uuid` PK → `groups(id) on delete cascade` | One active code per group |
| `code` | `text not null unique` | 8 characters from the Crockford base32 alphabet (`0-9A-HJKMNP-TV-Z`), generated server-side from `extensions.gen_random_bytes` (pgcrypto) |
| `created_by`, `created_at` | | |

- **Regenerate** replaces `code` in place. The old code then matches nothing.
- **Lookup normalizes input:** it upper-cases, strips spaces and `-`, and maps
  `O→0` and `I`/`L→1`.
- **Invites are multi-use and never expire** (C3.5.2).

**As-built (M22-T01, §2.1–§2.3).** The three tables ship in
`supabase/migrations/20260910120000_m22_groups_membership.sql` with the columns,
partial unique indexes, and index above, plus these constraints:

- `groups`: name trimmed, 1–50 chars; description null or trimmed, 1–280
  chars (the RPCs store a blank description as null).
- `group_memberships`: `role` and `end_reason` value checks; `ended_at` and
  `end_reason` null together; `ended_at >= joined_at`; `ended_by` set only on
  an ended period (FK → `auth.users on delete set null`).
- `group_invites`: `code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'`; `created_by` FK →
  `auth.users on delete set null`. The generator maps each of 8
  `extensions.gen_random_bytes` bytes `% 32` onto the alphabet (uniform, since
  256 is a multiple of 32) and retries a code collision up to 5 times before
  raising `INTERNAL`.
- `service_role` keeps `select/insert/update/delete` on all three for
  server-side maintenance (fixture cleanup); `anon` and `authenticated` have
  none.

### 2.4 `group_session_shares` — the group record

| Column | Type | Notes |
| --- | --- | --- |
| `group_id` | `uuid not null` → `groups(id) on delete cascade` | |
| `member_user_id` | `uuid not null` → `auth.users(id) on delete cascade` | The athlete (`sessions.owner_user_id`) |
| `session_id` | `text not null` | `sessions.id` in the member's keyspace (no FK — rule 2) |
| `session_started_at` | `bigint not null` | A copy of `sessions.started_at`, used for stream ordering and keyset pagination |
| `shared_at` | `timestamptz not null default now()` | |

Keys and indexes:

- PK `(group_id, member_user_id, session_id)`;
- index `(group_id, session_started_at desc, member_user_id, session_id)`;
- index `(member_user_id, session_id)`.

### 2.5 The share rule and trigger

**Rule.** A member's session belongs to group G iff its `started_at` falls
inside one of that member's membership periods of G (`joined_at <= started <
coalesce(ended_at, ∞)`) and G is not soft-deleted.

Consequences:

- a session logged offline before joining is never shared, even if it syncs
  after the join (#19);
- a session started while a member but synced after leaving *is* shared;
- sessions from after leaving are never shared (#9).

**Mechanism.** `app_public.group_share_session()` is an `AFTER INSERT OR UPDATE
ON app_public.sessions FOR EACH ROW` trigger, declared `security definer` with
`set search_path = app_public, pg_temp`. It runs:

```sql
insert into app_public.group_session_shares
  (group_id, member_user_id, session_id, session_started_at)
select m.group_id, new.owner_user_id, new.id, new.started_at
from app_public.group_memberships m
join app_public.groups g on g.id = m.group_id and g.deleted_at is null
where m.user_id = new.owner_user_id
  and m.joined_at <= to_timestamp(new.started_at / 1000.0)
  and (m.ended_at is null or to_timestamp(new.started_at / 1000.0) < m.ended_at)
on conflict (group_id, member_user_id, session_id)
  do update set session_started_at = excluded.session_started_at
  where group_session_shares.session_started_at <> excluded.session_started_at;
```

- **Additive and permanent.** Membership changes never delete share rows (#4).
  A share created under an earlier `started_at` is also kept if `started_at`
  is later edited.
- **Tombstones.** A tombstoned session keeps its share row. Reads filter
  `sessions.deleted_at is null`, so a delete disappears and an undelete returns
  (#18).
- **Self-healing.** The trigger fires on every insert and update (every
  autosave), so a share missed for any reason is created on that session's
  next write.
- **Failure isolation.** The body runs inside
  `begin … exception when others then … end`. On failure it records a
  sanitized `group.share_failed` row in `public.app_logs` (the M14
  diagnostics sink: event, session id, SQLSTATE; never payload values) and
  returns normally. A group-side bug therefore cannot abort `sync_push` and
  break personal sync (C3.10.5), but it stays visible in diagnostics. A
  contract test forces this path (§8).
- **Trust.** `started_at` is client-authored. A member can only influence which
  of **their own** sessions enter groups they belong to or belonged to, which
  is accepted.

## 3. Authorization model

- **No direct table access.** The four tables have RLS enabled, no permissive
  policies, and `revoke all … from anon, authenticated`. Direct PostgREST
  reads return nothing or are denied (AC9).
- **RPC-only access.** Every group operation is an `app_public.group_*`
  function. Each is declared `language plpgsql security definer set
  search_path = app_public, pg_temp`. Execute is revoked from `public` and
  granted to `anon` and `authenticated`. The `anon` grant has the same purpose
  as for the sync RPCs: the function itself emits `AUTH_REQUIRED` rather than
  PostgREST raising 42501.
- **Common preamble.** The internal `group_require_app_user()` returns
  `auth.uid()`. It raises:
  - `AUTH_REQUIRED` when there is no user;
  - `AGENT_FORBIDDEN` when `auth.jwt() ->> 'client_id'` is non-null (spec 10
    rules 14 and 17; A4.4).
- **Role helper.** The internal `group_active_role(group_id, user_id) returns
  text` returns null unless the user has an active period in a non-deleted
  group. It is `security definer` and not granted to clients. There are no RLS
  membership policies at all, so the policy-recursion hazard of spec 10 rule 16
  cannot arise.
- **Visibility.** A non-member or a nonexistent group, session, or member
  yields `NOT_FOUND`: the two cases are indistinguishable. A member whose role
  forbids an action gets `FORBIDDEN`.
- **Serialization.** Every mutating RPC takes `select … for update` on the
  `groups` row before its role checks. Concurrent promotions, transfers,
  removals, and leaves in one group are therefore serialized.
- **Usernames.** Co-member usernames are read inside the RPCs from
  `app_public.user_profiles`, whose owner-only RLS is unchanged.
  `USERNAME_REQUIRED` is raised when `nullif(btrim(username), '') is null`.

**As-built (M22-T01, §3).** Every client RPC is `security definer`,
`search_path = app_public, pg_temp`, execute revoked from `public` and granted to
`anon`, `authenticated`, and `service_role`. The internal helpers
(`group_require_app_user`, `group_active_role`, `group_require_member`,
`group_require_username`, `group_require_target`, the name/description
validators, the invite normalizer/generator/writer, and the JSON builders) have
the same pinned `search_path` and no client execute grant. `group_active_role`
rejects a `client_id` claim itself (spec 10 rule 17), in addition to the
preamble every RPC runs first. `groups-contract` asserts this posture from the
catalog.

## 4. RPC contract

**Transport.** `POST /rest/v1/rpc/<name>` with `Content-Profile: app_public`.
The client calls `getRequiredSupabaseMobileClient().schema('app_public').rpc(name,
args)`. Arguments are named `p_*`. Every function returns `jsonb`.

**Errors** use the `sync_push` transport (contract §B.2.2):
`raise exception '<TOKEN>: <message>' using errcode = 'P0001'`. The client
matches the token prefix.

| Token | Meaning |
| --- | --- |
| `AUTH_REQUIRED` | No authenticated user |
| `AGENT_FORBIDDEN` | OAuth (agent) token |
| `NOT_FOUND` | Group, session, or member not visible to the caller (non-member ≡ nonexistent) |
| `FORBIDDEN` | Caller is a member, but their role disallows the action |
| `VALIDATION` | Bad input (name/description bounds, `p_limit`, cursor shape, role value, target is self) |
| `USERNAME_REQUIRED` | Create or join without a non-blank username |
| `INVITE_INVALID` | Unknown or regenerated code, or the group is deleted |
| `OWNER_MUST_TRANSFER` | The owner tried to leave |

Client-only codes: `NETWORK` for transport failure, and `INTERNAL` for
anything unrecognized.

### 4.1 Shared shapes

```jsonc
// Member
{ "user_id": "uuid", "username": "string|null", "role": "owner|admin|member" }
// GroupSummary
{ "group_id": "uuid", "name": "…", "description": "…|null",
  "member_count": 3, "my_role": "owner|admin|member" }
```

`member_count` counts active members. Usernames may be null if a member
cleared theirs after joining; the UI falls back to "Unnamed member".

### 4.2 Reads

| RPC | Access | Returns |
| --- | --- | --- |
| `group_list_mine()` | any app user | `{ groups: GroupSummary[] }` for active memberships, sorted by name |
| `group_get(p_group_id)` | active member, else `NOT_FOUND` | `{ group: GroupSummary, members: Member[] }` |
| `group_stream(p_group_id, p_before, p_limit)` | see below | `{ items: StreamItem[], next_cursor, has_more }` |
| `group_session_detail(p_member_user_id, p_session_id)` | see below | `{ session: SessionDetail }` |
| `group_invite_preview(p_code)` | any app user | `{ group_id, name, member_count, already_member }`, or `INVITE_INVALID` |

**`group_get`.** Members are active members only, sorted owner → admins →
members, then by username case-insensitively with nulls last (C3.6.1).

**`group_stream` scope and access.**

- `p_group_id` null means every group where the caller is currently active
  (All). A value means that group only, and the caller must be an active
  member, else `NOT_FOUND`.
- A removed member therefore gets nothing on their next refresh (C3.6.8, AC11).
- `p_limit` accepts `1..50` and defaults to `20`.

**`group_stream` items**, ordered by `sort_at_ms desc, kind, key desc`:

```jsonc
// session card — one per (member, session) in scope; deduplicated across groups in All
{ "kind": "session", "key": "<member_user_id>:<session_id>",
  "sort_at_ms": 1757500000000,            // = sessions.started_at
  "member": { "user_id": "…", "username": "…" },
  "session_id": "…",
  "groups": [{ "group_id": "…", "name": "…" }],   // caller's in-scope groups holding the share
  "gym_name": "…|null",
  "status": "active|completed",
  "started_at_ms": 0, "completed_at_ms": 0, "duration_sec": 0,   // nullable while active
  "metrics": { "performed_sets": 12, "total_volume_kg": 5230.5, "exercise_count": 4 },
  "highlights": { "prs": [{ "exercise_name": "…", "weight_kg": 100, "reps": 5, "e1rm_kg": 112.4 }] } }
// membership item — joined at joined_at; left/removed at ended_at
{ "kind": "membership", "key": "<membership_id>:joined|ended",
  "sort_at_ms": 0, "event": "joined|left|removed",
  "group": { "group_id": "…", "name": "…" },
  "member": { "user_id": "…", "username": "…" } }
```

- **Cursor.** `next_cursor` is the last item's `{sort_at_ms, kind, key}`. A
  page returns items strictly after it in the order above.
- **Excluded.** Sessions whose row is missing or has `deleted_at` set.
- **Late syncs.** A session that syncs late sorts at its `started_at` (C3.7.4).

**`group_session_detail` access.** The caller must be an active member of at
least one non-deleted group holding a share for `(member, session)`, and the
session must not be deleted. Otherwise the result is `NOT_FOUND`.

**`group_session_detail` shape.** `SessionDetail` =
`{ member, session_id, gym_name, status, started_at_ms, completed_at_ms,
duration_sec, exercises: [{ session_exercise_id, name, machine_name,
order_index, sets: [{ set_id, order_index, weight_kg, reps, set_type }] }] }`.

- Exercises and sets are in `order_index` order.
- **Only performed sets** (§5.1) are returned (A4.2). Tombstoned exercises and
  sets are omitted, and so are exercises with no performed set.
- `name` is the member's own exercise name (`session_exercises.name`).
- No GPS columns are ever read.

### 4.3 Writes

| RPC | Allowed | Effect / returns |
| --- | --- | --- |
| `group_create(p_name, p_description)` | any app user with a username | Creates the group, the caller's `owner` period, and an invite. Returns `{ group_id }`. |
| `group_update(p_group_id, p_name, p_description)` | owner, admin | `{ group: GroupSummary }` |
| `group_invite_get(p_group_id)` | owner, admin (C7.4) | `{ code }` |
| `group_invite_regenerate(p_group_id)` | owner, admin | Replaces the code. Returns `{ code }`. |
| `group_join(p_code)` | any app user with a username | Already active: `{ group_id, joined: false }`, no-op. Otherwise it inserts a `member` period: `{ group_id, joined: true }`. |
| `group_leave(p_group_id)` | admin, member | Ends the period with `left`. The owner gets `OWNER_MUST_TRANSFER`, including a sole owner (C3.6.5). |
| `group_remove_member(p_group_id, p_user_id)` | the owner removes anyone else; an admin removes `member`s only | Ends the target's period with `removed` and `ended_by = caller`. |
| `group_set_role(p_group_id, p_user_id, p_role)` | owner | `p_role in ('admin','member')`. The target must be active and not the owner. |
| `group_transfer_ownership(p_group_id, p_user_id)` | owner | The target (active, not self) becomes `owner`, and the caller becomes `admin` (C3.6.4). |

Writes raise:

- `NOT_FOUND` when the target is not an active member, or the caller is not;
- `FORBIDDEN` when the caller's role is insufficient;
- `VALIDATION` when a rule is violated (for example removing yourself).

**As-built (M22-T01).** Every RPC in §4.2 `group_list_mine` / `group_get` /
`group_invite_preview` and every §4.3 write ships in
`supabase/migrations/20260910120000_m22_groups_membership.sql`.

- **Return shapes the table above left open** (fixed here; the mobile client
  types against these):

  | RPC | Returns |
  | --- | --- |
  | `group_leave` | `{ group_id }` |
  | `group_remove_member`, `group_set_role`, `group_transfer_ownership` | `{ group: GroupSummary, members: Member[] }` — the `group_get` payload after the change, from the caller's view (after a transfer, `my_role` is `admin`) |

- **Check order.** Preamble (`AUTH_REQUIRED`, then `AGENT_FORBIDDEN`) → caller
  membership (`NOT_FOUND`) → caller role (`FORBIDDEN`) → input and target
  (`VALIDATION`, then target `NOT_FOUND`). A member calling a privileged write
  therefore gets `FORBIDDEN` even with a bad target. `group_create` and
  `group_join` check `USERNAME_REQUIRED` before validating the name or code.
- **`group_update`** replaces both fields: a null or blank `p_description`
  clears the description. Names and descriptions are stored trimmed.
- **`group_invite_preview`** needs no username (any app user may look before
  setting one); `group_join` does.
- **NOT_FOUND bodies** for a non-member and a nonexistent or soft-deleted group
  are byte-identical (`NOT_FOUND: group not found`); a missing target member is
  `NOT_FOUND: member not found`.
- **Ordering.** `group_list_mine` sorts by `lower(name)`, then `name`, then
  `group_id`; `group_get` members break ties by `user_id` after the §4.2 order.
- **Serialization.** Mutating RPCs lock the `groups` row (`for update`) before
  any role check; `group_join` locks it while resolving the code.

## 5. Stream-card metrics and highlights

### 5.1 Performed-set predicate and parsing (SQL mirrors of the canonical TS)

| SQL helper (immutable, internal) | Mirrors |
| --- | --- |
| `group_parse_reps(text) → int` — trimmed, `^\d+$`, `> 0`, else null | `parseSetReps` (`apps/mobile/src/exercise-calculations/index.ts`) |
| `group_parse_weight(text, reps int) → float8` — blank with valid reps → `0`; else trimmed, `^\d*\.?\d*$`, at least one digit, `>= 0`, else null | `canonicalizeWeightForReps` + `parseSetWeight` |
| `group_e1rm(weight float8, reps int) → float8` — Wathan `100·w / (48.8 + 53.8·e^(−0.075·r))`; null when `w <= 0` | `estimateOneRepMax` |

A set is **performed** when all of these hold:

- `exercise_sets.deleted_at is null`;
- its `session_exercise` is not deleted;
- `performance_status is null`;
- both parsers return non-null.

This mirrors `isConfirmedPerformedSet` (`apps/mobile/src/session-recorder/set-semantics.ts`)
and spec 05 Sync v2 #6.

### 5.2 Card values

- **`performed_sets`** — the count of performed sets.
- **`total_volume_kg`** — Σ `weight × reps` over performed sets. Warm-ups are
  included. The value is the entered scalar with no per-side normalization
  (spec 05 Sync v2 #5, #10).
- **`exercise_count`** — non-deleted session exercises with at least one
  performed set.
- **PR highlight.** This mirrors the recorder's `getExerciseCardPersonalRecord`
  (`apps/mobile/app/(tabs)/session-recorder.tsx`), the brainstorm C3.7.2
  default. For each session exercise with a non-null `exercise_definition_id`
  D:
  - **current** is its best-e1RM performed set. Ties go to the lowest
    `order_index`.
  - **history** is the maximum e1RM over the member's performed sets on D in
    their other sessions. Only sessions with status `completed`, non-deleted,
    a non-null `completed_at`, and an earlier `started_at` count. This is the
    member's full history, not only what was shared.
  - **It is a PR iff history exists and current > history.**
  - A session reports at most one PR per D: the best one.
  - For an active session this equals the recorder's live rule, since nothing
    completed can start later. For a past session it means "a PR when logged,
    given current data". Edits to earlier sessions flow through.

### 5.3 Parity vectors

`supabase/tests/fixtures/group-set-metric-vectors.json` holds rows of the form
`{weight_value, reps_value, performance_status, performed, weight, reps,
volume, e1rm}`.

- A jest test asserts that the canonical TS functions produce every vector.
- The `groups-contract` lane asserts that the SQL helpers do (e1RM within
  `1e-9`).
- A semantics change on either side fails until both sides and the vectors
  agree.
- Divergent exotic strings (for example `1e3`, which the UI cannot enter) are
  pinned explicitly in the vectors.

## 6. Mobile client architecture

### 6.1 Module `apps/mobile/src/groups/`

| File | Responsibility |
| --- | --- |
| `types.ts` | Wire types (§4) |
| `api.ts` | One typed wrapper per RPC. It maps PostgREST errors to `GroupApiError { code, message }` by token prefix, and transport failures to `NETWORK`. It is the only code that calls Supabase for groups. |
| `cache.ts` | Read and write for `group_cache`, `evictGroup(groupId)`, and `wipeGroupCache()` |
| `stream-view-model.ts` | Pure presentation: status ("Training now" while `active` — indefinite, C7.2 — or "Completed · 1h 05m"), metric formatting in kg, membership sentences ("X joined", "X left the group", "X was removed" — C7.3), and filter chips |
| `use-group-resource.ts` | A cache-first hook. It refreshes on focus, every 30 s while focused, and on pull-to-refresh, and returns `{ data, lastUpdatedAtMs, refreshing, offline, error, refresh }`. |
| `use-group-action.ts` | Runs one write RPC. It fails fast with the offline message when offline and never queues (C3.10.3). |

**Network state.** The hook reuses the sync scheduler's NetInfo projection
through the existing sync-status accessor (`apps/mobile/src/sync/sync-status.ts`)
on a read-only basis. If no subscription API exists, `src/groups` adds its own
NetInfo hook rather than changing `src/sync`.

**Isolation.** Group code never runs inside the sync cycle, and every group
RPC failure is caught in this module (C3.10.5, AC13).

**As-built (M22-T03).** Public surface is the barrel `@/src/groups`.

- **Network.** `sync-status.ts` exposes only a snapshot getter, so the module
  adds `use-network-online.ts`: its own `NetInfo.addEventListener`, with the
  scheduler's projection rule (online iff `isConnected === true`). It returns
  `null` until the first report, and only `false` counts as offline.
- **`api.ts`.**
  - Functions: `listMyGroups`, `getGroup`, `getGroupStream({ groupId, before,
    limit = 20 })`, `getGroupSessionDetail`, `previewGroupInvite`,
    `createGroup`, `updateGroup`, `getGroupInviteCode`,
    `regenerateGroupInviteCode`, `joinGroup`, `leaveGroup`,
    `removeGroupMember`, `setGroupMemberRole`, `transferGroupOwnership`.
  - `group_stream` always sends all three `p_*` args.
  - Membership writes follow the M22-T01 as-built results: `leaveGroup`
    resolves `{ group_id }`, and `removeGroupMember`, `setGroupMemberRole`,
    and `transferGroupOwnership` resolve the `group_get` payload
    `{ group, members }` (`GroupMemberWriteResult`). Each is shape-checked
    like the reads.
  - Error mapping, in order:
    - a message *prefix* `<TOKEN>` or `<TOKEN>: …` maps to that token, and
      `message` is the text after it;
    - postgrest-js transport failure (`status: 0`) or a thrown call maps to
      `NETWORK`;
    - anything else maps to `INTERNAL`, including an unconfigured client and a
      payload missing its top-level contract keys (fail loud).
- **`use-group-resource.ts`.**
  - It takes `{ userId, cacheKey, fetcher, evictGroupIdOnNotFound? }`.
    Screens pass `useAuth().user?.id`, and a `null` user disables it.
  - It returns `{ data, lastUpdatedAtMs, hydrated, refreshing, offline, error,
    lostAccess, refresh }`.
  - It skips the request while NetInfo reports offline. Concurrent refreshes
    share one request, and a response for a stale `(user, key)` is dropped.
  - `NOT_FOUND` deletes its own key, plus `evictGroup(id)` when an id is
    given.
- **`use-group-action.ts`.**
  - It returns `{ run, pending, error, offline, reset }`.
  - `run` resolves `{ ok: true, value } | { ok: false, error }` and never
    rejects.
  - The offline refusal is `NETWORK` with `GROUP_OFFLINE_ACTION_MESSAGE`.
  - It never touches `group_cache`: callers `refresh()` after a success.
- **View model.** Completed status uses `formatCompactDuration` from the
  session list, so the example renders "Completed · 1h 5m" rather than
  "1h 05m". A completed item with a null `duration_sec` derives it from the
  timestamps, else reads "Completed". Volume is `5,230.5 kg`, with at most two
  decimals.

### 6.2 Local cache — `group_cache` (local-only SQLite)

The schema file is `apps/mobile/src/data/schema/group-cache.ts`, with a Drizzle
migration via `npm run db:generate`.

| Column | Type | Notes |
| --- | --- | --- |
| `cache_key` | `text` PK | `groups:mine`, `group:<id>`, `stream:all`, `stream:<groupId>`, `session:<memberId>:<sessionId>` |
| `user_id` | `text not null` | The account the payload belongs to. Reads require a match with `useAuth().user.id`. |
| `payload_json` | `text not null` | The last successful RPC result |
| `fetched_at_ms` | `integer not null` | Drives "last updated" |

- **Sync impact decision: `out of sync scope`.** It is a disposable cache of
  server-authoritative data. It has no dirty columns, no FKs, and no server
  counterpart, so it is outside the drift checker, like `sync_quarantine`.
- **Stream caches hold the first page only.** Older pages load online.
- **Wiped on sign-out and account switch:** one `delete` is added to
  `wipeLocalTables` (`apps/mobile/src/sync/account-wipe.ts`).
- **Access loss (C3.6.8).** A `NOT_FOUND` on a group evicts `group:<id>`,
  `stream:<id>`, and every `session:*` entry. A successful All refresh replaces
  `stream:all`, which no longer contains that group. The group screen shows
  "You're no longer a member of this group."

**As-built (M22-T03).**

- **Schema and migration.** `apps/mobile/src/data/schema/group-cache.ts`,
  exported from the schema index, with migration
  `apps/mobile/drizzle/0004_optimal_umar.sql` (FK-free, bundled).
- **`src/groups/cache.ts`.**
  - Every function takes the drizzle handle, so it runs on expo-sqlite and on
    the in-memory fixture alike: `readGroupCache`, `writeGroupCache` (an
    upsert on `cache_key` that also replaces the owner),
    `deleteGroupCacheEntry`, `evictGroup`, and `wipeGroupCache`.
  - `groupCacheKeys` builds the keys above.
  - A read for a different `user_id` returns null.
  - A corrupt `payload_json` throws, and the resource hook surfaces it as
    `INTERNAL`.
- **Wipe.** `wipeLocalTables` deletes `group_cache` inside its existing
  transaction.
- **Stream caches.** They hold whatever page the screen's fetcher returns. The
  first-page-only rule is the fetcher's contract, not enforced by the cache.

### 6.3 Routes

| Path | File | Purpose |
| --- | --- | --- |
| `/groups` | `app/(tabs)/groups.tsx` | Groups tab |
| `/group/mine` | `app/group/mine.tsx` | My groups list |
| `/group/new` | `app/group/new.tsx` | Create form (with the username gate) |
| `/group/join?code=` | `app/group/join.tsx` | Join; `boga3://group/join?code=XXXXXXXX` deep-links here, prefilled |
| `/group/[groupId]` | `app/group/[groupId]/index.tsx` | Group screen |
| `/group/[groupId]/edit` | `app/group/[groupId]/edit.tsx` | Edit name and description |
| `/group/[groupId]/invite` | `app/group/[groupId]/invite.tsx` | Invite code with Share and Regenerate |
| `/group-session/[memberId]/[sessionId]` | `app/group-session/[memberId]/[sessionId].tsx` | Friend's session view |

- **Groups tab.** It shows the stream with **All** and per-group chips, header
  actions My groups / Create group / Join group, and the empty, signed-out, and
  offline states.
- **Group screen.** Its header shows name, description, member count, and my
  role. Stream and Members sit behind a segment. Role actions follow §4.3.
- **Friend's session view.** It is read-only and has no edit, delete, or
  append.
- **Tab.** A fourth `TopLevelTabs` button: key `groups`, label "Groups", testID
  `top-level-tab-groups`, mapped in `resolveActiveTab`
  (`app/(tabs)/_layout.tsx`). Its fit is verified on small phones with a
  screenshot (brainstorm C8).
- **Friend's session view** composes `SessionContentLayout` (the layout behind
  View Session) with read-only row renderers. `completed-session/[sessionId].tsx`
  is not modified (C3.8.3).
- **Username gate (C3.1).** The create and join screens load the profile
  (`loadUserProfile`). If the username is blank they show an inline username
  field, call `saveUsername`, then continue. The server enforces
  `USERNAME_REQUIRED` regardless.
- **Share.** React Native core `Share.share({ message })` with the code and the
  `boga3://` link. No native dependency, so no dev-client rebuild.
- **Signed out or unconfigured (C3.2.5).** The Groups tab renders a
  sign-in-required state.
- **Known limitation.** Opening an invite link while signed out goes through
  `/sign-in` and lands on `/`, which drops the code, because the auth guard has
  no return-to. Reopening the link works.

## 7. Freshness and offline

- **Refresh cadence.** On focus, every 30 s while the screen is focused, and on
  pull-to-refresh (`RefreshControl` — new to the app; record it in
  `ui/ux-rules.md`).
- **"Training now" latency** is the athlete's sync latency plus the viewer's
  poll. The athlete side is the scheduler's 1 s write debounce and 60 s
  backstop. Those are constants, not measured end-to-end. The build measures the
  end-to-end value rather than promising a number.
- **Offline marker.** A banner reads "Offline · last updated HH:MM" when the
  device is offline or the last refresh failed with `NETWORK`. The cached data
  stays visible. With no cache, an offline empty state is shown (C3.10.4).
- **Writes are online-only.** Offline attempts show a clear error and change
  nothing (C3.10.3, AC12).

## 8. Test plan

- **Backend lane `groups-contract`** (new; `supabase/tests/groups-contract.sh`;
  slow-backend gate; local Supabase).
  - Setup: it provisions **per-run unique** users (owner, admin, member,
    outsider, joiner) through the existing `auth-provision-user.sh` path, so it
    is hermetic.
  - Coverage:
    - every RPC's success path and every error token;
    - the full role matrix (AC10);
    - share-rule cases: pre-join not shared, post-leave not shared,
      shared-before-leave stays visible, rejoin, an offline session synced
      after joining is not shared, a session synced after leaving is shared;
    - edits and deletes flowing through, and undelete;
    - stream dedupe, order, and pagination;
    - removed-member `NOT_FOUND` (AC11);
    - direct-table denial for every group table (AC9);
    - `AGENT_FORBIDDEN` for a token carrying `client_id`;
    - the metric vectors (§5.3);
    - share-trigger failure isolation: a forced trigger failure still commits
      `sync_push` and writes `group.share_failed`.
- **Existing lanes.** `sync-drift --strict` stays green, which proves ground
  rules 1–2. The sync push, pull, and e2e lanes stay unchanged and green.
- **Jest:**
  - API error mapping;
  - the view model (C7.2 and C7.3 wording);
  - the cache against the in-memory SQLite fixture, including user-id
    isolation and the wipe;
  - the resource hook (focus and poll refresh, offline marker, `NOT_FOUND`
    eviction);
  - screens, with role-gated action visibility, the username gate, the invite
    and share flows, the friend view without owner actions, and the offline
    error on writes (AC12, AC13);
  - TS parity against the vectors.
- **Maestro lane `ios-groups-e2e`** (new; slow-frontend; iOS + local Supabase).
  - Flow `groups-two-user-stream.yaml` runs as device user **`user_c`**. The
    scripted counterparty **`user_d`** is driven from the flow with Maestro
    `runScript` HTTP calls against local Supabase: GoTrue password sign-in,
    `group_join`, and `sync_push` of an active and then completed session.
  - Both fixture users are new and dedicated to this flow (spec 11 fixture
    rule; `scripts/tests/maestro-fixture-users.test.sh` extended). The lane
    runner hard-deletes both users' group rows with the service role before the
    run.
  - Steps:
    1. The username prompt appears.
    2. Create a group.
    3. Read the invite code from the screen.
    4. The counterparty joins, and the device shows the "joined" item.
    5. The counterparty pushes an active session. After a refresh the device
       shows one "Training now" card with its metrics.
    6. The counterparty completes the session, then edits it. The same card
       shows as completed, with its duration and the updated metrics.
    7. Open the friend view and confirm there are no owner actions.
    8. The device removes the counterparty, and the "was removed" item appears.
    9. The script asserts the counterparty's `group_stream` returns
       `NOT_FOUND`.
  - Evidence comes from its screenshots and JUnit output.
- **Offline behaviour (AC12, AC13)** is proven in jest. Simulator network
  cannot be toggled reliably from Maestro.

## 9. Not in M22 (carried forward)

- **Phase 2 live follow** needs either membership-scoped RLS `SELECT` policies
  for Realtime `postgres_changes` or a broadcast channel. That is decided in
  that milestone.
- **Phase 3 links** are member-owned rows the server needs for leaderboards,
  and their sync-scope decision is made there. They may not use a local FK to a
  group exercise (spec 05 local integrity rule 2).
- **Phase 5 certification** pins the attested set value in its own row. The
  read-through model does not change.
