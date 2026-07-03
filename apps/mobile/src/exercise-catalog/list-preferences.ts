import { useEffect, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_EXERCISE_LIST_PREFERENCES,
  EXERCISE_LIST_DATE_RANGE_OPTIONS,
  type ExerciseDateFormat,
  type ExerciseListDateRange,
  type ExerciseListPreferences,
} from './list-model';

const STORAGE_KEY = 'boga3.exerciseListPreferences.v1';

type Listener = () => void;

const dateRangeValues = new Set<ExerciseListDateRange>(
  EXERCISE_LIST_DATE_RANGE_OPTIONS.map((option) => option.value)
);

const listeners = new Set<Listener>();
let snapshot: ExerciseListPreferences = DEFAULT_EXERCISE_LIST_PREFERENCES;
let didLoad = false;
let loadPromise: Promise<void> | null = null;
const memoryStore = new Map<string, string>();

const shouldUseMemoryStore = () => process.env.NODE_ENV === 'test';

const readStoredValue = async (): Promise<string | null> => {
  if (shouldUseMemoryStore()) return memoryStore.get(STORAGE_KEY) ?? null;
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return memoryStore.get(STORAGE_KEY) ?? null;
  }
};

const writeStoredValue = async (value: string): Promise<void> => {
  memoryStore.set(STORAGE_KEY, value);
  if (shouldUseMemoryStore()) return;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, value);
  } catch {
    // Keep the in-memory snapshot usable even if the device preference store is unavailable.
  }
};

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const normalizeDateRange = (value: unknown): ExerciseListDateRange =>
  dateRangeValues.has(value as ExerciseListDateRange)
    ? (value as ExerciseListDateRange)
    : DEFAULT_EXERCISE_LIST_PREFERENCES.dateRange;

const normalizeDateFormat = (value: unknown): ExerciseDateFormat =>
  value === 'DD-MM-YYYY' || value === 'MM-DD-YYYY' || value === 'YYYY-MM-DD'
    ? (value as ExerciseDateFormat)
    : DEFAULT_EXERCISE_LIST_PREFERENCES.dateFormat;

const parsePreferences = (stored: string | null): ExerciseListPreferences => {
  if (!stored) return DEFAULT_EXERCISE_LIST_PREFERENCES;
  try {
    const parsed = JSON.parse(stored) as Partial<ExerciseListPreferences>;
    return {
      groupByMuscleFamily:
        typeof parsed.groupByMuscleFamily === 'boolean'
          ? parsed.groupByMuscleFamily
          : DEFAULT_EXERCISE_LIST_PREFERENCES.groupByMuscleFamily,
      dateRange: normalizeDateRange(parsed.dateRange),
      recentsOnTop:
        typeof parsed.recentsOnTop === 'boolean'
          ? parsed.recentsOnTop
          : DEFAULT_EXERCISE_LIST_PREFERENCES.recentsOnTop,
      dateFormat: normalizeDateFormat(parsed.dateFormat),
    };
  } catch {
    return DEFAULT_EXERCISE_LIST_PREFERENCES;
  }
};

export const getExerciseListPreferencesSnapshot = (): ExerciseListPreferences => snapshot;

export const subscribeToExerciseListPreferences = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const ensureExerciseListPreferencesLoaded = async (): Promise<void> => {
  if (didLoad) return;
  if (!loadPromise) {
    loadPromise = readStoredValue()
      .then((stored) => {
        snapshot = parsePreferences(stored);
        didLoad = true;
        emit();
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  await loadPromise;
};

export const setExerciseListPreferences = (
  patch: Partial<ExerciseListPreferences>
): void => {
  snapshot = {
    ...snapshot,
    ...patch,
    dateRange: patch.dateRange === undefined ? snapshot.dateRange : normalizeDateRange(patch.dateRange),
    dateFormat: patch.dateFormat === undefined ? snapshot.dateFormat : normalizeDateFormat(patch.dateFormat),
  };
  emit();
  void writeStoredValue(JSON.stringify(snapshot));
};

export const useExerciseListPreferences = (): [
  ExerciseListPreferences,
  (patch: Partial<ExerciseListPreferences>) => void,
] => {
  const current = useSyncExternalStore(
    subscribeToExerciseListPreferences,
    getExerciseListPreferencesSnapshot,
    getExerciseListPreferencesSnapshot
  );

  useEffect(() => {
    void ensureExerciseListPreferencesLoaded();
  }, []);

  return [current, setExerciseListPreferences];
};

export const __resetExerciseListPreferencesForTests = (): void => {
  snapshot = DEFAULT_EXERCISE_LIST_PREFERENCES;
  didLoad = false;
  loadPromise = null;
  memoryStore.clear();
  listeners.clear();
};
