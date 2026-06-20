import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getAuthStorageKey } from '@/src/utils/app-flavor';

import { getAuthStorageAdapter } from './storage';

export type MobileAuthRuntimeConfig = {
  anonKey: string | null;
  disabledReason: string | null;
  isConfigured: boolean;
  url: string | null;
};

const resolveMissingEnvNames = () => {
  const missingEnvNames: string[] = [];

  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
    missingEnvNames.push('EXPO_PUBLIC_SUPABASE_URL');
  }

  if (!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    missingEnvNames.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }

  return missingEnvNames;
};

const createRuntimeConfig = (): MobileAuthRuntimeConfig => {
  const missingEnvNames = resolveMissingEnvNames();

  if (missingEnvNames.length > 0) {
    return {
      url: null,
      anonKey: null,
      isConfigured: false,
      disabledReason: `Supabase mobile auth is not configured. Missing ${missingEnvNames.join(', ')}.`,
    };
  }

  return {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? null,
    isConfigured: true,
    disabledReason: null,
  };
};

let runtimeConfig: MobileAuthRuntimeConfig | null = null;
let supabaseClient: SupabaseClient | null = null;

export const getMobileAuthRuntimeConfig = () => {
  if (runtimeConfig) {
    return runtimeConfig;
  }

  runtimeConfig = createRuntimeConfig();
  return runtimeConfig;
};

export const getSupabaseMobileClient = () => {
  if (supabaseClient) {
    return supabaseClient;
  }

  const config = getMobileAuthRuntimeConfig();

  if (!config.isConfigured || !config.url || !config.anonKey) {
    return null;
  }

  supabaseClient = createClient(config.url, config.anonKey, {
    auth: {
      storage: getAuthStorageAdapter(),
      // Pin the session storage key to the deployment flavor instead of letting
      // supabase-js derive it from the URL (`sb-<hostname-label>-auth-token`),
      // so the session survives backend-URL changes (localhost ↔ LAN ↔ tailnet)
      // while staying isolated per Preview / Full / local build.
      storageKey: getAuthStorageKey(),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return supabaseClient;
};

export const getRequiredSupabaseMobileClient = () => {
  const config = getMobileAuthRuntimeConfig();

  if (!config.isConfigured) {
    throw new Error(config.disabledReason ?? 'Supabase mobile auth is not configured.');
  }

  const client = getSupabaseMobileClient();

  if (!client) {
    throw new Error('Supabase mobile auth client could not be created.');
  }

  return client;
};

export const __resetSupabaseMobileClientForTests = () => {
  runtimeConfig = null;
  supabaseClient = null;
};
