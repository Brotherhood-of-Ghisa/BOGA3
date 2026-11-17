# OAuth authorization-loop diagnostics

Load when investigating repeated consent or interpreting authentication logs.
This change observes existing decisions; it does not change token lifetimes,
scopes, grant policy, refresh handling, or HTTP authentication status mappings.

## Correlating production events

Render stdout and Supabase Edge stdout contain one JSON object per event.
Filter `service=boga-mcp` or `service=agent-api`, then `request_id`.
Render generates a UUID for every HTTP request and returns `x-request-id`.
Its async request context passes the same UUID to every Agent API call, including
session verification and tool execution. Agent API propagates it to Auth user
and grants requests; Auth/gateway logs may use their own IDs, so retention of the
supplied header there must be verified. Never assume correlation reaches the
OAuth token endpoint: that endpoint belongs to Supabase Auth and is called by
the client directly.

Agent API preserves its existing response/audit request-ID contract. Direct
callers supplying non-UUID IDs receive those IDs as before, but diagnostics use
a new UUID to avoid logging arbitrary caller text. Render-generated UUIDs
correlate unchanged end to end. No OAuth state, code, redirect query, token,
request arguments, user identity, cookies or upstream error text is logged.
Tool names are allowlisted; unknown names and endpoints become generic values.

Optional: provision the **same** random secret of at least 32 characters as
`AUTH_DIAGNOSTIC_HMAC_KEY` in Render and Supabase Edge secrets. Never print it.
Without it, identity tags are omitted. With it, domain-separated HMAC-SHA256
truncated to 96 bits produces `token_tag`, `client_tag`, and `grant_tag`.
Tags cannot authenticate; treat them as restricted pseudonymous diagnostics.
Rotate/remove the key after investigation and retain logs only as long as needed.
A token tag changing is evidence of different token bytes, not proof of refresh:
another authorization can also issue a token. A grant tag changing means the
client/granted-at pair changed, not proof of revocation or invalidation.

Each process/isolate caps diagnostic output at 6,000 events per minute, with
`suppressed_since_last` on the next emitted record. There are no token-keyed
in-memory maps. Under the cap, all successes and failures are logged. Above it,
events can be lost; absence of an event is then inconclusive. Logging sink errors
are swallowed. Existing database access auditing remains separate.

## Event sequence and failure classifications

Render: `http.request` → `auth.verify.start` → `upstream.response` or
`upstream.failure` → `auth.verify.result` → optional `auth.challenge` →
`http.response`. Completion records include status, operation, known tool name,
and latency. Raw request URLs/queries and token claims are never included.
Startup `oauth.configuration` records issuer, resource, requested scopes and
advertised refresh/offline support, not actual token issuance.

| Boundary | Classification | Existing decision |
| --- | --- | --- |
| MCP | missing_credentials, malformed_credentials | 401 challenge |
| MCP verification | upstream_unauthorized, upstream_forbidden | 401 challenge, recorded as upstream_token_rejected |
| MCP session | session_expired | 401 challenge |
| MCP verification | upstream_unavailable (429/5xx) | 503, Retry-After, no challenge |
| MCP verification | upstream_error, internal_error | 500, no challenge |
| MCP transport | invalid_request, transport_failure | Existing 400/500 handling |
| Edge user | auth_token_rejected | 401 |
| Edge user | auth_user_unavailable | 503 |
| Edge claims | malformed_validated_claims, oauth_client_missing, subject_mismatch, expiry_missing, token_expired | 401 |
| Edge grants | grants_token_rejected | 401 |
| Edge grants | grants_unavailable, grants_invalid_response | 503 |
| Edge lookup | active_grant_absent, grant_client_mismatch, grant_timestamp_missing | 401 |
| Edge grants | grants_unrecognized_shape | Observes existing normalization; may subsequently reject as absent |
| Edge lookup | active_grant_found | Continue existing authorization |

Edge `auth.verify.result` records final outcome and total latency on both
success and failure. `auth.user_response` records actual Auth HTTP status;
`auth.user` records outcomes/latency and error status (null on success).
`auth.grants_response` records grants status and latency; `http.response` records final status even when validation fails.
`auth.token_observations` is explicitly **unverified**, bounded boolean/enum
metadata (including a coarse issued-within-five-minutes observation) useful when Auth rejects a token before validated claims are available.
`auth.claim_observations` follows successful Auth validation. Issuer/audience
comparisons are observations only: enforcement is delegated to Supabase Auth.
Neither observation changes authorization. Auth errors only expose an allowlisted
rejection detail (`bad_jwt`, `session_not_found`, `user_not_found`). Active-grant
absence cannot distinguish never granted, expired or revoked consent; inspect
Auth audit evidence. No local grant-expiry/revocation rule has been added.

## Diagnostic decision tree

1. Find the Render request near the repeated consent prompt. If none exists,
   inspect client/discovery/network evidence; a client prompt alone does not
   prove a BoGa rejection. Check suppression counts before drawing conclusions.
2. `missing_credentials`/`malformed_credentials`: ChatGPT sent no usable bearer.
   Check client token storage, exchange and refresh results in Auth logs.
3. A 503 with `upstream_unavailable` is a BoGa dependency/network failure.
   No challenge is generated by this path. If consent still appears, collect
   client evidence showing why it initiated authorization.
4. A 401 from session verification: follow the same UUID into Agent API.
   `auth_token_rejected` means Auth rejected it; inspect Auth failure detail,
   unverified expiry observation, and Auth audit logs before deciding why.
   Fresh-token rejection points to issuance/validation, session, issuer or client
   consistency; it does not prove a refresh defect.
5. Validated-claim failures identify missing OAuth client, subject mismatch or
   expiry. Observed issuer/audience mismatch warrants checking Auth settings and
   discovery, without changing local validation based on these logs.
6. Grant absence/mismatch/timestamp failure: compare client/grant tags across
   authorizations and inspect Auth grant audit events. BoGa consent delegates to
   Supabase approval and does not itself replace grants. Establish whether a
   repeat consent changed grant timestamps or revoked previous credentials.
7. Accepted session plus tool failure: correlate the tool's upstream response.
   Tool-domain permission failures are not session authentication challenges.
8. Accepted repeated requests followed by a client prompt with no intervening
   server challenge: investigate client token retention/refresh behavior. Obtain
   Auth token-endpoint success/failure timestamps and grant type, never token
   bodies. A successful refresh followed by rejection is different from no
   refresh attempt, unsuccessful refresh, or the client reusing expired bytes.

## Refresh evidence and verification

Public production metadata observed on 2026-11-17 advertised resource
`https://boga3.onrender.com/mcp`, issuer
`https://onluhhnvvmknqzdxgntl.supabase.co/auth/v1`, and `openid profile offline_access`.
This proves advertisement, not granted scopes or delivery to ChatGPT. The MCP
adds offline_access only when issuer discovery supports it; consent accepts it
and delegates issuance to Supabase. Review Auth token-endpoint events to prove
issuance and usable refresh in production. No production root cause is yet
established by repository inspection or public metadata.

Read-only production log queries on 2026-11-17 (rolling previous 24 hours)
found 118 GET grant-list 403 responses with OAuth JWTs whose expiry was in the
future; 48 OAuth grant-list requests succeeded, as did 25 app-token requests.
All 169 user-validation requests in that window returned 200. The Auth log
stream contained 118 `no_authorization` 403s; its path field was only `/`, so
those errors cannot be individually joined to the grant endpoint from that field.
The gateway stream showed 65 successful OAuth token-endpoint responses, and
Auth login events included 54 refresh-token and 11 authorization-code grants.
These are project-wide aggregates, not identified ChatGPT sessions. They locate
a strong lead at live grant verification rather than proving token expiry or
client malfunction. In the current code, a grants 403 becomes Agent API 401,
then an MCP challenge. Per-request diagnostics and Auth audit evidence are still
needed to explain the rejection and link it to a particular consent prompt.
No credentials or user/client identifiers were selected by these queries.

The local `mcp-smoke` lane uses the consent frontend's
`apps/agent-auth-web/scripts/mint-local-oauth.ts` harness: challenge/discovery, registration, consent,
code exchange, three initial-token MCP requests, OAuth token-endpoint refresh,
then three refreshed-token requests. Existing broader MCP smoke calls use the
refreshed token. The unit suites cover expiry and replacement-token acceptance
with controlled time/session responses; they do not prove ChatGPT refresh or
wait for a real production token to expire. Agent API handler tests exercise
actual handler branches with only Auth/data network boundaries replaced.
Run `./boga test fast`, `./boga test backend`, and `./boga test mcp-smoke` from a
leased checkout. Never run these against production to create diagnostic grants.

## Validation recorded for this change

Local Jest: 494 suites, 7,953 tests passed (three pre-existing skips); coverage
88.54% branches and 95.79% lines. MCP: 95 tests and TypeScript build passed.
Consent tests/build, mobile TypeScript/lint, documentation, complexity and
dependency gates passed. Additional handler/privacy regressions were rerun after
review. These counts describe this checkout, not production behavior.

The full fast aggregate reached its backend step while the backend lane held
the runtime lock; its preceding gates passed. Local Supabase bootstrap then
failed to register the Postgres image with `no space left on device` in the
32-GB container. The failing bootstrap was stopped. Backend integration and
real OAuth `mcp-smoke` remain unverified here; rerun both in a disk-capable
leased environment before treating real consent/refresh as validated. No
production deployment or speculative authentication fix was performed.
