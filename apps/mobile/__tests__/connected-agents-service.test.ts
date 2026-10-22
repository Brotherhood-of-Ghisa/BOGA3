/* eslint-disable import/first */

const mockListGrants = jest.fn();
const mockRevokeGrant = jest.fn();
const mockGetUser = jest.fn();
const mockUpsert = jest.fn();

const mockAuditReturns = jest.fn();
const mockAuditLimit = jest.fn(() => ({ returns: mockAuditReturns }));
const mockAuditOrder = jest.fn(() => ({ limit: mockAuditLimit }));
const mockAuditIn = jest.fn(() => ({ order: mockAuditOrder }));
const mockAuditSelect = jest.fn(() => ({ in: mockAuditIn }));

const mockPermissionReturns = jest.fn();
const mockPermissionIn = jest.fn(() => ({ returns: mockPermissionReturns }));
const mockPermissionSelect = jest.fn(() => ({ in: mockPermissionIn }));

const mockFrom = jest.fn((table: string) => {
  if (table === 'agent_plan_permissions') {
    return { select: mockPermissionSelect, upsert: mockUpsert };
  }
  return { select: mockAuditSelect };
});

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({
    auth: {
      getUser: mockGetUser,
      oauth: {
        listGrants: mockListGrants,
        revokeGrant: mockRevokeGrant,
      },
    },
    from: mockFrom,
  }),
}));

import {
  listConnectedAgents,
  revokeConnectedAgent,
  setAgentPlanEditEnabled,
  setAgentPlanPermission,
} from '@/src/auth/connected-agents';

describe('connected agent service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListGrants.mockResolvedValue({ data: [], error: null });
    mockAuditReturns.mockResolvedValue({ data: [], error: null });
    mockPermissionReturns.mockResolvedValue({ data: [], error: null });
    mockRevokeGrant.mockResolvedValue({ data: {}, error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('joins OAuth grants to metadata-only last access timestamps', async () => {
    mockListGrants.mockResolvedValue({
      data: [
        {
          client: { id: 'client-a', name: 'Coach A' },
          granted_at: '2026-07-24T12:00:00.000Z',
          scopes: ['openid', 'profile'],
        },
        {
          client: { id: 'client-b', name: 'Coach B' },
          granted_at: '2026-07-25T12:00:00.000Z',
          scopes: ['openid'],
        },
      ],
      error: null,
    });
    mockAuditReturns.mockResolvedValue({
      data: [
        {
          oauth_client_id: 'client-a',
          occurred_at: '2026-07-25T13:00:00.000Z',
        },
        {
          oauth_client_id: 'client-a',
          occurred_at: '2026-07-25T12:00:00.000Z',
        },
      ],
      error: null,
    });

    await expect(listConnectedAgents()).resolves.toEqual([
      {
        clientId: 'client-b',
        grantedAt: '2026-07-25T12:00:00.000Z',
        lastAccessAt: null,
        name: 'Coach B',
        planAccessEnabled: false,
        planEditEnabled: false,
        scopes: ['openid'],
      },
      {
        clientId: 'client-a',
        grantedAt: '2026-07-24T12:00:00.000Z',
        lastAccessAt: '2026-07-25T13:00:00.000Z',
        name: 'Coach A',
        planAccessEnabled: false,
        planEditEnabled: false,
        scopes: ['openid', 'profile'],
      },
    ]);
    expect(mockFrom).toHaveBeenCalledWith('agent_access_audit');
    expect(mockFrom).toHaveBeenCalledWith('agent_plan_permissions');
    expect(mockAuditSelect).toHaveBeenCalledWith('oauth_client_id,occurred_at');
    expect(mockPermissionSelect).toHaveBeenCalledWith('client_id,granted_at,plan_access_enabled,plan_edit_enabled');
  });

  it('enables plan access only when the permission matches the live grant', async () => {
    mockListGrants.mockResolvedValue({
      data: [
        {
          client: { id: 'client-a', name: 'Coach A' },
          granted_at: '2026-07-24T12:00:00.000Z',
          scopes: ['openid'],
        },
        {
          client: { id: 'client-b', name: 'Coach B' },
          granted_at: '2026-07-25T12:00:00.000Z',
          scopes: ['openid'],
        },
      ],
      error: null,
    });
    mockPermissionReturns.mockResolvedValue({
      data: [
        {
          client_id: 'client-a',
          granted_at: '2026-07-24T12:00:00.000Z',
          plan_access_enabled: true,
        },
        {
          // Same client, but a stale grant: re-authorization must not inherit.
          client_id: 'client-b',
          granted_at: '2026-07-20T12:00:00.000Z',
          plan_access_enabled: true,
        },
      ],
      error: null,
    });

    const agents = await listConnectedAgents();
    expect(agents.find((entry) => entry.clientId === 'client-a')?.planAccessEnabled).toBe(true);
    expect(agents.find((entry) => entry.clientId === 'client-b')?.planAccessEnabled).toBe(false);
  });

  it('enables plan edit only when the permission matches the live grant', async () => {
    mockListGrants.mockResolvedValue({
      data: [
        {
          client: { id: 'client-a', name: 'Coach A' },
          granted_at: '2026-07-24T12:00:00.000Z',
          scopes: ['openid'],
        },
        {
          client: { id: 'client-b', name: 'Coach B' },
          granted_at: '2026-07-25T12:00:00.000Z',
          scopes: ['openid'],
        },
      ],
      error: null,
    });
    mockPermissionReturns.mockResolvedValue({
      data: [
        {
          client_id: 'client-a',
          granted_at: '2026-07-24T12:00:00.000Z',
          plan_access_enabled: false,
          plan_edit_enabled: true,
        },
        {
          // Stale grant: re-authorization must not inherit edit permission
          client_id: 'client-b',
          granted_at: '2026-07-20T12:00:00.000Z',
          plan_access_enabled: true,
          plan_edit_enabled: true,
        },
      ],
      error: null,
    });

    const agents = await listConnectedAgents();
    expect(agents.find((entry) => entry.clientId === 'client-a')?.planEditEnabled).toBe(true);
    expect(agents.find((entry) => entry.clientId === 'client-b')?.planEditEnabled).toBe(false);
  });

  it('marks plan access and plan edit unavailable when the permission query fails', async () => {
    mockListGrants.mockResolvedValue({
      data: [
        {
          client: { id: 'client-a', name: 'Coach A' },
          granted_at: '2026-07-24T12:00:00.000Z',
          scopes: ['openid'],
        },
      ],
      error: null,
    });
    mockPermissionReturns.mockResolvedValue({
      data: null,
      error: { message: 'permission table unreachable' },
    });

    const agents = await listConnectedAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].planAccessEnabled).toBe('unavailable');
    expect(agents[0].planEditEnabled).toBe('unavailable');
  });

  it('keeps revocation available when optional audit metadata cannot load', async () => {
    mockListGrants.mockResolvedValue({
      data: [
        {
          client: { id: 'client-a', name: 'Coach A' },
          granted_at: '2026-07-24T12:00:00.000Z',
          scopes: ['openid'],
        },
      ],
      error: null,
    });
    mockAuditReturns.mockResolvedValue({
      data: null,
      error: { message: 'audit temporarily unavailable' },
    });

    await expect(listConnectedAgents()).resolves.toMatchObject([
      { clientId: 'client-a', lastAccessAt: null, planAccessEnabled: false },
    ]);
  });

  it('revokes by OAuth client identifier through the Supabase SDK', async () => {
    await revokeConnectedAgent('client-a');
    expect(mockRevokeGrant).toHaveBeenCalledWith({ clientId: 'client-a' });
  });

  it('upserts the plan permission bound to the owner and live grant', async () => {
    await setAgentPlanPermission('client-a', true, '2026-07-24T12:00:00.000Z');
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        owner_user_id: 'user-a',
        client_id: 'client-a',
        plan_access_enabled: true,
        granted_at: '2026-07-24T12:00:00.000Z',
      },
      { onConflict: 'owner_user_id,client_id' },
    );
  });

  it('rejects an invalid client identifier and an invalid grant timestamp', async () => {
    await expect(setAgentPlanPermission('bad id!', true, '2026-07-24T12:00:00.000Z')).rejects.toThrow(
      'Connected agent identifier is invalid.',
    );
    await expect(setAgentPlanPermission('client-a', true, 'not-a-date')).rejects.toThrow(
      'This connection has changed. Reload the list and try again.',
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('surfaces a write failure as a retryable error', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'permission write denied' } });
    await expect(
      setAgentPlanPermission('client-a', true, '2026-07-24T12:00:00.000Z'),
    ).rejects.toThrow('permission write denied');
  });

  it('upserts the plan edit permission bound to the owner and live grant', async () => {
    await setAgentPlanEditEnabled('client-a', true, '2026-07-24T12:00:00.000Z');
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        owner_user_id: 'user-a',
        client_id: 'client-a',
        plan_edit_enabled: true,
        granted_at: '2026-07-24T12:00:00.000Z',
      },
      { onConflict: 'owner_user_id,client_id' },
    );
  });

  it('supports (clientId, grantedAt, enabled) parameter order for setAgentPlanEditEnabled', async () => {
    await setAgentPlanEditEnabled('client-a', '2026-07-24T12:00:00.000Z', true);
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        owner_user_id: 'user-a',
        client_id: 'client-a',
        plan_edit_enabled: true,
        granted_at: '2026-07-24T12:00:00.000Z',
      },
      { onConflict: 'owner_user_id,client_id' },
    );
  });

  it('rejects an invalid client identifier and grant timestamp for plan edit permission', async () => {
    await expect(setAgentPlanEditEnabled('bad id!', true, '2026-07-24T12:00:00.000Z')).rejects.toThrow(
      'Connected agent identifier is invalid.',
    );
    await expect(setAgentPlanEditEnabled('client-a', true, 'not-a-date')).rejects.toThrow(
      'This connection has changed. Reload the list and try again.',
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('surfaces a write failure as a retryable error for plan edit permission', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'edit permission write denied' } });
    await expect(
      setAgentPlanEditEnabled('client-a', true, '2026-07-24T12:00:00.000Z'),
    ).rejects.toThrow('edit permission write denied');
  });
});
