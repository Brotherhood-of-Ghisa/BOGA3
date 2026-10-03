import { useEffect, useSyncExternalStore } from 'react';
import { getMobileAuthRuntimeConfig } from '@/src/auth/supabase';
import {
  __resetAccountLocalPreferencesForTests,
  ensureAccountLocalPreferencesLoaded,
  getAccountLocalPreferenceState,
  initializeAccountLocalPreferences,
  retryAccountLocalPreferences,
  setAccountLocalPreferences,
  subscribeToAccountLocalPreferences,
} from '@/src/preferences/account-local';

// Preserve the browsing API while callers share the account-local typed store.
export const getExerciseListPreferencesSnapshot = () => getAccountLocalPreferenceState().values;
export const subscribeToExerciseListPreferences = subscribeToAccountLocalPreferences;
export const ensureExerciseListPreferencesLoaded = () => {
  initializeAccountLocalPreferences(getMobileAuthRuntimeConfig().isConfigured);
  return ensureAccountLocalPreferencesLoaded();
};
export const setExerciseListPreferences: typeof setAccountLocalPreferences = patch => {
  initializeAccountLocalPreferences(getMobileAuthRuntimeConfig().isConfigured);
  setAccountLocalPreferences(patch);
};
export const __resetExerciseListPreferencesForTests = __resetAccountLocalPreferencesForTests;

export function useExerciseListPreferenceState() {
  const state = useSyncExternalStore(
    subscribeToAccountLocalPreferences, getAccountLocalPreferenceState, getAccountLocalPreferenceState,
  );
  useEffect(() => { void ensureExerciseListPreferencesLoaded(); }, []);
  return { ...state, retry: retryAccountLocalPreferences };
}

export function useExerciseListPreferences(): [ReturnType<typeof getExerciseListPreferencesSnapshot>, typeof setExerciseListPreferences] {
  return [useExerciseListPreferenceState().values, setExerciseListPreferences];
}
