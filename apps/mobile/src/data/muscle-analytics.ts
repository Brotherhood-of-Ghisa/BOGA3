import {
  computeSetVolume,
  estimateOneRepMax,
  parseSetReps,
  parseSetWeight,
} from '@/src/exercise-calculations';

export type MuscleContributionRole = 'primary' | 'secondary' | 'stabilizer' | null;

export type MuscleAnalyticsInput = {
  sessions: { id: string; completedAt: Date }[];
  sessionExercises: {
    id: string;
    sessionId: string;
    exerciseDefinitionId: string | null;
    exerciseName?: string | null;
  }[];
  exerciseSets: {
    id?: string;
    sessionExerciseId: string;
    orderIndex?: number;
    setType: string | null;
    weightValue: string;
    repsValue: string;
  }[];
  muscleMappings: {
    exerciseDefinitionId: string;
    muscleGroupId: string;
    role: MuscleContributionRole;
  }[];
  muscleGroups: {
    id: string;
    displayName: string;
    familyName: string;
    sortOrder: number;
  }[];
};

export type MuscleSetContribution = {
  muscleGroupId: string;
  role: MuscleContributionRole;
  roleWeight: number;
  weightedVolume: number;
  setVolume: number;
  sessionId: string;
  sessionCompletedAt: Date;
  sessionExerciseId: string;
  exerciseDefinitionId: string;
  exerciseName: string | null;
  setId: string | null;
  setOrderIndex: number | null;
  setType: string | null;
  weightValue: string;
  repsValue: string;
};

export type SelectedMuscleDailyContribution = MuscleSetContribution;

export type SelectedMuscleDailyEffort = {
  dateKey: string;
  muscleGroupId: string;
  sessionCount: number;
  setCount: number;
  totalWeight: number;
  contributions: SelectedMuscleDailyContribution[];
};

export type AggregateSelectedMuscleDailyEffortOptions = {
  muscleGroupIds: string[];
  /**
   * Defaults to the runtime local timezone. Tests can pass an IANA timezone
   * to make local-date bucketing deterministic across developer machines.
   */
  timeZone?: string;
};

const WARM_UP_SET_TYPE = 'warm_up';

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const ensureDate = (value: Date, label: string): Date => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
  return value;
};

export const getMuscleContributionRoleWeight = (role: MuscleContributionRole): number => {
  if (role === 'primary') return 1;
  if (role === 'secondary') return 0.5;
  return 0;
};

export const isMuscleAnalyticsWorkingSet = (setType: string | null): boolean =>
  setType !== WARM_UP_SET_TYPE;

export const computeMuscleSetVolume = (weightValue: string, repsValue: string): number => {
  const weight = parseSetWeight(weightValue);
  const reps = parseSetReps(repsValue);
  if (weight === null || reps === null) return 0;
  return computeSetVolume(weight, reps);
};

export const countMuscleAnalyticsWorkingSets = (input: MuscleAnalyticsInput): number => {
  const sessionIds = new Set(input.sessions.map((session) => session.id));
  const includedExerciseIds = new Set<string>();
  for (const exercise of input.sessionExercises) {
    if (sessionIds.has(exercise.sessionId)) {
      includedExerciseIds.add(exercise.id);
    }
  }

  return input.exerciseSets.filter(
    (set) =>
      isMuscleAnalyticsWorkingSet(set.setType) &&
      includedExerciseIds.has(set.sessionExerciseId)
  ).length;
};

const buildMappingsByExerciseDefinitionId = (input: MuscleAnalyticsInput) => {
  const mappingsByExerciseDefinitionId = new Map<string, MuscleAnalyticsInput['muscleMappings']>();
  for (const mapping of input.muscleMappings) {
    const bucket = mappingsByExerciseDefinitionId.get(mapping.exerciseDefinitionId) ?? [];
    bucket.push(mapping);
    mappingsByExerciseDefinitionId.set(mapping.exerciseDefinitionId, bucket);
  }
  return mappingsByExerciseDefinitionId;
};

const compareContribution = (left: MuscleSetContribution, right: MuscleSetContribution) => {
  const completedAtDiff = left.sessionCompletedAt.getTime() - right.sessionCompletedAt.getTime();
  if (completedAtDiff !== 0) return completedAtDiff;

  const sessionDiff = left.sessionId.localeCompare(right.sessionId);
  if (sessionDiff !== 0) return sessionDiff;

  const exerciseDiff = left.sessionExerciseId.localeCompare(right.sessionExerciseId);
  if (exerciseDiff !== 0) return exerciseDiff;

  const leftOrder = left.setOrderIndex ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.setOrderIndex ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  return (left.setId ?? '').localeCompare(right.setId ?? '');
};

export const collectMuscleSetContributions = (
  input: MuscleAnalyticsInput
): MuscleSetContribution[] => {
  const sessionsById = new Map<string, (typeof input.sessions)[number]>();
  for (const session of input.sessions) {
    ensureDate(session.completedAt, 'completedAt');
    sessionsById.set(session.id, session);
  }

  const sessionExerciseById = new Map<string, (typeof input.sessionExercises)[number]>();
  for (const exercise of input.sessionExercises) {
    if (sessionsById.has(exercise.sessionId)) {
      sessionExerciseById.set(exercise.id, exercise);
    }
  }

  const mappingsByExerciseDefinitionId = buildMappingsByExerciseDefinitionId(input);
  const contributions: MuscleSetContribution[] = [];

  for (const set of input.exerciseSets) {
    if (!isMuscleAnalyticsWorkingSet(set.setType)) continue;

    const exercise = sessionExerciseById.get(set.sessionExerciseId);
    if (!exercise || exercise.exerciseDefinitionId === null) continue;

    const session = sessionsById.get(exercise.sessionId);
    if (!session) continue;

    const mappings = mappingsByExerciseDefinitionId.get(exercise.exerciseDefinitionId) ?? [];
    if (mappings.length === 0) continue;

    const setVolume = computeMuscleSetVolume(set.weightValue, set.repsValue);

    for (const mapping of mappings) {
      const roleWeight = getMuscleContributionRoleWeight(mapping.role);
      if (roleWeight === 0) continue;

      contributions.push({
        muscleGroupId: mapping.muscleGroupId,
        role: mapping.role,
        roleWeight,
        weightedVolume: setVolume * roleWeight,
        setVolume,
        sessionId: exercise.sessionId,
        sessionCompletedAt: session.completedAt,
        sessionExerciseId: exercise.id,
        exerciseDefinitionId: exercise.exerciseDefinitionId,
        exerciseName: exercise.exerciseName ?? null,
        setId: set.id ?? null,
        setOrderIndex: set.orderIndex ?? null,
        setType: set.setType,
        weightValue: set.weightValue,
        repsValue: set.repsValue,
      });
    }
  }

  return contributions.sort(compareContribution);
};

const formatLocalDateKey = (date: Date, timeZone: string | undefined): string => {
  ensureDate(date, 'completedAt');

  if (timeZone === undefined) {
    const year = date.getFullYear().toString().padStart(4, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partByType = new Map(parts.map((part) => [part.type, part.value]));
  return `${partByType.get('year')}-${partByType.get('month')}-${partByType.get('day')}`;
};

export const aggregateSelectedMuscleDailyEffort = (
  input: MuscleAnalyticsInput,
  options: AggregateSelectedMuscleDailyEffortOptions
): SelectedMuscleDailyEffort[] => {
  const entriesByDate = new Map<
    string,
    SelectedMuscleDailyEffort & { sessionIds: Set<string> }
  >();
  const muscleGroupIdSet = new Set(options.muscleGroupIds);
  const contributions = collectMuscleSetContributions(input).filter(
    (contribution) => muscleGroupIdSet.has(contribution.muscleGroupId)
  );

  for (const contribution of contributions) {
    const dateKey = formatLocalDateKey(contribution.sessionCompletedAt, options.timeZone);
    const entry = entriesByDate.get(dateKey) ?? {
      dateKey,
      muscleGroupId: contribution.muscleGroupId,
      sessionCount: 0,
      setCount: 0,
      totalWeight: 0,
      contributions: [],
      sessionIds: new Set<string>(),
    };

    entry.sessionIds.add(contribution.sessionId);
    entry.setCount += 1;
    entry.totalWeight += contribution.weightedVolume;
    entry.contributions.push(contribution);
    entriesByDate.set(dateKey, entry);
  }

  return Array.from(entriesByDate.values())
    .map(({ sessionIds, ...entry }) => ({
      ...entry,
      sessionCount: sessionIds.size,
      contributions: [...entry.contributions].sort(compareContribution),
    }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
};

export type CalendarHeatmapMetric = 'totalVolume' | 'nearFailureCount' | 'estimatedRM1' | 'highestWeight';

export type SelectedMuscleWeeklyEffort = {
  weekStartDateKey: string;
  monthKey: string;
  weekOfMonth: number;
  totalVolume: number;
  nearFailureCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};

const NEAR_FAILURE_SET_TYPES = new Set(['rir_0', 'rir_1', 'rir_2']);

/**
 * Per-day rollup of the four heatmap metrics (volume / near-failure / 1RM / top
 * weight). Shared by the muscle and exercise daily heatmaps. `highestWeight` and
 * `estimatedRM1` are best-of values, so weekly cells can be derived from these by
 * summing volume/near-failure and taking the max of weight/1RM across the days.
 */
export type DailyEffortMetrics = {
  dateKey: string;
  totalVolume: number;
  nearFailureCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};

type EffortMetricAccumulator = {
  totalVolume: number;
  nearFailureCount: number;
  bestRM1: number | null;
  highestWeight: number | null;
};

export const createEffortMetricAccumulator = (): EffortMetricAccumulator => ({
  totalVolume: 0,
  nearFailureCount: 0,
  bestRM1: null,
  highestWeight: null,
});

/** Fold a single muscle set contribution into a metric accumulator. */
export const accumulateContributionMetrics = (
  acc: EffortMetricAccumulator,
  contribution: MuscleSetContribution
): void => {
  acc.totalVolume += contribution.weightedVolume;

  if (contribution.setType !== null && NEAR_FAILURE_SET_TYPES.has(contribution.setType)) {
    acc.nearFailureCount += 1;
  }

  const weight = parseSetWeight(contribution.weightValue);
  const reps = parseSetReps(contribution.repsValue);

  if (weight !== null) {
    acc.highestWeight = acc.highestWeight === null ? weight : Math.max(acc.highestWeight, weight);

    if (reps !== null) {
      const rm1 = estimateOneRepMax(weight, reps);
      if (rm1 !== null) {
        acc.bestRM1 = acc.bestRM1 === null ? rm1 : Math.max(acc.bestRM1, rm1);
      }
    }
  }
};

const dateKeyToUtcDate = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatUtcDateKey = (date: Date): string => {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfMondayWeek = (date: Date): Date => {
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
};

export const aggregateSelectedMuscleWeeklyEffort = (
  dailyEffort: SelectedMuscleDailyEffort[]
): SelectedMuscleWeeklyEffort[] => {
  type WeekAccumulator = {
    weekStartDateKey: string;
    monthKey: string;
    totalVolume: number;
    nearFailureCount: number;
    bestRM1: number | null;
    highestWeight: number | null;
  };

  const weekMap = new Map<string, WeekAccumulator>();

  for (const day of dailyEffort) {
    const dayDate = dateKeyToUtcDate(day.dateKey);
    const weekStart = startOfMondayWeek(dayDate);
    const weekStartDateKey = formatUtcDateKey(weekStart);
    const monthKey = `${weekStart.getUTCFullYear().toString().padStart(4, '0')}-${(weekStart.getUTCMonth() + 1).toString().padStart(2, '0')}`;

    const acc = weekMap.get(weekStartDateKey) ?? {
      weekStartDateKey,
      monthKey,
      totalVolume: 0,
      nearFailureCount: 0,
      bestRM1: null,
      highestWeight: null,
    };

    for (const contribution of day.contributions) {
      accumulateContributionMetrics(acc, contribution);
    }

    weekMap.set(weekStartDateKey, acc);
  }

  // Sort weeks by date, then assign weekOfMonth (1-based)
  const sortedWeeks = Array.from(weekMap.values()).sort((a, b) =>
    a.weekStartDateKey.localeCompare(b.weekStartDateKey)
  );

  // Track week-of-month index per month. Every training week is kept — the
  // heatmaps draw a bar/column per week and the WeekSelectionBanner resolves
  // any of them, so there is no 4-week-per-month layout cap to clip against.
  const monthWeekCount = new Map<string, number>();
  const result: SelectedMuscleWeeklyEffort[] = [];

  for (const week of sortedWeeks) {
    const prev = monthWeekCount.get(week.monthKey) ?? 0;
    const weekOfMonth = prev + 1;
    monthWeekCount.set(week.monthKey, weekOfMonth);

    result.push({
      weekStartDateKey: week.weekStartDateKey,
      monthKey: week.monthKey,
      weekOfMonth,
      totalVolume: week.totalVolume,
      nearFailureCount: week.nearFailureCount,
      estimatedRM1: week.bestRM1,
      highestWeight: week.highestWeight,
    });
  }

  return result;
};

/**
 * Per-day metric rollup for the daily heatmap grid, derived from the same daily
 * effort the weekly aggregator consumes. One entry per training day, sorted by date.
 */
export const aggregateSelectedMuscleDailyEffortMetrics = (
  dailyEffort: SelectedMuscleDailyEffort[]
): DailyEffortMetrics[] =>
  dailyEffort
    .map((day) => {
      const acc = createEffortMetricAccumulator();
      for (const contribution of day.contributions) {
        accumulateContributionMetrics(acc, contribution);
      }
      return {
        dateKey: day.dateKey,
        totalVolume: acc.totalVolume,
        nearFailureCount: acc.nearFailureCount,
        estimatedRM1: acc.bestRM1,
        highestWeight: acc.highestWeight,
      };
    })
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
