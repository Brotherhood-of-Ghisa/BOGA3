import { useEffect, useSyncExternalStore } from 'react';
import {
  readBodyweightCalculationsEnabled,
  writeBodyweightCalculationsEnabled,
} from '@/src/data/user-settings';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';

import { invalidateBodyWeightContext } from './invalidation';

let enabled = false;
let persistedEnabled = false;
let writeError: string | null = null;
let loaded = false;
let loadPromise: Promise<void> | null = null;
let writeQueue = Promise.resolve();
let mutationVersion = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const invalidateCalculatedViews = () => {
  invalidateExerciseCatalogCache();
  invalidateBodyWeightContext();
};

export const getBodyweightCalculationsEnabled = () => enabled;
export const getBodyweightCalculationPreferenceError = () => writeError;

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
        storedEnabled = await readBodyweightCalculationsEnabled();
      } catch {
        storedEnabled = false;
      }
      if (mutationVersion === versionAtStart) enabled = storedEnabled;
      persistedEnabled = storedEnabled;
      loaded = true;
      emit();
    })().finally(() => { loadPromise = null; });
  }
  await loadPromise;
};

export const setBodyweightCalculationsEnabled = (next: boolean): Promise<void> => {
  mutationVersion += 1;
  const version = mutationVersion;
  enabled = next;
  writeError = null;
  loaded = true;
  emit();
  // Publish the policy change immediately. Repository-backed consumers also
  // receive the post-commit invalidation below, so a read that races the local
  // write is deterministically replaced by one using the stored value.
  invalidateCalculatedViews();
  const operation = writeQueue.then(async () => {
    try {
      await writeBodyweightCalculationsEnabled(next);
      if (mutationVersion === version) {
        persistedEnabled = next;
        invalidateCalculatedViews();
      }
    } catch {
      if (mutationVersion !== version) return;
      enabled = persistedEnabled;
      writeError = 'Bodyweight calculations could not be updated. Try again.';
      loaded = true;
      emit();
      invalidateCalculatedViews();
    }
  });
  writeQueue = operation;
  return operation;
};

/** Sync calls this after applying a settings row so mounted consumers refresh. */
export const refreshBodyweightCalculationPreference = async (): Promise<void> => {
  const versionAtStart = mutationVersion;
  const storedEnabled = await readBodyweightCalculationsEnabled();
  if (versionAtStart !== mutationVersion) return;
  enabled = storedEnabled;
  persistedEnabled = storedEnabled;
  writeError = null;
  loaded = true;
  emit();
  invalidateCalculatedViews();
};

/** Drain any current write, then forget the previous account's local state. */
export const resetBodyweightCalculationPreferenceForAccountSwitch = async (): Promise<void> => {
  await writeQueue;
  if (loadPromise) await loadPromise;
  mutationVersion += 1;
  enabled = false;
  persistedEnabled = false;
  writeError = null;
  loaded = false;
  loadPromise = null;
  writeQueue = Promise.resolve();
  emit();
  invalidateCalculatedViews();
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

export const useBodyweightCalculationPreferenceError = (): string | null => {
  const value = useSyncExternalStore(
    subscribeToBodyweightCalculations,
    getBodyweightCalculationPreferenceError,
    getBodyweightCalculationPreferenceError,
  );
  useEffect(() => { void ensureBodyweightCalculationPreferenceLoaded(); }, []);
  return value;
};

export const __resetBodyweightCalculationPreferenceForTests = (): void => {
  enabled = false;
  persistedEnabled = false;
  writeError = null;
  loaded = false;
  loadPromise = null;
  writeQueue = Promise.resolve();
  mutationVersion = 0;
  listeners.clear();
};
