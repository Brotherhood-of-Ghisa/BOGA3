# Groups step 2 — technical design (draft)

- Status: `draft v3` — key design questions resolved; detail comes next.
- Product spec: `docs/plans/group-exercises-and-leaderboards.md` (bullets
  cited as P#, decisions as D#, experiences as E#).
- Builds on: `docs/specs/tech/groups-contract.md` (step 1 as-built, cited §#).
- **[rec]** = recommendation; **[open]** = needs a decision; **[decided]** =
  agreed in review.

## 0. Shape in one picture

```
 athlete device ── sync_push ──▶ Sync v2 rows: sessions, session_exercises, exercise_sets,
                                  exercise_definitions, exercise_group_links (new)
                                   │ failure-isolated triggers: enqueue (member, session | link)
                                   ▼
                              group_eval_queue ──pg_net kick / pg_cron sweep──▶ group-eval Edge Function
                                                     1. normalize sets (app TS) → group_set_facts
                                                     2. SQL: recompute board entries, diff, write events
                                                              │
                     group_board_entries (standings) + group_events (the stream, persistent)
                                                              │
 viewer device ◀── group_* RPCs (stream, boards, history) ────┘   group_cache (as today)
```

The TS set rules run in one place (the evaluator); ranking and event writing
are plain SQL over numbers.

## 1. Group exercises — one table with user exercises?

**Question.** Can group exercises live in `exercise_definitions` instead of a
separate `group_exercises` table?

**What a single table would need.** `exercise_definitions` is a Sync v2 entity:
PK `(owner_user_id, id)`, `owner_user_id → auth.users`, RLS `owner_user_id =
auth.uid()`, per-owner LWW push, and a pull that returns only my rows (contract
§A.1). A group row has no user owner and many readers. Putting it there means
a nullable owner or a group owner, membership RLS policies (spec 10 rule 16's
recursion hazard), pull delivering other owners' rows, admin-only writes inside
LWW, and drift-checker changes. That is multi-reader sync, which contract
§B.11 puts out of scope — a Sync v2 rewrite, not a step-2 task.

**What is actually duplicated.** A group exercise is a comparison identity,
not something anyone logs against: members always log their own exercise and
link it (P2). It needs `name`, `load_input_mode`, and the standard id it was
copied from. No muscle mappings, tags, or history.

**[decided] One domain type, two stores.**

- Shared TS core (`ExerciseCore = { name, loadInputMode }`) with one validator
  and the same editor fields, used by the personal editor and the admin
  group-exercise form.
- Storage: `group_exercises` (`id uuid`, `group_id`, `name`,
  `load_input_mode`, `source_exercise_id text null` — e.g. `seed:bench-press`,
  `archived_at`, `created_by`), RPC-written by owner/admins (§3 posture).
- Device: cached in `group_cache`, mapped into the exercise list model as a
  second source for picker search and the Groups toggle (D13).

## 2. Links — Sync v2 entity [decided: Sync v2]

Links are the member's own data, so they sync like the rest of it.

- New entity `exercise_group_links` (the tenth): `id`,
  `exercise_definition_id` (FK → `exercise_definitions`, a synced parent —
  spec 05 rule 2 holds), `group_id text`, `group_exercise_id text` (**no FK**:
  group tables are not synced parents, and Sync v2 must not depend on them),
  plus the standard sync columns.
- **Deterministic id** `<group_id>:<exercise_definition_id>` gives "one group
  exercise per personal exercise per group" (P2) without a server constraint
  (Sync v2 tables carry none). Unlink = tombstone; relink = undelete the same
  id, the contract's only practical undelete path (§A.1.1.3).
- **Server reaction.** A failure-isolated trigger on the table enqueues a
  silent re-evaluation of `(group, member, group exercise)` for both the old
  and new target.
- **Inert links.** The evaluator ignores a link whose group the member isn't
  in, whose group exercise doesn't exist or belongs to another group, or which
  was created after the group exercise was archived (D8).
- **Product consequence.** Linking now works offline and takes effect on the
  boards after sync (P17 updated).
- **Cost.** A Sync v2 entity change: contract §A.2, the migration, drift
  checks, pull layers, the client schema and Drizzle migration, account wipe,
  and the sync lanes.

## 3. Where the maths runs [decided: Edge Function + pg_net, pg_cron backstop]

- **Evaluator** `group-eval`, reusing the app's TS as `agent-api` already does
  (`apps/mobile/src/exercise-calculations/index.ts`; `set-semantics.ts` has no
  imports). Records appear seconds after sync (accepted).
- **Enqueue.** Failure-isolated triggers on `sessions`, `session_exercises`,
  `exercise_sets`, `exercise_definitions` (`load_input_mode`), and
  `exercise_group_links` upsert into `group_eval_queue`, only for shared
  sessions or links. Certification and archive RPCs enqueue too. Never break
  `sync_push` (§2.5 pattern).
- **Invocation.** The enqueue trigger fires a `pg_net` request to `group-eval`;
  a `pg_cron` sweep drains anything left (missed kick, function error).
- **Normalize (TS)** → `group_set_facts`: `(member, set_id, session_id,
  exercise_definition_id, performed, weight_kg, reps, e1rm_kg, achieved_at_ms,
  fingerprint, rules_version)`, in the member's own load mode. `fingerprint`
  hashes raw `weight_value`, `reps_value`, `performance_status`, `deleted_at`.
- **Apply (SQL)**, per `(group, member, group exercise)`, serialized per group
  by advisory lock: convert (D6; Wathan e1RM is linear in weight, so the same
  factor applies), recompute the member's four board entries (§5), diff, and
  write events (§4).
- **Rules change.** Bumping `rules_version` re-queues every linked shared
  session; that recompute is silent.
- **Import constraint.** Deno imports the app's TS by relative path, as
  `agent-api` does, so a reused module must import nothing through the `@/`
  alias. `exercise-calculations/index.ts` and `set-semantics.ts` qualify. M24's
  PR logic (`apps/mobile/src/session-insights/calculations.ts`,
  `deriveExercisePersonalRecord`) imports `@/src/data/muscle-analytics` etc.,
  so reusing it needs either an alias-free split of the PR functions or a Deno
  import map. The builder decides; the rule stays "one implementation".

## 4. The stream — what "persistent" means

**Today (step 1).** Nothing is stored as a stream item. `group_stream`
builds the list at read time from two stored sources: the share ledger (one
row per shared session → a session card) and membership periods (→ joined /
left / removed items).

**Draft v1 proposed a hybrid**: keep that read-time assembly and add one new
stored table for record items only. Two ways of producing a stream, merged at
read time.

**[decided] One persistent stream table.** `group_events` is the stream. Every
item is a row written once, when it happens, and never deleted:

| Kind | Written by | Content |
| --- | --- | --- |
| `session` | share trigger, when a session is first shared into the group | points at the session; **card content is read live** (below) |
| `joined`, `left`, `removed` | membership RPCs | member, actor |
| `record` | evaluator | set, value snapshot, boards broken, group-record flag |
| `record_voided` | evaluator | the voided record, the reason, resulting leaders |
| `link`, `unlink` | evaluator (after a link change moves boards) | member, exercise, board effect |
| `lead_change` | evaluator | board, new leader, previous leader, values, `reason ∈ {record, void, link, certification}` |

- **Why session cards still read live.** A session is a living object: it is
  "training now", gains sets, completes, and can be edited or deleted
  (brainstorm #17/#18). As append-only events it would need a stream of
  started / set / completed / edited rows, or a mutable event. So the
  `session` row is the persistent *item* (position, identity); what the card
  shows comes from the member's live rows, as today.
- **History = `lead_change` rows** for a board (E1.3). The stream shows
  `record`, `record_voided`, `link`/`unlink`, and membership items.
  **[decided]** `lead_change` rows appear in history only, not as stream
  items (record / void / link items already carry the new leader).
- **Nothing disappears** except session cards whose session was deleted
  (step-1 behaviour). A voided record card stays, marked "voided".
- **Migration.** Backfill `session` rows from `group_session_shares` and
  membership rows from `group_memberships`; `group_stream` then reads only
  `group_events`.
- **Ordering.** `session` and `record` sort at session start (record cards sit
  with their session — E3); everything else at the time it happened.

## 5. Boards — edits and deletes [accepted; needs care]

`group_board_entries`: one row per `(group_exercise, member, metric ∈ {weight,
e1rm}, certified ∈ {false, true})` holding the best set, converted value,
reps, and `achieved_at_ms`. Ties go to the earlier `achieved_at_ms` (session
start, then set order) (P7).

**Rule:** the evaluator never patches entries incrementally. It **recomputes
the member's four entries** for the affected group exercise from facts, diffs
old vs new, and derives events from the diff plus the cause.

| Change | Board effect | Events |
| --- | --- | --- |
| New set beats my best | entry improves | `record`; `lead_change{record}` if #1 moves |
| Record set edited down, unperformed, or deleted | entry falls back to my next best | `record_voided`; `lead_change{void}` if #1 moves |
| Record set edited up | same set, higher value | void the old record + new `record` (fingerprint changed) |
| Session deleted / undeleted | its sets leave / return | voids / fresh records on return |
| Link / unlink | entries appear, change, or drop | `link`/`unlink`; `lead_change{link}`; **no** `record` cards (P16) |
| Certification given / withdrawn / cancelled / voided | Certified entries change | `lead_change{certification}` if #1 moves |
| `load_input_mode` changed | all my linked sets rescale | treated like an edit |
| Member leaves | none (P7) | — |
| Group exercise archived | entries frozen (D8) | — |
| `rules_version` bump | recompute | none (silent) |

- **[decided] In-progress sessions are provisional.** Record cards appear
  mid-session (D2), but while the session is active a record from that same
  session that is edited or removed updates or drops its card silently. Voids
  are emitted only for completed sessions, so a mid-set typo (1400 → 140)
  doesn't produce "record removed".

## 6. Certification

Unchanged from v1 (no review comments):

- `group_certifications` (per group): certifier, `pinned_fingerprint`, pinned
  raw values, and `ended_at` / `end_reason ∈ {withdrawn, cancelled, voided}`
  / `ended_by`.
- Certify RPC: the caller is a current member and not the lifter, and the set
  is a record set (a non-voided `record` event or a current All entry — D3).
  Re-certifying inserts a new row (D4).
- The evaluator ends certifications whose fingerprint no longer matches
  (`voided`). Any end re-queues the member (§5).

## 7. Mobile

- Cache keys: `group-exercises:<groupId>`, `boards:<groupId>` (podium page);
  full boards and history load online, like older stream pages.
- Links are local synced rows, so picker/catalogue can show "linked: …"
  offline. Group exercise names come from `group_cache`; a missing cache shows
  a placeholder until the next refresh.
- "Link to group exercise…" in the catalogue ⋮ and recorder ••• menus → Link
  screen (E0.3). "Add as new" (E0.2) writes the exercise and the link in one
  local transaction.
- Boards arrive already converted (D6); the row detail also shows the raw
  logged value.

## 8. Evaluator testing — extend `groups-contract` or a new lane?

The local stack already serves Edge Functions (`agent-api-contract.sh` calls
`${API_URL}/functions/v1/agent-api`), so either option can call `group-eval`.

| | Extend `groups-contract` | New lane `groups-leaderboards` (slow-backend) |
| --- | --- | --- |
| For | Reuses its per-run users, helpers, and share-rule setup; no lane registration; already in `boga test backend`. | Isolates the async path: the lane can drain the queue by calling `group-eval` directly, then assert — deterministic — plus one `pg_net` smoke. Failures point at leaderboards, not membership. Own path-trigger rule, so membership-only changes don't run it. |
| Against | Grows an already-large lane; mixes the synchronous authz contract with an async pipeline; waits on `pg_net` risk flakiness in a lane that is deterministic today; one red lane hides which half broke. | Registration churn (`scripts/lanes.tsv`, the `02` matrix, `boga test for` rules, PR template); fixture helpers need sharing (source a common helper file rather than copying). |

**[decided] New lane**, with a shared fixture helper and a direct-drain mode.
The Maestro lane `ios-groups-e2e` gets one extension (the counterparty links
and pushes a record; the device certifies; the Certified board updates).
Normalize-step unit tests run in jest against the `groups-session-metrics`
set fixtures.

## 9. Decisions (review of v1–v2)

| # | Decision |
| --- | --- |
| T1 | Group exercises: separate `group_exercises` store, shared TS domain type with personal exercises (§1). |
| T2 | Links: Sync v2 entity `exercise_group_links`, deterministic id (§2). |
| T3 | Maths: `group-eval` Edge Function reusing the app's TS; records appear after sync (§3). |
| T4 | Invocation: `pg_net` kick from the enqueue trigger + `pg_cron` sweep (§3). |
| T5 | Stream: one persistent `group_events` table; session cards read content live (§4). |
| T6 | Lead changes: history only; voids and link changes get their own stream items (§4). |
| T7 | Boards: materialized, always recomputed per member and diffed (§5). |
| T8 | In-progress records are provisional; voids emitted only for completed sessions (§5). |
| T9 | Evaluator tests: new `groups-leaderboards` slow-backend lane (§8). |

No open questions.

## 10. Specs to update when this ships

`groups-contract.md` (tables, RPCs, evaluator, `group_events`), the
`sync-v2-server-contract.md` §A.2 new entity + §B.11 touch points, `03`
decision register (evaluator runtime, persistent stream, pg_net/pg_cron),
`05` (new synced entity, group tables out of sync scope), `10`
(certification authz), `02`/`06` (new lane), `ui/screen-map` +
`navigation-contract` (Link screen, group page pages, leaderboard routes).
