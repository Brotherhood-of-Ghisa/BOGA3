// The preferences that live on the synced settings row rather than in the
// device's kv store ([[muscle.weekly-targets]], [[muscle.secondary-filter]]).
// Pure conversion between the stored columns and the preference values.
import type { MuscleTargetSettingsWrite, StoredMuscleTargetSettings } from '../data/user-settings';
import { type AccountLocalPreferences, DEFAULT_ACCOUNT_LOCAL_PREFERENCES, isPreferenceValue } from './model';

export const syncedPreferenceFields = [
  'weeklyWorkingSetTarget', 'muscleTargetMode', 'muscleTargetOverrides', 'progressCountSecondary',
] as const satisfies readonly (keyof AccountLocalPreferences)[];
export type SyncedPreferenceField = typeof syncedPreferenceFields[number];
export type SyncedPreferences = Pick<AccountLocalPreferences, SyncedPreferenceField>;

/**
 * Set once sync has adopted or uploaded the profile's targets, and cleared when
 * the store is wiped. Until then the synced fields stay in the kv store, so an
 * edit made before the first sync is this device's own value, which adoption
 * replaces or uploads.
 */
export const syncedTargetsAdoptedKey = (profile: `account:${string}`) =>
  `boga3.accountPreferences.v1.${encodeURIComponent(profile)}.syncedTargetsAdopted`;

export const pickSyncedPreferences = (values: Partial<AccountLocalPreferences>): Partial<SyncedPreferences> => {
  const picked: Partial<SyncedPreferences> = {};
  for (const field of syncedPreferenceFields) {
    if (values[field] !== undefined) Object.assign(picked, { [field]: values[field] });
  }
  return picked;
};

const parseOverrides = (raw: string | null): unknown => {
  try { return raw === null ? null : JSON.parse(raw); }
  catch { return null; }
};

/** The stored values that pass the preference guards; an invalid or null column is left out. */
export const syncedPreferencesFromStored = (stored: StoredMuscleTargetSettings | null): Partial<SyncedPreferences> => {
  if (stored === null) return {};
  const candidates: Record<SyncedPreferenceField, unknown> = {
    weeklyWorkingSetTarget: stored.weeklyWorkingSetTarget,
    muscleTargetMode: stored.muscleTargetMode === 'per_muscle' ? 'per-muscle' : stored.muscleTargetMode,
    muscleTargetOverrides: parseOverrides(stored.muscleTargetOverrides),
    progressCountSecondary: stored.countSecondaryMuscles,
  };
  const values: Partial<SyncedPreferences> = {};
  for (const field of syncedPreferenceFields) {
    if (isPreferenceValue(field, candidates[field])) Object.assign(values, { [field]: candidates[field] });
  }
  return values;
};

/** The four columns a write sets together; a field left out takes its default. */
export const storedFromSyncedPreferences = (values: Partial<SyncedPreferences>): MuscleTargetSettingsWrite => {
  const complete = { ...pickSyncedPreferences(DEFAULT_ACCOUNT_LOCAL_PREFERENCES), ...values } as SyncedPreferences;
  return {
    weeklyWorkingSetTarget: complete.weeklyWorkingSetTarget,
    muscleTargetMode: complete.muscleTargetMode === 'per-muscle' ? 'per_muscle' : 'single',
    muscleTargetOverrides: JSON.stringify(complete.muscleTargetOverrides),
    countSecondaryMuscles: complete.progressCountSecondary,
  };
};
