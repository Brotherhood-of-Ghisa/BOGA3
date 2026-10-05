# Cross-client MCP integration (Claude · ChatGPT · Gemini, desktop + mobile)

Status: Phase 1 in review (2026-10-05); Phases 2–4 not started. Working notes; durable decisions move to
`docs/specs/**` when they ship.

## 1. Goal

Use the BoGa Virtual Coach MCP server from Claude, ChatGPT and, where possible,
Gemini, on both desktop and mobile. One server, one sign-in flow, no
per-client code paths. Developer or beta modes are acceptable.

## 2. Current implementation

| Piece | What it is | Where |
| --- | --- | --- |
| MCP server | Node 24 + Express, `@modelcontextprotocol/sdk` 1.29.0, stateless Streamable HTTP at `POST /mcp`; GET/DELETE return 405. Hosted on Render at `https://boga3.onrender.com/mcp`; the service config is not in the repo. | `services/boga-mcp/src/server.ts:71-144` |
| Tools | 4 read-only tools with `readOnlyHint` annotations; results are `structuredContent` plus text JSON | `services/boga-mcp/src/tools.ts` |
| Resource metadata | `/.well-known/oauth-protected-resource/mcp` → `resource=…/mcp`, `authorization_servers=[<supabase>/auth/v1]`, `scopes_supported=[openid, profile]` | `server.ts:77-82` |
| Authorization server | Supabase Auth OAuth 2.1 server (beta): DCR, PKCE, refresh rotation | hosted project `onluhhnvvmknqzdxgntl` |
| Consent page | Vite single-page app on a Cloudflare Worker; email/password sign-in, then approve or deny. It accepts only the scopes `openid profile email phone`. | `apps/agent-auth-web/src/authorization.ts:3,34-43` |
| Token check | MCP calls agent-api `/v1/agent/session` on every request. That call runs `getUser`, checks the `client_id` claim and checks an active grant. | `supabase/functions/agent-api/index.ts:176-227` |
| Tests | `mcp-unit` uses a fake token and a fake AS. `mcp-smoke` mints a token directly with no `resource`, no `offline_access` and no 401-driven discovery. Neither covers an invalid or expired token through `/mcp`. | `services/boga-mcp/test/`, `scripts/smoke-boga-mcp.sh` |

### Live probe of the hosted stack (2026-10-05)

| Check | Result |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` | 200, body as above |
| Unauthenticated `POST /mcp` | 401 with `WWW-Authenticate: Bearer … resource_metadata=…` ✅ |
| `POST /mcp` with an invalid bearer token | **500 `server_error`, no challenge** ❌ |
| Supabase RFC 8414 path-insertion discovery | 200 ✅ |
| Supabase `scopes_supported` | `openid profile email phone **offline_access**` |
| Supabase `token_endpoint_auth_methods_supported` | `client_secret_basic, client_secret_post, none` |
| Supabase CIMD / RFC 9207 `iss` / RFC 8707 audience | absent / absent / not bound (`aud` is always `authenticated`) |

### Why Claude fails

1. **The scope gate rejects `offline_access`. Confirmed in the hosted Auth
   logs.** On 2026-10-04 at 14:13Z, Claude registered through DCR and
   requested `scope=openid profile offline_access` with
   `resource=https://boga3.onrender.com/mcp` and redirect
   `https://claude.ai/api/mcp/auth_callback`. Supabase returned the consent
   details with 200, but no approval followed. The consent page threw
   "unsupported identity permissions" (`authorization.ts:34-43`). ChatGPT asks
   for the resource-metadata scopes (`openid profile`), so it gets through.
2. **Supabase consent-details 400 on `resource` or `offline_access`**
   (supabase/auth#2820) did **not** reproduce on hosted: that call returned
   200.
3. **Expired or invalid tokens get 500 instead of 401.** Clients never learn
   that they should refresh. Every client, ChatGPT included, breaks about an
   hour after connecting. Fix: `verifyAccessToken` must throw the SDK's
   `InvalidTokenError` on an upstream 401 or 403 (`server.ts:96-104`).
4. **Render cold start.** Claude allows 10 s for discovery and token calls. If
   the Render instance sleeps, the first connect times out. Not verified,
   because the Render plan is outside the repo.

## 3. What each client can do (researched 2026-10-05)

| Client | Add a custom server | Use it on desktop | Use it on mobile | Plan | Notes |
| --- | --- | --- | --- | --- | --- |
| **Claude** | claude.ai web or desktop app | ✅ | ✅ Connectors sync to iOS and Android. Mobile cannot *add* a connector. | Free (one connector), Pro, Max | OAuth via CIMD, then DCR, or a manually entered client ID. Callback `https://claude.ai/api/mcp/auth_callback`. Egress `160.79.104.0/21`. |
| **ChatGPT** | chatgpt.com, after enabling Developer mode | Web ✅; desktop app unverified | ❌ OpenAI help centre: MCP apps are "web only" | Plus and above. Write tools may need Business or above; the docs conflict. | OAuth via CIMD, DCR or static client. No custom API-key headers. Wants `offline_access`. |
| **Gemini** | gemini.google.com → Settings → Connected Apps → Custom apps | Web ✅ | ✅ once added on the web | **US only, 18+, English, personal Google account**; subscription unclear | OAuth via DCR through Google's redirect relay. OAuth reported flaky (2026-10-02 forum report). No MCP Apps UI. Gemini CLI works on desktop anywhere. |

So the realistic target is:

- **Claude**: desktop ✅ and mobile ✅ (iOS and Android). This is the strongest path.
- **ChatGPT**: desktop through the browser ✅; mobile ❌. No supported route
  exists today: developer-mode apps are web-only, and GPT Actions are in
  maintenance mode and reported broken on mobile. Revisit if OpenAI ships
  mobile support for developer-mode apps.
- **Gemini**: web and mobile ✅ only if you are eligible (US, personal
  account). Otherwise Gemini CLI on desktop only.

## 4. Proposed design

### Principle

Keep **one spec-compliant remote MCP endpoint plus OAuth 2.1**. Every target
client converges on that. API keys, GPT Actions, local stdio and `.mcpb`
bundles each reach a subset at best and duplicate the auth story, so they are
rejected.

### Phase 1: fix in place (one PR)

As built:

- Steps 1, 2, 3 and 5 shipped.
- Two parts were deliberately left out:
  - Treating an empty `scope` as `openid`. No client was seen sending an
    empty scope, so it still fails closed.
  - Retrying Supabase metadata at boot. Render already restarts a crashed
    process.
- Hosted Supabase advertises `offline_access`, but local Auth (v2.192.0) does
  not. The smoke therefore requests whatever the challenge advertises, which
  is `openid profile` locally. Unit tests cover the `offline_access` branch;
  the live checks in step 6 cover it on hosted.

Keep Supabase as the AS and remove our own defects. Every client can then
connect through DCR, with no CIMD needed.

1. **401, not 500.** In `verifyAccessToken`, map an upstream 401 or 403 to
   `InvalidTokenError`. Map an upstream timeout or 5xx to a 503 with
   `Retry-After`. Add Jest tests for invalid, expired and revoked tokens
   through `/mcp`.
2. **One canonical scope set for all clients.** Publish
   `openid profile offline_access` in both resource-metadata
   `scopes_supported` and the 401 challenge (`scope="…"`). Under the
   2025-11-25 scope-selection rule, Claude, ChatGPT and Gemini then all ask
   for the same thing.
3. **Consent page accepts `offline_access`** with the disclosure "Stay
   connected without approving again". Unknown scopes still fail closed. An
   empty scope string is treated as `openid`, not rejected. Add Jest tests.
4. **Hosting latency.** Run Render on an always-on instance, or move hosting
   (see Phase 2b). Don't crash at boot if Supabase metadata is briefly
   unreachable: retry, then serve 503.
5. **Smoke test the real client path.** Extend `mcp-smoke` to start from an
   unauthenticated 401 and use the SDK's client OAuth provider: discovery,
   then DCR, then authorize with `resource` and `offline_access`, then token
   exchange, then refresh. This catches #2820-class regressions locally.
6. **Live acceptance**, run by you since it needs your account:
   - Claude: add on the web, then use it in the desktop app and in the iOS app.
   - ChatGPT: web in developer mode, then try the macOS app.
   - Gemini: web, then mobile, if eligible.
   - Leave a session idle for more than an hour and confirm the token
     refreshes silently.

**Exit test:** if step 6 hits the supabase/auth#2820 400, Supabase's beta AS
is the blocker. Go to Phase 2.

### Phase 2 (conditional): own the AS façade, keep Supabase for identity

**Trigger:** Supabase OAuth bugs block a client, or you want CIMD, audience
binding or Claude Code loopback redirects (supabase/auth#2703).

Put `@cloudflare/workers-oauth-provider` on the Cloudflare Worker that already
hosts the consent page. It becomes the AS that Claude, ChatGPT and Gemini
see, and it supports the full set:

- CIMD and DCR
- PKCE S256 only
- RFC 8707 `resource` bound into `aud`
- RFC 9207 `iss`
- `offline_access` with refresh rotation
- loopback redirects

Behind it, the Worker is **one pre-registered confidential OAuth client of
Supabase** (chained OAuth):

1. The user signs in to Supabase on the existing consent page.
2. The Worker exchanges the code with an exact redirect URI and no `resource`
   parameter, which sidesteps #2820 and #2703.
3. The Worker stores the Supabase tokens encrypted in the grant.

The MCP server resolves the façade token to the Supabase token and calls
agent-api exactly as it does today. The `client_id` RLS boundary, the audit
table and agent-api remain unchanged.

Trade-off: Supabase sees one "BoGa gateway" client. Per-agent listing and
revocation in the app's Connected agents screen moves to the Worker's grant
store and needs a small API.

**2b (optional, same PR series):** host the MCP endpoint on the same Worker,
using `createMcpHandler` or `McpAgent`. That removes Render cold starts and
puts the AS and the resource on the same origin, the simplest topology for
discovery.

### Phase 3: protocol currency (independent)

- **Version bump.** Bump `@modelcontextprotocol/sdk` from 1.29.0 to the
  current release (1.32.0) and serve **dual-era**: 2025-11-25 `initialize`
  plus 2026-07-28 `server/discover`. Our server is already stateless, so this
  should be cheap. Whether 1.32.0 supports 2026-07-28 still needs checking.
- **Output schemas.** Add an `outputSchema` per tool.
- **Write tools.** When the planned write tools land, mark them
  `readOnlyHint:false`, `destructiveHint:false`, `idempotentHint:false`, so
  ChatGPT and Gemini ask for confirmation. Check ChatGPT plan gating for
  writes.

### Phase 4 (optional): MCP Apps UI

Render workout and progress cards via `ui://` resources. These display in
Claude (web, desktop and mobile) and ChatGPT, but not Gemini. Gate CORS on
`Origin`.

## 5. Open questions for the operator

1. **Gemini.** Are you in the US with a personal Google account? If not,
   consumer Gemini is out of reach and Gemini CLI is the only path.
2. **ChatGPT plan.** Plus, Pro or Business? This decides whether future write
   tools work in developer mode.
3. **Render.** What plan is the service on (sleeping or always-on)? Is moving
   MCP hosting to the existing Cloudflare Worker acceptable?
4. **Claude failure point.** Where exactly does it fail: the "Couldn't
   connect" toast, the consent page error, or after approval? The Supabase
   Auth logs for the `/oauth/authorize` request (its `scope` and `resource`)
   would confirm or rule out hypotheses 1 and 2.

## 6. Sources

- Claude: claude.com/docs/connectors/building/authentication,
  /custom/add-unlisted, /building/troubleshooting;
  support.claude.com/en/articles/11175166;
  platform.claude.com/docs/en/api/ip-addresses
- ChatGPT: developers.openai.com/api/docs/guides/developer-mode;
  developers.openai.com/plugins/build/auth;
  help.openai.com/en/articles/12584461
- Gemini: support.google.com/gemini/answer/17209137;
  geminicli.com/docs/tools/mcp-server
- MCP: modelcontextprotocol.io/specification/2026-07-28/changelog;
  modelcontextprotocol.io/extensions/client-matrix
- Supabase: supabase.com/docs/guides/auth/oauth-server; github.com/supabase/auth
  issues #2610, #2703, #2820, #2829, #2850
- Cloudflare: github.com/cloudflare/workers-oauth-provider
