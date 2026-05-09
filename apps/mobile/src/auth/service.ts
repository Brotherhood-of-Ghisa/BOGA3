import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';

import {
  getMobileAuthRuntimeConfig,
  getRequiredSupabaseMobileClient,
  __resetSupabaseMobileClientForTests,
} from './supabase';
import { __resetAuthStorageAdapterForTests } from './storage';
import { logEvent } from '@/src/logging';

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
