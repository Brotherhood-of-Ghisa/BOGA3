// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(document.body.textContent).toContain('read-only access');
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
  });
});
