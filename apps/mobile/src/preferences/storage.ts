import { Storage } from 'expo-sqlite/kv-store';
import { DEFAULT_DISPLAY_EFFORTS } from '../exercise-calculations/effort-policy';
import {
  type AccountLocalPreferences,
  DEFAULT_ACCOUNT_LOCAL_PREFERENCES,
  isPreferenceValue,
  preferenceFields,
  textPreferenceFields,
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
      : textPreferenceFields.includes(field) ? raw : parseJsonPreference(raw);
    if (isPreferenceValue(field, value)) Object.assign(valid, { [field]: value });
  }
  // The former picker allowed arbitrary RIR grades. Keep its choices for fixed
  // grades, add RIR-4 and the two new labels, and leave stored workouts intact.
  if (!valid.displayEfforts) {
    const legacy = parseJsonPreference(Storage.getItemSync(
      `boga3.accountPreferences.v1.${encodeURIComponent(profile)}.visibleEffortGrades`,
    ));
    if (Array.isArray(legacy) && legacy.length > 0 && legacy.every(value =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
      valid.displayEfforts = DEFAULT_DISPLAY_EFFORTS.filter(id =>
        !id.startsWith('rir_') || id === 'rir_4' || legacy.includes(Number(id.slice(4))));
    }
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
