import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';

import {
  getMobileAuthRuntimeConfig,
  getRequiredSupabaseMobileClient,
  __resetSupabaseMobileClientForTests,
} from './supabase';
import { __resetAuthStorageAdapterForTests } from './storage';
import { logEvent } from '@/src/logging';
import { wipeLocalForAccountSwitch } from '@/src/sync/account-wipe';
import { clearAuthRequired } from '@/src/sync/auth-required-signal';
import { requestSync } from '@/src/sync/scheduler';

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

// The user id of the account currently reflected in the local store, tracked
// across auth-state-change callbacks so a switch from one concrete account to a
// different one can be detected. `null` means no account is currently mapped to
// local data (signed out, or not yet signed in).
let lastKnownUserId: string | null = null;

const emitAuthSnapshot = () => {
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

  // Keep the tracked account id in step with every ready snapshot so the
  // account-switch detection in `handleAuthStateChange` always compares
  // against the account currently mapped to local data, regardless of which
  // entry point (restore, sign-in, sign-out, state-change) produced it.
  lastKnownUserId = session?.user?.id ?? null;

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
  const previousUserId = lastKnownUserId;

  // A live session definitively resolves any earlier "no signed-in user" signal a
  // pre-sign-in cycle raised. Clear it here — synchronously with the session
  // becoming live, before the snapshot below is emitted — so the route guard
  // never observes the contradictory (session present + auth-required) state.
  // That state pits two redirects against each other (the sign-in screen leaves
  // on a live session; the guard returns to it while auth-required is set) and
  // spins React into a "Maximum update depth exceeded" loop. The sign-in handler
  // also clears the flag, but it runs a tick too late: the SIGNED_IN event
  // re-renders the tree before that clear lands, so the loop has already started.
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

  // Account switch: a different concrete account is now signed in than the one
  // whose data is in the local store. Clear the previous account's local rows
  // and reset the sync accounting so the bootstrapper restores the new
  // account's data on the next cycle. (Sign-out — next id null — is handled by
  // `signOut`, which wipes before tearing down the session; we skip it here to
  // avoid wiping twice and to keep the wipe on the awaited sign-out path.)
  const isAccountSwitch =
    previousUserId !== null && nextUserId !== null && previousUserId !== nextUserId;

  if (isAccountSwitch) {
    void wipeLocalForAccountSwitch().catch((error: unknown) => {
      void logEvent({
        level: 'error',
        source: 'auth',
        event: 'auth.account_switch_wipe_failed',
        message: error instanceof Error ? error.message : 'Local data wipe failed on account switch.',
        userId: nextUserId,
      });
    });
  }

  // `createReadySnapshotFromSession` advances the tracked account id to
  // `nextUserId`.
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
  lastKnownUserId = null;
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
