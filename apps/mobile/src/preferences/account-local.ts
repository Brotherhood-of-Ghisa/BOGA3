import { __resetPreferenceMigrationForTests, migrateBrowsingPreferences } from './migration';
import { configureDisplayEfforts, configurePersonalEffortPolicy } from '../config/personal-effort';
import {
  type AccountLocalPreferences,
  DEFAULT_ACCOUNT_LOCAL_PREFERENCES,
  isPreferenceValue,
  preferenceFields,
  preferenceValidationMessages,
} from './model';
import { type PreferenceProfile, readScopedPreferences, writeScopedPreference } from './storage';

export type AccountLocalPreferenceState = {
  values: AccountLocalPreferences;
  pending: Partial<AccountLocalPreferences>;
  error: string | null;
};
const emptyState = (): AccountLocalPreferenceState => ({
  values: DEFAULT_ACCOUNT_LOCAL_PREFERENCES, pending: {}, error: null,
});
let state = emptyState();
let loadError: string | null = null;
let saveError: string | null = null;
let validationError: string | null = null;
const currentError = () => validationError ?? saveError ?? loadError;
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
  configureDisplayEfforts(updated.values.displayEfforts);
  configurePersonalEffortPolicy(updated.values);
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
  validationError = null;
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
    publish({ values, error: currentError() });
    return true;
  } catch {
    loadError = 'Preferences could not be loaded. Try again.';
    publish({ error: currentError() });
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
      publish({ values, error: currentError() });
    } catch {
      if (capturedGeneration !== generation) return;
      // A scalar may have committed before a later migration write failed.
      // Publish only what can be read back, keeping migration retryable.
      try { publish({ values: readScopedPreferences(capturedProfile).values }); }
      catch { /* Keep the last successfully read durable snapshot. */ }
      loadError = 'Preferences could not be loaded. Try again.';
      publish({ error: currentError() });
    }
  })();
  loading = operation;
  await operation;
  if (capturedGeneration === generation) loading = null;
}

/** Field drafts can report validation without submitting an invalid preference patch. */
export function setAccountLocalPreferenceValidationError(message: string): void {
  if (currentProfile() === null) return;
  validationError = message;
  publish({ error: currentError() });
}

export function setAccountLocalPreferences(patch: Partial<AccountLocalPreferences>): void {
  const activeProfile = currentProfile();
  if (activeProfile === null) return;
  const invalid = preferenceFields.find(field => Object.hasOwn(patch, field) && !isPreferenceValue(field, patch[field]));
  if (invalid) {
    setAccountLocalPreferenceValidationError(preferenceValidationMessages[invalid]);
    return;
  }
  validationError = null;
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
    publish({ values, pending, error: currentError() });
  } catch {
    saveError = 'Preferences could not be saved. Try again.';
    publish({ values, pending, error: currentError() });
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
  configureDisplayEfforts(state.values.displayEfforts);
  configurePersonalEffortPolicy(state.values);
  loadError = null;
  saveError = null;
  validationError = null;
  profile = undefined;
  loaded = false;
  loading = null;
  listeners.clear();
}
