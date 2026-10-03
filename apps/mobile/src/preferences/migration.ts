import * as SecureStore from 'expo-secure-store';
import { Storage } from 'expo-sqlite/kv-store';
import { normalizeLegacyPreferences, browsingPreferenceFields } from './model';
import { type PreferenceProfile, readScopedPreferences, writeScopedPreference } from './storage';

// Retain a failed claim for retries in this process, even if its native write
// never committed. Only a durable claim can survive a process restart.
let pendingOwner: PreferenceProfile | null = null;
export const __resetPreferenceMigrationForTests = () => { pendingOwner = null; };

export const LEGACY_PREFERENCES_KEY = 'boga3.exerciseListPreferences.v1';
export const LEGACY_PREFERENCES_OWNER_KEY = 'boga3.accountPreferences.v1.legacyOwner';
export const migrationCompleteKey = (profile: PreferenceProfile) =>
  `boga3.accountPreferences.v1.${encodeURIComponent(profile)}.browsingMigrated`;

export async function migrateBrowsingPreferences(profile: PreferenceProfile): Promise<void> {
  if (profile === 'local') return;
  const owner = Storage.getItemSync(LEGACY_PREFERENCES_OWNER_KEY);
  const claimant = owner ?? pendingOwner;
  if (claimant !== null && claimant !== profile) return;
  if (Storage.getItemSync(migrationCompleteKey(profile)) === 'true') return;
  // Persist the owner before the async read: a failure, restart or account switch
  // cannot give the unowned source to a second account on retry.
  pendingOwner = profile;
  if (owner === null) Storage.setItemSync(LEGACY_PREFERENCES_OWNER_KEY, profile);
  const legacy = normalizeLegacyPreferences(await SecureStore.getItemAsync(LEGACY_PREFERENCES_KEY));
  // Re-read after the await. Valid scoped choices, including intervening edits
  // and fields saved by an interrupted migration, always win.
  const { valid } = readScopedPreferences(profile);
  for (const field of browsingPreferenceFields) {
    if (valid[field] === undefined) writeScopedPreference(profile, field, legacy[field]);
  }
  // Keychain values may survive an iOS reinstall, unlike the SQLite claim.
  // Remove the unowned source only after conversion is durable. Failed cleanup
  // leaves completion unset so a retry keeps scoped choices and tries again.
  await SecureStore.deleteItemAsync(LEGACY_PREFERENCES_KEY);
  Storage.setItemSync(migrationCompleteKey(profile), 'true');
}
