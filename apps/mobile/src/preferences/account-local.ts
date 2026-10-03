import { __resetPreferenceMigrationForTests, migrateBrowsingPreferences } from './migration';
import {
  type AccountLocalPreferences,
  DEFAULT_EXERCISE_LIST_PREFERENCES,
  isPreferenceValue,
  preferenceFields,
} from './model';
import { type PreferenceProfile, readScopedPreferences, writeScopedPreference } from './storage';

export type AccountLocalPreferenceState = {
  values: AccountLocalPreferences;
  pending: Partial<AccountLocalPreferences>;
  error: string | null;
};
const emptyState = (): AccountLocalPreferenceState => ({
  values: DEFAULT_EXERCISE_LIST_PREFERENCES, pending: {}, error: null,
});
let state = emptyState();
let loadError: string | null = null;
let saveError: string | null = null;
let profile: PreferenceProfile | null | undefined;
let generation = 0;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const publish = (next: Partial<AccountLocalPreferenceState>) => {
  const values = next.values && preferenceFields.some(field => next.values![field] !== state.values[field])
    ? next.values : state.values;
  const updated = { ...state, ...next, values };
  if (updated.values === state.values && updated.pending === state.pending && updated.error === state.error) return;
  state = updated;
  for (const listener of listeners) listener();
};
export function initializeAccountLocalPreferences(isConfigured: boolean): void {
  if (profile === undefined) profile = isConfigured ? null : 'local';
}
const currentProfile = () => profile ?? null;

export const getAccountLocalPreferenceState = () => state;
export const subscribeToAccountLocalPreferences = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Auth publishes the scope before its listeners see the new session. */
export function setAccountLocalPreferenceAccount(userId: string | null, isConfigured: boolean): void {
  const next: PreferenceProfile | null = isConfigured ? userId === null ? null : `account:${userId}` : 'local';
  if (next === profile) return;
  profile = next;
  loadError = null;
  saveError = null;
  generation += 1;
  loaded = false;
  loading = null;
  publish(emptyState());
  void ensureAccountLocalPreferencesLoaded();
}

function loadScoped(profileAtStart: PreferenceProfile): boolean {
  try {
    const { values } = readScopedPreferences(profileAtStart);
    loaded = true;
    loadError = null;
    publish({ values, error: saveError });
    return true;
  } catch {
    loadError = 'Preferences could not be loaded. Try again.';
    publish({ error: saveError ?? loadError });
    return false;
  }
}

export async function ensureAccountLocalPreferencesLoaded(): Promise<void> {
  const capturedProfile = currentProfile();
  if (capturedProfile === null) return;
  if (loading) return loading;
  if (!loaded && !loadScoped(capturedProfile)) return;
  const capturedGeneration = generation;
  const operation = (async () => {
    try {
      await migrateBrowsingPreferences(capturedProfile);
      if (capturedGeneration !== generation) return;
      const { values } = readScopedPreferences(capturedProfile);
      loadError = null;
      publish({ values, error: saveError });
    } catch {
      if (capturedGeneration !== generation) return;
      // A scalar may have committed before a later migration write failed.
      // Publish only what can be read back, keeping migration retryable.
      try { publish({ values: readScopedPreferences(capturedProfile).values }); }
      catch { /* Keep the last successfully read durable snapshot. */ }
      loadError = 'Preferences could not be loaded. Try again.';
      publish({ error: saveError ?? loadError });
    }
  })();
  loading = operation;
  await operation;
  if (capturedGeneration === generation) loading = null;
}

export function setAccountLocalPreferences(patch: Partial<AccountLocalPreferences>): void {
  const activeProfile = currentProfile();
  if (activeProfile === null) return;
  const pending = { ...state.pending };
  for (const field of preferenceFields) {
    if (isPreferenceValue(field, patch[field])) Object.assign(pending, { [field]: patch[field] });
  }
  if (!loaded && !loadScoped(activeProfile)) {
    publish({ pending });
    return;
  }
  const values = { ...state.values };
  try {
    for (const field of preferenceFields) {
      const value = pending[field];
      if (value === undefined) continue;
      writeScopedPreference(activeProfile, field, value);
      Object.assign(values, { [field]: value });
      delete pending[field];
    }
    saveError = null;
    publish({ values, pending, error: loadError });
  } catch {
    saveError = 'Preferences could not be saved. Try again.';
    publish({ values, pending, error: saveError });
  }
}

export async function retryAccountLocalPreferences(): Promise<void> {
  const capturedGeneration = generation;
  await ensureAccountLocalPreferencesLoaded();
  if (capturedGeneration === generation && loaded && Object.keys(state.pending).length) {
    setAccountLocalPreferences(state.pending);
  }
}

export function __resetAccountLocalPreferencesForTests(): void {
  __resetPreferenceMigrationForTests();
  generation += 1;
  state = emptyState();
  loadError = null;
  saveError = null;
  profile = undefined;
  loaded = false;
  loading = null;
  listeners.clear();
}
