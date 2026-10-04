import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';

/**
 * The id of the account the Supabase client currently holds a session for, or
 * null when it holds none. Read from the client's persisted session — the same
 * session whose access token the sync RPCs send — so it names exactly the
 * account the next sync call acts as.
 *
 * A session that could not be refreshed comes back as an error with no session:
 * that is "signed out", so it reads as null and the sync RPCs report
 * AUTH_REQUIRED (the route to sign-in) rather than a sticky error. A storage
 * read failure (e.g. the iOS keychain while the device is locked) throws, like
 * the RPC itself would.
 */
export const getSignedInUserId = async (): Promise<string | null> => {
  const { data } = await getRequiredSupabaseMobileClient().auth.getSession();
  return data.session?.user.id ?? null;
};
