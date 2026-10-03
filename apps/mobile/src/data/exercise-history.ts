import { loadAsOfWeightResolver } from './bodyweight';
import type { ResolvedSessionWeight } from '@/src/bodyweight/as-of';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import { personalLoadContext, summarizeExerciseLoad } from '@/src/exercise-calculations/analytics';
import type { LoadContext, LoadInputMode, VolumeCoverage } from '@/src/exercise-calculations/load-metrics';
import {
  isConfirmedPerformedSet,
  isWorkingSet,
  normalizeSessionSetPerformanceStatus,
  type SessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

import { bootstrapLocalDataLayer } from './bootstrap';
import {
  exerciseDefinitions,
  exerciseSets,
  exerciseTagDefinitions,
  gyms,
  sessionExerciseTags,
  sessionExercises,
  sessions,
  userSettings,
} from './schema';
import {
  isWorkingSessionSetType,
  normalizeSessionSetType,
  type SessionSetTypeValue,
} from './set-types';
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

export type ExerciseHistorySessionEntry = ResolvedSessionWeight & {
  sessionId: string;
  sessionExerciseId: string;
  completedAt: Date;
  gymId?: string | null;
  gymName: string | null;
  tagIds: string[];
  sets: ExerciseHistorySetEntry[];
  workingSetCount: number;
  estimatedOneRepMax: number | null;
  totalVolume: number | null;
  volumeCoverage?: VolumeCoverage;
  loadContext?: LoadContext;
  topWeightSet: { weight: number; reps: number } | null;
};

export type ExerciseHistoryTagOption = {
  tagDefinitionId: string;
  name: string;
  deletedAt: Date | null;
  occurrenceCount: number;
};

export type ExerciseHistoryGymOption = {
  gymId: string;
  name: string;
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
  bodyweightContribution: number;
  period: ExerciseHistoryPeriod;
  appliedTagDefinitionId: string | null;
  appliedGymId: string | null;
  tagOptions: ExerciseHistoryTagOption[];
  gymOptions: ExerciseHistoryGymOption[];
  sessions: ExerciseHistorySessionEntry[];
  allTimeBest: ExerciseHistoryBest;
};

export type ExerciseHistorySessionRow = ResolvedSessionWeight & {
  sessionId: string;
  sessionExerciseId: string;
  completedAt: Date;
  gymId?: string | null;
  gymName: string | null;
};

export type ExerciseHistorySetRow = {
  setId: string;
  sessionExerciseId: string;
  orderIndex: number;
  weightValue: string;
  repsValue: string;
  setType: string | null;
  performanceStatus?: SessionSetPerformanceStatus;
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
  bodyweightContribution: number;
  bodyweightCalculationsEnabled: boolean;
  loadInputMode: LoadInputMode;
};

export type ExerciseHistoryAggregationInput = {
  exerciseDefinition: ExerciseHistoryDefinitionRow;
  period: ExerciseHistoryPeriod;
  appliedTagDefinitionId: string | null;
  appliedGymId?: string | null;
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
  gymId?: string | null;
  now?: Date;
};

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const ensureValidDate = (value: Date, label: string) => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
};

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
  tagRows: ExerciseHistoryTagRow[],
  definition: ExerciseHistoryDefinitionRow
): ExerciseHistorySessionEntry => {
  const orderedSets = setRows
    .filter((set) =>
      isConfirmedPerformedSet({
        reps: set.repsValue,
        weight: set.weightValue,
        performanceStatus: set.performanceStatus,
      })
    )
    .sort(compareSetOrder);
  const sets: ExerciseHistorySetEntry[] = orderedSets.map((row) => ({
    setId: row.setId,
    orderIndex: row.orderIndex,
    weightValue: row.weightValue,
    repsValue: row.repsValue,
    setType: normalizeSessionSetType(row.setType),
    isWorking: isWorkingSessionSetType(row.setType),
  }));

  const workingSetCount = sets.reduce((count, set) => (set.isWorking ? count + 1 : count), 0);
  const loadContext = personalLoadContext(definition.bodyweightCalculationsEnabled, definition, sessionRow);
  const { volumeCoverage } = summarizeExerciseLoad(orderedSets, loadContext);
  // The session's 1RM and top set are bests (they feed `allTimeBest`): working sets only.
  const { estimatedOneRepMax, topWeightSet } = summarizeExerciseLoad(
    orderedSets.filter((row) => isWorkingSet({
      weight: row.weightValue, reps: row.repsValue, performanceStatus: row.performanceStatus, setType: row.setType,
    })),
    loadContext,
  );
  const totalVolume = volumeCoverage.totalVolumeKgReps;

  const tagIds = tagRows.map((row) => row.tagDefinitionId);

  return {
    sessionId: sessionRow.sessionId,
    sessionExerciseId: sessionRow.sessionExerciseId,
    completedAt: sessionRow.completedAt,
    gymId: sessionRow.gymId,
    gymName: sessionRow.gymName,
    bodyWeightKg: sessionRow.bodyWeightKg, bodyWeightSource: sessionRow.bodyWeightSource,
    bodyWeightMeasurementId: sessionRow.bodyWeightMeasurementId, bodyWeightMeasuredAt: sessionRow.bodyWeightMeasuredAt,
    tagIds,
    sets,
    workingSetCount,
    estimatedOneRepMax,
    totalVolume, volumeCoverage, loadContext,
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

const buildGymOptions = (
  sessionsInPeriod: ExerciseHistorySessionRow[]
): ExerciseHistoryGymOption[] => {
  const optionByGymId = new Map<string, ExerciseHistoryGymOption>();
  for (const sessionRow of sessionsInPeriod) {
    const gymId = sessionRow.gymId ?? 'no-gym';
    const name = sessionRow.gymName?.trim() ? sessionRow.gymName : 'No gym';
    const existing = optionByGymId.get(gymId);
    if (existing) {
      existing.occurrenceCount += 1;
    } else {
      optionByGymId.set(gymId, {
        gymId,
        name,
        occurrenceCount: 1,
      });
    }
  }

  return Array.from(optionByGymId.values()).sort((left, right) => {
    if (right.occurrenceCount !== left.occurrenceCount) {
      return right.occurrenceCount - left.occurrenceCount;
    }
    return left.name.localeCompare(right.name);
  });
};

export const aggregateExerciseHistory = (
  input: ExerciseHistoryAggregationInput
): ExerciseHistorySummary => {
  const appliedGymId = input.appliedGymId ?? null;
  const tagOptions = buildTagOptions(input.sessionsInPeriod, input.tagsBySessionExerciseId);
  const gymOptions = buildGymOptions(input.sessionsInPeriod);

  let filteredSessionRows = input.appliedTagDefinitionId
    ? input.sessionsInPeriod.filter((row) =>
        (input.tagsBySessionExerciseId[row.sessionExerciseId] ?? []).some(
          (tag) => tag.tagDefinitionId === input.appliedTagDefinitionId
        )
      )
    : input.sessionsInPeriod;

  if (appliedGymId) {
    filteredSessionRows = filteredSessionRows.filter((row) =>
      appliedGymId === 'no-gym' ? (!row.gymId || row.gymId === null) : row.gymId === appliedGymId
    );
  }

  const orderedSessionRows = [...filteredSessionRows].sort(compareCompletedDesc);
  const sessions = orderedSessionRows
    .map((row) =>
      buildSessionEntry(
        row,
        input.setsBySessionExerciseId[row.sessionExerciseId] ?? [],
        input.tagsBySessionExerciseId[row.sessionExerciseId] ?? [],
        input.exerciseDefinition
      )
    )
    .filter((entry) => entry.sets.length > 0);

  const filteredAllTimeRows = appliedGymId
    ? input.sessionsAllTime.filter((row) =>
        appliedGymId === 'no-gym' ? (!row.gymId || row.gymId === null) : row.gymId === appliedGymId
      )
    : input.sessionsAllTime;

  const allTimeEntries = filteredAllTimeRows
    .map((row) =>
      buildSessionEntry(
        row,
        input.setsBySessionExerciseId[row.sessionExerciseId] ?? [],
        input.tagsBySessionExerciseId[row.sessionExerciseId] ?? [],
        input.exerciseDefinition
      )
    )
    .filter((entry) => entry.sets.length > 0);

  return {
    exerciseDefinitionId: input.exerciseDefinition.id,
    exerciseName: input.exerciseDefinition.name,
    exerciseDeletedAt: input.exerciseDefinition.deletedAt,
    bodyweightContribution: input.exerciseDefinition.bodyweightContribution,
    period: input.period,
    appliedTagDefinitionId: input.appliedTagDefinitionId,
    appliedGymId,
    tagOptions,
    gymOptions,
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
        bodyweightContribution: exerciseDefinitions.bodyweightContribution,
        loadInputMode: exerciseDefinitions.loadInputMode,
      })
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.id, exerciseDefinitionId))
      .get();

    if (!row) return null;
    const bodyweightCalculationsEnabled = database
      .select({ enabled: userSettings.bodyweightCalculationsEnabled })
      .from(userSettings)
      .where(eq(userSettings.id, 'settings'))
      .get()?.enabled ?? false;
    return { ...row, bodyweightCalculationsEnabled, deletedAt: row.deletedAt ?? null };
  },
  async loadSessionsForExercise({ exerciseDefinitionId, start, end }) {
    const database = await bootstrapLocalDataLayer();
    const resolveWeight = loadAsOfWeightResolver(database);

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
        gymId: sessions.gymId,
        gymName: gyms.name,
        startedAt: sessions.startedAt,
      })
      .from(sessionExercises)
      .innerJoin(sessions, eq(sessionExercises.sessionId, sessions.id))
      .leftJoin(gyms, eq(sessions.gymId, gyms.id))
      .where(and(...conditions))
      .orderBy(desc(sessions.completedAt))
      .all();

    return rows
      .filter(
        (row): row is typeof row & { completedAt: Date } =>
          row.completedAt !== null
      )
      .map((row) => ({
        sessionId: row.sessionId,
        sessionExerciseId: row.sessionExerciseId,
        completedAt: row.completedAt,
        gymId: row.gymId ?? null,
        gymName: row.gymName ?? null,
        ...resolveWeight(row.startedAt),
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
      .orderBy(asc(exerciseSets.orderIndex))
      .all();
    return rows.map((row) => ({
      setId: row.setId,
      sessionExerciseId: row.sessionExerciseId,
      orderIndex: row.orderIndex,
      weightValue: row.weightValue,
      repsValue: row.repsValue,
      setType: row.setType ?? null,
      performanceStatus: normalizeSessionSetPerformanceStatus(row.performanceStatus),
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
    const appliedGymId = options.gymId ?? null;
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
      appliedGymId,
      sessionsInPeriod,
      sessionsAllTime: allTimeRows,
      setsBySessionExerciseId: groupBySessionExerciseId(setRows),
      tagsBySessionExerciseId: groupBySessionExerciseId(tagRows),
    });
  },
});

const defaultExerciseHistoryRepository = createExerciseHistoryRepository();

export const loadExercisePerformanceHistory = defaultExerciseHistoryRepository.load;
