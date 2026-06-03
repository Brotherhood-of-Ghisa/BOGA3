import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import {
  computeExerciseVolume,
  computeMaxRepsByWeight,
  estimateExerciseOneRepMax,
} from '@/src/exercise-calculations';

import { bootstrapLocalDataLayer } from './bootstrap';
import {
  exerciseDefinitions,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  sessionExerciseTags,
  sessionExercises,
  sessions,
} from './schema';
import { normalizeSessionSetType, type SessionSetTypeValue } from './set-types';
import { computePeriodBounds, type StatsPeriodDays } from './stats';

export type ExerciseHistoryPeriod = 'all' | StatsPeriodDays;

export type ExerciseHistorySetEntry = {
  setId: string;
  orderIndex: number;
  weightValue: string;
  repsValue: string;
  setType: SessionSetTypeValue;
  isWorking: boolean;
};

export type ExerciseHistorySessionEntry = {
  sessionId: string;
  sessionExerciseId: string;
  completedAt: Date;
  gymName: string | null;
  tagIds: string[];
  sets: ExerciseHistorySetEntry[];
  workingSetCount: number;
  estimatedOneRepMax: number | null;
  totalVolume: number;
  topWeightSet: { weight: number; reps: number } | null;
};

export type ExerciseHistoryTagOption = {
  tagDefinitionId: string;
  name: string;
  deletedAt: Date | null;
  occurrenceCount: number;
};

export type ExerciseHistoryBest = {
  estimatedOneRepMax: {
    value: number;
    sessionId: string;
    completedAt: Date;
  } | null;
  topWeight: {
    weight: number;
    reps: number;
    sessionId: string;
    completedAt: Date;
  } | null;
};

export type ExerciseHistorySummary = {
  exerciseDefinitionId: string;
  exerciseName: string;
  exerciseDeletedAt: Date | null;
  period: ExerciseHistoryPeriod;
  appliedTagDefinitionId: string | null;
  tagOptions: ExerciseHistoryTagOption[];
  sessions: ExerciseHistorySessionEntry[];
  allTimeBest: ExerciseHistoryBest;
};

export type ExerciseHistorySessionRow = {
  sessionId: string;
  sessionExerciseId: string;
  completedAt: Date;
  gymName: string | null;
};

export type ExerciseHistorySetRow = {
  setId: string;
  sessionExerciseId: string;
  orderIndex: number;
  weightValue: string;
  repsValue: string;
  setType: string | null;
};

export type ExerciseHistoryTagRow = {
  sessionExerciseId: string;
  tagDefinitionId: string;
  name: string;
  deletedAt: Date | null;
};

export type ExerciseHistoryDefinitionRow = {
  id: string;
  name: string;
  deletedAt: Date | null;
};

export type ExerciseHistoryAggregationInput = {
  exerciseDefinition: ExerciseHistoryDefinitionRow;
  period: ExerciseHistoryPeriod;
  appliedTagDefinitionId: string | null;
  sessionsInPeriod: ExerciseHistorySessionRow[];
  sessionsAllTime: ExerciseHistorySessionRow[];
  setsBySessionExerciseId: Record<string, ExerciseHistorySetRow[]>;
  tagsBySessionExerciseId: Record<string, ExerciseHistoryTagRow[]>;
};

export type ExerciseHistoryStore = {
  loadExerciseDefinition(input: {
    exerciseDefinitionId: string;
  }): Promise<ExerciseHistoryDefinitionRow | null>;
  loadSessionsForExercise(input: {
    exerciseDefinitionId: string;
    start: Date | null;
    end: Date | null;
  }): Promise<ExerciseHistorySessionRow[]>;
  loadSetsForSessionExercises(input: {
    sessionExerciseIds: string[];
  }): Promise<ExerciseHistorySetRow[]>;
  loadTagsForSessionExercises(input: {
    sessionExerciseIds: string[];
  }): Promise<ExerciseHistoryTagRow[]>;
};

export type LoadExercisePerformanceHistoryOptions = {
  exerciseDefinitionId: string;
  /** Period window. Defaults to 30 days when omitted. */
  period?: ExerciseHistoryPeriod;
  tagDefinitionId?: string | null;
  now?: Date;
};

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const ensureValidDate = (value: Date, label: string) => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const isWorkingSet = (setType: string | null) => setType !== 'warm_up';

const groupBySessionExerciseId = <T extends { sessionExerciseId: string }>(
  rows: T[]
): Record<string, T[]> => {
  const result: Record<string, T[]> = {};
  for (const row of rows) {
    const bucket = result[row.sessionExerciseId];
    if (bucket) {
      bucket.push(row);
    } else {
      result[row.sessionExerciseId] = [row];
    }
  }
  return result;
};

const compareSetOrder = (left: ExerciseHistorySetRow, right: ExerciseHistorySetRow) => {
  if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
  return left.setId.localeCompare(right.setId);
};

const compareCompletedDesc = (
  left: ExerciseHistorySessionRow,
  right: ExerciseHistorySessionRow
) => {
  const diff = right.completedAt.getTime() - left.completedAt.getTime();
  if (diff !== 0) return diff;
  return left.sessionId.localeCompare(right.sessionId);
};

const buildSessionEntry = (
  sessionRow: ExerciseHistorySessionRow,
  setRows: ExerciseHistorySetRow[],
  tagRows: ExerciseHistoryTagRow[]
): ExerciseHistorySessionEntry => {
  const orderedSets = [...setRows].sort(compareSetOrder);
  const sets: ExerciseHistorySetEntry[] = orderedSets.map((row) => ({
    setId: row.setId,
    orderIndex: row.orderIndex,
    weightValue: row.weightValue,
    repsValue: row.repsValue,
    setType: normalizeSessionSetType(row.setType),
    isWorking: isWorkingSet(row.setType),
  }));

  const workingSetCount = sets.reduce((count, set) => (set.isWorking ? count + 1 : count), 0);
  const workingSetInputs = orderedSets.map((row) => ({
    weightValue: row.weightValue,
    repsValue: row.repsValue,
    setType: row.setType,
  }));

  const estimatedOneRepMax = estimateExerciseOneRepMax(workingSetInputs);
  const totalVolume = computeExerciseVolume(workingSetInputs);
  const topByWeight = computeMaxRepsByWeight(workingSetInputs);
  const topWeightSet = topByWeight.length > 0
    ? { weight: topByWeight[0].weight, reps: topByWeight[0].maxReps }
    : null;

  const tagIds = tagRows.map((row) => row.tagDefinitionId);

  return {
    sessionId: sessionRow.sessionId,
    sessionExerciseId: sessionRow.sessionExerciseId,
    completedAt: sessionRow.completedAt,
    gymName: sessionRow.gymName,
    tagIds,
    sets,
    workingSetCount,
    estimatedOneRepMax,
    totalVolume,
    topWeightSet,
  };
};

const computeBest = (
  entries: ExerciseHistorySessionEntry[]
): ExerciseHistoryBest => {
  let bestOneRepMax: ExerciseHistoryBest['estimatedOneRepMax'] = null;
  let bestTopWeight: ExerciseHistoryBest['topWeight'] = null;

  for (const entry of entries) {
    if (
      entry.estimatedOneRepMax !== null &&
      (bestOneRepMax === null || entry.estimatedOneRepMax > bestOneRepMax.value)
    ) {
      bestOneRepMax = {
        value: entry.estimatedOneRepMax,
        sessionId: entry.sessionId,
        completedAt: entry.completedAt,
      };
    }

    if (entry.topWeightSet) {
      const candidate = entry.topWeightSet;
      if (
        bestTopWeight === null ||
        candidate.weight > bestTopWeight.weight ||
        (candidate.weight === bestTopWeight.weight && candidate.reps > bestTopWeight.reps)
      ) {
        bestTopWeight = {
          weight: candidate.weight,
          reps: candidate.reps,
          sessionId: entry.sessionId,
          completedAt: entry.completedAt,
        };
      }
    }
  }

  return { estimatedOneRepMax: bestOneRepMax, topWeight: bestTopWeight };
};

const buildTagOptions = (
  sessionsInPeriod: ExerciseHistorySessionRow[],
  tagsBySessionExerciseId: Record<string, ExerciseHistoryTagRow[]>
): ExerciseHistoryTagOption[] => {
  const optionByTagId = new Map<string, ExerciseHistoryTagOption>();
  for (const sessionRow of sessionsInPeriod) {
    const rows = tagsBySessionExerciseId[sessionRow.sessionExerciseId] ?? [];
    for (const row of rows) {
      const existing = optionByTagId.get(row.tagDefinitionId);
      if (existing) {
        existing.occurrenceCount += 1;
      } else {
        optionByTagId.set(row.tagDefinitionId, {
          tagDefinitionId: row.tagDefinitionId,
          name: row.name,
          deletedAt: row.deletedAt,
          occurrenceCount: 1,
        });
      }
    }
  }

  return Array.from(optionByTagId.values()).sort((left, right) => {
    if (right.occurrenceCount !== left.occurrenceCount) {
      return right.occurrenceCount - left.occurrenceCount;
    }
    return left.name.localeCompare(right.name);
  });
};

export const aggregateExerciseHistory = (
  input: ExerciseHistoryAggregationInput
): ExerciseHistorySummary => {
  const tagOptions = buildTagOptions(input.sessionsInPeriod, input.tagsBySessionExerciseId);

  const filteredSessionRows = input.appliedTagDefinitionId
    ? input.sessionsInPeriod.filter((row) =>
        (input.tagsBySessionExerciseId[row.sessionExerciseId] ?? []).some(
          (tag) => tag.tagDefinitionId === input.appliedTagDefinitionId
        )
      )
    : input.sessionsInPeriod;

  const orderedSessionRows = [...filteredSessionRows].sort(compareCompletedDesc);
  const sessions = orderedSessionRows.map((row) =>
    buildSessionEntry(
      row,
      input.setsBySessionExerciseId[row.sessionExerciseId] ?? [],
      input.tagsBySessionExerciseId[row.sessionExerciseId] ?? []
    )
  );

  const allTimeEntries = input.sessionsAllTime.map((row) =>
    buildSessionEntry(
      row,
      input.setsBySessionExerciseId[row.sessionExerciseId] ?? [],
      input.tagsBySessionExerciseId[row.sessionExerciseId] ?? []
    )
  );

  return {
    exerciseDefinitionId: input.exerciseDefinition.id,
    exerciseName: input.exerciseDefinition.name,
    exerciseDeletedAt: input.exerciseDefinition.deletedAt,
    period: input.period,
    appliedTagDefinitionId: input.appliedTagDefinitionId,
    tagOptions,
    sessions,
    allTimeBest: computeBest(allTimeEntries),
  };
};

export const createDrizzleExerciseHistoryStore = (): ExerciseHistoryStore => ({
  async loadExerciseDefinition({ exerciseDefinitionId }) {
    const database = await bootstrapLocalDataLayer();
    const row = database
      .select({
        id: exerciseDefinitions.id,
        name: exerciseDefinitions.name,
        deletedAt: exerciseDefinitions.deletedAt,
      })
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, exerciseDefinitionId))
      .get();

    if (!row) return null;
    return { id: row.id, name: row.name, deletedAt: row.deletedAt ?? null };
  },
  async loadSessionsForExercise({ exerciseDefinitionId, start, end }) {
    const database = await bootstrapLocalDataLayer();

    const conditions = [
      eq(sessionExercises.exerciseDefinitionId, exerciseDefinitionId),
      // Exclude exercises the user removed (kept as tombstones).
      isNull(sessionExercises.deletedAt),
      eq(sessions.status, 'completed'),
      isNull(sessions.deletedAt),
    ];
    if (start) {
      conditions.push(gte(sessions.completedAt, start));
    }
    if (end) {
      conditions.push(lt(sessions.completedAt, end));
    }

    const rows = database
      .select({
        sessionId: sessions.id,
        sessionExerciseId: sessionExercises.id,
        completedAt: sessions.completedAt,
        gymName: gyms.name,
      })
      .from(sessionExercises)
      .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
      .leftJoin(gyms, eq(sessions.gymId, gyms.id))
      .where(and(...conditions))
      .orderBy(desc(sessions.completedAt))
      .all();

    return rows
      .filter(
        (row): row is { sessionId: string; sessionExerciseId: string; completedAt: Date; gymName: string | null } =>
          row.completedAt !== null
      )
      .map((row) => ({
        sessionId: row.sessionId,
        sessionExerciseId: row.sessionExerciseId,
        completedAt: row.completedAt,
        gymName: row.gymName ?? null,
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
      .orderBy(asc(exerciseSets.orderIndex))
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
  async loadTagsForSessionExercises({ sessionExerciseIds }) {
    if (sessionExerciseIds.length === 0) return [];
    const database = await bootstrapLocalDataLayer();
    const rows = database
      .select({
        sessionExerciseId: sessionExerciseTags.sessionExerciseId,
        tagDefinitionId: sessionExerciseTags.exerciseTagDefinitionId,
        name: exerciseTagDefinitions.name,
        deletedAt: exerciseTagDefinitions.deletedAt,
      })
      .from(sessionExerciseTags)
      .innerJoin(
        exerciseTagDefinitions,
        eq(sessionExerciseTags.exerciseTagDefinitionId, exerciseTagDefinitions.id)
      )
      .where(
        and(
          inArray(sessionExerciseTags.sessionExerciseId, sessionExerciseIds),
          // Hide tag attachments the user removed (kept locally as tombstones).
          isNull(sessionExerciseTags.deletedAt)
        )
      )
      .all();
    return rows.map((row) => ({
      sessionExerciseId: row.sessionExerciseId,
      tagDefinitionId: row.tagDefinitionId,
      name: row.name,
      deletedAt: row.deletedAt ?? null,
    }));
  },
});

export const createExerciseHistoryRepository = (
  store: ExerciseHistoryStore = createDrizzleExerciseHistoryStore()
) => ({
  async load(options: LoadExercisePerformanceHistoryOptions): Promise<ExerciseHistorySummary | null> {
    const period: ExerciseHistoryPeriod = options.period ?? 30;
    const appliedTagDefinitionId = options.tagDefinitionId ?? null;
    const now = options.now ?? new Date();
    ensureValidDate(now, 'now');

    const exerciseDefinition = await store.loadExerciseDefinition({
      exerciseDefinitionId: options.exerciseDefinitionId,
    });
    if (!exerciseDefinition) return null;

    let start: Date | null = null;
    let end: Date | null = null;
    if (period !== 'all') {
      const bounds = computePeriodBounds(period, now);
      start = bounds.start;
      end = bounds.end;
    }

    const [sessionsInPeriod, sessionsAllTime] = await Promise.all([
      store.loadSessionsForExercise({
        exerciseDefinitionId: options.exerciseDefinitionId,
        start,
        end,
      }),
      period === 'all'
        ? Promise.resolve<ExerciseHistorySessionRow[]>([])
        : store.loadSessionsForExercise({
            exerciseDefinitionId: options.exerciseDefinitionId,
            start: null,
            end: null,
          }),
    ]);

    const allTimeRows = period === 'all' ? sessionsInPeriod : sessionsAllTime;

    const sessionExerciseIdSet = new Set<string>();
    for (const row of sessionsInPeriod) sessionExerciseIdSet.add(row.sessionExerciseId);
    for (const row of allTimeRows) sessionExerciseIdSet.add(row.sessionExerciseId);
    const sessionExerciseIds = Array.from(sessionExerciseIdSet);

    const [setRows, tagRows] = await Promise.all([
      store.loadSetsForSessionExercises({ sessionExerciseIds }),
      store.loadTagsForSessionExercises({ sessionExerciseIds }),
    ]);

    return aggregateExerciseHistory({
      exerciseDefinition,
      period,
      appliedTagDefinitionId,
      sessionsInPeriod,
      sessionsAllTime: allTimeRows,
      setsBySessionExerciseId: groupBySessionExerciseId(setRows),
      tagsBySessionExerciseId: groupBySessionExerciseId(tagRows),
    });
  },
});

const defaultExerciseHistoryRepository = createExerciseHistoryRepository();

export const loadExercisePerformanceHistory = defaultExerciseHistoryRepository.load;
