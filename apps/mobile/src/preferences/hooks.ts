import { useEffect, useSyncExternalStore } from 'react';
import { getMobileAuthRuntimeConfig } from '@/src/auth/supabase';
import {
  ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState,
  initializeAccountLocalPreferences,
  retryAccountLocalPreferences,
  setAccountLocalPreferences,
  subscribeToAccountLocalPreferences,
} from './account-local';

export const ensurePreferencesLoaded = () => {
  initializeAccountLocalPreferences(getMobileAuthRuntimeConfig().isConfigured);
  return ensureAccountLocalPreferencesLoaded();
};

export const updatePreferences: typeof setAccountLocalPreferences = patch => {
  initializeAccountLocalPreferences(getMobileAuthRuntimeConfig().isConfigured);
  setAccountLocalPreferences(patch);
};

export function useAccountLocalPreferenceState() {
  const state = useSyncExternalStore(
    subscribeToAccountLocalPreferences, getAccountLocalPreferenceState, getAccountLocalPreferenceState,
  );
  useEffect(() => { void ensurePreferencesLoaded(); }, []);
  return { ...state, retry: retryAccountLocalPreferences };
}
