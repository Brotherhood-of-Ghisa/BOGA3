---
task_id: M25-T05-Boards_and_events
milestone_id: "M25"
status: planned
ui_impact: "no"
areas: "backend|frontend"
runtimes: "supabase|sql|deno|node"
gates: "./boga test fast, ./boga test backend, ./boga test ios-groups-e2e, ./boga test handles"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/06-testing-strategy.md"
---

# M25-T05 — Boards, record/void/link events, board and history reads

- Depends on: T04 (PR #291, merged). Milestone:
  `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`.
- Read: design §4 (T5, T6) and §5 (T7, T8); product P6–P9, P14–P17, D1, D2,
  D6, D8, D12, D15, D16, E1.1–E1.3, E3; `groups-contract.md` §2.6
  (`group_events`), §2.7 (`group_exercises`), §2.8–§2.10 (the evaluator and
  the apply seam), §3–§4 (posture, error tokens, `group_stream`).
- Builds on T01 (#287), T02 (#285), T03 (#286), T04 (#291), and T07 (#292).
  The client writes links offline, so a link reaches the boards at the next
  sync.

## Objective

Fill T04's apply seam, `group_eval_apply(group, member, group_exercise,
causes)`. For each `(group, member, group exercise)` target it:

1. recomputes the member's board entries from `group_set_facts`;
2. diffs them against the stored entries;
3. writes the resulting `record`, `record_voided`, `link`/`unlink`, and
   `lead_change` rows to `group_events`.

It also adds the board and history read RPCs, and teaches `group_stream` the
new item kinds. Certification stays out (T06): Certified entries exist in the
shape but T05 never writes one.

## Scope

### 1. Schema (new migration, `*_m25_group_boards.sql`)

Every new table follows ground rules 1–5 (no `owner_user_id`, no FK into
Sync v2, RLS on with no policies, no `anon`/`authenticated` grants,
`service_role` keeps CRUD).

**`group_board_entries`**: one row per `(group_exercise_id, member_user_id,
metric, certified)`, which is also the PK.

| Column | Notes |
| --- | --- |
| `group_id` | → `groups` `on delete cascade` |
| `group_exercise_id` | → `group_exercises` `on delete cascade` |
| `member_user_id` | → `auth.users` `on delete cascade` |
| `metric` | CHECK `in ('weight','e1rm')` |
| `certified` | `boolean not null`. T05 writes only `false`; T06 fills `true`. |
| `value_kg` | `numeric not null`, the ranked value: converted weight or converted e1RM, `round(…, 6)`. Stored as numeric so comparisons and cursors are exact. |
| `weight_kg`, `e1rm_kg` | Converted values (D6); `e1rm_kg` is null when the fact has none |
| `reps` | `numeric not null` |
| `entered_weight_kg` | The fact's weight in the member's own mode (E2 "as logged") |
| `load_factor` | CHECK `in (0.5, 1, 2)` |
| `set_id`, `session_id`, `session_exercise_id`, `exercise_definition_id`, `achieved_at_ms`, `exercise_order_index`, `set_order_index`, `fingerprint` | Copied from the winning fact |
| `updated_at` | |

Index `(group_exercise_id, metric, certified, value_kg desc, achieved_at_ms,
member_user_id)`, which is the rank order.

**`group_board_state`**: PK `(group_exercise_id, member_user_id)`, plus
`group_id`, `linked_definition_ids text[]` (the member's live linked
exercises at the last apply), and `applied_at`. It exists for link
attribution (§3).

**`group_events` additions.** The T02 table and CHECKs are extended:

| Column | Notes |
| --- | --- |
| `seq` | `bigint generated always as identity`, unique. Gives history order and its cursor, with no same-millisecond ties. |
| `group_exercise_id` | `uuid null` → `group_exercises` `on delete cascade` |
| `set_id` | `text null` |
| `metric`, `certified` | `lead_change` only |
| `reason` | `lead_change`: `record\|void\|link\|certification`. `record_voided`: `edited\|deleted`. |
| `related_event_id` | `uuid null` → `group_events(id)` `on delete cascade`. `record_voided` → its record; `lead_change` → the record, void, or link item that caused it, if any. |
| `payload` | `jsonb null`: the snapshots below |

Each new kind gets a shape CHECK, plus a unique index giving one
`record_voided` per record. `sort_at_ms` is:

- `record`: the session's `started_at` when written (E3);
- every other new kind: the time it happened.

**Payloads.** `Holder = { member_user_id, value_kg, weight_kg, reps,
e1rm_kg, achieved_at_ms, set_id, session_id }`.

| Kind | Payload |
| --- | --- |
| `record` | `{ boards: [{ metric, value_kg, previous_value_kg\|null, group_record }], weight_kg, reps, e1rm_kg, entered_weight_kg, load_factor, fingerprint, achieved_at_ms, session_exercise_id, exercise_definition_id }` |
| `record_voided` | `{ record: { weight_kg, reps, e1rm_kg }, leaders: [{ metric, leader: Holder\|null }] }`, covering the boards the record listed |
| `link` / `unlink` | `{ exercise_definition_ids: [...], effects: [{ metric, before: { rank, value_kg }\|null, after: { rank, value_kg }\|null }] }` |
| `lead_change` | `{ leader: Holder\|null, previous: Holder\|null }`. Its `member_user_id` is the member whose change caused it. A null `leader` means the board emptied. |

### 2. Board rules

- **Counting set** for target `(G, M, GX)`, one board at a time. All of:
  - the fact is performed and live;
  - its Sync v2 set row still exists (a hard delete leaves a dangling fact);
  - its session is shared into G (`group_session_shares`);
  - its `exercise_definition_id` has a live link to `(G, GX)`, read through
    `group_eval_try_uuid`;
  - the metric's value is present and above zero: the **Weight** board needs
    `weight_kg > 0` (a 0 kg set is not "weight lifted"; bodyweight metrics
    are P19), and the **e1RM** board needs a non-null `e1rm_kg`.
- **D6 conversion.** The factor compares the member's exercise's *current*
  `exercise_definitions.load_input_mode` with the group exercise's mode:
  - the same mode gives 1;
  - per side → total gives 2;
  - total → per side gives 0.5.

  One factor applies to weight and e1RM (Wathan is linear), and record
  detection uses converted values.
- **A member's best** is the highest `value_kg`. Ties go to the earlier
  `achieved_at_ms`, then `exercise_order_index`, then `set_order_index`,
  then `set_id` (P7).
- **Rank** is `value_kg desc, achieved_at_ms asc, member_user_id asc`, so
  ranks are strict: 1..n with no shared ranks.
- **Former members** keep their entries and are ranked and flagged `former`
  (P7). Their targets are not live (T04), so their entries freeze.
- **Archived boards are frozen** (D8), via T04 liveness: an apply never runs
  for an archived target, and the reads still serve it.

### 3. The apply: recompute and diff

Inside `group_eval_apply`, in this order:

1. **Lock.** `pg_advisory_xact_lock(<M25 board key>,
   hashtext(group_id::text))`, which serializes every apply in a group. A
   session job applies its targets in `group_id` order (T04 already orders
   them), so locks are always taken in the same order and cannot deadlock.
2. **Snapshot.** Read the old entries, the old #1 per All board, and
   `prev_links` (from `group_board_state`). Then recompute the new entries
   and `cur_links`.
3. **Provisional records (T8).** A record is *provisional* while its
   session's row has `status = 'active'` (tombstoned or not). For each
   non-voided provisional record of the target:
   - if its set still counts and still beats `previous_value_kg` on at least
     one listed board, **update it in place**: values, fingerprint, the
     boards still beaten, and `group_record`, plus the leader snapshot of
     every `lead_change` that references it;
   - otherwise **delete it**, which cascades to its `lead_change` rows.
     This is the one case where the app deletes events. There is no void.
4. **Voids.** For each non-voided *final* record, compare its set's current
   fact with the record's snapshot:
   - fact missing or not live: write `record_voided{deleted}`;
   - not performed, a different fingerprint, or a different converted value
     (a load-mode change): write `record_voided{edited}`.

   Unlinking never voids: the lift happened.
5. **Diff and attribute, per All metric.** Compare the old entry O with the
   new entry N:
   - N's exercise is not in `prev_links`: **link** effect;
   - O's exercise is not in `cur_links`: **unlink** effect;
   - otherwise, N beats O (or there is no O, which is D1), or N is O's set
     at a higher value: **record** effect;
   - otherwise, the entry fell or vanished: **void** fallback.

   Then write:
   - one `record` per new-best set, listing the boards it beat, where
     `group_record` means the member is #1 on that board after the apply
     (P14, P15);
   - one `link` item when any link effect occurred, and one `unlink` item
     when any unlink effect occurred. Link-attributed changes never produce
     a `record` (P16), and a link that moves no entry writes no item.
6. **Write.** Upsert or delete the entries, then write `group_board_state`.
7. **Lead changes, per All board.**
   - "Before" is the old #1 member. If step 3 deleted the board's latest
     `lead_change`, "before" is that row's `previous` instead.
   - If "before" differs from the new #1, write `lead_change`. Its `reason`
     is `record`, `void`, or `link`, from the attribution of the change that
     moved #1, and it points at that event.
   - Lead changes appear in history only (T6).
8. **Silent recompute.** When `causes = {rules}` exactly (T04 rules
   requeue), steps 3–5 and 7 write no events. Entries and state are still
   written.

### 4. Catch-up enqueues

These apply changes that happened while a board was frozen. Both are
failure-isolated like §2.10 and use cause `link`, so they get normal
attribution.

- `group_exercise_unarchive`, when it actually unarchives, enqueues a target
  job for every live link into the exercise. For example, sets logged while
  archived become records, placed at their session start.
- A new membership period (a rejoin) enqueues target jobs for the member's
  live links into that group. This applies links changed and shared sessions
  edited while the member was away.
- Archive and leave enqueue nothing: the board freezes.

### 5. Read RPCs

The §3 posture applies: `security definer`, pinned `search_path`, execute
granted to `anon`, `authenticated`, and `service_role`. The check order is:

1. the preamble (`AUTH_REQUIRED`, `AGENT_FORBIDDEN`);
2. active membership, else `NOT_FOUND: group not found` (non-member ≡
   removed ≡ nonexistent);
3. `VALIDATION`;
4. the target, else `NOT_FOUND: group exercise not found` (another group's
   exercise looks nonexistent).

Archived exercises are readable.

`BoardRow = { rank, member: { user_id, username }, former, value_kg,
weight_kg, reps, e1rm_kg, entered_weight_kg, load_factor, achieved_at_ms,
session_id, set_id, exercise_name, certified }`. `exercise_name` is read live
from `session_exercises.name` ("Logged as"; null if gone). `certified` is
`false` everywhere until T06.

| RPC | Returns |
| --- | --- |
| `group_board_podiums(p_group_id, p_metric default 'e1rm', p_certified default true)` | `{ metric, certified, exercises: [{ exercise: GroupExercise, podium: BoardRow[≤3], me: BoardRow\|null, entry_count, all_entry_count }] }`. Every group exercise, in the `group_exercise_list` order (active first). `me` is the caller's row whenever they are ranked. `all_entry_count` is the same metric on All, for "No certified sets yet · 3 uncertified". |
| `group_board(p_group_id, p_group_exercise_id, p_metric, p_certified, p_after, p_limit)` | `{ exercise, metric, certified, rows: BoardRow[], next_cursor, has_more }`. `p_limit` is `1..100`, default `50`. The cursor is `{ value_kg, achieved_at_ms, member_user_id }`. Ranks are absolute. |
| `group_board_history(p_group_id, p_group_exercise_id, p_metric, p_certified, p_before, p_limit)` | Newest first: `{ items: [{ key, seq, occurred_at_ms, reason, leader, previous, related }], next_cursor: { seq }\|null, has_more }`. `leader` and `previous` are `Holder + member { user_id, username }`, or null. `related` is a `{ kind, key, … }` summary: the void reason, the voided record's values, or the linked exercise names. `p_limit` is `1..50`, default `20`. |

Validation messages cover: metric not `weight`/`e1rm`, a null `p_certified`,
`p_limit` out of range, and a malformed cursor.

### 6. `group_stream` returns the new kinds

- **Wire kinds:** `record`, `record_voided`, and `link` (with `event: link |
  unlink`). `lead_change` is never a stream item. Keys are the event id. The
  cursor's `kind` accepts all five wire kinds. The order is unchanged
  (`sort_at_ms desc, kind asc, key desc`, "C" collation).
- **Scope:** as today. Items are per group: a record is about one group's
  board, so All does not dedupe them.
- **`record`** sorts at the live `sessions.started_at` while the row exists
  (tombstoned included), else at its stored position. It stays visible after
  a void or a session delete (D15). Shape:

  ```jsonc
  { kind, key, sort_at_ms, group, member,
    group_exercise: { group_exercise_id, name, load_input_mode },
    session_id, set_id, weight_kg, reps, e1rm_kg, entered_weight_kg,
    load_factor, achieved_at_ms, boards,
    provisional, voided: { key, reason, occurred_at_ms } | null, certified: false }
  ```

- **`record_voided`:** `{ kind, key, sort_at_ms, group, member,
  group_exercise, record_key, reason, record, leaders }`, where each leader
  carries `member { user_id, username }`.
- **`link`:** `{ kind, key, sort_at_ms, event, group, member, group_exercise,
  exercises: [{ exercise_definition_id, name }], effects }`. `name` is read
  live from `exercise_definitions` (null if gone); the member chose to link
  that exercise into the group.

### 7. Mobile guard (small, required)

Today the stream view model renders every non-`session` item as a membership
row (`stream-view-model.ts:184`, `group-stream-list.tsx:70`). `getGroupStream`
in `src/groups/api.ts` must drop items whose `kind` is not `session` or
`membership` before callers see them. Current builds then render the stream
unchanged, and T10 renders the new kinds. Jest covers the guard.

Out of scope: certification and Certified entries (T06), any leaderboard or
record UI (T09, T10), and changes to the queue, facts, or `group-eval` beyond
what apply needs.

## Acceptance criteria

Everything below is proven in `groups-leaderboards`, in direct-drain mode
with the shared fixtures, and uses a second member so #1 can move. The lane
may run a second script for the boards sections. Assertions read entries,
`group_events`, and the read RPCs.

1. **Design §5 change table, one named lane section per row:**

   | # | Change | Assert |
   | --- | --- | --- |
   | R1 | A new set beats my best | `record` listing the boards it beat, with `previous_value_kg` and `group_record`. A first counting set is a record (D1). `lead_change{record}` only when #1 moves. A set that doesn't beat my best writes nothing. |
   | R2 | A record set is edited down, made unperformed, or deleted (completed session) | `record_voided{edited\|deleted}` pointing at the record. The entry falls back to my next best. `lead_change{void}` only when #1 moves. The record card stays, marked voided. |
   | R3 | A record set is edited up (completed) | Void of the old record plus a new `record` for the same set |
   | R4 | A session is deleted, then undeleted | Voids for its records, then fresh records on return |
   | R5 | Link, unlink, retarget | A `link`/`unlink` item with `effects`, `lead_change{link}`, and **no** `record` rows. A link that moves no entry writes no item. |
   | R6 | Certification | T06. Asserts no Certified entry exists and Certified podiums are empty with `all_entry_count` set. |
   | R7 | `load_input_mode` changed | Rescales like an edit: up gives void + record, down gives void. Values match D6. |
   | R8 | A member leaves | No events. Entries stay, and the board shows the member ranked with `former: true`. |
   | R9 | The group exercise is archived | Pushes while archived change no entry and write no event, and the reads still serve the board. After unarchive, the catch-up applies them (§4). |
   | R10 | A `rules_version` bump | The recompute corrects entries and writes zero events. |

2. **Provisional (T8), in an active session:**
   - a typo record that is then fixed down disappears with its `lead_change`,
     and no void is written;
   - a record edited up updates the same event in place;
   - once the session completes, the next edit voids.
3. **D6 conversion and ties (P7):** per side → total ×2 and total → per side
   ÷2, for weight and e1RM, with `entered_weight_kg` kept. Equal values rank
   the earlier `achieved_at_ms` first. Within one member, exercise order,
   then set order, picks the best.
4. **Rejoin catch-up:** a link changed while the member was away applies on
   rejoin, with normal attribution.
5. **Serialization:** while the group's advisory lock is held from a second
   session, an apply under `lock_timeout` fails with `55P03`, which proves
   the lock is taken. A forced apply failure fails the job, which is kept and
   retried, while `sync_push` still commits.
6. **Reads:**
   - shapes and ranks, `me`, and archived exercises;
   - board and history keyset paging: two pages concatenate to the full list
     with no duplicates;
   - error tokens: `AUTH_REQUIRED`, `AGENT_FORBIDDEN`, `NOT_FOUND` (for a
     non-member, a removed member, and another group's exercise), and
     `VALIDATION` (for metric, certified, limit, and cursor).
7. **Stream:**
   - the new kinds come back with their shapes, and the cursor accepts them;
   - `lead_change` never appears;
   - a voided record stays visible after its session is tombstoned;
   - every existing `groups-contract` stream assertion passes unchanged.
8. **Posture:**
   - the new tables and functions follow §2–§3;
   - apply internals have no client or service grants;
   - direct PostgREST access is denied;
   - `sync-drift --strict` stays green.
9. **Mobile guard:** jest proves unknown kinds are dropped. `ios-groups-e2e`
   stays green with no flow changes.
10. **Gates:** every lane `./boga test for` requires is green, plus
    `./boga test handles`.

## Docs touched

- `groups-contract.md`:
  - §1;
  - §2.6 (new kinds and columns);
  - a new §2.11 (boards and state);
  - §2.10 (the apply as built, catch-up enqueues);
  - §4.2 (stream kinds);
  - a new §4.5 (board reads);
  - §6.1 (the guard);
  - §8.
- `03`: a decision register row for materialized boards, recompute-and-diff
  (T7, T8).
- `05`: the new group tables, out of sync scope.
- `06`: the `groups-leaderboards` coverage.
- Delete this card in the PR.
