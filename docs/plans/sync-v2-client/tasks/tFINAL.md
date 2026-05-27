# tFINAL: client end-to-end verification

**Type:** build (final test card)

**Problem:** Verify the plan's outcomes are delivered end-to-end. This
task is the contract with the human — each automated test maps to
exactly one plan outcome (or a coherent group of outcomes) and fails
loudly if a regression silently breaks the v2 client semantics.

**Inputs:**

- Every other task merged (`t1, t2, t3, t4, t5a, t5b, t6, t7, t8,
  t9`).
- Plan's `## Outcomes` section verbatim — the authoritative list this
  card must assert.
- `docs/plans/sync-v2-server/plan.md ## Outcomes` — plan 1's server
  shape (the RPC endpoints tFINAL's round-trip test calls).
- **Precondition: a live Supabase branch deployment.** The cycle
  round-trip test calls real `sync_push` and `sync_pull` RPCs and
  needs a real Postgres + PostgREST + RLS-enforced endpoint to test
  against. The tFINAL builder is responsible for spinning up a
  Supabase branch via the `supabase` MCP / CLI (same pattern plan
  1's tFINAL used — see
  `docs/plans/sync-v2-server/tasks/tFINAL.md`). The branch URL and
  service-role key are wired into the test via environment variables
  (`SUPABASE_BRANCH_URL`, `SUPABASE_BRANCH_ANON_KEY`); the test
  reads them from `process.env` and skips with a clear message if
  unset (so CI doesn't fail when the branch is torn down).

**Outcomes:**

Each automated test below asserts one or more plan-level Outcomes.
Test files live under `apps/mobile/app/__tests__/sync-v2-final/` for
audit-friendliness.

1. **`sync-v2-final/v1-deletions.test.ts`** — asserts the plan's
   "All v1 sync source files … are deleted" outcome:
   - `fs.existsSync` checks that `apps/mobile/src/sync/engine.ts`,
     `outbox.ts`, `bootstrap.ts`, `runtime.ts`, `scheduler.ts` (the
     old v1 path; note t7 ships a NEW `scheduler.ts` under the same
     path — the test reads the file's contents and asserts it
     contains "four-state machine" / NetInfo markers, not v1
     symbols), `profile-status.ts`, `types.ts` all reflect the v2
     reality.
   - Greps under `apps/mobile/src/` and `apps/mobile/app/` for v1
     symbols (`enqueueSyncEvent`, `flushSyncOutbox`,
     `setSyncNetworkOnline`, `recordSyncTransportFailure`,
     `SYNC_BACKOFF_INITIAL_DELAY_MS`, `SYNC_SESSION_RECORDER_CADENCE_MS`,
     `syncCadenceContextFromPathname`) — asserts zero hits.

2. **`sync-v2-final/drift-check.test.ts`** — asserts the plan's
   "drift checker passes against the new registration" outcomes
   (the two-column + `deleted_at` outcomes). Shells out to `npm run
   check:sync-drift -- --strict` and asserts exit code 0. Also
   verifies the `server_only_columns` exemption is no longer
   present in `apps/mobile/src/data/schema/sync-extras.json`.

3. **`sync-v2-final/dirty-bit-per-entity.test.ts`** — asserts the
   per-entity dirty-bit outcome. One sub-test per entity (eight
   sub-tests):
   - Open an isolated in-memory SQLite via the test harness used in
     existing repo tests.
   - Call the canonical create / update / softDelete path for the
     entity.
   - SELECT the row; assert `local_dirty = 1` and
     `local_updated_at_ms > 0` after every write.
   - Specifically test `exercise_sets` reorder per t1 §11.1 #2 —
     swapping two siblings dirties both rows in the same tx.

4. **`sync-v2-final/scheduler-state-table.test.ts`** — asserts the
   plan's scheduler outcome by walking the t4 §2.2 / §2.3
   transition tables cell-by-cell. **≥ 20 assertions** (one per
   cell). The tFINAL builder may reuse / extend the test file t7
   shipped at `apps/mobile/app/__tests__/sync-scheduler.test.ts`;
   the requirement is that ≥ 20 cells are covered by the time this
   card lands, with a comment in the file mapping each `it(...)` to
   the t4 §2.2 / §2.3 cell it covers.

5. **`sync-v2-final/cycle-round-trip.test.ts`** — asserts the cycle
   outcome. **Requires the Supabase branch deployment.**
   - Spin up a fresh client SQLite (use `:memory:`).
   - Insert a dirty `gyms` row, a dirty `sessions` row referencing
     it, a dirty `session_exercises` row referencing the session,
     and a dirty `exercise_sets` row referencing the session
     exercise. All four rows have `local_dirty = 1`,
     `local_updated_at_ms = nowMonotonic()`.
   - Call `runSyncCycle()` against the Supabase branch URL with a
     valid JWT for a test user.
   - Assert: after the cycle, every row on the client has
     `local_dirty = 0`; the server holds all four rows under the
     test user; deleting the client DB and re-running the cycle
     pulls all four rows back via the layered drain (Layer 0 →
     Layer 1 → Layer 2 → Layer 3 in order). Assert each layer's
     `next_cursor` in `sync_runtime_state.pull_cursor` advances.
   - Assert: re-running the cycle with no local edits is a no-op
     (`local_dirty` stays `0`; `pull_cursor` doesn't advance
     because no new rows landed).
   - Assert: an in-flight edit during push keeps `local_dirty = 1`
     on the edited row per t2 §7.3 (use a mid-cycle hook to inject
     the edit).

6. **`sync-v2-final/auth-required-envelope.test.ts`** — asserts the
   "AUTH_REQUIRED is a normal error envelope" Carry-over item 3.
   Calls the cycle with no JWT; asserts the cycle returns cleanly
   (no throw), the dirty bits stay set, and no client SQLite
   mutation happens.

7. **`sync-v2-final/now-monotonic-cross-restart.test.ts`** — asserts
   the `nowMonotonic` monotone-across-restart outcome:
   - Open a SQLite, call `nowMonotonic` 100 times in 100 separate
     transactions; record the values.
   - Call `__resetClockForTests` (simulates cold start).
   - Call `nowMonotonic` once more; assert it's strictly greater
     than the 100th prior value.
   - Mock `Date.now()` to return a constant for the second batch;
     assert the helper still returns monotone values.

8. **`sync-v2-final/manual-wipe-doc-exists.test.ts`** — asserts the
   manual-wipe outcome by `fs.existsSync` checking that
   `docs/plans/sync-v2-client/manual-wipe.md` exists and contains
   the four required section headings (iOS Simulator, Android
   Emulator, Physical device, TestFlight). Also asserts NO
   `v2-boot-marker.ts` (or similarly named module) exists under
   `apps/mobile/src/data/` — i.e. the manual-wipe procedure was
   not silently re-implemented as code. No simulation of the wipe
   itself — that's a human runbook step.

9. **`sync-v2-final/dev-affordances-gate.test.ts`** — asserts the
   `isDevMode()` gate on t9's affordances. The Settings screen
   renders neither button when `isDevMode()` returns false; both
   when true. Greps t9's diff for any bare `__DEV__` literal and
   asserts zero matches.

10. **`sync-v2-final/bg-task-identifier-match.test.ts`** — asserts
    the BG-task identifier matches across `defineTask`,
    `registerTaskAsync`, and `app.config.ts`. Re-uses or extends
    the test t8 shipped; the requirement is that ALL THREE call
    sites use the same constant from `background-task.ts`.

11. **`sync-v2-final/topo-order-imported.test.ts`** — asserts the
    Carry-over item 5 (the cycle imports `topo-order.ts`, does NOT
    redefine layers). Greps `apps/mobile/src/sync/cycle.ts` and
    `apps/mobile/src/sync/scheduler.ts` for any literal `TOPO_LAYERS`
    or layer-array re-declaration; asserts zero hits other than
    the canonical import line.

12. **`sync-v2-final/all-gates.test.ts`** — the catch-all gate:
    asserts `npm run lint`, `npm run typecheck`, and `npm run test`
    all exit zero. This file is a thin Jest wrapper that shells
    out (or, if the gate cost is excessive in Jest, simply
    documents the requirement in a comment and the PR body
    asserts the gate ran locally).

Plus: `test:e2e:ios:smoke` and `test:e2e:ios:data-smoke` pass locally
on the merged-to-`main`-equivalent state; the PR body's Standard
checklist asserts both with the built git sha (per the
Orchestration block's "Sim-smoke per task" deviation).

**Output artifact:**

- New directory `apps/mobile/app/__tests__/sync-v2-final/`
  containing the 12 test files listed above (or a subset that
  groups coherent outcomes — but each plan Outcome must be covered
  by at least one assertion in at least one file under this dir,
  with comments mapping outcomes to assertions for audit).
- A README at `apps/mobile/app/__tests__/sync-v2-final/README.md`
  listing the plan Outcomes ↔ test file mapping for audit
  traceability.
- A new Jest config or test runner glob if needed (e.g. a
  `test:sync-v2-final` script in `apps/mobile/package.json`) so the
  builder can run them as a focused suite.
- PR body explicitly notes:
  - The Supabase branch URL used for test 5 (and the branch
    teardown cleanup line).
  - Per the Orchestration block's "Sim-smoke per task" deviation,
    the Standard checklist line
    `sim-smoke + data-smoke pass: YES (built rev: <git sha>)`.

**Out of scope:**

- Tests that exercise individual task outcomes already covered by
  that task's own test files — tFINAL re-covers them only when
  asserting a plan-level outcome. Where overlap exists, tFINAL's
  test file may IMPORT the lower-level test helper rather than
  duplicating the test body.
- **Automated verification of the manual-wipe procedure.** The
  v1→v2 wipe is a human runbook step (see
  `docs/plans/sync-v2-client/manual-wipe.md`) performed once on
  each device by the dev / tester / user. CI verifies the doc
  exists and that no code re-implements the wipe (see test #8);
  CI does NOT exercise an actual uninstall+reinstall or Xcode
  "Erase All Content and Settings" flow.
- Maestro / e2e UI flows (those live in `apps/mobile/scripts/`
  and are exercised by `test:e2e:ios:*`).
- Server-side schema tests (plan 1's tFINAL covered those).
- Performance / load tests for the cycle — the cycle's
  steady-state target is t2 §6.2 (≤ 20s background, ≤ 5s
  foreground) but verifying that under realistic load is a plan
  3 / observability concern.
