import { __resetPreferenceMigrationForTests, migrateBrowsingPreferences } from './migration';
import { configureDisplayEfforts, configurePersonalEffortPolicy } from '../config/personal-effort';
import type { MuscleTargetSettingsWrite, StoredMuscleTargetSettings } from '../data/user-settings';
import {
  type AccountLocalPreferences,
  DEFAULT_ACCOUNT_LOCAL_PREFERENCES,
  isPreferenceValue,
  preferenceFields,
  preferenceValidationMessages,
} from './model';
import { Storage } from 'expo-sqlite/kv-store';
import { type PreferenceProfile, readScopedPreferences, writeScopedPreference } from './storage';
import {
  pickSyncedPreferences,
  storedFromSyncedPreferences,
  syncedPreferencesFromStored,
  syncedTargetsAdoptedKey,
  type SyncedPreferences,
} from './synced';

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
// The synced fields' values from the settings row; each one present overrides
// the kv value, which stays the fallback until the row holds it.
let synced: Partial<SyncedPreferences> = {};
let syncedLoaded = false;
let syncedVersion = 0;
let syncedWrites: Promise<void> = Promise.resolve();
const withSynced = (values: AccountLocalPreferences): AccountLocalPreferences => ({ ...values, ...synced });
// Only an account whose targets sync has adopted or uploaded keeps them on the
// settings row; the local-only build and a not-yet-synced account use kv.
const usesSyncedRow = (activeProfile: PreferenceProfile): activeProfile is `account:${string}` =>
  activeProfile !== 'local' && Storage.getItemSync(syncedTargetsAdoptedKey(activeProfile)) === 'true';

/** The settings row behind the synced fields; `synced-store.ts` connects the data layer. */
export type SyncedPreferenceStore = {
  read: (accountUserId: string | null) => Promise<StoredMuscleTargetSettings | null>;
  write: (values: MuscleTargetSettingsWrite) => Promise<void>;
};
let syncedStore: SyncedPreferenceStore | null = null;
export const configureSyncedPreferenceStore = (store: SyncedPreferenceStore): void => { syncedStore = store; };
const requireSyncedStore = (): SyncedPreferenceStore => {
  if (!syncedStore) throw new Error('The synced preference store is not configured.');
  return syncedStore;
};

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
export const getAccountLocalPreferenceAccountRevision = () => generation;
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
  resetSynced();
  publish(emptyState());
  void ensureAccountLocalPreferencesLoaded();
}

function loadScoped(profileAtStart: PreferenceProfile): boolean {
  try {
    const { values } = readScopedPreferences(profileAtStart);
    loaded = true;
    loadError = null;
    publish({ values: withSynced(values), error: currentError() });
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
      publish({ values: withSynced(values), error: currentError() });
      if (!syncedLoaded) await refreshAccountLocalSyncedPreferences();
    } catch {
      if (capturedGeneration !== generation) return;
      // A scalar may have committed before a later migration write failed.
      // Publish only what can be read back, keeping migration retryable.
      try { publish({ values: withSynced(readScopedPreferences(capturedProfile).values) }); }
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
  const syncedPatch = usesSyncedRow(activeProfile) ? pickSyncedPreferences(pending) : {};
  for (const field of Object.keys(syncedPatch) as (keyof SyncedPreferences)[]) delete pending[field];
  writeKvPreferences(activeProfile, pending);
  if (usesSyncedRow(activeProfile)) writeSyncedPreferences(activeProfile, syncedPatch);
}

function writeKvPreferences(activeProfile: PreferenceProfile, pending: Partial<AccountLocalPreferences>): void {
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

/** The kv values under the synced overlay; the last published values if kv cannot be read. */
const syncedView = (activeProfile: PreferenceProfile): AccountLocalPreferences => {
  let base = state.values;
  try { base = readScopedPreferences(activeProfile).values; } catch { /* Keep the last published values. */ }
  return withSynced(base);
};

/**
 * Publishes the synced fields at once and writes all four to the settings row,
 * which the next sync pushes. The fields the patch leaves out come from the
 * stored row, not from memory, which may not hold the row yet. A failed write
 * restores the previous values and keeps the patch pending for retry.
 */
function writeSyncedPreferences(activeProfile: `account:${string}`, patch: Partial<SyncedPreferences>): void {
  if (Object.keys(patch).length === 0) return;
  const previous = synced;
  const optimistic = { ...pickSyncedPreferences(state.values), ...patch };
  synced = optimistic;
  syncedVersion += 1;
  const version = syncedVersion;
  publish({ values: withSynced(state.values) });
  syncedWrites = syncedWrites.then(async () => {
    try {
      const store = requireSyncedStore();
      const stored = syncedPreferencesFromStored(await store.read(activeProfile.slice('account:'.length)));
      const next = { ...optimistic, ...stored, ...patch };
      await store.write(storedFromSyncedPreferences(next));
      if (version !== syncedVersion) return;
      synced = keepingOverrides(next);
      saveError = null;
      publish({ values: syncedView(activeProfile), error: currentError() });
    } catch {
      if (version !== syncedVersion) return;
      synced = previous;
      saveError = 'Preferences could not be saved. Try again.';
      publish({ values: syncedView(activeProfile), pending: { ...state.pending, ...patch }, error: currentError() });
    }
  });
}

/**
 * Re-reads the synced fields from the settings row. Sync calls this after it
 * applies or adopts a settings row, so mounted screens show the new values.
 * Waits for queued edits, and drops a read an edit or account switch overtook.
 */
export async function refreshAccountLocalSyncedPreferences(): Promise<void> {
  const activeProfile = currentProfile();
  if (activeProfile === null) return;
  if (!usesSyncedRow(activeProfile)) {
    if (Object.keys(synced).length === 0) return;
    synced = {};
    publish({ values: syncedView(activeProfile) });
    return;
  }
  const capturedGeneration = generation;
  const version = syncedVersion;
  await syncedWrites;
  let stored: StoredMuscleTargetSettings | null;
  try { stored = await requireSyncedStore().read(activeProfile.slice('account:'.length)); }
  catch { return; }
  if (capturedGeneration !== generation || version !== syncedVersion) return;
  synced = keepingOverrides(syncedPreferencesFromStored(stored));
  syncedLoaded = true;
  publish({ values: syncedView(activeProfile) });
}

/**
 * A wiped store holds no settings row until sync restores it, so every account
 * goes back to kv edits until sync adopts its targets again: an edit made
 * before the restore pull must not push defaults over the account's targets.
 */
export function forgetSyncedTargetsAdoption(): void {
  for (const key of Storage.getAllKeysSync()) {
    if (key.startsWith('boga3.accountPreferences.v1.') && key.endsWith('.syncedTargetsAdopted')) Storage.removeItemSync(key);
  }
}

/**
 * Keeps the current overrides object when the map is unchanged, so a settings
 * pull or an edit to another field does not republish every preference.
 */
function keepingOverrides(next: Partial<SyncedPreferences>): Partial<SyncedPreferences> {
  const current = synced.muscleTargetOverrides;
  return current && next.muscleTargetOverrides
    && JSON.stringify(next.muscleTargetOverrides) === JSON.stringify(current)
    ? { ...next, muscleTargetOverrides: current } : next;
}

/** Wipes call this first, so no queued edit lands in the emptied store. */
export const drainAccountLocalSyncedWrites = (): Promise<void> => syncedWrites;

function resetSynced(): void {
  synced = {};
  syncedLoaded = false;
  syncedVersion += 1;
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
  resetSynced();
  syncedWrites = Promise.resolve();
  listeners.clear();
}
