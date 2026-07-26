import type { SupabaseClient } from '@supabase/supabase-js';

export const BOGA_OAUTH_SCOPES = ['openid', 'profile'] as const;

export type BogaOAuthScope = (typeof BOGA_OAUTH_SCOPES)[number];

export const OAUTH_SCOPE_DISCLOSURES: Record<BogaOAuthScope, string> = {
  openid: 'Confirm your BoGa account identity and issue an OpenID ID token.',
  profile: 'Share standard profile claims such as your name and profile picture.',
};

export type ConsentDetails = {
  authorizationId: string;
  clientId: string;
  clientName: string;
  scopes: BogaOAuthScope[];
};

export type ConsentState =
  | { kind: 'consent'; details: ConsentDetails }
  | { kind: 'redirect'; redirectUrl: string };

const validRedirect = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new Error('Authorization redirect is missing.');
  const value = new URL(raw);
  if (value.protocol !== 'https:' && value.hostname !== 'localhost' && value.hostname !== '127.0.0.1') {
    throw new Error('Authorization redirect is not secure.');
  }
  return value.href;
};

const requestedScopesFrom = (raw: string): BogaOAuthScope[] => {
  const scopes = [...new Set(raw.split(/\s+/).filter((scope) => scope.length > 0))];
  const allowedScopes = new Set<string>(BOGA_OAUTH_SCOPES);
  if (scopes.length === 0 || scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new Error(
      'This agent requested unsupported identity permissions. Return to the agent and try again.',
    );
  }
  return scopes as BogaOAuthScope[];
};

export const authorizationIdFrom = (url: URL): string => {
  const authorizationId = url.searchParams.get('authorization_id')?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(authorizationId)) {
    throw new Error('This authorization request is missing or invalid.');
  }
  return authorizationId;
};

export const loadConsentState = async (
  client: SupabaseClient,
  authorizationId: string,
): Promise<ConsentState> => {
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) throw error;
  if (!data) throw new Error('Authorization request not found.');
  if ('redirect_url' in data) {
    return { kind: 'redirect', redirectUrl: validRedirect(data.redirect_url) };
  }
  return {
    kind: 'consent',
    details: {
      authorizationId: data.authorization_id,
      clientId: data.client.id,
      clientName: data.client.name,
      scopes: requestedScopesFrom(data.scope),
    },
  };
};

export const decideAuthorization = async (
  client: SupabaseClient,
  authorizationId: string,
  decision: 'approve' | 'deny',
): Promise<string> => {
  const operation = decision === 'approve'
    ? client.auth.oauth.approveAuthorization.bind(client.auth.oauth)
    : client.auth.oauth.denyAuthorization.bind(client.auth.oauth);
  const { data, error } = await operation(authorizationId, {
    skipBrowserRedirect: true,
  });
  if (error) throw error;
  return validRedirect(data?.redirect_url);
};
