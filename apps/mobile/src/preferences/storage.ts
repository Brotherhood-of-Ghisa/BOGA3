import { Storage } from 'expo-sqlite/kv-store';
import {
  type AccountLocalPreferences,
  DEFAULT_ACCOUNT_LOCAL_PREFERENCES,
  browsingPreferenceFields,
  isPreferenceValue,
  preferenceFields,
} from './model';

// Distinct namespaces prevent even an account named "local" sharing the local profile.
export type PreferenceProfile = `account:${string}` | 'local';
export const preferenceKey = (profile: PreferenceProfile, field: keyof AccountLocalPreferences) =>
  `boga3.accountPreferences.v1.${encodeURIComponent(profile)}.${field}`;

export function readScopedPreferences(profile: PreferenceProfile) {
  const valid: Partial<AccountLocalPreferences> = {};
  for (const field of preferenceFields) {
    const raw = Storage.getItemSync(preferenceKey(profile, field));
    const value = field === 'showNeverDone'
      ? raw === 'true' ? true : raw === 'false' ? false : null
      : browsingPreferenceFields.includes(field as typeof browsingPreferenceFields[number]) || field === 'heatmapView'
        ? raw : parseJsonPreference(raw);
    if (isPreferenceValue(field, value)) Object.assign(valid, { [field]: value });
  }
  return { values: { ...DEFAULT_ACCOUNT_LOCAL_PREFERENCES, ...valid }, valid };
}

function parseJsonPreference(raw: string | null): unknown {
  try { return raw === null ? null : JSON.parse(raw); }
  catch { return null; }
}

export function writeScopedPreference<K extends keyof AccountLocalPreferences>(
  profile: PreferenceProfile, field: K, value: AccountLocalPreferences[K],
) {
  Storage.setItemSync(preferenceKey(profile, field), typeof value === 'object' ? JSON.stringify(value) : String(value));
}
