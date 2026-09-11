---
task_id: M22-T02-Backend_group_record_share_trigger_and_stream_reads
milestone_id: "M22"
status: in_progress
ui_impact: "no"
areas: "backend"
runtimes: "supabase|sql|node"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/tech/sync-v2-server-contract.md, docs/specs/05-data-model.md"
---

# M22-T02 — Backend: the group record, share trigger, stream and session reads

## Task metadata

- Task ID: `M22-T02-Backend_group_record_share_trigger_and_stream_reads`
- Status: `in_progress`
- Depends on: `M22-T01` (tables, helpers, and the `groups-contract` lane)
- Parallel with: `M22-T04`, `M22-T05` (after `M22-T03`)

## Parent references (required)

- Milestone spec: `docs/specs/milestones/M22-groups-and-foundations.md`
- **Contract:** `docs/specs/tech/groups-contract.md`
  - §2.4–§2.5: shares, the rule, the trigger, failure isolation;
  - §4.2: `group_stream` and `group_session_detail`;
  - §5: the metric helpers, card values, PR rule, and parity vectors;
  - §8.
- Sync contract: `docs/specs/tech/sync-v2-server-contract.md` §A.1, §A.7.3, §B.11
- Canonical TS semantics: `apps/mobile/src/exercise-calculations/index.ts`,
  `apps/mobile/src/session-recorder/set-semantics.ts`, and
  `getExerciseCardPersonalRecord` in `apps/mobile/app/(tabs)/session-recorder.tsx`

## Objective

- Make member sessions enter the group record through the share trigger.
- Expose the stream and the friend-session reads, with server-computed card
  metrics and PR highlights.
- Prove SQL/TS metric parity with shared vectors.

## Scope

### In scope

- **Migration** `supabase/migrations/<ts>_m22_group_record.sql`:
  - the `group_session_shares` table (§2.4);
  - `group_share_session()` as an `AFTER INSERT OR UPDATE` trigger on
    `app_public.sessions`, with the exception handler that logs
    `group.share_failed` to `public.app_logs` (§2.5);
  - the SQL helpers `group_parse_reps`, `group_parse_weight`, and `group_e1rm`
    (§5.1);
  - RPCs `group_stream` and `group_session_detail` (§4.2), including cursor
    validation (`VALIDATION`).
- **Parity vectors** at `supabase/tests/fixtures/group-set-metric-vectors.json`
  (§5.3), plus the mobile jest test
  `apps/mobile/app/__tests__/group-set-metric-vectors.test.ts`, which asserts
  the canonical TS functions against them.
- **An extended `groups-contract`** lane (below).

### Out of scope

Mobile client and UI (`M22-T03`–`T05`). Realtime. Any change to `sync_push`,
`sync_pull`, or the nine Sync v2 tables beyond the added trigger.

## Acceptance criteria

1. **Share rule (§2.5; AC7).** Proven against real `sync_push` calls:
   - a session started before joining is not shared, even when first pushed
     after joining (the offline-late case);
   - a session started while a member but pushed after leaving is shared;
   - a session started after leaving is not shared;
   - a share made before leaving stays visible to members;
   - rejoining shares new sessions again.
2. **Flow-through (#17, #18; AC5, AC8).**
   - Pushing an active session then more sets shows updated card metrics.
   - Completing it shows status `completed` and `duration_sec`.
   - An edit changes the metrics.
   - A tombstone hides the card and makes the detail `NOT_FOUND`.
   - An undelete restores both.
3. **Stream.**
   - Items are ordered by `sort_at_ms desc, kind, key desc`.
   - Keyset pagination over more than one page has no repeats and no gaps.
   - A session shared into two of the caller's groups appears once in All,
     with both groups listed (AC14).
   - The per-group scope works.
   - Membership items appear as `joined`, `left`, and `removed`.
   - A removed caller gets `NOT_FOUND` for that group's scope, and All
     excludes the group (AC11).
4. **Detail (A4.2).**
   - It returns only performed sets and omits exercises with none.
   - It returns no GPS columns.
   - Names are the member's own exercise names.
   - A non-member and a nonexistent session give the same `NOT_FOUND` (AC9).
5. **PR highlight (§5.2).** It is flagged only when a completed prior history
   exists and current > history (strict). An equal lift is not a PR. There is
   no PR without history. Only earlier-started completed sessions count, and a
   deleted history session is ignored.
6. **Vectors.** The SQL helpers match every vector in the lane, with e1RM
   within `1e-9`. The jest parity test is green.
7. **Failure isolation (§2.5).** With the shares insert forced to fail, for
   example via a temporary `check (false) not valid` constraint added and
   removed by the test under a trap:
   - `sync_push` still commits;
   - the session is readable by its owner;
   - an `app_logs` row `group.share_failed` exists;
   - the next push after the constraint is removed creates the share
     (self-heal).
8. **Regression.** `./boga test backend` is green, unchanged: `sync-v2-e2e`,
   `sync-push-contract`, `sync-pull-contract`, `sync-drift --strict`, and
   `sync-infra`.

## Docs touched (required)

- `docs/specs/tech/groups-contract.md`: add **As-built** notes to §2.4–§2.5,
  §4.2 (stream and detail), and §5.
- `docs/specs/tech/sync-v2-server-contract.md` §B.11: state the trigger touch
  point as built.
- `docs/specs/05-data-model.md`: add the as-built `group_session_shares` to
  the inventory, with its sync impact.

## Testing and verification approach

- **Iterate** with `./boga test groups-contract` and
  `cd apps/mobile && npx jest group-set-metric-vectors`.
- **Before the PR:**
  - `./boga test backend`;
  - `./boga test fast`;
  - `./boga test frontend`, required by the `apps/mobile/app/**` trigger
    because the new jest test lives in `app/__tests__`.

## Implementation notes

- The trigger function is `security definer` with `set search_path =
  app_public, pg_temp`, and it must never raise out of the handler.
- Keep the PR computation inside `group_stream` bounded to the page's sessions.
  Add indexes only when a query plan shows the need, and record them in the
  contract.

## Evidence

All runs are on branch `m22-t02-backend-group-record`, rebased onto
`782c663` (M22-T03), at tip `7095fd1`.

- **`./boga test groups-contract`** passed twice in a row on the rebased tip:
  standalone in 16.6 s, then again inside `backend`. Every new T02 section ran
  and asserted: vectors, share rule, flow-through, PR rule, detail,
  leave/rejoin, failure isolation, stream, and removal.
- **Non-vacuity.** Mutating the PR rule `>` to `>=` in
  `group_session_card_json` makes the lane fail at "no PR on an equal lift".
  The function was then restored, and its md5 was verified.
- **Parity vectors.** The SQL helpers match all 40 rows, with 0 mismatches;
  the jest `group-set-metric-vectors.test.ts` passes 42 tests.
- **`./boga test backend`** passed in 4:09. All 11 lanes passed:
  - `auth-authz`, `groups-contract`, `agent-api`, `sync-v2-schema`;
  - `sync-push-contract`, `sync-pull-contract`, `dev-wipe-my-data`;
  - `sync-drift --strict` (errors=0 warnings=0);
  - `sync-v2-e2e`, `sync-infra` (6 suites / 13 tests), `mcp-smoke`.

  The drift log's `✗ exercise_sets … "notes"` line is
  `sync-v2-drift-synthetic`'s intended negative case.
- **`./boga test fast`** passed in 1:14. All 8 lanes passed: `lint`,
  `typecheck`, `jest-full` (115 suites / 1128 tests), `backend-fast`,
  `docs-check`, `meta-tests`, `agent-auth-web`, `mcp-unit`.
- **`./boga test frontend`**: exit 0 for all 4 lanes at `7095fd1`: `ios-smoke` 1.0m (`/20260911-124837-42393`), `ios-data-smoke` 1.1m (`/20260911-124939-44819`), `ios-auth-profile` 1.2m (`/20260911-125051-47286`), `ios-sync-e2e` 1.8m (`/20260911-125203-49417`).
- **Timings** (`./boga timings`): all 23 lanes green at `7095fd1`. `groups-contract` 16s median over 5 runs; backend: `sync-v2-e2e` 2.2m, `sync-drift` 40s, `sync-infra` 11s, `mcp-smoke` 11s, `backend-fast` 45s; fast: `jest-full` 12s.

## Completion note

- **What changed:**
  - `supabase/migrations/20260911120000_m22_group_record.sql` adds:
    - the `group_session_shares` ledger;
    - the failure-isolated `sessions_group_share_session` trigger;
    - the metric helpers `group_js_trim`, `group_parse_reps`,
      `group_parse_weight`, `group_e1rm`, and `group_performed_sets`;
    - the `group_stream` and `group_session_detail` RPCs.
  - Parity vectors are in `supabase/tests/fixtures/group-set-metric-vectors.json`,
    with the jest parity test beside them.
  - `supabase/tests/groups-contract.sh` is extended.
  - As-built notes are in `groups-contract.md` §2.4–§2.5, §4.2, and §5, in
    sync contract §B.11, and in the spec 05 inventory.
- **What tests ran:** the evidence above.
- **Deviations** (recorded in the contract §5 as-built):
  - An unknown `performance_status` counts as performed, mirroring
    `normalizeSessionSetPerformanceStatus`.
  - Two SQL-side bounds keep the helpers from ever raising, each pinned as a
    `sql` override: reps above int4, and weights `>= 1e15`.
  - The e1RM tolerance is relative above 1.
- **What remains:** the mobile UI and the `ios-groups-e2e` Maestro lane
  (M22-T04/T05). No new index was added; recording a query-plan-driven index is
  deferred until a plan shows the need.
