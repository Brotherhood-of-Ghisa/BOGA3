import { useEffect, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * The redesigned exercise page and session view, built as new routes beside the
 * existing recorder (docs/plans/exercise-session-redesign.md, rule 3). A user
 * setting rather than `isDevMode()`, so it works on the real build. Device-local,
 * never synced. On by default since step 6a; a stored choice, including an
 * explicit Off, wins over the default. Deleted with the old recorder (step 6b).
 */
const STORAGE_KEY = 'boga3.newExerciseSessionScreens.v1';

export const DEFAULT_NEW_SCREENS_ENABLED = true;

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot = DEFAULT_NEW_SCREENS_ENABLED;
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

const parseEnabled = (stored: string | null): boolean => {
  if (!stored) return DEFAULT_NEW_SCREENS_ENABLED;
  try {
    const parsed = JSON.parse(stored) as { enabled?: unknown } | null;
    return typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_NEW_SCREENS_ENABLED;
  } catch {
    return DEFAULT_NEW_SCREENS_ENABLED;
  }
};

export const getNewScreensEnabledSnapshot = (): boolean => snapshot;

export const subscribeToNewScreensEnabled = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const ensureNewScreensEnabledLoaded = async (): Promise<void> => {
  if (didLoad) return;
  if (!loadPromise) {
    loadPromise = readStoredValue()
      .then((stored) => {
        // An explicit set while the read was in flight wins over the stored value.
        if (didLoad) return;
        snapshot = parseEnabled(stored);
        didLoad = true;
        emit();
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  await loadPromise;
};

/**
 * Sets the preference and resolves once it is persisted. Marks the store loaded,
 * so a later lazy load cannot overwrite an explicit choice with the stored value.
 */
export const setNewScreensEnabled = (enabled: boolean): Promise<void> => {
  snapshot = enabled;
  didLoad = true;
  emit();
  return writeStoredValue(JSON.stringify({ enabled }));
};

const setNewScreensEnabledFromUi = (enabled: boolean): void => {
  void setNewScreensEnabled(enabled);
};

export const useNewScreensEnabled = (): [boolean, (enabled: boolean) => void] => {
  const current = useSyncExternalStore(
    subscribeToNewScreensEnabled,
    getNewScreensEnabledSnapshot,
    getNewScreensEnabledSnapshot
  );

  useEffect(() => {
    void ensureNewScreensEnabledLoaded();
  }, []);

  return [current, setNewScreensEnabledFromUi];
};

export const __resetNewScreensPreferenceForTests = (): void => {
  snapshot = DEFAULT_NEW_SCREENS_ENABLED;
  didLoad = false;
  loadPromise = null;
  memoryStore.clear();
  listeners.clear();
};
