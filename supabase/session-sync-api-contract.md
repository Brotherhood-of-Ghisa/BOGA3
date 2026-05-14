# Session Sync API Contract (`M5 baseline` + `M13 event contract`)

## Super simple summary

- M5 uses `Supabase PostgREST` directly on `app_public` tables (`gyms`, `sessions`, `session_exercises`, `exercise_sets`).
- M13 locks a new client-facing sync protocol: batched granular events with idempotent ingest + projection.
- M5 table CRUD remains a legacy baseline and may still be used internally by backend projection paths, but it is not the M13 mobile sync contract.

## Related baseline docs (per `docs/specs/04-ai-development-playbook.md`)

- `docs/specs/10-api-authn-authz-guidelines.md` (backend API/authN/authZ rules for this sync surface)

## Status / scope

- M5 baseline status: implemented for local/backend validation.
- M13 event contract status: locked and implemented on backend for `M13-T03`.
- Current M5 implemented entities:
  - `gyms`
  - `sessions`
  - `session_exercises`
  - `exercise_sets`
- M13 backup-scope entities (full user-owned scope):
  - `gyms`
  - `sessions`
  - `session_exercises`
  - `exercise_sets`
  - `exercise_definitions`
  - `exercise_muscle_mappings`
  - `exercise_tag_definitions`
  - `session_exercise_tags`
- Out of scope for this contract:
  - client outbox runtime implementation details
  - multi-device conflict semantics

## Contract versions and precedence

| Contract surface | Status | Primary client use |
| --- | --- | --- |
| M5 `PostgREST` row CRUD | Implemented (legacy baseline) | Existing baseline integrations and backend internals |
| M13 `sync.events.ingest` batch envelope | Implemented (backend) | Required client sync wire protocol for M13 |

Rule:

- M13 mobile sync wiring must use the M13 event protocol as the primary wire contract.

## M13 event contract (locked)

### Canonical batch request envelope

```json
{
  "device_id": "ios-2f4f7b84",
  "batch_id": "c5f2735b-3327-4a3d-b6e4-bfa83815f244",
  "sent_at_ms": 1762406400000,
  "events": [
    {
      "event_id": "9e59bde0-a53f-4f2d-b8f2-a12858f91bb9",
      "sequence_in_device": 42,
      "occurred_at_ms": 1762406399555,
      "entity_type": "session_exercises",
      "entity_id": "sx_123",
      "event_type": "reorder",
      "payload": {
        "session_id": "session_123",
        "order_index": 1
      }
    }
  ]
}
```

### Event-envelope field rules

Required fields (every event):

| Field | Type | Validation rule |
| --- | --- | --- |
| `event_id` | `uuid` string | Unique idempotency key per `(owner_user_id, device_id)`. |
| `sequence_in_device` | integer | `>= 1`, strictly monotonic for each `(owner_user_id, device_id)`. |
| `occurred_at_ms` | integer | epoch milliseconds, `>= 0`. |
| `entity_type` | enum | one of `gyms`, `sessions`, `session_exercises`, `exercise_sets`, `exercise_definitions`, `exercise_muscle_mappings`, `exercise_tag_definitions`, `session_exercise_tags`. |
| `entity_id` | string | non-empty, stable primary-id of the mutated entity row or relation key. |
| `event_type` | enum | one of `upsert`, `delete`, `attach`, `detach`, `reorder`, `complete`; must be valid for the chosen `entity_type`. |
| `payload` | object | JSON object; required keys depend on `(entity_type, event_type)`; may be `{}` only when contract explicitly allows it. |

Required request-level fields:

| Field | Type | Validation rule |
| --- | --- | --- |
| `device_id` | string | non-empty; stable per installed app instance. |
| `batch_id` | `uuid` string | request correlation id used for observability/debugging. |
| `sent_at_ms` | integer | epoch milliseconds generated when the batch is sent. |
| `events` | array | `1..100` entries (M13 batch-size limit). |

Optional event fields:

| Field | Type | Validation rule |
| --- | --- | --- |
| `schema_version` | integer | optional, defaults to `1`; reject when unsupported. |
| `trace_id` | `uuid` string | optional diagnostics correlation id. |

Implementation note (`M13-T03`):

- current backend validation is strict on ordering/compatibility but permissive on id string format (`batch_id`, `event_id`, `trace_id`) to preserve compatibility with the current mobile outbox id generation; client contract target remains UUID-like ids.

### M13 backend endpoint mapping (implemented)

- Provider-neutral method: `sync.events.ingest`
- Supabase mapping: `POST /rest/v1/rpc/sync_events_ingest`
- Schema profile headers:
  - `Accept-Profile: app_public`
  - `Content-Profile: app_public`
- Body shape: request envelope fields `device_id`, `batch_id`, `sent_at_ms`, `events`.

### Entity-to-event mapping (full M13 scope)

| Entity | Supported event types | Notes |
| --- | --- | --- |
| `gyms` | `upsert`, `delete` | `delete` is soft-delete; undelete uses `upsert` with tombstone cleared |
| `sessions` | `upsert`, `delete`, `complete` | `delete` is soft-delete; undelete uses `upsert` |
| `session_exercises` | `upsert`, `delete`, `reorder` | `delete` is soft-delete; `upsert` can undelete |
| `exercise_sets` | `upsert`, `delete`, `reorder` | `delete` is soft-delete; `upsert` can undelete and may include optional `set_type` (`warm_up`, `rir_0`, `rir_1`, `rir_2`) |
| `exercise_definitions` | `upsert`, `delete` | `delete` is soft-delete; undelete uses `upsert` |
| `exercise_muscle_mappings` | `attach`, `detach` | `attach` can recreate a previously detached edge |
| `exercise_tag_definitions` | `upsert`, `delete` | `delete` is soft-delete; undelete uses `upsert` |
| `session_exercise_tags` | `attach`, `detach` | `attach` can recreate a previously detached edge |

### Canonical ingest response envelope

Success response:

```json
{
  "status": "SUCCESS"
}
```

Failure response:

```json
{
  "status": "FAILURE",
  "error_index": 2,
  "error_event_id": "3e0b5d52-a8a1-4183-bc38-29e8efd9302c",
  "should_retry": true,
  "message": "Expected sequence 43 but got 44."
}
```

Field notes:

- `status`: `SUCCESS | FAILURE`
- `error_index`: `0`-based index in request `events[]`; required when `status=FAILURE`
- `error_event_id`: optional convenience mirror of `events[error_index].event_id`
- `should_retry`: required when `status=FAILURE`; controls client retry/no-retry behavior
- `message`: required when `status=FAILURE`; free-text and non-enum by contract

### Idempotency + ordering semantics (testable)

1. Idempotency key:
   - server deduplicates by `(owner_user_id, device_id, event_id)`.
2. Duplicate re-submit, same payload:
   - treated as a no-op success and must not re-apply projection side effects.
3. Duplicate `event_id` with different payload:
   - return `FAILURE` with `should_retry=false`.
4. Batch ordering:
   - backend processes events strictly in request order (`events[0]`, `events[1]`, ...).
5. Sequence monotonicity:
   - each event must satisfy device-stream monotonic ordering; any sequence failure stops processing.
6. Stop-on-first-failure:
   - on first failing event at index `i`, backend returns `FAILURE` with `error_index=i`; event `i` and all later events are not applied.
7. Prefix commit contract:
   - events before `error_index` are committed and should be removed from the client outbox.
8. Retry contract:
   - client retries only when `should_retry=true`, using locked backoff constants (`2s`, `x2`, max `2m`, `+-25%` jitter).

### Failure response semantics (client-facing)

1. No enum error code is exposed in the client contract for M13.
2. `message` is free-text and informational; clients must not parse it for control flow.
3. `should_retry` is the only retry-control signal in the response contract.

## Surface choice (why `PostgREST` first)

- The sync-domain CRUD contract maps 1:1 to user-owned tables already protected by `RLS`.
- `RLS` + FK/check constraints already enforce ownership and core invariants server-side.
- Avoids premature custom runtime code (`Edge Functions`) before cross-entity orchestration/validation is needed.
- Keeps M5 test focus on real auth + `RLS` behavior in local Supabase.

## Auth requirements (all methods)

- Use local/hosted `Supabase` API endpoint + client-safe `anon` key.
- Send authenticated user JWT in `Authorization: Bearer <access_token>`.
- For `app_public` table routes, send:
  - `Accept-Profile: app_public`
  - `Content-Profile: app_public` (writes)

## Provider-neutral method catalog (M5 baseline)

The FE integration milestone should treat the following as the stable contract names. The current Supabase implementation mapping is documented alongside each method.

### `gyms`

| Provider-neutral method | Purpose | Supabase mapping (M5) |
| --- | --- | --- |
| `sync.gyms.list` | Pull gyms for current user (optionally filtered by `updatedAt >=`) | `GET /rest/v1/gyms?...` (`app_public`) |
| `sync.gyms.create` | Create user-owned gym row | `POST /rest/v1/gyms` (`Prefer: return=representation`) |
| `sync.gyms.update` | Update an existing user-owned gym row by `id` | `PATCH /rest/v1/gyms?id=eq.<id>` (`Prefer: return=representation`) |

### `sessions`

| Provider-neutral method | Purpose | Supabase mapping (M5) |
| --- | --- | --- |
| `sync.sessions.list` | Pull sessions for current user | `GET /rest/v1/sessions?...` (`app_public`) |
| `sync.sessions.create` | Create session row | `POST /rest/v1/sessions` |
| `sync.sessions.update` | Update session row by `id` (including status/completion fields) | `PATCH /rest/v1/sessions?id=eq.<id>` |

### `session_exercises`

| Provider-neutral method | Purpose | Supabase mapping (M5) |
| --- | --- | --- |
| `sync.sessionExercises.list` | Pull exercises (typically filtered by `session_id`) | `GET /rest/v1/session_exercises?...` |
| `sync.sessionExercises.create` | Create exercise row under session | `POST /rest/v1/session_exercises` |
| `sync.sessionExercises.update` | Update exercise row by `id` | `PATCH /rest/v1/session_exercises?id=eq.<id>` |

### `exercise_sets`

| Provider-neutral method | Purpose | Supabase mapping (M5) |
| --- | --- | --- |
| `sync.exerciseSets.list` | Pull sets (typically filtered by `session_exercise_id`) | `GET /rest/v1/exercise_sets?...` |
| `sync.exerciseSets.create` | Create set row under exercise | `POST /rest/v1/exercise_sets` |
| `sync.exerciseSets.update` | Update set row by `id` | `PATCH /rest/v1/exercise_sets?id=eq.<id>` |

## Payload contracts (provider-neutral fields)

All timestamps are epoch milliseconds (`number`), matching the current mobile/local schema.

Field notes for current local/mobile parity:

- `sessions.status`: clients should use `active`/`completed`; backend still accepts legacy `draft` rows for compatibility.
- `session_exercises.exercise_definition_id`: optional text metadata for durable exercise-definition linkage.
- `exercise_sets.set_type`: optional enum text (`warm_up`, `rir_0`, `rir_1`, `rir_2`).

### `GymRecord`

```json
{
  "id": "gym_123",
  "name": "Downtown Gym",
  "created_at": 1730000000000,
  "updated_at": 1730000001000
}
```

### `SessionRecord`

```json
{
  "id": "session_123",
  "gym_id": "gym_123",
  "status": "active",
  "started_at": 1730000010000,
  "completed_at": null,
  "duration_sec": null,
  "deleted_at": null,
  "created_at": 1730000010000,
  "updated_at": 1730000010000
}
```

### `SessionExerciseRecord`

```json
{
  "id": "sx_123",
  "session_id": "session_123",
  "order_index": 0,
  "name": "Chest Press",
  "machine_name": "Plate Press",
  "exercise_definition_id": "exercise_chest_press",
  "created_at": 1730000020000,
  "updated_at": 1730000020000
}
```

### `ExerciseSetRecord`

```json
{
  "id": "set_123",
  "session_exercise_id": "sx_123",
  "order_index": 0,
  "weight_value": "120",
  "reps_value": "10",
  "set_type": "rir_2",
  "created_at": 1730000030000,
  "updated_at": 1730000030000
}
```

## Example request/response mappings (M5 local `PostgREST`)

### Example: create gym (`sync.gyms.create`)

- Method: `POST`
- Route: `/rest/v1/gyms`
- Headers:
  - `Accept-Profile: app_public`
  - `Content-Profile: app_public`
  - `Prefer: return=representation`
- Body:

```json
{
  "id": "sync-gym-a-1",
  "name": "Warehouse Gym",
  "created_at": 1730000000000,
  "updated_at": 1730000000000
}
```

- Success response: `201` + array with the inserted row (including backend-populated `owner_user_id`).

### Example: update session completion (`sync.sessions.update`)

- Method: `PATCH`
- Route: `/rest/v1/sessions?id=eq.sync-session-a-1`
- Body:

```json
{
  "status": "completed",
  "completed_at": 1730000004000,
  "duration_sec": 4,
  "updated_at": 1730000004001
}
```

- Success response: `200` + array containing the updated row.
- Cross-user attempt: `200` + empty array (hidden by `RLS`).

### Example: list exercises for session (`sync.sessionExercises.list`)

- Method: `GET`
- Route: `/rest/v1/session_exercises?session_id=eq.sync-session-a-1&select=id,order_index,name&order=order_index.asc`
- Success response: `200` + ordered array of rows visible to the authenticated owner.

## Error/denial semantics (provider-neutral handling guidance)

Current Supabase `PostgREST` behavior is intentionally preserved in M5. FE integration should normalize it into provider-neutral categories.

| Provider-neutral category | Typical `PostgREST` behavior (M5) | Notes |
| --- | --- | --- |
| `AUTH_REQUIRED` | non-2xx JSON error (commonly `401`) | Missing/invalid user JWT for protected `app_public` tables |
| `VALIDATION_FAILED` | non-2xx JSON error (`Postgres`/`PostgREST` code in body) | Check constraints, missing required fields, type issues |
| `NOT_FOUND_OR_DENIED` | `200` + empty array on targeted `SELECT`/`PATCH` | `RLS` hides cross-user rows instead of revealing existence |
| `PARENT_LINK_DENIED` | non-2xx JSON error (FK violation) | Cross-user child insert/update fails FK + ownership linkage |

## Contract test coverage (local Supabase)

M5 baseline integration/contract suite:

- `supabase/tests/session-sync-api-contract.sh`
- wrapper: `supabase/scripts/test-sync-api-contract.sh`

Coverage includes:

- success create/read/update/list flows for each entity family
- validation failures for each entity family
- unauthenticated request denial
- cross-user read/update denial
- cross-user parent/child ownership mismatch denial

M13 backend ingest/projection integration/contract suite (`M13-T03`):

- `supabase/tests/sync-events-ingest-contract.sh`
- wrapper: `supabase/scripts/test-sync-events-ingest-contract.sh`

Coverage includes:

- authenticated success-path ingest across all eight M13 data-scope entities with projection verification
- request-order processing with stop-on-first-failure + prefix-commit proof
- idempotency checks:
  - duplicate replay with same event body -> `SUCCESS` no-op
  - duplicate `event_id` with changed event body -> `FAILURE` + `should_retry=false`
- ordering checks:
  - sequence gap -> `FAILURE` + `should_retry=true`
  - recovery after sequence gap with missing event replay
- response-envelope checks:
  - `status=SUCCESS` for full success batches
  - `status=FAILURE` with `error_index`, `should_retry`, optional `error_event_id`, and free-text `message`
- auth/RLS denial checks:
  - unauthenticated ingest denied
  - cross-user reads denied on ingest metadata and projected rows
