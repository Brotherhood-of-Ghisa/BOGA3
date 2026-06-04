import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import {
  estimateOneRepMax,
  parseSetReps,
  parseSetWeight,
} from '@/src/exercise-calculations';

import { bootstrapLocalDataLayer } from './bootstrap';
import type { SelectedMuscleWeeklyEffort } from './muscle-analytics';
import { exerciseSets, sessionExercises, sessions } from './schema';

// Same shape as SelectedMuscleWeeklyEffort; aliased to allow CalendarHeatmap reuse without casts.
export type SelectedExerciseWeeklyEffort = SelectedMuscleWeeklyEffort;

type ExerciseRawSet = {
  setType: string | null;
  weightValue: string;
  repsValue: string;
};

export type ExerciseRawSession = {
  completedAt: Date;
  sets: ExerciseRawSet[];
};

const WARM_UP_SET_TYPE = 'warm_up';
const NEAR_FAILURE_SET_TYPES = new Set(['rir_0', 'rir_1', 'rir_2']);

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
  totalVolume: number;
  nearFailureCount: number;
  bestRM1: number | null;
  highestWeight: number | null;
};

type WeekAccumulator = {
  weekStartDateKey: string;
  monthKey: string;
  totalVolume: number;
  nearFailureCount: number;
  bestRM1: number | null;
  highestWeight: number | null;
};

export const aggregateExerciseWeeklyEffort = (
  rawSessions: ExerciseRawSession[],
  timeZone?: string
): SelectedExerciseWeeklyEffort[] => {
  const dayMap = new Map<string, DayAccumulator>();

  for (const session of rawSessions) {
    const dateKey = formatLocalDateKey(session.completedAt, timeZone);
    const day: DayAccumulator = dayMap.get(dateKey) ?? {
      totalVolume: 0,
      nearFailureCount: 0,
      bestRM1: null,
      highestWeight: null,
    };

    for (const set of session.sets) {
      if (set.setType === WARM_UP_SET_TYPE) continue;

      const weight = parseSetWeight(set.weightValue);
      const reps = parseSetReps(set.repsValue);
      if (weight === null || reps === null) continue;

      day.totalVolume += weight * reps;

      if (set.setType !== null && NEAR_FAILURE_SET_TYPES.has(set.setType)) {
        day.nearFailureCount += 1;
      }

      day.highestWeight =
        day.highestWeight === null ? weight : Math.max(day.highestWeight, weight);

      const rm1 = estimateOneRepMax(weight, reps);
      if (rm1 !== null) {
        day.bestRM1 = day.bestRM1 === null ? rm1 : Math.max(day.bestRM1, rm1);
      }
    }

    dayMap.set(dateKey, day);
  }

  const weekMap = new Map<string, WeekAccumulator>();

  for (const [dateKey, day] of dayMap) {
    const dayDate = dateKeyToUtcDate(dateKey);
    const weekStart = startOfMondayWeek(dayDate);
    const weekStartDateKey = formatUtcDateKey(weekStart);
    const monthKey = `${weekStart.getUTCFullYear().toString().padStart(4, '0')}-${(weekStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;

    const acc: WeekAccumulator = weekMap.get(weekStartDateKey) ?? {
      weekStartDateKey,
      monthKey,
      totalVolume: 0,
      nearFailureCount: 0,
      bestRM1: null,
      highestWeight: null,
    };

    acc.totalVolume += day.totalVolume;
    acc.nearFailureCount += day.nearFailureCount;

    if (day.highestWeight !== null) {
      acc.highestWeight =
        acc.highestWeight === null
          ? day.highestWeight
          : Math.max(acc.highestWeight, day.highestWeight);
    }

    if (day.bestRM1 !== null) {
      acc.bestRM1 =
        acc.bestRM1 === null ? day.bestRM1 : Math.max(acc.bestRM1, day.bestRM1);
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

    if (weekOfMonth > 4) continue;

    result.push({
      weekStartDateKey: week.weekStartDateKey,
      monthKey: week.monthKey,
      weekOfMonth,
      totalVolume: week.totalVolume,
      nearFailureCount: week.nearFailureCount,
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

export const computeSelectedExerciseWeeklyEffort = async (
  options: ComputeSelectedExerciseWeeklyEffortOptions
): Promise<SelectedExerciseWeeklyEffort[]> => {
  const database = await bootstrapLocalDataLayer();

  const sessionRows = database
    .select({ id: sessions.id, completedAt: sessions.completedAt })
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

  const sessionCompletedRows = sessionRows.filter(
    (row): row is { id: string; completedAt: Date } => row.completedAt !== null
  );

  const sessionIds = sessionCompletedRows.map((row) => row.id);
  if (sessionIds.length === 0) return [];

  const sessionExerciseRows = database
    .select({ id: sessionExercises.id, sessionId: sessionExercises.sessionId })
    .from(sessionExercises)
    .where(
      and(
        inArray(sessionExercises.sessionId, sessionIds),
        eq(sessionExercises.exerciseDefinitionId, options.exerciseDefinitionId)
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
    })
    .from(exerciseSets)
    .where(inArray(exerciseSets.sessionExerciseId, sessionExerciseIds))
    .all();

  const completedAtBySessionId = new Map(
    sessionCompletedRows.map((row) => [row.id, row.completedAt])
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
    });
    setsByExerciseId.set(set.sessionExerciseId, existing);
  }

  const rawSessions: ExerciseRawSession[] = [];
  for (const seRow of sessionExerciseRows) {
    const sessionId = sessionIdByExerciseId.get(seRow.id);
    if (!sessionId) continue;
    const completedAt = completedAtBySessionId.get(sessionId);
    if (!completedAt) continue;
    rawSessions.push({
      completedAt,
      sets: setsByExerciseId.get(seRow.id) ?? [],
    });
  }

  return aggregateExerciseWeeklyEffort(rawSessions, options.timeZone);
};
