import { getPersonalEffortPolicy } from '@/src/config/personal-effort';
import type { EffortCalculationPolicy } from '@/src/exercise-calculations/effort-policy';
import { loadAsOfWeightResolver } from './bodyweight';
import type { ResolvedSessionWeight } from '@/src/bodyweight/as-of';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import { personalLoadContext, summarizeExerciseLoad } from '@/src/exercise-calculations/analytics';
import type { LoadContext, LoadInputMode } from '@/src/exercise-calculations/load-metrics';
import {
  isConfirmedPerformedSet,
  isWorkingSet,
  normalizeSessionSetPerformanceStatus,
  type SessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

import { bootstrapLocalDataLayer } from './bootstrap';
import { loadExerciseBests, loadExerciseSessionFacts } from './exercise-session-facts';
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
  normalizeSessionSetType,
  type SessionSetTypeValue,
} from './set-types';
import { calendarWeekBounds, historyWeekBounds } from '@/src/utils/calendar-weeks';
import { NO_GYM_LABEL, SELECTED_GYM_LABEL } from '@/src/utils/gym-scope-route';

export type ExerciseHistoryPeriod = { weeks: number; kind: 'progress' | 'history' };

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
  loadContext?: LoadContext;
  topWeightSet: { weight: number; reps: number } | null;
  /** The records this block took when its session was completed; full history reads only. */
  records?: ExerciseHistoryBlockRecords | null;
};

/**
 * The records one block took as they happened: its session's stored PR flags
 * (`exercise_session_facts`). With every gym in view they are the whole
 * exercise's (`pr_*`); with a gym chosen, the session's own (`own_pr_*`) —
 * a split exercise's gym book ([[gym.split-progress-prs]]). A strength record
 * belongs to the block holding its set; Volume to the session's first listed
 * block of the exercise.
 */
export type ExerciseHistoryBlockRecords = {
  oneRepMax: { setId: string; valueKg: number } | null;
  topWeightSetId: string | null;
  volumeKg: number | null;
};

/** One session's stored bests and PR flags for the exercise. */
export type ExerciseHistorySessionRecordRow = {
  sessionId: string;
  bestE1rmKg: number | null;
  bestE1rmSetId: string | null;
  topWeightSetId: string | null;
  volumeKg: number | null;
  prE1rm: boolean;
  prWeight: boolean;
  prVolume: boolean;
  ownPrE1rm: boolean;
  ownPrWeight: boolean;
  ownPrVolume: boolean;
};

export type ExerciseHistoryTagOption = {
  tagDefinitionId: string;
  name: string;
  deletedAt: Date | null;
  occurrenceCount: number;
};

export type ExerciseHistoryGymOption = {
  /** `null` is the sessions with no gym, the repository-wide convention. */
  gymId: string | null;
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
  /** Unset: every gym. `null`: the sessions with no gym. Otherwise that gym. */
  appliedGymId?: string | null;
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
  effortPolicy?: EffortCalculationPolicy;
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
  /** Unset: every gym. `null`: the sessions with no gym. Otherwise that gym. */
  appliedGymId?: string | null;
  /** The applied gym's name, so its chip reads it even with no session in the period. */
  appliedGymName?: string | null;
  sessionsInPeriod: ExerciseHistorySessionRow[];
  /** All-time, gym-scoped like the sessions, never by tag or period. */
  allTimeBest: ExerciseHistoryBest;
  setsBySessionExerciseId: Record<string, ExerciseHistorySetRow[]>;
  tagsBySessionExerciseId: Record<string, ExerciseHistoryTagRow[]>;
  /** By session id; a session without a row shows no records. */
  recordsBySessionId?: ReadonlyMap<string, ExerciseHistorySessionRecordRow>;
};

export type ExerciseHistoryStore = {
  loadExerciseDefinition(input: {
    exerciseDefinitionId: string;
  }): Promise<ExerciseHistoryDefinitionRow | null>;
  loadSessionsForExercise(input: {
    exerciseDefinitionId: string;
    start: Date | null;
    end: Date | null;
    /** Only this session's blocks. */
    sessionId?: string;
  }): Promise<ExerciseHistorySessionRow[]>;
  /**
   * `gymId` is the one gym filter, three-state: unset every gym, `null` the
   * sessions with no gym, an id that gym. A split exercise reads the same way:
   * history is a view, so it shows the whole exercise until a gym is chosen
   * ([[gym.split]]).
   */
  /** A gym's name; null when it no longer exists or has none. */
  loadGymName(input: { gymId: string }): Promise<string | null>;
  loadAllTimeBest(input: {
    exerciseDefinitionId: string;
    gymId?: string | null;
  }): Promise<ExerciseHistoryBest>;
  loadSetsForSessionExercises(input: {
    sessionExerciseIds: string[];
  }): Promise<ExerciseHistorySetRow[]>;
  loadTagsForSessionExercises(input: {
    sessionExerciseIds: string[];
  }): Promise<ExerciseHistoryTagRow[]>;
  /** Every completed session's stored bests and PR flags for the exercise. */
  loadSessionRecords(input: {
    exerciseDefinitionId: string;
  }): Promise<ExerciseHistorySessionRecordRow[]>;
};

export type LoadExercisePerformanceHistoryOptions = {
  exerciseDefinitionId: string;
  /** Screens pass the configured week window; omitted reads use one calendar week. */
  period?: ExerciseHistoryPeriod;
  tagDefinitionId?: string | null;
  /** Unset: every gym. `null`: the sessions with no gym. Otherwise that gym. */
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
  const loadContext = personalLoadContext(definition.bodyweightCalculationsEnabled, definition, sessionRow, definition.effortPolicy);
  const sets: ExerciseHistorySetEntry[] = orderedSets.map((row) => ({
    setId: row.setId,
    orderIndex: row.orderIndex,
    weightValue: row.weightValue,
    repsValue: row.repsValue,
    setType: normalizeSessionSetType(row.setType),
    isWorking: isWorkingSet({
      weight: row.weightValue, reps: row.repsValue, performanceStatus: row.performanceStatus, setType: row.setType,
    }, loadContext.effortPolicy),
  }));

  const workingSetCount = sets.reduce((count, set) => (set.isWorking ? count + 1 : count), 0);
  // Strength reads working sets; volume uses its independent policy. Every
  // performed row retains its own figures.
  const { estimatedOneRepMax, topWeightSet, volumeKgReps: totalVolume } = summarizeExerciseLoad(
    orderedSets,
    loadContext,
  );

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
    totalVolume, loadContext,
    topWeightSet,
  };
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
  const optionByGymId = new Map<string | null, ExerciseHistoryGymOption>();
  for (const sessionRow of sessionsInPeriod) {
    const gymId = sessionRow.gymId ?? null;
    const name = sessionRow.gymName?.trim() ? sessionRow.gymName : NO_GYM_LABEL;
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

/** The PR flags a view reads ([[gym.split-progress-prs]]). */
const sessionPrFlags = (row: ExerciseHistorySessionRecordRow, own: boolean) =>
  own
    ? { e1rm: row.ownPrE1rm, weight: row.ownPrWeight, volume: row.ownPrVolume }
    : { e1rm: row.prE1rm, weight: row.prWeight, volume: row.prVolume };

/**
 * Each block's records (`ExerciseHistoryBlockRecords`): a strength record on
 * the block holding its set, Volume on the session's first listed block.
 * Entries arrive in session then block order.
 */
const withBlockRecords = (
  entries: ExerciseHistorySessionEntry[],
  recordsBySessionId: ReadonlyMap<string, ExerciseHistorySessionRecordRow>,
  own: boolean
): ExerciseHistorySessionEntry[] => {
  const volumePlaced = new Set<string>();
  return entries.map((entry) => {
    const row = recordsBySessionId.get(entry.sessionId);
    if (!row) return { ...entry, records: null };
    const flags = sessionPrFlags(row, own);
    const holds = (setId: string | null): setId is string =>
      setId !== null && entry.sets.some((set) => set.setId === setId);
    const firstBlock = !volumePlaced.has(entry.sessionId);
    volumePlaced.add(entry.sessionId);
    const oneRepMax = flags.e1rm && row.bestE1rmKg !== null && holds(row.bestE1rmSetId)
      ? { setId: row.bestE1rmSetId, valueKg: row.bestE1rmKg }
      : null;
    const topWeightSetId = flags.weight && holds(row.topWeightSetId) ? row.topWeightSetId : null;
    const volumeKg = flags.volume && firstBlock ? row.volumeKg : null;
    const records = oneRepMax || topWeightSetId || volumeKg !== null ? { oneRepMax, topWeightSetId, volumeKg } : null;
    return { ...entry, records };
  });
};

export const aggregateExerciseHistory = (
  input: ExerciseHistoryAggregationInput
): ExerciseHistorySummary => {
  const appliedGymId = input.appliedGymId;
  // A chip counts the cards it shows: rows with at least one performed set.
  const listedRows = input.sessionsInPeriod.filter((row) =>
    (input.setsBySessionExerciseId[row.sessionExerciseId] ?? []).some((set) => isConfirmedPerformedSet({
      reps: set.repsValue, weight: set.weightValue, performanceStatus: set.performanceStatus,
    })));
  const tagOptions = buildTagOptions(listedRows, input.tagsBySessionExerciseId);
  const gymOptions = buildGymOptions(listedRows);
  // The gym in force keeps its chip when the period holds none of its sessions.
  if (appliedGymId !== undefined && !gymOptions.some((option) => option.gymId === appliedGymId)) {
    gymOptions.push({
      gymId: appliedGymId,
      name: appliedGymId === null ? NO_GYM_LABEL : input.appliedGymName?.trim() || SELECTED_GYM_LABEL,
      occurrenceCount: 0,
    });
  }

  let filteredSessionRows = input.appliedTagDefinitionId
    ? input.sessionsInPeriod.filter((row) =>
        (input.tagsBySessionExerciseId[row.sessionExerciseId] ?? []).some(
          (tag) => tag.tagDefinitionId === input.appliedTagDefinitionId
        )
      )
    : input.sessionsInPeriod;

  if (appliedGymId !== undefined) {
    filteredSessionRows = filteredSessionRows.filter((row) => (row.gymId ?? null) === appliedGymId);
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
    sessions: input.recordsBySessionId
      ? withBlockRecords(sessions, input.recordsBySessionId, appliedGymId !== undefined)
      : sessions,
    allTimeBest: input.allTimeBest,
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
    return { ...row, bodyweightCalculationsEnabled, effortPolicy: getPersonalEffortPolicy(), deletedAt: row.deletedAt ?? null };
  },
  async loadSessionsForExercise({ exerciseDefinitionId, start, end, sessionId }) {
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
    if (sessionId) {
      conditions.push(eq(sessions.id, sessionId));
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
      .orderBy(desc(sessions.completedAt), asc(sessionExercises.orderIndex))
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
  async loadGymName({ gymId }) {
    const database = await bootstrapLocalDataLayer();
    return database.select({ name: gyms.name }).from(gyms).where(eq(gyms.id, gymId)).get()?.name ?? null;
  },
  async loadAllTimeBest({ exerciseDefinitionId, gymId }) {
    const { oneRepMax, topWeight } = await loadExerciseBests({ exerciseDefinitionId, gymId });
    return {
      estimatedOneRepMax: oneRepMax
        ? { value: oneRepMax.value, sessionId: oneRepMax.sessionId, completedAt: oneRepMax.completedAt }
        : null,
      topWeight: topWeight
        ? { weight: topWeight.weight, reps: topWeight.reps, sessionId: topWeight.sessionId, completedAt: topWeight.completedAt }
        : null,
    };
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
  async loadSessionRecords({ exerciseDefinitionId }) {
    return loadExerciseSessionFacts(exerciseDefinitionId);
  },
});

export const createExerciseHistoryRepository = (
  store: ExerciseHistoryStore = createDrizzleExerciseHistoryStore()
) => ({
  async load(options: LoadExercisePerformanceHistoryOptions): Promise<ExerciseHistorySummary | null> {
    const period: ExerciseHistoryPeriod = options.period ?? { weeks: 1, kind: 'progress' };
    const appliedTagDefinitionId = options.tagDefinitionId ?? null;
    const appliedGymId = options.gymId;
    const now = options.now ?? new Date();
    ensureValidDate(now, 'now');

    const exerciseDefinition = await store.loadExerciseDefinition({
      exerciseDefinitionId: options.exerciseDefinitionId,
    });
    if (!exerciseDefinition) return null;

    const { start, end } = (period.kind === 'history' ? historyWeekBounds : calendarWeekBounds)(period.weeks, now);

    const [sessionsInPeriod, allTimeBest, appliedGymName] = await Promise.all([
      store.loadSessionsForExercise({
        exerciseDefinitionId: options.exerciseDefinitionId,
        start,
        end,
      }),
      store.loadAllTimeBest({
        exerciseDefinitionId: options.exerciseDefinitionId,
        ...(appliedGymId === undefined ? {} : { gymId: appliedGymId }),
      }),
      typeof appliedGymId === 'string' ? store.loadGymName({ gymId: appliedGymId }) : null,
    ]);

    const sessionExerciseIds = sessionsInPeriod.map((row) => row.sessionExerciseId);
    const [setRows, tagRows, recordRows] = await Promise.all([
      store.loadSetsForSessionExercises({ sessionExerciseIds }),
      store.loadTagsForSessionExercises({ sessionExerciseIds }),
      store.loadSessionRecords({ exerciseDefinitionId: options.exerciseDefinitionId }),
    ]);

    return aggregateExerciseHistory({
      exerciseDefinition,
      period,
      appliedTagDefinitionId,
      appliedGymId,
      appliedGymName,
      sessionsInPeriod,
      allTimeBest,
      setsBySessionExerciseId: groupBySessionExerciseId(setRows),
      tagsBySessionExerciseId: groupBySessionExerciseId(tagRows),
      recordsBySessionId: new Map(recordRows.map((row) => [row.sessionId, row])),
    });
  },
  /** One completed session's blocks of the exercise, in block order, without tags. */
  loadSessionEntries(input: {
    exerciseDefinitionId: string;
    sessionId: string;
  }): Promise<ExerciseHistorySessionEntry[]> {
    return loadEntries(store, { ...input, start: null, end: null });
  },
  /** The exercise's blocks completed in [start, end), without tags. */
  async loadRangeEntries(input: {
    exerciseDefinitionId: string;
    start: Date;
    end: Date;
  }): Promise<ExerciseHistorySessionEntry[]> {
    ensureValidDate(input.start, 'start');
    ensureValidDate(input.end, 'end');
    return loadEntries(store, input);
  },
});

const loadEntries = async (
  store: ExerciseHistoryStore,
  input: { exerciseDefinitionId: string; sessionId?: string; start: Date | null; end: Date | null }
): Promise<ExerciseHistorySessionEntry[]> => {
  const exerciseDefinition = await store.loadExerciseDefinition({
    exerciseDefinitionId: input.exerciseDefinitionId,
  });
  if (!exerciseDefinition) return [];
  const blocks = await store.loadSessionsForExercise(input);
  const sets = groupBySessionExerciseId(await store.loadSetsForSessionExercises({
    sessionExerciseIds: blocks.map((row) => row.sessionExerciseId),
  }));
  return blocks.map((row) => buildSessionEntry(row, sets[row.sessionExerciseId] ?? [], [], exerciseDefinition));
};

const defaultExerciseHistoryRepository = createExerciseHistoryRepository();

export const loadExercisePerformanceHistory = defaultExerciseHistoryRepository.load;

export const loadExerciseSessionEntries = defaultExerciseHistoryRepository.loadSessionEntries;

export const loadExerciseRangeEntries = defaultExerciseHistoryRepository.loadRangeEntries;
