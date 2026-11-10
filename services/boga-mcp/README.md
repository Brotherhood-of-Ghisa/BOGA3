# BoGa MCP Virtual Coach

`services/boga-mcp` is the public, authenticated MCP resource server for the
BoGa Virtual Coach. It exposes twenty-two tools over stateless Streamable HTTP
(ten read-only tools and twelve mutations) and delegates every data read or write to the dedicated BoGa agent API. It has no database client,
Supabase data credentials, SQL, or service-role key.

## Public endpoints

- `POST /mcp` — authenticated MCP Streamable HTTP endpoint. A missing,
  rejected (revoked, expired, non-agent) or past-expiry token gets `401` with a
  `WWW-Authenticate` challenge carrying `scope` and `resource_metadata`, so
  clients refresh or re-authorize. An unreachable agent API, or one answering
  `429`/`5xx`, gets `503` with `Retry-After` instead of a token challenge.
- `GET /.well-known/oauth-protected-resource/mcp` — OAuth protected-resource
  metadata for the MCP endpoint. It advertises the resource's required
  `openid` and `profile` scopes plus `offline_access` when the issuer supports
  it; the 401 challenge carries the same set, so Claude, ChatGPT and Gemini all
  request one scope set and receive a refresh token. The scopes are advertised,
  not enforced on the token. Supabase authorization-server discovery also
  advertises the standard `email` and `phone` identity scopes, which the BoGa
  consent surface accepts and discloses.
- `GET /.well-known/oauth-authorization-server` — authorization-server
  metadata proxied from the configured Supabase Auth issuer.
- `GET /health` — unauthenticated process health only; returns no user data.

`GET` and `DELETE` on `/mcp` return `405`: this MVP is deliberately stateless
and does not offer server-sent event sessions.

## Tool surface

Ten read-only tools:
- `get_training_status` — one bounded check-in: per tracked muscle, sets on the
  three recovery days, today, this week and the four weeks before, with its
  weekly target and last trained date (Today's Plan's counting and order, under
  the coaching working-set rule, completed workouts only); the
  top ten exercises of the last 28 days with best 1RM in that window and the 28
  days before and the last record date; the target mode, default and
  `revision`. Days are the profile `time_zone`'s.
- `get_training_profile` — training preferences, equipment, gyms.
- `list_muscles` — the muscle ids exercise mappings name, each with the
  person's `report_group` and `tracked` setup.
- `search_exercises` — database-side filter by name, muscle, equipment; each
  exercise carries `split_by_gym`, `rest_timer_sec`, `deleted` and its
  `revision`.
- `get_exercise_context` — compact recent preview, lifetime PRs and totals.
- `get_recent_workouts` — completed workout list with working-set volume.
- `get_exercise_history` — keyset-paginated performed set history.
- `get_workout_detail` — exact session header, volume, and paginated sets.
- `get_upcoming_session_plans` — upcoming and unscheduled authored plans.
- `get_active_workout` — active headers or one selected workout's persisted
  lifecycle, raw exercise/set rows, stable IDs and graph revision. Requires
  workout permission even though read-only. A selected ID also reports
  finished/deleted state; `requires_app` directs plan-backed work to BoGa.
  Pages use the same `session_id` and `revision` with `next_cursor`.

Two create-only planning tools (require write access, idempotent):
- `create_session_plan` — create one authored session plan with pending blocks.
- `create_training_programme` — create a multi-session programme with pending blocks.

Four exercise tools (require the same write access, idempotent; edits quote the
`revision` they read and fail `REVISION_CONFLICT` when it moved):
- `create_exercise` — name, muscles (one or more primaries, distinct secondaries), load
  mode, bodyweight contribution, `split_by_gym`, `rest_timer_sec`
  ([[timer.rest-default]]).
- `update_exercise` — change any of those; `muscles` replaces the mapping and
  `rest_timer_sec: null` clears the exercise's own timer.
  Marked destructive.
- `delete_exercise` — soft delete; history stays. Marked destructive.
- `restore_exercise` — undo a soft delete.
Rules and errors: the
[agent API contract](../../supabase/functions/agent-api/README.md#exercise-editing).

One targets tool (same write access, idempotent, marked destructive):
`set_muscle_targets` sets the default weekly target, the mode and per-muscle
overrides (`null` clears one) on the person's setup; devices show them after
their next sync. `expected_revision` is `targets.revision` from
`get_training_status`; before any device has uploaded targets it builds on the
app's defaults. Rules and errors: the
[agent API contract](../../supabase/functions/agent-api/README.md#muscle-targets).

Five workout mutations, under the independent logging grant of
[[agents.write-access]] (neither plan switch grants it):

| Tool | Input beyond `idempotency_key` |
| --- | --- |
| `start_workout` | optional `gym_id`; server-time start, refuses an existing active workout |
| `log_sets` | `session_id`, `expected_revision`, exactly one `exercise_id`/`session_exercise_id`, 1–30 performed `sets` |
| `update_set` | `session_id`, `expected_revision`, `set_id`, replacement performed `set` |
| `delete_set` | `session_id`, `expected_revision`, `set_id`; soft deletion |
| `finish_workout` | `session_id`, `expected_revision`; one server completion instant/duration |

Corrections, removal and finish carry destructive hints; start/log are additive.
All writes are idempotent by their required printable ASCII operation key
(1–128 characters, no whitespace). Strict nested schemas reject identity,
plan targets and unsupported fields. The adapter forwards raw structured
results and API errors, including stable IDs and current lifecycle, without
recomputing metrics. For permission, bounds, concurrency and error recovery,
load the [workout contract](../../docs/specs/tech/agent-workout-contract.md).

### Conversational logging

Workouts have one controller ([[agents.write-access]]). Start assigns this
client immediately. Existing workouts require `control.can_edit: true`; the
person gives this client control through the app's Session menu. Never
self-claim a human-owned workout. Reads report the current controller and
`WORKOUT_CONTROL_REQUIRED` stops writes/replays after takeover. This informs
the client on its next workout call, without an unsolicited push channel.

1. Read profile/exercise context to resolve gym/exercise IDs, explicit units and
   total/per-side input meaning. Convert an explicitly different unit to kg
   before calling; ask when identity or load meaning is ambiguous. Do not
   create an exercise just because a name did not match.
2. Discover active headers and explicitly choose a workout when several exist.
   Server state excludes unsynced phone work. `ACTIVE_WORKOUT_CONFLICT` never
   means automatically finish, merge or replace another workout.
3. Record actual performance: `{weight_kg: "80", reps: 8, set_type: "rir_2"}`.
   Use `"0"` for no external load and `null` for unspecified effort. Warm-up,
   technique, cooldown and RIR are explicit; never invent them or convert plan
   targets to performed sets ([[set.performed]], [[set.eligibility]]).
4. “Same again, seven reps” resolves the previous persisted set, keeps only the
   intended values, changes reps to seven, and uses a fresh operation key.
   Preserve `session_exercise_id` to avoid an ambiguous repeated exercise.
5. For “that was 75”, read the row, identify its `set_id`, retain its reps/effort
   and replace only the intended performance. `update_set` requires a complete
   performed input; omitting `set_type` would clear effort to unspecified.
6. A lost response repeats the exact payload and key. A revision conflict
   requires a fresh read and confirmed intent, then a fresh key; never silently
   replace the revision. A fresh conversation drains persisted pages rather
   than relying on earlier assistant messages. Finish only the selected
   workout when the person asks; subsequent edits require the app.

`get_exercise_context` reports `gym_usage` for every exercise: sessions with a
working set per gym and with no gym, so a coach can judge `split_by_gym`.
`get_exercise_context` and `get_exercise_history` take an optional `gym_bucket`
(a gym id) for an exercise the user tracks separately per gym ([[gym.split]]).
Unset, context reports the whole exercise, sessions with no gym included, and
each gym's own records in `gym_buckets`; history pages across every gym with
each set carrying its own. A named gym narrows either to that gym. The API
rejects `none`: sessions with no gym are never a bucket of their own.

Tool schemas reject unknown fields and never accept a user identifier. Tool
definitions and server instructions are static; names and other user-controlled
values remain untrusted JSON output.

Training projections with `metric_revision: "working_sets_v10"` pass through
unchanged in structured and text JSON output. Tool names and strict input
schemas remain compatible. Every derived figure and count reads working sets
only: a set that is not a working set ([[set.eligibility]]) is listed with its own per-set figures but feeds no record,
volume, 1RM or count (see the
[working-set rule](../../docs/specs/tech/training-metrics-contract.md#1-counted-set)).
All Weight is kg: `load`/`top_weight` are raw,
while 1RM/Volume are derived under the owner's private preference. Preference
off returns ordinary metrics and no reading context; preference on returns an
applicable reading only when a positive contribution makes the result
bodyweight-aware, with missing reading following the personal zero fallback.
The adapter adds no bodyweight write tools,
measurement-timeline reads, group access or database credentials. See the
[agent API contract](../../supabase/functions/agent-api/README.md#optional-bodyweight-calculation-response).

## Tool catalogue changes and client refresh

The catalogue is currently **static**. The HTTP handler creates an MCP server
and stateless transport for each `POST /mcp` request, then closes both on
response completion. `GET /mcp` returns 405, so no persistent GET/SSE stream
exists for out-of-band `notifications/tools/list_changed` delivery.

The v1 MCP SDK automatically advertises `tools.listChanged: true` when tools
are registered, even in this stateless configuration. **That capability flag
does not demonstrate working cross-request notifications.** Do not add a
`refresh_connector` tool or assume that `sendToolListChanged()` will refresh
ChatGPT's cached/approved actions.

`test/tool-list-changed.test.ts` uses the actual BoGa tool registry, a
persistent in-memory MCP transport and a standard SDK client. It registers a
test-only tool after initialization, checks that the client receives a change
notification, and verifies its automatically refreshed `tools/list`. This
proves the protocol path **only for a persistent connection**, not the deployed
HTTP path or ChatGPT approval/refresh behaviour.

Supporting *live* tool changes in production would require designing a
long-lived notification channel (including authentication, lifecycle and
multi-instance delivery), then an authenticated HTTP end-to-end test that
changes the shared catalogue and verifies notification receipt and re-listing.
Any client-specific approval of new actions remains separate. Until that work
is complete, use the ChatGPT connector refresh/approval flow after MCP tool
deployments.

## Configuration

Copy `.env.example` into the secret/config mechanism owned by the Node hosting
platform. Required values:

| Variable | Meaning |
| --- | --- |
| `BOGA_MCP_PUBLIC_URL` | Public HTTPS origin where clients reach this service. The MCP resource is this value plus `/mcp`. |
| `BOGA_AGENT_API_BASE_URL` | Dedicated BoGa agent API, normally `https://<project>.supabase.co/functions/v1/agent-api`. It must not be a PostgREST or database URL. |
| `BOGA_OAUTH_ISSUER` | Supabase OAuth authorization-server issuer, normally `https://<project>.supabase.co/auth/v1`. |

Optional values are `PORT` (default `8787`), `HOST` (default `0.0.0.0`),
`BOGA_AGENT_API_TIMEOUT_MS` (`500..30000`, default `10000`), and
`BOGA_MCP_ALLOWED_HOSTS` (additional comma-separated proxy hostnames).
All configured public service URLs must use HTTPS except for `localhost` or
`127.0.0.1`.

Do not inject `SUPABASE_SERVICE_ROLE_KEY`, a database URL/password, or a
Supabase data client into this service. A deployment containing one has violated
the architecture even if the code does not read it.

## Local development

From the repository root:

```bash
npm --prefix services/boga-mcp install
npm --prefix services/boga-mcp run lint
npm --prefix services/boga-mcp test
npm --prefix services/boga-mcp run build
```

The complete real-token cross-stack proof is:

```bash
./boga test mcp-smoke
```

It boots/reuses this worktree's local Supabase, seeds a unique training fixture,
starts this service, then connects the way a remote client does: 401 challenge,
protected-resource and authorization-server discovery, dynamic registration,
authorization code + PKCE with the challenged scopes and `resource`, the
consent page's scope gate, token exchange and a refresh. It checks that a
rejected token is challenged, discovers and invokes every tool with the
refreshed token, verifies fixture IDs, and cleans up. See
`RUNBOOK.md` for the supplied-token form.

### Reproducible walkthrough and evidence

After an authorized deployment and the client's catalogue refresh/new-action
approval, use a disposable test account with logging enabled and plan switches
off. Ask: “Start a workout at my gym” → “Bench, 80 kg for eight, RIR two” →
“Same again, seven reps” → “Actually the first set was 75 kg” → “Remove the
second set”. Start a fresh chat, recover that workout and verify one 75×8 RIR2
set; then ask “Finish”. Open BoGa, sync and inspect the same completed workout.

`./boga test mcp-smoke` proves this protocol path with real local OAuth,
including exact retry replay, intentional repetition, fresh-client paging,
permission disable, actual OAuth-grant revocation and rejection after finish.
It runs the read projections once across permission phases to stay under the
unchanged request limits. New workout writes/revocation are confined to the
seeded local fixture; supplied-token mode never runs them.

**Supported chat-client UX: not verified by the local SDK test.** Record the
actual client/version/date, refreshed 22-tool catalogue, new-action approval,
per-call prompts, fresh-chat recovery and app convergence when doing the
walkthrough. Annotations cannot guarantee prompt-free repeated logging.
Code integration performs no hosted deployment or connector activation.

## Production deployment

For a workout rollout, enforce the server's protocol-7 compatibility contract
and ship the protected mobile handoff before exposing the new MCP catalogue;
load [workout rollout](../../docs/specs/tech/agent-workout-contract.md) when
performing those steps. Existing grants stay default-off under
[[agents.write-access]]. Then deploy the MCP build and use the client's
catalogue refresh/approval flow; the stateless HTTP service cannot push that
refresh. Complete the supported-client walkthrough separately from local proof.


1. Complete the hosted Supabase and consent-site steps in
   `apps/agent-auth-web/README.md` and `supabase/README.md`.
2. Build with Node 24 or newer: `npm ci && npm run build`.
3. Run `npm start` behind an HTTPS ingress that preserves `Authorization`,
   `Host`, and `x-request-id`.
4. Set the three required URLs above. Configure only the expected public proxy
   hostname in `BOGA_MCP_ALLOWED_HOSTS` when the external host differs from
   `BOGA_MCP_PUBLIC_URL`.
5. Keep the platform request-body ceiling at or below 100 KiB and add
   infrastructure rate limiting in front of the service. The process also
   limits validated OAuth clients to 120 requests per minute.
6. Configure logs so request bodies and `Authorization` headers are neither
   captured nor retained.
7. Verify discovery, consent, every tool, grant revocation, and the audit
   trail against the hosted environment. Local green results are not hosted
   deployment evidence.

Dynamic client registration is controlled by Supabase Auth. If it is disabled,
pre-register each supported client and its exact callback URLs in Supabase
before connecting it.
