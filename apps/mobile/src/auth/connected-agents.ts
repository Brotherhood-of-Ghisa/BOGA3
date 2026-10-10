import type { OAuthGrant } from '@supabase/supabase-js';

import { getRequiredSupabaseMobileClient } from './supabase';

export type ConnectedAgent = {
  clientId: string;
  grantedAt: string;
  lastAccessAt: string | null;
  name: string;
  planAccessEnabled: boolean;
  scopes: string[];
};

type AgentAuditRow = {
  oauth_client_id: string;
  occurred_at: string;
};

type PlanPermissionRow = {
  client_id: string;
  granted_at: string;
  plan_access_enabled: boolean;
};

/**
 * A permission only counts when it is enabled for the live grant. Comparing
 * instants (not strings) keeps the auth server's timestamp format and
 * PostgREST's timestamptz rendering interchangeable.
 */
const grantMatchesPermission = (
  permission: PlanPermissionRow | undefined,
  grantedAt: string,
): boolean => {
  if (!permission || permission.plan_access_enabled !== true) return false;
  const stored = Date.parse(permission.granted_at);
  const live = Date.parse(grantedAt);
  return Number.isFinite(stored) && Number.isFinite(live) && stored === live;
};

const normalizeGrant = (
  grant: OAuthGrant,
  lastAccessByClient: ReadonlyMap<string, string>,
  permissionByClient: ReadonlyMap<string, PlanPermissionRow>,
): ConnectedAgent => ({
  clientId: grant.client.id,
  grantedAt: grant.granted_at,
  lastAccessAt: lastAccessByClient.get(grant.client.id) ?? null,
  name: grant.client.name?.trim() || 'Connected agent',
  planAccessEnabled: grantMatchesPermission(permissionByClient.get(grant.client.id), grant.granted_at),
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
  const [auditResult, permissionResult] = await Promise.all([
    client
      .from('agent_access_audit')
      .select('oauth_client_id,occurred_at')
      .in('oauth_client_id', clientIds)
      .order('occurred_at', { ascending: false })
      .limit(1000)
      .returns<AgentAuditRow[]>(),
    client
      .from('agent_plan_permissions')
      .select('client_id,granted_at,plan_access_enabled')
      .in('client_id', clientIds)
      .returns<PlanPermissionRow[]>(),
  ]);

  // Grant management remains usable if the optional last-access metadata is
  // temporarily unavailable. Revocation is the security-critical operation.
  const lastAccessByClient = new Map<string, string>();
  if (!auditResult.error) {
    for (const row of auditResult.data ?? []) {
      if (!lastAccessByClient.has(row.oauth_client_id)) {
        lastAccessByClient.set(row.oauth_client_id, row.occurred_at);
      }
    }
  }

  // Plan access is default-denied: a missing or unreadable permission row
  // simply leaves the toggle off rather than failing the whole list.
  const permissionByClient = new Map<string, PlanPermissionRow>();
  if (!permissionResult.error) {
    for (const row of permissionResult.data ?? []) {
      permissionByClient.set(row.client_id, row);
    }
  }

  return grants
    .map((grant) => normalizeGrant(grant, lastAccessByClient, permissionByClient))
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

/**
 * Enables or disables plan creation for one connected client. The row is bound
 * to the client's current grant, so re-authorizing the same client yields a new
 * grant timestamp and starts disabled again.
 */
export const setAgentPlanPermission = async (
  clientId: string,
  enabled: boolean,
  grantedAt: string,
): Promise<void> => {
  const normalizedClientId = clientId.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(normalizedClientId)) {
    throw new Error('Connected agent identifier is invalid.');
  }
  if (!Number.isFinite(Date.parse(grantedAt))) {
    throw new Error('This connection has changed. Reload the list and try again.');
  }

  const client = getRequiredSupabaseMobileClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  const ownerId = userData?.user?.id;
  if (userError || !ownerId) {
    throw new Error('Sign in again to change plan access.');
  }

  const { error } = await client
    .from('agent_plan_permissions')
    .upsert(
      {
        owner_user_id: ownerId,
        client_id: normalizedClientId,
        plan_access_enabled: enabled,
        granted_at: grantedAt,
      },
      { onConflict: 'owner_user_id,client_id' },
    );
  if (error) {
    throw new Error(error.message || 'Unable to update plan access right now.');
  }
};
