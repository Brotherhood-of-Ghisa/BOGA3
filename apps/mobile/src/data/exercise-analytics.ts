import { personalCalculationContext } from '@/src/config/personal-effort';
import { loadAsOfWeightResolver } from './bodyweight';
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import {
  addFiniteVolume, ordinaryLoadContext, summarizeExerciseLoad, workingSetsOnly,
} from '@/src/exercise-calculations/analytics';
import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import { normalizeSessionSetPerformanceStatus, type SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

import { bootstrapLocalDataLayer } from './bootstrap';
import type { DailyEffortMetrics, SelectedMuscleWeeklyEffort } from './muscle-analytics';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessions, userSettings } from './schema';

// Same shape as SelectedMuscleWeeklyEffort; aliased to allow CalendarHeatmap reuse without casts.
export type SelectedExerciseWeeklyEffort = SelectedMuscleWeeklyEffort;

type ExerciseRawSet = {
  setType: string | null;
  weightValue: string;
  repsValue: string;
  performanceStatus?: SessionSetPerformanceStatus;
};

export type ExerciseRawSession = {
  /** The session's id; a day of history lists the sessions that made it. */
  id?: string;
  completedAt: Date;
  loadContext?: LoadContext;
  sets: ExerciseRawSet[];
};

const formatLocalDateKey = (date: Date, timeZone: string | undefined): string => {
  if (timeZone === undefined) {
    const year = date.getFullYear().toString().padStart(4, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${partByType.get('year')}-${partByType.get('month')}-${partByType.get('day')}`;
};

const dateKeyToUtcDate = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatUtcDateKey = (date: Date): string => {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfMondayWeek = (date: Date): Date => {
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
};

type DayAccumulator = {
  sessionIds: string[];
  totalVolume: number | null;
  workingSetCount: number;
  bestRM1: number | null;
  highestWeight: number | null;
};

type WeekAccumulator = {
  weekStartDateKey: string;
  monthKey: string;
  totalVolume: number | null;
  workingSetCount: number;
  bestRM1: number | null;
  highestWeight: number | null;
};

export const aggregateExerciseDailyEffort = (
  rawSessions: ExerciseRawSession[],
  timeZone?: string
): DailyEffortMetrics[] => {
  const dayMap = new Map<string, DayAccumulator>();

  for (const session of rawSessions) {
    const dateKey = formatLocalDateKey(session.completedAt, timeZone);
    const day: DayAccumulator = dayMap.get(dateKey) ?? {
      sessionIds: [],
      totalVolume: 0,
      workingSetCount: 0,
      bestRM1: null,
      highestWeight: null,
    };
    // Volume and working-set cells independently include selected performed sets.
    const context = session.loadContext ?? ordinaryLoadContext();
    const working = workingSetsOnly(session.sets, context.effortPolicy);
    const summary = summarizeExerciseLoad(session.sets, context);
    if (summary.volumeCoverage.eligibleSetCount === 0 && working.length === 0) continue;
    day.totalVolume = addFiniteVolume(day.totalVolume, summary.volumeKgReps);
    day.workingSetCount += working.length;
    if (summary.topWeightSet !== null) day.highestWeight = Math.max(day.highestWeight ?? 0, summary.topWeightSet.weight);
    if (summary.estimatedOneRepMax !== null) day.bestRM1 = Math.max(day.bestRM1 ?? 0, summary.estimatedOneRepMax);
    if (session.id !== undefined && !day.sessionIds.includes(session.id)) day.sessionIds.push(session.id);
    dayMap.set(dateKey, day);
  }

  return Array.from(dayMap.entries())
    .map(([dateKey, day]) => ({
      dateKey,
      sessionIds: day.sessionIds,
      totalVolume: day.totalVolume,
      workingSetCount: day.workingSetCount,
      estimatedRM1: day.bestRM1,
      highestWeight: day.highestWeight,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
};

export const aggregateExerciseWeeklyEffort = (
  rawSessions: ExerciseRawSession[],
  timeZone?: string
): SelectedExerciseWeeklyEffort[] => {
  const dailyEffort = aggregateExerciseDailyEffort(rawSessions, timeZone);
  const weekMap = new Map<string, WeekAccumulator>();

  for (const day of dailyEffort) {
    const dayDate = dateKeyToUtcDate(day.dateKey);
    const weekStart = startOfMondayWeek(dayDate);
    const weekStartDateKey = formatUtcDateKey(weekStart);
    const monthKey = `${weekStart.getUTCFullYear().toString().padStart(4, '0')}-${(weekStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;

    const acc: WeekAccumulator = weekMap.get(weekStartDateKey) ?? {
      weekStartDateKey,
      monthKey,
      totalVolume: 0,
      workingSetCount: 0,
      bestRM1: null,
      highestWeight: null,
    };

    acc.totalVolume = addFiniteVolume(acc.totalVolume, day.totalVolume);
    acc.workingSetCount += day.workingSetCount;

    if (day.highestWeight !== null) {
      acc.highestWeight =
        acc.highestWeight === null
          ? day.highestWeight
          : Math.max(acc.highestWeight, day.highestWeight);
    }

    if (day.estimatedRM1 !== null) {
      acc.bestRM1 =
        acc.bestRM1 === null ? day.estimatedRM1 : Math.max(acc.bestRM1, day.estimatedRM1);
    }

    weekMap.set(weekStartDateKey, acc);
  }

  const sortedWeeks = Array.from(weekMap.values()).sort((a, b) =>
    a.weekStartDateKey.localeCompare(b.weekStartDateKey)
  );

  const monthWeekCount = new Map<string, number>();
  const result: SelectedExerciseWeeklyEffort[] = [];

  for (const week of sortedWeeks) {
    const prev = monthWeekCount.get(week.monthKey) ?? 0;
    const weekOfMonth = prev + 1;
    monthWeekCount.set(week.monthKey, weekOfMonth);

    // Keep every training week — see aggregateSelectedMuscleWeeklyEffort.
    result.push({
      weekStartDateKey: week.weekStartDateKey,
      monthKey: week.monthKey,
      weekOfMonth,
      totalVolume: week.totalVolume,
      workingSetCount: week.workingSetCount,
      estimatedRM1: week.bestRM1,
      highestWeight: week.highestWeight,
    });
  }

  return result;
};

export type ComputeSelectedExerciseWeeklyEffortOptions = {
  exerciseDefinitionId: string;
  start: Date;
  end: Date;
  timeZone?: string;
};

export type ComputeSelectedExerciseDailyEffortOptions = ComputeSelectedExerciseWeeklyEffortOptions;

const loadExerciseRawSessions = async (
  options: ComputeSelectedExerciseWeeklyEffortOptions
): Promise<ExerciseRawSession[]> => {
  const database = await bootstrapLocalDataLayer();
  const resolveWeight = loadAsOfWeightResolver(database);
  const bodyweightCalculationsEnabled = database
    .select({ enabled: userSettings.bodyweightCalculationsEnabled })
    .from(userSettings)
    .where(eq(userSettings.id, 'settings'))
    .get()?.enabled ?? false;

  const storedSessionRows = database
    .select({ id: sessions.id, completedAt: sessions.completedAt, startedAt: sessions.startedAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.status, 'completed'),
        isNull(sessions.deletedAt),
        gte(sessions.completedAt, options.start),
        lt(sessions.completedAt, options.end)
      )
    )
    .all();

    const sessionRows = storedSessionRows.map(row => ({ ...row, ...resolveWeight(row.startedAt) }));

  const sessionCompletedRows = sessionRows.filter(
    (row): row is typeof row & { completedAt: Date } => row.completedAt !== null
  );

  const sessionIds = sessionCompletedRows.map((row) => row.id);
  if (sessionIds.length === 0) return [];

  const definition = database.select().from(exerciseDefinitions)
    .where(eq(exerciseDefinitions.id, options.exerciseDefinitionId)).get();

  const sessionExerciseRows = database
    .select({ id: sessionExercises.id, sessionId: sessionExercises.sessionId })
    .from(sessionExercises)
    .where(
      and(
        inArray(sessionExercises.sessionId, sessionIds),
        eq(sessionExercises.exerciseDefinitionId, options.exerciseDefinitionId),
        isNull(sessionExercises.deletedAt)
      )
    )
    .all();

  const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
  if (sessionExerciseIds.length === 0) return [];

  const setRows = database
    .select({
      sessionExerciseId: exerciseSets.sessionExerciseId,
      setType: exerciseSets.setType,
      weightValue: exerciseSets.weightValue,
      repsValue: exerciseSets.repsValue,
      performanceStatus: exerciseSets.performanceStatus,
    })
    .from(exerciseSets)
    .where(
      and(
        inArray(exerciseSets.sessionExerciseId, sessionExerciseIds),
        isNull(exerciseSets.deletedAt)
      )
    )
    .all();

  const sessionById = new Map(
    sessionCompletedRows.map((row) => [row.id, row])
  );
  const sessionIdByExerciseId = new Map(
    sessionExerciseRows.map((row) => [row.id, row.sessionId])
  );

  const setsByExerciseId = new Map<string, ExerciseRawSet[]>();
  for (const set of setRows) {
    const existing = setsByExerciseId.get(set.sessionExerciseId) ?? [];
    existing.push({
      setType: set.setType ?? null,
      weightValue: set.weightValue,
      repsValue: set.repsValue,
      performanceStatus: normalizeSessionSetPerformanceStatus(set.performanceStatus),
    });
    setsByExerciseId.set(set.sessionExerciseId, existing);
  }

  const rawSessions: ExerciseRawSession[] = [];
  for (const seRow of sessionExerciseRows) {
    const sessionId = sessionIdByExerciseId.get(seRow.id);
    if (!sessionId) continue;
    const session = sessionById.get(sessionId);
    if (!session) continue;
    rawSessions.push({
      id: session.id,
      completedAt: session.completedAt,
      loadContext: personalCalculationContext(bodyweightCalculationsEnabled, definition, session),
      sets: setsByExerciseId.get(seRow.id) ?? [],
    });
  }

  return rawSessions;
};

export const computeSelectedExerciseWeeklyEffort = async (
  options: ComputeSelectedExerciseWeeklyEffortOptions
): Promise<SelectedExerciseWeeklyEffort[]> => {
  const rawSessions = await loadExerciseRawSessions(options);
  return aggregateExerciseWeeklyEffort(rawSessions, options.timeZone);
};

export const computeSelectedExerciseDailyEffort = async (
  options: ComputeSelectedExerciseDailyEffortOptions
): Promise<DailyEffortMetrics[]> => {
  const rawSessions = await loadExerciseRawSessions(options);
  return aggregateExerciseDailyEffort(rawSessions, options.timeZone);
};
