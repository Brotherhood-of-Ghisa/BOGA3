// Device-local account choices. Keep this module free of data, auth and UI imports.
import { DEFAULT_DISPLAY_EFFORTS, DEFAULT_PERSONAL_EFFORT_POLICY, isEffortSelection, type EffortChoice } from '../exercise-calculations/effort-policy';
import { isRestTimerSec, MAX_REST_TIMER_SECONDS, MIN_REST_TIMER_SECONDS, REST_TIMER_RANGE_MESSAGE } from '../exercise-core/rest-timer';
import { isMuscleTargetOverrides, type MuscleTargetMode, type MuscleTargetOverrides } from './muscle-targets';

export { MAX_REST_TIMER_SECONDS, MIN_REST_TIMER_SECONDS };
export type ExerciseDateFormat = 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'YYYY-MM-DD';
export type ExerciseListSort = 'favourite' | 'name';
export type PastRecordsGymScope = 'all' | 'current-gym';
export type HeatmapView = 'daily' | 'weekly' | 'timeline';
// What Progress opens on, set in Settings: the breakdown, the period, each
// breakdown's metric, family grouping and secondary sets. A choice on Progress
// lasts only for the visit; it never changes these defaults.
export type ProgressBreakdown = 'exercise' | 'muscle';
// Settings' Progress period ([[comparison.window]]), or its one-week alternative.
export type ProgressPeriod = 'window' | 'this-week';
export type ProgressMuscleLayout = 'list' | '3d';
export type ProgressMetric = 'workingSetCount' | 'totalVolume';
// The Exercise breakdown offers one more: a 1RM estimate is a figure only an
// exercise has, so the Muscle table never shows it. Each breakdown has its own
// metric, so switching back finds the figure you left on.
export type ProgressExerciseMetric = ProgressMetric | 'estimatedOneRepMax';
// Settings › Experiments. `timerInTitleBar`: the session and exercise title
// bars show the running timer as a countdown pill; tap starts or stops it,
// long press opens the timer card (`components/session-recorder/title-bar-timer.tsx`).
export const MAX_HISTORY_LOOKBACK_WEEKS = 520;
export const DEFAULT_REST_TIMER_SECONDS = 90;
export const MIN_REPEATING_TIMER_INTERVAL_SECONDS = 15;
export const MAX_REPEATING_TIMER_INTERVAL_SECONDS = 600;
export const DEFAULT_REPEATING_TIMER_INTERVAL_SECONDS = 60;
export type AccountLocalPreferences = {
  sort: ExerciseListSort;
  showNeverDone: boolean;
  dateFormat: ExerciseDateFormat;
  pastRecordsGymScope: PastRecordsGymScope;
  weeklyWorkingSetTarget: number;
  muscleTargetMode: MuscleTargetMode;
  muscleTargetOverrides: MuscleTargetOverrides;
  displayEfforts: EffortChoice[];
  workingSetEfforts: EffortChoice[];
  volumeEfforts: EffortChoice[];
  targetWindowWeeks: number;
  historyLookbackWeeks: number;
  heatmapView: HeatmapView;
  progressBreakdown: ProgressBreakdown;
  progressPeriod: ProgressPeriod;
  progressGrouped: boolean;
  progressCountSecondary: boolean;
  progressMuscleLayout: ProgressMuscleLayout;
  progressMetric: ProgressMetric;
  progressExerciseMetric: ProgressExerciseMetric;
  restTimerAutoStart: boolean;
  restTimerDurationSec: number;
  repeatingTimerIntervalSec: number;
  timerInTitleBar: boolean;
  developerMode: boolean;
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
  weeklyWorkingSetTarget: 8,
  muscleTargetMode: 'single',
  muscleTargetOverrides: {},
  displayEfforts: [...DEFAULT_DISPLAY_EFFORTS],
  workingSetEfforts: [...DEFAULT_PERSONAL_EFFORT_POLICY.workingSetEfforts],
  volumeEfforts: [...DEFAULT_PERSONAL_EFFORT_POLICY.volumeEfforts],
  targetWindowWeeks: 4,
  historyLookbackWeeks: 52,
  heatmapView: 'daily',
  progressBreakdown: 'muscle',
  progressPeriod: 'window',
  progressGrouped: true,
  progressCountSecondary: true,
  progressMuscleLayout: 'list',
  progressMetric: 'workingSetCount',
  progressExerciseMetric: 'workingSetCount',
  restTimerAutoStart: true,
  restTimerDurationSec: DEFAULT_REST_TIMER_SECONDS,
  repeatingTimerIntervalSec: DEFAULT_REPEATING_TIMER_INTERVAL_SECONDS,
  timerInTitleBar: false,
  developerMode: false,
};

export const browsingPreferenceFields = Object.keys(DEFAULT_EXERCISE_LIST_PREFERENCES) as (keyof ExerciseListPreferences)[];
// Stored as their own text, not JSON: every other non-boolean field is written
// as JSON and must be parsed back (`storage.ts`).
export const textPreferenceFields: (keyof AccountLocalPreferences)[] = [
  ...browsingPreferenceFields, 'heatmapView', 'progressBreakdown', 'progressPeriod', 'progressMuscleLayout', 'progressMetric', 'progressExerciseMetric',
  'muscleTargetMode',
];
// Stored as `true` / `false`.
export const booleanPreferenceFields: (keyof AccountLocalPreferences)[] = [
  'showNeverDone', 'restTimerAutoStart', 'developerMode', 'progressGrouped', 'progressCountSecondary',
  'timerInTitleBar',
];
export const preferenceFields = Object.keys(DEFAULT_ACCOUNT_LOCAL_PREFERENCES) as (keyof AccountLocalPreferences)[];
export const isNonNegativeSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isPositiveSafeInteger = (value: unknown): value is number => isNonNegativeSafeInteger(value) && value > 0;

export const preferenceValidationMessages: Record<keyof AccountLocalPreferences, string> = {
  sort: 'Choose a valid exercise sort.',
  showNeverDone: 'Choose whether to show never-done exercises.',
  dateFormat: 'Choose a valid date format.',
  pastRecordsGymScope: 'Choose a valid gym filter.',
  weeklyWorkingSetTarget: 'Weekly working-set target must be a positive whole number.',
  muscleTargetMode: 'Choose Single or Per muscle targets.',
  muscleTargetOverrides: 'Muscle targets must be positive whole numbers.',
  displayEfforts: 'Choose at least one effort label to display.',
  workingSetEfforts: 'Choose valid working-set effort labels.',
  volumeEfforts: 'Choose valid volume effort labels.',
  targetWindowWeeks: 'Progress period must be a whole number of weeks from 1 to 52.',
  historyLookbackWeeks: `History look-back must be a positive whole number of weeks up to ${MAX_HISTORY_LOOKBACK_WEEKS}.`,
  heatmapView: 'Choose Grid, Weekly or Timeline for history.',
  progressBreakdown: 'Choose Exercise or Muscle for Progress.',
  progressPeriod: 'Choose the Progress period or This week for Progress.',
  progressGrouped: 'Choose whether Progress groups by muscle family.',
  progressCountSecondary: 'Choose whether Progress counts secondary sets.',
  progressMuscleLayout: 'Choose List or 3D for Progress.',
  progressMetric: 'Choose Sets or Volume for Progress.',
  progressExerciseMetric: 'Choose Sets, Volume or 1RM for Progress.',
  restTimerAutoStart: 'Choose whether to start the rest timer automatically.',
  restTimerDurationSec: REST_TIMER_RANGE_MESSAGE,
  timerInTitleBar: 'Choose whether the timer runs in the title bar.',
  developerMode: 'Choose whether to show developer tools.',
  repeatingTimerIntervalSec: `Repeating interval must be a whole number of seconds from ${MIN_REPEATING_TIMER_INTERVAL_SECONDS} to ${MAX_REPEATING_TIMER_INTERVAL_SECONDS}.`,
};

export function isPreferenceValue<K extends keyof AccountLocalPreferences>(
  field: K, value: unknown,
): value is AccountLocalPreferences[K] {
  switch (field) {
    case 'sort': return value === 'name' || value === 'favourite';
    case 'showNeverDone':
    case 'restTimerAutoStart':
    case 'progressGrouped':
    case 'progressCountSecondary':
    case 'timerInTitleBar':
    case 'developerMode': return typeof value === 'boolean';
    case 'dateFormat': return value === 'DD-MM-YYYY' || value === 'MM-DD-YYYY' || value === 'YYYY-MM-DD';
    case 'pastRecordsGymScope': return value === 'all' || value === 'current-gym';
    case 'weeklyWorkingSetTarget': return isPositiveSafeInteger(value);
    case 'muscleTargetMode': return value === 'single' || value === 'per-muscle';
    case 'muscleTargetOverrides': return isMuscleTargetOverrides(value);
    case 'displayEfforts': return isEffortSelection(value) && value.length > 0;
    case 'workingSetEfforts':
    case 'volumeEfforts': return isEffortSelection(value);
    case 'targetWindowWeeks': return isPositiveSafeInteger(value) && value <= 52;
    case 'historyLookbackWeeks': return isPositiveSafeInteger(value) && value <= MAX_HISTORY_LOOKBACK_WEEKS;
    case 'heatmapView': return value === 'daily' || value === 'weekly' || value === 'timeline';
    case 'progressBreakdown': return value === 'exercise' || value === 'muscle';
    case 'progressPeriod': return value === 'window' || value === 'this-week';
    case 'progressMuscleLayout': return value === 'list' || value === '3d';
    case 'progressMetric': return value === 'workingSetCount' || value === 'totalVolume';
    case 'progressExerciseMetric':
      return value === 'workingSetCount' || value === 'totalVolume' || value === 'estimatedOneRepMax';
    case 'restTimerDurationSec': return isRestTimerSec(value);
    case 'repeatingTimerIntervalSec':
      return isPositiveSafeInteger(value) && value >= MIN_REPEATING_TIMER_INTERVAL_SECONDS && value <= MAX_REPEATING_TIMER_INTERVAL_SECONDS;
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
