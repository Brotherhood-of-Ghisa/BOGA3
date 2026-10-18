import { loadAsOfWeightResolver } from './bodyweight';
import type { SessionWeightContext } from '@/src/bodyweight/as-of';
import { getPersonalEffortPolicy } from '@/src/config/personal-effort';
import type { EffortCalculationPolicy } from '@/src/exercise-calculations/effort-policy';
import { and, eq, inArray, isNull } from 'drizzle-orm';


import { addFiniteVolume, calculateAnalyticsSetMetrics, personalLoadContext } from '@/src/exercise-calculations/analytics';
import type { LoadInputMode } from '@/src/exercise-calculations/load-metrics';
import {
  isWorkingSet,
  isVolumeSet,
  normalizeSessionSetPerformanceStatus,
  type SessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

import { bootstrapLocalDataLayer } from './bootstrap';
import { inProgressSessionDate, selectInProgressSessionRow } from './in-progress-session';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions, userSettings } from './schema';
import type { GymScopeOption } from '@/src/utils/gym-scope-route';
import { computePeriodBounds, type StatsPeriodDays } from './stats';
import { calendarWeekBounds } from '@/src/utils/calendar-weeks';

/** An explicit half-open window, for a period the week and day forms cannot name. */
export type ExerciseCatalogStatsWindow = { start: Date; end: Date };
export type ExerciseCatalogStatsPeriod = 'all' | StatsPeriodDays | { weeks: number } | ExerciseCatalogStatsWindow;

export type ExerciseAggregate = {
  exerciseDefinitionId: string;
  sessionCount: number;
  workingSetCount: number;
  totalVolume: number | null;
  /** Sets the Volume figure includes, so a genuine 0 is told from no data. */
  volumeSetCount: number;
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
  effortPolicy?: EffortCalculationPolicy;
  /** `gymId` / `gymName` absent read as a session with no gym. */
  sessions: ({ id: string; completedAt: Date; gymId?: string | null; gymName?: string | null } & SessionWeightContext)[];
  /**
   * The workout in progress, undated. Its exercises and sets are in the lists
   * below, but no figure counts them until `withInProgressSession` dates it:
   * only Progress does (§2); the catalogue and pickers read completed history.
   */
  inProgressSession?: ({ id: string; gymId?: string | null; gymName?: string | null } & SessionWeightContext) | null;
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
        gymId: sessions.gymId,
        gymName: gyms.name,
      })
      .from(sessions)
      .leftJoin(gyms, eq(gyms.id, sessions.gymId))
      .where(and(eq(sessions.status, 'completed'), isNull(sessions.deletedAt)))
      .all();
    const inProgressRow = selectInProgressSessionRow(database);

    const sessionRows = storedSessionRows.map(row => ({ ...row, ...resolveWeight(row.startedAt) }));

    const sessionsCompleted = sessionRows
      .filter((row): row is typeof row & { completedAt: Date } => row.completedAt !== null)
      .map((row) => ({ ...row, completedAt: row.completedAt }));

    const inProgressSession = inProgressRow ? {
      id: inProgressRow.id, gymId: inProgressRow.gymId, gymName: inProgressRow.gymName, ...resolveWeight(inProgressRow.startedAt),
    } : null;
    const sessionIds = [...sessionsCompleted.map((row) => row.id), ...(inProgressSession ? [inProgressSession.id] : [])];
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
      effortPolicy: getPersonalEffortPolicy(),
      exerciseDefinitions: definitions,
      sessions: sessionsCompleted,
      inProgressSession,
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

/** The history with its workout in progress counted, dated for a read at `now` (§2). */
export const withInProgressSession = (
  raw: ExerciseCatalogStatsRawHistory,
  now: Date
): ExerciseCatalogStatsRawHistory => {
  if (!raw.inProgressSession) return raw;
  return { ...raw, sessions: [...raw.sessions, { ...raw.inProgressSession, completedAt: inProgressSessionDate(now) }] };
};

type PeriodWindow = { start: Date | null; end: Date | null };

const RECENCY_HALF_LIFE_DAYS = 60;
const FAVOURITE_WINDOW_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const resolvePeriodWindow = (
  period: ExerciseCatalogStatsPeriod,
  now: Date
): PeriodWindow => {
  if (period === 'all') return { start: null, end: null };
  if (typeof period !== 'object') return pick(computePeriodBounds(period, now));
  return pick('weeks' in period ? calendarWeekBounds(period.weeks, now) : period);
};

const pick = ({ start, end }: { start: Date; end: Date }): PeriodWindow => ({ start, end });

const isInWindow = (completedAt: Date, window: PeriodWindow): boolean => {
  if (window.start && completedAt < window.start) return false;
  if (window.end && completedAt >= window.end) return false;
  return true;
};

const computeSetRecencyScore = (completedAt: Date, now: Date): number => {
  const ageDays = Math.max(0, (now.getTime() - completedAt.getTime()) / MS_PER_DAY);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
};

const emptyAggregate = (exerciseDefinitionId: string): ExerciseAggregate => ({
  exerciseDefinitionId,
  sessionCount: 0,
  workingSetCount: 0,
  totalVolume: 0,
  volumeSetCount: 0,
  estimatedOneRepMax: null,
});

const addRecency = (
  recencyScoresById: Map<string, ExerciseRecencyScore>,
  defId: string,
  completedAt: Date,
  now: Date
): void => {
  const recency = recencyScoresById.get(defId) ?? {
    exerciseDefinitionId: defId,
    score: 0,
    completedSetCount: 0,
    lastCompletedAt: null,
  };
  recency.score += computeSetRecencyScore(completedAt, now);
  recency.completedSetCount += 1;
  if (recency.lastCompletedAt === null || completedAt > recency.lastCompletedAt) {
    recency.lastCompletedAt = completedAt;
  }
  recencyScoresById.set(defId, recency);
};

const addWorkingSetToAggregate = (
  aggregate: ExerciseAggregate,
  metric: ReturnType<typeof calculateAnalyticsSetMetrics>
): void => {
  aggregate.workingSetCount += 1;
  const oneRm = metric.estimatedOneRepMaxKg;
  if (oneRm !== null && (aggregate.estimatedOneRepMax === null || oneRm > aggregate.estimatedOneRepMax)) {
    aggregate.estimatedOneRepMax = oneRm;
  }
};

/**
 * The one gym filter, three-state (`src/utils/gym-scope-route.ts`): unset every
 * gym, `null` the sessions with no gym, an id that gym. Every figure — counts,
 * `Last:`, favourite recency and never-done — counts only the sessions in scope.
 */
export type ExerciseCatalogStatsGymScope = { gymId?: string | null };

const inGymScope = (session: { gymId?: string | null }, scope: ExerciseCatalogStatsGymScope): boolean =>
  scope.gymId === undefined || (session.gymId ?? null) === scope.gymId;

/** The gyms the history was trained at, the most recently trained first; `null` for no gym. */
export const exerciseCatalogStatsGymOptions = (raw: ExerciseCatalogStatsRawHistory): GymScopeOption[] => {
  const latest = new Map<string | null, { option: GymScopeOption; completedAt: Date }>();
  for (const session of raw.sessions) {
    const gymId = session.gymId ?? null;
    const previous = latest.get(gymId);
    if (previous && previous.completedAt >= session.completedAt) continue;
    latest.set(gymId, { option: { gymId, name: session.gymName ?? null }, completedAt: session.completedAt });
  }
  return [...latest.values()]
    .sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime()
      || (left.option.gymId ?? '').localeCompare(right.option.gymId ?? ''))
    .map(({ option }) => option);
};

/**
 * Working sets settle (`training-metrics-contract.md` "Counted set") "done", `Last:`,
 * favourite recency, session count and 1RM. Volume independently includes
 * selected performed efforts, even when there are no working sets.
 */
export const aggregateExerciseCatalogStats = (
  raw: ExerciseCatalogStatsRawHistory,
  period: ExerciseCatalogStatsPeriod,
  now: Date = new Date(),
  scope: ExerciseCatalogStatsGymScope = {}
): ExerciseCatalogStats => {
  const window = resolvePeriodWindow(period, now);

  const sessionById = new Map(raw.sessions.map(row => [row.id, row]));
  const definitionById = new Map((raw.exerciseDefinitions ?? []).map(row => [row.id, row]));
  const sessionExerciseById = new Map(raw.sessionExercises.map(row => [row.id, row]));

  const everDoneIds = new Set<string>();
  const aggregatesById = new Map<string, ExerciseAggregate>();
  const recencyScoresById = new Map<string, ExerciseRecencyScore>();
  const lastCompletedAtById = new Map<string, Date>();
  const sessionsSeenByDef = new Map<string, Set<string>>();
  const favouriteStart = now.getTime() - FAVOURITE_WINDOW_DAYS * MS_PER_DAY;

  for (const set of raw.exerciseSets) {
    const link = sessionExerciseById.get(set.sessionExerciseId);
    if (!link || link.exerciseDefinitionId === null) continue;
    const defId = link.exerciseDefinitionId;
    const session = sessionById.get(link.sessionId);
    if (!session || !inGymScope(session, scope)) continue;
    // Working sets settle recency/counts/strength; volume is independent.
    const values = {
      reps: set.repsValue, weight: set.weightValue, performanceStatus: set.performanceStatus, setType: set.setType,
    };
    const working = isWorkingSet(values, raw.effortPolicy);
    const volumeIncluded = isVolumeSet(values, raw.effortPolicy);
    if (!working && !volumeIncluded) continue;
    const { completedAt } = session;

    if (working) {
      everDoneIds.add(defId);
      const previousUse = lastCompletedAtById.get(defId);
      if (!previousUse || completedAt > previousUse) lastCompletedAtById.set(defId, completedAt);
      // Favourite is independent of the Stats screen's selected metric period.
      if (completedAt.getTime() >= favouriteStart && completedAt <= now) {
        addRecency(recencyScoresById, defId, completedAt, now);
      }
    }

    if (!isInWindow(completedAt, window)) continue;
    // Only now: the load calculation is the expensive part of the pass, and
    // nothing outside the window reads it. Progress reads two windows out of
    // one history, so a set each pass skips is a set each pass need not weigh.
    const metric = calculateAnalyticsSetMetrics({
      ...set,
      ...personalLoadContext(raw.bodyweightCalculationsEnabled ?? false, definitionById.get(defId), session, raw.effortPolicy),
    });
    const aggregate = aggregatesById.get(defId) ?? emptyAggregate(defId);
    aggregatesById.set(defId, aggregate);
    if (volumeIncluded) {
      // A set whose load cannot be calculated is left out ([[copy.no-inline-explanation]]).
      aggregate.volumeSetCount += 1;
      aggregate.totalVolume = addFiniteVolume(aggregate.totalVolume, metric.volumeKgReps ?? 0);
    }
    if (!working) continue;
    addWorkingSetToAggregate(aggregate, metric);
    const sessionsSeen = sessionsSeenByDef.get(defId) ?? new Set<string>();
    sessionsSeenByDef.set(defId, sessionsSeen);
    if (!sessionsSeen.has(link.sessionId)) {
      sessionsSeen.add(link.sessionId);
      aggregate.sessionCount += 1;
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
