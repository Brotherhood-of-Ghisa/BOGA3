# BoGa MCP Virtual Coach

`services/boga-mcp` is the public, authenticated MCP resource server for the
BoGa Virtual Coach. It exposes fourteen tools over stateless Streamable HTTP
(eight read-only tools, two create-only planning tools and four exercise editing
tools) and delegates every data read or write to the dedicated BoGa agent API. It has no database client,
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

Nine read-only tools:
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

Training projections with `metric_revision: "working_sets_v8"` pass through
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

## Production deployment

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
