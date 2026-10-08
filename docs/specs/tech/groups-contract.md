# Groups Contract

> **Owns:** the group domain's rules — share ledger, stream, evaluator, boards,
> certification, comparisons, RPC conventions, mobile client boundary.
> **Not here:** what the code states (columns, SQL, wire shapes, messages,
> tests). **Load when:** changing group tables, triggers or RPCs,
> `supabase/functions/group-eval/`, or `apps/mobile/src/groups/`.

| If you need… | Source |
| --- | --- |
| Tables, constraints, grants, function bodies | the group migrations in `supabase/migrations/` |
| Wire shapes | `apps/mobile/src/groups/types.ts`, `metric-wire.ts`, `competition-wire.ts` |
| Protocol-4 metrics, units, disclosure, history (changing competition scoring or readers) | [group-competition-contract.md](group-competition-contract.md) |
| Bodyweight policy and privacy (changing group bodyweight scoring) | [bodyweight-load-contract.md](bodyweight-load-contract.md) |
| Authorization baseline | `docs/specs/10-api-authn-authz-guidelines.md` rules 15–19 |
| Routes, screens, wording (changing group UI) | `docs/specs/ui/screen-map.md`, `docs/product/copy.md`, the group components (`apps/mobile/components/groups/`) |
| Performed / working / parsing rules | [training-metrics-contract.md](training-metrics-contract.md) |
| Diagnostics triage and repair | `RUNBOOK.md` |
| Lanes and what they prove | spec `06`; the `supabase/tests/groups-*.sh` and flow headers |

## Design

The group record is a server-side **share ledger**, `group_session_shares`,
written by a trigger on `app_public.sessions` when a member's session arrives
through `sync_push`. Nothing is copied: group reads read through to the
member's own live Sync v2 rows. So the group owns a permanent record that
nothing recomputes from membership; sessions update until complete; edits,
deletes and undeletes flow through; membership at logging time decides; and
personal sync never changes (no second push path, every group trigger on a
Sync v2 table failure-isolated).

The stream is one persistent table, `group_events`. All access goes through
`SECURITY DEFINER` RPCs. Devices pull (focus, 30 s poll, pull-to-refresh) into
a disposable cache; there is no Realtime. The `group-eval` Edge Function
normalizes shared sets with the app's TS and materializes the boards.

Rejected: per-group copies of sessions (every autosave re-pushes the graph:
diffing and N copies); a client-pushed group projection (a second write path
that risks personal sync); querying sessions by membership window (no owned
record, no stable stream index); group rows as Sync v2 entities (per-owner LWW
cannot hold multi-reader server rows); an Edge Function group API
(authorization in app code instead of the database).

## Server rules

1. **No `owner_user_id` column**: the drift checker treats any `app_public`
   table with one as a Sync v2 entity.
2. **No FK into Sync v2 tables**: readers inner-join live rows, so rows left by
   a hard delete (`dev_wipe_my_data`, account deletion) are invisible.
3. RLS on, no policies, nothing granted to `anon`/`authenticated`.
4. CHECKs are allowed (the server is the only writer). Group timestamps are
   `timestamptz`; session times stay epoch-ms `bigint`.

Membership is **periods**: at most one active per person and one active owner;
a rejoin inserts a new `member` period; ended periods never reopen. An invite
is one multi-use, non-expiring code per group; regenerating replaces it.

**Failure isolation.** Every trigger on a Sync v2 table (share, stream item,
evaluator enqueue) and every certification enqueue runs in its own `begin …
exception` block. A failure writes one sanitized `public.app_logs` row (ids
and `sqlstate`, never `SQLERRM`, which echoes row values) and returns
normally: `sync_push` always commits.

**Share rule.** A member's session belongs to group G iff its `started_at`
falls inside one of the member's periods of G (`joined_at <= started <
coalesce(ended_at, ∞)`) and G is not soft-deleted. A session logged offline
before joining is never shared; one started as a member but synced after
leaving is.

- Shares are additive: leaving, a `started_at` edit or a tombstone never
  deletes one; reads filter tombstones.
- The trigger fires on every accepted write (not an LWW no-op), so a missed
  share appears on the next one; a failure on a session's last write never
  self-heals.
- `started_at` is client-authored: a member can only steer their own sessions
  into groups they belong or belonged to. Accepted.

**Stream.** One `group_events` row per item, written once and never deleted
(except provisional retraction, under Boards). `lead_change` rows are board
history, never stream items. Session items come from a trigger that runs after
the share trigger (same-event triggers fire in name order); card content,
position (live `started_at`) and visibility are read live. Membership items
commit with the period change (not isolated) at a fixed position: a writer that
edits `joined_at` or reopens a period must move the item.
`group_events_backfill()` idempotently inserts missing items.

**Group exercises.** A comparison identity that members link their own
exercises to. It shares `ExerciseCore` and `validateExerciseCore` with personal
exercises; SQL trims with `group_exercise_trim` (Postgres `btrim` is not
`String#trim`), held by `apps/mobile/src/exercise-core/exercise-core-vectors.json`
in Jest and `groups-contract`. No name cap or uniqueness. Archiving keeps
links and a frozen read-only board and takes no new links. Links are the
member's Sync v2 entity `exercise_group_links`.

## Authorization

Spec 10 rules 15–19 own the model. In addition: execute is granted to `anon` so
the function raises `AUTH_REQUIRED` instead of PostgREST's 42501; every
mutating RPC locks the `groups` row before role checks, serializing role
changes, transfers, removals and leaves; usernames come from `user_profiles`,
and create and join need one. The owner cannot leave (`OWNER_MUST_TRANSFER`)
and becomes admin on transfer. Admins invite, edit, manage group exercises,
remove members and cancel certifications.

## RPC conventions

`POST /rest/v1/rpc/<name>`, `Content-Profile: app_public`, `p_*` args, `jsonb`
result. Errors: `raise exception '<TOKEN>: <message>' using errcode =
'P0001'`; the client matches the prefix. Tokens: `AUTH_REQUIRED`,
`AGENT_FORBIDDEN`, `NOT_FOUND` (non-member ≡ nonexistent, byte-identical
bodies), `FORBIDDEN` (role), `VALIDATION`, `USERNAME_REQUIRED`,
`INVITE_INVALID`, `OWNER_MUST_TRANSFER`, `CONFLICT` (state moved: refresh and
retry), `UPDATE_REQUIRED` (client contract too old). Client-only: `NETWORK`,
`INTERNAL`.

- **Check order:** auth, agent, membership, role, input, target. A non-member
  sending bad input gets `NOT_FOUND`.
- **Cursors** are keyset, sent back verbatim (`next_cursor`); malformed is
  `VALIDATION`, JSON `null` is none. Keys compare in `"C"` collation, the same
  in SQL and TS. Reads take no locks.
- **Raw sets:** reads return a shared session's live sets as synced (planned,
  skipped, blank included; tombstones omitted; never GPS). Performed-only is a
  device display rule.
- **Stream** order: `sort_at_ms desc, kind, key desc`. A late sync sorts at
  its `started_at`; a record sorts at its session's start, just above the card.
  The All stream (`p_group_id` null) is server-only; the app reads one group.

One RPC generation: the membership and settings RPCs, and protocol 4
(`group_competition_*`, owned by the competition contract) for everything
competitive. Every group RPC requires the `x-boga-group-contract: 4` header
(`UPDATE_REQUIRED` otherwise). The legacy kg and protocol-3 RPCs are gone; their
stored rows remain history.

**Week summary.** The client sends its local week (≤ 8 days): the server never
guesses a time zone. It reads completed, untombstoned sessions shared to the
group by current members and started in the window, and counts their
performed, live, working facts whose rows still exist (trailing the
evaluator; [[set.eligibility]]) and their non-voided group records, one per
board taken. It reports no session count. Every current member is ranked, zeros
included, on `(working_sets desc, group_records desc)`. Training now is an
active session written within 2 h (max `server_received_at` over session,
exercises, sets); latest completed is any time.

## Device-computed card metrics

Session cards and the friend view count on the viewing device
(`buildCompetitionSession`,
`apps/mobile/src/groups/competition-session-view-model.ts`) with the session
screens' TS. Counts come only from permitted set context: `Sets` as
[[set.count-display]], `exercises` those holding a working set. A normalized exercise
shows reps and effort, never a load figure, and no session total is
reconstructed. Nothing is mirrored in SQL: SQL mirrors once duplicated set
rules in two languages. The cost: a co-member's device receives every permitted
live set. Ordinary rows use ordinary kg and never read a personal preference,
contribution or reading.

## Evaluator

**Queues.** `group_eval_queue` holds session jobs (re-normalize, then re-apply
targets) and target jobs (enqueue one comparison evaluation);
`group_metric_eval_queue` holds comparisons. Jobs coalesce on their natural
key: a re-enqueue merges `causes`, bumps `generation`, and is available now.
Completion writes only if `generation` is unchanged since the claim. Failures
back off (2 s … 5 min) and park at `group_eval_max_attempts()`; nothing is
dropped or retried forever.

**Enqueue.** Isolated triggers on sessions, session exercises, sets,
`load_input_mode` changes and links, plus catch-up on unarchive and on a new
membership period. No `DELETE` triggers: the next evaluation drops hard-delete
leftovers. A link to a non-uuid, unknown or foreign target enqueues nothing.
The evaluator never writes links: a bad server-written link stalls the
member's pull.

**Invocation.** A `pg_net` kick (one per transaction, after commit) starts work
in seconds. A `pg_cron` sweep every 5 minutes is the backstop, slow on purpose:
every run writes `cron.job_run_details`, which forces a hosted WAL archive. URL
and secret live in Vault; with no URL the queue waits. The function's caller is
Postgres (shared secret, no JWT); it has no client API.

**Facts.** `group_set_facts` has one row per set of every shared session,
linked or not, so a new link is a re-apply. `apps/mobile/src/groups/set-facts.ts`
is the one implementation of the group set rules; device session cards parse
with the same kernel.
`fingerprint` hashes raw synced values and interprets nothing. `working` is
the fixed group rule of [[set.eligibility]] (`isWorkingSetType` with no
policy); every reader reads it as `working is not false`, so a non-working
set is excluded like a warm-up. A set-rule or kernel change bumps
`GROUP_EVAL_RULES_VERSION`, and drains re-queue older facts as a silent
`rules` recompute, a bounded batch per run. Each run records its version
(`group_eval_rules_state`); the sweep also kicks while a shared session with
older facts has no queued job, so once the new function has run once, a bump
finishes without member activity. Comparisons are not stamped with it: the
same change ships a migration enqueuing a `rules` evaluation of every live
comparison.

**Live target:** the member is active in a non-deleted group that owns the
unarchived group exercise. Any other board is frozen.

## Boards

`group_metric_board_entries` holds each member's best counting set per group
exercise × rules revision × metric (`volume`, `e1rm`) × scope (All,
Certified). Legacy `group_board_entries` rows are frozen history.

- **Counting set:** performed, working, live, its set row present, in a session
  shared into the group, under an exercise with a live link to the target.
  Zero never ranks.
- **Scores, best and rank** (units, load-mode conversion, full-precision
  values, tie order): the competition contract §1. Former members stay
  ranked, marked, frozen.
- **Rules apply forward only.** Stored entries, records and certifications are
  never re-evaluated because a rule changed; at its next apply a target's best
  that no longer counts falls silently (`rules`), and a stored record stands
  while its value does.

**The apply** (`group_metric_apply_member`, once per member when
`group_metric_eval_publish` publishes a comparison, under the publisher's
group, advisory and queue locks):

1. Snapshot old entries, #1s and links; recompute.
2. **Provisional records** (session `active`): one that still counts and
   beats its baseline updates in place; otherwise it is deleted with its lead
   changes (no void) and its `previous_value_kg` is the baseline again. These
   are the only stream deletes.
3. **Voids:** fact missing or not live → `deleted`; unperformed or a listed
   value changed (weight, reps, load mode) → `edited`. Unlinking never voids.
4. **Attribution**, old winner O vs new N: N newly linked with its set created
   before the link → `link`; O unlinked → `unlink`; N beats the baseline or
   none exists → `record`; O dropped by a rule → `rules` (silent); else `void`.
5. Write entries, then events: voids with current leaders; one `record` per
   new-best set listing boards beaten (`group_record` when #1); one
   `link`/`unlink` item (never a record); one `lead_change` per All board
   whose #1 moved. `causes = {rules}` alone writes no events.

**Certified boards**, same apply: void certifications whose set no longer
stands as pinned; recompute from sets with an active certification pinned to
the fact; write `lead_change{certification}` when the target's certification
ids changed, else the All attribution. Reads count a Certified entry only
while its certification is active and pinned, so withdraw and cancel apply at
once.

**Known limits.** Silent recomputes move #1 without history. Link attribution
compares two device clocks. A retracted provisional lead change rolls back only
if it was the latest. A frozen target promotes nothing until a catch-up. A
withdraw racing a void can deadlock; Postgres aborts one side and the state
converges.

## Certification

Attests the raw synced values of a record set (a current All entry or a
non-voided record), by a current member other than the lifter, on an
unarchived exercise. It pins the live fingerprint; a mismatch is `CONFLICT`.
One active per target × set; a repeat returns it (`created: false`). Only the
certifier withdraws; owners and admins cancel; both are idempotent. Ended rows
never reopen, and undelete revives nothing. Writers: the RPCs and the apply,
never a Sync v2 trigger.

## Comparisons (bodyweight-aware)

- Preference and contribution writes carry the expected rules revision; stale
  is `CONFLICT`, and the form keeps its input.
- A contribution or target load-mode change bumps the revision and rebuilds the
  comparison. A preference toggle rebuilds only positive-contribution
  comparisons; at zero it is a no-op (same revision, scores, witnesses).
- The worker scores the whole graph with the TS kernel's strict `group`
  policy; SQL does no bodyweight or Wathan math. Non-working scores are stored
  with `counting = false`.
- **Coherent publication:** a claim carries generation, claim id and lease;
  publishing rechecks them, the revision and the source hash under group,
  advisory, queue and projection locks. A stale result writes nothing; readers
  see `rebuilding`, never mixed revisions.
- Rule-only changes keep a witness; set edits and deletes void it; a
  private-reading correction ends only the dependent projection.
- `competition-wire-guards.ts` rejects private fields, mixed revisions and
  wrong units before the cache; `metric-wire-guards.ts` rejects private fields
  in a comparison's rules.

## Mobile client

- `apps/mobile/src/groups/api.ts` is the only Supabase caller. A message prefix
  `<TOKEN>` maps to the token; transport status 0 or a throw to `NETWORK`;
  anything else, including missing contract keys, to `INTERNAL`.
- Group code never runs in the sync cycle; its one `src/sync` touch is the
  `group_cache` delete in `apps/mobile/src/sync/account-wipe.ts`.
- **Reads** are cache-first (`useGroupResource`): focus, 30 s while focused,
  pull-to-refresh; skipped offline; concurrent refreshes share a request;
  stale responses are dropped. Full boards and history are never cached.
- **Writes** (`useGroupAction`) are refused offline, never queued or cached;
  the screen refreshes after success.
- **Linking** is a local synced write and works offline; only cached,
  live exercises are offered. Unlink keeps past activity and certifications
  and checks the expected group exercise in its transaction: a moved mapping
  is left alone and the screen refreshes.
- **Offline:** cached data stays under "Offline · last updated HH:MM"; with no
  cache, an offline empty state.
- An invite link opened signed out loses its code at sign-in.

**Cache** (`group_cache`, `apps/mobile/src/data/schema/group-cache.ts`): a
disposable copy of server data, out of sync scope. Rows carry `user_id`; a read
for another user returns null. Streams cache the first page only. A group
`NOT_FOUND` evicts the group's and session entries, never synced links. A
payload shape change bumps the versioned keys (`cache.ts`).

## Not built

Live follow (needs membership RLS through the helpers, spec 10 rule 16, or a
broadcast channel); history PR highlights on cards (needs unshared history;
no SQL mirrors of TS set rules); group gyms, time-windowed boards, member
proposals, disputes, push notifications.

## Rule IDs

Code and tests cite these.

| ID | Rule |
| --- | --- |
| P1, D8 | Owners/admins add, rename, archive group exercises; archive keeps links read-only |
| P2, P4, D17 | Sets count only through a link (one per exercise per group); links are retroactive, offline, inactive while away |
| P3, D9, D13 | Group exercises only in picker search, the Link screen and the group page |
| P5, D10, D14 | Group page: header, Exercises, Members via count; Groups screen: one group's Stream · Leaderboards |
| P6–P9, D11, D12 | Volume/1RM × Certified/All boards; one row per member; podiums on Certified · 1RM; history is lead changes |
| P10–P13, D3–D5 | Another current member certifies a record set; one suffices; certifier withdraws, admin cancels; edits void it |
| P14–P17, D1, D2, D15, D16 | Records (first set too, provisional while active), one card per set; links make none; voided cards stay |
| P18 | Certify and admin actions need a connection |
| D6 | Scores convert across load modes (competition contract §1) |
| E0–E0.4 | Linking: picker search, pick sheet, Link screen, group-page link/unlink |
| E1–E1.3 | Podiums, full board with toggles, history |
| E2, E3 | Row detail sheet; stream record card (`GroupMetricStreamCard`) |
| T1–T8 | Separate exercise store; links in Sync v2; `group-eval`; kick + sweep; one stream table; history-only lead changes; diffed boards; provisional records |
| R1 | New best: `record`, `lead_change{record}` if #1 moves |
| R2 | Record set edited down, unperformed or deleted: void, fall back to next best |
| R3 | Record set edited up: void, then a new `record` |
| R4 | Session delete / undelete: voids / fresh records |
| R5 | Link, unlink, retarget: link item, `lead_change{link}`, no records |
| R6 | Certification given or ended: Certified `lead_change` |
| R7 | Load-mode change: treated as an edit |
| R8, R9 | Leave, archive: entries frozen |
| R10 | Rules version bump: silent recompute |
