// Device-local account choices. Keep this module free of data, auth and UI imports.
export type ExerciseDateFormat = 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'YYYY-MM-DD';
export type ExerciseListSort = 'favourite' | 'name';
export type PastRecordsGymScope = 'all' | 'current-gym';
export type AccountLocalPreferences = {
  sort: ExerciseListSort;
  showNeverDone: boolean;
  dateFormat: ExerciseDateFormat;
  pastRecordsGymScope: PastRecordsGymScope;
};
export type ExerciseListPreferences = AccountLocalPreferences;

export const DEFAULT_EXERCISE_LIST_PREFERENCES: AccountLocalPreferences = {
  sort: 'favourite',
  showNeverDone: true,
  dateFormat: 'DD-MM-YYYY',
  pastRecordsGymScope: 'all',
};

export const preferenceFields = Object.keys(DEFAULT_EXERCISE_LIST_PREFERENCES) as (keyof AccountLocalPreferences)[];

export function isPreferenceValue<K extends keyof AccountLocalPreferences>(
  field: K, value: unknown,
): value is AccountLocalPreferences[K] {
  switch (field) {
    case 'sort': return value === 'name' || value === 'favourite';
    case 'showNeverDone': return typeof value === 'boolean';
    case 'dateFormat': return value === 'DD-MM-YYYY' || value === 'MM-DD-YYYY' || value === 'YYYY-MM-DD';
    case 'pastRecordsGymScope': return value === 'all' || value === 'current-gym';
  }
  return false;
}

export function normalizeLegacyPreferences(stored: string | null): AccountLocalPreferences {
  let parsed: unknown;
  try { parsed = stored === null ? null : JSON.parse(stored); }
  catch { parsed = null; }
  const values = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : {};
  const preferences = { ...DEFAULT_EXERCISE_LIST_PREFERENCES };
  for (const field of preferenceFields) {
    if (isPreferenceValue(field, values[field])) Object.assign(preferences, { [field]: values[field] });
  }
  if (values.sort === undefined && values.recentsOnTop === false) preferences.sort = 'name';
  return preferences;
}
