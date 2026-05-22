# Milestone Spec

## Milestone metadata

- Milestone ID: `M13`
- Title: `Simple Backend Sync (Granular Outbox Baseline)`
- Status: `completed`
- Owner: `AI + human reviewer`
- Target window: `2026-03`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- AI development playbook: `docs/specs/04-ai-development-playbook.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- UX delivery standard: `docs/specs/08-ux-delivery-standard.md`
- Project structure: `docs/specs/09-project-structure.md`
- API auth/authz guidelines: `docs/specs/10-api-authn-authz-guidelines.md`
- UI docs bundle: `docs/specs/ui/README.md`
- UI screen map: `docs/specs/ui/screen-map.md`
- UI navigation contract: `docs/specs/ui/navigation-contract.md`
- Existing sync API baseline (legacy reference): `supabase/session-sync-api-contract.md`

## Milestone objective

Ship the first production sync foundation that does both:

- backs up all user-owned app data to backend,
- establishes granular event delivery for future low-latency social features.

M13 remains single-device scoped for correctness and delivery speed.

## Brainstorm outcome (selected direction)

1. Option A: keep M5 table `PostgREST` CRUD as primary sync wire protocol
- Pros: lowest immediate implementation cost.
- Cons: weak foundation for social/event fan-out and poor mutation-level observability.

2. Option B: snapshot-only upload/download
- Pros: simple restore semantics.
- Cons: expensive writes, weak real-time foundation, poor incremental behavior.

3. Option C (selected): granular client outbox events + backend materialized projection
- Pros: supports near-real-time social/event pipelines and still gives efficient restore.
- Cons: requires backend ingest/projection work.

Decision:
- M13 uses Option C as the primary protocol direction.

## Scope decisions (locked for M13)

1. Sync controls live in `/profile` only (reached from `/settings`); no dedicated sync screen in M13.
2. Sync is auth-gated and non-blocking; local usage remains available while logged out, offline, or on sync failures.
3. M13 sync scope is all user-owned local domain data listed in `Data scope` below.
4. Primary sync wire contract is granular outbox events (not direct table CRUD calls).
5. M5 table CRUD routes remain a legacy implementation baseline and may be used behind backend projection internals, but are not the client sync contract for M13.
6. First sync enable includes one-time remote bootstrap, then local merge, then upload of remaining local events/deltas.
7. Post-bootstrap loop is push-dominant; periodic pull is not part of steady-state M13 behavior.
8. Single-device assumptions are explicit; multi-device conflict detection/prevention is out of scope.
9. All sync-domain projection tables are user-scoped from day one with composite primary key `(id, owner_user_id)`. Mobile-shipped seed catalog rows are inserted per-user at install and treated identically to user-created data; there is no shared/global catalog of these entities on the backend, so two users may legitimately hold rows with the same `id` without conflict.

## Data scope (locked for M13)

M13 backup scope includes all user-owned local entities:

- `gyms`
- `sessions`
- `session_exercises`
- `exercise_sets`
- `exercise_definitions`
- `exercise_muscle_mappings`
- `exercise_tag_definitions`
- `session_exercise_tags`

Not part of M13 backup scope:

- static system taxonomy seed data (`muscle_groups`)
- test/runtime smoke artifacts (`smoke_records`)
- auth/session credentials
- account profile/auth tables handled directly by auth/profile flows (`user_profiles`, `auth.users`)

## In scope

- Client outbox subsystem for granular mutation events.
- Event generation for user-domain mutations, including set-level logging updates.
- Backend ingest endpoint(s) for event batches with idempotent acknowledgement.
- Backend projection/materialization path that keeps restorable user state current.
- First-sync bootstrap/merge behavior on sync enable.
- `/profile` UX for sync enabled state, status, and last successful sync.
- Connectivity-aware scheduling, batching, and retry/backoff.
- Coverage for event ordering/idempotency, restore correctness, offline recovery, and profile UX status behavior.

## Out of scope

- Multi-device support.
- Protection against multiple devices.
- Detection of multiple devices.
- User-facing conflict resolution UI.
- Push-based inbound live updates to device.
- Group/social product features themselves (only foundational sync/event plumbing is in scope).

## Sync protocol baseline (locked for M13)

Canonical source:

- `supabase/session-sync-api-contract.md` (`M13 event contract (locked)` section).

Client sends batched event envelopes to backend with request-level required fields:

- `device_id` (stable per installed app instance)
- `batch_id` (uuid request correlation id)
- `sent_at_ms` (epoch ms)
- `events` (array, `1..100`)

Each event has required fields:

- `event_id` (uuid idempotency key)
- `sequence_in_device` (`>= 1`, strict monotonic sequence per `(owner_user_id, device_id)`)
- `occurred_at_ms` (epoch ms)
- `entity_type`
- `entity_id`
- `event_type` (`upsert | delete | attach | detach | reorder | complete`)
- `payload` (entity/event-specific object)

Optional event fields:

- `schema_version` (default `1`)
- `trace_id`

Backend response includes:

- `status` (`SUCCESS | FAILURE`)
- `error_index` on failure (`0`-based in request batch)
- `should_retry` on failure
- `message` on failure (free-text; non-enum by contract)
- optional `error_event_id` mirror for easier diagnostics

Locked entity/event mapping (all M13 backup-scope entities):

- `gyms` -> `upsert`, `delete` (`upsert` also handles undelete)
- `sessions` -> `upsert`, `delete`, `complete` (`upsert` also handles undelete/reopen)
- `session_exercises` -> `upsert`, `delete`, `reorder` (`upsert` also handles undelete)
- `exercise_sets` -> `upsert`, `delete`, `reorder` (`upsert` also handles undelete)
- `exercise_definitions` -> `upsert`, `delete` (`upsert` also handles undelete)
- `exercise_muscle_mappings` -> `attach`, `detach` (`attach` can recreate detached edges)
- `exercise_tag_definitions` -> `upsert`, `delete` (`upsert` also handles undelete)
- `session_exercise_tags` -> `attach`, `detach` (`attach` can recreate detached edges)

Protocol requirements:

- idempotency key is `(owner_user_id, device_id, event_id)`
- duplicate re-submit with same payload is a no-op success
- duplicate `event_id` with different payload fails with `should_retry=false`
- ordered application is strict request-order processing with stop-on-first-failure
- on failure at index `i`, events before `i` are committed; event `i` and later are not applied
- retry control is contract-level `should_retry`; `message` is free text and non-enum

## Scheduling and retry policy (locked for M13)

1. Foreground periodic flush cadence has exactly two windows:
- every `60s` in general app usage,
- every `10s` while the user is on `session-recorder`.
2. Coalescing window definition:
- a coalescing window is the time between sync ticks; all outbox events created in that window are sent in one batch on the next tick.
3. Max batch size per request: `100` events.
4. In-flight guard: one sync request at a time.
5. Retry backoff on failures:
- initial delay `2s`
- multiplier `2.0`
- max delay `2m`
- jitter `+-25%`
- reset after first successful flush
6. Connectivity resume trigger: on offline -> online, run immediate eligible flush.

## Key user journeys

1. User is already logged in, starts recording a session, and sync eventually happens
- Trigger:
  - user is already authenticated and starts/updates a session in `/session-recorder`
- Steps:
  - recorder mutations enqueue outbox events
  - scheduler runs at recorder cadence (`10s`)
  - backend acknowledges batch and last successful sync is updated
- Success outcome:
  - recorder-generated events are delivered and reflected in backend backup
- Failure/edge outcome:
  - offline/failure keeps events queued and later retries deliver them

2. User is logged out, logs in, syncs + merges, starts recording, and sync eventually happens
- Trigger:
  - user starts logged out, then signs in and enables sync in `/profile`
- Steps:
  - app runs one-time remote bootstrap fetch
  - app merges remote and local state
  - app flushes merged/new events
  - user starts recording in `/session-recorder`
  - recorder mutations sync on recorder cadence (`10s`)
- Success outcome:
  - merged state converges first, then newly recorded session updates also converge
- Failure/edge outcome:
  - local usage remains unblocked and queued events converge after recovery

3. View sync status from settings entrypoint
- Trigger:
  - user opens `/settings`, then `/profile`
- Steps:
  - sync section shows enabled/disabled status
  - sync section shows last successful sync time (or `Never`)
- Success outcome:
  - user understands current sync health quickly
- Failure/edge outcome:
  - no-success-yet state is clear and non-alarming

4. Disable/enable syncing while signed in
- Trigger:
  - user toggles sync in `/profile`
- Steps:
  - toggle persists preference
  - disabling pauses scheduler and network sync
  - re-enabling resumes scheduler and eligible flushes
- Success outcome:
  - user has explicit control without sign-out flow coupling
- Failure/edge outcome:
  - previous state remains and error stays inline

## Non-functional requirements

1. Backup completeness
- M13 must back up all entities listed in `Data scope`.
- restore/bootstrap must be able to reconstruct coherent state for all those entities.

2. Granularity and latency
- recorder mutations must flush on `10s` cadence while on `/session-recorder`.
- non-recorder app mutations flush on `60s` cadence.
- coalescing behavior must batch events created between ticks into one request.

3. Reliability and correctness
- outbox delivery must be at-least-once with idempotent server application.
- ordering guarantees must hold per `(device_id, sequence_in_device)`.

4. Battery/network pragmatism
- batching and one in-flight guard prevent request storms.
- backoff and connectivity gating prevent wasteful retries while offline.

## Deliverables

1. Client outbox engine and event schema for all M13 data-scope entities.
2. Backend event ingest endpoint with idempotent acknowledgement contract.
3. Backend projection/materialization path for restorable user state.
4. First-sync bootstrap + merge + outbox convergence flow.
5. `/profile` sync status/control UX.
6. Test coverage for outbox ordering/idempotency, bootstrap merge correctness, scheduler/backoff behavior, and profile status UX.
7. Project docs updates reflecting the new sync model and verification requirements.
8. Automated reinstall restore-parity proof for full M13 backup scope (`Jest` + local `Supabase` baseline).

## Acceptance criteria

1. Sync can be enabled/disabled from `/profile` by a signed-in user.
2. First enable performs one remote bootstrap, local merge, and outbox flush without app restart.
3. M13 backup includes every entity in `Data scope`.
4. Logged session-recorder mutations emit granular events and flush on recorder cadence (`10s`) when online.
5. Non-recorder mutations flush on general cadence (`60s`) when online.
6. While offline, events are retained and eventually delivered after connectivity restoration.
7. Retry behavior matches locked constants (`2s`, `x2`, `2m`, `+-25%`, reset on success).
8. Server handles duplicate event submissions idempotently via `event_id`.
9. Projection state remains restorable and coherent after replay/ingest.
10. `/profile` shows sync enabled state and last successful sync timestamp.
11. Sync failures do not block local tracker usage.
12. Automated verification explicitly covers both journeys:
- already-logged-in user starts session recording and sync eventually converges,
- logged-out user logs in, bootstrap/merge sync converges, then starts session recording and sync eventually converges.
13. Automated restore-parity verification proves that pre-sync state and post-reinstall bootstrap/merge state are identical across all entities in `Data scope`.

Restore-parity ownership note:
- the reinstall restore-parity acceptance proof is tracked in `docs/tasks/complete/M13-T06-reinstall-restore-state-parity.md` and is not bundled into `M13-T05`.

## Planned technical approach

### Client outbox

- Add local outbox storage with ordered pending events.
- Emit events from repository/domain write boundaries.
- Track delivery state using simplified batch results (`SUCCESS` / `FAILURE` with `error_index`).

### Backend ingest + projection

- Add authenticated event ingest API for strict in-order batch apply semantics.
- Apply idempotency and per-device ordering checks.
- Project applied events into restorable user-state tables/read models.

### Bootstrap + merge

- On first enable:
  - fetch restorable remote projection,
  - merge with local state (local tie-break on equal timestamps),
  - generate local delta events where needed,
  - flush until converged.

### Scheduler/retry/connectivity

- Implement locked policy constants from `Scheduling and retry policy`.
- Keep one in-flight request.
- Trigger immediate eligible flush on connectivity resume.

### UI surface

- Extend `/profile` with:
  - sync enable/disable control
  - current sync status
  - last successful sync
  - inline error/retry visibility

## Task breakdown

1. `docs/tasks/complete/M13-T01-sync-event-contract-and-data-scope.md` - define event contract, data-scope mapping, and architecture/testing doc updates. (`completed`)
2. `docs/tasks/complete/M13-T02-client-outbox-and-recorder-cadence-sync.md` - implement local outbox model and event emission at write boundaries with `60s` general and `10s` recorder cadence handling. (`completed`)
3. `docs/tasks/complete/M13-T03-backend-ingest-idempotency-and-projection.md` - implement backend ingest/ack semantics and projection path for restore. (`completed`)
4. `docs/tasks/complete/M13-T04-bootstrap-merge-and-convergence.md` - implement first-sync bootstrap/merge/outbox convergence flow and related coverage. (`completed`)
5. `docs/tasks/complete/M13-T05-profile-sync-ui-and-end-to-end-verification.md` - finalize profile sync UX and journey-proof coverage for the two required user journeys. (`completed`)
6. `docs/tasks/complete/M13-T06-reinstall-restore-state-parity.md` - add deterministic reinstall restore-parity verification (`Jest` + local `Supabase`) across all M13 data-scope entities. (`completed`)
7. `docs/tasks/complete/T-20260522-01-issue-50-sync-schema-dependency-map.md` - post-M13 issue #50 schema dependency map and remaining rewrite split. (`completed`)
8. `docs/tasks/T-20260522-02-local-tombstone-parity.md` - post-M13 local tombstone parity for `gyms`, `session_exercises`, and `exercise_sets`. (`planned`)

Rule:

- use `docs/tasks/<task-id>.md` while tasks are active/planned;
- update references to `docs/tasks/complete/<task-id>.md` once a task card is completed and moved.

## Risks / dependencies

- Adding backend projection for new entities increases schema/API scope versus M5 baseline.
- Event projection bugs can silently diverge backup state if ordering/idempotency is weak.
- Recorder cadence behavior depends on reliable route/activity detection and in-flight orchestration.
- Existing M5 sync contract will need compatibility strategy during migration to event-first client protocol.

## Future-proofing notes (deferred)

- Add multi-device conflict policy and ownership guarantees before enabling second-device support.
- Extend event fan-out and subscription pathways for real social features after M13 foundation stabilizes.
- Add server-driven pull/subscription model later; M13 stays client push-dominant.

## Completion note (fill when milestone closes)

- What changed: Completed the M13 granular outbox sync baseline, including client outbox emission/cadence, backend ingest/projection, first-enable bootstrap/merge, profile sync UX/status behavior, end-to-end journey proof, and reinstall restore-parity proof.
- Verification summary:
  - 2026-05-03: `./scripts/quality-slow.sh backend` passed, including auth/authz, sync API contract, and sync events ingest contract suites.
  - 2026-05-03: `M13-T05` targeted journey/status/profile tests and `./scripts/quality-fast.sh frontend` passed.
  - 2026-05-03: final `./scripts/quality-slow.sh frontend` passed on iOS Simulator with local Supabase. Artifact roots: `apps/mobile/artifacts/maestro/ad-hoc/20260503-230400-41475` (`smoke-launch`), `apps/mobile/artifacts/maestro/ad-hoc/20260503-230503-42463` (`data-runtime-smoke`), and `apps/mobile/artifacts/maestro/ad-hoc/20260503-230737-43528` (`auth-profile-happy-path`).
  - Host dependencies for rerunning the frontend slow gate locally: full Xcode/iOS Simulator, mobile.dev Maestro CLI, OpenJDK, CocoaPods, Docker via Colima with sufficient disk for Supabase images, and Colima Docker socket compatibility via `/var/run/docker.sock` plus `DOCKER_HOST=unix:///var/run/docker.sock`.
- What remains:
  - none for M13.

## Status update checklist (mandatory during task closeout)

- Keep milestone `Status` current as tasks progress.
- Update task breakdown entries to reflect each task state (`planned | in_progress | completed | blocked | outdated`).
- If milestone remains open after a session, record why in the active task completion note and/or milestone completion note (status remains `in_progress`).
