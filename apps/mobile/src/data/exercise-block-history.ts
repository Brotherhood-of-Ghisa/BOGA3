import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import {
  computeExerciseVolume,
  computeMaxRepsByWeight,
  estimateExerciseOneRepMax,
  parseCalculationSet,
  parseSetReps,
  parseSetWeight,
} from '@/src/exercise-calculations';

import { bootstrapLocalDataLayer } from './bootstrap';
import { exerciseSets, sessionExercises, sessions } from './schema';
import { normalizeSessionSetType } from './set-types';

const DAY_MS = 24 * 60 * 60 * 1000;
const RIR_AT_MOST_TWO_SET_TYPES = new Set(['rir_0', 'rir_1', 'rir_2']);

export type ExerciseBlockHistorySessionRow = {
  sessionId: string;
  completedAt: Date;
};

export type ExerciseBlockHistorySessionExerciseRow = {
  sessionExerciseId: string;
  sessionId: string;
  orderIndex: number;
};

export type ExerciseBlockHistorySetRow = {
  setId: string;
  sessionExerciseId: string;
  orderIndex: number;
  weightValue: string;
  repsValue: string;
  setType: string | null;
};

export type ExerciseBlockHistoryBlock = {
  sessionId: string;
  completedAt: Date;
  daysAgo: number;
  sessionExerciseIds: string[];
  estimatedOneRepMax: number | null;
  totalVolume: number;
  highestWeight: number | null;
  rirAtMostTwoSetCount: number;
};

export type ExerciseBlockHistorySummary = {
  exerciseDefinitionId: string | null;
  limit: number | null;
  blocks: ExerciseBlockHistoryBlock[];
};

export type ExerciseBlockHistorySuggestedSet = {
  setId: string;
  sessionExerciseId: string;
  weightValue: string;
  repsValue: string;
  setType: string | null;
};

export type ExerciseBlockHistorySuggestedPlan = {
  sessionId: string;
  completedAt: Date;
  sessionExerciseIds: string[];
  sets: ExerciseBlockHistorySuggestedSet[];
};

export type ExerciseBlockHistoryAggregationInput = {
  exerciseDefinitionId?: string | null;
  limit?: number | null;
  now: Date;
  sessions: ExerciseBlockHistorySessionRow[];
  sessionExercises: ExerciseBlockHistorySessionExerciseRow[];
  setsBySessionExerciseId: Record<string, ExerciseBlockHistorySetRow[]>;
};

export type ExerciseBlockHistoryStore = {
  loadRecentCompletedSessionsForExercise(input: {
    exerciseDefinitionId: string;
    limit?: number;
  }): Promise<ExerciseBlockHistorySessionRow[]>;
  loadSessionExercisesForSessions(input: {
    exerciseDefinitionId: string;
    sessionIds: string[];
  }): Promise<ExerciseBlockHistorySessionExerciseRow[]>;
  loadSetsForSessionExercises(input: {
    sessionExerciseIds: string[];
  }): Promise<ExerciseBlockHistorySetRow[]>;
};

export type LoadRecentExerciseBlocksOptions = {
  exerciseDefinitionId: string;
  limit?: number;
  now?: Date;
};

export type LoadSuggestedExercisePlanOptions = {
  exerciseDefinitionId: string;
};

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const ensureValidDate = (value: Date, label: string) => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const normalizeLimit = (limit: number | null | undefined): number | null => {
  if (limit === undefined || limit === null) return null;
  if (!Number.isFinite(limit) || !Number.isInteger(limit)) {
    throw new Error('limit must be an integer');
  }
  if (limit < 0) {
    throw new Error('limit must be non-negative');
  }
  return limit;
};

const compareCompletedDesc = (
  left: ExerciseBlockHistorySessionRow,
  right: ExerciseBlockHistorySessionRow
) => {
  const diff = right.completedAt.getTime() - left.completedAt.getTime();
  if (diff !== 0) return diff;
  return left.sessionId.localeCompare(right.sessionId);
};

const compareSessionExerciseOrder = (
  left: ExerciseBlockHistorySessionExerciseRow,
  right: ExerciseBlockHistorySessionExerciseRow
) => {
  if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
  return left.sessionExerciseId.localeCompare(right.sessionExerciseId);
};

const compareSetOrder = (
  left: ExerciseBlockHistorySetRow,
  right: ExerciseBlockHistorySetRow
) => {
  if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
  return left.setId.localeCompare(right.setId);
};

const groupSessionExercisesBySessionId = (
  rows: ExerciseBlockHistorySessionExerciseRow[]
): Record<string, ExerciseBlockHistorySessionExerciseRow[]> => {
  const grouped: Record<string, ExerciseBlockHistorySessionExerciseRow[]> = {};
  for (const row of rows) {
    const bucket = grouped[row.sessionId];
    if (bucket) {
      bucket.push(row);
    } else {
      grouped[row.sessionId] = [row];
    }
  }
  return grouped;
};

const computeDaysAgo = (completedAt: Date, now: Date): number => {
  const diff = now.getTime() - completedAt.getTime();
  return Math.max(0, Math.floor(diff / DAY_MS));
};

const countRirAtMostTwoSets = (setRows: ExerciseBlockHistorySetRow[]): number => {
  let count = 0;
  for (const row of setRows) {
    const setType = normalizeSessionSetType(row.setType);
    if (!setType || !RIR_AT_MOST_TWO_SET_TYPES.has(setType)) continue;
    if (parseCalculationSet(row) === null) continue;
    count += 1;
  }
  return count;
};

const isValidSuggestedPlanSet = (row: ExerciseBlockHistorySetRow): boolean =>
  parseSetWeight(row.weightValue) !== null && parseSetReps(row.repsValue) !== null;

export const aggregateExerciseBlockHistory = (
  input: ExerciseBlockHistoryAggregationInput
): ExerciseBlockHistorySummary => {
  ensureValidDate(input.now, 'now');
  const limit = normalizeLimit(input.limit);
  const sessionExercisesBySessionId = groupSessionExercisesBySessionId(input.sessionExercises);
  const orderedSessions = [...input.sessions].sort(compareCompletedDesc);
  const sessionsForSummary = limit === null ? orderedSessions : orderedSessions.slice(0, limit);

  const blocks: ExerciseBlockHistoryBlock[] = [];
  for (const session of sessionsForSummary) {
    ensureValidDate(session.completedAt, 'completedAt');
    const matchingSessionExercises = [
      ...(sessionExercisesBySessionId[session.sessionId] ?? []),
    ].sort(compareSessionExerciseOrder);
    if (matchingSessionExercises.length === 0) continue;

    const setRows = matchingSessionExercises
      .flatMap((row) => input.setsBySessionExerciseId[row.sessionExerciseId] ?? [])
      .sort(compareSetOrder);
    const calculationSets = setRows.map((row) => ({
      weightValue: row.weightValue,
      repsValue: row.repsValue,
      setType: row.setType,
    }));
    const maxRepsByWeight = computeMaxRepsByWeight(calculationSets);

    blocks.push({
      sessionId: session.sessionId,
      completedAt: session.completedAt,
      daysAgo: computeDaysAgo(session.completedAt, input.now),
      sessionExerciseIds: matchingSessionExercises.map((row) => row.sessionExerciseId),
      estimatedOneRepMax: estimateExerciseOneRepMax(calculationSets),
      totalVolume: computeExerciseVolume(calculationSets),
      highestWeight: maxRepsByWeight[0]?.weight ?? null,
      rirAtMostTwoSetCount: countRirAtMostTwoSets(setRows),
    });
  }

  return {
    exerciseDefinitionId: input.exerciseDefinitionId ?? null,
    limit,
    blocks,
  };
};

export const selectSuggestedExercisePlanFromHistory = (input: {
  sessions: ExerciseBlockHistorySessionRow[];
  sessionExercises: ExerciseBlockHistorySessionExerciseRow[];
  setsBySessionExerciseId: Record<string, ExerciseBlockHistorySetRow[]>;
}): ExerciseBlockHistorySuggestedPlan | null => {
  const sessionExercisesBySessionId = groupSessionExercisesBySessionId(input.sessionExercises);
  const orderedSessions = [...input.sessions].sort(compareCompletedDesc);

  for (const session of orderedSessions) {
    ensureValidDate(session.completedAt, 'completedAt');
    const matchingSessionExercises = [
      ...(sessionExercisesBySessionId[session.sessionId] ?? []),
    ].sort(compareSessionExerciseOrder);
    if (matchingSessionExercises.length === 0) continue;

    const suggestedSets = matchingSessionExercises.flatMap((sessionExercise) =>
      [...(input.setsBySessionExerciseId[sessionExercise.sessionExerciseId] ?? [])]
        .sort(compareSetOrder)
        .filter(isValidSuggestedPlanSet)
        .map((set) => ({
          setId: set.setId,
          sessionExerciseId: set.sessionExerciseId,
          weightValue: set.weightValue,
          repsValue: set.repsValue,
          setType: normalizeSessionSetType(set.setType),
        }))
    );

    if (suggestedSets.length === 0) continue;

    return {
      sessionId: session.sessionId,
      completedAt: session.completedAt,
      sessionExerciseIds: matchingSessionExercises.map((row) => row.sessionExerciseId),
      sets: suggestedSets,
    };
  }

  return null;
};

const groupSetsBySessionExerciseId = (
  rows: ExerciseBlockHistorySetRow[]
): Record<string, ExerciseBlockHistorySetRow[]> => {
  const grouped: Record<string, ExerciseBlockHistorySetRow[]> = {};
  for (const row of rows) {
    const bucket = grouped[row.sessionExerciseId];
    if (bucket) {
      bucket.push(row);
    } else {
      grouped[row.sessionExerciseId] = [row];
    }
  }
  return grouped;
};

export const createDrizzleExerciseBlockHistoryStore = (): ExerciseBlockHistoryStore => ({
  async loadRecentCompletedSessionsForExercise({ exerciseDefinitionId, limit }) {
    if (limit === 0) return [];
    const database = await bootstrapLocalDataLayer();
    const baseQuery = database
      .select({
        sessionId: sessions.id,
        completedAt: sessions.completedAt,
      })
      .from(sessionExercises)
      .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
      .where(
        and(
          eq(sessionExercises.exerciseDefinitionId, exerciseDefinitionId),
          // Exclude exercises the user removed (kept as tombstones).
          isNull(sessionExercises.deletedAt),
          eq(sessions.status, 'completed'),
          isNull(sessions.deletedAt),
          isNotNull(sessions.completedAt)
        )
      )
      .groupBy(sessions.id, sessions.completedAt)
      .orderBy(desc(sessions.completedAt), asc(sessions.id));
    const rows = limit === undefined ? baseQuery.all() : baseQuery.limit(limit).all();

    return rows
      .filter(
        (row): row is { sessionId: string; completedAt: Date } => row.completedAt !== null
      )
      .map((row) => ({
        sessionId: row.sessionId,
        completedAt: row.completedAt,
      }));
  },
  async loadSessionExercisesForSessions({ exerciseDefinitionId, sessionIds }) {
    if (sessionIds.length === 0) return [];
    const database = await bootstrapLocalDataLayer();
    const rows = database
      .select({
        sessionExerciseId: sessionExercises.id,
        sessionId: sessionExercises.sessionId,
        orderIndex: sessionExercises.orderIndex,
      })
      .from(sessionExercises)
      .where(
        and(
          eq(sessionExercises.exerciseDefinitionId, exerciseDefinitionId),
          inArray(sessionExercises.sessionId, sessionIds),
          // Exclude exercises the user removed (kept as tombstones).
          isNull(sessionExercises.deletedAt)
        )
      )
      .orderBy(asc(sessionExercises.orderIndex), asc(sessionExercises.id))
      .all();

    return rows.map((row) => ({
      sessionExerciseId: row.sessionExerciseId,
      sessionId: row.sessionId,
      orderIndex: row.orderIndex,
    }));
  },
  async loadSetsForSessionExercises({ sessionExerciseIds }) {
    if (sessionExerciseIds.length === 0) return [];
    const database = await bootstrapLocalDataLayer();
    const rows = database
      .select({
        setId: exerciseSets.id,
        sessionExerciseId: exerciseSets.sessionExerciseId,
        orderIndex: exerciseSets.orderIndex,
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
      .orderBy(asc(exerciseSets.orderIndex), asc(exerciseSets.id))
      .all();

    return rows.map((row) => ({
      setId: row.setId,
      sessionExerciseId: row.sessionExerciseId,
      orderIndex: row.orderIndex,
      weightValue: row.weightValue,
      repsValue: row.repsValue,
      setType: row.setType ?? null,
    }));
  },
});

export const createExerciseBlockHistoryRepository = (
  store: ExerciseBlockHistoryStore = createDrizzleExerciseBlockHistoryStore()
) => ({
  async loadRecentBlocks(
    options: LoadRecentExerciseBlocksOptions
  ): Promise<ExerciseBlockHistorySummary> {
    const limit = normalizeLimit(options.limit);
    const now = options.now ?? new Date();
    ensureValidDate(now, 'now');

    const recentSessions = await store.loadRecentCompletedSessionsForExercise({
      exerciseDefinitionId: options.exerciseDefinitionId,
      limit: limit ?? undefined,
    });
    if (recentSessions.length === 0) {
      return aggregateExerciseBlockHistory({
        exerciseDefinitionId: options.exerciseDefinitionId,
        limit,
        now,
        sessions: [],
        sessionExercises: [],
        setsBySessionExerciseId: {},
      });
    }

    const sessionIds = recentSessions.map((session) => session.sessionId);
    const sessionExerciseRows = await store.loadSessionExercisesForSessions({
      exerciseDefinitionId: options.exerciseDefinitionId,
      sessionIds,
    });

    const sessionExerciseIds = sessionExerciseRows.map((row) => row.sessionExerciseId);
    const setRows = await store.loadSetsForSessionExercises({ sessionExerciseIds });

    return aggregateExerciseBlockHistory({
      exerciseDefinitionId: options.exerciseDefinitionId,
      limit,
      now,
      sessions: recentSessions,
      sessionExercises: sessionExerciseRows,
      setsBySessionExerciseId: groupSetsBySessionExerciseId(setRows),
    });
  },
  async loadSuggestedPlan(
    options: LoadSuggestedExercisePlanOptions
  ): Promise<ExerciseBlockHistorySuggestedPlan | null> {
    const recentSessions = await store.loadRecentCompletedSessionsForExercise({
      exerciseDefinitionId: options.exerciseDefinitionId,
      limit: undefined,
    });
    if (recentSessions.length === 0) {
      return null;
    }

    const sessionIds = recentSessions.map((session) => session.sessionId);
    const sessionExerciseRows = await store.loadSessionExercisesForSessions({
      exerciseDefinitionId: options.exerciseDefinitionId,
      sessionIds,
    });
    const sessionExerciseIds = sessionExerciseRows.map((row) => row.sessionExerciseId);
    const setRows = await store.loadSetsForSessionExercises({ sessionExerciseIds });

    return selectSuggestedExercisePlanFromHistory({
      sessions: recentSessions,
      sessionExercises: sessionExerciseRows,
      setsBySessionExerciseId: groupSetsBySessionExerciseId(setRows),
    });
  },
});

const defaultExerciseBlockHistoryRepository = createExerciseBlockHistoryRepository();

export const loadRecentExerciseBlocks =
  defaultExerciseBlockHistoryRepository.loadRecentBlocks;
export const loadSuggestedExercisePlan =
  defaultExerciseBlockHistoryRepository.loadSuggestedPlan;
