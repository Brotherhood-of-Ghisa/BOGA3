# BoGa agent authorization web

`apps/agent-auth-web` is the public consent surface used by the Supabase OAuth
2.1 server. Supabase owns protocol validation, authorization codes, PKCE, token
issuance/refresh, expiry, and revocation; this app only signs the BoGa user in,
shows the requesting client and read-only training-data disclosure, and calls
the supported approve/deny methods.

The consent surface accepts only the `openid` and `profile` identity scopes,
renders both requested permissions before approval, and fails closed when a
client requests `email`, `phone`, or any unknown/additional scope.

It is a static Vite application. It contains only a Supabase project URL and
client-safe publishable key. Never provide it a service-role/secret key.

## Local development and checks

```bash
cd apps/agent-auth-web
cp .env.example .env.local
npm install
npm run test
npm run build
npm run dev
```

Set `VITE_SUPABASE_URL` to the target Supabase API origin and
`VITE_SUPABASE_PUBLISHABLE_KEY` to its client-safe publishable key. Vite embeds
both values into the public bundle, so neither variable may contain a secret.

`scripts/mint-local-oauth.ts` is test tooling, not production UI. The repository
smoke harness uses it to exercise dynamic registration, authorization code +
PKCE, consent approval, and token exchange against local Supabase:

```bash
./boga test mcp-smoke
```

## Production hosting

1. Choose the final HTTPS origin, for example `https://auth.boga.example`.
2. Configure the two public build variables, run `npm ci && npm run build`, and
   publish `dist/` from the origin root.
3. Configure the static host to serve `index.html` for
   `/oauth/consent?authorization_id=...`; built assets remain under `/assets`.
4. In Supabase Auth, enable the OAuth server and set its authorization URL path
   to `/oauth/consent`. Ensure the Auth Site URL resolves that path to this
   origin and keep every other application redirect in the explicit redirect
   allowlist.
5. Decide explicitly whether to allow dynamic client registration. If disabled,
   register supported MCP clients and exact callback URLs in Supabase.
6. Use asymmetric JWT signing keys in the hosted project before exposing the
   OAuth server publicly.
7. Set restrictive CSP, `Referrer-Policy`, clickjacking protection, HTTPS-only
   transport, and no-store behavior at the host. Do not log query strings:
   `authorization_id` is protocol state.
8. Manually verify signed-out sign-in, explicit allow, cancel/deny, callback,
   token refresh/expiry, and revocation against the hosted origin.

The repository does not own a production web host, DNS name, final MCP callback
URLs, or hosted Supabase operator session. Deployment and hosted smoke therefore
remain explicit operator steps; the local smoke is not evidence that they were
completed.
