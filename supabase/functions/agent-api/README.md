# BoGa3 read-only agent API v1

This Edge Function is the authenticated data boundary for the BoGa Virtual
Coach. Public deployment prefix:

```text
https://<project>.supabase.co/functions/v1/agent-api
```

Every route below validates the bearer token live with Supabase Auth, requires
its OAuth `client_id` and an active matching grant, derives the owner from the
validated subject, and performs an explicit owner-filtered read. The read routes
accept `GET` only; the write routes accept `POST` (`PUT` for muscle targets)
and require a current-grant plan permission. GET bodies and caller identity
fields (`user_id`, `userId`, `owner_user_id`) are rejected.

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
Timestamps are ISO 8601, weights kg, load-volume `kg_reps`. A success response
is limited to 256 KiB and a validated user/client pair to 120 requests per
minute per function instance.

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

The MCP resource server calls this route to validate every bearer token; it
returns no user or account fields.

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
- `include_deleted` — optional `true`/`false` (default `false`).

```json
{
  "exercises": [{
    "id": "exercise-id",
    "name": "Bench press",
    "load_input_mode": "total_load",
    "split_by_gym": false,
    "rest_timer_sec": null,
    "deleted": false,
    "revision": 1760000000000,
    "muscles": [{"id": "muscle-id", "name": "Chest", "family": "Chest", "weight": 1, "role": "primary"}],
    "equipment": ["Barbell"]
  }],
  "next_cursor": null
}
```

Only owner rows are returned, soft-deleted ones only with `include_deleted`.
Cursor ordering is stable by name then ID. `revision` is the definition's LWW
stamp, quoted by every exercise edit.
`GET /v1/agent/muscles` lists the owner's live muscles (`id`, `name`,
`family`, plus the owner's setup: `report_group`, the key of the muscle the
entry reports under or `null` for its own, and `tracked`, a boolean);
exercise writes must name these ids, never a `report_group`.

## Exercise context

`GET /v1/agent/exercises/:exerciseId/context`

`recent_sessions` is optional integer `1..20`, default `5`; `gym_bucket`
names one gym of a [split exercise](#gym-buckets). An exercise owned by another user and a
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
    "rest_timer_sec": 120,
    "gym_usage": {
      "gyms": [{ "gym": { "id": "gym-id", "name": "Home" }, "session_count": 23,
        "last_performed_at": "2026-07-25T18:00:00.000Z" }],
      "no_gym_session_count": 2,
      "complete": true
    },
    "gym_buckets": [
      { "gym": { "id": "gym-id", "name": "Home" },
        "last_performed_at": "2026-07-25T18:00:00.000Z",
        "session_count": 23,
        "personal_records": {
          "estimated_one_rep_max": { "value": 102.14, "unit": "kg" },
          "top_weight": { "value": 80, "reps": 8, "unit": "kg" },
          "max_session_volume": { "value": 640, "unit": "kg_reps" }
        } }
    ]
  },
  "recent_performances": [{
    "session_id": "session-id",
    "gym": { "id": "gym-id", "name": "Home" },
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
([[set.eligibility]]), so the warm-up above is listed but feeds no figure.
`gym_usage`, on every exercise, counts the sessions holding a working set per
gym (up to 50, most recent first) and with no gym; `complete` is false when the
history read was bounded. BoGa has no
canonical user-authored note field or failed-set meaning, so those fields are
reported unavailable.

## Exercise history

`GET /v1/agent/exercises/:exerciseId/history`

Keyset-paginated performed set history for one exercise owned by the user,
ordered in reverse chronological completed-session order by
`(session_completed_at, session_id, exercise_order, set_order)`. Query
parameters: `limit` (`1..100`, default `20`), opaque `cursor`, and `gym_bucket`
(see [gym buckets](#gym-buckets)). Drains to exhaustion when analyzing complete
training history. Paging never partitions by gym: a page is one page of sets
across every gym, and a split exercise's sets each carry their own `gym` (`null`
for a session with no gym), as a workout does — group by it before comparing.
`gym_bucket` filters the stream to one gym, and only then does the cursor pin
it and `exercise.gym` name it.

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
    "estimated_one_rep_max": { "value": 102.14, "unit": "kg" },
    "gym": { "id": "gym-id", "name": "Home" }
  }],
  "next_cursor": null
}
```

## Gym buckets

An exercise the user tracks separately per gym (`exercise.split_by_gym`) keeps
its whole-exercise figures and adds one bucket per gym ([[gym.split]]). Unset
`gym_bucket` is the whole exercise: every gym, and the sessions with no gym,
which count only there and are never a bucket of their own. `gym_bucket` names
one gym id, and context's figures, or history's stream, then come from that
gym's sessions alone. It is `400 INVALID_ARGUMENT` on an exercise that is not
split, when empty, or against a cursor for another gym, and `404` for a gym the
user does not own. `none` is rejected the same way, and a history cursor pinned
to the no-gym sessions is `400 INVALID_CURSOR` while the exercise is split.

The context route's `exercise.gym_buckets` lists every gym it could see, most
recently performed first, each with its own `personal_records` and
`session_count`, so one call compares the gyms. Past 50 gyms it lists the 50
newest and sets `gym_buckets_truncated`. Gyms are
ranked over the sessions those figures count — [working sets
only](#working-sets-only) — so a gym performed only as warm-ups is not listed.
Each of a split exercise's `recent_performances` and `volume_series` points
names its `gym` (`null` for no gym). The history route carries no inventory;
its sets already name their gyms.

`exercise.gym` appears only when one gym owns the response: a request naming
`gym_bucket`. Equal `last_performed_at` values break on the gym id; a truncated
history (`history_truncated`) can still hide a gym. An exercise that is not
split carries `split_by_gym: false` and no gym field, and a cursor's filter
lapses if the flag is turned off between pages. A filtered history's
`next_cursor` carries its gym, so draining it keeps the filter; an unfiltered
cursor stays unfiltered.

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
any cap explicit. `exercises` lists every block, while `exercise_count` counts
only blocks with a working set, and `completed_set_count`, `set_count` and every
volume count working sets
([working sets only](#working-sets-only), [[set.eligibility]]).

## Training status

`GET /v1/agent/training-status` takes no inputs and needs no write access. It
returns one bounded object; days and Monday-start weeks are the profile
`time_zone`'s (UTC when unset or unknown).

```json
{
  "metric_revision": "working_sets_v8", "as_of": "2026-10-28T12:00:00.000Z",
  "time_zone": "Europe/London", "today": "2026-10-28", "week_start": "2026-10-26",
  "muscle_setup": "broad", "counts_secondary_sets": true,
  "targets": { "mode": "per_muscle", "default_weekly_sets": 8, "uploaded": true, "revision": 1761650000000 },
  "muscles": [{ "id": "chest", "name": "Chest", "family": "Chest", "weekly_target": 12,
    "week_sets": 6.5, "recovery_days": [{ "date": "2026-10-25", "sets": null }],
    "today_sets": null, "last_trained_on": "2026-10-27",
    "weekly_sets_last_4_weeks": [{ "week_start": "2026-09-28", "sets": 10 }] }],
  "favourite_exercises": [{ "exercise_id": "…", "name": "Bench Press", "sessions_28d": 7,
    "last_done_on": "2026-10-26", "best_e1rm_kg": { "last_28d": 102.5, "previous_28d": 98.0 },
    "last_record_on": "2026-10-12", "record_history_complete": true }],
  "complete": true
}
```

`training-status.ts` derives the muscles with Today's Plan's own functions,
under coaching's working-set rule and completed workouts only. Favourites are
a coach-only order: most sessions with a working set in 28 days, then latest
done, then name; never the app's recency-weighted Favourites sort. `revision` is the settings row's `client_updated_at_ms` (0
with no row); `uploaded: false` shows app defaults. Sets older than 56 days are
not read, except each favourite's own history, which dates its records;
`record_history_complete: false` when it hit the exercise-context cap (500
blocks), so a record may be dated too late. `complete: false` when a 56-day or
muscle read hit its cap: 200 sessions, 1000 rows per chunk, or 500 muscles.

## Muscle targets

`PUT /v1/agent/muscle-targets` needs write access and an `Idempotency-Key`
(own window, 30 per minute). Strict JSON: `expected_revision`
(`targets.revision` above) and at least one of `default_weekly_sets`, `mode`
(`single` | `per_muscle`), `overrides` (`{muscle_id: n | null}`, null clears).
Targets are positive whole numbers, ids muscles the user's setup reports (`400
VALIDATION_ERROR` naming the id; [[muscle.weekly-targets]]); a stale revision
is `409 REVISION_CONFLICT`. The setup scope is derived as the app does
(`muscle-targets.ts`); `agent_set_muscle_targets` merges into it, keeps the
other scopes and the count-secondary switch, and stamps the row past the wall
clock so devices pull it. While `uploaded` is false it builds on app defaults
(first writer wins). It returns `scope`, `overrides`, `targets`,
`idempotent_replay`.

## Working sets only

The API reads the app's own rule for which sets and sessions count
([training-metrics contract](../../../docs/specs/tech/training-metrics-contract.md)
§1–§2), through the shared calculation modules, so coaching and app figures
agree. Coaching uses the fixed group and coaching rule of [[set.eligibility]],
never a device's effort settings.

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

`metric_revision: "working_sets_v8"` reports a split exercise as the whole
exercise unless `gym_bucket` names a gym ([gym buckets](#gym-buckets)). For what
an earlier `metric_revision` meant, see the
[revision history](../../../docs/procedures/rule-upgrade.md#revision-history).

## Optional bodyweight calculation response

> **Status: accepted current response contract.**

Exercise-context and workout responses carry
`metric_revision: "working_sets_v8"`, which includes this bodyweight contract. Routes, arguments, authorization
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

Missing uses
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
contribute.

Volume coverage remains explicit for invalid/overflow/truncated input. Missing
bodyweight under the personal policy is complete zero-fallback input, not
incomplete coverage. A null value is unavailable, never zero. Records stay
bounded by `history_truncated`, never implying lifetime coverage.

Settings, definitions, sessions, sets and applicable readings are owner-filtered and batched,
with no per-set query or timeline response. Preference, contribution,
reading and session-start changes affect the next API read; no derived value is
persisted.

## Plan permission and write routes

The base OAuth grant is read-only. Reading the upcoming plan queue, creating
plans/programmes, editing exercises and setting muscle targets additionally
require a current-grant row in `public.agent_plan_permissions`
(`plan_access_enabled = true` and `granted_at` equal to the live OAuth grant
timestamp). A missing, false or grant-mismatched row returns `403
PLAN_PERMISSION_REQUIRED` before any referenced resource is resolved. The person
enables it per client on the Connected Agents screen (one switch covers all
writes); base OAuth consent is never described as write access.

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
and `pending` blocks; a child failure rolls back every row, receipt included.
Replaying the same key and payload returns the original IDs
(`idempotent_replay: true`); the same key with another payload returns `409
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

## Exercise editing

Every route requires write access and an `Idempotency-Key`; replay and conflict
behave as for plans. Bodies are strict JSON:

- `POST /v1/agent/exercises` — `{name, muscles, load_input_mode?,
  bodyweight_contribution?, split_by_gym?, rest_timer_sec?}`; defaults
  `total_load`, `0`, `false`, `null`. `rest_timer_sec` is null or whole seconds
  15–600 ([[timer.rest-default]]); null uses the device-local global timer.
- `POST /v1/agent/exercises/{id}` — `{expected_revision, ...fields}`: only the
  fields present change; `muscles` replaces the whole set, and
  `rest_timer_sec: null` clears the exercise's own timer.
- `POST /v1/agent/exercises/{id}/delete` and `/restore` — `{expected_revision}`.
  Soft delete only; logged history keeps its rows.

`muscles` is `[{muscle_id, role}]`: one or more `primary` entries and optional
`secondary` entries; at most 12 distinct muscles. Analytics use
[[muscle.set-count]] (`exercise-edit.ts`). A muscle that is not the owner's live row returns `400
FOREIGN_RESOURCE_REFERENCE`; a missing or foreign exercise `404`; a stale
`expected_revision` `409 REVISION_CONFLICT`; editing a deleted exercise `409
EXERCISE_DELETED`. Exercise writes have their own 30-per-minute window.

The service-role-only `agent_*_exercise` RPCs stamp each touched row at or past the
wall clock and past every stamp the exercise holds, so devices pull it under LWW. A
re-added muscle revives its row, a new one takes the id
`map_<exercise>__<muscle>`, a dropped one is tombstoned, and a `load_input_mode`
change re-scores linked group exercises. The response is the RPC result
(`exercise_id`, `revision`, `idempotent_replay`, plus `deleted`/`changed`) and
`exercise`, the catalog view after the write.

## Status contract

- `400` invalid/unknown argument (`VALIDATION_ERROR` for targets), identity input, cursor, or foreign/nonexistent resource reference.
- `401` missing, invalid, expired, normal-app, or revoked authorization.
- `403` write access missing, disabled or bound to a stale grant.
- `404` unknown route or inaccessible/nonexistent exercise.
- `405` unsupported method for the route (`PUT` only for muscle targets).
- `409` idempotency conflict, stale revision, or edit of a deleted exercise.
- `413` the request body exceeds its bound, or the generated response exceeds its 256 KiB safety bound.
- `429` request rate exceeded.
- `500` internal/database failure with no sensitive detail.
- `503` `UPSTREAM_UNAVAILABLE` with `Retry-After`: Supabase Auth could not
  check the token (unreachable, timeout, `408`/`429` or `5xx` from `getUser` or
  the grants endpoint). Only a `4xx` rejection from Auth is a `401`.

`./boga test agent-api` runs the real OAuth/RLS contract and
`./boga test mcp-smoke` the real MCP-to-API path.
