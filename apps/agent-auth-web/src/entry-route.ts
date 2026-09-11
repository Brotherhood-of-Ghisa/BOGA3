import { authorizationIdFrom } from './authorization.ts';

export type AgentAuthEntryRoute =
  | { kind: 'setup' }
  | { authorizationId: string; kind: 'consent' }
  | { kind: 'unsupported' };

const normalizedPathname = (pathname: string): string => {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '');
};

/**
 * Keeps public setup browsing separate from Supabase's client-created OAuth
 * requests. Only the configured consent path is allowed to consume an
 * authorization_id.
 */
export const agentAuthEntryRouteFrom = (url: URL): AgentAuthEntryRoute => {
  switch (normalizedPathname(url.pathname)) {
    case '/':
    case '/connect':
      return { kind: 'setup' };
    case '/oauth/consent':
      return {
        authorizationId: authorizationIdFrom(url),
        kind: 'consent',
      };
    default:
      return { kind: 'unsupported' };
  }
};
