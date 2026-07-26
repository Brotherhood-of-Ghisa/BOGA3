import type { OAuthGrant } from '@supabase/supabase-js';

import { getRequiredSupabaseMobileClient } from './supabase';

export type ConnectedAgent = {
  clientId: string;
  grantedAt: string;
  lastAccessAt: string | null;
  name: string;
  scopes: string[];
};

type AgentAuditRow = {
  oauth_client_id: string;
  occurred_at: string;
};

const normalizeGrant = (
  grant: OAuthGrant,
  lastAccessByClient: ReadonlyMap<string, string>,
): ConnectedAgent => ({
  clientId: grant.client.id,
  grantedAt: grant.granted_at,
  lastAccessAt: lastAccessByClient.get(grant.client.id) ?? null,
  name: grant.client.name?.trim() || 'Connected agent',
  scopes: grant.scopes.filter((scope) => typeof scope === 'string'),
});

export const listConnectedAgents = async (): Promise<ConnectedAgent[]> => {
  const client = getRequiredSupabaseMobileClient();
  const { data: grants, error } = await client.auth.oauth.listGrants();
  if (error) {
    throw new Error(error.message || 'Unable to load connected agents right now.');
  }
  if (!grants || grants.length === 0) return [];

  const clientIds = grants.map((grant) => grant.client.id);
  const { data: auditRows, error: auditError } = await client
    .from('agent_access_audit')
    .select('oauth_client_id,occurred_at')
    .in('oauth_client_id', clientIds)
    .order('occurred_at', { ascending: false })
    .limit(1000)
    .returns<AgentAuditRow[]>();

  // Grant management remains usable if the optional last-access metadata is
  // temporarily unavailable. Revocation is the security-critical operation.
  const lastAccessByClient = new Map<string, string>();
  if (!auditError) {
    for (const row of auditRows ?? []) {
      if (!lastAccessByClient.has(row.oauth_client_id)) {
        lastAccessByClient.set(row.oauth_client_id, row.occurred_at);
      }
    }
  }

  return grants
    .map((grant) => normalizeGrant(grant, lastAccessByClient))
    .sort((left, right) =>
      right.grantedAt.localeCompare(left.grantedAt) ||
      left.name.localeCompare(right.name)
    );
};

export const revokeConnectedAgent = async (clientId: string): Promise<void> => {
  const normalizedClientId = clientId.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(normalizedClientId)) {
    throw new Error('Connected agent identifier is invalid.');
  }
  const { error } = await getRequiredSupabaseMobileClient().auth.oauth.revokeGrant({
    clientId: normalizedClientId,
  });
  if (error) {
    throw new Error(error.message || 'Unable to revoke this agent right now.');
  }
};
