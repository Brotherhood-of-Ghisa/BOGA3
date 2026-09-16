---
task_id: M25-T06-Certification
milestone_id: "M25"
status: planned
ui_impact: "no"
areas: "backend"
runtimes: "supabase|sql"
gates: "./boga test fast, ./boga test backend, ./boga test ios-groups-e2e, ./boga test handles"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/10-api-authn-authz-guidelines.md, docs/specs/03-technical-architecture.md, docs/specs/05-data-model.md, docs/specs/06-testing-strategy.md"
---

# M25-T06 — Certification (server)

- Depends on: T05 (PR #294, merged). Milestone:
  `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`.
- Read: design §5 (the change table's certification row) and §6; product
  P10–P13, D3, D4, D5, E2; `groups-contract.md` §2.6, §2.8–§2.11, §3, §4
  (error tokens), §4.2 (record items), §4.5 (board reads).
- Builds on what T05 left ready: `group_board_entries` already has
  `certified` in its key, but every Certified row is empty;
  `lead_change.reason` already allows `certification`; `record` payloads
  carry the set's `fingerprint`; voids are value-based (§2.11 step 4);
  `BoardRow.certified` and the stream's `record.certified` are `false`
  placeholders; the apply runs under `pg_advisory_xact_lock(25005,
  hashtext(group_id))`; `causes = {rules}` is a silent recompute.

## Objective

Members certify each other's record sets. A certification pins the raw
values it attested. The evaluator voids it when the set changes, and the
Certified boards rank only certified sets. Certify, withdraw, and cancel are
RPCs. Each one enqueues a re-evaluation of the lifter's board target, and
`lead_change{certification}` records who took #1. `BoardRow`, podiums, and
stream record items report certification for real. No client work: T10 adds
the wrappers and UI.

## Scope

### 1. Schema (new migration `*_m25_group_certification.sql`)

**`group_certifications`** follows ground rules 1–5: no `owner_user_id`, no
FK into Sync v2, RLS on with no policies, no `anon` or `authenticated`
grants, and `service_role` keeps CRUD.

| Column | Notes |
| --- | --- |
| `id` | `uuid` PK, `certification_id` on the wire |
| `group_id` | → `groups` `on delete cascade` |
| `group_exercise_id` | → `group_exercises` `on delete cascade`: the board target the set was a record set of |
| `member_user_id` | The lifter. → `auth.users` `on delete cascade` |
| `set_id`, `session_id` | `text not null`, in the lifter's keyspace (no FK, rule 2) |
| `certified_by` | `uuid null` → `auth.users` `on delete set null`. CHECK `certified_by is distinct from member_user_id`. |
| `pinned_fingerprint` | `text not null`: `group_set_fingerprint(weight_value, reps_value, performance_status, deleted_at)` of the live set row at certify time |
| `pinned_weight_value`, `pinned_reps_value`, `pinned_performance_status` | The raw synced values it attested (text, nullable as synced) |
| `weight_kg`, `reps`, `e1rm_kg` | `numeric`: the converted snapshot the certifier saw (the record set's entry or record payload) |
| `certified_at` | `timestamptz not null default now()` |
| `ended_at`, `end_reason`, `ended_by` | `end_reason in ('withdrawn','cancelled','voided')`. `ended_at` and `end_reason` are null together. `ended_by` (→ `auth.users on delete set null`) is null for `voided`. `ended_at >= certified_at`. |

Indexes:

- unique `(group_exercise_id, member_user_id, set_id) where ended_at is
  null`, so a set has at most one active certification per board target;
- `(group_id)`.

An ended certification is never reopened. Re-certifying inserts a new row
(D4).

**Other changes:**

- `group_eval_queue` causes CHECK: add `certification`.
- `group_board_state`: add `certification_ids uuid[] not null default '{}'`,
  the target's active certification ids at the last apply, used for
  attribution (§3).
- `group_events.lead_change` payload may carry `certification_id` (§3). No
  shape-CHECK change is needed.

### 2. RPCs

The §3 posture applies: `security definer`, a pinned `search_path`, and
execute granted to `anon`, `authenticated`, and `service_role`. Helpers get
no grant. Each write locks the `groups` row (`group_require_member(…,
true)`). None takes the board advisory lock: they only write
`group_certifications` and enqueue.

`Certification = { certification_id, group_id, group_exercise_id, member,
set_id, session_id, certified_by: Member ref | null, certified_at_ms,
pinned: { weight_value, reps_value, performance_status, weight_kg, reps,
e1rm_kg }, ended_at_ms, end_reason, ended_by: Member ref | null }`, where a
Member ref is `{ user_id, username }`.

| RPC | Allowed | Returns |
| --- | --- | --- |
| `group_certify(p_group_id, p_group_exercise_id, p_member_user_id, p_set_id)` | any current member except the lifter | `{ certification, created }` |
| `group_certification_withdraw(p_group_id, p_certification_id)` | the certifier | `{ certification }` |
| `group_certification_cancel(p_group_id, p_certification_id)` | owner, admin (any certification) | `{ certification }` |

**`group_certify` check order:**

1. The preamble: `AUTH_REQUIRED`, `AGENT_FORBIDDEN`.
2. Caller membership, locking the group: `NOT_FOUND: group not found`.
3. Input: `VALIDATION` for a null member or set id, then `VALIDATION: you
   cannot certify your own set` when the lifter is the caller.
4. The target: `NOT_FOUND: group exercise not found` (another group's
   exercise looks nonexistent). An archived exercise gets `VALIDATION: an
   archived group exercise is read-only; unarchive it first` (D8).
5. The lifter must be a current member, else `NOT_FOUND: member not found`.
   A former member's board is frozen.
6. **Record-set check (D3).** The set must have a non-voided `record` event,
   or a current All entry, for `(group exercise, lifter, set)`. Otherwise it
   gets `NOT_FOUND: record set not found`: a non-record set, an unknown set,
   and another member's set id all give the same body.
7. **Idempotent.** If an active certification of that set on that target
   already exists, whoever gave it, return it with `created: false`. One
   certification is enough (P10), so two members who tap Certify at the same
   time both succeed.
8. **The set must not have changed.** The lifter's live `exercise_sets` row
   must exist, and its fingerprint must equal the record set's (the All
   entry's fingerprint when the set holds one, else the record payload's).
   Otherwise `CONFLICT: the set changed; refresh and try again`. This is a
   new token: the evaluator has not caught up with an edit or delete yet.
9. Insert, pinning the live row's raw values and the snapshot. Enqueue (§4).
   Return `created: true`.

**`group_certification_withdraw` and `group_certification_cancel` check
order:**

1. The preamble.
2. Membership, locking the group: `NOT_FOUND: group not found`.
3. `cancel` only: the role must be owner or admin, else `FORBIDDEN`.
4. `VALIDATION` for a null id.
5. The certification must be in this group, else `NOT_FOUND: certification
   not found`.
6. `withdraw` only: the caller must be `certified_by`, else `FORBIDDEN: only
   the certifier can withdraw a certification`. Admins use cancel.
7. **Idempotent.** An ended certification is returned unchanged, and its
   first end is kept.
8. Set `ended_at = now()`, `end_reason` (`withdrawn` or `cancelled`), and
   `ended_by = caller`. Enqueue (§4).

Withdraw and cancel work on frozen targets too (a former lifter, an archived
exercise). The row ends at once, and the reads stop counting it (§5).

**Error tokens.** Add `CONFLICT` to the §4 table. Existing tokens are unchanged.

### 3. The apply: voids and Certified entries

Add these steps inside `group_eval_apply`, under the existing group lock. They
run for every apply, including a silent one, and write no stream item.

1. **Void on fingerprint mismatch.** For each active certification of the
   target `(G, M, GX)`, set `ended_at = now()` and `end_reason = 'voided'`
   (with `ended_by` null) when any of these holds:
   - its fact is missing;
   - its Sync v2 set row is gone;
   - the fact is not `live`, so a deleted session voids it too;
   - `fact.fingerprint <> pinned_fingerprint`, which covers an edited set,
     an unperformed set, and a tombstoned set.

   Undelete never revives a certification. An unlink or a retarget voids
   nothing: the certification simply stops counting while the set does not
   count on GX. A load-mode change rescales the certified value but does not
   void, because the raw values are unchanged.
2. **Recompute the Certified entries** with the All rules (§2.11: counting
   set, D6, best, P7), restricted to counting sets that have an active
   certification on `(GX, M, set_id)` with `pinned_fingerprint =
   fact.fingerprint`. Then delete and reinsert the member's `certified =
   true` rows next to the All rows.
3. **`lead_change` on Certified boards.** Snapshot each Certified board's #1
   before the recompute and read it again after. When the #1 member moved,
   write one `lead_change` with `certified = true`, where `member_user_id` is
   M. Its `reason`:
   - `certification` when the target's active certification ids differ from
     `group_board_state.certification_ids` (a certification given or ended,
     including a void in step 1). `payload.certification_id` names the
     certification that moved it: M's new entry's certification when M took
     #1, else the ended certification of M's old entry's set.
     `related_event_id` is null;
   - otherwise, if the All attribution for that metric was `link` or
     `unlink`: `link`, pointing at that item;
   - otherwise, the All class (`record` or `void`), falling back to
     `certification`.
4. Write `certification_ids` into `group_board_state`.
5. A silent apply (`causes = {rules}`) does steps 1, 2, and 4 but writes no
   `lead_change`, like the All boards.

**Frozen targets.** A former lifter's or an archived exercise's target never
applies (T04 liveness). A certification ended there drops out of the reads
at once (§5), but the member's next-best certified set is not promoted, and
no `lead_change` is written, until a catch-up re-applies the target (rejoin
or unarchive). Both catch-ups already enqueue every target with board state.
Voids for sets edited while frozen also wait for that catch-up.

### 4. Enqueue from the RPCs (failure-isolated)

A new helper `group_certification_enqueue(certification)` calls
`group_eval_enqueue_target(lifter, group, group exercise, 'certification')`
inside its own `begin … exception` block. On failure it writes one
`group.eval_enqueue_failed` row with `context = {table:
'group_certifications', row_id, sqlstate}` (never `SQLERRM`) and returns
normally. After a successful enqueue it calls `group_eval_kick_once`. The
certification write always commits.

- **Repair:** any later job for that target (a push, a link change, another
  certification) recomputes the Certified entries from
  `group_certifications`. The reads never show an ended certification in the
  meantime (§5).
- **No Sync v2 touch point.** Certification adds no trigger on a Sync v2
  table, and nothing on the `sync_push` path changes. Voids run only inside
  the evaluator's apply.

### 5. Reads report certification

- **Valid Certified entry.** A `certified = true` entry counts only while an
  active certification exists on `(GX, M, set_id)` with `pinned_fingerprint
  = entry.fingerprint`. Certified board reads, ranks, podium `entry_count`
  and `me`, and the apply's Certified leader and rank all ignore an invalid
  entry. That keeps withdraw and cancel immediate on live and frozen boards
  alike.
- **`BoardRow`** (podiums and full boards, both boards):
  - `certified` is true when an active certification matches the row's
    `(GX, member, set_id, fingerprint)`;
  - a new field, `certification: { certification_id, certified_by: Member
    ref | null, certified_at_ms } | null`, gives E2 "Certified by Sam ·
    12 Sep" and lets the client tell whether the certification is the
    caller's own, so it can offer Remove.
- **Stream `record` items** get the same `certified` and `certification`,
  matched on the record's `(GX, member, set_id, payload.fingerprint)`. A
  voided record reads `certified: false` once its certification is voided.
- **`group_board_history`**: for a `certification` lead change, `related` is
  `{ kind: 'certification', key: certification_id, event: 'certified' |
  'withdrawn' | 'cancelled' | 'voided', certified_by, ended_by, set_id,
  weight_kg, reps, e1rm_kg }`, read live from `group_certifications`.

Out of scope: client wrappers, error mapping for `CONFLICT`, and UI (T10);
disputes and multiple active certifications per set (D5); Maestro changes
(T11).

## Acceptance criteria

The tests live in a new lane body, `supabase/tests/groups-certification.sh`,
the third body of `groups-leaderboards`. It runs in direct-drain mode with
the shared fixtures and per-run users: lifter, rival, certifier, admin,
owner, and outsider. Assertions read `group_certifications`,
`group_board_entries`, `group_events`, `app_logs`, and the RPCs.

1. **Self-certify rejected.** The lifter certifying their own set gets
   `VALIDATION`, and no row is written.
2. **Non-record set rejected.** A performed set that holds no entry and has
   no record gets `NOT_FOUND: record set not found`, as does an unknown set
   id. A voided record set that holds no entry is rejected the same way, and
   one that still holds an entry is accepted.
3. **Non-member rejected.** An outsider and a removed member get `NOT_FOUND:
   group not found` on all three RPCs. A token with a `client_id` gets
   `AGENT_FORBIDDEN`, and no token gets `AUTH_REQUIRED`. Another group's
   exercise gives `NOT_FOUND: group exercise not found`; an archived one gives
   `VALIDATION`; a former lifter gives `NOT_FOUND: member not found`.
4. **Certify happy path.** Certify returns `created: true` with the pinned
   raw values. After a drain:
   - a Certified entry exists and the Certified podium shows it;
   - `BoardRow.certified` and `certification` are set on both boards, and
     the stream record item reads `certified: true`;
   - `lead_change{certification, certified: true}` is written when #1
     moves, and history `related.kind = 'certification'`.

   A second certify, by the same member or another, returns `created: false`
   with the same row.
5. **Withdraw.** The certifier withdraws: `end_reason = withdrawn` and
   `ended_by = certifier`, the Certified entry disappears from the reads
   before any drain, and after a drain the member's next-best certified set
   takes the entry, with `lead_change{certification}` when #1 moves.
   Another member withdrawing gets `FORBIDDEN`, including an admin. A repeat
   withdraw is idempotent.
6. **Admin cancel.** An admin and the owner can cancel any certification
   (`cancelled`, `ended_by` the canceller). A plain member gets `FORBIDDEN`,
   and a repeat cancel is idempotent.
7. **Re-certify after cancel (D4).** A cancelled set can be certified again,
   which creates a new row with `created: true`. The old row stays ended, and
   the Certified entry returns after a drain.
8. **Void on edit.** Editing the certified set's weight or reps (a completed
   session) pushes and drains to `end_reason = voided` with `ended_by` null,
   removes the Certified entry, writes `lead_change{certification}` when #1
   moves, and makes the stream record read `certified: false`. The same
   holds for an active session. An edit pushed but not yet drained gives
   `CONFLICT` on a fresh certify of that set.
9. **Void on delete.** A set tombstone voids the certification, and so does a
   session tombstone (the fact is not `live`). Undeleting does not revive
   it.
10. **Non-voiding changes.** Unlinking and then relinking keeps the
    certification active: the entry leaves, then returns. A load-mode change
    rescales the Certified value without a void. A rules recompute voids
    nothing that still matches and writes no `lead_change`.
11. **Frozen targets.** Cancelling a former member's certification removes
    their row from the Certified reads at once, with no apply needed.
12. **Failure isolation.** Under a forced enqueue failure (a temporary `check
    (false) not valid` on `group_eval_queue`), certify still commits and
    exactly one sanitized `group.eval_enqueue_failed` row is written
    (`table: group_certifications`). The next target job repairs the entry.
    `sync_push` is untouched: the existing `groups-leaderboards` and sync
    lanes stay green.
13. **Posture.**
    - The new table: RLS on, no policies, no client grants, direct PostgREST
      access denied.
    - The three RPCs: `security definer`, a pinned `search_path`, and the
      client grants.
    - The helpers: no client or service grant.
    - `sync-drift --strict` stays green.
14. **No regressions.** Every existing `groups-boards.sh` assertion passes.
    T05's R6 "Certified boards empty" check is replaced by the sections
    above.
15. **Gates:** every lane `./boga test for` requires is green, plus
    `./boga test handles`.

## Docs touched

- `groups-contract.md`:
  - the §1 as-built status line;
  - §2.8 (the `certification` cause);
  - a new §2.12, `group_certifications` and its rules;
  - §2.11 (Certified entries, the voids, `lead_change{certification}`,
    `certification_ids`, the frozen limit);
  - §4, the `CONFLICT` token;
  - §4.2, the record item's `certified` and `certification`;
  - §4.5, `BoardRow` and history `related`;
  - a new §4.6 for the certification RPCs;
  - §8, the certification body.
- `10`: a rule for certification authz (current member, not the lifter;
  certifier withdraws; owner or admin cancels; frozen and self rules).
- `03`: a decision register row for pinned-fingerprint certification voided
  by the evaluator.
- `05`: the new table, out of sync scope.
- `06`: the `groups-leaderboards` coverage.
- `scripts/lanes.tsv`: the new body on `groups-leaderboards`.
- Delete this card in the PR.
