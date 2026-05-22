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
5. Runtime flushes until terminal state (`idle` = converged; non-idle terminal statuses remain retryable/non-blocking). The default convergence loop allows enough batches to drain the seeded exercise catalog.
6. On convergence success, runtime records bootstrap completion metadata for the authenticated user.

### E. Dependency order contract

Detailed table classification and dependency rationale lives in `docs/specs/tech/sync-schema-dependency-map.md`. The sync engine must preserve this practical order when applying or generating user-domain projection state:

1. Local static references exist first (`muscle_groups` seed data).
2. Exercise catalog parents sync before their children: `exercise_definitions`, then `exercise_muscle_mappings` and `exercise_tag_definitions`.
3. Workout parents sync before logged children: `gyms`, `sessions`, `session_exercises`, then `exercise_sets`.
4. Assignment edges sync after both sides exist: `session_exercise_tags`.
5. Runtime tables (`sync_outbox_events`, `sync_delivery_state`, `sync_runtime_state`) and backend ingest metadata are never projection restore entities.

Current convergence event generation follows: `exercise_definitions`, `exercise_muscle_mappings`, `exercise_tag_definitions`, `gyms`, `sessions`, `session_exercises`, `exercise_sets`, `session_exercise_tags`.

## 3) Interactions with the rest of the application

1. Root layout (`apps/mobile/app/_layout.tsx`)
- Starts/stops default scheduler.
- Updates cadence context from pathname.

2. Data repositories (`apps/mobile/src/data/**`)
- Emit sync events at mutation boundaries.
- Keep local-first behavior even when sync transport is unavailable.

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

6. Backend ingest/projection contract
- `supabase/tests/sync-events-ingest-contract.sh`
- coverage: success projection, duplicate replay idempotency, duplicate-with-drift rejection, strict ordering + prefix commit, and auth/RLS denial paths.
  - includes explicit duplicate replay assertions and changed-payload duplicate rejection assertions.

7. Profile sync status semantics
- `apps/mobile/app/__tests__/sync-profile-status.test.ts`
- coverage: derived status mapping for disabled, initial-sync, retry-scheduled, and blocked/action-required states.
- `apps/mobile/app/__tests__/settings-profile-navigation.test.tsx`
- coverage: signed-in profile sync section render, toggle wiring, and inline blocked-failure messaging.

8. Reinstall restore-parity proof lane
- `apps/mobile/app/__tests__/sync-reinstall-restore-parity.test.ts`
- dedicated Jest config: `apps/mobile/jest.integration.config.js`
- command wrapper: `apps/mobile/scripts/test-sync-reinstall-restore-parity.sh`
- npm script: `npm run test:sync:reinstall-parity` (run from `apps/mobile`)
- coverage: deterministic M13 full-scope fixture (`gyms`, `sessions`, `session_exercises`, `exercise_sets`, `exercise_definitions`, `exercise_muscle_mappings`, `exercise_tag_definitions`, `session_exercise_tags`), real outbox -> local Supabase ingest delivery, reinstall simulation (fresh local state + fresh sync device state), post-login bootstrap/merge + convergence, and scoped pre-sync vs post-restore parity assertion.
- snapshot boundary rule in this lane: parity compares only M13 user-domain entities; auth/session credentials, smoke artifacts, and sync runtime/outbox metadata are intentionally excluded.

## Maintenance rule for follow-up tasks

Tasks `M13-T03`, `M13-T04`, and `M13-T05` must update this document in the same session when they change:

- sync flow control/state transitions,
- ingest/ack handling assumptions at the client boundary,
- cadence/context mapping behavior,
- event emission boundaries,
- verification/test strategy for sync runtime behavior.
