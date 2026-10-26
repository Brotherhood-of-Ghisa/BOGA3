import { loadAsOfWeightResolver } from './bodyweight';
import { getPersonalEffortPolicy } from '@/src/config/personal-effort';
import { addFiniteVolume } from '@/src/exercise-calculations/analytics';
import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { drainExerciseSessionFacts } from './exercise-session-facts';
import {
  aggregateProgressMuscleTickers, muscleTickerBounds, reportMuscleTrainingStarts,
  type MuscleTickerOptions, type MuscleTrainingStarts,
} from './progress-muscle-tickers';

import { bootstrapLocalDataLayer } from './bootstrap';
import { selectDatedInProgressSession } from './in-progress-session';
import { exerciseHistoryGymOptions } from './exercise-analytics';
import { aggregateMuscleDailySets, type MuscleDailySets } from './muscle-daily-sets';
import {
  aggregateSelectedMuscleDailyEffort,
  aggregateSelectedMuscleDailyEffortMetrics,
  aggregateSelectedMuscleWeeklyEffort,
  applyMuscleReport,
  collectMuscleSetContributions,
  countedMuscleAnalyticsSessionIds,
  countMuscleAnalyticsWorkingSets,
  countMuscleSet,
  createMuscleSetCounter,
  withoutSecondaryMappings,
  type AggregateSelectedMuscleDailyEffortOptions,
  type DailyEffortMetrics,
  type MuscleAnalyticsInput,
  type MuscleReportAssignment,
  type MuscleSetCounter,
  type SelectedMuscleDailyEffort,
  type SelectedMuscleWeeklyEffort,
} from './muscle-analytics';
import {
  exerciseDefinitions,
  exerciseSessionFacts,
  exerciseMuscleMappings,
  exerciseSets,
  gyms,
  muscleGroups,
  sessionExercises,
  sessions,
  userSettings,
} from './schema';
import { normalizeSessionSetPerformanceStatus } from '@/src/exercise-calculations/set-semantics';
import { calendarWeekBounds, shiftCalendarWeeks } from '@/src/utils/calendar-weeks';
import { aggregateProgressComparisons, type ProgressMuscleComparison } from './progress-comparisons';
import { buildMuscleReportAssignment } from './muscle-report-presets';

export type StatsPeriodDays = 7 | 30 | 90 | 365;

export type StatsPeriodBounds = {
  days: number;
  start: Date;
  end: Date;
};

export type StatsMusclePerformance = {
  muscleGroupId: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
  /** The muscle's [[muscle.set-count]], so a half-step figure. */
  workingSetCount: number;
  totalVolume: number | null;
};

export type StatsMuscleFamilyPerformance = {
  familyName: string;
  sortOrder: number;
  /** The family's [[muscle.set-count]], deduplicating sets across its muscles. */
  workingSetCount: number;
  totalVolume: number | null;
  muscles: StatsMusclePerformance[];
};

export type StatsTotals = {
  sessionCount: number;
  /** Physical working sets in the window — not per muscle, so never weighted. */
  workingSetCount: number;
  muscleFamilies: StatsMuscleFamilyPerformance[];
};

export type StatsSummary = {
  current: { period: StatsPeriodBounds; totals: StatsTotals };
  previous: { period: StatsPeriodBounds; totals: StatsTotals };
};

export type ProgressComparisons = StatsSummary & { muscles: ProgressMuscleComparison[] };

export type StatsAggregationInput = MuscleAnalyticsInput & {
  /** By anatomy entry id, as read; `inputInScope` re-keys it to the user's muscles. */
  muscleTrainingStarts?: MuscleTrainingStarts;
  /** The user's muscle setup ([[muscle.report-groups]]); unset reports every entry as its own muscle. */
  muscleReport?: MuscleReportAssignment;
};

export type StatsStore = {
  /**
   * The completed sessions in `[start, end)`. Given `now`, also the workout in
   * progress, dated where finishing it now would date it (§2).
   */
  loadAggregationInput(input: { start: Date; end: Date; now?: Date; muscleTrainingStarts?: { gymId?: string | null; countSecondary?: boolean } }): Promise<StatsAggregationInput>;
  loadMuscleGroupTaxonomy(): Promise<StatsAggregationInput['muscleGroups']>;
};

/** Progress uses calendar weeks; day-based readers retain their fixed period domain. */
export type ComputeStatsSummaryOptions = ({ periodDays: StatsPeriodDays; periodWeeks?: never }
  | { periodWeeks: number; periodDays?: never }) & {
  now?: Date;
  gymId?: string | null;
  /** `false` counts primary work only ([[muscle.secondary-filter]]); unset counts it by [[muscle.set-count]]. */
  countSecondary?: boolean;
};

/** Every gym; the workout in progress counts, dated at `now`. */
export type ComputeMuscleDailySetsOptions = {
  start: Date;
  end: Date;
  now: Date;
  /** `false` counts primary work only ([[muscle.secondary-filter]]). */
  countSecondary?: boolean;
};

export type ComputeSelectedMuscleDailyEffortOptions =
  AggregateSelectedMuscleDailyEffortOptions & {
    start: Date;
    end: Date;
    /** The read's clock: given, the workout in progress counts (§2). */
    now?: Date;
    gymId?: string | null;
    countSecondary?: boolean;
  };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const ensureDate = (value: Date, label: string): Date => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
  return value;
};

export const computePeriodBounds = (
  periodDays: StatsPeriodDays,
  now: Date
): StatsPeriodBounds => {
  ensureDate(now, 'now');
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - periodDays * MS_PER_DAY);
  return { days: periodDays, start, end };
};

const computePreviousPeriodBounds = (current: StatsPeriodBounds): StatsPeriodBounds => {
  const end = new Date(current.start.getTime());
  const start = new Date(end.getTime() - current.days * MS_PER_DAY);
  return { days: current.days, start, end };
};

/**
 * The two windows a weekly Progress comparison sets side by side
 * ([[comparison.window]]): the last `weeks` calendar weeks until now, against
 * the `weeks` full calendar weeks before them. The one source for both
 * breakdowns — the muscle tables read it through `comparisonPeriods`, the
 * exercise table through the catalogue stats cache.
 */
export const progressComparisonWindows = (weeks: number, now: Date) => {
  const current = calendarWeekBounds(weeks, now);
  return { current, previous: { start: shiftCalendarWeeks(current.start, -weeks), end: current.start } };
};

const comparisonPeriods = (options: ComputeStatsSummaryOptions) => {
  const now = options.now ?? new Date();
  if (options.periodWeeks === undefined) {
    const current = computePeriodBounds(options.periodDays, now);
    return { now, current, previous: computePreviousPeriodBounds(current) };
  }
  const days = options.periodWeeks * 7;
  const windows = progressComparisonWindows(options.periodWeeks, now);
  return { now, current: { days, ...windows.current }, previous: { days, ...windows.previous } };
};

const inputInPeriod = (input: StatsAggregationInput, period: StatsPeriodBounds): StatsAggregationInput => ({
  ...input, sessions: input.sessions.filter(session => session.completedAt >= period.start && session.completedAt < period.end),
});

const inputInGym = (input: StatsAggregationInput, gymId: string | null | undefined): StatsAggregationInput =>
  gymId === undefined ? input : { ...input, sessions: input.sessions.filter(session => (session.gymId ?? null) === gymId) };

// A read's muscle mappings: every counted role, or primary only ([[muscle.secondary-filter]]).
const inputCountingSecondary = (input: StatsAggregationInput, countSecondary: boolean | undefined): StatsAggregationInput =>
  countSecondary === false ? withoutSecondaryMappings(input) : input;

// A read's muscles: the user's, not their anatomy entries ([[muscle.report-groups]]).
// After the secondary filter, so a merged muscle keeps only the roles that count.
const inputReportingMuscles = (input: StatsAggregationInput): StatsAggregationInput => {
  const { muscleReport } = input;
  if (!muscleReport) return input;
  return { ...applyMuscleReport(input, muscleReport), muscleTrainingStarts: reportMuscleTrainingStarts(input.muscleTrainingStarts, muscleReport) };
};

const inputInScope = (input: StatsAggregationInput, options: { gymId?: string | null; countSecondary?: boolean }) =>
  inputInGym(inputReportingMuscles(inputCountingSecondary(input, options.countSecondary)), options.gymId);

type StatsMuscleAccumulator = { setCounter: MuscleSetCounter; totalVolume: number | null };

/**
 * Per-muscle and per-family [[muscle.set-count]] and Volume, from one pass over
 * the contributions. A family counts each physical set once at its strongest
 * role across the family's muscles, so overlapping muscle counts are never
 * summed into it. A contribution for a muscle outside the taxonomy joins no family.
 */
const accumulateMuscleTotals = (input: StatsAggregationInput) => {
  const byMuscleId = new Map<string, StatsMuscleAccumulator>();
  const counterByFamilyName = new Map<string, MuscleSetCounter>();
  const familyNameByMuscleId = new Map(input.muscleGroups.map((group) => [group.id, group.familyName]));

  for (const contribution of collectMuscleSetContributions(input)) {
    const accumulator = byMuscleId.get(contribution.muscleGroupId)
      ?? { setCounter: createMuscleSetCounter(), totalVolume: 0 };
    byMuscleId.set(contribution.muscleGroupId, accumulator);
    countMuscleSet(accumulator.setCounter, contribution);
    // A set whose load cannot be calculated is left out ([[copy.no-inline-explanation]]).
    accumulator.totalVolume = addFiniteVolume(accumulator.totalVolume, contribution.weightedVolume ?? 0);

    const familyName = familyNameByMuscleId.get(contribution.muscleGroupId);
    if (familyName === undefined) continue;
    const familyCounter = counterByFamilyName.get(familyName) ?? createMuscleSetCounter();
    counterByFamilyName.set(familyName, familyCounter);
    countMuscleSet(familyCounter, contribution);
  }

  return { byMuscleId, counterByFamilyName };
};

export const aggregateStats = (input: StatsAggregationInput): StatsTotals => {
  const { byMuscleId, counterByFamilyName } = accumulateMuscleTotals(input);

  const musclesByFamily = new Map<string, StatsMusclePerformance[]>();
  for (const group of input.muscleGroups) {
    const accumulator = byMuscleId.get(group.id);
    const muscle: StatsMusclePerformance = {
      muscleGroupId: group.id,
      displayName: group.displayName,
      familyName: group.familyName,
      sortOrder: group.sortOrder,
      workingSetCount: accumulator?.setCounter.counts.weightedSetCount ?? 0,
      totalVolume: accumulator ? accumulator.totalVolume : 0,
    };
    const bucket = musclesByFamily.get(group.familyName) ?? [];
    bucket.push(muscle);
    musclesByFamily.set(group.familyName, bucket);
  }

  const muscleFamilies: StatsMuscleFamilyPerformance[] = Array.from(musclesByFamily.entries())
    .map(([familyName, muscles]) => {
      let familyTotalVolume: number | null = 0;
      let familySortOrder = Number.POSITIVE_INFINITY;
      for (const muscle of muscles) {
        familyTotalVolume = addFiniteVolume(familyTotalVolume, muscle.totalVolume);
        if (muscle.sortOrder < familySortOrder) familySortOrder = muscle.sortOrder;
      }
      const sortedMuscles = [...muscles].sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.displayName.localeCompare(right.displayName);
      });
      return {
        familyName,
        sortOrder: Number.isFinite(familySortOrder) ? familySortOrder : 0,
        workingSetCount: counterByFamilyName.get(familyName)?.counts.weightedSetCount ?? 0,
        totalVolume: familyTotalVolume,
        muscles: sortedMuscles,
      };
    })
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.familyName.localeCompare(right.familyName);
    });

  return {
    sessionCount: countedMuscleAnalyticsSessionIds(input).size,
    workingSetCount: countMuscleAnalyticsWorkingSets(input),
    muscleFamilies,
  };
};

export const createDrizzleStatsStore = (): StatsStore => ({
  async loadAggregationInput({ start, end, now, muscleTrainingStarts }) {
    const database = await bootstrapLocalDataLayer();
    // Facts and raw graph are read synchronously from the same current policy.
    if (muscleTrainingStarts) drainExerciseSessionFacts(database);
    return database.transaction((transaction) => {
      const database = transaction;
      const trainingStarts = muscleTrainingStarts ? Object.fromEntries(database
        .select({ id: exerciseMuscleMappings.muscleGroupId,
          firstSets: sql<number | null>`min(case when ${exerciseSessionFacts.workingSets} > 0 then ${exerciseSessionFacts.achievedAt} end)`,
          firstVolume: sql<number | null>`min(case when ${exerciseSessionFacts.volumeSets} > 0 then ${exerciseSessionFacts.achievedAt} end)` })
        .from(exerciseSessionFacts)
        .innerJoin(sessions, eq(sessions.id, exerciseSessionFacts.sessionId))
        .innerJoin(exerciseMuscleMappings, eq(exerciseMuscleMappings.exerciseDefinitionId, exerciseSessionFacts.exerciseDefinitionId))
        .where(and(isNull(sessions.deletedAt), eq(sessions.status, 'completed'),
          lt(exerciseSessionFacts.achievedAt, end), isNull(exerciseMuscleMappings.deletedAt), ne(exerciseMuscleMappings.role, 'stabilizer'),
          muscleTrainingStarts.countSecondary === false ? ne(exerciseMuscleMappings.role, 'secondary') : undefined,
          or(gt(exerciseSessionFacts.workingSets, 0), gt(exerciseSessionFacts.volumeSets, 0)),
          muscleTrainingStarts.gymId === undefined ? undefined : muscleTrainingStarts.gymId === null
            ? isNull(sessions.gymId) : eq(sessions.gymId, muscleTrainingStarts.gymId)))
        .groupBy(exerciseMuscleMappings.muscleGroupId).all()
        .map(row => [row.id, { workingSetCount: row.firstSets === null ? undefined : new Date(row.firstSets),
          totalVolume: row.firstVolume === null ? undefined : new Date(row.firstVolume) }])) : undefined;
      const bodyweightCalculationsEnabled = database
        .select({ enabled: userSettings.bodyweightCalculationsEnabled })
        .from(userSettings)
        .where(eq(userSettings.id, 'settings'))
        .get()?.enabled ?? false;
      const resolveWeight = loadAsOfWeightResolver(database);

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
        .where(
          and(
            eq(sessions.status, 'completed'),
            isNull(sessions.deletedAt),
            gte(sessions.completedAt, start),
            lt(sessions.completedAt, end)
          )
        )
        .all();
      const inProgress = now ? selectDatedInProgressSession(database, { start, end, now }) : null;
      if (inProgress) storedSessionRows.push(inProgress);

      const sessionRows = storedSessionRows.map(row => ({ ...row, ...resolveWeight(row.startedAt) }));

      const sessionsInPeriod = sessionRows
        .filter((row): row is typeof row & { completedAt: Date } => row.completedAt !== null)
        .map((row) => ({ ...row, completedAt: row.completedAt }));

      const sessionIds = sessionsInPeriod.map((session) => session.id);
      const sessionExerciseRows =
        sessionIds.length > 0
          ? database
              .select({
                id: sessionExercises.id,
                sessionId: sessionExercises.sessionId,
                exerciseDefinitionId: sessionExercises.exerciseDefinitionId,
                exerciseName: sessionExercises.name,
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

      const exerciseDefinitionIds = Array.from(
        new Set(
          sessionExerciseRows
            .map((row) => row.exerciseDefinitionId)
            .filter((id): id is string => id !== null)
        )
      );

      const sessionExerciseIds = sessionExerciseRows.map((row) => row.id);
      const exerciseSetRows =
        sessionExerciseIds.length > 0
          ? database
              .select({
                id: exerciseSets.id,
                sessionExerciseId: exerciseSets.sessionExerciseId,
                orderIndex: exerciseSets.orderIndex,
                setType: exerciseSets.setType,
                weightValue: exerciseSets.weightValue,
                repsValue: exerciseSets.repsValue,
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

      const muscleMappingRows =
        exerciseDefinitionIds.length > 0
          ? database
              .select({
                exerciseDefinitionId: exerciseMuscleMappings.exerciseDefinitionId,
                muscleGroupId: exerciseMuscleMappings.muscleGroupId,
                role: exerciseMuscleMappings.role,
              })
              .from(exerciseMuscleMappings)
              .where(
                and(
                  inArray(exerciseMuscleMappings.exerciseDefinitionId, exerciseDefinitionIds),
                  // Exclude muscle links the user removed (kept as tombstones).
                  isNull(exerciseMuscleMappings.deletedAt)
                )
              )
              .all()
          : [];

      const muscleGroupRows = database
        .select({
          id: muscleGroups.id,
          displayName: muscleGroups.displayName,
          familyName: muscleGroups.familyName,
          sortOrder: muscleGroups.sortOrder,
          reportGroup: muscleGroups.reportGroup,
          tracked: muscleGroups.tracked,
        })
        .from(muscleGroups)
        .orderBy(asc(muscleGroups.sortOrder), asc(muscleGroups.displayName))
        .all();

      const exerciseDefinitionRows =
        exerciseDefinitionIds.length > 0
          ? database
              .select({
                id: exerciseDefinitions.id,
                name: exerciseDefinitions.name,
                loadInputMode: exerciseDefinitions.loadInputMode,
                bodyweightContribution: exerciseDefinitions.bodyweightContribution,
              })
              .from(exerciseDefinitions)
              .where(inArray(exerciseDefinitions.id, exerciseDefinitionIds))
              .all()
          : [];

      return {
        muscleTrainingStarts: trainingStarts,
        bodyweightCalculationsEnabled,
        effortPolicy: getPersonalEffortPolicy(),
        sessions: sessionsInPeriod,
        exerciseDefinitions: exerciseDefinitionRows,
        sessionExercises: sessionExerciseRows,
        exerciseSets: exerciseSetRows.map((set) => ({
          ...set,
          performanceStatus: normalizeSessionSetPerformanceStatus(set.performanceStatus),
        })),
        muscleMappings: muscleMappingRows,
        muscleGroups: muscleGroupRows.map(({ id, displayName, familyName, sortOrder }) => ({ id, displayName, familyName, sortOrder })),
        muscleReport: buildMuscleReportAssignment(muscleGroupRows),
      };
    });
  },
  async loadMuscleGroupTaxonomy() {
    const database = await bootstrapLocalDataLayer();
    return database
      .select({
        id: muscleGroups.id,
        displayName: muscleGroups.displayName,
        familyName: muscleGroups.familyName,
        sortOrder: muscleGroups.sortOrder,
      })
      .from(muscleGroups)
      .orderBy(asc(muscleGroups.sortOrder), asc(muscleGroups.displayName))
      .all();
  },
});

export const createStatsRepository = (store: StatsStore = createDrizzleStatsStore()) => ({
  async computeSummary(options: ComputeStatsSummaryOptions): Promise<StatsSummary> {
    const { current: currentPeriod, previous: previousPeriod } = comparisonPeriods(options);

    const [currentInput, previousInput] = await Promise.all([
      store.loadAggregationInput({ start: currentPeriod.start, end: currentPeriod.end }),
      store.loadAggregationInput({ start: previousPeriod.start, end: previousPeriod.end }),
    ]);

    return {
      current: { period: currentPeriod, totals: aggregateStats(inputInScope(currentInput, options)) },
      previous: { period: previousPeriod, totals: aggregateStats(inputInScope(previousInput, options)) },
    };
  },
  async computeMuscleTickers(options: MuscleTickerOptions) {
    const clocked = { ...options, now: options.now ?? new Date() };
    const bounds = muscleTickerBounds(clocked);
    const input = await store.loadAggregationInput({ start: bounds.readStart, end: bounds.end,
      muscleTrainingStarts: { gymId: options.gymId, countSecondary: options.countSecondary } });
    const scoped = inputInScope(input, options);
    return aggregateProgressMuscleTickers(scoped, clocked, scoped.muscleTrainingStarts ?? {});
  },
  async computeProgressComparisons(options: ComputeStatsSummaryOptions): Promise<ProgressComparisons> {
    const periods = comparisonPeriods(options);
    // One awaited read, then synchronous derivation: edits, mappings, dated
    // weight context and the active durable effort policy cannot split periods.
    const input = inputInScope(await store.loadAggregationInput({
      start: periods.previous.start, end: periods.current.end, now: periods.now,
    }), options);
    return {
      current: { period: periods.current, totals: aggregateStats(inputInPeriod(input, periods.current)) },
      previous: { period: periods.previous, totals: aggregateStats(inputInPeriod(input, periods.previous)) },
      muscles: aggregateProgressComparisons(input, periods),
    };
  },
  /** Each of the user's muscles' working sets per local day, under their muscle setup. */
  async computeMuscleDailySets(options: ComputeMuscleDailySetsOptions): Promise<MuscleDailySets> {
    ensureDate(options.start, 'start');
    ensureDate(options.end, 'end');
    const input = await store.loadAggregationInput({ start: options.start, end: options.end, now: options.now });
    return aggregateMuscleDailySets(inputInScope(input, options));
  },
  async computeSelectedMuscleDailyEffort(
    options: ComputeSelectedMuscleDailyEffortOptions
  ): Promise<SelectedMuscleDailyEffort[]> {
    ensureDate(options.start, 'start');
    ensureDate(options.end, 'end');

    const input = await store.loadAggregationInput({
      start: options.start,
      end: options.end,
      now: options.now,
    });
    return aggregateSelectedMuscleDailyEffort(inputInScope(input, options), options);
  },
  async computeSelectedMuscleWeeklyEffort(
    options: ComputeSelectedMuscleDailyEffortOptions
  ): Promise<SelectedMuscleWeeklyEffort[]> {
    ensureDate(options.start, 'start');
    ensureDate(options.end, 'end');

    const input = await store.loadAggregationInput({
      start: options.start,
      end: options.end,
      now: options.now,
    });
    const daily = aggregateSelectedMuscleDailyEffort(inputInScope(input, options), options);
    return aggregateSelectedMuscleWeeklyEffort(daily);
  },
  async computeSelectedMuscleHistoryEffort(options: ComputeSelectedMuscleDailyEffortOptions) {
    ensureDate(options.start, 'start');
    ensureDate(options.end, 'end');
    const input = inputReportingMuscles(inputCountingSecondary(
      await store.loadAggregationInput({ start: options.start, end: options.end, now: options.now }), options.countSecondary));
    const allEffort = aggregateSelectedMuscleDailyEffort(input, options);
    const contributingSessions = new Set(allEffort.flatMap(day => day.contributions.map(row => row.sessionId)));
    const effort = options.gymId === undefined ? allEffort : aggregateSelectedMuscleDailyEffort(inputInGym(input, options.gymId), options);
    return {
      daily: aggregateSelectedMuscleDailyEffortMetrics(effort),
      weekly: aggregateSelectedMuscleWeeklyEffort(effort),
      gyms: exerciseHistoryGymOptions(input.sessions.filter(session => contributingSessions.has(session.id))),
    };
  },
  async computeSelectedMuscleDailyEffortMetrics(
    options: ComputeSelectedMuscleDailyEffortOptions
  ): Promise<DailyEffortMetrics[]> {
    ensureDate(options.start, 'start');
    ensureDate(options.end, 'end');

    const input = await store.loadAggregationInput({
      start: options.start,
      end: options.end,
      now: options.now,
    });
    const daily = aggregateSelectedMuscleDailyEffort(inputInScope(input, options), options);
    return aggregateSelectedMuscleDailyEffortMetrics(daily);
  },
});

const defaultStatsRepository = createStatsRepository();

export const computeStatsSummary = defaultStatsRepository.computeSummary;
export const computeProgressComparisons = defaultStatsRepository.computeProgressComparisons;
export const computeSelectedMuscleDailyEffort =
  defaultStatsRepository.computeSelectedMuscleDailyEffort;
export const computeSelectedMuscleWeeklyEffort =
  defaultStatsRepository.computeSelectedMuscleWeeklyEffort;
export const computeSelectedMuscleDailyEffortMetrics =
  defaultStatsRepository.computeSelectedMuscleDailyEffortMetrics;

export const computeSelectedMuscleHistoryEffort = defaultStatsRepository.computeSelectedMuscleHistoryEffort;

export const computeProgressMuscleTickers = defaultStatsRepository.computeMuscleTickers;

export const computeMuscleDailySets = defaultStatsRepository.computeMuscleDailySets;
