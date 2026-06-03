import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import {
  aggregateSelectedMuscleDailyEffort,
  aggregateSelectedMuscleWeeklyEffort,
  collectMuscleSetContributions,
  countMuscleAnalyticsWorkingSets,
  type AggregateSelectedMuscleDailyEffortOptions,
  type MuscleAnalyticsInput,
  type SelectedMuscleDailyEffort,
  type SelectedMuscleWeeklyEffort,
} from './muscle-analytics';
import {
  exerciseMuscleMappings,
  exerciseSets,
  muscleGroups,
  sessionExercises,
  sessions,
} from './schema';

export type StatsPeriodDays = 7 | 30 | 365;

export type StatsPeriodBounds = {
  days: StatsPeriodDays;
  start: Date;
  end: Date;
};

export type StatsMusclePerformance = {
  muscleGroupId: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
  sessionCount: number;
  totalWeight: number;
};

export type StatsMuscleFamilyPerformance = {
  familyName: string;
  sortOrder: number;
  sessionCount: number;
  totalWeight: number;
  muscles: StatsMusclePerformance[];
};

export type StatsTotals = {
  sessionCount: number;
  totalSets: number;
  muscleFamilies: StatsMuscleFamilyPerformance[];
};

export type StatsSummary = {
  current: { period: StatsPeriodBounds; totals: StatsTotals };
  previous: { period: StatsPeriodBounds; totals: StatsTotals };
};

export type StatsAggregationInput = MuscleAnalyticsInput;

export type StatsStore = {
  loadAggregationInput(input: { start: Date; end: Date }): Promise<StatsAggregationInput>;
  loadMuscleGroupTaxonomy(): Promise<StatsAggregationInput['muscleGroups']>;
};

export type ComputeStatsSummaryOptions = {
  periodDays: StatsPeriodDays;
  now?: Date;
};

export type ComputeSelectedMuscleDailyEffortOptions =
  AggregateSelectedMuscleDailyEffortOptions & {
    start: Date;
    end: Date;
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

export const aggregateStats = (input: StatsAggregationInput): StatsTotals => {
  const totalWeightByMuscleId = new Map<string, number>();
  const sessionsByMuscleId = new Map<string, Set<string>>();

  for (const contribution of collectMuscleSetContributions(input)) {
    if (contribution.weightedVolume > 0) {
      totalWeightByMuscleId.set(
        contribution.muscleGroupId,
        (totalWeightByMuscleId.get(contribution.muscleGroupId) ?? 0) +
          contribution.weightedVolume
      );
    }

    const sessionsForMuscle =
      sessionsByMuscleId.get(contribution.muscleGroupId) ?? new Set<string>();
    sessionsForMuscle.add(contribution.sessionId);
    sessionsByMuscleId.set(contribution.muscleGroupId, sessionsForMuscle);
  }

  const musclesByFamily = new Map<string, StatsMusclePerformance[]>();
  for (const group of input.muscleGroups) {
    const muscle: StatsMusclePerformance = {
      muscleGroupId: group.id,
      displayName: group.displayName,
      familyName: group.familyName,
      sortOrder: group.sortOrder,
      sessionCount: sessionsByMuscleId.get(group.id)?.size ?? 0,
      totalWeight: totalWeightByMuscleId.get(group.id) ?? 0,
    };
    const bucket = musclesByFamily.get(group.familyName) ?? [];
    bucket.push(muscle);
    musclesByFamily.set(group.familyName, bucket);
  }

  const muscleFamilies: StatsMuscleFamilyPerformance[] = Array.from(musclesByFamily.entries())
    .map(([familyName, muscles]) => {
      const familySessionIds = new Set<string>();
      let familyTotalWeight = 0;
      let familySortOrder = Number.POSITIVE_INFINITY;
      for (const muscle of muscles) {
        familyTotalWeight += muscle.totalWeight;
        if (muscle.sortOrder < familySortOrder) familySortOrder = muscle.sortOrder;
        const sessionIds = sessionsByMuscleId.get(muscle.muscleGroupId);
        if (sessionIds) {
          for (const id of sessionIds) familySessionIds.add(id);
        }
      }
      const sortedMuscles = [...muscles].sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.displayName.localeCompare(right.displayName);
      });
      return {
        familyName,
        sortOrder: Number.isFinite(familySortOrder) ? familySortOrder : 0,
        sessionCount: familySessionIds.size,
        totalWeight: familyTotalWeight,
        muscles: sortedMuscles,
      };
    })
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.familyName.localeCompare(right.familyName);
    });

  return {
    sessionCount: input.sessions.length,
    totalSets: countMuscleAnalyticsWorkingSets(input),
    muscleFamilies,
  };
};

export const createDrizzleStatsStore = (): StatsStore => ({
  async loadAggregationInput({ start, end }) {
    const database = await bootstrapLocalDataLayer();

    const sessionRows = database
      .select({
        id: sessions.id,
        completedAt: sessions.completedAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.status, 'completed'),
          isNull(sessions.deletedAt),
          gte(sessions.completedAt, start),
          lt(sessions.completedAt, end)
        )
      )
      .all();

    const sessionsInPeriod = sessionRows
      .filter((row): row is { id: string; completedAt: Date } => row.completedAt !== null)
      .map((row) => ({ id: row.id, completedAt: row.completedAt }));

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
      })
      .from(muscleGroups)
      .orderBy(asc(muscleGroups.sortOrder), asc(muscleGroups.displayName))
      .all();

    return {
      sessions: sessionsInPeriod,
      sessionExercises: sessionExerciseRows,
      exerciseSets: exerciseSetRows,
      muscleMappings: muscleMappingRows,
      muscleGroups: muscleGroupRows,
    };
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
    const now = options.now ?? new Date();
    const currentPeriod = computePeriodBounds(options.periodDays, now);
    const previousPeriod = computePreviousPeriodBounds(currentPeriod);

    const [currentInput, previousInput] = await Promise.all([
      store.loadAggregationInput({ start: currentPeriod.start, end: currentPeriod.end }),
      store.loadAggregationInput({ start: previousPeriod.start, end: previousPeriod.end }),
    ]);

    return {
      current: { period: currentPeriod, totals: aggregateStats(currentInput) },
      previous: { period: previousPeriod, totals: aggregateStats(previousInput) },
    };
  },
  async computeSelectedMuscleDailyEffort(
    options: ComputeSelectedMuscleDailyEffortOptions
  ): Promise<SelectedMuscleDailyEffort[]> {
    ensureDate(options.start, 'start');
    ensureDate(options.end, 'end');

    const input = await store.loadAggregationInput({
      start: options.start,
      end: options.end,
    });
    return aggregateSelectedMuscleDailyEffort(input, options);
  },
  async computeSelectedMuscleWeeklyEffort(
    options: ComputeSelectedMuscleDailyEffortOptions
  ): Promise<SelectedMuscleWeeklyEffort[]> {
    ensureDate(options.start, 'start');
    ensureDate(options.end, 'end');

    const input = await store.loadAggregationInput({
      start: options.start,
      end: options.end,
    });
    const daily = aggregateSelectedMuscleDailyEffort(input, options);
    return aggregateSelectedMuscleWeeklyEffort(daily);
  },
});

const defaultStatsRepository = createStatsRepository();

export const computeStatsSummary = defaultStatsRepository.computeSummary;
export const computeSelectedMuscleDailyEffort =
  defaultStatsRepository.computeSelectedMuscleDailyEffort;
export const computeSelectedMuscleWeeklyEffort =
  defaultStatsRepository.computeSelectedMuscleWeeklyEffort;
