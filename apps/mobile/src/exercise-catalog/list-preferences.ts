import {
  __resetAccountLocalPreferencesForTests,
  getAccountLocalPreferenceState,
  subscribeToAccountLocalPreferences,
} from '@/src/preferences/account-local';
import { ensurePreferencesLoaded, updatePreferences, useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import {
  type AccountLocalPreferences,
  browsingPreferenceFields,
  DEFAULT_EXERCISE_LIST_PREFERENCES,
  type ExerciseListPreferences,
} from '@/src/preferences/model';

// Preserve the browsing API while callers share the account-local typed store.
// One object while the browsing fields are unchanged, so list models keyed on
// it do not rebuild when another preference changes.
let browsingSnapshot = DEFAULT_EXERCISE_LIST_PREFERENCES;
const selectBrowsingPreferences = (current: AccountLocalPreferences): ExerciseListPreferences => {
  if (browsingPreferenceFields.some(field => browsingSnapshot[field] !== current[field])) {
    browsingSnapshot = { sort: current.sort, showNeverDone: current.showNeverDone,
      dateFormat: current.dateFormat, pastRecordsGymScope: current.pastRecordsGymScope };
  }
  return browsingSnapshot;
};
export const getExerciseListPreferencesSnapshot = (): ExerciseListPreferences =>
  selectBrowsingPreferences(getAccountLocalPreferenceState().values);
export const subscribeToExerciseListPreferences = subscribeToAccountLocalPreferences;
export const ensureExerciseListPreferencesLoaded = ensurePreferencesLoaded;
export const setExerciseListPreferences = (patch: Partial<ExerciseListPreferences>) => updatePreferences(patch);
export const __resetExerciseListPreferencesForTests = __resetAccountLocalPreferencesForTests;

// Derive the values from the subscribed state, never from a module getter: the
// React Compiler caches a call with no reactive input for the component's
// lifetime, so a getter read here froze every mounted browser on its first
// value (Sort and Show never-done did nothing until a remount).
export function useExerciseListPreferenceState() {
  const state = useAccountLocalPreferenceState();
  return { ...state, values: selectBrowsingPreferences(state.values) };
}

export function useExerciseListPreferences(): [ReturnType<typeof getExerciseListPreferencesSnapshot>, typeof setExerciseListPreferences] {
  return [useExerciseListPreferenceState().values, setExerciseListPreferences];
}
