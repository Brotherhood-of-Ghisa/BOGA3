# BoGa3 read-only agent API v1

This Edge Function is the authenticated data boundary for the BoGa Virtual
Coach. Public deployment prefix:

```text
https://<project>.supabase.co/functions/v1/agent-api
```

Every route below validates the bearer token live with Supabase Auth, requires
its OAuth `client_id` and an active matching grant, derives the owner from the
validated subject, and performs an explicit owner-filtered read. The read routes
accept `GET` only; the two plan-write routes accept `POST` and require a
current-grant plan permission. Request bodies and caller identity fields
(`user_id`, `userId`, `owner_user_id`) are rejected.

Success envelope:

```json
{
  "data": {},
  "meta": { "request_id": "uuid", "api_version": "v1" }
}
```

Error envelope:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required.",
    "request_id": "uuid"
  }
}
```

All responses are JSON with `Cache-Control: no-store` and `x-request-id`.
Timestamps below are ISO 8601 strings. Every weight is kg and load-volume uses
`kg_reps`. The entire serialized success response is limited to 256 KiB and a
validated user/client pair is limited to 120 requests per minute per function
instance.

## Session validation

`GET /v1/agent/session`

```json
{
  "authorized": true,
  "access": "training_read_only",
  "client_id": "oauth-client-id",
  "expires_at": 1785000000,
  "scopes": ["openid", "profile"]
}
```

This route exists for the MCP resource server to validate every incoming bearer
token. It returns no user or account fields.

## Training profile

`GET /v1/agent/profile`

```json
{
  "units": { "load": "kg", "volume": "kg_reps" },
  "timezone": "Europe/London",
  "active_gyms": [{ "id": "gym-id", "name": "Gym name" }],
  "available_equipment": ["Cable"],
  "training_preferences": {}
}
```

Gyms are capped at 50 and derived equipment values are capped by bounded
history reads. Email, username, billing, auth, and account administration are
excluded.

## Exercise search

`GET /v1/agent/exercises`

Query parameters:

- `query` — optional, 1–120 trimmed characters.
- `muscle` and `equipment` — optional, 1–80 trimmed characters.
- `limit` — optional integer `1..50`, default `20`.
- `cursor` — optional opaque cursor returned by the previous page.

```json
{
  "exercises": [{
    "id": "exercise-id",
    "name": "Bench press",
    "load_input_mode": "total_load",
    "muscles": [{
      "id": "muscle-id",
      "display_name": "Chest",
      "family_name": "Chest",
      "weight": 1,
      "role": "primary"
    }],
    "equipment": ["Barbell"]
  }],
  "next_cursor": null
}
```

Only current, non-deleted owner rows are returned. Cursor ordering is stable by
name then ID.

## Exercise context

`GET /v1/agent/exercises/:exerciseId/context`

`recent_sessions` is optional integer `1..20`, default `5`; `gym_bucket`
selects one [gym bucket](#gym-buckets). An exercise owned by another user and a
nonexistent exercise produce the same `404` envelope.

```json
{
  "exercise": {
    "id": "exercise-id",
    "name": "Bench press",
    "load_input_mode": "total_load",
    "muscles": [],
    "equipment": [],
    "split_by_gym": true,
    "gym": { "id": "gym-id", "name": "Home" },
    "gym_buckets": [
      { "gym": { "id": "gym-id", "name": "Home" },
        "last_performed_at": "2026-07-25T18:00:00.000Z" },
      { "gym": null, "last_performed_at": "2026-05-02T10:00:00.000Z" }
    ]
  },
  "recent_performances": [{
    "session_id": "session-id",
    "started_at": "2026-07-25T17:00:00.000Z",
    "completed_at": "2026-07-25T18:00:00.000Z",
    "duration_seconds": 3600,
    "volume": { "value": 640, "unit": "kg_reps" },
    "estimated_one_rep_max": { "value": 102.14, "unit": "kg" },
    "sets": [{
      "id": "set-id",
      "order_index": 0,
      "load": { "value": 80, "unit": "kg" },
      "reps": 8,
      "set_type": "rir_2",
      "performance_status": null,
      "outcome": "completed"
    }, {
      "id": "warm-up-set-id",
      "order_index": 1,
      "load": { "value": 60, "unit": "kg" },
      "reps": 5,
      "set_type": "warm_up",
      "performance_status": null,
      "outcome": "completed"
    }]
  }],
  "personal_records": {
    "estimated_one_rep_max": { "value": 102.14, "unit": "kg" },
    "top_weight": { "value": 80, "reps": 8, "unit": "kg" },
    "max_session_volume": { "value": 640, "unit": "kg_reps" }
  },
  "volume_series": [{
    "completed_at": "2026-07-25T18:00:00.000Z",
    "value": 640,
    "unit": "kg_reps"
  }],
  "last_performed_at": "2026-07-25T18:00:00.000Z",
  "training_notes": [],
  "unavailable_fields": [
    "failed_set_semantics",
    "user_authored_training_notes"
  ],
  "history_truncated": false
}
```

Personal-record and volume calculations import the canonical mobile domain
calculation module and read [working sets only](#working-sets-only)
([[set.eligibility]]), so the warm-up above is listed but feeds no figure. BoGa has no
canonical user-authored note field or failed-set meaning, so this API reports
those fields unavailable instead of inventing semantics.

## Exercise history

`GET /v1/agent/exercises/:exerciseId/history`

Keyset-paginated performed set history for one exercise owned by the user,
ordered in reverse chronological completed-session order by
`(session_completed_at, session_id, exercise_order, set_order)`. Query
parameters: `limit` (`1..100`, default `20`), opaque `cursor`, and `gym_bucket`
(see [gym buckets](#gym-buckets)). Drains to exhaustion when analyzing complete
training history. The `exercise` object is the context route's, so a split
exercise's cursor drains one bucket.

```json
{
  "sets": [{
    "id": "set-id",
    "session_id": "session-id",
    "session_completed_at": "2026-07-25T18:00:00.000Z",
    "exercise_id": "exercise-id",
    "exercise_name": "Bench press",
    "order_index": 0,
    "load": { "value": 80, "unit": "kg" },
    "calculated_load": { "value": 80, "unit": "kg" },
    "reps": 8,
    "set_type": "rir_2",
    "volume": { "value": 640, "unit": "kg_reps" },
    "estimated_one_rep_max": { "value": 102.14, "unit": "kg" }
  }],
  "next_cursor": null
}
```

## Gym buckets

An exercise the user tracks separately per gym (`exercise.split_by_gym`) reports
one exercise per gym, with the sessions that had no gym forming their own
bucket; it is never pooled, so both exercise routes answer for one bucket at a
time. The reported bucket is the exercise's most recently performed one unless
`gym_bucket` names another: a gym id, or `none` for the sessions with no gym
(so a gym whose own id is `none` cannot be named). `gym_bucket` is
`400 INVALID_ARGUMENT` on an exercise that is not split, or empty, or against a
cursor for another bucket, and `404` for a gym the user does not own.

`exercise.gym` is the reported bucket's gym — `null` means the no-gym bucket,
not an unknown gym — and `exercise.gym_buckets` lists the buckets this response
could see, most recently performed first (at most 50), so a client can ask for
another one. Both routes rank buckets over every session that performed a set of
the exercise, warm-ups included, so they agree on the order; a truncated history
(`history_truncated`) can still hide a bucket. An exercise that is not split
carries `split_by_gym: false` and neither field.

A history `next_cursor` carries its own bucket, so draining it pages that bucket
whether or not the caller repeats `gym_bucket`.

## Workout detail

`GET /v1/agent/workouts/:sessionId`

Exact completed workout detail including session header, total volume, compact
exercise list, and keyset-paginated sets ordered by `(exercise_order, set_order)`.
Query parameters: `limit` (`1..100`, default `50`) and opaque `cursor`. An
inaccessible or nonexistent session produces a `404` envelope.

```json
{
  "workout": {
    "id": "session-id",
    "started_at": "2026-07-25T17:00:00.000Z",
    "completed_at": "2026-07-25T18:00:00.000Z",
    "duration_seconds": 3600,
    "gym": { "id": "gym-id", "name": "Gym name" },
    "exercise_count": 1,
    "completed_set_count": 2,
    "total_volume": { "value": 1440, "unit": "kg_reps" },
    "exercises": [{ "id": "block-id", "exercise_id": "exercise-id", "name": "Bench press" }],
    "sets": [{
      "id": "set-id",
      "session_id": "session-id",
      "session_exercise_id": "block-id",
      "exercise_id": "exercise-id",
      "exercise_name": "Bench press",
      "order_index": 0,
      "load": { "value": 80, "unit": "kg" },
      "calculated_load": { "value": 80, "unit": "kg" },
      "reps": 8,
      "set_type": "rir_2",
      "volume": { "value": 640, "unit": "kg_reps" }
    }],
    "next_cursor": null
  }
}
```

## Recent workouts

`GET /v1/agent/workouts/recent`

`limit` is optional integer `1..25`, default `10`; `cursor` is opaque.

```json
{
  "workouts": [{
    "id": "session-id",
    "started_at": "2026-07-25T17:00:00.000Z",
    "completed_at": "2026-07-25T18:00:00.000Z",
    "duration_seconds": 3600,
    "gym": { "id": "gym-id", "name": "Gym name" },
    "exercise_count": 1,
    "completed_set_count": 3,
    "total_volume": { "value": 2500, "unit": "kg_reps" },
    "exercises": [{
      "id": "session-exercise-id",
      "exercise_id": "exercise-id",
      "name": "Bench press",
      "equipment": "Barbell",
      "set_count": 3
    }],
    "truncated": false
  }],
  "next_cursor": null
}
```

At most 50 compact exercise blocks are embedded per workout; `truncated` makes
any internal safety cap explicit. `exercises` lists every block, while
`exercise_count` counts only blocks with at least one working set, and
`completed_set_count`, `set_count` and every volume count working sets
([working sets only](#working-sets-only), [[set.eligibility]]).

## Working sets only

The API reads the app's own rule for which sets and sessions count
([training-metrics contract](../../../docs/specs/tech/training-metrics-contract.md)
§1–§2), through the shared calculation modules, so coaching and app figures
agree. Coaching uses the fixed group and coaching rule of [[set.eligibility]],
never a device's effort settings. This section lists the fields that rule
governs.

- Every derived figure reads working sets only: `personal_records`
  (1RM, top weight, max session volume), each performance's `volume` and
  `estimated_one_rep_max`, `volume_series`, a workout's `total_volume` and each
  exercise's `volume`, and their coverage counts (`eligible_set_count` and the
  rest).
- Every count does too: `completed_set_count`, `exercises[].set_count`, and
  `exercise_count` (blocks with at least one working set).
- A set that is not a working set ([[set.eligibility]]) stays in the raw per-set
  output with its `set_type` and its own `calculated_load`,
  `estimated_one_rep_max` and `volume`. Those describe that set only.
- In exercise context, a session where the exercise had no working set has no
  stat footprint: it is absent from `recent_performances` and `volume_series`,
  sets no `last_performed_at`, and is not an excluded-volume session.

`personal_records` follow the app's record rules
([training-metrics contract](../../../docs/specs/tech/training-metrics-contract.md)
§3): `top_weight` is the heaviest Weight and, at that weight, the most reps; a
tie keeps the earliest session; a zero result is never a record
([[1rm.formula]] for a zero 1RM).

`metric_revision: "working_sets_v6"` reports an exercise the user tracks
separately per gym one [gym bucket](#gym-buckets) at a time.
`"working_sets_v5"` applies the source entry factor to total
Volume for every exercise, retaining entered Weight and displayed 1RM units.
`"working_sets_v4"` omitted the factor from ordinary exercise Volume. 1RM follows
[[1rm.formula]] (`docs/product/1rm.md`). `"working_sets_v3"` estimated a
single's 1RM; `"working_sets_v2"`
counted technique and cooldown sets as working sets; `"working_sets_v1"`
let a zero 1RM, Weight or Volume stand as a record; the earlier
`"bodyweight_optional_v1"` counted warm-ups in every figure.

## Optional bodyweight calculation response

> **Status: accepted current response contract.**

Exercise-context and workout responses carry
`metric_revision: "working_sets_v6"`, which includes this bodyweight contract. Routes, arguments, authorization
and envelopes stay at API v1. Every weight is kg. The existing set `load` and
`top_weight` are raw entered Weight and never include bodyweight contribution.

The API resolves the owner-synced private preference before calculating:

- preference off: use ordinary Weight/1RM/Volume math and omit
  `session_body_weight`, reading provenance and contribution fields;
- preference on with a positive contribution: include
  `bodyweight_contribution`, use the latest valid reading at/before each session
  start, and return the applicable reading needed for an authorized coach to
  interpret those bodyweight-aware derived metrics;
- preference on with a zero contribution: use ordinary math and omit the
  reading and bodyweight context because no derived metric requires them;
- preference on with a positive contribution but no reading: use the personal
  zero fallback and return a `missing` context without blocking metrics.

The service-only `session_weight_contexts` RPC batches already-authorized
sessions. It is not executable by normal app/OAuth clients and never returns the
owner's timeline. An enabled response may contain:

```json
{
  "session_body_weight": {
    "status": "known",
    "value": 80,
    "unit": "kg",
    "measured_at": "2026-07-25T08:00:00.000Z"
  }
}
```

The public coaching response does not need a reading identifier. Missing uses
`{"status":"missing","value":null,"unit":"kg","measured_at":null}`;
malformed rows are skipped, so an older valid row may apply; if none applies the
context is `missing`. There is no future estimate or session override.

Performed sets use ordinary vocabulary and separate raw/derived values:

```json
{
  "load": { "value": 20, "unit": "kg" },
  "calculated_load": { "value": 100, "unit": "kg" },
  "estimated_one_rep_max": { "value": 47.67141908045373, "unit": "kg" },
  "volume": { "value": 800, "unit": "kg_reps" }
}
```

Parsing, the zero rule and the load, Volume and 1RM formulas are the app's
([training-metrics contract](../../../docs/specs/tech/training-metrics-contract.md)
§4); only confirmed performed rows ([[set.performed]]) that are not deleted
contribute. The breakdown is an API interpretation aid, not a user-facing label.

Volume coverage remains explicit for invalid/overflow/truncated input. Missing
bodyweight under the personal policy is complete zero-fallback input, not
incomplete coverage. A null value is unavailable, never zero. Records remain
bounded by `history_truncated` and never imply unbounded lifetime coverage.

`training-metrics.ts` imports the shared calculation boundary. Settings,
definitions, sessions, sets and applicable readings are owner-filtered and
batched with no per-set query or timeline response. Preference, contribution,
reading value/date/delete/restore and session-start changes affect the next API
read; no derived value is persisted.

## Plan permission and write routes

The base OAuth grant is read-only. Reading the upcoming plan queue and creating
plans/programmes additionally require a current-grant row in
`public.agent_plan_permissions` (`plan_access_enabled = true` and `granted_at`
equal to the live OAuth grant timestamp). A missing, false or grant-mismatched
row returns `403 PLAN_PERMISSION_REQUIRED` before any referenced exercise or gym
is resolved. The person enables it per client on the app's Connected Agents
screen; the base OAuth consent is never described as write access.

### `GET /v1/agent/session-plans`

`limit` is optional integer `1..50`, default `20`; `cursor` is opaque;
`include_unscheduled` is optional `true`/`false` (default `false`). Only the
owner's non-deleted plans are returned, ordered by scheduled time then ID, with
null-scheduled plans last. Each plan carries its provenance, derived `progress`
(`planned | in_progress | completed`), `next_block_id`, and bounded exercise/set
snapshots.

### `POST /v1/agent/session-plans` and `POST /v1/agent/programmes`

Both require an `Idempotency-Key` header (1..128 characters) and a strict JSON
body. A plan body is `{title, gym_id?, scheduled_for?, exercises:[{exercise_definition_id?,
name, sets:[{target_reps, target_weight_value?, target_set_type?}]}]}`; a
programme body is `{name, description?, plans:[<plan>...]}` with 2..50 plans,
1..30 blocks per plan and 1..30 sets per block. Referenced exercise and gym IDs
must be owned; a foreign or nonexistent ID returns `400
FOREIGN_RESOURCE_REFERENCE`.

Each call creates the whole graph in one transaction with `provenance = 'agent'`
and `pending` blocks. A child failure rolls back every row, including the
receipt. Replaying the same key and payload returns the original IDs
(`idempotent_replay: true`); the same key with a different payload returns `409
IDEMPOTENCY_CONFLICT`. No performed session, exercise or set row is ever
created, and the agent cannot attach, complete, skip or edit a plan.

```json
{
  "plan_id": "uuid",
  "programme_id": null,
  "exercise_ids": ["uuid"],
  "set_ids": ["uuid"],
  "idempotent_replay": false
}
```

## Status contract

- `400` invalid/unknown argument, identity input, cursor, or foreign/nonexistent resource reference.
- `401` missing, invalid, expired, normal-app, or revoked authorization.
- `403` plan permission missing, disabled or bound to a stale grant.
- `404` unknown route or inaccessible/nonexistent exercise.
- `405` unsupported method for the route.
- `409` idempotency conflict (same key, different payload).
- `413` the request body exceeds its bound, or the generated response exceeds its 256 KiB safety bound.
- `429` request rate exceeded.
- `500` internal/database failure with no sensitive detail.
- `503` `UPSTREAM_UNAVAILABLE` with `Retry-After`: Supabase Auth could not
  check the token (unreachable, timeout, `408`/`429` or `5xx` from `getUser` or
  the grants endpoint). Only a `4xx` rejection from Auth is a `401`.

Run `./boga test agent-api` for the real OAuth/RLS contract and
`./boga test mcp-smoke` for the real MCP-to-API path.
