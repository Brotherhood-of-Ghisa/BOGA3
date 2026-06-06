# DB Sync Review: Offline Reconnect and FK-Blocked Inserts

Date: 2026-06-06

## Scope

This review focuses on the project's database sync behavior when:

- the mobile app goes offline, accumulates local changes, and later comes back online; and
- foreign-key constraints block inserts or updates during sync.

The review is based on the current sync v2 client/server path, including the mobile sync cycle, scheduler, local SQLite schema, Supabase sync RPCs, and related contract tests.

## High-level sync shape

- The current client sync cycle is designed as `PULL → PUSH → PULL` until a quiet round, with dirty rows pushed in FK topological order and pull pages applied layer-by-layer.
- The syncable table layering is four levels:
  1. `gyms`, `exercise_definitions`
  2. `sessions`, `exercise_muscle_mappings`, `exercise_tag_definitions`
  3. `session_exercises`
  4. `exercise_sets`, `session_exercise_tags`
- Server-side v2 tables use composite `(owner_user_id, id)` keys, and cross-entity FKs are declared `DEFERRABLE INITIALLY DEFERRED`, which is the right foundation for batch sync where children may appear before parents inside the same transaction.
- The server `sync_push` RPC explicitly defers constraints, upserts all rows, then forces `SET CONSTRAINTS ALL IMMEDIATE` so FK failures are turned into a stable `FK_VIOLATION` token.

## Strengths

- **Offline local writes are durable in principle.** Domain writes use `localDirty: true` plus `localUpdatedAtMs: nowMonotonic(tx)`, and `nowMonotonic` persists its counter in the same transaction as the row write, reducing LWW timestamp regression risk after crashes/restarts.
- **Push acknowledgements avoid clobbering in-flight edits.** The client records the sent timestamp and clears `localDirty` only if the row still has the same `localUpdatedAtMs` after the RPC returns.
- **Pull cursor advancement is atomic with page application.** A page is applied and the layer cursor is written in one local transaction, so a failed local apply should not advance past unapplied rows.
- **Server contract tests cover important FK behavior.** There is a contract test showing a child-before-parent batch succeeds when the parent is present in the same batch, and another showing an orphan `session_exercise` is rejected with `FK_VIOLATION` and no row is stored.

## Potential weak spots

### 1. FK-blocked push can wedge the entire dirty stream without isolation/quarantine

If one dirty row is structurally orphaned — for example, a `session_exercises` row references a missing `sessions` parent after offline edits, local corruption, a migration bug, or a prior partial data loss — the server rejects the entire batch as `FK_VIOLATION`.

The client then marks the cycle error and rethrows, leaving dirty rows and cursors untouched. The foreground scheduler treats a thrown cycle as “cycle ended” and simply arms the normal long retry timer, with no per-error backoff or isolation.

**Why this matters offline → online:** one bad orphan row can repeatedly block an otherwise valid offline backlog. There is no batch bisection, parent preflight, row quarantine, repair prompt, or “skip only this row” mechanism.

**Suggested hardening:**

- On `FK_VIOLATION`, bisect the batch to find the offending row or rows.
- Persist a sync quarantine table with `{type, id, error_code, error_message, first_seen_at}`.
- Continue pushing non-offending rows.
- Surface an actionable “Sync needs repair” UI for quarantined rows.
- Add a client-side “FK closure preflight” before push: for each selected child, verify its parent is either clean, in the same batch, or physically present locally.

### 2. Pull-side FK failures are not classified or recovered

`applyPullPage` inserts pulled rows directly into SQLite, and its own comment states that a per-row insert failure such as an FK violation aborts the whole page.

That is fine when the server's layer contract is perfect, but if the client ever receives a child without the parent locally present — due to cursor drift, local database corruption, manual data edits, a bug in layer partitioning, or a future schema change — the thrown error is a raw local DB exception, not a structured sync error.

The cursor transaction protects against data loss because the cursor will not advance if the insert aborts. Operationally, however, the client can become stuck retrying the same page forever.

**Suggested hardening:**

- Catch local SQLite FK errors around `applyPullPage` and convert them to a structured sync error.
- Include layer/type/id diagnostics in the error.
- Offer a recovery path: reset pull cursors and full-repull from layer 0, or wipe/rebootstrap local data for the signed-in account.
- Add a test where a pull page intentionally contains a child before or without its parent while local FKs are enabled.

### 3. Production local SQLite does not appear to explicitly enable FK enforcement

The production bootstrap opens the Expo SQLite database and creates the Drizzle handle, but I did not find an explicit `PRAGMA foreign_keys = ON` in `apps/mobile/src/data/bootstrap.ts`.

The test helper documents that SQLite FK enforcement is off by default and only enables it when `options.foreignKeys` is passed.

**Why this matters:** if local FKs are off in production, invalid child rows can be created locally and only fail later at server push. If local FKs are later enabled, existing pull and mutation paths may begin throwing FK errors that the sync cycle does not yet recover from gracefully.

**Suggested hardening:**

- Explicitly enable `PRAGMA foreign_keys = ON` in production bootstrap.
- Run the sync-cycle pull/push suites with local FKs enabled.
- Add startup integrity checks such as `PRAGMA foreign_key_check`.
- Decide and document whether the app treats local FK enforcement as required.

### 4. Internal/auth RPC failures may be reported as scheduler success

`runSyncCycle` treats `AUTH_REQUIRED` and `INTERNAL` as clean returns, not thrown failures. For `INTERNAL`, it records a cycle error signal and returns.

However, the scheduler's `.then()` branch treats any resolved `runSyncCycle()` as success and sets `lastSuccessAtMs`, clearing `lastCycleError`.

**Why this matters offline → online:** a backend outage, token problem, or transport issue classified as `INTERNAL` can appear as a successful scheduler cycle even though dirty rows remain. The separate gate error signal may still exist elsewhere, but the profile/status accessor composes `lastCycleError` and `lastSuccessAtMs` from scheduler status, so user-facing status can become misleading.

**Suggested hardening:**

- Change `runSyncCycle` to return a result enum such as `{status: 'converged' | 'auth_required' | 'retryable_error' | 'fk_error'}`.
- Only set `lastSuccessAtMs` for real convergence/progress success.
- Keep retryable failures visible in scheduler status rather than clearing them in `.then()`.

### 5. Data writes do not appear to nudge sync immediately

The scheduler public API says an edit, foreground edge, or cold-launch trigger should call `requestSync`.

In practice, root layout cold launch and auth session changes call `requestSync`, but repository write paths did not appear to call `requestSync()` directly.

**Why this matters offline → online:** correctness is mostly preserved by dirty bits and the 60-second long backstop, but edits made while online may sit until the next timer/background wake instead of syncing promptly. The scheduler has the right debounce machinery; the data layer just does not appear to use it.

**Suggested hardening:**

- Add a lightweight `requestSync()` call after successful repository mutations.
- Keep it out of the DB transaction; call only after commit.
- Add a unit test that a representative write path marks dirty and nudges sync.

### 6. Push batch selection assumes FK closure but does not validate it

`selectPushBatch` walks tables in topological order and comments that the batch should not contain a child whose parent is neither clean-on-server nor in the same batch.

The implementation simply selects dirty rows table-by-table ordered by `localUpdatedAtMs`, up to the cap. It does not inspect the selected children’s parent IDs or verify that referenced parent rows are clean or present in the same batch.

The layering makes the common case work, but the stated invariant is not enforced. If local state is ever inconsistent, or if a parent row is clean locally but never actually reached the server, the server FK check catches it and the client falls into the FK wedge described above.

**Suggested hardening:**

- Build a dependency-aware batch selector that includes required dirty parents before children.
- Before pushing a child, verify parent existence locally and parent dirty status.
- If the parent is missing, quarantine the child before making the RPC.

### 7. Soft deletes preserve physical FK closure but can still create semantic orphans

The server schema uses real FKs, but deletion is modeled as `deleted_at` columns written by LWW. The `sync_push` contract overwrites all typed columns, including `deleted_at`.

Because soft-deleted parents remain physically present, FK constraints do not prevent active children from referencing deleted parents. That is probably intentional for tombstone replication, but it means FK constraints alone do not guarantee UI-level graph consistency.

**Suggested hardening:**

- Add semantic integrity checks for “active child references active parent,” if that is a product invariant.
- Decide whether child rows should be auto-tombstoned when parent tombstones win.
- Add tests for parent delete vs child edit conflicts across devices.

## Recommended next steps

1. Add local FK-enabled test coverage for sync pull and push paths.
2. Add structured local FK error classification around pull application.
3. Add push-side FK preflight and row quarantine for orphaned dirty rows.
4. Fix scheduler success semantics so retryable sync failures do not update `lastSuccessAtMs`.
5. Decide whether production local SQLite must enforce FKs, then encode that decision explicitly.
6. Add post-commit `requestSync()` nudges to repository write paths.
