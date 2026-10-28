// The coach's training status (`GET /v1/agent/training-status`): recovery,
// weekly targets, favourites and progression in one bounded object. Pure: the
// route reads owner-filtered rows and this derives. Muscle figures run Today's
// Plan's own functions over the same counting, so the coach and the app agree
// for the same data; only the clock is the profile time zone's.
import {
  applyMuscleReport, withoutSecondaryMappings, type MuscleAnalyticsInput, type MuscleContributionRole,
} from '../../../apps/mobile/src/data/muscle-analytics.ts';
import { aggregateMuscleDailySets } from '../../../apps/mobile/src/data/muscle-daily-sets.ts';
import { buildMuscleReportAssignment, type MuscleReportRow } from '../../../apps/mobile/src/data/muscle-report-presets.ts';
import { deriveMuscleReportPreset } from '../../../apps/mobile/src/data/muscle-report-setup.ts';
import { createRecordBook } from '../../../apps/mobile/src/exercise-calculations/records.ts';
import type { SessionSetPerformanceStatus } from '../../../apps/mobile/src/exercise-calculations/set-semantics.ts';
import { DEFAULT_ACCOUNT_LOCAL_PREFERENCES } from '../../../apps/mobile/src/preferences/model.ts';
import { effectiveMuscleTargetOverrides } from '../../../apps/mobile/src/preferences/muscle-targets.ts';
import { syncedPreferencesFromStored } from '../../../apps/mobile/src/preferences/synced.ts';
import { deriveRecoveryRows, todayPlanWindow } from '../../../apps/mobile/src/today-plan/calculations.ts';
import { localDateKey } from '../../../apps/mobile/src/utils/calendar-weeks.ts';
import { localWeekWindow, startOfLocalDay } from '../../../apps/mobile/src/utils/local-calendar.ts';
import {
  METRIC_REVISION, projectTrainingSets, type EnteredSetRow, type ExerciseLoadRow, type SessionWeightRow,
} from './training-metrics.ts';

/** Each progression window's length, in local days; the read covers two. */
export const PROGRESSION_WINDOW_DAYS = 28;
/** How far back the status reads sets: both progression windows, today included. */
export const STATUS_READ_DAYS = 2 * PROGRESSION_WINDOW_DAYS;
/** The full calendar weeks before this one that each muscle's series lists. */
export const STATUS_PAST_WEEKS = 4;
export const FAVOURITE_EXERCISE_LIMIT = 10;

export type StatusSessionRow = SessionWeightRow & { id: string; completed_at: number };
export type StatusBlockRow = {
  id: string; session_id: string; exercise_definition_id: string | null; order_index: number;
};
export type StatusSetRow = EnteredSetRow & { session_exercise_id: string };
export type StatusMappingRow = { exercise_definition_id: string; muscle_group_id: string; role: string | null };
export type StatusDefinitionRow = ExerciseLoadRow & { id: string; name: string; deleted_at: number | null };
export type StatusMuscleRow = {
  id: string; display_name: string; family_name: string; sort_order: number;
  report_group: string | null; tracked: number | boolean;
};
/** The settings singleton's target columns as PostgREST returns them; null until a device uploads. */
export type StatusSettingsRow = {
  weekly_working_set_target: number | null;
  muscle_target_mode: string | null;
  muscle_target_overrides: unknown;
  count_secondary_muscles: boolean | null;
  client_updated_at_ms: number;
};

/** One read of performed training: sessions, their exercise blocks and performed sets. */
export type StatusTraining = {
  sessions: StatusSessionRow[];
  blocks: StatusBlockRow[];
  sets: StatusSetRow[];
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const wallClockFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  formatters.set(timeZone, formatter);
  return formatter;
};

/** The profile's IANA zone when the runtime knows it, else UTC. */
export const resolveStatusTimeZone = (raw: string | null | undefined): string => {
  const zone = raw?.trim() ?? '';
  if (zone.length === 0) return 'UTC';
  try {
    wallClockFormatter(zone);
    return zone;
  } catch {
    return 'UTC';
  }
};

/**
 * A Date whose local fields read `instant`'s wall clock in `timeZone`. The
 * calendar helpers bucket by local fields, so feeding them these dates buckets
 * by the profile's days and Monday-start weeks whatever zone the runtime is in.
 * Compare such dates only with each other, never with a real instant.
 */
export const zonedWallClock = (instant: Date, timeZone: string): Date => {
  const part = new Map(wallClockFormatter(timeZone).formatToParts(instant).map((entry) => [entry.type, entry.value]));
  const field = (type: Intl.DateTimeFormatPartTypes) => Number(part.get(type));
  return new Date(
    field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'),
    instant.getUTCMilliseconds(),
  );
};

/** The status's local calendar at `now`: Today's Plan's window plus the read and progression bounds. */
export const trainingStatusWindow = (now: Date, timeZone: string) => {
  const clock = zonedWallClock(now, timeZone);
  const plan = todayPlanWindow(clock);
  const last28Start = startOfLocalDay(clock, 1 - PROGRESSION_WINDOW_DAYS);
  return {
    clock,
    plan,
    readStart: startOfLocalDay(clock, 1 - STATUS_READ_DAYS),
    readEnd: plan.read.end,
    last28Start,
    pastWeeks: Array.from({ length: STATUS_PAST_WEEKS }, (_, index) => localWeekWindow(clock, index - STATUS_PAST_WEEKS)),
  };
};
export type TrainingStatusWindow = ReturnType<typeof trainingStatusWindow>;

/**
 * The targets and count-secondary switch in force: the synced columns read
 * through the app's own guards, an invalid or null column taking the app's
 * default. `revision` is the settings row's LWW stamp (0 with no row).
 */
export const statusSettings = (row: StatusSettingsRow | null) => {
  const stored = row === null ? null : {
    weeklyWorkingSetTarget: row.weekly_working_set_target === null ? null : Number(row.weekly_working_set_target),
    muscleTargetMode: row.muscle_target_mode,
    muscleTargetOverrides: row.muscle_target_overrides == null ? null : JSON.stringify(row.muscle_target_overrides),
    countSecondaryMuscles: row.count_secondary_muscles,
  };
  const synced = syncedPreferencesFromStored(stored);
  const values = { ...DEFAULT_ACCOUNT_LOCAL_PREFERENCES, ...synced };
  return {
    preferences: {
      weeklyWorkingSetTarget: values.weeklyWorkingSetTarget,
      muscleTargetMode: values.muscleTargetMode,
      muscleTargetOverrides: values.muscleTargetOverrides,
    },
    countSecondary: values.progressCountSecondary,
    uploaded: synced.weeklyWorkingSetTarget !== undefined,
    revision: row === null ? 0 : Number(row.client_updated_at_ms),
  };
};
export type StatusSettings = ReturnType<typeof statusSettings>;

const ROLES = new Set(['primary', 'secondary', 'stabilizer']);

const asMuscleReportRows = (rows: readonly StatusMuscleRow[]): MuscleReportRow[] =>
  rows.map((row) => ({
    id: row.id, displayName: row.display_name, familyName: row.family_name, sortOrder: row.sort_order,
    reportGroup: row.report_group, tracked: row.tracked,
  }))
    // The app's order: sort order, then name.
    .sort((left, right) => left.sortOrder - right.sortOrder
      || (left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0));

/** Sessions completed inside the read, by the profile's calendar. */
const inRead = (training: StatusTraining, window: TrainingStatusWindow, timeZone: string) =>
  training.sessions.flatMap((session) => {
    const completedAt = zonedWallClock(new Date(session.completed_at), timeZone);
    return completedAt >= window.readStart && completedAt < window.readEnd ? [{ session, completedAt }] : [];
  });

/** The rows as the app's muscle aggregation reads them, dated on the profile's clock. */
export const statusMuscleInput = (
  training: StatusTraining, mappings: readonly StatusMappingRow[], muscleRows: readonly MuscleReportRow[],
  window: TrainingStatusWindow, timeZone: string,
): MuscleAnalyticsInput => ({
  sessions: inRead(training, window, timeZone).map(({ session, completedAt }) => ({ id: session.id, completedAt })),
  sessionExercises: training.blocks.map((block) => ({
    id: block.id, sessionId: block.session_id, exerciseDefinitionId: block.exercise_definition_id,
  })),
  exerciseSets: training.sets.map((set) => ({
    id: set.id, sessionExerciseId: set.session_exercise_id, orderIndex: set.order_index,
    setType: set.set_type, weightValue: set.weight_value, repsValue: set.reps_value,
    performanceStatus: set.performance_status as SessionSetPerformanceStatus,
  })),
  muscleMappings: mappings.map((mapping) => ({
    exerciseDefinitionId: mapping.exercise_definition_id,
    muscleGroupId: mapping.muscle_group_id,
    role: (mapping.role !== null && ROLES.has(mapping.role) ? mapping.role : null) as MuscleContributionRole,
  })),
  muscleGroups: muscleRows.map(({ id, displayName, familyName, sortOrder }) => ({ id, displayName, familyName, sortOrder })),
});

const sumDays = (byDay: Record<string, number>, from: Date, to: Date): number => {
  const start = localDateKey(from);
  const end = localDateKey(to);
  return Object.entries(byDay).reduce((total, [key, sets]) => (key >= start && key < end ? total + sets : total), 0);
};

/**
 * Each of the user's muscles in Today's Plan's order with its figures: the
 * same counting (`withoutSecondaryMappings` per the switch, `applyMuscleReport`,
 * `aggregateMuscleDailySets`) and the same rows (`deriveRecoveryRows`).
 */
export const deriveStatusMuscles = (
  input: MuscleAnalyticsInput, muscleRows: readonly MuscleReportRow[], settings: StatusSettings,
  window: TrainingStatusWindow,
) => {
  const setup = deriveMuscleReportPreset(muscleRows);
  const counted = settings.countSecondary ? input : withoutSecondaryMappings(input);
  const daily = aggregateMuscleDailySets(applyMuscleReport(counted, buildMuscleReportAssignment(muscleRows)));
  const rows = deriveRecoveryRows(daily, window.plan, {
    weeklyTarget: settings.preferences.weeklyWorkingSetTarget,
    overrides: effectiveMuscleTargetOverrides(settings.preferences, setup),
  });
  const familyById = new Map(daily.muscles.map((muscle) => [muscle.id, muscle.familyName]));
  const muscles = rows.map((row) => {
    const byDay = daily.sets[row.muscleGroupId] ?? {};
    const trainedDays = Object.keys(byDay).sort();
    return {
      id: row.muscleGroupId,
      name: row.name,
      family: familyById.get(row.muscleGroupId) ?? null,
      weekly_target: row.target,
      week_sets: row.weekSets,
      recovery_days: row.days.map((sets, index) => ({ date: localDateKey(window.plan.recoveryDays[index]), sets })),
      today_sets: row.today,
      last_trained_on: trainedDays.length > 0 ? trainedDays[trainedDays.length - 1] : null,
      weekly_sets_last_4_weeks: window.pastWeeks.map((week) => ({
        week_start: localDateKey(week.start), sets: sumDays(byDay, week.start, week.end),
      })),
    };
  });
  return { setup, muscles };
};

type ExerciseSession = ReturnType<typeof projectTrainingSets> & {
  session: StatusSessionRow; completedAt: Date; exerciseId: string;
};

/**
 * One row per completed session and exercise with at least one working set:
 * the exercise's blocks in that session projected together (bodyweight-aware),
 * so a split-by-gym exercise reports the whole exercise. Sessions are folded in
 * record order (`completed_at`, then id).
 */
const exerciseSessions = (
  training: StatusTraining, definitions: ReadonlyMap<string, StatusDefinitionRow>,
  calculationsEnabled: boolean, timeZone: string,
): ExerciseSession[] => {
  const sessionById = new Map(training.sessions.map((session) => [session.id, session]));
  const setsByBlock = new Map<string, StatusSetRow[]>();
  for (const set of training.sets) setsByBlock.set(set.session_exercise_id, [...(setsByBlock.get(set.session_exercise_id) ?? []), set]);
  const grouped = new Map<string, { session: StatusSessionRow; exerciseId: string; sets: StatusSetRow[] }>();
  // Session order (block, then set) decides a tie between sets.
  const blocks = [...training.blocks].sort((left, right) => left.order_index - right.order_index || left.id.localeCompare(right.id));
  for (const block of blocks) {
    const session = sessionById.get(block.session_id);
    if (!session || block.exercise_definition_id === null) continue;
    const key = JSON.stringify([session.id, block.exercise_definition_id]);
    const entry = grouped.get(key) ?? { session, exerciseId: block.exercise_definition_id, sets: [] };
    entry.sets.push(...(setsByBlock.get(block.id) ?? []));
    grouped.set(key, entry);
  }
  return [...grouped.values()]
    .map(({ session, exerciseId, sets }) => ({
      session, exerciseId,
      completedAt: zonedWallClock(new Date(session.completed_at), timeZone),
      ...projectTrainingSets(sets, definitions.get(exerciseId) ?? null, session, calculationsEnabled),
    }))
    .filter((row) => row.workingSetCount > 0)
    .sort((left, right) => left.session.completed_at - right.session.completed_at || left.session.id.localeCompare(right.session.id));
};

export type FavouriteExercise = {
  exerciseId: string; name: string; sessions: number; lastDoneAt: Date;
  bestLast28: number | null; bestPrevious28: number | null;
};

const maxOf = (current: number | null, value: number | null) =>
  value === null ? current : current === null ? value : Math.max(current, value);

/**
 * The coach's favourites: the live exercises with the most completed sessions
 * holding a working set in the last 28 days, then the latest done, then name.
 * Each carries its best estimated 1RM in that window and the 28 days before.
 */
export const rankFavouriteExercises = (
  training: StatusTraining, definitions: ReadonlyMap<string, StatusDefinitionRow>,
  calculationsEnabled: boolean, window: TrainingStatusWindow, timeZone: string,
): FavouriteExercise[] => {
  const byExercise = new Map<string, FavouriteExercise>();
  for (const row of exerciseSessions(training, definitions, calculationsEnabled, timeZone)) {
    const definition = definitions.get(row.exerciseId);
    if (!definition || definition.deleted_at !== null) continue;
    if (row.completedAt < window.readStart || row.completedAt >= window.readEnd) continue;
    const entry = byExercise.get(row.exerciseId) ?? {
      exerciseId: row.exerciseId, name: definition.name, sessions: 0, lastDoneAt: row.completedAt,
      bestLast28: null, bestPrevious28: null,
    };
    if (row.completedAt >= window.last28Start) {
      entry.sessions += 1;
      entry.bestLast28 = maxOf(entry.bestLast28, row.estimatedOneRepMax);
    } else {
      entry.bestPrevious28 = maxOf(entry.bestPrevious28, row.estimatedOneRepMax);
    }
    if (row.completedAt > entry.lastDoneAt) entry.lastDoneAt = row.completedAt;
    byExercise.set(row.exerciseId, entry);
  }
  return [...byExercise.values()]
    .filter((entry) => entry.sessions > 0)
    .sort((left, right) => right.sessions - left.sessions
      || right.lastDoneAt.getTime() - left.lastDoneAt.getTime()
      || left.name.localeCompare(right.name)
      || left.exerciseId.localeCompare(right.exerciseId))
    .slice(0, FAVOURITE_EXERCISE_LIMIT);
};

/**
 * The local date of each exercise's latest record session: the last session
 * whose 1RM, Weight or Volume beat the whole exercise's record so far (the
 * app's record book). A history read that hit its cap has no Volume record,
 * as in `get_exercise_context`.
 */
export const lastRecordDates = (
  history: StatusTraining, definitions: ReadonlyMap<string, StatusDefinitionRow>,
  calculationsEnabled: boolean, historyComplete: boolean, timeZone: string,
): Map<string, string> => {
  const books = new Map<string, ReturnType<typeof createRecordBook>>();
  const lastRecord = new Map<string, string>();
  for (const row of exerciseSessions(history, definitions, calculationsEnabled, timeZone)) {
    const book = books.get(row.exerciseId) ?? createRecordBook();
    books.set(row.exerciseId, book);
    const total = row.volumeCoverage.totalVolumeKgReps;
    const flags = book.add({
      oneRepMax: row.estimatedOneRepMax === null ? null : { value: row.estimatedOneRepMax },
      weight: row.topWeightSet,
      volume: total === null || !historyComplete ? null : { value: total },
    });
    if (flags.oneRepMax || flags.weight || flags.volume) lastRecord.set(row.exerciseId, localDateKey(row.completedAt));
  }
  return lastRecord;
};

export type TrainingStatusInput = {
  now: Date;
  timeZone: string;
  settings: StatusSettingsRow | null;
  muscleRows: readonly StatusMuscleRow[];
  mappings: readonly StatusMappingRow[];
  training: StatusTraining;
  definitions: ReadonlyMap<string, StatusDefinitionRow>;
  favourites: readonly FavouriteExercise[];
  /** The favourites' all-time sessions, for their record dates. */
  history: StatusTraining;
  historyComplete: boolean;
  calculationsEnabled: boolean;
  /** False when any read hit its cap. */
  complete: boolean;
};

export const buildTrainingStatus = (input: TrainingStatusInput) => {
  const window = trainingStatusWindow(input.now, input.timeZone);
  const settings = statusSettings(input.settings);
  const muscleRows = asMuscleReportRows(input.muscleRows);
  const { setup, muscles } = deriveStatusMuscles(
    statusMuscleInput(input.training, input.mappings, muscleRows, window, input.timeZone), muscleRows, settings, window,
  );
  const records = lastRecordDates(input.history, input.definitions, input.calculationsEnabled, input.historyComplete, input.timeZone);
  return {
    metric_revision: METRIC_REVISION,
    as_of: input.now.toISOString(),
    time_zone: input.timeZone,
    today: localDateKey(window.plan.today),
    week_start: localDateKey(window.plan.week.start),
    muscle_setup: setup,
    counts_secondary_sets: settings.countSecondary,
    targets: {
      mode: settings.preferences.muscleTargetMode === 'per-muscle' ? 'per_muscle' : 'single',
      default_weekly_sets: settings.preferences.weeklyWorkingSetTarget,
      uploaded: settings.uploaded,
      revision: settings.revision,
    },
    muscles,
    favourite_exercises: input.favourites.map((favourite) => ({
      exercise_id: favourite.exerciseId,
      name: favourite.name,
      sessions_28d: favourite.sessions,
      last_done_on: localDateKey(favourite.lastDoneAt),
      best_e1rm_kg: { last_28d: favourite.bestLast28, previous_28d: favourite.bestPrevious28 },
      last_record_on: records.get(favourite.exerciseId) ?? null,
    })),
    complete: input.complete && input.historyComplete,
  };
};
