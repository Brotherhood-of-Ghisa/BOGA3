# Groups Contract

> **Status: As-built (M22 and M25 shipped).**
>
> - §2–§5, the server half: the membership/invite RPCs (M22-T01,
>   `supabase/migrations/20260910120000_m22_groups_membership.sql`) and the
>   share ledger, trigger, and stream/detail reads (M22-T02,
>   `supabase/migrations/20260911120000_m22_group_record.sql`). Both are proven
>   by `./boga test groups-contract`.
> - §6.1–§6.2, the mobile client (M22-T03).
> - §6.3/§7, the read-side UI: the Groups tab, My groups, the group screen, and
>   the friend's session view (M22-T04).
> - §6.3/§7, the write UI: create, edit, join (deep link), invite, member
>   actions, leave, and the username gate (M22-T05).
> - §8, the two-user Maestro lane `ios-groups-e2e` (M22-T06).
> - Post-M22: group reads return raw set rows, card metrics are computed on
>   the viewing device, and PR highlights are deferred (§4.2, §5, §9;
>   `supabase/migrations/20260912120000_m22_group_raw_sets.sql`).
> - M25-T02: the stream is persistent. `group_events` holds one row per
>   stream item and `group_stream` reads only that table; the wire contract
>   is unchanged (§2.6, §4.2;
>   `supabase/migrations/20260913153000_m25_group_events.sql`).
> - M25 step 2, group exercises (M25-T01): the `group_exercises` table and its
>   RPCs (§2.7, §4.4;
>   `supabase/migrations/20260913160000_m25_group_exercises.sql`), proven by
>   `./boga test groups-contract`, and the client wrappers plus the shared
>   `ExerciseCore` validator (§6.1).
> - M25 step 2, the evaluator pipeline (M25-T04): the queue, the enqueue
>   triggers, the set facts, the `group-eval` Edge Function, and the pg_net
>   kick with its pg_cron sweep (§2.8–§2.10;
>   `supabase/migrations/20260913180000_m25_group_eval.sql`), proven by
>   `./boga test groups-leaderboards`.
> - M25-T08, the group page: Stream · Exercises · Leaderboards, Members behind
>   the header's member count, and the Exercises page with owner/admin add,
>   copy, rename, and archive (§6.2 `group-exercises:<groupId>`, §6.3, §8).
> - M25 step 2, boards and events (M25-T05): the apply recomputes and diffs
>   `group_board_entries`, writes `record`, `record_voided`, `link`/`unlink`,
>   and `lead_change` events, and serves the board and history reads; the
>   stream returns the new kinds (§2.6, §2.10, §2.11, §4.2, §4.5;
>   `supabase/migrations/20260914120000_m25_group_boards.sql`), proven by the
>   `groups-boards.sh` body of `./boga test groups-leaderboards`.
> - M25 step 2, certification (M25-T06): `group_certifications`, the certify /
>   withdraw / cancel RPCs, evaluator voids on a fingerprint mismatch,
>   Certified entries and `lead_change{certification}`, and `certified` on
>   the board and stream reads (§2.11, §2.12, §4.2, §4.5, §4.6;
>   `supabase/migrations/20260916120000_m25_group_certification.sql`), proven
>   by the `groups-certification.sh` body of `./boga test groups-leaderboards`.
>
> - M25-T11: the two-user Maestro lane certifies a record set on device and
>   asserts the Certified boards (§8), and M25 closed. Its product rules and
>   decisions (P#, D#, E#, cited throughout) are §10.
> - Post-M25 groups UI iteration: the Groups screen shows one group at a
>   time (no All) with Stream · Leaderboards, the group page is management
>   only (header + Exercises), Join / Create moved to My groups, and Today's
>   Group activity includes record cards (§6.3 "As-built (groups UI
>   iteration)"; P5 and D10 amended in §10).
>
> This doc owns the technical contract and is the durable record of what M22
> and M25 built. The M22 milestone spec (product requirements and acceptance
> criteria) was deleted after shipping; git history and PR #280 keep it. The
> M25 milestone, product spec, and technical design were deleted by M25-T11;
> their durable rules are §10 and the as-built sections, and git history keeps
> the narrative.

This doc covers:

- the group domain server schema;
- the rule that shares a session into a group;
- the group RPC wire contract;
- the stream-card metric semantics;
- the mobile group client architecture.

It is not the source for these:

| Topic | Source |
| --- | --- |
| Product requirements and acceptance | M22: the milestone spec (git history). M25: §10 here; the sketches are in git history |
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

The **group stream** (M25) is persistent: `app_public.group_events` has one
row per stream item, written once when the item happens and never deleted
by the app (§2.6). A `session` item marks that a session was shared into a
group. The card's content, position (`started_at`), and visibility are still
read live from the member's rows, so #17 and #18 hold unchanged. Membership
items are written with the membership change. Later item kinds (records,
voids, links) are added to the same table, so there is no read-time merge.

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
| An Edge Function group API (the M21 pattern) to reuse the TS calc module | It adds a deploy surface and a service-role boundary where authorization lives in app code. SQL RPCs keep authorization in the database (spec 10 rule 2). The TS calc module is reused on the viewing device instead (§5). |

## 2. Server schema (`app_public`)

Ground rules for every group table:

1. **No column named `owner_user_id`.** The drift checker derives Sync v2
   entity tables as "every `app_public` table with `owner_user_id`" (contract
   §A.7.3), so such a column would be misread as an unsynced entity. Group
   tables use `user_id`, `member_user_id`, and `created_by` instead.
2. **No FK into the Sync v2 tables.** This keeps the §A.7.7 topological
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

**As-built (M22-T02, §2.4–§2.5).** `supabase/migrations/20260911120000_m22_group_record.sql`.

- **Ledger.** `group_session_shares` has the columns, PK, and two indexes of
  §2.4. It follows ground rules 1–4: RLS on, no policies, no `anon` or
  `authenticated` privileges, and `service_role` keeps
  `select/insert/update/delete`. No other index was added.
- **Trigger.** It is `sessions_group_share_session`, declared `AFTER INSERT OR
  UPDATE … FOR EACH ROW` and calling `app_public.group_share_session()`
  (`security definer`, `search_path = app_public, pg_temp`). The insert is the
  §2.5 statement verbatim. `sync_push`'s LWW no-op, where the incoming row is
  not newer, does not update the row, so the trigger does not fire. Self-heal
  therefore happens on the session's next *accepted* write.
- **Failure isolation.** The whole insert runs in a nested `begin … exception
  when others`. On failure it writes one `public.app_logs` row: `level
  'error'`, `source 'database'`, `event 'group.share_failed'`, a fixed
  `message`, `user_id` = the session owner, and `context = {session_id,
  sqlstate}`. `SQLERRM` is never logged, because constraint errors echo row
  values. If that log insert itself fails, a second handler emits `raise
  warning` to the server log. The trigger returns normally in every case.
- **Proven** by `groups-contract` through real `sync_push` calls. A temporary
  `check (false) not valid` constraint on the ledger forces the failure, and
  the lane's exit trap always drops it. Under that fault, `sync_push` returns
  200 and the owner reads the row. Exactly one sanitized row is logged
  (`sqlstate` `23514`), and the next push creates the share.

### 2.6 `group_events` — the stream (M25)

Each stream item is one row. It is written once, when the item happens, and
the app never deletes it. It follows ground rules 1–5: RLS on, no policies,
no `anon` or `authenticated` privileges, and `service_role` keeps
`select/insert/update/delete`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `group_id` | `uuid not null` → `groups(id) on delete cascade` | |
| `kind` | `text not null` | CHECK `in ('session','joined','left','removed','record','record_voided','link','unlink','lead_change')`. The evaluator writes the last five (M25-T05, §2.11); `lead_change` rows are board history, never stream items. |
| `member_user_id` | `uuid not null` → `auth.users(id) on delete cascade` | The athlete (`session`) or the member (membership kinds) |
| `actor_user_id` | `uuid null` → `auth.users(id) on delete set null` | `removed`: the remover. Null for the other current kinds. |
| `session_id` | `text null` | `session`: `sessions.id` in the member's keyspace (no FK, rule 2) |
| `membership_id` | `uuid null` → `group_memberships(id) on delete cascade` | Membership kinds: the period, whose id prefixes the item key |
| `sort_at_ms` | `bigint not null` | Membership kinds: `floor(epoch_ms(joined_at \| ended_at))`. `session`: a copy of `sessions.started_at` that the session trigger keeps current. The read uses the live value (§4.2). |
| `occurred_at` | `timestamptz not null default now()` | When the item happened. The backfill uses `shared_at`, `joined_at`, or `ended_at`. |

Shape CHECKs: a `session` row has `session_id` and no `membership_id` or
actor. A membership row has `membership_id` and no `session_id`, and only
`removed` has an actor.

Indexes:

- unique `(group_id, member_user_id, session_id) where kind = 'session'`;
- unique `(membership_id) where kind = 'joined'`;
- unique `(membership_id) where kind in ('left','removed')`;
- `(group_id, sort_at_ms desc, kind)`: a group's items by stored position.
  It serves membership items and the M25-T05 kinds. Session items sort by the
  live `started_at`, so `group_stream` still builds every in-scope item
  before ordering, as M22 did;
- `(member_user_id, session_id) where kind = 'session'` for the session trigger.

**Writers.**

- **`session`.** The trigger `sessions_group_stream_event` runs `AFTER INSERT
  OR UPDATE … FOR EACH ROW` on `app_public.sessions` and calls
  `group_event_session()` (`security definer`, pinned `search_path`).
  - Same-event triggers fire in name order, so it runs after
    `sessions_group_share_session` and sees the shares that write created.
  - It inserts one item per ledger row for `(owner, session)` `on conflict do
    nothing`, then moves the items' `sort_at_ms` when `started_at` changed.
  - It reads the ledger rather than "this write created a share". A missed
    item is therefore created on the session's next accepted write, like the
    share itself (§2.5 self-heal).
  - **Failure isolation** follows the §2.5 pattern. On failure it writes one
    `public.app_logs` row (`event 'group.event_failed'`, a fixed `message`,
    `context = {session_id, sqlstate}`, never `SQLERRM`), falls back to
    `raise warning`, and always returns normally. The §2.5 share trigger is
    unchanged, and an event failure never rolls back a share.
- **`joined` / `left` / `removed`.** The trigger
  `group_memberships_stream_event` runs `AFTER INSERT OR UPDATE OF ended_at`
  and calls `group_event_membership()`.
  - An inserted period (`group_create`, `group_join`) writes `joined`.
  - Ending a period (`group_leave`, `group_remove_member`) writes `left` or
    `removed`; `removed` carries `ended_by` as the actor.
  - It is not failure-isolated: the item commits or fails with the
    membership change.
  - Role changes, ownership transfers, and a no-op join write nothing.
  - The item's position is fixed when it is written. That is correct
    because no RPC edits `joined_at`, and an ended period is never reopened
    or re-ended. A future writer that changes those columns must also move
    the item.
- **Backfill.** `group_events_backfill()` is internal, idempotent, and returns
  the rows inserted. It writes one `session` item per share row, at the live
  `started_at` (else the ledger copy), and one `joined` plus, for an ended
  period, one `left`/`removed` per membership period. The migration runs it
  once.
- **Repair for `group.event_failed`.** The next accepted write of the session
  heals a missed item. Until then the share exists but the stream hides the
  card, and `group_session_detail` still opens it. A write that fails on a
  session's last write, for example its completion, is never healed by a later
  write. For every `group.event_failed` row, run
  `select app_public.group_events_backfill();` as the service role or
  `postgres`. It is idempotent and inserts only the missing items. The §2.5
  share trigger has the same next-write limit, and there the share itself is
  missing.

### 2.7 `group_exercises` — the group's exercise catalogue (M25-T01)

A group exercise is a comparison identity: members log their own exercises and
link them to it. It holds only the fields it shares with a personal exercise,
the `ExerciseCore` `{ name, loadInputMode }`, plus the standard exercise it was
copied from. Personal exercises stay the Sync v2 `exercise_definitions`; the
two stores share one TS type and validator (M25 design decision T1).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `group_exercise_id` on the wire |
| `group_id` | `uuid not null` → `groups(id) on delete cascade` | |
| `name` | `text not null` | Non-empty and JS-trimmed (`String#trim`) |
| `load_input_mode` | `text not null` | `in ('total_load','per_side_load')` |
| `source_exercise_id` | `text null` | The standard seed id it was copied from (e.g. `seed_barbell_bench_press`). Null for a custom exercise. Trimmed, 1–100 characters. No FK (rule 2). |
| `archived_at` | `timestamptz null` | Null means active. Archived keeps its links and a read-only board and is not offered for new links (D8). |
| `created_by` | `uuid null` → `auth.users(id) on delete set null` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

**As-built (M25-T01).** `supabase/migrations/20260913160000_m25_group_exercises.sql`.

- It follows ground rules 1–5. Index `(group_id)`. `service_role` keeps
  `select/insert/update/delete`.
- **Trim parity.** Postgres `btrim` strips spaces only. The name CHECK and the
  RPCs therefore use `group_exercise_trim`, a regex over the ECMAScript
  WhiteSpace + LineTerminator set, which is exactly what `String#trim` strips.
  The shared vectors `apps/mobile/src/exercise-core/exercise-core-vectors.json`
  run in jest against `validateExerciseCore` and in `groups-contract` against
  `group_exercise_create` and the CHECKs, so device and server cannot drift.
- **No length cap on `name` and no uniqueness**, like `exercise_definitions`.
  The same standard exercise can be copied twice, and two group exercises may
  share a name.

### 2.8 `group_eval_queue` — evaluator work (M25-T04)

Every change that can move a board reaches this queue. One row is one pending
unit of work, coalesced on its natural key. It follows ground rules 1–5.

| Kind | Key (partial unique index) | Work |
| --- | --- | --- |
| `session` | `(member_user_id, session_id)` | Re-normalize the session's sets into facts, then re-apply its live targets |
| `target` | `(member_user_id, group_id, group_exercise_id)` | Re-apply one board target; no re-normalization |

| Column | Notes |
| --- | --- |
| `id` | `bigint` identity |
| `member_user_id` | → `auth.users on delete cascade` |
| `group_id`, `group_exercise_id` | Target jobs only; → `groups` / `group_exercises` `on delete cascade` |
| `causes` | `text[]`, the union of `set`, `link`, `load_mode`, `rules`, and (M25-T06) `certification`. T05 reads it: `{rules}` alone is a silent recompute (§2.11). |
| `generation` | Bumped by every re-enqueue. `group_eval_complete` deletes a job only if it is unchanged since the claim. |
| `attempts`, `available_at`, `last_sqlstate` | Failure backoff: 2 s, 4 s, … capped at 5 min |
| `claimed_until` | A 2-minute lease |

A re-enqueue merges `causes`, bumps `generation`, and makes the job available
now. The job is never dropped: a failure only delays it.

### 2.9 `group_set_facts` — normalized sets (M25-T04)

One row per set of every **shared** session, keyed `(member_user_id,
set_id)`. It follows ground rules 1–5: no FK into the Sync v2 rows, so
consumers inner-join the live rows and a fact left by a hard delete is
invisible.

| Column | Notes |
| --- | --- |
| `session_id`, `session_exercise_id`, `exercise_definition_id` | Where the set was logged. A null exercise id never counts. |
| `exercise_order_index`, `set_order_index` | Tie-break order after `achieved_at_ms` (P7) |
| `performed` | The session screens' rule (§5), run in TS by the evaluator |
| `live` | Set, exercise, and session all untombstoned |
| `weight_kg`, `reps`, `e1rm_kg` | Null unless performed. They are in the member's **entered** load mode; conversion to the group exercise's mode is SQL (M25-T05, D6). `e1rm_kg` is Wathan (`estimateOneRepMax`), null at 0 kg. `reps` is `numeric` so that any value the TS parser accepts can be stored; no client text can fail a job on every retry. |
| `achieved_at_ms` | `sessions.started_at` |
| `fingerprint` | `group_set_fingerprint(weight_value, reps_value, performance_status, deleted_at)`: md5 over the raw values. It interprets nothing, so certification (M25-T06) can compare a live row without the evaluator. |
| `rules_version` | `GROUP_EVAL_RULES_VERSION` of the TS that wrote it |

Facts cover every set of a shared session, linked or not, so a new link is
a target re-apply with no re-normalization (P4).

### 2.10 The evaluator (M25-T04)

`supabase/migrations/20260913180000_m25_group_eval.sql`,
`supabase/functions/group-eval/`, `apps/mobile/src/groups/set-facts.ts`.

**Enqueue triggers.** Each follows the §2.5 isolation pattern. The enqueue
runs in its own `begin … exception` block. A failure writes one
`group.eval_enqueue_failed` row with `context = {table, row_id, sqlstate}`
and never `SQLERRM`, and the trigger returns normally. `sync_push` always
commits.

| Trigger | Fires | Enqueues |
| --- | --- | --- |
| `sessions_group_z_eval_enqueue` | `AFTER INSERT OR UPDATE`; `z_` sorts it after the share and stream triggers | a session job, if a share row exists |
| `session_exercises_group_eval_enqueue` | `AFTER INSERT OR UPDATE` | the session job (and the old session's, if moved), if shared |
| `exercise_sets_group_eval_enqueue` | `AFTER INSERT OR UPDATE` | the session job through its session exercise, if shared |
| `exercise_definitions_group_eval_enqueue` | `AFTER UPDATE OF load_input_mode`, when changed | a target job per live link (`load_mode`) |
| `exercise_group_links_group_eval_enqueue` | `AFTER INSERT OR UPDATE` | target jobs for the new and, if moved, the old target (`link`) |

- **Inert link values.** Link `group_id` / `group_exercise_id` are plain text
  (sync §A.2.10) and pass through `group_eval_try_uuid`. A target job is
  written only when the group exercise exists in that group. A non-uuid,
  unknown, or foreign target is therefore skipped silently: no job and no
  failure row.
- **No `DELETE` triggers.** Hard deletes (`dev_wipe_my_data`, account
  deletion) leave facts that consumers never see. The session's next
  evaluation drops facts for sets that vanished.
- **The evaluator reads links and never writes them.** A server-written row
  that breaks the id form would stall the member's pull (sync §A.2.10). The
  lane asserts that only `sync_push` and `dev_wipe_my_data` write the table.

**Invocation.**

- **Kick.** After an enqueue, `group_eval_kick_once` sends at most one
  `net.http_post` per transaction, flagged by the transaction-local setting
  `app.group_eval_kicked`. The flag is set outside the kick's own isolated
  block, so a kick that raises is attempted and logged
  (`group.eval_kick_failed`) once per push, not once per row, and never rolls
  back the queued work. pg_net sends
  after commit, so a rolled-back push sends nothing.
- **Sweep.** The pg_cron job `group-eval-sweep` runs `select
  app_public.group_eval_sweep()` every `30 seconds`. It kicks once when
  claimable work exists: never claimed, lease expired, or backoff elapsed.
- **Configuration.** Both values live in Vault. `group_eval_secret` is
  generated by the migration. `group_eval_url` is set with
  `app_public.group_eval_set_url(url)`: locally by
  `supabase/scripts/group-eval-configure.sh`, which the shared baseline runs
  (`http://kong:8000/functions/v1/group-eval`), and on a hosted project per
  `RUNBOOK.md`. An unset URL means no kick; the queue waits.

**`group-eval`.** `verify_jwt = false`, because its caller is Postgres. It
returns 405 for anything but `POST` and 401 unless `x-group-eval-secret`
matches `group_eval_check_secret`. It reaches Postgres with the injected
service-role key, a service-role boundary with no client API. One drain:

1. `group_eval_requeue_rules(GROUP_EVAL_RULES_VERSION, 50)` re-queues, with
   cause `rules`, sessions whose facts are older. Rules changes are silent
   recomputes.
2. Up to 10 rounds of `group_eval_claim(20)` (`for update skip locked`, sets
   the lease).
3. For a session job, `group_eval_session_rows` returns every set row raw,
   with `live` and `fingerprint` in one snapshot. `normalizeGroupSetFacts`
   (TS) returns the facts.
4. `group_eval_complete(job, generation, facts)`:
   - if the generation moved since the claim, the facts are a stale
     snapshot: it releases the job without writing anything;
   - otherwise it replaces the session's facts, resolves live targets, calls
     `group_eval_apply` per target, and deletes the job.

   On any error, `group_eval_fail(job, sqlstate)` applies the backoff and
   writes one `group.eval_failed` row with `context = {job_id, kind,
   sqlstate}`, or `EVALX` for a non-database error. The rest of the drain
   continues.

The reply is `{ rules_version, rules_requeued, claimed, completed, requeued,
failed, jobs[] }`, each job carrying its `outcome` and live `targets`.

**Live targets** (`group_eval_target_is_live`,
`group_eval_session_targets`):

- **Session job.** Every group holding a share of the session × every live
  link of the member into that group from an exercise in the session. The
  exercises are taken before and after this evaluation, so a changed
  exercise re-applies the target it left.
- **Target job.** The target itself. Unlink and retarget therefore re-apply
  the board the link left.
- **A target is live only if** the member is currently active in a
  non-deleted group (P4, P7) and the group exercise belongs to that group and
  is not archived. Archived boards are frozen (D8). That also keeps a link
  written after the archive from applying; after unarchive, every link
  counts.

**Apply (M25-T05).** `group_eval_apply(group, member, group_exercise,
causes)` recomputes the target's board entries from facts, diffs them, and
writes events (§2.11). T04 shipped it as a no-op seam.

**Catch-up enqueues (M25-T05).** Both use the §2.10 isolation pattern
(`group_board_enqueue_links`: one `group.eval_enqueue_failed` row on
failure, never raises) and cause `link`:

- `group_exercise_unarchive`, when it actually unarchives, queues a target
  job for every live link into the exercise and every target with board
  state there;
- the trigger `group_memberships_board_catch_up` (`AFTER INSERT` on
  `group_memberships`) does the same for the new member in that group, so a
  rejoin applies link changes and edits made while away. It is not named
  `*group*eval_enqueue`, which is the five Sync v2 triggers.

Archive and leave queue nothing: the board freezes.

**Posture.**

- Every function pins `search_path = app_public, pg_temp`.
- `service_role` executes only `group_eval_check_secret`, `_claim`,
  `_session_rows`, `_complete`, `_fail`, and `_requeue_rules`. `anon` and
  `authenticated` execute none. Everything else is owner-only: the triggers,
  enqueue, kick, sweep, config, targets, apply, and fingerprint.

**One implementation of the set rules.** `set-facts.ts` holds
`parseGroupPerformedSet`. The device's `toGroupPerformedSet` (§5) delegates
to it, so card metrics and facts cannot diverge. The file imports nothing
through `@/`, and its imports name their `.ts` files. The mobile tsconfig
sets `allowImportingTsExtensions` so Deno loads it by relative path, as
`agent-api` loads `exercise-calculations`.

**Repair.**

- `group.eval_enqueue_failed`: the member's next accepted write of that
  session or link re-enqueues it.
- `group.eval_kick_failed` and missed kicks: the sweep covers them.
- `group.eval_failed`: the job retries with backoff. Check
  `group_eval_queue.last_sqlstate` for poison jobs.
- Manual drain: `select app_public.group_eval_kick();`.

### 2.11 Boards and board events (M25-T05)

`supabase/migrations/20260914120000_m25_group_boards.sql`. Design decisions
T6–T8. Both tables follow ground rules 1–5.

**`group_board_entries`**: PK `(group_exercise_id, member_user_id, metric,
certified)`, plus `group_id`. `metric` is `weight` or `e1rm`. The
`certified = true` rows are the Certified boards (M25-T06, below). Each row
holds the member's best counting set for that board:

- `value_kg`: the ranked value, a `numeric` rounded to 6 places with trailing
  zeros trimmed, so comparisons and cursors are exact;
- `weight_kg`, `e1rm_kg` (converted), `reps`, `entered_weight_kg` (as
  logged), `load_factor` (`0.5 | 1 | 2`);
- the winning fact's `set_id`, `session_id`, `session_exercise_id`,
  `exercise_definition_id`, `achieved_at_ms`, orders, and `fingerprint`.

Index `(group_exercise_id, metric, certified, value_kg desc, achieved_at_ms,
member_user_id)` is the rank order.

**`group_board_state`**: PK `(group_exercise_id, member_user_id)`. It holds
`linked_definition_ids`, the member's live linked exercises at the last
apply, for link attribution, and (M25-T06) `certification_ids`, the target's
active certification ids at the last apply, for certification attribution.

**Rules.**

- **Counting set** of `(G, M, GX)`: a performed, live fact whose Sync v2
  set row still exists, whose session is shared into G, and whose exercise
  has a live link to `(G, GX)`. The Weight board needs `weight_kg > 0`
  (a 0 kg set is not weight lifted; bodyweight metrics are out of scope);
  the e1RM board needs a non-null `e1rm_kg`.
- **Conversion (D6).** The factor compares the member's exercise's current
  `load_input_mode` with the group exercise's: the same mode gives 1, per
  side → total gives 2, total → per side gives 0.5. It applies to weight and
  e1RM, and record detection uses converted values.
- **A member's best**: highest `value_kg`, then the earlier `achieved_at_ms`,
  `exercise_order_index`, `set_order_index`, `set_id` (P7).
- **Rank**: `value_kg desc, achieved_at_ms asc, member_user_id asc`, strict
  1..n. Former members keep their entries, are ranked, and read `former`
  (P7); their targets are not live, so the entries freeze. Archived boards
  freeze the same way (D8).

**The apply** (`group_eval_apply`), per target, in order:

1. `pg_advisory_xact_lock(25005, hashtext(group_id))` serializes every apply
   in a group. A session job applies targets in `group_id` order, so locks
   are taken in one order.
2. Snapshot the old All entries, old #1 and rank per board, and
   `prev_links`; recompute the new entries and `cur_links`.
3. **Provisional records (T8).** A record is provisional while its session
   row has `status = 'active'` (tombstoned or not).
   - One whose set still counts and still beats `previous_value_kg` on a
     listed board is updated in place: values, fingerprint, the boards it
     still beats (each keeping its `previous_value_kg`), `group_record`, and
     the leader snapshot of its lead changes.
   - Otherwise it is deleted with its `lead_change` rows, and no void is
     written. The boards it listed fall back to its `previous_value_kg` as
     the baseline for record detection (step 5), so a real PR logged after a
     typo in the same session still becomes a record.
   - Either way, a `lead_change` it caused is deleted once the member no
     longer leads that board at the corrected value.

   These are the only deletes of stream rows.
4. **Voids.** A final record is voided when its lift no longer stands:
   - fact missing or not live: `record_voided{deleted}`;
   - not performed, or a listed board's converted value changed (a weight
     or reps edit, or a load-mode change): `record_voided{edited}`.

   An edit that leaves every listed value unchanged (a whitespace edit, a
   status equivalent to performed) voids nothing; since M25-T06 it refreshes
   the record's `payload.fingerprint`, so certification matches the set as
   it now is. Unlinking never voids:
   the lift happened.
5. **Attribution, per All metric**, old winner O vs new winner N:
   - N's exercise is not in `prev_links`, and N's set was created
     (`exercise_sets.created_at`) before its link's `updated_at`: **link**.
     A set logged after linking counts as logging, so a whole session pushed
     together with its link still gets records;
   - O's exercise is not in `cur_links`: **unlink**;
   - N beats the baseline, or there is none (D1): **record**. The baseline
     is O's value, or the `previous_value_kg` of a provisional record
     retracted in step 3;
   - otherwise the entry fell or vanished: **void** fallback.
6. Write the entries and the state, then the events:
   - the voids, with each voided board's current leader;
   - one `record` per new-best set, listing the boards it beat, with
     `previous_value_kg` (the baseline) and `group_record` (the member is #1
     after the apply).
     - A replacement for a record voided in this apply also lists that
       record's boards that the set still holds at the same value, with
       their original `previous_value_kg`. A reps-only edit therefore keeps
       the Weight card.
     - A surviving provisional record of the same set absorbs the board
       instead, keeping each listed board's `previous_value_kg`;
   - one `link` item if any link effect occurred, and one `unlink` item if
     any unlink effect occurred, with `effects` per metric. A link that
     moves no entry writes nothing, and link effects never write a `record`
     (P16);
   - one `lead_change` per All board whose #1 member moved. "Before" is the
     old #1, or, when step 3 deleted the board's latest lead change, that
     row's `previous`. Its `reason` is `record`, `void`, or `link`, and it
     points at the causing event (`related_event_id`, when one exists).
7. `causes = {rules}` exactly is a silent recompute: entries and state only.

**Certified boards (M25-T06).** The same apply, under the same lock, also:

0. snapshots each Certified board's #1 from the stored entries
   (`group_board_certified_leader`), before anything else changes. Another
   member's entry whose certification has ended is still counted while their
   target is live (their own apply writes that lead change, exactly once),
   and skipped when their target is frozen (a former member), whose apply
   never runs;
1. **voids** (`end_reason = 'voided'`, `ended_by` null) every active
   certification of the target whose set no longer stands as pinned: its
   fact is missing or not `live` (a set or session tombstone), its Sync v2
   row is gone, or `fact.fingerprint <> pinned_fingerprint` (an edit of
   weight, reps, or status). Undelete never revives one. Unlink, retarget,
   and a load-mode change void nothing: the certification stops or keeps
   counting with its set;
2. recomputes the member's `certified = true` entries with the All rules,
   restricted to counting sets holding one of the active certifications read
   after step 1 (the ids written to `certification_ids`), pinned to the
   fact's fingerprint;
3. writes one `lead_change` with `certified = true` per Certified board whose
   #1 member moved. `reason` is `certification` when the target's active
   certification ids differ from `group_board_state.certification_ids`
   (given, ended, or voided in step 1), with `payload.certification_id`
   naming the certification that moved it (M's new entry's when M took #1,
   else the one on M's old entry's set) and no `related_event_id`.
   Otherwise it takes the All attribution for that metric (`link` or `void`,
   pointing at that event; `record` with no `related_event_id`, so step 3's
   provisional retraction only ever touches All history), falling back to
   `certification`.

Steps 0–2 and the state run in silent applies too; step 3 does not.

**Valid Certified entry (reads).** A `certified = true` entry counts in the
reads only while an active certification on `(GX, M, set)` is pinned to the
entry's fingerprint. Withdraw and cancel therefore leave the Certified
reads at once, before any apply.

**`group_events` columns added.** `seq` (identity, unique: the history
order), `group_exercise_id`, `set_id`, `metric`, `certified`, `reason`,
`related_event_id` (→ `group_events`, `on delete cascade`), and `payload`.
Each kind has a shape CHECK, and the step-1 kinds carry none of the new
columns. Indexes: one `record_voided` per record, the target's records, a
board's history, and `related_event_id`.

| Kind | `sort_at_ms` | `payload` |
| --- | --- | --- |
| `record` | the session's `started_at` when written | `{ boards: [{ metric, value_kg, previous_value_kg, group_record }], weight_kg, reps, e1rm_kg, entered_weight_kg, load_factor, fingerprint, achieved_at_ms, session_exercise_id, exercise_definition_id }` |
| `record_voided` | when written | `{ record: { weight_kg, reps, e1rm_kg }, leaders: [{ metric, leader: Holder\|null }] }` |
| `link`, `unlink` | when written | `{ exercise_definition_ids, effects: [{ metric, before: { rank, value_kg }\|null, after: … }] }` |
| `lead_change` | when written | `{ leader: Holder\|null, previous: Holder\|null }`; `member_user_id` is the member whose change caused it, and a null `leader` means the board emptied |

`Holder = { member_user_id, value_kg, weight_kg, reps, e1rm_kg,
achieved_at_ms, set_id, session_id }`.

**Posture.** `group_eval_apply` and every `group_board_*` helper are
owner-only (no `service_role` either). The three reads (§4.5) are the only
client surface.

**Known limits.**

- A silent rules recompute can move #1 without a history row.
- A soft-deleted exercise's link still counts on the boards. The T07 client
  never offers such an exercise for linking.
- A retracted provisional lead change rolls "before" back only when it was
  the board's latest history row. An older one leaves a later row's
  `previous` naming the retracted holder.
- Link attribution compares client clocks: the set's `created_at` and the
  link's `updated_at`. Skew between two devices can turn a link effect into
  a record, or the reverse.
- **Frozen Certified boards (M25-T06).** A former lifter's or archived
  exercise's target never applies. A certification ended there leaves the
  reads at once, but the member's next-best certified set is not promoted,
  no `lead_change` is written, and a set edited while frozen is not voided,
  until a catch-up (rejoin, unarchive) re-applies the target. The stored
  entry stays until then. Other members' applies skip it (step 0), so their
  lead changes are still written; on a rejoin, the returning member's own
  apply can then write a second lead change for the same move.
- A withdraw or cancel racing a void of the same certification can deadlock
  with the apply; Postgres aborts one side. If the RPC's enqueue is the
  victim, it logs a `group.eval_enqueue_failed` row and the state still
  converges (the apply's job re-applies the target).
- A Certified board can move with no certification change (a load-mode
  rescale); that lead change takes the All attribution, or `certification`
  when the All board didn't change.
- There is no `group_board_state` backfill. The first apply of a target
  without state treats every counting set from before its link as a link
  effect, which is correct while M25 has no live boards.

### 2.12 `group_certifications` (M25-T06)

`supabase/migrations/20260916120000_m25_group_certification.sql`. Product
P10–P13, D3–D5. It follows ground rules 1–5.

| Column | Notes |
| --- | --- |
| `id` | `uuid` PK, `certification_id` on the wire |
| `group_id` | → `groups` `on delete cascade` |
| `group_exercise_id` | → `group_exercises` `on delete cascade`: the board target the set was a record set of |
| `member_user_id` | The lifter. → `auth.users` `on delete cascade` |
| `set_id`, `session_id` | In the lifter's keyspace (no FK, rule 2) |
| `certified_by` | → `auth.users` `on delete set null`. CHECK it is not the lifter. |
| `pinned_fingerprint` | `group_set_fingerprint` of the live set row at certify time (§2.9) |
| `pinned_weight_value`, `pinned_reps_value`, `pinned_performance_status` | The raw synced values it attested |
| `weight_kg`, `reps`, `e1rm_kg` | The converted values the certifier was shown (the record set's entry or record payload) |
| `certified_at` | |
| `ended_at`, `end_reason`, `ended_by` | `end_reason in ('withdrawn','cancelled','voided')`; `ended_at` and `end_reason` null together; `ended_at >= certified_at`; `ended_by` (→ `auth.users on delete set null`) only on a withdrawn or cancelled row |

- Unique `(group_exercise_id, member_user_id, set_id) where ended_at is
  null`: one active certification per set per board target (one is enough,
  P10). Index `(group_id)`.
- An ended row is never reopened; certifying again inserts a new row (D4).
- **Writers.** The §4.6 RPCs (insert, withdraw, cancel) and the apply's voids
  (§2.11). No trigger on a Sync v2 table: `sync_push` is untouched.
- **Enqueue.** Every RPC insert or end calls `group_certification_enqueue`: a
  target job (cause `certification`) for the lifter's board, then
  `group_eval_kick_once`. The enqueue runs in its own `begin … exception`
  block; a failure writes one `group.eval_enqueue_failed` row with `context
  = {table: 'group_certifications', row_id, sqlstate}` and the certification
  still commits. Repair: any later job for the target (a push, a link, another
  certification) recomputes the Certified entries, and the reads never count
  an ended certification meanwhile.
- **Posture.** The `group_certification_*` helpers and `group_board_compute`
  have no grant at all; only the three RPCs are client-callable.

## 3. Authorization model

- **No direct table access.** The group tables have RLS enabled, no permissive
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
| `VALIDATION` | Bad input (name/description bounds, `p_limit`, cursor shape, role value, target is self; an exercise name, load mode, or source id; editing an archived exercise) |
| `USERNAME_REQUIRED` | Create or join without a non-blank username |
| `INVITE_INVALID` | Unknown or regenerated code, or the group is deleted |
| `OWNER_MUST_TRANSFER` | The owner tried to leave |
| `CONFLICT` | (M25-T06) The state moved on since the caller saw it: certifying a set edited or deleted ahead of the evaluator. Refresh and retry. |

Client-only codes: `NETWORK` for transport failure, and `INTERNAL` for
anything unrecognized. The mobile client maps every token above, `CONFLICT`
included (M25-T10).

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
  "exercises": [ /* SessionExercise, as in SessionDetail below */ ] }
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
order_index, sets: [{ set_id, order_index, weight_value, reps_value, set_type,
performance_status }] }] }`.

- Exercises and sets are in `order_index` order.
- **Every live set, raw.** Tombstoned exercises and sets are omitted. Every
  other set is returned as synced (`weight_value` and `reps_value` text,
  `performance_status`), planned, skipped, and blank ones included. The
  viewing device decides what is performed (§5), so "performed sets only"
  (A4.2) is a display rule, not a server filter.
- `name` is the member's own exercise name (`session_exercises.name`).
- No GPS columns are ever read.

**As-built (M22-T02, §4.2 stream and detail).** Built in
`supabase/migrations/20260911120000_m22_group_record.sql`. The shapes are
exactly as above; `groups-contract` asserts the key sets.

- **Signature.** `group_stream(p_group_id uuid default null, p_before jsonb
  default null, p_limit integer default null)` is `volatile`, like `group_get`.
  `group_session_detail(p_member_user_id uuid, p_session_id text)` is `stable`.
  Both follow the §3 posture: `security definer`, a pinned `search_path`, and
  execute granted to `anon`, `authenticated`, and `service_role`.
- **Check order.** The preamble (`AUTH_REQUIRED`, then `AGENT_FORBIDDEN`) runs
  first. Then comes scope membership: a non-member, nonexistent, or deleted
  group gives `NOT_FOUND: group not found`. Only then does validation run. A
  non-member sending a bad `p_limit` therefore gets `NOT_FOUND`.
- **Cursor.** `p_before` must be a JSON object with exactly the keys
  `sort_at_ms`, `kind`, and `key`:
  - `sort_at_ms` is an integral JSON number;
  - `kind` is `membership` or `session`;
  - `key` is a non-empty string.

  Anything else, and a `p_limit` outside `1..50`, gives `VALIDATION`. A JSON
  `null` counts as no cursor. `next_cursor` is the last item's
  `{sort_at_ms, kind, key}` when `has_more`, else `null`.
- **Ordering.** `kind` and `key` compare in the `"C"` collation, so the order
  is byte order. It is identical in SQL and on the client.
- **Keys and timestamps.**
  - Membership keys are `<membership_id>:joined` and `<membership_id>:ended`;
    the ended item carries `event` `left` or `removed`.
  - Membership `sort_at_ms` is `floor(epoch_ms(joined_at | ended_at))`.
  - A session card's `sort_at_ms` is the live `sessions.started_at`, not the
    ledger copy.
- **Cards.** `groups` lists the caller's in-scope, non-deleted groups holding
  the share, ordered by `lower(name)`, then `name`, then `id`. `gym_name` is
  the member's gym name while that gym row is not tombstoned. `member` is
  `{ user_id, username }`, with `username` null when blank.
- **Detail.** A tombstoned session, a nonexistent one, a session never shared,
  and a caller who is not a member of any group holding the share all get the
  same `NOT_FOUND: session not found` body. The athlete may open their own
  shared session.

**As-built (post-M22, raw sets).**
`supabase/migrations/20260912120000_m22_group_raw_sets.sql` rebuilds the card
and detail bodies on one internal helper, `group_session_exercises_json(member,
session)`, so both carry the same `exercises` array. It drops the M22-T02 SQL
mirrors of the TS parsers: `group_js_trim`, `group_parse_reps`,
`group_parse_weight`, `group_e1rm`, and `group_performed_sets`.
`groups-contract` asserts the raw shapes.

**As-built (M25-T02, persistent stream).**
`supabase/migrations/20260913153000_m25_group_events.sql` rebuilds
`group_stream` on `group_events` (§2.6). It no longer reads
`group_session_shares` or `group_memberships` for items; scope still comes
from the caller's active periods. The signature, check order, cursor
validation, order, keys, shapes, and grants are all unchanged.

- **Session items.** In-scope `session` rows are grouped by `(member,
  session)`, which dedupes All. They are inner-joined to the live session:
  `sort_at_ms` is the live `started_at`, and a missing or tombstoned session is
  hidden. `groups` lists the in-scope, non-deleted groups holding an item.
- **Membership items.** They come from `joined` / `left` / `removed` rows at
  their stored `sort_at_ms`, keyed `<membership_id>:joined` or
  `<membership_id>:ended`. `event` is the row's kind.
- **Board kinds** (M25-T05) are stream items as of the T05 as-built below;
  `lead_change` never is.
- `group_session_detail` still authorizes through the share ledger.
- **Proven** by `groups-contract`. Every M22 stream assertion passes
  unchanged. New assertions cover:
  - the table's posture;
  - one item per membership edge and per share, with no duplicates on
    re-push;
  - event trigger failure isolation and self-heal;
  - a backfill that rebuilds three users' full All streams byte-identical.

**As-built (M25-T05, board items).**
`supabase/migrations/20260914120000_m25_group_boards.sql` rebuilds
`group_stream` with three more wire kinds. The order, scope, check order, and
the session and membership items are unchanged. `lead_change` rows are never
items (T6).

- **Cursor.** `kind` accepts `link`, `membership`, `record`,
  `record_voided`, and `session`.
- **Keys.** The event id. Items are per group: All does not dedupe them.
- **`record`** sorts at its session's live `started_at` while the row exists
  (tombstoned included), else at its stored position. A voided record stays
  visible (D15).

  ```jsonc
  { "kind": "record", "key", "sort_at_ms", "group": { "group_id", "name" },
    "member": { "user_id", "username" },
    "group_exercise": { "group_exercise_id", "name", "load_input_mode" },
    "session_id", "set_id", "weight_kg", "reps", "e1rm_kg",   // converted (D6)
    "entered_weight_kg", "load_factor", "achieved_at_ms",
    "boards": [{ "metric", "value_kg", "previous_value_kg", "group_record" }],
    "provisional",                                            // session active
    "voided": { "key", "reason": "edited|deleted", "occurred_at_ms" } | null,
    "certified": true,                                        // M25-T06
    "certification": { "certification_id", "certified_by": { "user_id", "username" } | null,
                       "certified_at_ms" } | null }
  ```

  `certified` / `certification` (M25-T06) read the active certification of
  `(group exercise, member, set)` pinned to the record payload's
  fingerprint, so a voided record reads uncertified once its certification
  is voided.

- **`record_voided`**: `{ kind, key, sort_at_ms, group, member,
  group_exercise, record_key, reason, record: { weight_kg, reps, e1rm_kg },
  leaders: [{ metric, leader: Holder + member | null }] }`, sorted when
  written.
- **`link`**: `{ kind: "link", key, sort_at_ms, event: "link" | "unlink",
  group, member, group_exercise, exercises: [{ exercise_definition_id, name }],
  effects: [{ metric, before: { rank, value_kg } | null, after: … }] }`,
  sorted when written. `name` is read live from the member's
  `exercise_definitions` (null if gone): they chose to link that exercise
  into the group.
- **Clients.** A build that doesn't render a kind drops it in `getGroupStream`
  (§6.1). Paging uses the server's `next_cursor`, so it walks past them. Since
  M25-T10 the mobile client renders all five kinds.

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

### 4.4 Group exercises (M25-T01)

```jsonc
// GroupExercise
{ "group_exercise_id": "uuid", "name": "…", "load_input_mode": "total_load|per_side_load",
  "source_exercise_id": "seed_…|null",
  "archived_at_ms": 1757500000000 }   // null while active
```

| RPC | Allowed | Effect / returns |
| --- | --- | --- |
| `group_exercise_list(p_group_id)` | active member | `{ exercises: GroupExercise[] }`, archived ones included. Active first, then `lower(name)`, `name`, id. |
| `group_exercise_create(p_group_id, p_name, p_load_input_mode, p_source_exercise_id)` | owner, admin | A null source is a custom exercise; otherwise it is a copy whose name and mode the client supplies from its seed data. Returns `{ exercise }`. |
| `group_exercise_update(p_group_id, p_exercise_id, p_name, p_load_input_mode)` | owner, admin | Replaces both fields; the source id never changes. Archived exercises are read-only (`VALIDATION`). Returns `{ exercise }`. |
| `group_exercise_archive(p_group_id, p_exercise_id)` | owner, admin | Sets `archived_at`. Idempotent: the first `archived_at` is kept. Returns `{ exercise }`. |
| `group_exercise_unarchive(p_group_id, p_exercise_id)` | owner, admin | Clears `archived_at`. Idempotent. Returns `{ exercise }`. |

**As-built (M25-T01).**

- **Posture** as §3: `security definer`, pinned `search_path`, execute granted
  to `anon`, `authenticated`, and `service_role`. The internal helpers
  (`group_exercise_trim`, `group_exercise_validate_name`,
  `group_exercise_validate_load_input_mode`,
  `group_exercise_validate_source_id`, `group_exercise_require_manager`,
  `group_exercise_require`, `group_exercise_json`) have no client grant, and
  none is `security definer`: they run only inside the RPCs.
- **Check order** as §4.3:
  1. the preamble;
  2. caller membership, `NOT_FOUND: group not found` (writes lock the group row);
  3. role, `FORBIDDEN`;
  4. input, `VALIDATION`: the name, then the load mode, then the source id;
  5. target, `NOT_FOUND: group exercise not found`, locking the exercise row
     `for update` (an exercise of another group looks nonexistent);
  6. archived, `VALIDATION` (update only).
- **Messages.** `VALIDATION: exercise name is required`, `VALIDATION:
  load_input_mode must be total_load or per_side_load`, `VALIDATION:
  source_exercise_id must be 1–100 characters after trimming`, and
  `VALIDATION: an archived group exercise is read-only; unarchive it first`.

### 4.5 Boards (M25-T05)

```jsonc
// BoardRow
{ "rank": 1, "member": { "user_id", "username" }, "former": false,
  "value_kg": 142.5, "weight_kg": 140, "reps": 1, "e1rm_kg": 142.5,   // converted (D6)
  "entered_weight_kg": 70, "load_factor": 2,                           // as logged
  "achieved_at_ms": 0, "session_id": "…", "set_id": "…",
  "exercise_name": "Bench (comp grip)|null",                          // live session_exercises.name
  "certified": true,                                                   // M25-T06
  "certification": { "certification_id", "certified_by": { "user_id", "username" } | null,
                     "certified_at_ms" } | null }
```

`certified` and `certification` (M25-T06) read the active certification of
the row's `(group exercise, member, set)` pinned to the entry's fingerprint,
on All and Certified boards alike. Certified boards, their ranks, and the
podium's `entry_count` and `me` count only valid Certified entries (§2.11).

| RPC | Returns |
| --- | --- |
| `group_board_podiums(p_group_id, p_metric default 'e1rm', p_certified default true)` | `{ metric, certified, exercises: [{ exercise: GroupExercise, podium: BoardRow[≤3], me: BoardRow\|null, entry_count, all_entry_count }] }`, every group exercise in the `group_exercise_list` order. `me` is the caller's row whenever ranked; `all_entry_count` counts the same metric on All. |
| `group_board(p_group_id, p_group_exercise_id, p_metric default 'e1rm', p_certified default false, p_after, p_limit)` | `{ exercise, metric, certified, rows: BoardRow[], next_cursor, has_more }`. `p_limit` `1..100`, default `50`. Ranks are absolute. |
| `group_board_history(p_group_id, p_group_exercise_id, p_metric default 'e1rm', p_certified default false, p_before, p_limit)` | `{ items: [{ key, seq, occurred_at_ms, reason, leader, previous, related }], next_cursor: { seq }\|null, has_more }`, newest first. `leader` and `previous` are `Holder + member`, or null. `related` summarizes the causing event: `{ kind: 'record', key, set_id, weight_kg, reps, e1rm_kg }`, `{ kind: 'record_voided', key, reason, record }`, `{ kind: 'link', key, event, exercises }`, `{ kind: 'certification', key, event: 'certified'\|'withdrawn'\|'cancelled'\|'voided', certified_by, ended_by, set_id, weight_kg, reps, e1rm_kg }` (M25-T06, from `payload.certification_id`, read live), or null. `p_limit` `1..50`, default `20`. |

**As-built (M25-T05).**

- **Posture** as §3: `security definer`, a pinned `search_path`, execute
  granted to `anon`, `authenticated`, and `service_role`. The helpers
  (`group_board_*`, `group_stream_event_json`) have no grant at all.
- **Check order:**
  1. the preamble;
  2. membership, `NOT_FOUND: group not found` (non-member ≡ former ≡
     removed ≡ nonexistent);
  3. `VALIDATION`: `p_metric must be weight or e1rm`, `p_certified is
     required`, then `p_limit`, then the cursor;
  4. the target, `NOT_FOUND: group exercise not found` (another group's
     exercise looks nonexistent). There is no lock: reads never block the
     evaluator.
- **Cursors.** `group_board`'s `p_after` is exactly `{ value_kg (number),
  achieved_at_ms (integral), member_user_id (uuid) }`, the last row of the
  previous page in the rank order. `group_board_history`'s `p_before` is
  exactly `{ seq }` (a non-negative integral number). Anything else, or a
  JSON value of the wrong type, is `VALIDATION`; JSON `null` means no
  cursor.
- **Archived** exercises are readable and sort last in the podiums.
- **Mobile (M25-T09).** `getGroupBoardPodiums(groupId)` (always e1RM ·
  Certified), `getGroupBoard({ …, after, limit = 50 })`, and
  `getGroupBoardHistory({ …, before, limit = 20 })` in `src/groups/api.ts`
  send every `p_*` arg and pass cursors back verbatim. `isGroupExerciseNotFound`
  matches `NOT_FOUND: group exercise not found`, so only a group `NOT_FOUND`
  evicts (§6.2).

### 4.6 Certification (M25-T06)

```jsonc
// Certification
{ "certification_id", "group_id", "group_exercise_id",
  "member": { "user_id", "username" }, "set_id", "session_id",
  "certified_by": { "user_id", "username" } | null, "certified_at_ms",
  "pinned": { "weight_value", "reps_value", "performance_status",   // raw, as synced
              "weight_kg", "reps", "e1rm_kg" },                     // converted, as shown
  "ended_at_ms": 0 | null, "end_reason": "withdrawn|cancelled|voided" | null,
  "ended_by": { "user_id", "username" } | null }
```

| RPC | Allowed | Returns |
| --- | --- | --- |
| `group_certify(p_group_id, p_group_exercise_id, p_member_user_id, p_set_id)` | any current member except the lifter | `{ certification, created }` |
| `group_certification_withdraw(p_group_id, p_certification_id)` | the certifier | `{ certification }` |
| `group_certification_cancel(p_group_id, p_certification_id)` | owner, admin (any certification) | `{ certification }` |

**As-built (M25-T06).** Posture as §3. Each RPC locks the `groups` row; none
takes the board advisory lock.

- **`group_certify` check order:**
  1. the preamble;
  2. membership, `NOT_FOUND: group not found`;
  3. `VALIDATION: p_member_user_id and p_set_id are required`, then
     `VALIDATION: you cannot certify your own set`;
  4. `NOT_FOUND: group exercise not found`; an archived exercise gets
     `VALIDATION: an archived group exercise is read-only; unarchive it first`
     (D8);
  5. the lifter is not a current member: `NOT_FOUND: member not found`;
  6. **record set (D3):** a current All entry of the set, else a non-voided
     `record` event; otherwise `NOT_FOUND: record set not found` (a
     non-record, unknown, or another member's set look the same);
  7. **idempotent:** an active certification of the set on the target,
     whoever gave it, is returned with `created: false` (P10);
  8. the lifter's live set row must exist and carry the record set's
     fingerprint (the entry's, else the record payload's), else `CONFLICT:
     the set changed; refresh and try again`;
  9. insert, pinning the live row's raw values; enqueue (§2.12).
- **Withdraw / cancel check order:** the preamble; membership (`NOT_FOUND:
  group not found`); cancel only, `FORBIDDEN: only the owner or an admin can
  cancel a certification`; `VALIDATION: p_certification_id is required`;
  `NOT_FOUND: certification not found` (another group's looks nonexistent);
  withdraw only, `FORBIDDEN: only the certifier can withdraw a certification`
  (admins cancel instead). An ended certification is returned unchanged (the
  first end is kept); otherwise `ended_at`, `end_reason`, `ended_by =
  caller`, and enqueue.
- Withdraw and cancel work on frozen targets (§2.11 known limits).
- **Mobile (M25-T10).** `certifyGroupSet({ groupId, groupExerciseId,
  memberUserId, setId })`, `withdrawGroupCertification(groupId,
  certificationId)`, and `cancelGroupCertification(groupId, certificationId)`
  in `src/groups/api.ts` send every `p_*` arg; the shape checks are a
  `certification` with a string `certification_id` (plus a boolean `created`
  on certify). `CONFLICT` maps from its token. `isGroupNotFound`,
  `isRecordSetNotFound`, `isCertificationNotFound`, and `isGroupMemberNotFound`
  match the messages above, so only `group not found` evicts.

## 5. Stream-card metrics (computed on the viewing device)

Group reads return raw set rows (§4.2). Every set rule runs on the viewing
device, in `apps/mobile/src/groups/session-metrics.ts`, through the canonical
TS the session screens use. Nothing is mirrored in SQL.

- **Performed.** A set is performed when `isConfirmedPerformedSet`
  (`apps/mobile/src/session-recorder/set-semantics.ts`) holds for its raw
  values and its status after `normalizeSessionSetPerformanceStatus`, and
  `parseCalculationSet` (`apps/mobile/src/exercise-calculations/index.ts`)
  parses it after `canonicalizeWeightForReps`. So a blank weight with valid
  reps is 0 kg, an unknown status counts as performed, and a value the
  set logger cannot produce (for example `1e3`) does not.
- **Sets** — the count of performed sets.
- **Volume** — Σ `computeSetVolume(weight, reps)` over performed sets. Warm-ups
  are included. The value is the entered scalar with no per-side normalization
  (spec 05 Sync v2 #5, #10).
- **Exercises** — live session exercises with at least one performed set.
- **Friend's session view** — the same performed sets; exercises with none are
  omitted.

**Why the device.** M22 first computed these in SQL helpers that mirrored the
TS parsers, held in parity by shared test vectors. That duplicated set
semantics in two languages, and the PR rule had no parity guard at all. The
device now reuses the session screens' code. The cost: a co-member's device receives
every live set, planned and skipped ones included, although the UI shows
performed sets only.

**PR highlights are deferred** (§9). The M22 rule compared a session's best
e1RM with the member's full completed history, including sessions never shared
into the group (§2.5), so the viewer cannot compute it from shared data.

**As-built (post-M22).** `session-metrics.ts` exports `toGroupPerformedSet`,
`selectGroupPerformedExercises`, and `computeGroupSessionMetrics`; the stream
view model and `FriendSessionContent` use them. Jest:
`apps/mobile/app/__tests__/groups-session-metrics.test.ts`.

## 6. Mobile client architecture

### 6.1 Module `apps/mobile/src/groups/`

| File | Responsibility |
| --- | --- |
| `types.ts` | Wire types (§4) |
| `api.ts` | One typed wrapper per RPC. It maps PostgREST errors to `GroupApiError { code, message }` by token prefix, and transport failures to `NETWORK`. It is the only code that calls Supabase for groups. |
| `cache.ts` | Read and write for `group_cache`, `evictGroup(groupId)`, and `wipeGroupCache()` |
| `session-metrics.ts` | Card metrics and the friend view's performed sets, computed from raw set rows with the session screens' TS (§5) |
| `stream-view-model.ts` | Pure presentation: status ("Training now" while `active` — indefinite, C7.2 — or "Completed · 1h 05m"), card metrics from `session-metrics.ts` formatted in kg, membership sentences ("X joined", "X left the group", "X was removed" — C7.3), and filter chips |
| `use-group-resource.ts` | A cache-first hook. It refreshes on focus, every 30 s while focused, and on pull-to-refresh, and returns `{ data, lastUpdatedAtMs, refreshing, offline, error, refresh }`. |
| `use-group-action.ts` | Runs one write RPC. It fails fast with the offline message when offline and never queues (C3.10.3). |
| `exercise-view-model.ts` | (M25-T08) Exercises-segment rows and link-status wording, the owner/admin exercise action matrix, write wording, and the standard-exercise search |
| `use-my-group-exercise-links.ts` | (M25-T08) My live local links into one group with my exercise names, reloaded on focus and after a local link (only the latest read lands); also my exercises and all my links for the pick sheet |
| `use-mounted-ref.ts` | (M25-T08) `useMountedRef`: a write that finishes after its screen unmounted must not navigate |
| `board-view-model.ts` | (M25-T09) Podium cards, full-board rows, history sentences, the board's `metric` / `scope` params and paths, ordinal / date / kg formatting |
| `use-group-online-pages.ts` | (M25-T09) Online-only paged reads (full board, history): no cache, no poll, cursor paging, first-seen dedupe, lost access vs exercise missing |
| `record-set-view-model.ts` | (M25-T10) The row detail model built from a board row or a stream record, `recordSetActionsFor` (certify / withdraw / cancel), the sheet's lines, and the wording of every certification outcome |
| `use-record-set-certification.ts` | (M25-T10) The three certification writes through `useGroupAction`: per-set pending and notice, the returned certification shown until the host re-reads, host refresh after a success or a data-moved failure, eviction on group `NOT_FOUND` |

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
  - **Stream kinds (M25-T05, M25-T10).** `getGroupStream` keeps `session`,
    `membership`, `record`, `record_voided`, and `link` items and drops any
    other kind before callers or the cache see it, keeping the server's
    `next_cursor`; `StreamCursor.kind` admits any string. Items of a known
    kind are trusted as typed (the shapes are asserted server-side by
    `groups-leaderboards`).
  - Group exercises (M25-T01): `listGroupExercises`,
    `createGroupExercise(groupId, { name, loadInputMode, sourceExerciseId })`,
    `updateGroupExercise`, `archiveGroupExercise`, `unarchiveGroupExercise`,
    and `groupExerciseCore` (a `GroupExercise` → `ExerciseCore`). Create and
    update run `validateExerciseCore` (`apps/mobile/src/exercise-core`)
    first. A rejection is a local `VALIDATION` carrying the validator's
    message, with no request; otherwise the trimmed name is sent. The
    personal repository (`saveExercise` in `src/data/exercise-catalog.ts`)
    validates through the same function.
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
  timestamps, else reads "Completed". Volume is `5230.5 kg`, with at most two
  decimals and no thousands separators (design-language §6; DLM-T12).

### 6.2 Local cache — `group_cache` (local-only SQLite)

The schema file is `apps/mobile/src/data/schema/group-cache.ts`, with a Drizzle
migration via `npm run db:generate`.

| Column | Type | Notes |
| --- | --- | --- |
| `cache_key` | `text` PK | `groups:mine`, `group:<id>`, `stream:all`, `stream:<groupId>`, `session:<memberId>:<sessionId>`, `group-exercises:<groupId>` (M25-T07; the Exercises segment reads it too, M25-T08), `boards:<groupId>` (M25-T09: the podium page on Certified · 1RM; full boards and history are never cached) |
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
  `stream:<id>`, `group-exercises:<id>` (M25-T07), `boards:<id>` (M25-T09), and every `session:*`
  entry. The member's `exercise_group_links` rows are synced data and are never
  evicted. A successful All refresh replaces
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
- **Shape change (post-M22).** `apps/mobile/drizzle/0005_clear_group_cache.sql`
  deletes every row once, so a payload cached in the old metrics shape is never
  rendered by the raw-set client.
- **No clear for the board kinds (M25-T10).** A `stream:*` entry written
  before M25-T10 is the same top-level shape with the board kinds filtered
  out: a valid subset of the new payload. It renders as is and is replaced on
  the next refresh, so there is no clear migration.

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
| `/group/[groupId]/members` | `app/group/[groupId]/members.tsx` | (M25-T08) Members, from the header's member count |
| `/group/[groupId]/exercises/new` | `app/group/[groupId]/exercises/new.tsx` | (M25-T08) Add a group exercise: standard copy or custom |
| `/group/[groupId]/exercises/[exerciseId]/edit` | `app/group/[groupId]/exercises/[exerciseId]/edit.tsx` | (M25-T08) Rename a group exercise or change its weight entry |
| `/group-session/[memberId]/[sessionId]` | `app/group-session/[memberId]/[sessionId].tsx` | Friend's session view |
| `/exercise-link?exerciseDefinitionId=` | `app/exercise-link.tsx` | Link screen (M25-T07): link one of my exercises to my groups' exercises |
| `/group/[groupId]/leaderboards/[exerciseId]?metric=&scope=` | `app/group/[groupId]/leaderboards/[exerciseId]/index.tsx` | (M25-T09) Full board with the Weight / 1RM × Certified / All toggles |
| `/group/[groupId]/leaderboards/[exerciseId]/history?metric=&scope=` | `app/group/[groupId]/leaderboards/[exerciseId]/history.tsx` | (M25-T09) The board's lead-change history |

- **Groups tab.** It shows the stream with **All** and per-group chips, header
  actions My groups / Create group / Join group, and the empty, signed-out, and
  offline states.
- **Group screen.** Its header shows name, description, member count, and my
  role. Stream and Members sit behind a segment. Role actions follow §4.3.
  M25-T08 replaces the segment with Stream · Exercises · Leaderboards and
  moves Members to its own route (as-built below).
- **Friend's session view.** It is read-only and has no edit, delete, or
  append.
- **Tab.** A fourth `TopLevelTabs` button: key `groups`, label "Groups", testID
  `top-level-tab-groups`, mapped in `resolveActiveTab`
  (`app/(tabs)/_layout.tsx`). Its fit is verified on small phones with a
  screenshot (brainstorm C8).
- **Friend's session view** draws its exercises with View Session's cards
  (`components/session-detail/`), read-only. `completed-session/[sessionId].tsx`
  itself is not reused (C3.8.3).
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

**As-built (M22-T04).** The read side ships: `/groups`, `/group/mine`,
`/group/[groupId]`, and `/group-session/[memberId]/[sessionId]`. The create,
join, edit, and invite routes, and every action, are M22-T05.

- **Tab.** `TopLevelTabs` gains `groups` after Exercises and before the cog.
  `resolveActiveTab` is exported from `app/(tabs)/_layout.tsx` and
  unit-tested. Titles `My groups`, `Group` (replaced by the group name once
  loaded), and `Session` are registered in `app/_layout.tsx`.
- **UI.** `apps/mobile/components/groups/*` (catalogued in
  `ui/components-catalog.md`).
  - `src/groups/use-group-stream.ts` (`useGroupStream`) pages the stream. The
    first page is cache-first through `useGroupResource`. Older pages load
    online on end-of-list and are never cached. A refresh keeps loaded older
    items only when they sort after the new first page's boundary
    (`mergeStreamPages`), so a deletion in an older page shows once the screen
    remounts.
  - View-model additions: the membership `groupId`, the card
    `startedAtLabel` (local `M/D HH:MM`), `formatOfflineMarker`,
    `formatMyRole`, `formatMemberCount`, `GROUP_ROLE_LABELS`, and
    `formatGroupDateTime`.
- **Groups tab.**
  - The header holds `My groups`, and M22-T05 adds Create / Join beside it.
  - Chips show once My groups has loaded at least one group. A selected
    group that leaves My groups, or whose stream returns `NOT_FOUND`, falls
    back to All.
  - `group_list_mine` returning no groups shows the empty state
    (`groups-empty-state`, children slot for the T05 buttons).
- **Group screen.** Members render in server order. Membership items there
  do not navigate. `NOT_FOUND` from `group_get` or `group_stream` shows the
  lost-access state, and both hooks evict (`evictGroupIdOnNotFound`).
- **Friend's session view.** `FriendSessionContent` composes
  `SessionFactsCard` and `ExerciseSetsCard` (`components/session-detail/`).
  - Rows are the session view's `type · weight × reps · 1RM · VOL` (kg, no unit shown). Status reads `In progress`
    or `Completed · <duration>`.
  - No `completed-session-detail-*` owner testID renders, which jest asserts.
- **Signed out or unconfigured.** `GroupsSignInRequired` renders on every
  group route and no group RPC runs.

**As-built (M22-T05).** The write routes ship: `/group/new`, `/group/join`,
`/group/[groupId]/edit`, and `/group/[groupId]/invite`, plus the role actions
on the group screen and the Create / Join actions on the tab.

- **Rules module.** `src/groups/write-view-model.ts` (barrel-exported) holds
  the pure rules the screens use:
  - `groupMemberActionsFor(myRole, myUserId, target)` is the §4.3 matrix:
    owner → admin offers Remove admin, Transfer, Remove; owner → member
    offers Make admin, Transfer, Remove; admin → member offers Remove; every
    other pair (self, the owner, admin → admin, any member) offers nothing.
    Jest walks every pair.
  - `canManageGroup` (Invite, Edit: owner, admin) and `canLeaveGroup`
    (not owner).
  - `validateGroupDetails` mirrors §2.1 (trimmed name 1–50, description ≤280,
    blank → null).
  - `groupInviteLink` and `buildGroupInviteShareMessage` produce the share
    text: the group name, the code, and `boga3://group/join?code=…`.
  - `describeGroupWriteError` supplies the on-screen wording per token.
- **Writes.** Every write, and the gate's `saveUsername`, runs through
  `useGroupAction`: offline refusal, no queue. A transport `NETWORK` reads
  "Couldn't reach the server. Nothing was changed". After a success the
  screen `refresh()`es its resources; the member writes' `group_get` payload
  is not written to the cache directly.
- **Leave.** On success `evictGroupFromDevice` (`src/groups/evict-local.ts`)
  evicts the group's cache entries, and the screen `dismissTo('/groups')`s.
  A failed eviction is logged (`group.evict_failed`) and left to the next
  `NOT_FOUND`.
- **Invite.** `group_invite_get` runs online on each visit and is never
  cached, so no `invite:*` cache key exists. `FORBIDDEN` shows "Invites are
  for admins".
- **Join.** The `code` query param is prefilled and previewed once the gate
  is satisfied. `already_member` shows `Open group` and does not call
  `group_join`. `INVITE_INVALID` reads "This invite code isn't valid." and
  drops the preview. Create and join `router.replace` to the group.
- **Username gate.** `components/groups/username-gate.tsx`. A profile that
  fails to load does not block the form: the server's `USERNAME_REQUIRED`
  re-opens the gate, and the create draft is kept.
- **Confirmation.** Remove, Transfer, Leave, and Regenerate use `Alert.alert`
  with a destructive button. The member action sheet is an in-route `Modal`.
- **Known limitation, unchanged.** An invite link opened while signed out
  loses the code at `/sign-in`.
- **Evidence.** Jest: `groups-write-screens.test.tsx`,
  `groups-write-view-model.test.ts`, and the real-router
  `groups-join-deep-link.test.tsx`. On-device screenshots against local
  Supabase are listed on the M22-T05 card.

**As-built (M25-T07): linking.** Members link their exercises to group
exercises from picker search, a pick sheet, and the Link screen (product
E0.1–E0.3).

- **Where each fact is read.** Linked-state comes from the local synced
  `exercise_group_links` (`listLinks()`), so it renders offline and right after
  a local write. Group and group-exercise names come from `group_cache`
  (`groups:mine` and `group-exercises:<groupId>`, the `group_exercise_list`
  payload); a missing entry shows `Group exercise` / `A group`. Only cached
  group exercises can be linked. Link and unlink are local writes, not group
  RPCs, so the online-only write rule (C3.10.3) does not apply to them.
- **`use-group-exercise-linking.ts`.** `useGroupExerciseLinking({ userId })` is
  the cache-first hook: it reads `groups:mine` and each `group-exercises:<id>`,
  refreshes them on focus, when the session view's picker opens, and on `refresh()`
  (pull-to-refresh) — no 30 s poll, since these lists change rarely and the
  screens are not live views — with per-group `listGroupExercises`. A group
  whose list returns `NOT_FOUND` is evicted (`evictGroup`) and left out of the
  cached `groups:mine`. Links reload on focus and on `reloadLinks()`. A
  `groups:mine` with no cached list yet reads as not loaded
  (`groupExercisesLoaded`), so offline shows "Connect once…"; NETWORK errors
  are left to the offline marker (`pickInlineError`). `useGroupLinkingUserId()` reads the auth store directly
  (signed in and configured, else null), so the picker, exercise page and catalogue need no
  `AuthProvider`; a null user disables everything, NetInfo included
  (`useNetworkOnline(enabled)`).
- **`link-view-model.ts`.** The pure rules: the picker's `From your groups`
  sections (only with search text or the `Groups` toggle; archived and
  uncached lists left out; a link from a deleted exercise doesn't count), the
  pick sheet (suggestion = my live exercise whose id is the group exercise's
  `source_exercise_id`, else the best name match, never one already linked in
  that group), the Link screen's Linked / Suggested / All sections (one link per
  group shows `already linked in <group>`; links into a group I left read
  `inactive — not a member`; archived targets read `archived`), and the
  retroactivity, unlink, and weight-entry notes. `add-as-new.ts` builds the
  editor prefill (name, load mode, and the source seed's muscle mappings).
- **Soft-deleted exercises** are never offered: the catalogue item is disabled,
  the pick sheet lists live exercises only, and the Link screen shows "Restore
  this exercise to link it" (unlink still works). The repository stays
  permissive (sync contract §A.2.10).
- **Evidence.** Jest: `groups-link-view-model.test.ts`,
  `groups-exercise-link-screen.test.tsx`, the picker's group cases in
  `exercise-picker.test.tsx` (`picker: group exercises (E0.1)`, `pick sheet (E0.2)`, `signed out`),
  `exercise-catalog-link-menu.test.tsx`, `exercise-group-links-add-as-new.test.ts`,
  and the exercise page's ⋮ Link item in `exercise-page-screen.test.tsx`;
  Maestro `groups-link-exercise.yaml` (§8), whose last step opens the Link
  screen from the exercise page's ⋮.

**As-built (M25-T08, group page).** Product D10, D14, and E0.4; M25 design
§1 and §7.

- **Segments.** `/group/[groupId]` is `Stream` / `Exercises` /
  `Leaderboards` (in-route state, Stream first). Members moved to its own
  route, `/group/[groupId]/members`, opened from the header's member count
  (`group-screen-members-link`). It holds the member rows, the §4.3 action
  sheet, Leave, and the owner's transfer notice unchanged, on the same
  `group:<id>` resource.
- **Exercises.** `group_exercise_list` runs through `useGroupResource` under
  `group-exercises:<groupId>` (§6.2). The group screen enables it only while
  the segment is open (a `null` key otherwise), so the Stream segment never
  polls it.
  - Rows (`buildGroupExerciseRows`, `src/groups/exercise-view-model.ts`):
    active exercises, then archived ones marked `Archived`, each in server
    order with its weight entry.
  - My status comes from my local `exercise_group_links` rows
    (`useMyGroupExerciseLinks`: `listLinks()` filtered to the group, names
    from my local catalogue including deleted exercises, reloaded on focus),
    so it shows offline: `Linked: A, B`, `Linked` when the linked exercise is
    not on this device, or `Not linked`. A failed local read shows a notice
    instead of any status.
- **Owner/admin actions** (`groupExerciseActionsFor`; members get none, and
  the server enforces `FORBIDDEN` regardless).
  - `Add exercise` → `/group/[groupId]/exercises/new`. `From catalogue`
    searches the bundled `SYSTEM_EXERCISE_DEFINITION_SEEDS`
    (`searchStandardExercises`, every word must match, 30 shown at a time)
    and prefills the form. The seed id is sent as `p_source_exercise_id` even
    when the name is edited. `Custom` sends null.
  - A row opens a sheet: `Rename` →
    `/group/[groupId]/exercises/[exerciseId]/edit` (both fields, prefilled from the cached list and following a fresher
    read until you edit them; an archived exercise shows a read-only state) and
    `Archive` (confirmed) on an active row, `Unarchive` on an archived one.
  - Every write runs through `useGroupAction`, worded by
    `describeGroupExerciseWriteError`. On the Exercises page and the edit
    route a `FORBIDDEN`, `NOT_FOUND`, or `VALIDATION` refusal also refreshes
    the group and the list. The add route refreshes the group on `FORBIDDEN` /
    `NOT_FOUND`; the list refreshes when the group screen regains focus.
  - A save that finishes after you already left the add or edit screen
    does not navigate (`useMountedRef`), so Back is never applied twice.
- **Shared form.** `ExerciseCoreFields`
  (`components/exercise-core/exercise-core-fields.tsx`: the name and the
  `Total load` / `Per side` control, labelled by `LOAD_INPUT_MODE_LABELS` in
  `src/exercise-core`) renders in the personal exercise editor and in the
  group exercise form. Both validate the name through `validateExerciseCore`.
- **Leaderboards** was an empty state until M25-T09 (as-built below).
- **Link your exercise** (E0.4). An active row none of my exercises is
  linked to shows `Link your exercise` to every member; archived rows are not
  offered (D8). It opens the M25-T07 pick sheet with `purpose="link-only"`: the
  confirm reads `Link`, links locally (`linkExercise`, so it works offline),
  and adds nothing to a session. "Add as new" opens the prefilled editor, and
  `createExerciseWithGroupLink` writes the exercise and its link in one local
  transaction. My links then reload, so the row reads `Linked: …`.
- **Unlink your exercise** (E0.4). Each linked row has a separate `Unlink…`
  button for every member role, including archived targets. One mapping opens
  confirmation directly; several open the scrollable `Your linked exercises`
  sheet, with a per-personal-ID action. Duplicate and missing names carry a
  distinguishing short ID; deleted personal exercises remain removable. The
  chooser dismisses before confirmation, and dismissal restores row focus.
- **Shared unlink contract** (E0.3/E0.4). `describeUnlinkConfirm` and
  `useExerciseUnlink` serve both the group page and the catalogue/exercise-page Link
  screen. Confirmation names the personal exercise, target exercise and group,
  explains removal from All and Certified boards after sync, and explicitly
  preserves past activity and certifications. Archived and inactive targets
  explain their respective unarchive/rejoin conditions instead. Known archive
  metadata is retained in memory for an inactive link's wording; evicted
  server caches remain evicted, and absent metadata uses placeholder names.
  Unlink stays a local write offline, with a reconnect/sync success notice.
- **Identity and failure handling.** `unlinkExercise` optionally checks the
  expected group-exercise ID in its SQLite transaction. A moved, missing or
  already-unlinked mapping is not mutated; the UI refreshes and explains the
  change. Pending writes disable repeat submissions. Failed local reads hide
  link status and actions and offer a separate retry; a read failure after a
  successful mutation never becomes a failed-write notice. No board cache is
  edited. The second personal link, completed record activity and original
  active certification are covered by the two-user `ios-groups-e2e` flow's
  unlink/cancel/relink extension; R5 and `groups-certification.sh` preserve the
  existing ranking and certification semantics.
- **Evidence.** Jest: `groups-exercise-screens.test.tsx`,
  `groups-exercise-view-model.test.ts`, `groups-cache.test.ts`, and the
  member cases moved to the Members route in `groups-write-screens.test.tsx`.
  Maestro: step 4b of `groups-two-user-stream.yaml` (§8).

**As-built (M25-T09): leaderboards.** Product P6–P9, D11, D12, E1.1–E1.3; M25
design §7.

- **Podium page** (the Leaderboards segment, `GroupLeaderboardsPage`).
  `group_board_podiums` runs through `useGroupResource` under
  `boards:<groupId>`, enabled only while the segment is open, like Exercises.
  One card per group exercise in server order (archived last, tagged
  `Archived`), labelled `Certified · 1RM`, with up to three rows (rank, name,
  value, date; my row reads `You`). The metric reads `1RM` and values are
  figures with no unit (`142.5`) since DLM-T12-D2: display copy only, the
  `e1rm` key and `metric=e1rm` param stay.
  - `You: Nth` shows only below 3rd, and `You: not ranked` only on a non-empty
    board I am not on.
  - An empty podium reads `No certified sets yet · N uncertified` (N =
    `all_entry_count`), or `No sets yet`.
  - A card opens `/group/<id>/leaderboards/<exerciseId>`. No exercises:
    `No group exercises yet`.
- **Full board.** `?metric=weight|e1rm&scope=certified|all`; anything else
  opens 1RM · Certified. The two toggles (`Weight` | `1RM`, `Certified` |
  `All`) switch in place; `History` sits in the header and carries the toggles.
  - Rows: rank, `You` / name, ` (former)`, value, date. 1RM rows show the
    estimate (`142.5`) with the set behind it (`140.0 × 1`); Weight rows show
    the set (figures, no unit, since DLM-T12-D2). A row's accessibility label
    reads `1st, sam, 1RM 142.5, 140.0 × 1, 12 Sep[, certified|uncertified]`. On All
    only, a check icon, or a ring icon and `uncertified`.
  - Empty Certified: `No certified sets yet` with `See all sets` (the board
    payload has no uncertified count). Empty All: `No sets yet`.
  - Rows are not pressable yet: the row detail is M25-T10.
- **History.** Newest first, one sentence per lead change: `L set the first
  record · v`, `L took #1 · v (from P, pv)`, `… (linked A)`, `… (P unlinked
  A)`, `L now #1 · v (P's pv removed — set edited|deleted)` (`You're now #1` for me), `No one holds #1
  (…)`, `… (certified by C)` and, for an ended certification (M25-T06 `related`),
  `L now #1 · v (P's pv certification withdrawn|cancelled|voided)`; an unknown reason reads `L took #1 · v`. A void reads
  "now #1": an item does not say whether L held #1 before. Values are kg
  on both metrics (no reps): a sentence is prose and keeps its unit.
- **Online pages** (`useGroupOnlinePages`). The board and history are never
  cached. The first page loads on mount, on a toggle change, on focus, and on
  pull-to-refresh, with no 30 s poll; a refresh discards older pages.
  End-of-list sends `next_cursor` verbatim, never offline; a failure shows a
  `Retry` footer. Rows are deduplicated first-seen (by member, or history
  `key`). With nothing loaded, offline shows the offline empty state; loaded
  rows stay with the marker. A group `NOT_FOUND` evicts and shows lost access;
  an exercise `NOT_FOUND` shows "This exercise isn't in this group" and evicts
  nothing.
- **Evidence.** Jest: `groups-board-api.test.ts`,
  `groups-board-view-model.test.ts`, `groups-online-pages.test.tsx`,
  `groups-leaderboards-screens.test.tsx`, `groups-cache.test.ts`. Maestro:
  steps 7b and 8b of `groups-two-user-stream.yaml` (§8).
  Rows became pressable in M25-T10 (below).

**As-built (M25-T10): stream record items, row detail, certify.** Product
P10–P18, D3–D5, D15, D16, E2, E3; M25 design §4, §6.

- **Stream items** (`buildStreamViewModel(items, myUserId)`).
  - A `record` whose session card is among the loaded items is emitted
    directly below that card, in server order; otherwise it stays where the
    server put it (the server sorts it just above its session: same
    `sort_at_ms`, `kind` ascending). The session card's `recordsLabel` (`1
    record` / `N records`) counts those records, non-voided, deduplicated by
    `set_id`. It is a label, not a link.
  - Record card (`GroupStreamRecordCard`): `<name> — group record` when any
    listed board has `group_record`, else `— PR`; `<exercise>`, then the
    figures `140.0 × 1`, plus ` · 1RM 142.5` when an e1RM board is listed (no
    unit in a figure, and the metric reads `1RM`: display copy only, the key
    stays `e1rm`; DLM-T11-D4); badges per board, Weight then 1RM, `PR ·
    <metric>` then `Group record · <metric>`;
    `Session in progress` while provisional; `Not certified yet` (ring icon),
    `Certified by <name|you>` (check icon; `Certified` when the certifier is
    gone), or `Voided · set edited|deleted` (no icon; the voided card loses
    its `record` band and fades, status first). `Certify` shows when not voided, not certified, and not mine; the
    group name shows in All.
  - `record_voided` and `link` are light rows (`GroupStreamSentenceItem`),
    not pressable: `dave's Bench Press record removed (140 kg × 1) — set
    edited · Now #1 on Weight: sam 138 kg · No one holds #1 on 1RM`; `dave
    linked A, B to Bench Press — now #1 on Weight and 1RM` (or `— now #2 on
    Weight, #1 on 1RM`, `off the <metric> board`; `unlinked … from`; a null
    exercise name reads `an exercise`). My name reads `You` / `Your`.
- **Row detail sheet** (`RecordSetSheet`, an in-route `Sheet` with no Close
  since DLM-T11: the backdrop dismisses it), opened from a record card or a
  full-board row (`GroupBoardRow` is now a press target). It shows `<name> ·
  <group exercise>`, the figures `140.0 × 1` and `1RM 142.5` (DLM-T11-D4), the
  as-logged value when `load_factor` is 2 (`Logged 70 kg per side · counted
  as 140 kg total`) or 0.5 (`Logged 140 kg total · counted as 70 kg per
  side`), `12 Sep 2026 · <gym>`, `Logged as "<name>"` (the board row's
  `exercise_name`, else the session detail's exercise holding the set), the
  provisional line, the certification line (`… · 12 Sep`), the lifter's `Other
  members can certify this set.`, and `View full session`
  (`/group-session/<member>/<session>`; hidden for a `deleted` void or a
  session `NOT_FOUND`). Gym and logged-as come from `group_session_detail`
  through `useGroupResource` under `session:<memberId>:<sessionId>` (shared
  with the friend view, no group eviction). The sheet follows the live stream
  item or board row it was opened on, so a refresh shows the server's state.
- **Actions** (`recordSetActionsFor(detail, myUserId, myRole)`):
  - `certify`: uncertified, not voided, not archived (board payloads only;
    the server refuses a stream record's archived target), not a former
    member, and I am not the lifter;
  - `withdraw` (`Remove my certification`): I am the certifier;
  - `cancel` (`Cancel certification`): owner or admin, not the certifier.
  My role comes from `group:<groupId>` on the group screen and the full board
  (which now reads it, cache-first) and from `groups:mine` on the Groups tab;
  unknown hides `Cancel`.
- **Writes** (`useRecordSetCertification`, one per host: the stream list or
  the board route). Offline is refused before any request, nothing is queued
  or retried, and `group_cache` is never written by a write. Certify does not
  confirm; withdraw and cancel confirm with `Alert.alert` (destructive). The
  notice shows in the sheet, or on the card for an inline Certify:
  `Certified. Certified boards update in a few seconds.`, `Already certified
  by <name>.` (`created: false`), `Your certification was removed.`,
  `Certification cancelled.`, or `This certification was already removed.`
  (an already-ended certification comes back unchanged). The returned
  certification shows at once, until the host's data for that set agrees
  with it, or 45 s pass (`writtenCertificationSettled`): a read already in
  flight when the write committed can land with the old state. Pending state
  is per set.
  - After a success, and after `CONFLICT` (`This set changed since it loaded.
    Nothing was certified — refresh and try again.`), record set / member /
    certification / group exercise `NOT_FOUND`, `FORBIDDEN`, or `VALIDATION`
    (archived: `This exercise is archived. Its boards are read-only.`), the
    host re-reads: the group screen its group and stream (the podiums
    refresh when their segment opens), the Groups tab My groups and the
    stream, the board its first page.
  - A group `NOT_FOUND` evicts the group (`evictGroupFromDevice`) and the
    host's re-read shows lost access.
- **Evidence.** Jest: `groups-certification-api.test.ts`,
  `groups-record-set-view-model.test.ts`, `groups-record-set-sheet.test.tsx`,
  `groups-stream-view-model.test.ts`, `groups-api.test.ts`,
  `groups-leaderboards-screens.test.tsx`. Maestro: steps 7b, 7c (M25-T11:
  record card, certify, Certified boards), and 8b of
  `groups-two-user-stream.yaml` (§8).

**As-built (groups UI iteration, post-M25).** Supersedes the Groups tab,
group screen, and Today details above where they differ. No server change.

- **Groups screen** (`/groups`, `app/(tabs)/groups.tsx`). One group at a
  time: `GroupFilterChips` shows one chip per group and no `All`
  (`buildStreamFilterChips`). The selection is `resolveSelectedGroupId(groups,
  ?groupId, last viewed)`, else the first group by name; the last viewed id
  is in-memory only (`src/groups/last-viewed-group.ts`) and ignored once it
  leaves My groups. Header: the `Groups` title with `My groups` beside it, the
  same from More, Today, or a link (no `Back to More`; More opens `/groups`).
  Below the chips a joined `Stream` · `Leaderboards` segment: the Stream is
  `useGroupStream({ groupId })` (`stream:<groupId>`; nothing is read until a
  group is selected), the Leaderboards segment is `GroupLeaderboardsPage` on
  `boards:<groupId>`, read only while open. Membership items do not navigate;
  nothing on the screen opens the group page. A stream or podium `NOT_FOUND`
  re-reads My groups, so the lost group's chip goes and the selection moves.
  Pull-to-refresh re-reads My groups, the stream, and the open podiums.
- **My groups** (`/group/mine`) holds `Join group` / `Create group` above the
  list (the empty state keeps its own actions) and is the only way from the
  Groups screen to a group page.
- **Group page** (`/group/<id>`) is management only: the header (name,
  description, member count → Members, owner/admin `Invite` / `Edit`), then an
  `Exercises` title and `GroupExercisesPage`, read on mount
  (`group-exercises:<id>`). No stream or podium reads; lost access follows
  `group_get` or `group_exercise_list` `NOT_FOUND`.
- **Today** (`/today`, the `stream:all` read). Group activity keeps
  `session`, `record`, and `membership` items (certified or not) and shows the
  newest three after `buildStreamViewModel` attaches records below their
  session card. Record cards are read-only (`GroupStreamRecordCard` without
  `onCertify`), name their group, and, like membership rows, open
  `groupsStreamPath(groupId)` = `/groups?groupId=<id>`, where Certify lives.
- **Back affordance.** The root stack's `screenOptions` set
  `headerBackButtonDisplayMode: 'minimal'` with no custom `headerBackTitle`
  on every detail screen (group routes included): react-native-screens turns a
  custom back title into a custom item that ignores the display mode and
  morphs its label in during the push from the headerless tabs.
- **Evidence.** Jest: `groups-screens.test.tsx`, `groups-write-screens.test.tsx`,
  `groups-exercise-screens.test.tsx`, `groups-leaderboards-screens.test.tsx`,
  `groups-record-set-sheet.test.tsx`, `groups-stream-view-model.test.ts`,
  `today-screen.test.tsx`, `more-screen.test.tsx`,
  `root-layout-auth-bootstrap.test.tsx`. Maestro: `groups-two-user-stream.yaml`
  (stream and leaderboards through `boga3://groups?groupId=<id>`, the group
  page for members and exercises, and new step 7c-0: the record on Today,
  read-only, opening the Groups screen).

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
  nothing (C3.10.3, AC12). Certify, withdraw, and cancel (M25-T10) follow the
  same rule (P18).

**As-built (M22-T04).**

- **Pull-to-refresh.** Every group list and screen uses `RefreshControl`.
  `usePullToRefresh` shows the spinner only for a user pull; the focus and
  poll refreshes stay silent (`ui/ux-rules.md` §14, 08 patterns 6–8; writes: pattern 9).
- **Offline marker.** `GroupOfflineBanner` renders
  `formatOfflineMarker(lastUpdatedAtMs)` in local `HH:MM` whenever the
  resource is `offline` (NetInfo reports offline, or the last refresh failed
  with `NETWORK`). The tab uses the stream's timestamp, falling back to My
  groups'. With no cache, `<prefix>-offline-empty-state` renders.
- **Older pages.** They are not requested while offline. A failure shows a
  footer with `Retry`.
- **Evidence.** Jest (`groups-screens.test.tsx`) covers the offline marker.
  Simulator network cannot be toggled reliably (§8).

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
    - the raw card and detail payloads: every live set as synced, tombstones
      omitted (§4.2);
    - share-trigger failure isolation: a forced trigger failure still commits
      `sync_push` and writes `group.share_failed`;
    - (M25-T01) group exercises: the shared `ExerciseCore` vectors through
      `group_exercise_create` and the table CHECKs, source-id bounds, the
      owner/admin/member/non-member/removed matrix, another group's exercise
      as a target, update, and the archive round trip.
- **Backend lane `groups-leaderboards`** (M25-T04;
  `supabase/tests/groups-leaderboards.sh`; slow-backend gate; local Supabase
  with the Edge Runtime, pg_net, and pg_cron).
  - **Direct-drain mode.** It unsets the kick URL for the run and POSTs to
    `group-eval` itself, so the assertions are deterministic. Only the sweep
    and pg_net smoke sections turn the kick on.
  - **Shared fixtures.** It shares `supabase/tests/lib/groups-fixtures.sh`
    with `groups-contract` (users, HTTP, `sync_push` builders).
  - **Coverage:**
    - §2.8–§2.10 posture;
    - facts through real pushes: the §5 fixtures, the per-side entered mode,
      e1RM, `live` and fingerprint through edits, tombstones, undeletes, and
      a hard delete;
    - no job for an unshared session;
    - every target and inert-link case, archive and unarchive, load mode,
      retarget, and unlink;
    - coalescing, the generation guard, lease expiry, and the rules requeue;
    - forced enqueue, kick, and job failures with `sync_push` still
      committing;
    - the sweep, and a pg_net smoke (one kick for a 32-row push).
  - **Hermetic.** It restores the URL, the sweep job, and the probe
    constraints on exit.
- **Boards body `groups-boards.sh`** (M25-T05; the second body of the
  `groups-leaderboards` lane, same direct-drain mode and shared fixtures).
  Per-run users: athlete, rival, a rejoining member, owner, and outsider.
  - **Change table.** One section per row of the design's board change
    table: new best (with first set and group-record flag), void on edit
    down / unperformed / delete, edit up, session delete and undelete, link /
    unlink / retarget (no record cards), no certification → Certified boards empty, load-mode
    rescale, leave (former, still ranked), archive and unarchive catch-up,
    and the silent rules recompute.
  - **Rules.** The provisional rule (update in place, silent drop, void only
    once complete), D6 both directions with the entered value kept, P7 ties
    (earlier date, then exercise order, then set order), and rejoin catch-up.
  - **Serialization and isolation.** While the group's advisory lock is held
    from another session, an apply under `lock_timeout` fails with a lock
    timeout. A forced apply failure fails the job (kept, retried) while
    `sync_push` commits.
  - **Reads and stream.** The three board reads' shapes, podium order, board
    and history keyset paging, and every error token; `group_stream`'s board
    items, their shapes, and cursor paging that is independent of page size.
- **Certification body `groups-certification.sh`** (M25-T06; the third body
  of `groups-leaderboards`, same direct-drain mode and shared fixtures).
  Per-run users: owner, admin, athlete, rival, certifier, a removed member,
  and an outsider.
  - **Rejections.** `AUTH_REQUIRED`, `AGENT_FORBIDDEN`, non-member and removed
    `NOT_FOUND` on all three RPCs, self-certify, missing ids, another group's
    exercise, archived, a non-record / unknown / other member's set, a
    non-member lifter, a former lifter, and `CONFLICT` for an edit ahead of
    the evaluator.
  - **Lifecycle.** Certify with its pinned values (idempotent for a second
    certifier), withdraw (certifier only, idempotent), admin and owner cancel
    (member `FORBIDDEN`, idempotent), and re-certify after cancel (D4).
  - **Voids.** Edits in completed and active sessions, set and session
    tombstones, and no revival on undelete. Unlink/relink (reason `link`), a
    load-mode rescale, and a rules recompute void nothing.
  - **Reads.** Certified entries and `lead_change{certification}` with its
    `certification_id`; `BoardRow`, podium, and stream `certified` /
    `certification`; history `related`; an ended certification leaving the
    Certified reads before any apply, on a frozen board too.
  - **Isolation.** A forced enqueue failure commits the certification with
    one sanitized `group.eval_enqueue_failed` row; the next target job
    repairs the entry.
  - **Posture.** The table (RLS, no policies or grants, direct `42501`
    denial), the RPC grants and `security definer`, no internal grants, and no
    trigger on a Sync v2 table whose function touches certifications.
  - **Frozen masking.** A former member's stale Certified entry does not hide
    another member's `lead_change{certification}`; a raw edit that keeps a
    record's values refreshes its fingerprint.
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
  - device-side metrics (§5): the performed rule, parsing, and card values.
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
- **Linking flow (M25-T07).** The lane then runs
  `groups-link-exercise.yaml` as its own device user **`user_e`** (reset with
  the others by `groups-fixture-reset.sh`, which also sets its username).
  `.maestro/scripts/groups-link-setup.js` signs in as `user_e` over HTTP and
  calls `group_create` and `group_exercise_create` (a copy of
  `seed_barbell_bench_press`). The device then links its seeded "Barbell Bench
  Press" from the catalogue `⋮` Link screen (offered under Suggested), finds the
  group exercise in the session view's picker search (Train → Start →
  `+ Add exercise`) as "linked: Barbell Bench Press", and adds it to the
  session (`groups-link-01`…`04`).
- **As-built (M22-T06, Maestro lane).** Lane `ios-groups-e2e`
  (`maestro-run-lane.sh groups-e2e`, gate `slow-frontend`, so part of
  `boga test frontend`); flow `apps/mobile/.maestro/flows/groups-two-user-stream.yaml`.
  - **Counterparty.** `apps/mobile/.maestro/scripts/groups-counterparty.js`, one
    `runScript` file with steps `sign-in`, `join`, `push-active`,
    `push-complete-edit`, `latency`, and `assert-removed`. Maestro's JS HTTP
    proved workable, so the card's split-flow fallback was not needed.
  - **Data.** `push-active` sends one `sync_push`: a Bench definition, a
    completed history session started a day before the join, and the live
    session (Bench 100×5 ×2, Row 50×10: `3 sets · 1500 kg · 2 exercises`).
    The live session starts at `max(now, joined_at + 1 s)`, reading `joined_at`
    back from the counterparty's own "joined" stream item, so host/VM clock
    skew cannot push it before the join. `push-complete-edit` completes it
    (45 min), then edits the first set to 102.5 kg in a later push. The card
    then shows `Completed · 45m` and `1512.5 kg`, computed on the device (§5).
    The flow also
    asserts that the history session has no card (§2.5) and that the card
    stays after removal (#4).
  - **Device IDs.** The flow learns the group, member, and session ids from the
    script's `output` (the join's `group_id`, GoTrue's user id, the pushed
    session id) and addresses the §6.3 testIDs and `boga3://group/<id>` with
    them. The invite code is read with `copyTextFrom` on `group-invite-code`;
    iOS may return its accessibility label, which the script normalizes.
  - **Hermetic.** `supabase/scripts/groups-fixture-reset.sh` runs before each
    run with the service role. It deletes every group `user_c`/`user_d` created
    or belongs to (cascading §2.2–§2.4), deletes both users' Sync v2 rows
    child-first, clears `user_c`'s profile so the gate prompts, and sets
    `user_d`'s username. `dev_wipe_my_data` is not used: it needs `app.env`,
    which the local REST path does not set.
  - **Latency.** The script logs `GROUPS_E2E_LATENCY` (`sync_push` → card
    visible after one refresh, including Maestro's polling; since the groups UI
    iteration the flow refreshes the Groups screen by opening My groups and
    returning, which re-reads on focus, because a synthetic swipe does not
    reliably fire `RefreshControl` on the iOS 26 simulator) to
    `maestro-debug/**/maestro.log`. The observed values are on the M22-T06
    card; they are observed data, not a promise (§7).
- **As-built (M25-T08, flow extension).** Step 2 and 4 assert the header
  member count through `group-screen-members-link`. New step 4b: the device
  (owner) copies `seed_barbell_bench_press`, creates a custom per-side
  exercise, renames it, links the copy to the device's own seeded Barbell Bench Press
  through `Link your exercise` (the suggested exercise), and archives the copy
  (confirmed), asserting each row
  by its accessibility label (`<name>, <weight entry>[, archived], <link status>`). The counterparty's `assert-exercises` step then reads the same two
  exercises through `group_exercise_list` as a member. Step 8 opens Members
  from the header. No new fixture user. `groups-fixture-reset.sh` deletes the groups
  (cascading to `group_exercises`) and user_c's Sync v2 rows child-first,
  including the `exercise_group_links` row step 4b creates; `clearState`
  wipes the device.
- **As-built (M25-T09, flow extension).** New step 7b: the counterparty's
  `link-board` step pushes an `exercise_group_links` row linking its Bench
  Press (total load) to the active custom `Prowler Push` (per side), then polls
  `group_board` until the evaluator has written the row (51.25 kg × 5, factor
  0.5, uncertified; the row reads `51.25 × 5` since DLM-T12) and logs the push → board latency. The device opens
  Leaderboards (`No certified sets yet · 1 uncertified`, the archived copy's
  `No sets yet`), the board (Certified empty → `See all sets`), toggles Weight,
  and opens History (`… took #1 · 51.25 kg (linked Bench Press)`). New step 8b,
  after the removal, deep-links to the All · Weight board and asserts the row
  reads `(former)`.
- **As-built (M25-T10, flow extension).** Step 7b first waits for the stream's
  link item (`<user_d> linked Bench Press to Prowler Push — now #1 on Weight
  and 1RM`, since DLM-T11), then, on All · Weight, opens row 1's detail sheet: `Logged 102.5
  kg total · counted as 51.25 kg per side`, `Logged as "Bench Press"`, `Not
  certified yet`, and `Certify` for the owner, closed without certifying (a
  backdrop tap by point since DLM-T11: the sheet has no Close). Step
  8b opens the former member's row: no `Certify`. No new fixture user or
  counterparty step; certifying on device followed in M25-T11 (below).
- **As-built (M25-T11, flow extension).** New step 7c, after 7b's History and
  before the removal (a former member's set can't be certified, §4.6):
  - **Counterparty.** `push-record` pushes a new completed session on the
    already-linked Bench Press: one set of 110 kg × 5, created after the link,
    so §2.11 step 5 attributes a `record` (55 kg × 5 per side, a group record
    on Weight and e1RM). It polls `group_stream` until the record item is
    final (not provisional), asserts its payload, and outputs
    `groupsRecordKey`, `groupsRecordSessionCardKey`, and `groupsRecordSetId`.
    After the device certifies, `await-certified` polls the Certified · e1RM
    `group_board` until row 1 is that set, certified by someone other than
    the lifter. Like `link-board`, both poll every 250 ms (a busy wait:
    `runScript` has no sleep) and fail after 90 s, longer than the 30 s
    `pg_cron` sweep.
  - **Device.** The record card (`group-stream-record-card-<key>`: `—
    group record`, `Prowler Push` then `55.0 × 5 · 1RM …` (DLM-T11), `Not certified
    yet`) and its session card's `1 record`. Tapping the card's `Certify`
    shows the notice and `Certified by you`, and hides `Certify`. After
    `await-certified`: the podium's Certified · 1RM row 1, the Certified
    1RM and Weight boards (`55.0 × 5` since DLM-T12), the Certified history `… took #1 · 55 kg
    (certified by you)`, and on All · Weight the `certified` row whose sheet
    reads `Certified by you · …` and offers `Remove my certification`, not
    `Certify`. Step 8b's former row is now the certified 55 kg × 5 set.
  - Withdraw and cancel are not tapped on device; `groups-certification.sh`
    and jest cover them.
  - **Hermetic.** No new fixture user. `groups-fixture-reset.sh` deleting
    the groups cascades to `group_certifications` (and the M25 boards,
    events, and exercises); two consecutive lane runs in one slot pass.
  - **Latency** (`GROUPS_E2E_LATENCY` in `maestro.log`): `record
    sync_push->record item`, and `certify->certified board`, measured from
    the certification's server `certified_at` (so it includes the device's
    steps up to the script, and any host/VM clock skew). Observed on the
    M25-T11 PR; data, not a promise (§7).
- **Offline behaviour (AC12, AC13)** is proven in jest. Simulator network
  cannot be toggled reliably from Maestro.

## 9. Not built (carried forward)

- **Phase 2 live follow** needs either membership-scoped RLS `SELECT` policies
  for Realtime `postgres_changes` or a broadcast channel. That is decided in
  that milestone.
- **PR highlights** on stream cards. The M22 rule (a strict Wathan e1RM gain
  over the member's full completed history) needs history that is never shared
  into the group, so the viewer cannot compute it from shared data. Decide the
  mechanism with the PR work — for example, the athlete's device syncs a
  per-session PR summary — without reintroducing SQL mirrors of the TS set rules.
  M25 record cards (§4.2) are group-board records, not these history PRs.
- **Out of M25 scope (P19):** group gyms and gym filters, time-windowed boards,
  bodyweight or reps-only metrics, member proposals for group exercises,
  disputes, and push notifications.
- Phases 3 (links, §2.7, `sync-v2-server-contract.md` A.2.10), 4 (boards,
  §2.10–§2.11), and 5 (certification, §2.12, §4.6) shipped in M25.

## 10. Product rules (M25)

The M25 product spec's numbered rules and the technical design's decisions,
graduated when M25 closed so the P#, D#, E#, T#, and "M25 design §N"
references in this doc, `06`, `ui/*`, the code comments, and the M25
migrations resolve. Each line is the rule; the as-built sections are the
contract. The narrative sketches and design trade-offs are in git history
(deleted by the M25-T11 PR).

**Rules (P).**

| # | Rule |
| --- | --- |
| P1 | Owners and admins add group exercises (a copy of a standard exercise, or custom: name + weight entry), rename, and archive them. Archived: links and boards kept read-only, no new links (§2.7, §4.4). |
| P2 | A set counts for a group exercise only through a link from the exercise it was logged under. Several of my exercises may link to one group exercise; each of mine links to at most one per group (`sync-v2-server-contract.md` A.2.10). |
| P3 | Group exercises never appear in the default picker or catalogue lists: only in search, the Link screen, and the group page (E0). |
| P4 | Links are retroactive: every shared set of the exercise counts; unlinking removes them. Links survive leaving and are inactive until rejoin. |
| P5 | The group page is for managing the group: its header and Exercises; Members sits behind the header's member count. The stream and leaderboards are the Groups screen's Stream · Leaderboards, one group at a time (amended post-M25; was Stream · Exercises · Leaderboards). |
| P6 | Four boards per group exercise: Weight (heaviest for ≥ 1 rep) / e1RM × Certified / All. |
| P7 | One row per member (best set on that board): rank, name, value, date. Both scopes ranked; ties go to the earlier date; former members stay listed, marked former. |
| P8 | Leaderboards page: one podium card per group exercise on Certified · e1RM; tapping opens the full board (E1). |
| P9 | Each board has a history of who took #1, when, and with what (E1.3). |
| P10 | Only a record set (a board row or a record card) can be certified, by any current member other than the lifter. One certification is enough. |
| P11 | A certifier can remove their own certification; owners and admins can cancel any. No disputes. A cancelled set can be certified again. |
| P12 | A certification attests the weight × reps it saw; an edit or delete of the set voids it. |
| P13 | Certify from a board row or a stream record card: the same row detail (E2). |
| P14 | A shared set that beats the lifter's own best on a group exercise gets a record card; #1 in the group marks it a group record. A first counting set is a record. Cards appear while the session is in progress. |
| P15 | One card per record set, listing every board it broke; records are measured on All; certifying updates the card. |
| P16 | Sets that start counting because of a link produce no record cards; one link (or unlink) item says what changed. |
| P17 | A voided record keeps its card, marked voided, and a record-removed item says who now holds the record. Lead changes from voids, links, and certifications appear in history with that reason. |
| P18 | Certify and admin actions need a connection and fail clearly offline. Logging and linking work offline and affect boards once synced. |
| P19 | Out of scope: see §9. |

**Decisions (D).**

| # | Decision |
| --- | --- |
| D1 | A member's first counting set on a group exercise is a record. |
| D2 | Record cards appear during an in-progress session, as sets sync (provisional, §2.11). |
| D3 | Only record sets (board rows, record cards) can be certified. |
| D4 | A certification cancelled by an admin can be given again (a new row). |
| D5 | No claims, no disputes; one certification suffices; admins can cancel. |
| D6 | A weight-entry mismatch is converted to the group exercise's mode (per side × 2 = total; total ÷ 2 = per side) on Weight and e1RM; record detection uses converted values. |
| D7 | Superseded by D9. |
| D8 | Archiving keeps links and a read-only board; the exercise is no longer offered for new links. |
| D9 | Group exercises stay out of the default picker and catalogue lists; they appear in picker search (after my matches), on the Link screen, and on the group page's Exercises. |
| D10 | Group page = header + Exercises (management); Groups screen = one group, Stream · Leaderboards (amended post-M25). |
| D11 | Leaderboards page: one podium card per exercise on Certified · e1RM; full board on tap with both toggles. |
| D12 | Leaderboard history = lead changes per board only. |
| D13 | Picker search: group matches in a bottom section, plus a Groups toggle for group exercises only. |
| D14 | Members live in the group-page header (tap the member count). |
| D15 | A voided record keeps its card (marked voided) and adds a record-removed item; the lead change appears in history. |
| D16 | A link or unlink that moves the boards adds a link item; the lead changes appear in history. |
| D17 | Links are the member's own synced data: linking works offline. |

**Experiences (E).** As built in §6.3.

| # | Experience | As-built |
| --- | --- | --- |
| E0 | Linking, out of the way: every path ends at the Link screen or, while logging, the pick sheet | §6.3 M25-T07 |
| E0.1 | Picker search: a `From your groups` section after my matches, plus a Groups toggle | §6.3 M25-T07 |
| E0.2 | Pick sheet for an unlinked group exercise: suggested exercise, choose another, or add as new | §6.3 M25-T07 |
| E0.3 | Link screen from the catalogue `⋮` / exercise-page `⋮` menus: Linked, Suggested, All | §6.3 M25-T07 |
| E0.4 | Group page Exercises: my link status, `Link your exercise`, `Unlink…` with individual selection and confirmation | §6.3 M25-T08 and shared unlink contract |
| E1 / E1.1 | Leaderboards page: podium cards on Certified · e1RM, `You: Nth`, archived last | §6.3 M25-T09 |
| E1.2 | Full board: Weight/e1RM × Certified/All toggles in place, certified / uncertified mark on All, rows open E2 | §6.3 M25-T09, M25-T10 |
| E1.3 | History: one sentence per lead change, newest first | §6.3 M25-T09 |
| E2 | Row detail sheet shared by board rows and record cards: value, as logged, date · gym, logged as, certification line and actions, View full session | §6.3 M25-T10 |
| E3 | Stream record card with its session: title, value, badges, certification status, inline Certify | §6.3 M25-T10 |

**Design decisions (T).** From the M25 technical design.

| # | Decision | Where |
| --- | --- | --- |
| T1 | Group exercises are a separate `group_exercises` store sharing the TS domain type (`ExerciseCore`) with personal exercises | §2.7, §6.1 |
| T2 | Links are the Sync v2 entity `exercise_group_links` with a deterministic id | `sync-v2-server-contract.md` A.2.10 |
| T3 | The maths runs in the `group-eval` Edge Function, reusing the app's TS; records appear after sync | §2.10, `03` |
| T4 | Invocation: a `pg_net` kick from the enqueue trigger, backed by a `pg_cron` sweep | §2.8, §2.10, `03` |
| T5 | The stream is one persistent `group_events` table; session cards read their content live | §2.6, §4.2 |
| T6 | Lead changes are history only; voids and link changes get their own stream items | §2.11 |
| T7 | Boards are materialized, always recomputed per member and diffed | §2.11 |
| T8 | In-progress records are provisional; voids are written only for completed sessions | §2.11 step 3 |
| T9 | Evaluator tests are the `groups-leaderboards` slow-backend lane with direct drain; the Maestro lane gets one certify extension | §8 |

**Design sections → contract.** "M25 design §N" in comments and migrations
maps to: §0 overview → §1 and §2.6–§2.12; §1 group exercises → §2.7, §4.4;
§2 links → A.2.10, §6.1; §3 evaluator runtime → §2.8–§2.10; §4 stream →
§2.6, §4.2, §6.3 (M25-T10); §5 boards, edits, deletes → §2.11 and the
change table below; §6 certification → §2.12, §4.6; §7
mobile → §6.2, §6.3; §8 evaluator testing → §8; §9 decisions → the T table
above; §10 specs to update → done by M25-T11.

**Board change table (design §5; rows R1–R10, one `groups-boards.sh` section
each).** The evaluator recomputes a member's entries and derives events from
the diff plus the cause (T7; rules in §2.11).

| # | Change | Board effect | Events |
| --- | --- | --- | --- |
| R1 | A new set beats my best | entry improves | `record`; `lead_change{record}` if #1 moves |
| R2 | A record set edited down, unperformed, or deleted | entry falls back to my next best | `record_voided`; `lead_change{void}` if #1 moves |
| R3 | A record set edited up | same set, higher value | void the old record and write a new `record` |
| R4 | Session deleted / undeleted | its sets leave / return | voids / fresh records on return |
| R5 | Link / unlink (retarget) | entries appear, change, or drop | `link` / `unlink`; `lead_change{link}`; no record cards (P16) |
| R6 | Certification given / withdrawn / cancelled / voided | Certified entries change | `lead_change{certification}` if #1 moves (§2.11 Certified boards) |
| R7 | `load_input_mode` changed | my linked sets rescale | treated like an edit (§2.11 step 4) |
| R8 | Member leaves | none (P7) | — |
| R9 | Group exercise archived | entries frozen (D8) | — |
| R10 | `rules_version` bump | recompute | none (silent) |
