/* eslint-disable import/first */

const mockListGrants = jest.fn();
const mockRevokeGrant = jest.fn();
const mockReturns = jest.fn();
const mockLimit = jest.fn(() => ({ returns: mockReturns }));
const mockOrder = jest.fn(() => ({ limit: mockLimit }));
const mockIn = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ in: mockIn }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({
    auth: {
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
} from '@/src/auth/connected-agents';

describe('connected agent service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListGrants.mockResolvedValue({ data: [], error: null });
    mockReturns.mockResolvedValue({ data: [], error: null });
    mockRevokeGrant.mockResolvedValue({ data: {}, error: null });
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
    mockReturns.mockResolvedValue({
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
        scopes: ['openid'],
      },
      {
        clientId: 'client-a',
        grantedAt: '2026-07-24T12:00:00.000Z',
        lastAccessAt: '2026-07-25T13:00:00.000Z',
        name: 'Coach A',
        scopes: ['openid', 'profile'],
      },
    ]);
    expect(mockFrom).toHaveBeenCalledWith('agent_access_audit');
    expect(mockSelect).toHaveBeenCalledWith('oauth_client_id,occurred_at');
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
    mockReturns.mockResolvedValue({
      data: null,
      error: { message: 'audit temporarily unavailable' },
    });

    await expect(listConnectedAgents()).resolves.toMatchObject([
      { clientId: 'client-a', lastAccessAt: null },
    ]);
  });

  it('revokes by OAuth client identifier through the Supabase SDK', async () => {
    await revokeConnectedAgent('client-a');
    expect(mockRevokeGrant).toHaveBeenCalledWith({ clientId: 'client-a' });
  });
});
