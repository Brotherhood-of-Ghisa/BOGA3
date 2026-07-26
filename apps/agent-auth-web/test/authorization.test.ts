import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  BOGA_OAUTH_SCOPES,
  OAUTH_SCOPE_DISCLOSURES,
  authorizationIdFrom,
  decideAuthorization,
  loadConsentState,
} from '../src/authorization.ts';

const oauthClient = (overrides: Record<string, unknown> = {}) =>
  ({
    auth: {
      oauth: {
        approveAuthorization: vi.fn(),
        denyAuthorization: vi.fn(),
        getAuthorizationDetails: vi.fn(),
        ...overrides,
      },
    },
  }) as unknown as SupabaseClient;

describe('agent authorization consent model', () => {
  it('requires a bounded authorization identifier', () => {
    expect(() => authorizationIdFrom(new URL('https://auth.example.test/oauth/consent')))
      .toThrow('missing or invalid');
    expect(
      authorizationIdFrom(
        new URL('https://auth.example.test/oauth/consent?authorization_id=valid_request_12345'),
      ),
    ).toBe('valid_request_12345');
  });

  it('returns only client and requested-scope consent details', async () => {
    const client = oauthClient({
      getAuthorizationDetails: vi.fn().mockResolvedValue({
        data: {
          authorization_id: 'valid_request_12345',
          client: { id: 'client-a', name: 'Coach Agent' },
          redirect_uri: 'https://client.example.test/callback',
          scope: 'openid profile',
          user: { email: 'private@example.test', id: 'user-a' },
        },
        error: null,
      }),
    });

    await expect(loadConsentState(client, 'valid_request_12345')).resolves.toEqual({
      details: {
        authorizationId: 'valid_request_12345',
        clientId: 'client-a',
        clientName: 'Coach Agent',
        scopes: ['openid', 'profile'],
      },
      kind: 'consent',
    });
  });

  it('has a user-facing disclosure for every accepted identity scope', () => {
    expect(Object.keys(OAUTH_SCOPE_DISCLOSURES)).toEqual([...BOGA_OAUTH_SCOPES]);
    expect(OAUTH_SCOPE_DISCLOSURES.openid).toContain('OpenID ID token');
    expect(OAUTH_SCOPE_DISCLOSURES.profile).toContain('name and profile picture');
    expect(OAUTH_SCOPE_DISCLOSURES.email).toContain('email address');
    expect(OAUTH_SCOPE_DISCLOSURES.phone).toContain('phone number');
  });

  it('accepts all identity scopes advertised by Supabase', async () => {
    const client = oauthClient({
      getAuthorizationDetails: vi.fn().mockResolvedValue({
        data: {
          authorization_id: 'valid_request_12345',
          client: { id: 'client-a', name: 'Coach Agent' },
          redirect_uri: 'https://client.example.test/callback',
          scope: 'openid profile email phone',
        },
        error: null,
      }),
    });

    await expect(loadConsentState(client, 'valid_request_12345')).resolves.toMatchObject({
      details: {
        scopes: ['openid', 'profile', 'email', 'phone'],
      },
      kind: 'consent',
    });
  });

  it('rejects unknown or additional identity scopes before approval', async () => {
    const client = oauthClient({
      getAuthorizationDetails: vi.fn().mockResolvedValue({
        data: {
          authorization_id: 'valid_request_12345',
          client: { id: 'client-a', name: 'Coach Agent' },
          redirect_uri: 'https://client.example.test/callback',
          scope: 'openid profile offline_access',
        },
        error: null,
      }),
    });

    await expect(loadConsentState(client, 'valid_request_12345')).rejects.toThrow(
      'unsupported identity permissions',
    );
  });

  it('uses the Supabase SDK for approval and returns its validated redirect', async () => {
    const approveAuthorization = vi.fn().mockResolvedValue({
      data: { redirect_url: 'https://client.example.test/callback?code=abc' },
      error: null,
    });
    const client = oauthClient({ approveAuthorization });

    await expect(
      decideAuthorization(client, 'valid_request_12345', 'approve'),
    ).resolves.toBe('https://client.example.test/callback?code=abc');
    expect(approveAuthorization).toHaveBeenCalledWith('valid_request_12345', {
      skipBrowserRedirect: true,
    });
  });
});
