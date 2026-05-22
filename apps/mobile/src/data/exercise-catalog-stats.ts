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

export type ExerciseCatalogStats = {
  aggregatesById: Map<string, ExerciseAggregate>;
  everDoneIds: Set<string>;
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

const WARM_UP_SET_TYPE = 'warm_up';

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
            .where(inArray(sessionExercises.sessionId, sessionIds))
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
            .where(inArray(exerciseSets.sessionExerciseId, sessionExerciseIds))
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

export const aggregateExerciseCatalogStats = (
  raw: ExerciseCatalogStatsRawHistory,
  period: ExerciseCatalogStatsPeriod,
  now: Date = new Date()
): ExerciseCatalogStats => {
  const window = resolvePeriodWindow(period, now);

  const sessionInWindow = new Map<string, boolean>();
  for (const session of raw.sessions) {
    sessionInWindow.set(session.id, isInWindow(session.completedAt, window));
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
  const sessionsSeenByDef = new Map<string, Set<string>>();

  for (const set of raw.exerciseSets) {
    if ((set.setType ?? null) === WARM_UP_SET_TYPE) continue;

    const link = sessionExerciseById.get(set.sessionExerciseId);
    if (!link || link.exerciseDefinitionId === null) continue;

    const defId = link.exerciseDefinitionId;
    everDoneIds.add(defId);

    if (!sessionInWindow.get(link.sessionId)) continue;

    const parsed = parseCalculationSet({
      weightValue: set.weightValue,
      repsValue: set.repsValue,
      setType: set.setType,
    });
    if (parsed === null) continue;

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

  return { aggregatesById, everDoneIds };
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
