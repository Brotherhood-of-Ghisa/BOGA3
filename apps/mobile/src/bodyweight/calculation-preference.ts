import { useEffect, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'boga3.bodyweightCalculations.v1';

let enabled = false;
let loaded = false;
let loadPromise: Promise<void> | null = null;
let writeQueue = Promise.resolve();
let mutationVersion = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const getBodyweightCalculationsEnabled = () => enabled;

export const subscribeToBodyweightCalculations = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const ensureBodyweightCalculationPreferenceLoaded = async (): Promise<void> => {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      const versionAtStart = mutationVersion;
      let storedEnabled = false;
      try {
        storedEnabled = (await SecureStore.getItemAsync(STORAGE_KEY)) === 'true';
      } catch {
        storedEnabled = false;
      }
      if (mutationVersion === versionAtStart) enabled = storedEnabled;
      loaded = true;
      emit();
    })().finally(() => { loadPromise = null; });
  }
  await loadPromise;
};

export const setBodyweightCalculationsEnabled = (next: boolean): void => {
  mutationVersion += 1;
  enabled = next;
  loaded = true;
  emit();
  writeQueue = writeQueue.then(async () => {
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, String(next));
    } catch {
      // Keep the current session usable if native storage is temporarily unavailable.
    }
  });
};

export const useBodyweightCalculationsEnabled = (): boolean => {
  const value = useSyncExternalStore(
    subscribeToBodyweightCalculations,
    getBodyweightCalculationsEnabled,
    getBodyweightCalculationsEnabled,
  );
  useEffect(() => { void ensureBodyweightCalculationPreferenceLoaded(); }, []);
  return value;
};

export const __resetBodyweightCalculationPreferenceForTests = (): void => {
  enabled = false;
  loaded = false;
  loadPromise = null;
  writeQueue = Promise.resolve();
  mutationVersion = 0;
  listeners.clear();
};
