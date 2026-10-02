import { loadAsOfWeightResolver } from './bodyweight';
import type { SessionWeightContext } from '@/src/bodyweight/as-of';
import { and, eq, inArray, isNull } from 'drizzle-orm';


import { addFiniteVolume, calculateAnalyticsSetMetrics, personalLoadContext } from '@/src/exercise-calculations/analytics';
import type { LoadInputMode } from '@/src/exercise-calculations/load-metrics';
import {
  isConfirmedPerformedSet,
  normalizeSessionSetPerformanceStatus,
  type SessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

import { bootstrapLocalDataLayer } from './bootstrap';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessions, userSettings } from './schema';
import { isWorkingSessionSetType } from './set-types';
import { computePeriodBounds, type StatsPeriodDays } from './stats';

export type ExerciseCatalogStatsPeriod = 'all' | StatsPeriodDays;

export type ExerciseAggregate = {
  exerciseDefinitionId: string;
  sessionCount: number;
  setCount: number;
  nearFailureCount: number;
  totalVolume: number | null;
  knownVolume?: number | null;
  estimatedOneRepMax: number | null;
};

export type ExerciseRecencyScore = {
  exerciseDefinitionId: string;
  score: number;
  completedSetCount: number;
  lastCompletedAt: Date | null;
};

export type ExerciseCatalogStats = {
  aggregatesById: Map<string, ExerciseAggregate>;
  recencyScoresById: Map<string, ExerciseRecencyScore>;
  everDoneIds: Set<string>;
  lastCompletedAtById: Map<string, Date>;
};

export type ExerciseCatalogStatsRawHistory = {
  sessions: ({ id: string; completedAt: Date } & SessionWeightContext)[];
  bodyweightCalculationsEnabled?: boolean;
  exerciseDefinitions?: { id: string; bodyweightContribution: number; loadInputMode: LoadInputMode }[];
  sessionExercises: { id: string; sessionId: string; exerciseDefinitionId: string | null }[];
  exerciseSets: {
    sessionExerciseId: string;
    weightValue: string;
    repsValue: string;
    setType: string | null;
    performanceStatus?: SessionSetPerformanceStatus;
  }[];
};

export type ExerciseCatalogStatsStore = {
  loadRawHistory(): Promise<ExerciseCatalogStatsRawHistory>;
};

export const createDrizzleExerciseCatalogStatsStore = (): ExerciseCatalogStatsStore => ({
  async loadRawHistory() {
    const database = await bootstrapLocalDataLayer();
    const resolveWeight = loadAsOfWeightResolver(database);
    const bodyweightCalculationsEnabled = database
      .select({ enabled: userSettings.bodyweightCalculationsEnabled })
      .from(userSettings)
      .where(eq(userSettings.id, 'settings'))
      .get()?.enabled ?? false;

    const storedSessionRows = database
      .select({
        id: sessions.id,
        completedAt: sessions.completedAt,
        startedAt: sessions.startedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.status, 'completed'), isNull(sessions.deletedAt)))
      .all();

    const sessionRows = storedSessionRows.map(row => ({ ...row, ...resolveWeight(row.startedAt) }));

    const sessionsCompleted = sessionRows
      .filter((row): row is typeof row & { completedAt: Date } => row.completedAt !== null)
      .map((row) => ({ ...row, completedAt: row.completedAt }));

    const sessionIds = sessionsCompleted.map((row) => row.id);
    const sessionExerciseRows =
      sessionIds.length > 0
        ? database
            .select({
              id: sessionExercises.id,
              sessionId: sessionExercises.sessionId,
              exerciseDefinitionId: sessionExercises.exerciseDefinitionId,
            })
            .from(sessionExercises)
            .where(
              and(
                inArray(sessionExercises.sessionId, sessionIds),
                // Exclude exercises the user removed (kept as tombstones).
                isNull(sessionExercises.deletedAt)
              )
            )
            .all()
        : [];

    const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
    const exerciseSetRows =
      sessionExerciseIds.length > 0
        ? database
            .select({
              sessionExerciseId: exerciseSets.sessionExerciseId,
              weightValue: exerciseSets.weightValue,
              repsValue: exerciseSets.repsValue,
              setType: exerciseSets.setType,
              performanceStatus: exerciseSets.performanceStatus,
            })
            .from(exerciseSets)
            .where(
              and(
                inArray(exerciseSets.sessionExerciseId, sessionExerciseIds),
                // Exclude sets the user removed (kept as tombstones).
                isNull(exerciseSets.deletedAt)
              )
            )
            .all()
        : [];

    const definitionIds = [...new Set(sessionExerciseRows.map(row => row.exerciseDefinitionId).filter((id): id is string => id !== null))];
    const definitions = definitionIds.length ? database.select().from(exerciseDefinitions)
      .where(inArray(exerciseDefinitions.id, definitionIds)).all() : [];
    return {
      bodyweightCalculationsEnabled,
      exerciseDefinitions: definitions,
      sessions: sessionsCompleted,
      sessionExercises: sessionExerciseRows,
      exerciseSets: exerciseSetRows.map((row) => ({
        sessionExerciseId: row.sessionExerciseId,
        weightValue: row.weightValue,
        repsValue: row.repsValue,
        setType: row.setType ?? null,
        performanceStatus: normalizeSessionSetPerformanceStatus(row.performanceStatus),
      })),
    };
  },
});

type PeriodWindow = { start: Date | null; end: Date | null };

const RECENCY_HALF_LIFE_DAYS = 60;
const FAVOURITE_WINDOW_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const resolvePeriodWindow = (
  period: ExerciseCatalogStatsPeriod,
  now: Date
): PeriodWindow => {
  if (period === 'all') return { start: null, end: null };
  const bounds = computePeriodBounds(period, now);
  return { start: bounds.start, end: bounds.end };
};

const isInWindow = (completedAt: Date, window: PeriodWindow): boolean => {
  if (window.start && completedAt < window.start) return false;
  if (window.end && completedAt >= window.end) return false;
  return true;
};

const computeSetRecencyScore = (completedAt: Date, now: Date): number => {
  const ageDays = Math.max(0, (now.getTime() - completedAt.getTime()) / MS_PER_DAY);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
};

export const aggregateExerciseCatalogStats = (
  raw: ExerciseCatalogStatsRawHistory,
  period: ExerciseCatalogStatsPeriod,
  now: Date = new Date()
): ExerciseCatalogStats => {
  const window = resolvePeriodWindow(period, now);

  const sessionById = new Map(raw.sessions.map(row => [row.id, row]));
  const definitionById = new Map((raw.exerciseDefinitions ?? []).map(row => [row.id, row]));
  const sessionInWindow = new Map<string, boolean>();
  const sessionCompletedAt = new Map<string, Date>();
  for (const session of raw.sessions) {
    sessionInWindow.set(session.id, isInWindow(session.completedAt, window));
    sessionCompletedAt.set(session.id, session.completedAt);
  }

  type SessionExerciseLookup = { sessionId: string; exerciseDefinitionId: string | null };
  const sessionExerciseById = new Map<string, SessionExerciseLookup>();
  for (const row of raw.sessionExercises) {
    sessionExerciseById.set(row.id, {
      sessionId: row.sessionId,
      exerciseDefinitionId: row.exerciseDefinitionId,
    });
  }

  const everDoneIds = new Set<string>();
  const aggregatesById = new Map<string, ExerciseAggregate>();
  const recencyScoresById = new Map<string, ExerciseRecencyScore>();
  const lastCompletedAtById = new Map<string, Date>();
  const sessionsSeenByDef = new Map<string, Set<string>>();
  const favouriteStart = now.getTime() - FAVOURITE_WINDOW_DAYS * MS_PER_DAY;

  for (const set of raw.exerciseSets) {
    if (
      !isConfirmedPerformedSet({
        reps: set.repsValue,
        weight: set.weightValue,
        performanceStatus: set.performanceStatus,
      })
    ) {
      continue;
    }

    const link = sessionExerciseById.get(set.sessionExerciseId);
    if (!link || link.exerciseDefinitionId === null) continue;

    const defId = link.exerciseDefinitionId;
    const completedAt = sessionCompletedAt.get(link.sessionId);
    if (!completedAt) continue;
    const metric = calculateAnalyticsSetMetrics({
      ...set,
      ...personalLoadContext(
        raw.bodyweightCalculationsEnabled ?? false,
        definitionById.get(defId),
        sessionById.get(link.sessionId),
      ),
    });
    if (!metric.eligible) continue;

    // All browser history uses the same eligible sets as Favourite and counts.
    everDoneIds.add(defId);
    const previousUse = lastCompletedAtById.get(defId);
    if (!previousUse || completedAt > previousUse) {
      lastCompletedAtById.set(defId, completedAt);
    }

    // Favourite is independent of the Stats screen's selected metric period.
    if (completedAt.getTime() >= favouriteStart && completedAt <= now) {
      let recency = recencyScoresById.get(defId);
      if (!recency) {
        recency = {
          exerciseDefinitionId: defId,
          score: 0,
          completedSetCount: 0,
          lastCompletedAt: null,
        };
        recencyScoresById.set(defId, recency);
      }
      recency.score += computeSetRecencyScore(completedAt, now);
      recency.completedSetCount += 1;
      if (recency.lastCompletedAt === null || completedAt > recency.lastCompletedAt) {
        recency.lastCompletedAt = completedAt;
      }
    }

    if (!sessionInWindow.get(link.sessionId)) continue;

    let aggregate = aggregatesById.get(defId);
    if (!aggregate) {
      aggregate = {
        exerciseDefinitionId: defId,
        sessionCount: 0,
        setCount: 0,
        nearFailureCount: 0,
        totalVolume: 0,
        knownVolume: 0,
        estimatedOneRepMax: null,
      };
      aggregatesById.set(defId, aggregate);
    }

    let sessionsSeen = sessionsSeenByDef.get(defId);
    if (!sessionsSeen) {
      sessionsSeen = new Set<string>();
      sessionsSeenByDef.set(defId, sessionsSeen);
    }
    if (!sessionsSeen.has(link.sessionId)) {
      sessionsSeen.add(link.sessionId);
      aggregate.sessionCount += 1;
    }

    aggregate.setCount += 1;
    if (isWorkingSessionSetType(set.setType)) {
      aggregate.nearFailureCount += 1;
    }

    aggregate.knownVolume = addFiniteVolume(aggregate.knownVolume, metric.volumeKgReps ?? 0);
    aggregate.totalVolume = addFiniteVolume(aggregate.totalVolume, metric.volumeKgReps);

    const oneRm = metric.estimatedOneRepMaxKg;
    if (
      oneRm !== null &&
      (aggregate.estimatedOneRepMax === null || oneRm > aggregate.estimatedOneRepMax)
    ) {
      aggregate.estimatedOneRepMax = oneRm;
    }
  }

  return { aggregatesById, recencyScoresById, everDoneIds, lastCompletedAtById };
};

export const createExerciseCatalogStatsRepository = (
  store: ExerciseCatalogStatsStore = createDrizzleExerciseCatalogStatsStore()
) => ({
  async load(period: ExerciseCatalogStatsPeriod, now: Date = new Date()): Promise<ExerciseCatalogStats> {
    const raw = await store.loadRawHistory();
    return aggregateExerciseCatalogStats(raw, period, now);
  },
  async loadRawHistory(): Promise<ExerciseCatalogStatsRawHistory> {
    return store.loadRawHistory();
  },
});

const defaultExerciseCatalogStatsRepository = createExerciseCatalogStatsRepository();

export const loadExerciseCatalogStats = defaultExerciseCatalogStatsRepository.load;
export const loadExerciseCatalogStatsRawHistory =
  defaultExerciseCatalogStatsRepository.loadRawHistory;
