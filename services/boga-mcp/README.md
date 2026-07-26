# BoGa MCP Virtual Coach

`services/boga-mcp` is the public, authenticated MCP resource server for the
BoGa Virtual Coach. It exposes exactly four read-only tools over stateless
Streamable HTTP and delegates every data read to the dedicated BoGa agent API.
It has no database client, Supabase data credentials, SQL, or service-role key.

## Public endpoints

- `POST /mcp` — authenticated MCP Streamable HTTP endpoint.
- `GET /.well-known/oauth-protected-resource/mcp` — OAuth protected-resource
  metadata for the MCP endpoint. It advertises exactly the `openid` and
  `profile` scopes accepted and disclosed by the BoGa consent surface.
- `GET /.well-known/oauth-authorization-server` — authorization-server
  metadata proxied from the configured Supabase Auth issuer.
- `GET /health` — unauthenticated process health only; returns no user data.

`GET` and `DELETE` on `/mcp` return `405`: this MVP is deliberately stateless
and does not offer server-sent event sessions.

## Tool surface

- `get_training_profile`
- `search_exercises`
- `get_exercise_context`
- `get_recent_workouts`

Tool schemas reject unknown fields and never accept a user identifier. Tool
definitions and server instructions are static; names and other user-controlled
values remain untrusted JSON output.

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
completes an OAuth authorization-code + PKCE consent flow, starts this service,
discovers and invokes all four tools, verifies fixture IDs, and cleans up. See
`RUNBOOK.md` for the supplied-token form.

## Production deployment

1. Complete the hosted Supabase and consent-site steps in
   `apps/agent-auth-web/README.md` and `supabase/README.md`.
2. Build with Node 20 or newer: `npm ci && npm run build`.
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
7. Verify discovery, consent, all four tools, grant revocation, and the audit
   trail against the hosted environment. Local green results are not hosted
   deployment evidence.

Dynamic client registration is controlled by Supabase Auth. If it is disabled,
pre-register each supported client and its exact callback URLs in Supabase
before connecting it.
