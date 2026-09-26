import { useEffect, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_EXERCISE_LIST_PREFERENCES,
  type ExerciseDateFormat,
  type ExerciseListPreferences,
} from './list-model';

// Retain the key so existing Recents preferences can migrate in place.
const STORAGE_KEY = 'boga3.exerciseListPreferences.v1';
const dateFormatValues = new Set<ExerciseDateFormat>(['DD-MM-YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD']);
const listeners = new Set<() => void>();
let snapshot = DEFAULT_EXERCISE_LIST_PREFERENCES;
let didLoad = false;
let loadPromise: Promise<void> | null = null;
let pendingPatch: Partial<ExerciseListPreferences> = {};
let writeQueue = Promise.resolve();
let memoryValue: string | null = null;

const normalize = (value: Record<string, unknown>): ExerciseListPreferences => ({
  sort: value.sort === 'name' || value.sort === 'favourite'
    ? value.sort
    : value.sort === undefined && value.recentsOnTop === false ? 'name' : 'favourite',
  showNeverDone: typeof value.showNeverDone === 'boolean' ? value.showNeverDone : true,
  dateFormat: dateFormatValues.has(value.dateFormat as ExerciseDateFormat)
    ? value.dateFormat as ExerciseDateFormat
    : DEFAULT_EXERCISE_LIST_PREFERENCES.dateFormat,
});

const parsePreferences = (stored: string | null): ExerciseListPreferences => {
  try {
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? normalize(parsed as Record<string, unknown>)
      : DEFAULT_EXERCISE_LIST_PREFERENCES;
  } catch {
    return DEFAULT_EXERCISE_LIST_PREFERENCES;
  }
};

const emit = () => { for (const listener of listeners) listener(); };

const persist = () => {
  const value = JSON.stringify(snapshot);
  memoryValue = value;
  // Sequential writes prevent an older slow native save from winning a race.
  writeQueue = writeQueue.then(async () => {
    try { await SecureStore.setItemAsync(STORAGE_KEY, value); }
    catch { /* The in-memory controls remain usable when storage is unavailable. */ }
  });
};

export const getExerciseListPreferencesSnapshot = (): ExerciseListPreferences => snapshot;
export const subscribeToExerciseListPreferences = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const ensureExerciseListPreferencesLoaded = async (): Promise<void> => {
  if (didLoad) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      let stored = memoryValue;
      try { stored = await SecureStore.getItemAsync(STORAGE_KEY); }
      catch { /* Use the memory fallback. */ }
      const changedDuringLoad = Object.keys(pendingPatch).length > 0;
      snapshot = { ...parsePreferences(stored), ...pendingPatch };
      pendingPatch = {};
      didLoad = true;
      emit();
      if (changedDuringLoad) persist();
    })().finally(() => { loadPromise = null; });
  }
  await loadPromise;
};

export const setExerciseListPreferences = (patch: Partial<ExerciseListPreferences>): void => {
  snapshot = normalize({ ...snapshot, ...patch });
  emit();
  if (didLoad) persist();
  else {
    // Hydration must neither overwrite early interaction nor lose stored fields.
    for (const key of Object.keys(patch) as (keyof ExerciseListPreferences)[]) {
      pendingPatch = { ...pendingPatch, [key]: snapshot[key] };
    }
    void ensureExerciseListPreferencesLoaded();
  }
};

export const useExerciseListPreferences = (): [ExerciseListPreferences, typeof setExerciseListPreferences] => {
  const current = useSyncExternalStore(subscribeToExerciseListPreferences, getExerciseListPreferencesSnapshot, getExerciseListPreferencesSnapshot);
  useEffect(() => { void ensureExerciseListPreferencesLoaded(); }, []);
  return [current, setExerciseListPreferences];
};

export const __resetExerciseListPreferencesForTests = (): void => {
  snapshot = DEFAULT_EXERCISE_LIST_PREFERENCES;
  didLoad = false;
  loadPromise = null;
  pendingPatch = {};
  writeQueue = Promise.resolve();
  memoryValue = null;
  listeners.clear();
};
