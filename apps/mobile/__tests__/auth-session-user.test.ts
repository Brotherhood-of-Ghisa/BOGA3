/**
 * `getSignedInUserId` names the account the sync cycle is about to act as, from
 * the Supabase client's persisted session. jest.setup.ts mocks the module for
 * every other suite; this one exercises the real implementation.
 */

const mockGetSession = jest.fn();

jest.mock('@/src/auth/supabase', () => ({
  getRequiredSupabaseMobileClient: () => ({ auth: { getSession: mockGetSession } }),
}));

const { getSignedInUserId } = jest.requireActual<typeof import('@/src/auth/session-user')>(
  '@/src/auth/session-user',
);

describe('getSignedInUserId', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  it("returns the session's user id", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });

    await expect(getSignedInUserId()).resolves.toBe('user-1');
  });

  it('returns null without a session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getSignedInUserId()).resolves.toBeNull();
  });

  it('reads a session that could not be refreshed as signed out, so the RPCs report AUTH_REQUIRED', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error('Invalid Refresh Token') });

    await expect(getSignedInUserId()).resolves.toBeNull();
  });

  it('throws when the session storage cannot be read (e.g. a locked keychain)', async () => {
    const error = new Error('User interaction is not allowed.');
    mockGetSession.mockRejectedValue(error);

    await expect(getSignedInUserId()).rejects.toBe(error);
  });
});
