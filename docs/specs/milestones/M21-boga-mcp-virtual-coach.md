# M21 - BoGa MCP Virtual Coach

## Milestone metadata

- Milestone ID: `M21`
- Title: Milestone: BoGa MCP Virtual Coach
- Status: `complete`

## Parent references

- Project directives: `AGENTS.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing and gates: `docs/specs/02-quality-and-test-gates.md`,
  `docs/specs/06-testing-strategy.md`
- UX standard and current UI: `docs/specs/08-ux-delivery-standard.md`,
  `docs/specs/ui/README.md`
- API authorization: `docs/specs/10-api-authn-authz-guidelines.md`
- Backend operations: `supabase/README.md`
- Project structure: `docs/specs/09-project-structure.md`

## Milestone objective

Allow an MCP-compatible agent to obtain explicit, revocable, read-only access
to one authorizing BoGa user's training data. The remote MCP service exposes
four bounded coaching tools and obtains every result through dedicated BoGa3
API routes; it never accesses Supabase data directly.

## Current architecture findings

1. The product runtime is an Expo Router React Native app under
   `apps/mobile/**`. It is offline-first: user data lives in local SQLite and
   syncs through the `app_public.sync_push` / `sync_pull` RPC pair.
2. Supabase provides Postgres, Auth, RLS, PostgREST/RPC, and Edge Functions.
   Before this milestone there was no BoGa3 HTTP service;
   `supabase/functions/health` was the only Edge Function.
3. All nine synced domain tables use `(owner_user_id, id)` identity and RLS
   policies based on `auth.uid()`. Current policies do not distinguish a normal
   app token from a Supabase OAuth token, so OAuth tokens would otherwise
   inherit the app's write access.
4. Current mobile authentication is provisioned email/password through
   `@supabase/supabase-js`. Supabase OAuth 2.1 server configuration is present
   in `supabase/config.toml.template` but disabled.
5. Supabase's supported OAuth server provides authorization-code + PKCE,
   discovery, dynamic client registration, user consent, token expiry/refresh,
   `client_id` JWT claims, grant listing, and grant revocation. Custom OAuth
   scopes are not currently supported; standard scopes affect identity claims,
   not database permissions.
6. The app's Settings route is the narrowest entry point for Connected agents.
   A signed-in-only destination row and a focused stack screen use existing
   `UiSurface`, `UiButton`, inline feedback, and destructive-action conventions
   without turning Settings into a permission-management application.
7. Existing exercise strength definitions live in the pure
   `apps/mobile/src/exercise-calculations/index.ts` module. The agent API can
   import this module so estimated 1RM, volume, parsing, and max-reps semantics
   remain canonical rather than being redefined in the MCP service.
8. There is no persisted exercise-equipment field or user-authored training
   note field. The MVP will derive available equipment from non-empty historical
   `session_exercises.machine_name` values and will not invent or expose notes.
9. Hosted backend migrations and mobile EAS builds have documented operator
   paths. No repository-owned web host, MCP host, DNS, hosted OAuth client
   registration, or production callback URL currently exists.

## Proposed architecture

```text
MCP client
  -> services/boga-mcp (Streamable HTTP, Supabase OAuth bearer token)
  -> supabase/functions/agent-api (BoGa3 API)
  -> Supabase Auth live-session/grant validation
  -> service-only owner-filtered reads of app_public training tables
```

Supporting surfaces:

```text
OAuth client -> Supabase OAuth 2.1 authorize/token endpoints
             -> apps/agent-auth-web consent UI

BoGa mobile Settings -> Supabase Auth listGrants/revokeGrant
                     -> public.agent_access_audit (owner-only last access)
```

- `services/boga-mcp` uses the maintained MCP TypeScript SDK v1 and stateless
  Streamable HTTP. It has only the BoGa3 API URL, Supabase authorization-server
  URL, and its own public URL. Its dependency and environment contracts exclude
  database clients, database URLs, SQL, and Supabase service-role credentials.
- `supabase/functions/agent-api` is the BoGa3 API surface for the MVP. It
  validates the supplied token with Supabase Auth on every request, requires an
  OAuth `client_id`, confirms the user grant is still active, derives
  `owner_user_id` only from the validated token, then runs explicit,
  owner-filtered service-role reads. The service role exists only at this API
  boundary and is never forwarded.
- `apps/agent-auth-web` is a small static authorization UI using
  `@supabase/supabase-js` OAuth consent methods. Supabase Auth owns protocol
  validation, PKCE, codes, token issuance, expiry, refresh rotation, consent,
  and revocation.
- Normal app tokens have no `client_id`. Agent tokens always have one. A
  migration updates domain-table RLS so direct data access and every write path
  require `client_id IS NULL`; OAuth tokens can therefore use neither direct
  PostgREST reads nor app writes/RPCs. Only the dedicated agent API performs
  agent reads.

## Security boundary

1. The access token is the only source of user identity. `user_id`, `userId`,
   `owner_user_id`, and equivalents are rejected in MCP arguments, API query
   parameters, and request bodies.
2. The agent API performs live Supabase Auth validation on every request, then
   requires a non-empty OAuth `client_id` and an active grant for that client.
   Expired, invalid, normal-app, and revoked credentials return `401`.
3. Every database query is an explicit allowlisted read with
   `owner_user_id = validated user.id`. Object lookup failure returns `404`
   regardless of whether the ID belongs to another user.
4. OAuth tokens are denied direct select/insert/update/delete access by RLS.
   Sync push, profile mutation, and diagnostic insertion remain unavailable to
   agent credentials through that boundary; the `SECURITY DEFINER` developer
   wipe RPC independently rejects non-null OAuth `client_id` claims because it
   bypasses RLS.
5. The MCP service never receives or exposes a service-role key and never has a
   Supabase database client. It forwards the bearer token only to the BoGa3
   agent API and never logs it.
6. Tool definitions and system behavior are static. User-controlled exercise
   names, gym/machine names, and future note text are returned only as untrusted
   JSON data and never interpolated into instructions or tool descriptions.
7. Requests and responses are bounded. API limits are clamped; cursors are
   opaque; request bodies are rejected on GET routes; oversized responses fail
   closed; both services apply per-principal request limits.
8. Audit records contain only owner ID, OAuth client ID, route/tool name,
   timestamp, status, request ID, and duration. Tokens and training payloads
   are never recorded.

## MCP tool contracts

All tools reject unknown fields. None includes `user_id`.

### `get_training_profile`

- Input: empty object.
- Output:
  - `units`: explicit load (`kg`) and volume (`kg_reps`) units;
  - `timezone`: IANA timezone from the training profile, defaulting to `UTC`;
  - `active_gyms`: bounded `{id, name}` rows without coordinates;
  - `available_equipment`: bounded distinct historical machine/equipment names;
  - `training_preferences`: currently stored training-relevant preferences only.
- Explicit exclusions: email, username, billing, auth/session, and account
  administration data.

### `search_exercises`

- Input:
  - `query?: string` (trimmed, maximum 120 characters);
  - `muscle?: string` (trimmed, maximum 80 characters);
  - `equipment?: string` (trimmed, maximum 80 characters);
  - `limit?: number` (`1..50`, default `20`);
  - `cursor?: string` (opaque).
- Output: stable exercise IDs, name, load-input mode, current muscle mappings,
  known historical equipment names, and `next_cursor`.
- Deleted exercises/mappings/taxonomy rows are excluded.

### `get_exercise_context`

- Input:
  - `exercise_id: string`;
  - `recent_sessions?: number` (`1..20`, default `5`).
- Output: exercise definition, current muscle mappings, bounded recent
  performances and sets, canonical personal records (estimated 1RM, top
  weight/reps, max session volume), raw session-volume series, and last
  performed ISO timestamp.
- Failure-set and user-note fields are omitted until BoGa has canonical stored
  semantics for them.

### `get_recent_workouts`

- Input:
  - `limit?: number` (`1..25`, default `10`);
  - `cursor?: string` (opaque).
- Output: compact completed-workout summaries with stable IDs, ISO start/end
  timestamps, duration, gym name, exercise/set counts, total entered-load
  volume with explicit unit, truncation flags, and `next_cursor`.

## BoGa3 API contracts

The public Edge Function prefix is deployment-specific. The function routes
below are canonical within `agent-api`:

1. `GET /v1/agent/session`
   - validates live OAuth access and active grant;
   - returns capability metadata without account/profile data.
2. `GET /v1/agent/profile`
   - implements `get_training_profile`.
3. `GET /v1/agent/exercises`
   - query: `query`, `muscle`, `equipment`, `limit`, `cursor`;
   - implements `search_exercises`.
4. `GET /v1/agent/exercises/:exerciseId/context`
   - query: `recent_sessions`;
   - implements `get_exercise_context`.
5. `GET /v1/agent/workouts/recent`
   - query: `limit`, `cursor`;
   - implements `get_recent_workouts`.

Every response uses `application/json`, `cache-control: no-store`, an
`x-request-id`, and a stable envelope:

```json
{ "data": {}, "meta": { "request_id": "...", "api_version": "v1" } }
```

Errors use:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required.",
    "request_id": "..."
  }
}
```

The API never returns `owner_user_id`. Timestamps are ISO 8601 strings. Load
and volume fields carry explicit units. `400`, `401`, `404`, `405`, `413`,
`429`, and `500` meanings are stable and documented with the implementation.

## UX contract

### Flow: review connected agents

- Trigger: signed-in user opens Settings and selects Connected agents.
- Steps: the Connected agents screen loads Supabase OAuth grants, joins
  owner-visible last-access audit timestamps where available, and renders
  client name, granted date, last access, and read-only access copy.
- Success outcome: each current grant is visible; no grants shows a concise
  empty state.
- Failure/edge outcome: an inline error and Retry action remain on the focused
  screen; back navigation leaves the rest of Settings usable.

### Flow: revoke an agent

- Trigger: user taps Revoke on a connected agent.
- Steps: a destructive confirmation names the client; approval calls the
  Supabase SDK grant-revocation method and reloads the list.
- Success outcome: the grant disappears and existing OAuth sessions/refresh
  tokens are invalidated by Supabase.
- Failure/edge outcome: the agent card stays visible with inline failure feedback and
  no false success.

Interaction and appearance:

- Reuse `UiSurface`, `UiText`, `UiButton`, inline status feedback, and the
  existing destructive confirmation pattern.
- Keep one destination row within Settings and one focused stack screen; add no
  permission-management hierarchy.
- Hide the Settings row when signed out.
- Provide stable accessibility labels and test IDs for load, empty, error,
  grant row, and revoke states.

## Implementation task checklist

- [x] 1. Repository discovery and architecture.
- [x] 2. MCP and API contract definitions.
- [x] 3. BoGa3 authentication and read-only agent authorization.
- [x] 4. Dedicated BoGa3 agent API routes.
- [x] 5. MCP server and four tool handlers.
- [x] 6. Connected-agents and revocation UI.
- [x] 7. Audit logging and request limits.
- [x] 8. Unit, integration, and security tests.
- [x] 9. Local smoke-test tooling.
- [x] 10. Deployment and operator documentation.

## Test plan

### Infra-free

- MCP server tests with a fake BoGa3 API:
  - tool discovery and all four translations;
  - no user ID schemas/forwarding;
  - API error translation and token redaction;
  - no database/service-role dependency contract.
- Consent UI typecheck/build and authorization-state tests.
- Mobile Connected agents service and screen tests, including grant/audit
  joining, audit-unavailable fallback, visible read-only metadata, confirmed
  revoke success, and retryable load failure.

### Local Supabase integration

- Provision deterministic user A and user B.
- Complete a real local Supabase OAuth authorization-code + PKCE flow for a
  dynamically registered test MCP client.
- Prove:
  1. user A can retrieve user A exercises;
  2. user A gets `404` for user B exercise ID;
  3. user-ID inputs are rejected;
  4. invalid/expired tokens return `401`;
  5. revoked grants immediately fail live validation;
  6. agent tokens cannot call direct table writes, `sync_push`, or
     `dev_wipe_my_data`; restrictive `client_id IS NULL` RLS covers synced
     tables, profile, and logs, while the privileged wipe RPC enforces the same
     client boundary inside its `SECURITY DEFINER` body;
  7. inaccessible and nonexistent IDs are indistinguishable;
  8. pagination and maximum limits are enforced;
  9. profile output excludes email/account data;
  10. audit rows contain metadata only.

### Cross-stack MCP smoke

- One repeatable command starts/targets local Supabase, provisions fixtures,
  obtains a real OAuth token (or accepts a supplied test token), starts the
  BoGa3 API and MCP service, lists tools, calls all four, verifies returned IDs
  against the authorizing fixture, tests cross-user denial, and prints a single
  pass/fail result.

### Repository gates

- Run targeted checks after each checkpoint.
- Before closeout run `./boga test for`, then every required gate to green.
  Because this milestone changes mobile UI/auth and backend schema/functions,
  the expected minimum is `./boga test fast`, `./boga test backend`,
  `./boga test frontend`, and `./boga test ios-sync-e2e`; the trigger output is
  authoritative.
- Run `./boga timings` for measured evidence; never estimate durations.

## Required external configuration

Repository implementation can prepare but cannot truthfully complete these
hosted steps without operator access and final production domains:

1. Deploy migrations and `agent-api` to the hosted Supabase project.
2. Enable Supabase OAuth 2.1 server, set authorization path
   `/oauth/consent`, and decide whether dynamic client registration is allowed.
3. Use asymmetric JWT signing keys for hosted OAuth/OIDC.
4. Deploy `apps/agent-auth-web` to an HTTPS origin with SPA fallback and set
   Supabase Auth Site URL/authorization URL to that origin.
5. Deploy `services/boga-mcp` to an HTTPS Node host and set:
   - `BOGA_AGENT_API_BASE_URL`;
   - `BOGA_OAUTH_ISSUER`;
   - `BOGA_MCP_PUBLIC_URL`;
   - no Supabase service-role or database secret.
6. Register exact ChatGPT/Claude callback URLs when pre-registration is used,
   or review the risk posture before enabling dynamic registration.
7. Configure DNS/TLS, platform request limits, and log retention. The hosted
   Supabase runtime supplies the API function's service role; never copy it to
   the MCP or consent hosts.
8. Run hosted OAuth discovery, consent, MCP discovery/tool, revocation, and
   audit smoke checks. Do not treat local proof as hosted proof.

## Decisions and deviations

1. Decision: use Supabase's OAuth 2.1 server rather than implementing OAuth.
   Reason: it is the stack-native maintained PKCE, discovery, grant, expiry,
   refresh, and revocation path and explicitly supports MCP clients.
2. Decision: use an Edge Function as the BoGa3 agent API because the repository
   has no separate API runtime and already owns backend functions under
   `supabase/functions/**`.
3. Decision: deploy MCP separately from Supabase Edge Functions. Reason:
   Supabase functions in the project receive the service-role environment by
   default; a separate runtime makes the “MCP has no service-role key” boundary
   enforceable by deployment configuration.
4. Decision: the API, not the MCP service, owns database queries, ownership
   filtering, record calculations, audit insertion, and response limits.
5. Decision: OAuth tokens receive no direct domain-table access. This is
   stricter than only denying writes and guarantees the required MCP -> API ->
   data path even if a caller knows the PostgREST URL.
6. Decision: the agent flow accepts only the standard OAuth `openid` and
   `profile` scopes, discloses each requested identity permission before
   approval, and rejects `email`, `phone`, or unknown/additional scopes. The
   MCP protected-resource metadata advertises the same bounded pair. Supabase
   does not yet support a custom `training:read` scope, so the consent UI also
   states the actual read-only training-data capability clearly.
7. Decision: `session_exercises.machine_name` is the only current equipment
   signal. No new equipment taxonomy or note model is introduced in this
   milestone.
8. Deviation: exact public `/v1/agent/**` URLs require the deployment gateway to
   map the Supabase function prefix. Without that rewrite, the hosted URLs are
   `/functions/v1/agent-api/v1/agent/**`; route semantics remain identical.
9. Deviation: the product stores neither a canonical equipment taxonomy on the
   exercise definition nor user-authored exercise notes. Equipment is derived
   from bounded historical `machine_name` values; notes are explicitly reported
   as unavailable rather than invented or exposing unrelated text.
10. Decision: Supabase accepts the OAuth `resource` authorization parameter,
    while its access token retains the project Auth audience. The MCP protected
    resource therefore authenticates by asking the dedicated API to validate
    the live session and active client grant; it does not make local trust
    decisions from an unverified token audience.

## Risks and dependencies

- Supabase OAuth 2.1 server is currently documented as beta.
- OAuth scopes do not authorize database access; the API/RLS `client_id`
  boundary is load-bearing.
- A valid stateless JWT may outlive a revoked database session unless the API
  performs live Auth/grant validation on every request.
- Service-role reads bypass RLS, so every query must include the validated
  owner and be covered by cross-owner tests.
- Static consent hosting, MCP hosting, production callback URLs, and hosted
  OAuth registration are operator-owned external state.

## Completion note

- What changed: delivered the separate authenticated MCP runtime, four strict
  read-only tools, dedicated owner-filtered BoGa3 agent API, Supabase OAuth
  consent/grant/revocation flow, restrictive agent-token RLS boundary,
  metadata-only access audit, Connected agents mobile screen, local OAuth/MCP
  smoke tooling, CI/lane triggers, and operator documentation.
- Verification summary: `./boga doctor`, `./boga test for`,
  `./boga test fast`, `./boga test backend`, and `./boga test frontend` all
  passed locally. Those aggregates include the real OAuth authorization-code +
  PKCE agent API contract, all ten Sync v2 integration tests, MCP four-tool
  smoke, iOS Connected agents/auth-profile flow, iOS UI-to-server sync round
  trip, 109 mobile suites / 958 tests, consent-web and MCP dependency audits,
  docs generation/checks, and meta-tests. `./boga timings` reports only the
  measured green run records.
- What remains: the operator-owned hosted rollout and hosted smoke checks in
  Required external configuration. No production URL, deployment, callback
  registration, or hosted verification is claimed by this local milestone.
