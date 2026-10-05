import { createHash, randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { decideAuthorization, loadConsentState } from '../src/authorization.ts';

// Mints an agent token the way a remote MCP client (Claude, ChatGPT, Gemini)
// does: start from the MCP endpoint's 401 challenge, follow its metadata to the
// authorization server, register dynamically, request the advertised scopes and
// the resource, pass this app's consent gate, exchange the code, then refresh.

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};

const supabaseUrl = required('BOGA_LOCAL_SUPABASE_URL').replace(/\/+$/, '');
const publishableKey = required('BOGA_LOCAL_SUPABASE_PUBLISHABLE_KEY');
const email = required('BOGA_LOCAL_OAUTH_EMAIL');
const password = required('BOGA_LOCAL_OAUTH_PASSWORD');
const clientName = required('BOGA_LOCAL_OAUTH_CLIENT_NAME');
const mcpUrl = new URL(required('BOGA_LOCAL_OAUTH_MCP_URL'));
const redirectUri = process.env.BOGA_LOCAL_OAUTH_REDIRECT_URI?.trim() ||
  'http://127.0.0.1:43123/callback';

type AuthorizationServerMetadata = {
  authorization_endpoint: string;
  issuer: string;
  registration_endpoint: string;
  token_endpoint: string;
};

const challengeParam = (header: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(header)?.[1];

const discoverFromChallenge = async () => {
  const response = await fetch(mcpUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: clientName, version: '1.0.0' },
        protocolVersion: '2025-11-25',
      },
    }),
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  const challenge = response.headers.get('www-authenticate') ?? '';
  const resourceMetadataUrl = challengeParam(challenge, 'resource_metadata');
  const scope = challengeParam(challenge, 'scope');
  if (response.status !== 401 || !resourceMetadataUrl || !scope) {
    throw new Error('The MCP endpoint did not answer with a scoped OAuth challenge.');
  }
  return { resourceMetadataUrl, scope };
};

const fetchJson = async <T>(url: string): Promise<T | null> => {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  return response.ok ? await response.json() as T : null;
};

// RFC 8414 path insertion first, as spec-following clients do, then the
// issuer-suffixed form that local Supabase serves.
const authorizationServerMetadata = async (
  issuer: string,
): Promise<AuthorizationServerMetadata> => {
  const issuerUrl = new URL(issuer);
  const candidates = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname.replace(/\/+$/, '')}`,
    `${issuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`,
  ];
  for (const candidate of candidates) {
    const metadata = await fetchJson<AuthorizationServerMetadata>(candidate);
    if (metadata?.issuer === issuer) return metadata;
  }
  throw new Error('Authorization server metadata discovery failed.');
};

const tokenRequest = async (
  endpoint: string,
  body: Record<string, string>,
): Promise<{ access_token: string; refresh_token: string }> => {
  const response = await fetch(endpoint, {
    body: new URLSearchParams(body),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  const tokens = await response.json() as { access_token?: unknown; refresh_token?: unknown };
  if (
    !response.ok ||
    typeof tokens.access_token !== 'string' ||
    typeof tokens.refresh_token !== 'string'
  ) {
    throw new Error(`OAuth ${body.grant_type} request failed.`);
  }
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
};

const { resourceMetadataUrl, scope } = await discoverFromChallenge();
const resourceMetadata = await fetchJson<{
  authorization_servers?: string[];
  resource?: string;
}>(resourceMetadataUrl);
const issuer = resourceMetadata?.authorization_servers?.[0];
if (resourceMetadata?.resource !== mcpUrl.href || !issuer) {
  throw new Error('Protected-resource metadata does not describe the MCP endpoint.');
}
const resource = resourceMetadata.resource;
const metadata = await authorizationServerMetadata(issuer);

const registrationResponse = await fetch(metadata.registration_endpoint, {
  body: JSON.stringify({
    client_name: clientName,
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: [redirectUri],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }),
  headers: { 'content-type': 'application/json' },
  method: 'POST',
});
const registration = await registrationResponse.json() as { client_id?: unknown };
if (!registrationResponse.ok || typeof registration.client_id !== 'string') {
  throw new Error('Dynamic OAuth client registration failed.');
}
const clientId = registration.client_id;

const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorizeUrl = new URL(metadata.authorization_endpoint);
for (const [key, value] of Object.entries({
  client_id: clientId,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  redirect_uri: redirectUri,
  resource,
  response_type: 'code',
  scope,
  state: 'boga-local-smoke',
})) {
  authorizeUrl.searchParams.set(key, value);
}
const authorizationResponse = await fetch(authorizeUrl, { redirect: 'manual' });
const consentLocation = authorizationResponse.headers.get('location');
if (authorizationResponse.status !== 302 || !consentLocation) {
  throw new Error('OAuth authorization did not start.');
}
const authorizationId = new URL(consentLocation).searchParams.get('authorization_id');
if (!authorizationId) throw new Error('OAuth authorization ID is missing.');

const client = createClient(supabaseUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const signIn = await client.auth.signInWithPassword({ email, password });
if (signIn.error || !signIn.data.session) {
  throw new Error('Local OAuth fixture sign-in failed.');
}
// The consent page's own gate: it must accept exactly what the MCP challenge
// told the client to request.
const consent = await loadConsentState(client, authorizationId);
if (consent.kind !== 'consent' || consent.details.clientId !== clientId) {
  throw new Error('OAuth consent details are invalid.');
}
const approvedRedirect = await decideAuthorization(client, authorizationId, 'approve');
const authorizationCode = new URL(approvedRedirect).searchParams.get('code');
if (!authorizationCode) throw new Error('OAuth authorization code is missing.');

const issued = await tokenRequest(metadata.token_endpoint, {
  client_id: clientId,
  code: authorizationCode,
  code_verifier: verifier,
  grant_type: 'authorization_code',
  redirect_uri: redirectUri,
  resource,
});
// Clients refresh when the hour-long access token expires; the MCP calls use
// the refreshed token so a broken refresh fails the smoke.
const refreshed = await tokenRequest(metadata.token_endpoint, {
  client_id: clientId,
  grant_type: 'refresh_token',
  refresh_token: issued.refresh_token,
  resource,
});

process.stdout.write(JSON.stringify({
  accessToken: refreshed.access_token,
  appAccessToken: signIn.data.session.access_token,
  clientId,
  refreshToken: refreshed.refresh_token,
  scope,
}));
