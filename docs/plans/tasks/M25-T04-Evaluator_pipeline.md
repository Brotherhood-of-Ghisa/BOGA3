---
task_id: M25-T04-Evaluator_pipeline
milestone_id: "M25"
status: planned
ui_impact: "no"
areas: "backend"
runtimes: "supabase|sql|deno|node"
gates: "./boga test fast, ./boga test backend (incl. new groups-leaderboards), ./boga test ios-groups-e2e, ./boga test ios-sync-e2e, ./boga test handles"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/tech/sync-v2-server-contract.md, docs/specs/03-technical-architecture.md, docs/specs/02-quality-and-test-gates.md, docs/specs/06-testing-strategy.md, docs/specs/09-project-structure.md, RUNBOOK.md"
---

# M25-T04 — Evaluator pipeline: queue, `group-eval`, set facts, lane

- Depends on: T01 (#287), T02 (#285), T03 (#286), all merged. Milestone:
  `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`.
- Read: design §3 (T3, T4, import constraint), §2 (inert links), §5 (what T05
  builds on these facts), §8 (T9); `groups-contract.md` §2 ground rules, §2.5
  (failure isolation), §2.6, §2.7; `sync-v2-server-contract.md` §A.2.10, §B.11.

## Objective

Every change to a member's shared training data or links reaches a durable
queue without ever risking `sync_push`. A `group-eval` Edge Function turns the
queued work into per-set facts (`group_set_facts`) with the app's own TS set
rules, and resolves which `(group, member, group exercise)` board targets the
change touches. T05 builds boards and events on those facts and targets. T04
ships the pipeline and proves it in a new `groups-leaderboards` lane.

## What T01–T03 give this card (as merged)

- `group_exercises` (`20260913160000`): `uuid` id, `group_id`,
  `load_input_mode`, `archived_at`.
- `exercise_group_links` (`20260913170000`, contract §A.2.10): a Sync v2
  entity written **only by the member's client**. The id is
  `<group_id>:<exercise_definition_id>`. `group_id` and `group_exercise_id`
  are plain text with **no FK** and may hold anything, including non-uuid
  text. The server reads links and **never writes them**: a server-written row
  that breaks the id form fails the local CHECK on pull and stalls that user's
  layer-1 pull.
- `group_session_shares` decides "shared". `group_events` reserves the T05
  kinds.
- On `sessions`, same-event triggers fire in name order:
  `sessions_group_share_session`, then `sessions_group_stream_event`. The
  enqueue trigger must sort after both so it sees the share its own write
  created.
- The local image (Postgres 17.6.1) has `pg_net` 0.20.3, `pg_cron` 1.6.4 and
  `supabase_vault` 0.3.1 available. No migration enables them yet.

## Scope

### 1. Queue: `app_public.group_eval_queue`

Follows ground rules 1–5 (`member_user_id`, no Sync v2 FK, RLS on with no
policies, `service_role` only). One row per pending unit of work, coalesced on
its natural key:

- **`session` job** `(member_user_id, session_id)`: re-normalize that
  session's sets.
- **`target` job** `(member_user_id, group_id, group_exercise_id)`: re-apply
  one board target without re-normalizing. Written for link changes and
  load-mode changes. T05/T06 enqueue these from the archive and certification
  paths through the same helper.

Columns: `causes text[]` (the union of `set | link | load_mode | rules`; T05
uses it, since P16 says link-caused changes produce no record cards),
`generation` (bumped on every re-enqueue), `enqueued_at`, `attempts`,
`available_at` (backoff), `claimed_until` (lease), `last_sqlstate`.

### 2. Enqueue triggers (failure-isolated, the §2.5 pattern)

| Table | Fires | Enqueues |
| --- | --- | --- |
| `sessions` | `AFTER INSERT OR UPDATE`, named to sort after the share and stream triggers | a session job if a share row exists for `(owner, id)` |
| `session_exercises` | `AFTER INSERT OR UPDATE` | a session job for its session (and the old one if `session_id` changed), if shared |
| `exercise_sets` | `AFTER INSERT OR UPDATE` | a session job through `session_exercise → session`, if shared |
| `exercise_definitions` | `AFTER UPDATE OF load_input_mode`, when changed | a target job per live link of that exercise (`load_mode`) |
| `exercise_group_links` | `AFTER INSERT OR UPDATE` | target jobs for the old and the new `(group, group exercise)` (`link`) |

- Every body runs in `begin … exception when others`. On failure it writes
  one sanitized `public.app_logs` row, `group.eval_enqueue_failed`, with
  `{table, row_id, sqlstate}` and never `SQLERRM`. It falls back to
  `raise warning` and always returns normally.
- Link ids that don't parse as uuids are **inert**: they are skipped without a
  failure row, so a stray client value is never noise or a push failure.
- A LWW no-op push updates no row and fires nothing, as in §2.5.
- No `DELETE` triggers. Hard deletes happen only through `dev_wipe_my_data`
  and account deletion. Facts carry no Sync v2 FK (rule 2), and consumers
  inner-join the live rows, so dangling facts are invisible, the same pattern
  the share ledger uses.
- **Kick.** After enqueueing, the trigger sends at most **one** `pg_net`
  `net.http_post` to `group-eval` per transaction (a transaction-local flag),
  inside the same isolation block. pg_net sends after commit, so a
  rolled-back push sends nothing. If the kick isn't configured, nothing is
  sent and the sweep covers it.

### 3. Facts: `app_public.group_set_facts`

Follows ground rules 1–5. PK `(member_user_id, set_id)`.

- Columns: `session_id`, `session_exercise_id`, `exercise_definition_id`
  (null when the logged exercise has none; such a set never counts),
  `exercise_order_index`, `set_order_index`, `performed`, `live` (set,
  exercise and session all untombstoned), `weight_kg`, `reps`, `e1rm_kg`,
  `achieved_at_ms` (= `sessions.started_at`), `fingerprint`, `rules_version`,
  `evaluated_at`.
- Values are in the **member's entered load mode**. Conversion to the group
  exercise's mode is T05 SQL (D6; Wathan is linear in weight).
- Facts exist for **every** set of a shared session, not only linked
  exercises. A later link is then a pure target re-apply with no
  re-normalization (P4, retroactive links).
- **Fingerprint** is a SQL function, `group_set_fingerprint(weight_value,
  reps_value, performance_status, deleted_at)` (md5 over the raw values), so
  T06 can check a certification against the live row without the evaluator.
  It hashes raw values and interprets none, so no set rule is duplicated.
  (Deviation from the design's "Normalize (TS) → fingerprint" wording; record
  it in the PR.)

### 4. `group-eval` Edge Function

- `supabase/functions/group-eval/index.ts`, `verify_jwt = false`. It checks
  its own `x-group-eval-secret` header against the function env and returns
  401 otherwise. It reaches Postgres with the auto-injected service-role key.
  It is a service-role boundary like `agent-api`, with no client-facing API.
- **Drain loop.**
  1. `group_eval_claim(p_limit)`: `for update skip locked`, sets a lease.
  2. For a session job, `group_eval_session_rows(member, session)` returns
     the raw rows, and TS normalizes them (§5).
  3. `group_eval_complete(job, generation, facts jsonb)` upserts facts,
     deletes facts for sets no longer present, resolves targets (§6), calls
     the apply seam, and deletes the job only if its `generation` is
     unchanged.
  - Target jobs skip step 2.
  - A failure calls `group_eval_fail(job, sqlstate)`: `attempts + 1`, backoff,
    one sanitized `group.eval_failed` row. The job is kept, and the other
    jobs in the drain continue.
- The response is `{ claimed, completed, failed, targets }`. The lane's
  direct-drain mode asserts on it.
- `group_eval_apply(group, member, group_exercise, causes)` ships as an
  intentional no-op seam. T05 replaces its body with recompute, diff and
  events.

### 5. Normalize: TS, one implementation

- A pure, alias-free module in `apps/mobile/src/groups/` (no `@/` imports)
  holds the performed/parse core and the fact normalizer, plus
  `GROUP_EVAL_RULES_VERSION = 1`.
- `toGroupPerformedSet` (`session-metrics.ts`) delegates to that core, so
  device card metrics and evaluator facts cannot diverge.
- e1RM is `estimateOneRepMax` from `exercise-calculations`. M24's PR logic
  (`session-insights`) isn't needed: records are SQL over facts (T05), so the
  design's import-map question doesn't come up in T04.
- **Deno resolution.** The module's relative imports must resolve under
  Metro/jest and Deno. The mobile tsconfig uses `moduleResolution: bundler`
  without `allowImportingTsExtensions`. The build picks either a function
  `deno.json` (sloppy imports or an import map) or `.ts` specifiers with the
  tsconfig flag, and records the choice in `03`.

### 6. Target resolution and inert links (SQL)

`group_eval_targets(…)` returns only **live** targets:

- **Session job.** For each group G holding a share of the session, and each
  live member link with `group_id = G` whose `exercise_definition_id` appears
  in the session: `(G, member, group_exercise_id)`.
- **Target job.** The target itself. Unlink and retarget therefore still
  re-apply the old target.
- **A target is live only if** all of these hold:
  - the member is currently active in G (P4: links are inactive until
    rejoin; P7: leaving freezes entries);
  - G is not deleted;
  - `group_id` and `group_exercise_id` parse as uuids and name a
    `group_exercises` row of G. A foreign or unknown exercise is inert;
  - the group exercise is not archived. Archived boards are frozen (D8).
    This covers the design's "link created after archive" rule: such a link
    can only target an archived exercise, so it never applies while the
    exercise stays archived. After unarchive the link counts like any other.
- The evaluator never writes `exercise_group_links`.

### 7. Invocation and configuration

- The migration enables `pg_net` and `pg_cron` in the `extensions` schema
  (Supabase convention).
- The kick URL and shared secret live in Vault (`group_eval_url`,
  `group_eval_secret`), read by a pinned definer helper. For local runs the
  lane or baseline seeds them: the edge-runtime URL as the DB container sees
  it, plus the function's `GROUP_EVAL_SECRET`. RUNBOOK documents the deploy
  steps.
- A `pg_cron` job `group-eval-sweep` runs every 30 s (`group_eval_sweep()`).
  If claimable work exists (unclaimed, lease expired, or backoff elapsed), it
  sends one kick.
- **`rules_version`.** Each drain also enqueues silent session jobs (`rules`)
  for a bounded batch of sessions whose facts carry an older `rules_version`.

### 8. Lane `groups-leaderboards`

- Test body `supabase/tests/groups-leaderboards.sh`, gate `slow-backend`,
  placed after `groups-contract` in `scripts/lanes.tsv` and run through
  `run-suite.sh`.
- Shared helper `supabase/tests/lib/groups-fixtures.sh` holds provisioning,
  sign-in, username, `rpc`/`rest`, the sync envelope builders, `push`, and
  cleanup, extracted from `groups-contract.sh`. `groups-contract.sh` then
  sources it: no copies, and none of its assertions change.
- **Direct-drain mode** (the default for the lane's assertions): the kick is
  disabled for the run, and the lane POSTs to `group-eval` and asserts. There
  is one pg_net smoke with the kick enabled.
- `scripts/triggers.tsv` gains a `groups-leaderboards` rule for
  `supabase/functions/group-eval/**`, `supabase/tests/lib/**`, and the
  normalizer module. Spec `02` is regenerated (`./boga docs gen`), and spec
  `06` gets the lane entry.

## Acceptance criteria

1. **Facts.** A pushed shared session yields one fact per set:
   - performed rule: planned, skipped, unperformed and blank sets are not
     performed; an unknown status is;
   - parsing: a blank weight with valid reps is 0 kg; `1e3` is not performed;
   - a per-side exercise stays in the entered mode, not doubled;
   - `e1rm_kg` equals `estimateOneRepMax`, `achieved_at_ms` equals
     `started_at`, and `rules_version` is 1;
   - the fingerprint changes if and only if a raw fingerprint field changes;
   - edits, tombstones and undeletes of a set, an exercise or the session
     update `live` and the values;
   - an unshared session gets no queue row and no facts.
2. **One implementation.** Jest runs the normalizer over the
   `groups-session-metrics` fixtures and agrees with `toGroupPerformedSet`,
   which now delegates to the same core.
3. **Never breaks `sync_push`.** Each fault below is forced in the lane. Each
   time `sync_push` returns 200 and the row reads back.
   - **Enqueue failure** (a `check (false) not valid` on the queue): exactly
     one sanitized `group.eval_enqueue_failed` row (sqlstate, no values). The
     next push enqueues. The lane's exit trap always drops the fault.
   - **Kick failure** (unreachable URL): the queue row stays pending.
   - **Evaluator failure on one job**: that job is kept with `attempts + 1`
     and one `group.eval_failed` row. Other jobs in the drain complete. Once
     the fault clears, the next drain completes the job.
   - **Links with non-uuid, unknown or foreign group ids**: no failure row and
     no target.
4. **Coalescing.** A push of many sets in one session gives one session job
   and one pg_net request for the transaction. A re-enqueue during a claim
   bumps `generation`, and `complete` keeps the newer work.
5. **Targets.** Resolution returns exactly the live targets:
   - a linked exercise in a shared session gives its target;
   - unlink and retarget re-apply the old target (and the new one);
   - a member who left, a foreign, unknown or non-uuid group exercise, and an
     archived one (including a link written after archive) give none;
   - after unarchive, the link counts;
   - a `load_input_mode` change gives one target per live link;
   - no server function writes `exercise_group_links` other than `sync_push`
     and `dev_wipe_my_data` (catalog assertion).
6. **Sweep.** With the kick disabled, a push leaves a pending job, and
   `group_eval_sweep()` drains it. The lane asserts that this is the
   `cron.job` command and checks its schedule. A job whose lease expired is
   reclaimed.
7. **pg_net smoke.** With the kick configured, a push's facts appear without
   a direct call. The wait is bounded and fails loud with a dump of the queue
   and `app_logs`.
8. **Rules bump.** Facts with an older `rules_version` are re-normalized by
   the next drain, cause `rules`.
9. **Posture.**
   - Queue and facts follow ground rules 1–5, and every new function pins its
     `search_path`.
   - claim, complete, fail and session_rows are executable by `service_role`
     only, and direct PostgREST access is denied.
   - `group-eval` returns 401 for a missing or wrong secret.
   - `sync-drift --strict` stays green.
10. **Lane.** `groups-leaderboards` is registered in `lanes.tsv`,
    `triggers.tsv`, spec `02` (generated) and `06`. `groups-contract` sources
    the shared helper and stays green.
11. **Gates green.**
    - `./boga test fast` and `./boga test backend` (including the new lane);
    - `ios-groups-e2e` (group migrations);
    - `ios-sync-e2e` (new triggers on the `sync_push` path);
    - `./boga test handles`.

## Out of scope

- Boards, events, record / void / link items, and the board and history
  reads (T05).
- Certification, and the archive and certification enqueue calls (T05/T06
  call the target-enqueue helper).
- Any mobile UI.

## Docs touched

- `groups-contract.md`: queue, facts, evaluator and triggers, and the test
  plan (§8).
- `sync-v2-server-contract.md`: §A.2.10 ("No server reaction yet" becomes
  the enqueue trigger) and the §B.11 touch points.
- `03`: register the evaluator runtime (Edge Function, pg_net kick, pg_cron
  sweep, Vault config) and the Deno import mechanism.
- `02` / `06`: the new lane.
- `09`: ownership of `supabase/functions/group-eval/` and
  `supabase/tests/lib/`.
- `RUNBOOK.md`: evaluator secrets, deploy, and repair.
