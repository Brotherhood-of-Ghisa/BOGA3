import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';

import {
  getMobileAuthRuntimeConfig,
  getRequiredSupabaseMobileClient,
  __resetSupabaseMobileClientForTests,
} from './supabase';
import { __resetAuthStorageAdapterForTests } from './storage';
import { flushLogs, logEvent, setLoggingUserId } from '@/src/logging';
import { wipeLocalForAccountSwitch } from '@/src/sync/account-wipe';
import { clearAuthRequired } from '@/src/sync/auth-required-signal';
import { requestSync } from '@/src/sync/scheduler';
import { setAccountLocalPreferenceAccount } from '@/src/preferences/account-local';

export type AuthBootstrapStatus = 'idle' | 'restoring' | 'ready';

export type AuthSnapshot = {
  disabledReason: string | null;
  isConfigured: boolean;
  lastError: string | null;
  session: Session | null;
  status: AuthBootstrapStatus;
  user: User | null;
};

export type SignInWithPasswordCredentials = {
  email: string;
  password: string;
};

export type UpdateUserEmailInput = {
  email: string;
};

export type UpdateUserPasswordInput = {
  password: string;
};

export type UpdateUserEmailResult = {
  emailChangePending: boolean;
  user: User | null;
};

export type UpdateUserPasswordResult = {
  user: User | null;
};

type AuthStateListener = () => void;

const listeners = new Set<AuthStateListener>();

let authSnapshot: AuthSnapshot = {
  status: 'idle',
  session: null,
  user: null,
  isConfigured: getMobileAuthRuntimeConfig().isConfigured,
  disabledReason: getMobileAuthRuntimeConfig().disabledReason,
  lastError: null,
};
let authBootstrapPromise: Promise<AuthSnapshot> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

const emitAuthSnapshot = () => {
  setAccountLocalPreferenceAccount(authSnapshot.user?.id ?? null, authSnapshot.isConfigured);
  for (const listener of listeners) {
    listener();
  }
};

const setAuthSnapshot = (nextSnapshot: Partial<AuthSnapshot>) => {
  authSnapshot = {
    ...authSnapshot,
    ...nextSnapshot,
  };
  emitAuthSnapshot();
};

const createReadySnapshotFromSession = (session: Session | null): AuthSnapshot => {
  const runtimeConfig = getMobileAuthRuntimeConfig();

  const userId = session?.user?.id ?? null;

  // Mirror the signed-in user into the logging module so it can stamp `user_id`
  // and gate its Supabase flush without importing auth (the one allowed
  // direction). When a session becomes live, flush any logs buffered before the
  // session existed — including pre-login warnings/errors, which the table
  // accepts with a null `user_id` from an authenticated session.
  setLoggingUserId(userId);
  if (userId !== null) {
    void flushLogs();
  }

  return {
    status: 'ready',
    session,
    user: session?.user ?? null,
    isConfigured: runtimeConfig.isConfigured,
    disabledReason: runtimeConfig.disabledReason,
    lastError: null,
  };
};

const handleAuthStateChange = (_event: AuthChangeEvent, session: Session | null) => {
  const nextUserId = session?.user?.id ?? null;

  // A live session definitively resolves any earlier "no signed-in user" signal a
  // pre-sign-in cycle raised. Clear it here — synchronously with the session
  // becoming live, before the snapshot below is emitted — so the root stack never
  // sees the contradictory (session present + auth-required) state, which keeps
  // the user on sign-in. The sign-in handler also clears the flag, but a tick
  // later: the SIGNED_IN event re-renders the tree before that clear lands.
  if (nextUserId !== null) {
    clearAuthRequired();

    // Kick the first authenticated sync cycle now that a session is live, rather
    // than waiting for the scheduler's idle backstop. Without this the cold-launch
    // nudge fires its only cycle BEFORE sign-in (no session -> AUTH_REQUIRED) and
    // the first signed-in cycle does not run until the long backstop interval, so
    // the first-sync gate holds "Setting up your data…" for up to that interval
    // after sign-in. requestSync coalesces and is a no-op while offline, so firing
    // it on every session-live transition (sign-in, token refresh, restored
    // session) is safe and simply keeps sync prompt.
    requestSync();
  }

  // A different account than the one whose data is on the device needs no
  // handling here: the sync cycle requested above checks which account the local
  // store belongs to before it syncs, and wipes and restores it when that is not
  // the signed-in account (`ensureLocalDataOwnedBy`). That check runs under the
  // sync lock and does not depend on this process having seen the previous
  // account — a session that expired or could not be read back leaves the app
  // signed out without a sign-out, and an in-memory "last user" would miss the
  // switch.

  authSnapshot = createReadySnapshotFromSession(session);
  emitAuthSnapshot();
};

const ensureAuthSubscription = (client: SupabaseClient) => {
  if (authSubscription) {
    return;
  }

  const {
    data: { subscription },
  } = client.auth.onAuthStateChange(handleAuthStateChange);

  authSubscription = subscription;
};

const isPendingEmailChange = (user: User | null, requestedEmail: string) => {
  const normalizedRequestedEmail = requestedEmail.trim().toLowerCase();
  const currentEmail = user?.email?.trim().toLowerCase() ?? '';
  const pendingEmail = user?.new_email?.trim().toLowerCase() ?? '';

  return pendingEmail === normalizedRequestedEmail && currentEmail !== normalizedRequestedEmail;
};

export const getAuthSnapshot = () => authSnapshot;

export const subscribeToAuthState = (listener: AuthStateListener) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const bootstrapAuthState = async () => {
  const runtimeConfig = getMobileAuthRuntimeConfig();

  if (!runtimeConfig.isConfigured) {
    setLoggingUserId(null);
    authSnapshot = {
      status: 'ready',
      session: null,
      user: null,
      isConfigured: false,
      disabledReason: runtimeConfig.disabledReason,
      lastError: null,
    };
    emitAuthSnapshot();
    return authSnapshot;
  }

  if (authSnapshot.status === 'ready' && authSnapshot.isConfigured) {
    return authSnapshot;
  }

  if (!authBootstrapPromise) {
    const client = getRequiredSupabaseMobileClient();

    ensureAuthSubscription(client);
    setAuthSnapshot({
      status: 'restoring',
      isConfigured: true,
      disabledReason: null,
      lastError: null,
    });

    authBootstrapPromise = client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          setLoggingUserId(null);
          void logEvent({
            level: 'error',
            source: 'auth',
            event: 'auth.restore_failed',
            message: error.message,
          });
          setAuthSnapshot({
            status: 'ready',
            session: null,
            user: null,
            lastError: error.message,
          });
          return authSnapshot;
        }

        authSnapshot = createReadySnapshotFromSession(data.session);
        emitAuthSnapshot();
        return authSnapshot;
      })
      .finally(() => {
        authBootstrapPromise = null;
      });
  }

  return authBootstrapPromise;
};

export const clearAuthError = () => {
  if (!authSnapshot.lastError) {
    return;
  }

  setAuthSnapshot({
    lastError: null,
  });
};

export const signInWithPassword = async ({ email, password }: SignInWithPasswordCredentials) => {
  const client = getRequiredSupabaseMobileClient();

  setAuthSnapshot({
    lastError: null,
  });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    void logEvent({
      level: 'warn',
      source: 'auth',
      event: 'auth.sign_in_failed',
      message: error.message,
      context: {
        status: 'status' in error ? error.status : undefined,
        name: error.name,
      },
    });
    setAuthSnapshot({
      status: 'ready',
      session: null,
      user: null,
      lastError: error.message,
    });
    throw error;
  }

  authSnapshot = createReadySnapshotFromSession(data.session);
  emitAuthSnapshot();
  await logEvent({
    level: 'info',
    source: 'auth',
    event: 'auth.sign_in_succeeded',
    message: 'User authentication completed successfully.',
    userId: data.session?.user?.id ?? null,
  });
  return data;
};

export const signOut = async () => {
  const client = getRequiredSupabaseMobileClient();

  setAuthSnapshot({
    lastError: null,
  });

  await logEvent({
    level: 'info',
    source: 'auth',
    event: 'auth.sign_out_requested',
    message: 'User session termination was requested.',
    userId: authSnapshot.user?.id ?? null,
  });

  // Stop attributing logs to this user before the token is revoked. Between
  // `signOut()` and the final snapshot below the session is dead but the
  // account is still on screen; clearing the mirror now means a warn/error in
  // that window buffers as a pre-auth (null user) record instead of kicking a
  // flush the server will reject every interval until the snapshot lands.
  setLoggingUserId(null);

  const { error } = await client.auth.signOut();

  if (error) {
    setAuthSnapshot({
      lastError: error.message,
    });
    throw error;
  }

  // Clear the signed-out account's local rows and reset the sync accounting so
  // the previous account's data cannot leak into — or suppress the bootstrap
  // of — the next account that signs in on this device. Local only: the
  // server keeps the data for a later sign-in to restore.
  await wipeLocalForAccountSwitch();

  authSnapshot = createReadySnapshotFromSession(null);
  emitAuthSnapshot();
};

export const updateUserEmail = async ({ email }: UpdateUserEmailInput): Promise<UpdateUserEmailResult> => {
  const client = getRequiredSupabaseMobileClient();
  const trimmedEmail = email.trim();
  const { data, error } = await client.auth.updateUser({
    email: trimmedEmail,
  });

  if (error) {
    throw error;
  }

  return {
    emailChangePending: isPendingEmailChange(data.user, trimmedEmail),
    user: data.user,
  };
};

export const updateUserPassword = async ({ password }: UpdateUserPasswordInput): Promise<UpdateUserPasswordResult> => {
  const client = getRequiredSupabaseMobileClient();
  const { data, error } = await client.auth.updateUser({
    password,
  });

  if (error) {
    throw error;
  }

  return {
    user: data.user,
  };
};

export const __resetAuthForTests = () => {
  authSubscription?.unsubscribe();
  authSubscription = null;
  authBootstrapPromise = null;
  __resetSupabaseMobileClientForTests();
  __resetAuthStorageAdapterForTests();

  const runtimeConfig = getMobileAuthRuntimeConfig();

  authSnapshot = {
    status: 'idle',
    session: null,
    user: null,
    isConfigured: runtimeConfig.isConfigured,
    disabledReason: runtimeConfig.disabledReason,
    lastError: null,
  };
  listeners.clear();
};
