# BoGa3 read-only agent API v1

This Edge Function is the authenticated data boundary for the BoGa Virtual
Coach. Public deployment prefix:

```text
https://<project>.supabase.co/functions/v1/agent-api
```

Every route below accepts `GET` only, validates the bearer token live with
Supabase Auth, requires its OAuth `client_id` and an active matching grant,
derives the owner from the validated subject, and performs an explicit
owner-filtered read. Request bodies and caller identity fields (`user_id`,
`userId`, `owner_user_id`) are rejected.

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
Timestamps below are ISO 8601 strings. In the current pre-cutover response,
normalized loads use `kg`, load-volume uses `kg_reps`, and `entered_load`
retains its original `kg` or `lb` unit. The accepted clean response below makes
every weight kg when implemented. The entire serialized success response is limited to 256 KiB and a
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

`recent_sessions` is optional integer `1..20`, default `5`. An exercise owned
by another user and a nonexistent exercise produce the same `404` envelope.

```json
{
  "exercise": {
    "id": "exercise-id",
    "name": "Bench press",
    "load_input_mode": "total_load",
    "muscles": [],
    "equipment": []
  },
  "recent_performances": [{
    "session_id": "session-id",
    "started_at": "2026-07-25T17:00:00.000Z",
    "completed_at": "2026-07-25T18:00:00.000Z",
    "duration_seconds": 3600,
    "volume": { "value": 2500, "unit": "kg_reps" },
    "estimated_one_rep_max": { "value": 100, "unit": "kg" },
    "sets": [{
      "id": "set-id",
      "order_index": 0,
      "load": { "value": 80, "unit": "kg" },
      "reps": 8,
      "set_type": "working",
      "performance_status": null,
      "outcome": "completed"
    }]
  }],
  "personal_records": {
    "estimated_one_rep_max": { "value": 100, "unit": "kg" },
    "top_weight": { "value": 80, "reps": 8, "unit": "kg" },
    "max_session_volume": { "value": 2500, "unit": "kg_reps" }
  },
  "volume_series": [{
    "completed_at": "2026-07-25T18:00:00.000Z",
    "value": 2500,
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
calculation module. BoGa has no canonical user-authored note field or failed-set
meaning, so this API reports those fields unavailable instead of inventing
semantics.

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
any internal safety cap explicit.

## Optional bodyweight calculation response

> **Status: accepted clean response contract; implementation pending.**

Exercise-context and workout responses carry
`metric_revision: "bodyweight_optional_v1"`. Routes, arguments, authorization
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

Blank Weight plus valid performed reps canonicalizes to zero. Valid zero returns
numeric zero metrics and creates no record/ranking. Planned, skipped,
unperformed, invalid and deleted rows do not contribute. Wathan applies to the
calculated load and displayed 1RM follows the contract's per-side/contribution
formula. The breakdown is an API interpretation aid, not a user-facing label.

Volume coverage remains explicit for invalid/overflow/truncated input. Missing
bodyweight under the personal policy is complete zero-fallback input, not
incomplete coverage. A null value is unavailable, never zero. Records remain
bounded by `history_truncated` and never imply unbounded lifetime coverage.

`training-metrics.ts` imports the shared calculation boundary. Settings,
definitions, sessions, sets and applicable readings are owner-filtered and
batched with no per-set query or timeline response. Preference, contribution,
reading value/date/delete/restore and session-start changes affect the next API
read; no derived value is persisted.

## Status contract

- `400` invalid/unknown argument, identity input, or cursor.
- `401` missing, invalid, expired, normal-app, or revoked authorization.
- `404` unknown route or inaccessible/nonexistent exercise.
- `405` non-GET method.
- `413` the generated response exceeds its 256 KiB safety bound.
- `429` request rate exceeded.
- `500` internal/database failure with no sensitive detail.

Run `./boga test agent-api` for the real OAuth/RLS contract and
`./boga test mcp-smoke` for the real MCP-to-API path.
