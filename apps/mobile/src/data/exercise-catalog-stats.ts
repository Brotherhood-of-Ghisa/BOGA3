import { and, eq, inArray, isNull } from 'drizzle-orm';

import {
  estimateOneRepMax,
  parseCalculationSet,
} from '@/src/exercise-calculations';

import { bootstrapLocalDataLayer } from './bootstrap';
import { exerciseSets, sessionExercises, sessions } from './schema';
import { computePeriodBounds, type StatsPeriodDays } from './stats';

export type ExerciseCatalogStatsPeriod = 'all' | StatsPeriodDays;

export type ExerciseAggregate = {
  exerciseDefinitionId: string;
  sessionCount: number;
  totalVolume: number;
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
  sessions: { id: string; completedAt: Date }[];
  sessionExercises: { id: string; sessionId: string; exerciseDefinitionId: string | null }[];
  exerciseSets: {
    sessionExerciseId: string;
    weightValue: string;
    repsValue: string;
    setType: string | null;
  }[];
};

export type ExerciseCatalogStatsStore = {
  loadRawHistory(): Promise<ExerciseCatalogStatsRawHistory>;
};

export const createDrizzleExerciseCatalogStatsStore = (): ExerciseCatalogStatsStore => ({
  async loadRawHistory() {
    const database = await bootstrapLocalDataLayer();

    const sessionRows = database
      .select({
        id: sessions.id,
        completedAt: sessions.completedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.status, 'completed'), isNull(sessions.deletedAt)))
      .all();

    const sessionsCompleted = sessionRows
      .filter((row): row is { id: string; completedAt: Date } => row.completedAt !== null)
      .map((row) => ({ id: row.id, completedAt: row.completedAt }));

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

    return {
      sessions: sessionsCompleted,
      sessionExercises: sessionExerciseRows,
      exerciseSets: exerciseSetRows.map((row) => ({
        sessionExerciseId: row.sessionExerciseId,
        weightValue: row.weightValue,
        repsValue: row.repsValue,
        setType: row.setType ?? null,
      })),
    };
  },
});

type PeriodWindow = { start: Date | null; end: Date | null };

const RECENCY_HALF_LIFE_DAYS = 60;
const ALL_RECENCY_SCORE_CAP_DAYS = 365;
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

const resolveRecencyScoringWindow = (
  period: ExerciseCatalogStatsPeriod,
  now: Date
): PeriodWindow => {
  if (period === 'all') {
    return {
      start: new Date(now.getTime() - ALL_RECENCY_SCORE_CAP_DAYS * MS_PER_DAY),
      end: new Date(now.getTime()),
    };
  }

  return resolvePeriodWindow(period, now);
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
  const recencyWindow = resolveRecencyScoringWindow(period, now);

  for (const set of raw.exerciseSets) {
    const link = sessionExerciseById.get(set.sessionExerciseId);
    if (!link || link.exerciseDefinitionId === null) continue;

    const defId = link.exerciseDefinitionId;
    everDoneIds.add(defId);

    const completedAt = sessionCompletedAt.get(link.sessionId) ?? null;
    if (completedAt) {
      const existing = lastCompletedAtById.get(defId);
      if (!existing || completedAt > existing) {
        lastCompletedAtById.set(defId, completedAt);
      }
    }

    if (!sessionInWindow.get(link.sessionId)) continue;

    const parsed = parseCalculationSet({
      weightValue: set.weightValue,
      repsValue: set.repsValue,
      setType: set.setType,
    });
    if (parsed === null) continue;

    if (completedAt && isInWindow(completedAt, recencyWindow)) {
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

    let aggregate = aggregatesById.get(defId);
    if (!aggregate) {
      aggregate = {
        exerciseDefinitionId: defId,
        sessionCount: 0,
        totalVolume: 0,
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

    aggregate.totalVolume += parsed.weight * parsed.reps;

    const oneRm = estimateOneRepMax(parsed.weight, parsed.reps);
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
