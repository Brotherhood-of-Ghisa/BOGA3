import {
  __resetAccountLocalPreferencesForTests,
  getAccountLocalPreferenceState,
  subscribeToAccountLocalPreferences,
} from '@/src/preferences/account-local';
import { ensurePreferencesLoaded, updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { browsingPreferenceFields, DEFAULT_EXERCISE_LIST_PREFERENCES, type ExerciseListPreferences } from '@/src/preferences/model';

// Preserve the browsing API while callers share the account-local typed store.
let browsingSnapshot = DEFAULT_EXERCISE_LIST_PREFERENCES;
export const getExerciseListPreferencesSnapshot = (): ExerciseListPreferences => {
  const current = getAccountLocalPreferenceState().values;
  if (browsingPreferenceFields.some(field => browsingSnapshot[field] !== current[field])) {
    browsingSnapshot = { sort: current.sort, showNeverDone: current.showNeverDone,
      dateFormat: current.dateFormat, pastRecordsGymScope: current.pastRecordsGymScope };
  }
  return browsingSnapshot;
};
export const subscribeToExerciseListPreferences = subscribeToAccountLocalPreferences;
export const ensureExerciseListPreferencesLoaded = ensurePreferencesLoaded;
export const setExerciseListPreferences = (patch: Partial<ExerciseListPreferences>) => updatePreferences(patch);
export const __resetExerciseListPreferencesForTests = __resetAccountLocalPreferencesForTests;

export function useExerciseListPreferenceState() {
  return { ...useAccountLocalPreferenceState(), values: getExerciseListPreferencesSnapshot() };
}

export function useExerciseListPreferences(): [ReturnType<typeof getExerciseListPreferencesSnapshot>, typeof setExerciseListPreferences] {
  return [useExerciseListPreferenceState().values, setExerciseListPreferences];
}
