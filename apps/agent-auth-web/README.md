# BoGa agent authorization web

`apps/agent-auth-web` is the public consent surface used by the Supabase OAuth
2.1 server. Supabase owns protocol validation, authorization codes, PKCE, token
issuance/refresh, expiry, and revocation; this app only signs the BoGa user in,
shows the requesting client and read-only training-data disclosure, and calls
the supported approve/deny methods.

The consent surface accepts the four identity scopes currently advertised by
the Supabase OAuth server: `openid`, `profile`, `email`, and `phone`. It renders
every requested permission before approval and fails closed when a client
requests any unknown/additional scope.

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

The production consent UI is hosted as Cloudflare Worker static assets at:

```text
https://sparkling-violet-dc56.sboschianpest.workers.dev
```

`wrangler.jsonc` publishes `dist/` and enables single-page-application fallback.
The fallback is required so a direct request to `/oauth/consent` serves
`index.html` instead of returning `404`.

### Deploy an update

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
   These are public browser values; never use a Supabase secret or service-role
   key.
2. Build and deploy from the app directory:

   ```bash
   cd apps/agent-auth-web
   npm ci
   npm run build
   npx wrangler deploy
   ```

3. Confirm both the root URL and the consent route return the app:

   ```bash
   curl --fail --head \
     https://sparkling-violet-dc56.sboschianpest.workers.dev/
   curl --fail --head \
     https://sparkling-violet-dc56.sboschianpest.workers.dev/oauth/consent
   ```

### Configure the hosted Supabase project

1. In **Authentication > URL Configuration**, set the Site URL to:

   ```text
   https://sparkling-violet-dc56.sboschianpest.workers.dev
   ```

2. In **Authentication > OAuth Server**, enable the OAuth server and set the
   Authorization Path to:

   ```text
   /oauth/consent
   ```

   Supabase combines the Site URL and Authorization Path and redirects OAuth
   requests to that page with an `authorization_id` query parameter.
3. Use an asymmetric JWT signing key such as ES256 or RS256. This app accepts
   the `openid` scope, and Supabase cannot issue its OpenID Connect ID token
   while the project still uses the legacy HS256 signing secret. Follow the
   Supabase dashboard's signing-key rotation workflow; no private signing key
   belongs in this app.
4. Enable dynamic client registration if MCP clients should register
   themselves. Otherwise, add each supported MCP client under
   **Authentication > OAuth Apps** and register its exact callback URL.

### Connect MCP clients

Use the public Streamable HTTP MCP endpoint in every client:

```text
https://boga3.onrender.com/mcp
```

Do not enter the Cloudflare consent URL as the MCP server URL, and do not copy a
terminal access token into the client. The client should discover Supabase
OAuth from the MCP endpoint, register itself dynamically, open the BoGa sign-in
and consent page, and store the resulting tokens.

Dynamic client registration must remain enabled in the hosted Supabase project
for the credential-free instructions below.

#### Gemini CLI

Add BoGa as a user-scoped Streamable HTTP server:

```bash
gemini mcp add --transport http --scope user \
  boga https://boga3.onrender.com/mcp
```

Start Gemini CLI, then authenticate and verify the connection:

```text
/mcp auth boga
/mcp list
```

Gemini opens the browser for BoGa sign-in and consent. This requires a local
browser and a localhost callback; follow Gemini's documented headless flow when
running through SSH or inside a container. See the
[Gemini CLI MCP server documentation][gemini-mcp].

#### Claude and Claude Desktop

For an individual account:

1. Open **Customize > Connectors** in Claude.
2. Select **+ > Add custom connector**.
3. Enter `https://boga3.onrender.com/mcp`.
4. Leave the advanced OAuth Client ID and Client Secret fields empty.
5. Add the connector, select **Connect**, then sign in to BoGa and approve the
   requested read-only access.
6. Enable the connector for a conversation from **+ > Connectors**.

Team and Enterprise owners add the URL under
**Organization settings > Connectors > Add > Custom > Web**; members then
connect their own BoGa accounts. Remote connectors configured in Claude are
also available in Claude Desktop. See
[Claude's custom connector instructions][claude-connectors].

#### Claude Code

Add BoGa as a user-scoped HTTP server, then start its OAuth flow:

```bash
claude mcp add --transport http --scope user \
  boga https://boga3.onrender.com/mcp
claude mcp login boga
claude mcp list
```

On Claude Code versions without `claude mcp login`, start Claude Code and use
`/mcp` to authenticate in the browser. See the
[Claude Code MCP documentation][claude-code-mcp].

After connecting any client, ask it to list the BoGa tools and then try a
read-only request such as “Show my recent BoGa workouts.” A successful
connection exposes `get_training_profile`, `search_exercises`,
`get_exercise_context`, and `get_recent_workouts`.

### Verify the hosted OAuth flow

Start a connection from a real MCP client; do not invent an
`authorization_id`. Check each user-visible outcome:

1. While signed out, the consent URL asks the user to sign in and then returns
   to the same authorization request.
2. **Allow access** returns the browser to the MCP client's registered callback
   and the client can call the read-only BoGa tools.
3. **Cancel** returns the browser to the client with an access-denied result and
   issues no usable access token.
4. Reconnecting can refresh an expired access token.
5. Revoking the connection in BoGa prevents that client from using or refreshing
   the revoked credentials.

Cloudflare already provides HTTPS for the `workers.dev` origin. Before a wider
public launch, add response headers for Content Security Policy,
`Referrer-Policy`, and clickjacking protection, and keep request-query logging
disabled because `authorization_id` is OAuth protocol state. These are host
hardening tasks, not additional Supabase keys or OAuth settings.

The repository records the Worker configuration and production URL, but it does
not contain Cloudflare or hosted Supabase operator credentials, nor does it own
the final callback URLs chosen by third-party MCP clients. Deployment, dashboard
configuration, and the hosted OAuth verification therefore remain explicit
operator steps; the local smoke is not evidence that they were completed.

[claude-code-mcp]: https://code.claude.com/docs/en/mcp
[claude-connectors]: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
[gemini-mcp]: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
