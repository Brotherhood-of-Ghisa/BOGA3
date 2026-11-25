import { personalCalculationContext } from '@/src/config/personal-effort';
import { loadAsOfWeightResolver } from './bodyweight';
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import {
  addFiniteVolume, ordinaryLoadContext, summarizeExerciseLoad, workingSetsOnly,
} from '@/src/exercise-calculations/analytics';
import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import { normalizeSessionSetPerformanceStatus, type SessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';

import { bootstrapLocalDataLayer } from './bootstrap';
import { loadExerciseSessionFacts } from './exercise-session-facts';
import type { DailyEffortMetrics, SelectedMuscleWeeklyEffort } from './muscle-analytics';
import { selectDatedInProgressSession } from './in-progress-session';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions, userSettings } from './schema';
import type { GymScopeOption } from '@/src/utils/gym-scope-route';
import { exerciseScopeIds, type ExerciseReadScope } from '@/src/utils/exercise-selection';

// Same shape as SelectedMuscleWeeklyEffort; aliased to allow CalendarHeatmap reuse without casts.
export type SelectedExerciseWeeklyEffort = SelectedMuscleWeeklyEffort;

type ExerciseRawSet = {
  setType: string | null;
  weightValue: string;
  recordingMode?: 'reps' | 'hold';
  durationSec?: number | null;
  repsValue: string;
  performanceStatus?: SessionSetPerformanceStatus;
};

export type ExerciseRawSession = {
  /** The session's id; a day of history lists the sessions that made it. */
  id?: string;
  completedAt: Date;
  /** Absent reads as no gym. */
  gymId?: string | null;
  gymName?: string | null;
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
  hasRepetitionSets: boolean;
  volumeSetCount: number;
  sessionIds: string[];
  totalVolume: number | null;
  workingSetCount: number;
  bestRM1: number | null;
  highestWeight: number | null;
};

type WeekAccumulator = {
  hasRepetitionSets: boolean;
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
      hasRepetitionSets: false,
      volumeSetCount: 0,
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
    const unsupported = summary.volumeCoverage.eligibleSetCount === 0 && summary.volumeKgReps === null;
    if (unsupported) {
      if (!day.hasRepetitionSets) day.totalVolume = null;
    } else {
      if (!day.hasRepetitionSets) day.totalVolume ??= 0;
      day.hasRepetitionSets = true;
      day.totalVolume = addFiniteVolume(day.totalVolume, summary.volumeKgReps);
    }
    day.volumeSetCount += summary.volumeCoverage.eligibleSetCount;
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
      ...(day.totalVolume === null ? { volumeSetCount: day.volumeSetCount } : {}),
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
  return aggregateExerciseWeeksFromDaily(aggregateExerciseDailyEffort(rawSessions, timeZone));
};

const aggregateExerciseWeeksFromDaily = (dailyEffort: DailyEffortMetrics[]): SelectedExerciseWeeklyEffort[] => {
  const weekMap = new Map<string, WeekAccumulator>();

  for (const day of dailyEffort) {
    const dayDate = dateKeyToUtcDate(day.dateKey);
    const weekStart = startOfMondayWeek(dayDate);
    const weekStartDateKey = formatUtcDateKey(weekStart);
    const monthKey = `${weekStart.getUTCFullYear().toString().padStart(4, '0')}-${(weekStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;

    const acc: WeekAccumulator = weekMap.get(weekStartDateKey) ?? {
      hasRepetitionSets: false,
      weekStartDateKey,
      monthKey,
      totalVolume: 0,
      workingSetCount: 0,
      bestRM1: null,
      highestWeight: null,
    };

    if (day.totalVolume === null && day.volumeSetCount === 0) {
      if (!acc.hasRepetitionSets) acc.totalVolume = null;
    } else {
      if (!acc.hasRepetitionSets) acc.totalVolume ??= 0;
      acc.hasRepetitionSets = true;
      acc.totalVolume = addFiniteVolume(acc.totalVolume, day.totalVolume);
    }
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

export type ComputeSelectedExerciseWeeklyEffortOptions = ExerciseReadScope & {
  start: Date;
  end: Date;
  timeZone?: string;
  /** The read's clock: given, the workout in progress counts (§2). Its PRs do not: it has no facts. */
  now?: Date;
  /** The one gym filter, three-state (`src/utils/gym-scope-route.ts`): unset every gym. */
  gymId?: string | null;
};

export type ComputeSelectedExerciseDailyEffortOptions = ComputeSelectedExerciseWeeklyEffortOptions;

type ScopedExerciseSession = ExerciseRawSession & { exerciseDefinitionId: string | null };

const loadExerciseRawSessions = async (
  options: ComputeSelectedExerciseWeeklyEffortOptions
): Promise<ScopedExerciseSession[]> => {
  const database = await bootstrapLocalDataLayer();
  const definitionIds = exerciseScopeIds(options);
  const resolveWeight = loadAsOfWeightResolver(database);
  const bodyweightCalculationsEnabled = database
    .select({ enabled: userSettings.bodyweightCalculationsEnabled })
    .from(userSettings)
    .where(eq(userSettings.id, 'settings'))
    .get()?.enabled ?? false;

  const storedSessionRows = database
    .select({
      id: sessions.id, completedAt: sessions.completedAt, startedAt: sessions.startedAt,
      gymId: sessions.gymId, gymName: gyms.name,
    })
    .from(sessions)
    .leftJoin(gyms, eq(gyms.id, sessions.gymId))
    .where(
      and(
        eq(sessions.status, 'completed'),
        isNull(sessions.deletedAt),
        gte(sessions.completedAt, options.start),
        lt(sessions.completedAt, options.end)
      )
    )
    .all();
  const inProgress = options.now ? selectDatedInProgressSession(database, { start: options.start, end: options.end, now: options.now }) : null;
  if (inProgress) storedSessionRows.push(inProgress);

  const sessionRows = storedSessionRows.map(row => ({ ...row, ...resolveWeight(row.startedAt) }));

  const sessionCompletedRows = sessionRows.filter(
    (row): row is typeof row & { completedAt: Date } => row.completedAt !== null
  );

  const sessionIds = sessionCompletedRows.map((row) => row.id);
  if (sessionIds.length === 0) return [];

  const definitions = new Map(database.select().from(exerciseDefinitions)
    .where(inArray(exerciseDefinitions.id, [...definitionIds])).all().map(definition => [definition.id, definition]));

  const sessionExerciseRows = database
    .select({ id: sessionExercises.id, sessionId: sessionExercises.sessionId, exerciseDefinitionId: sessionExercises.exerciseDefinitionId })
    .from(sessionExercises)
    .where(
      and(
        inArray(sessionExercises.sessionId, sessionIds),
        inArray(sessionExercises.exerciseDefinitionId, [...definitionIds]),
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
      recordingMode: exerciseSets.recordingMode,
      durationSec: exerciseSets.durationSec,
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
      recordingMode: set.recordingMode,
      durationSec: set.durationSec,
      repsValue: set.repsValue,
      performanceStatus: normalizeSessionSetPerformanceStatus(set.performanceStatus),
    });
    setsByExerciseId.set(set.sessionExerciseId, existing);
  }

  const rawSessions: ScopedExerciseSession[] = [];
  for (const seRow of sessionExerciseRows) {
    const sessionId = sessionIdByExerciseId.get(seRow.id);
    if (!sessionId) continue;
    const session = sessionById.get(sessionId);
    if (!session) continue;
    rawSessions.push({
      id: session.id,
      exerciseDefinitionId: seRow.exerciseDefinitionId,
      completedAt: session.completedAt,
      gymId: session.gymId,
      gymName: session.gymName,
      loadContext: personalCalculationContext(bodyweightCalculationsEnabled, definitions.get(seRow.exerciseDefinitionId ?? ''), session),
      sets: setsByExerciseId.get(seRow.id) ?? [],
    });
  }

  return rawSessions;
};

const inGymScope = <T extends ExerciseRawSession>(rawSessions: T[], gymId: string | null | undefined): T[] =>
  gymId === undefined ? rawSessions : rawSessions.filter((session) => (session.gymId ?? null) === gymId);

/** The gyms trained at in the window, most recently first, with their session counts. */
export const exerciseHistoryGymOptions = (rawSessions: Pick<ExerciseRawSession, 'id' | 'completedAt' | 'gymId' | 'gymName'>[]): GymScopeOption[] => {
  const byGym = new Map<string | null, { option: GymScopeOption; sessionIds: Set<string>; latest: Date }>();
  for (const session of rawSessions) {
    const gymId = session.gymId ?? null;
    const entry = byGym.get(gymId) ?? { option: { gymId, name: session.gymName ?? null }, sessionIds: new Set(), latest: session.completedAt };
    entry.sessionIds.add(session.id ?? `${session.completedAt.getTime()}`);
    if (session.completedAt > entry.latest) entry.latest = session.completedAt;
    byGym.set(gymId, entry);
  }
  return [...byGym.values()]
    .sort((left, right) => right.latest.getTime() - left.latest.getTime()
      || (left.option.gymId ?? '').localeCompare(right.option.gymId ?? ''))
    .map(({ option, sessionIds }) => ({ ...option, sessionCount: sessionIds.size }));
};

export const computeSelectedExerciseWeeklyEffort = async (
  options: ComputeSelectedExerciseWeeklyEffortOptions
): Promise<SelectedExerciseWeeklyEffort[]> => {
  const rawSessions = inGymScope(await loadExerciseRawSessions(options), options.gymId);
  return aggregateExerciseWeeklyEffort(rawSessions, options.timeZone);
};

export const computeSelectedExerciseDailyEffort = async (
  options: ComputeSelectedExerciseDailyEffortOptions
): Promise<DailyEffortMetrics[]> => {
  const rawSessions = inGymScope(await loadExerciseRawSessions(options), options.gymId);
  return aggregateExerciseDailyEffort(rawSessions, options.timeZone);
};

/** One bounded workload scope, sharing a graph read across all three chart views. */
export const computeSelectedExercisesHistoryEffort = async (options: ComputeSelectedExerciseDailyEffortOptions & { exerciseDefinitionIds: readonly string[] }) => {
  const allSessions = await loadExerciseRawSessions(options);
  const rawSessions = inGymScope(allSessions, options.gymId);
  // A selection is workload, never a strength estimate or a new record book.
  const daily = aggregateExerciseDailyEffort(rawSessions, options.timeZone)
    .map(day => ({ ...day, estimatedRM1: null, highestWeight: null }));
  const weeklyByExercise = new Map(exerciseScopeIds(options).map(id => {
    const sessions = rawSessions.filter(session => session.exerciseDefinitionId === id);
    const weeks = aggregateExerciseWeeklyEffort(sessions, options.timeZone);
    return [id, new Map(weeks.map(week => [week.weekStartDateKey, week]))];
  }));
  return { daily, weekly: aggregateExerciseWeeksFromDaily(daily), gyms: exerciseHistoryGymOptions(allSessions), weeklyByExercise };
};

/**
 * All chart views share one graph read and one daily aggregation. A day's PR
 * marks are the whole exercise's (`pr_*`) while every gym is in view; with a
 * gym chosen they are each session's own (`own_pr_*`) — on a split exercise
 * that gym's book, and for no gym the whole exercise's ([[gym.split]]). `gyms` lists the window's choices, unfiltered.
 */
export const computeSelectedExerciseHistoryEffort = async (options: ComputeSelectedExerciseDailyEffortOptions & { exerciseDefinitionId: string }) => {
  const allSessions = await loadExerciseRawSessions(options);
  const rawSessions = inGymScope(allSessions, options.gymId);
  const facts = new Map((await loadExerciseSessionFacts(options.exerciseDefinitionId)).map(fact => [fact.sessionId, fact]));
  const own = options.gymId !== undefined;
  const daily = aggregateExerciseDailyEffort(rawSessions, options.timeZone).map(day => {
    const personalRecordCounts = { totalVolume: 0, estimatedRM1: 0, highestWeight: 0 };
    for (const sessionId of day.sessionIds ?? []) {
      const fact = facts.get(sessionId);
      if (!fact) continue;
      if (own ? fact.ownPrVolume : fact.prVolume) personalRecordCounts.totalVolume++;
      if (own ? fact.ownPrE1rm : fact.prE1rm) personalRecordCounts.estimatedRM1++;
      if (own ? fact.ownPrWeight : fact.prWeight) personalRecordCounts.highestWeight++;
    }
    return { ...day, personalRecordCounts };
  });
  return { daily, weekly: aggregateExerciseWeeksFromDaily(daily), gyms: exerciseHistoryGymOptions(allSessions) };
};
