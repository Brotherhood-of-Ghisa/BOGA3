import { createHash, randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

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
const redirectUri = process.env.BOGA_LOCAL_OAUTH_REDIRECT_URI?.trim() ||
  'http://127.0.0.1:43123/callback';

const registrationResponse = await fetch(
  `${supabaseUrl}/auth/v1/oauth/clients/register`,
  {
    body: JSON.stringify({
      client_name: clientName,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  },
);
const registration = await registrationResponse.json() as { client_id?: unknown };
if (!registrationResponse.ok || typeof registration.client_id !== 'string') {
  throw new Error('Dynamic OAuth client registration failed.');
}

const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
for (const [key, value] of Object.entries({
  client_id: registration.client_id,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'openid profile',
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
const details = await client.auth.oauth.getAuthorizationDetails(authorizationId);
if (
  details.error ||
  !details.data ||
  !('authorization_id' in details.data) ||
  details.data.client.id !== registration.client_id
) {
  throw new Error('OAuth consent details are invalid.');
}
const approval = await client.auth.oauth.approveAuthorization(authorizationId, {
  skipBrowserRedirect: true,
});
if (approval.error || !approval.data?.redirect_url) {
  throw new Error('OAuth consent approval failed.');
}
const authorizationCode = new URL(approval.data.redirect_url).searchParams.get('code');
if (!authorizationCode) throw new Error('OAuth authorization code is missing.');

const tokenResponse = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
  body: new URLSearchParams({
    client_id: registration.client_id,
    code: authorizationCode,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  method: 'POST',
});
const tokens = await tokenResponse.json() as {
  access_token?: unknown;
  refresh_token?: unknown;
};
if (
  !tokenResponse.ok ||
  typeof tokens.access_token !== 'string' ||
  typeof tokens.refresh_token !== 'string'
) {
  throw new Error('OAuth token exchange failed.');
}

process.stdout.write(JSON.stringify({
  accessToken: tokens.access_token,
  appAccessToken: signIn.data.session.access_token,
  clientId: registration.client_id,
  refreshToken: tokens.refresh_token,
}));
