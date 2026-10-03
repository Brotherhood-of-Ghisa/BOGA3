// Device-local account choices. Keep this module free of data, auth and UI imports.
export type ExerciseDateFormat = 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'YYYY-MM-DD';
export type ExerciseListSort = 'favourite' | 'name';
export type PastRecordsGymScope = 'all' | 'current-gym';
export type HeatmapView = 'daily' | 'weekly';
export const MAX_HISTORY_LOOKBACK_WEEKS = 156;
export type AccountLocalPreferences = {
  sort: ExerciseListSort;
  showNeverDone: boolean;
  dateFormat: ExerciseDateFormat;
  pastRecordsGymScope: PastRecordsGymScope;
  weeklyMuscleTargets: Record<string, number>;
  visibleEffortGrades: number[];
  targetWindowWeeks: number;
  historyLookbackWeeks: number;
  heatmapView: HeatmapView;
};
export type ExerciseListPreferences = Pick<AccountLocalPreferences, 'sort' | 'showNeverDone' | 'dateFormat' | 'pastRecordsGymScope'>;

export const DEFAULT_EXERCISE_LIST_PREFERENCES: ExerciseListPreferences = {
  sort: 'favourite',
  showNeverDone: true,
  dateFormat: 'DD-MM-YYYY',
  pastRecordsGymScope: 'all',
};

export const DEFAULT_ACCOUNT_LOCAL_PREFERENCES: AccountLocalPreferences = {
  ...DEFAULT_EXERCISE_LIST_PREFERENCES,
  weeklyMuscleTargets: {},
  visibleEffortGrades: [0, 1, 2, 3],
  targetWindowWeeks: 4,
  historyLookbackWeeks: 52,
  heatmapView: 'weekly',
};

export const browsingPreferenceFields = Object.keys(DEFAULT_EXERCISE_LIST_PREFERENCES) as (keyof ExerciseListPreferences)[];
export const preferenceFields = Object.keys(DEFAULT_ACCOUNT_LOCAL_PREFERENCES) as (keyof AccountLocalPreferences)[];
export const isNonNegativeSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isPositiveSafeInteger = (value: unknown): value is number => isNonNegativeSafeInteger(value) && value > 0;

export const preferenceValidationMessages: Record<keyof AccountLocalPreferences, string> = {
  sort: 'Choose a valid exercise sort.',
  showNeverDone: 'Choose whether to show never-done exercises.',
  dateFormat: 'Choose a valid date format.',
  pastRecordsGymScope: 'Choose a valid gym filter.',
  weeklyMuscleTargets: 'Muscle targets must be positive whole numbers.',
  visibleEffortGrades: 'Choose at least one RIR grade. RIR values must be non-negative whole numbers.',
  targetWindowWeeks: 'Target window must be a whole number of weeks from 1 to 52.',
  historyLookbackWeeks: `History look-back must be a positive whole number of weeks up to ${MAX_HISTORY_LOOKBACK_WEEKS}.`,
  heatmapView: 'Choose Daily or Weekly for history.',
};

const isMuscleTargets = (value: unknown): value is Record<string, number> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([id, quota]) => id.length > 0 && isPositiveSafeInteger(quota)));

export function isPreferenceValue<K extends keyof AccountLocalPreferences>(
  field: K, value: unknown,
): value is AccountLocalPreferences[K] {
  switch (field) {
    case 'sort': return value === 'name' || value === 'favourite';
    case 'showNeverDone': return typeof value === 'boolean';
    case 'dateFormat': return value === 'DD-MM-YYYY' || value === 'MM-DD-YYYY' || value === 'YYYY-MM-DD';
    case 'pastRecordsGymScope': return value === 'all' || value === 'current-gym';
    case 'weeklyMuscleTargets': return isMuscleTargets(value);
    case 'visibleEffortGrades': return Array.isArray(value) && value.length > 0 &&
      value.every(isNonNegativeSafeInteger) && new Set(value).size === value.length;
    case 'targetWindowWeeks': return isPositiveSafeInteger(value) && value <= 52;
    case 'historyLookbackWeeks': return isPositiveSafeInteger(value) && value <= MAX_HISTORY_LOOKBACK_WEEKS;
    case 'heatmapView': return value === 'daily' || value === 'weekly';
  }
  return false;
}

export function normalizeLegacyPreferences(stored: string | null): ExerciseListPreferences {
  let parsed: unknown;
  try { parsed = stored === null ? null : JSON.parse(stored); }
  catch { parsed = null; }
  const values = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : {};
  const preferences = { ...DEFAULT_EXERCISE_LIST_PREFERENCES };
  for (const field of browsingPreferenceFields) {
    if (isPreferenceValue(field, values[field])) Object.assign(preferences, { [field]: values[field] });
  }
  if (values.sort === undefined && values.recentsOnTop === false) preferences.sort = 'name';
  return preferences;
}
