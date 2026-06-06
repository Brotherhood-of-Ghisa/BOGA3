# Client Sync Engine (M13)

## Purpose

Document the mobile client sync runtime introduced in M13 so future tasks can extend it safely.

Source-of-truth implementation files:

- `apps/mobile/src/sync/**`
- event emission write boundaries under `apps/mobile/src/data/**`

## 1) Components, file mappings, and roles

1. `apps/mobile/src/sync/types.ts`
- M13 envelope/request/response types.
- Locked entity-event compatibility map (`SYNC_ENTITY_EVENT_TYPES`).

2. `apps/mobile/src/sync/outbox.ts`
- Persistent queue + delivery state behavior.
- Backoff constants/policy and retry state transitions.
- Batch-response application semantics (`SUCCESS` full clear, `FAILURE` prefix clear + failed suffix retained).

3. `apps/mobile/src/sync/engine.ts`
- Flush orchestrator.
- In-flight guard (`inFlightFlushPromise`) to prevent concurrent sends.
- Transport invocation + normalization + error mapping.

4. `apps/mobile/src/sync/bootstrap.ts`
- Remote projection fetch from `app_public` tables.
- Deterministic local-vs-remote merge planning (`updated_at` winner with local tie-break).
- Atomic local projection apply + post-merge local convergence event enqueue.

5. `apps/mobile/src/sync/runtime.ts`
- Persisted sync runtime state (`enabled` + bootstrap completion metadata).
- Auth-gated ingest transport wiring (`sync_events_ingest`).
- First-enable bootstrap trigger and logged-out-then-login bootstrap trigger.
- Convergence loop helper (`flushSyncOutboxUntilSettled`).

6. `apps/mobile/src/sync/scheduler.ts`
- Foreground cadence scheduler (`60s` general, `10s` recorder).
- Online/offline toggling and immediate eligible flush on offline->online.
- Route-context mapping (`syncCadenceContextFromPathname`).

7. `apps/mobile/src/sync/index.ts`
- Public sync API surface for app/data layers.

8. `apps/mobile/src/sync/profile-status.ts`
- Profile-facing status projection (`loadSyncProfileStatus`) derived from runtime state, delivery state, pending queue, and network flag.
- Maps runtime internals into UX-facing status kinds/hints for `/profile`.

9. `apps/mobile/src/data/schema/sync-outbox-events.ts`
- Persistent outbox table schema.

10. `apps/mobile/src/data/schema/sync-delivery-state.ts`
- Persistent delivery state schema.

11. `apps/mobile/src/data/schema/sync-runtime-state.ts`
- Persistent sync enable/bootstrap state.

12. `apps/mobile/src/data/migrations/index.ts`
- `m0007_sync_outbox_delivery_state`: outbox + delivery-state persistence.
- `m0008_sync_runtime_state`: runtime enable/bootstrap persistence.

13. Event emission integration points (`apps/mobile/src/data/**`)
- `local-gyms.ts`
- `session-drafts.ts`
- `session-list.ts`
- `exercise-catalog.ts`
- `exercise-tags.ts`

Gym event note:

- `local-gyms.ts` includes private nullable coordinate metadata in every mobile-emitted `gyms.upsert` payload. Clearing coordinates emits all four coordinate payload fields as `null`.

## 2) Typical flows

### A. Domain write -> queued event

1. Repository write runs in DB transaction.
2. Same transaction calls `enqueueSyncEventsTx` or `enqueueSyncEvent`.
3. Outbox rows receive monotonic `sequence_in_device`.

### B. Scheduler tick -> flush

1. Scheduler tick calls `flushSyncOutbox`.
2. Engine checks transport configured, network online, retry-block, backoff window.
3. Engine reads up to `SYNC_BATCH_MAX_SIZE` events.
4. Engine sends ingest envelope.
5. Outbox applies response semantics and updates delivery state.

### C. Offline resume

1. Scheduler receives `setOnline(false)` while offline.
2. Flushes return `offline` and queue is retained.
3. On `setOnline(true)`, scheduler triggers immediate flush + continues cadence loop.

### D. First enable bootstrap + convergence

1. User enables sync (persisted in `sync_runtime_state`).
2. Runtime checks auth session + enablement, configures ingest transport, and runs bootstrap when required for the current user.
3. Runtime resets the local outbox/delivery stream before the bootstrap merge so convergence starts from sequence `1` with a fresh `device_id`; this avoids leaking stale per-device sequence state across auth users or backend stream resets.
4. Bootstrap fetches remote projection state, merges with local state deterministically, and enqueues local convergence events for local winners.
   - Gym rows include private coordinate metadata in the same `updated_at` winner rule as the rest of the row.
   - Convergence events include the local winner's coordinate metadata so restore and first-enable sync keep saved gym coordinates.
5. Runtime flushes until terminal state (`idle` = converged; non-idle terminal statuses remain retryable/non-blocking). The default convergence loop allows enough batches to drain the seeded exercise catalog.
6. On convergence success, runtime records bootstrap completion metadata for the authenticated user.

## 3) Interactions with the rest of the application

1. Root layout (`apps/mobile/app/_layout.tsx`)
- Starts/stops default scheduler.
- Updates cadence context from pathname.

2. Data repositories (`apps/mobile/src/data/**`)
- Emit sync events at mutation boundaries.
- Keep local-first behavior even when sync transport is unavailable.
- Run on the production local SQLite connection with `PRAGMA foreign_keys = ON`
  enabled by data-layer bootstrap, so invalid local parent/child graphs are
  rejected near the write/pull-apply boundary before they can wedge a backend
  sync push.

3. Auth/profile/runtime integration (current M13 state)
- Runtime subscribes to auth state changes and only enables transport/bootstrap when sync is enabled and a valid session exists.
- Runtime transport calls `POST /rest/v1/rpc/sync_events_ingest` (schema `app_public`) and consumes the locked `SUCCESS | FAILURE` envelope shape.
- Sync enable/bootstrap metadata is persisted locally in `sync_runtime_state`, so bootstrap completion is tracked per authenticated user.

4. Profile route status surface (`apps/mobile/app/profile.tsx`)
- Signed-in profile UI consumes `loadSyncProfileStatus` + `setSyncEnabled` to render sync state/control copy from local runtime state.
- Sync section is a background status/control surface only; it does not block local tracking routes.

5. Navigation contract coupling
- Recorder cadence depends on route segment `session-recorder`.
- If recorder route path changes, update:
  - `apps/mobile/src/sync/scheduler.ts` (`SESSION_RECORDER_ROUTE_SEGMENT`)
  - `docs/specs/ui/navigation-contract.md` (route contract)
  - this doc

## 4) Failure modes and handling

1. Transport missing
- `flushSyncOutbox` returns `disabled`; queue remains intact.

2. Offline
- `flushSyncOutbox` returns `offline`; no dequeue.

3. Retry blocked (`should_retry=false`)
- delivery state marks `retryBlocked=true`.
- subsequent flushes return `blocked` until state reset by explicit logic.

4. Retryable failure (`should_retry=true` or transport error)
- prefix commit may be removed based on `error_index`.
- failed suffix remains queued.
- next eligible attempt scheduled via locked backoff policy.
- M14 diagnostic logging records a small non-blocking `sync.flush_transport_failed` row for transport exceptions.

5. Non-retryable failure (`should_retry=false`)
- delivery state sets `retryBlocked=true`; queue remains for explicit follow-up handling.
- current backend examples include duplicate `event_id` with changed payload and stale sequence errors.

6. Invalid ingest response contract
- treated as transport failure path; retry backoff applied.

7. In-flight contention
- second concurrent flush returns `in_flight`, preventing duplicate send races.

8. Bootstrap fetch/merge failure
- remote projection fetch/parse failures do not mutate local domain tables because merge apply is transactional.
- runtime records inline bootstrap error metadata and keeps local-first usage unblocked.
- M14 diagnostic logging records small non-blocking rows for remote fetch failures and bootstrap failures.

9. App/process interruption during first-enable bootstrap fetch/merge (backend -> frontend)
- bootstrap fetch (`fetchRemoteSyncProjectionState`) does not mutate local projection tables directly.
- local projection replacement + convergence-event enqueue run inside one local DB transaction (`mergeRemoteProjectionIntoLocalState` -> `applyMergePlanTx`), so the apply step is all-or-nothing at transaction boundaries.
- if app/process interruption occurs before bootstrap is marked completed, runtime treats bootstrap as incomplete and retries it on next eligible reconciliation.
- bootstrap completion is checkpointed per authenticated user in `sync_runtime_state` (`bootstrap_user_id`, `bootstrap_completed_at`) only after convergence success.
- M13 does not persist fine-grained bootstrap phase checkpoints; retry is coarse-grained (rerun fetch + merge + convergence).

10. Repeat behavior after interrupted bootstrap
- repeated bootstrap runs are expected and safe for convergence; merge selection is deterministic (`updated_at` winner with local tie-break).
- M13 does not use a separate bootstrap-run idempotency token; safety is based on deterministic merge plus idempotent/overwrite-safe projection semantics for repeated equivalent events.
- before enqueueing convergence events, the runtime resets the local outbox/delivery stream, creating a fresh per-device stream for the retry. This avoids stale local sequence numbers blocking a backend owner/device stream that expects sequence `1`.
- a rerun can enqueue convergence events again if bootstrap had not been marked completed; this is acceptable under the at-least-once sync model.

11. App/process interruption during post-bootstrap outbox flush
- outbox and delivery state are persisted locally (`sync_outbox_events`, `sync_delivery_state`).
- events are only removed from outbox after ingest response handling (`applySyncIngestResponse`); if app closes before response handling, queued events remain.
- after restart, runtime/scheduler re-attempts eligible flushes from persisted queue state.
- replay safety relies on backend idempotency key `(owner_user_id, device_id, event_id)` and duplicate-same-payload no-op semantics.

12. Local SQLite FK pragma/integrity failure
- data-layer bootstrap enables `PRAGMA foreign_keys = ON` on the Expo SQLite
  connection and runs `PRAGMA foreign_key_check` after migrations/seeds.
- if enabling FK enforcement or the integrity check fails, bootstrap logs a
  sanitized `data.sqlite_foreign_key_bootstrap_failed` diagnostic with source
  `database` and rethrows the original SQLite failure; diagnostic logging is
  non-blocking and cannot replace the original error.

13. Pull-side local SQLite FK apply failure
- pull pages are applied and their layer cursor is advanced inside one local
  SQLite transaction. If a pulled page violates a local FK, the whole page rolls
  back and that layer's cursor is not advanced.
- the cycle converts local SQLite FK failures into `SyncCycleError` code
  `LOCAL_FK_VIOLATION` instead of surfacing the raw SQLite exception. The first
  sync gate observes the code as a retryable structural setup error, while the
  caller still receives the structured exception.
- the cycle emits best-effort diagnostic event `sync.pull_local_fk_violation`
  through `logEvent` with source `database` and safe context only: layer,
  entity types, page row count, operation (`pull_page_apply`), error code, and a
  sanitized/truncated exception message. Diagnostic logging failures are
  swallowed so they never replace the original sync error.
- automatic repair is intentionally deferred: no cursor reset, full-repull,
  local wipe, row quarantine, or UI repair flow is performed by this behavior.
  Retrying re-requests the same failed page because the cursor did not advance.

14. Push-side FK closure preflight
- before a selected push batch is sent, the cycle runs a client-side FK closure
  preflight (`apps/mobile/src/sync/fk-graph.ts` `findPushBatchFkViolations`).
  The FK dependency graph for the eight syncable entities is declared once in
  `SYNCABLE_FK_GRAPH`, mirroring the `.references(...)` edges whose parent is
  itself syncable (`exercise_muscle_mappings.muscle_group_id` is excluded — its
  parent is the locally-bundled, server-seeded `muscle_groups` catalog, never a
  sync orphan).
- for each dirty child row in the batch, every non-null FK reference must resolve
  to a parent that is either (a) in the same batch — the server defers FKs so a
  child may land before its parent inside one transaction — or (b) physically
  present in local SQLite, which (given the topological selector) implies the
  parent is clean and already on the server. A populated reference that resolves
  to neither is a local orphan the server would reject wholesale.
- the preflight runs in the same read transaction that snapshots the batch, so it
  validates exactly what would be sent. It is a pure read: it never mutates and
  never calls `sync_push`.
- on a violation the cycle raises `SyncCycleError` code `LOCAL_FK_VIOLATION`
  WITHOUT calling `sync_push`. This is the same structural code the pull-side uses
  and is deliberately distinct from the server's `FK_VIOLATION`, so downstream
  status surfaces tell a local-orphan preflight block apart from a server-side
  rejection. The throw leaves dirty bits and cursors untouched.
- **Temporary behavior (until the quarantine task lands):** a single orphan
  blocks the ENTIRE push — there is no skip-and-continue and no persistent
  quarantine yet. The dirty stream stays wedged behind the orphan until the row
  is repaired (parent restored or child removed), at which point the next cycle
  pushes normally. Skip-only-the-offending-row and a quarantine table are
  explicitly deferred.
- the cycle emits best-effort diagnostic event `sync.push_fk_preflight_violation`
  through `logEvent` with source `sync` and safe context only: operation
  (`push_batch_preflight`), error code, batch size, violation count, and a
  capped list of violations carrying opaque identifiers and structural metadata
  only — child type, child id (random hex, not user data), parent type, the
  missing FK column name, and the unresolved parent id. Row payloads and
  user-entered values (names, machine names, weights) are never logged.
  Diagnostic logging failures are swallowed so they never replace the preflight
  sync error.

15. Cycle result semantics vs scheduler cadence
- `runSyncCycle` returns a classified `SyncCycleResult` (`apps/mobile/src/sync/cycle.ts`)
  so the scheduler can tell a real sync success apart from the non-success
  outcomes that also resolve cleanly. The four classes are distinct:
  - `converged` — both ends went quiet, or the round cap was reached after
    authenticated progress. This (and only this) is a real sync success: it
    clears the auth-required signal and any prior cycle-error code.
  - `auth_required` — the server reported no signed-in user. A route signal
    (raise the auth-required flag, send the user to sign-in), not a success and
    not an in-gate error. Dirty bits and cursors are untouched.
  - `retryable_error` (code `INTERNAL`) — a server-internal / transport hiccup.
    Dirty bits stay set for the next tick. The result carries the code so the
    status surface keeps the failure visible rather than reporting success.
  - structural error (`FK_VIOLATION` / `LOCAL_FK_VIOLATION`) — exposed by
    THROWING a `SyncCycleError` rather than returning, so the caller still
    receives the structured exception and records no success.
- Scheduler success semantics: the scheduler's `lastSuccessAtMs` /
  `lastCycleError` are observable status only — they never change the state
  machine's cadence. `lastSuccessAtMs` advances ONLY on a `converged` result;
  `auth_required` and `retryable_error` (and a thrown structural error) never
  record a success, and `retryable_error` keeps its code visible in
  `lastCycleError` until a later converged cycle clears it. Cadence is unchanged:
  every cycle — success, retryable, auth-required, or thrown — settles via the
  cycle-ends transition into the long backstop (or OFFLINE), with no per-error
  backoff. The cadence state machine and the sync-success status are separate
  concerns.
- The cycle emits one best-effort `sync.cycle_result` diagnostic per finished
  cycle through `logEvent` with source `sync` and safe context only: the outcome
  (`converged` / `auth_required` / `retryable_error` / `structural_error`), the
  error code, and — for the two error classes — a sanitized/truncated exception
  message (never payload or user-entered data). Logging is fire-and-forget: a
  logging failure never changes the result or masks a thrown structural error.

## 5) Test overview

1. Engine/outbox behavior
- `apps/mobile/app/__tests__/sync-outbox-engine.test.ts`
- coverage: in-flight guard, backoff constants, success/failure mapping, offline/disabled/blocked states.

2. Scheduler behavior
- `apps/mobile/app/__tests__/sync-scheduler.test.ts`
- coverage: 60s vs 10s cadence and offline->online immediate trigger.

3. Domain emission wiring
- `apps/mobile/app/__tests__/sync-domain-event-emission.test.ts`
- coverage: repository write boundaries enqueue expected entity events.

4. Root wiring
- `apps/mobile/app/__tests__/root-layout-auth-bootstrap.test.tsx`
- coverage: scheduler/runtime bootstrap + pathname context update wiring.

5. Bootstrap + runtime orchestration
- `apps/mobile/app/__tests__/sync-bootstrap-merge.test.ts`
- coverage: deterministic merge decisions and convergence-loop terminal behavior.
- `apps/mobile/app/__tests__/sync-runtime-bootstrap.test.ts`
- coverage: first-enable bootstrap trigger and logged-out-then-login bootstrap trigger.
- includes explicit M13 journey proof for already-signed-in recorder sync convergence and logged-out-then-login bootstrap/convergence followed by recorder cadence sync.

6. Pull cycle and local FK classification
- `apps/mobile/app/__tests__/sync-cycle-pull.test.ts`
- coverage: pull LWW insert/update/no-op behavior, FK-enabled whole-page rollback, and cursor write atomicity.
- `apps/mobile/app/__tests__/sync-cycle-convergence.test.ts`
- coverage: cycle convergence, auth/server FK handling, pull-side `LOCAL_FK_VIOLATION` classification, failed-layer cursor preservation, and `sync.pull_local_fk_violation` logger emission / logger-failure isolation.
- coverage: the classified `SyncCycleResult` contract — `converged` / `auth_required` / `retryable_error` return values and the thrown structural error — plus `sync.cycle_result` structured logging (level + outcome + error code + sanitized message per class) and logger-failure isolation (a failed result log never masks a converged result).
- `apps/mobile/app/__tests__/scheduler-status-accessor.test.ts`
- coverage: scheduler success semantics — `lastSuccessAtMs` advances only on a converged cycle; `auth_required`, `retryable_error`, and a thrown structural error record no false success; a retryable error stays visible in `lastCycleError` until a later converged cycle clears it.
- `apps/mobile/app/__tests__/sync-cycle-push-preflight.test.ts`
- coverage: push-side FK closure preflight — `findPushBatchFkViolations` flags orphan dirty children (layer-2 `session_exercises` and layer-3 `exercise_sets` / `session_exercise_tags`) while passing valid parent+child graphs, clean-on-server parents, independent valid rows, and null nullable FKs; and the whole-cycle proof that an orphan batch is never sent to `sync_push`, surfaces `LOCAL_FK_VIOLATION` (distinct from server `FK_VIOLATION`) with dirty bits left set, emits the `sync.push_fk_preflight_violation` diagnostic with safe context only, isolates logger failures, and still pushes a valid graph in topological order.

7. Backend ingest/projection contract
- `supabase/tests/sync-events-ingest-contract.sh`
- coverage: success projection, duplicate replay idempotency, duplicate-with-drift rejection, strict ordering + prefix commit, and auth/RLS denial paths.
  - includes explicit duplicate replay assertions and changed-payload duplicate rejection assertions.

8. Profile sync status semantics
- `apps/mobile/app/__tests__/sync-profile-status.test.ts`
- coverage: derived status mapping for disabled, initial-sync, retry-scheduled, and blocked/action-required states.
- `apps/mobile/app/__tests__/settings-profile-navigation.test.tsx`
- coverage: signed-in profile sync section render, toggle wiring, and inline blocked-failure messaging.

9. Reinstall restore-parity proof (sync v2)
- The dedicated `test:sync:reinstall-parity` lane (v1 suite `sync-reinstall-restore-parity.test.ts`, config `jest.integration.config.js`, wrapper `test-sync-reinstall-restore-parity.sh`) was **retired**: its target suite was deleted with the v1 sync code paths, so the lane only ever printed "No tests found". Under the v2 push/pull RPC + per-layer cursor protocol, restore-parity is proven by:
  - `apps/mobile/app/__tests__/sync/cycle-round-trip.test.ts` — the *"a wiped client re-pulls all four rows via the layered drain with advancing cursors"* case drops the local store (mirrors a reinstall = fresh local SQLite), re-runs the real cycle against a live endpoint, and asserts each layer restores with FK integrity and advancing per-layer cursors. Runs in the branch-provisioned `test:sync:infra` lane.
  - backend contract suites `supabase/tests/sync-v2-push-roundtrip.sh` and `supabase/tests/sync-v2-pull-drain.sh` assert push→pull parity across all data-scope entities (including soft-delete tombstones) at the RPC layer, via `./scripts/quality-slow.sh backend`.

## Maintenance rule for follow-up tasks

Tasks `M13-T03`, `M13-T04`, and `M13-T05` must update this document in the same session when they change:

- sync flow control/state transitions,
- ingest/ack handling assumptions at the client boundary,
- cadence/context mapping behavior,
- event emission boundaries,
- verification/test strategy for sync runtime behavior.
