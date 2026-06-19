import type { Session } from '@supabase/supabase-js';

import { selectShouldRouteToSignIn } from '@/src/sync/use-auth-required-redirect';

const fakeSession = { user: { id: 'user-1' } } as unknown as Session;

describe('selectShouldRouteToSignIn', () => {
  it('routes to sign-in when configured with no session', () => {
    expect(selectShouldRouteToSignIn({ isConfigured: true, session: null }, false)).toBe(true);
  });

  it('does not route to sign-in when a session is present and no auth-required signal', () => {
    expect(selectShouldRouteToSignIn({ isConfigured: true, session: fakeSession }, false)).toBe(false);
  });

  it('routes to sign-in when the auth-required signal is raised despite a stale session', () => {
    expect(selectShouldRouteToSignIn({ isConfigured: true, session: fakeSession }, true)).toBe(true);
  });

  it('does not route to sign-in when auth is unconfigured with no session', () => {
    expect(selectShouldRouteToSignIn({ isConfigured: false, session: null }, false)).toBe(false);
  });

  it('does not route to sign-in when auth is unconfigured even if the signal is raised', () => {
    expect(selectShouldRouteToSignIn({ isConfigured: false, session: null }, true)).toBe(false);
  });
});
