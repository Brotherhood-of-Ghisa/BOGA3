import { Storage } from 'expo-sqlite/kv-store';
import { DEFAULT_DISPLAY_EFFORTS } from '../exercise-calculations/effort-policy';
import {
  type AccountLocalPreferences,
  DEFAULT_ACCOUNT_LOCAL_PREFERENCES,
  booleanPreferenceFields,
  isPreferenceValue,
  preferenceFields,
  textPreferenceFields,
} from './model';

// Distinct namespaces prevent even an account named "local" sharing the local profile.
export type PreferenceProfile = `account:${string}` | 'local';
export const preferenceKey = (profile: PreferenceProfile, field: keyof AccountLocalPreferences) =>
  `boga3.accountPreferences.v1.${encodeURIComponent(profile)}.${field}`;

const muscleCountingInitializedKey = (profile: PreferenceProfile) =>
  `boga3.accountPreferences.v1.${encodeURIComponent(profile)}.muscleCountingInitialized`;

/** Only real pre-existing choices establish legacy provenance; lifecycle markers do not. */
export function hasLegacyMuscleCountingProfile(profile: PreferenceProfile): boolean {
  const initialized = Storage.getItemSync(muscleCountingInitializedKey(profile));
  if (initialized !== null) return initialized === 'legacy';
  return preferenceFields.some(field => field !== 'muscleVolumePrimaryOnly'
    && Storage.getItemSync(preferenceKey(profile, field)) !== null)
    || Storage.getItemSync(`boga3.accountPreferences.v1.${encodeURIComponent(profile)}.visibleEffortGrades`) !== null;
}

/** Pin defaults before browsing migration can make a new profile look legacy. */
export function initializeMuscleCountingPreferences(profile: PreferenceProfile): void {
  if (Storage.getItemSync(muscleCountingInitializedKey(profile)) !== null) return;
  const legacy = hasLegacyMuscleCountingProfile(profile);
  const values = readScopedPreferences(profile).values;
  Storage.setItemSync(preferenceKey(profile, 'progressCountSecondary'), String(values.progressCountSecondary));
  Storage.setItemSync(preferenceKey(profile, 'muscleVolumePrimaryOnly'), String(values.muscleVolumePrimaryOnly));
  Storage.setItemSync(muscleCountingInitializedKey(profile), legacy ? 'legacy' : 'current');
}

export function readScopedPreferences(profile: PreferenceProfile) {
  const valid: Partial<AccountLocalPreferences> = {};
  for (const field of preferenceFields) {
    const raw = Storage.getItemSync(preferenceKey(profile, field));
    const value = booleanPreferenceFields.includes(field)
      ? raw === 'true' ? true : raw === 'false' ? false : null
      : textPreferenceFields.includes(field) ? raw : parseJsonPreference(raw);
    if (isPreferenceValue(field, value)) Object.assign(valid, { [field]: value });
  }
  // Profiles created before independent Volume settings used secondary Sets by default.
  if (valid.progressCountSecondary === undefined && hasLegacyMuscleCountingProfile(profile)) {
    valid.progressCountSecondary = true;
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
  initializeMuscleCountingPreferences(profile);
  Storage.setItemSync(preferenceKey(profile, field), typeof value === 'object' ? JSON.stringify(value) : String(value));
}
