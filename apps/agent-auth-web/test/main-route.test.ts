// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOGA_OAUTH_SCOPES, OAUTH_SCOPE_DISCLOSURES } from '../src/authorization.ts';

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

describe('agent authorization web rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    document.body.innerHTML = '<main id="app"></main>';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders public setup without creating a Supabase client or asking for a password', async () => {
    window.history.replaceState({}, '', '/connect');

    await import('../src/main.ts');

    await vi.waitFor(() => {
      expect(document.querySelector('h1')?.textContent).toBe('Connect BoGa to your AI coach');
    });
    expect(document.body.textContent).toContain('https://boga3.onrender.com/mcp');
    expect(document.body.textContent).toContain('with your permission, make changes');
    expect(document.body.textContent).toContain('Connecting enables reading.');
    expect(document.body.textContent).not.toContain('read-only');
    expect(document.body.textContent).toContain('Settings → Connected agents');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('keeps a missing consent request in the fail-closed error state', async () => {
    window.history.replaceState({}, '', '/oauth/consent');

    await import('../src/main.ts');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('missing or invalid');
    });
    expect(document.querySelector('#sign-in-form')).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('preserves the valid consent entry and signed-out sign-in state', async () => {
    window.history.replaceState(
      {},
      '',
      '/oauth/consent?authorization_id=valid_request_12345',
    );
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.example.test');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    createClientMock.mockReturnValue({ auth: { getSession } });

    await import('../src/main.ts');

    await vi.waitFor(() => {
      expect(document.querySelector('#sign-in-form')).not.toBeNull();
    });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('optional write permissions');
    expect(document.body.textContent).not.toContain('read-only');
  });

  const renderSignedInConsent = async () => {
    window.history.replaceState({}, '', '/oauth/consent?authorization_id=valid_request_12345');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.example.test');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    const oauth = {
      getAuthorizationDetails: vi.fn().mockResolvedValue({
        data: {
          authorization_id: 'valid_request_12345',
          client: { id: 'coach-client', name: 'Test coach' },
          scope: BOGA_OAUTH_SCOPES.join(' '),
        },
        error: null,
      }),
      approveAuthorization: vi.fn().mockResolvedValue({ error: new Error('Connection request expired.') }),
      denyAuthorization: vi.fn().mockResolvedValue({ error: new Error('Connection request expired.') }),
    };
    createClientMock.mockReturnValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: {} }, error: null }), oauth },
    });

    await import('../src/main.ts');
    await vi.waitFor(() => {
      expect(document.querySelector('#approve-button')?.textContent).toBe('Connect coach');
    });
    return oauth;
  };

  it('discloses read capabilities and separately enabled writes before connecting a coach', async () => {
    await renderSignedInConsent();

    expect(document.querySelector('h1')?.textContent).toBe('Connect Test coach to BoGa?');
    expect(document.querySelector('.lede')?.textContent).toBe(
      'Give this coach access to your training data to help you plan and track your workouts.',
    );
    const lists = document.querySelectorAll('.permission-panel ul');
    expect(Array.from(lists[0].children, item => item.textContent)).toEqual([
      'Your training setup, gyms and equipment',
      'Your exercise library, workout history and personal records',
      'Your training notes and imported health activities',
    ]);
    expect(Array.from(lists[1].children, item => item.textContent)).toEqual([
      'Create training plans and programmes',
      'Manage exercises, muscle targets and training notes',
      'Start, log and update workouts',
    ]);
    expect(document.querySelector('.denied-panel p')?.textContent).toBe(
      'You control write access. Connecting enables reading. To allow changes, enable the permissions you want in BoGa → Settings → Connected agents.',
    );
    expect(document.querySelector('.security-note')?.textContent).toBe(
      'Your password is never shared with the coach. You can change permissions or revoke access at any time from Connected agents.',
    );
    expect(document.body.textContent).not.toContain('read-only');
  });

  it('keeps every requested identity permission visible alongside the training-access disclosure', async () => {
    await renderSignedInConsent();

    const identityList = document.querySelectorAll('.permission-panel ul')[2];
    expect(Array.from(identityList.children, item => item.textContent)).toEqual(
      BOGA_OAUTH_SCOPES.map(scope => `${scope} — ${OAUTH_SCOPE_DISCLOSURES[scope]}`),
    );
  });

  it.each([
    ['approve-button', 'approveAuthorization', 'denyAuthorization'],
    ['deny-button', 'denyAuthorization', 'approveAuthorization'],
  ] as const)('keeps %s wired to its existing OAuth decision and error handling', async (id, operation, other) => {
    const oauth = await renderSignedInConsent();

    document.querySelector<HTMLButtonElement>(`#${id}`)?.click();

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Connection request expired.');
    });
    expect(oauth[operation]).toHaveBeenCalledWith('valid_request_12345', { skipBrowserRedirect: true });
    expect(oauth[other]).not.toHaveBeenCalled();
  });
});
