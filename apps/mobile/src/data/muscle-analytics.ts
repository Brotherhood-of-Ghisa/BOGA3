import type { SessionWeightContext } from '@/src/bodyweight/as-of';
import type { EffortCalculationPolicy } from '@/src/exercise-calculations/effort-policy';
import { type SetMetrics } from '@/src/exercise-calculations/load-metrics';
import { addFiniteVolume, calculateAnalyticsSetMetrics, enteredWeightKg, personalLoadContext } from '@/src/exercise-calculations/analytics';
import {
  countedSessionIds,
  isWorkingSet,
  isVolumeSet,
  type SessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

export type MuscleContributionRole = 'primary' | 'secondary' | 'stabilizer' | null;

export type MuscleAnalyticsInput = {
  effortPolicy?: EffortCalculationPolicy;
  bodyweightCalculationsEnabled?: boolean;
  exerciseDefinitions?: {
    id: string;
    name?: string;
    loadInputMode: 'total_load' | 'per_side_load';
    bodyweightContribution: number;
  }[];
  sessions: ({ id: string; completedAt: Date } & SessionWeightContext)[];
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
    performanceStatus?: SessionSetPerformanceStatus;
  }[];
  muscleMappings: {
    exerciseDefinitionId: string;
    muscleGroupId: string;
    role: MuscleContributionRole;
    /** Persisted for compatibility; muscle analytics derives its factor from role. */
    weight?: number;
  }[];
  muscleGroups: {
    id: string;
    displayName: string;
    familyName: string;
    sortOrder: number;
  }[];
};

export type MuscleSetContribution = {
  working: boolean;
  volumeIncluded: boolean;
  /** Stable identity of the physical source set within one aggregation run. */
  setIdentity: string;
  muscleGroupId: string;
  role: MuscleContributionRole;
  roleWeight: number;
  weightedVolume: number | null;
  setVolume: number | null;
  metrics: SetMetrics;
  enteredWeightKg: number | null;
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
  totalWeight: number | null;
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

/** Personal working-set eligibility controls counts and strength metrics. */
const isMuscleAnalyticsWorkingSet = (
  set: MuscleAnalyticsInput['exerciseSets'][number], policy?: EffortCalculationPolicy,
): boolean =>
  isWorkingSet({
    reps: set.repsValue,
    weight: set.weightValue,
    performanceStatus: set.performanceStatus,
    setType: set.setType,
  }, policy);

const sessionIdByExerciseId = (input: MuscleAnalyticsInput): Map<string, string> => {
  const sessionIds = new Set(input.sessions.map((session) => session.id));
  const byExerciseId = new Map<string, string>();
  for (const exercise of input.sessionExercises) {
    if (sessionIds.has(exercise.sessionId)) byExerciseId.set(exercise.id, exercise.sessionId);
  }
  return byExerciseId;
};

export const countMuscleAnalyticsWorkingSets = (input: MuscleAnalyticsInput): number => {
  const sessionIdOf = sessionIdByExerciseId(input);
  return input.exerciseSets.filter(
    (set) => sessionIdOf.has(set.sessionExerciseId) && isMuscleAnalyticsWorkingSet(set, input.effortPolicy)
  ).length;
};

/** The input's sessions that count toward a statistic (`isCountedSession`), by id. */
export const countedMuscleAnalyticsSessionIds = (input: MuscleAnalyticsInput): Set<string> => {
  const sessionIdOf = sessionIdByExerciseId(input);
  return countedSessionIds(input.exerciseSets, (set) => ({
    sessionId: sessionIdOf.get(set.sessionExerciseId),
    reps: set.repsValue,
    weight: set.weightValue,
    performanceStatus: set.performanceStatus,
    setType: set.setType,
  }), input.effortPolicy);
};

const buildMappingsByExerciseDefinitionId = (input: MuscleAnalyticsInput) => {
  const mappingsByExerciseDefinitionId = new Map<string, Map<string, MuscleAnalyticsInput['muscleMappings'][number]>>();
  for (const mapping of input.muscleMappings) {
    const bucket = mappingsByExerciseDefinitionId.get(mapping.exerciseDefinitionId) ?? new Map();
    const existing = bucket.get(mapping.muscleGroupId);
    if (!existing || getMuscleContributionRoleWeight(mapping.role) > getMuscleContributionRoleWeight(existing.role)) {
      bucket.set(mapping.muscleGroupId, mapping);
    }
    mappingsByExerciseDefinitionId.set(mapping.exerciseDefinitionId, bucket);
  }
  return new Map([...mappingsByExerciseDefinitionId].map(([id, bucket]) => [id, [...bucket.values()]]));
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
  const definitionById = new Map(
    (input.exerciseDefinitions ?? []).map((definition) => [definition.id, definition])
  );
  const contributions: MuscleSetContribution[] = [];

  // Emit either contribution, carrying settled eligibility for each column.
  for (const [setIndex, set] of input.exerciseSets.entries()) {
    const working = isMuscleAnalyticsWorkingSet(set, input.effortPolicy);
    const volumeIncluded = isVolumeSet({ reps: set.repsValue, weight: set.weightValue,
      performanceStatus: set.performanceStatus, setType: set.setType }, input.effortPolicy);
    if (!working && !volumeIncluded) continue;

    const exercise = sessionExerciseById.get(set.sessionExerciseId);
    if (!exercise || exercise.exerciseDefinitionId === null) continue;

    const session = sessionsById.get(exercise.sessionId);
    if (!session) continue;

    const mappings = mappingsByExerciseDefinitionId.get(exercise.exerciseDefinitionId) ?? [];
    if (mappings.length === 0) continue;

    const context = personalLoadContext(
      input.bodyweightCalculationsEnabled ?? false,
      definitionById.get(exercise.exerciseDefinitionId),
      session,
      input.effortPolicy,
    );
    const metrics = calculateAnalyticsSetMetrics({ ...set, ...context });
    const rawSetVolume = !volumeIncluded ? 0 : metrics.eligible && metrics.load.status === 'known'
      ? metrics.load.perSideCalculatedLoadKg * metrics.reps : null;
    const setVolume = rawSetVolume !== null && Number.isFinite(rawSetVolume) ? rawSetVolume : null;

    for (const mapping of mappings) {
      const roleWeight = getMuscleContributionRoleWeight(mapping.role);
      if (roleWeight === 0) continue;

      contributions.push({
        working, volumeIncluded,
        setIdentity: set.id !== undefined ? `id:${set.id}` : `row:${setIndex}`,
        muscleGroupId: mapping.muscleGroupId,
        role: mapping.role,
        roleWeight,
        weightedVolume: setVolume === null ? null : setVolume * roleWeight,
        metrics, enteredWeightKg: enteredWeightKg(set),
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

    entriesByDate.set(dateKey, entry);
    if (contribution.working !== false) {
      entry.setCount += 1;
      entry.sessionIds.add(contribution.sessionId);
    }
    entry.totalWeight = addFiniteVolume(entry.totalWeight, contribution.weightedVolume ?? 0);
    entry.contributions.push(contribution);
  }

  // A volume-only day has a volume cell and zero counted sets/sessions.
  return Array.from(entriesByDate.values())
    .map(({ sessionIds, ...entry }) => ({
      ...entry,
      sessionCount: sessionIds.size,
      contributions: [...entry.contributions].sort(compareContribution),
    }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
};

export type CalendarHeatmapMetric = 'totalVolume' | 'workingSetCount' | 'estimatedRM1' | 'highestWeight';

export type SelectedMuscleWeeklyEffort = {
  weekStartDateKey: string;
  monthKey: string;
  weekOfMonth: number;
  totalVolume: number | null;
  workingSetCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};

/**
 * Per-day rollup of the four heatmap metrics (volume / working sets / 1RM / top
 * weight). Shared by the muscle and exercise daily heatmaps. `highestWeight` and
 * `estimatedRM1` are best-of values, so weekly cells can be derived from these by
 * summing volume/working sets and taking the max of weight/1RM across the days.
 */
export type DailyEffortMetrics = {
  dateKey: string;
  /** Per-muscle counts for target grading; the existing displayed metrics are unchanged. */
  workingSetCountsByMuscle?: Record<string, number>;
  /** The completed sessions whose sets make up the day, each once: a day tile opens them. */
  sessionIds?: string[];
  /** Existing all-time session-fact counts for [[comparison.history-prs]]. */
  personalRecordCounts?: Record<Exclude<CalendarHeatmapMetric, 'workingSetCount'>, number>;
  totalVolume: number | null;
  workingSetCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};

type EffortMetricAccumulator = {
  totalVolume: number | null;
  workingSetCount: number;
  bestRM1: number | null;
  highestWeight: number | null;
};

export const createEffortMetricAccumulator = (): EffortMetricAccumulator => ({
  totalVolume: 0,
  workingSetCount: 0,
  bestRM1: null,
  highestWeight: null,
});

/** Fold a single muscle set contribution into a metric accumulator. */
export const accumulateContributionMetrics = (
  acc: EffortMetricAccumulator,
  contribution: MuscleSetContribution
): void => {
  // A set whose load cannot be calculated is left out ([[copy.no-inline-explanation]]).
  acc.totalVolume = addFiniteVolume(acc.totalVolume, contribution.weightedVolume ?? 0);

  if (contribution.working === false) return;
  acc.workingSetCount += 1;

  const weight = contribution.enteredWeightKg;
  if (weight !== null) acc.highestWeight = Math.max(acc.highestWeight ?? 0, weight);
  const rm1 = contribution.metrics.estimatedOneRepMaxKg;
  if (rm1 !== null) acc.bestRM1 = Math.max(acc.bestRM1 ?? 0, rm1);
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
    totalVolume: number | null;
    workingSetCount: number;
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
      workingSetCount: 0,
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
  // heatmaps draw every week, with no 4-week-per-month layout cap.
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
      workingSetCount: week.workingSetCount,
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
      const identitiesByMuscle = new Map<string, Set<string>>();
      for (const contribution of day.contributions) {
        accumulateContributionMetrics(acc, contribution);
        if (contribution.working === false) continue;
        const identities = identitiesByMuscle.get(contribution.muscleGroupId) ?? new Set<string>();
        identities.add(contribution.setIdentity);
        identitiesByMuscle.set(contribution.muscleGroupId, identities);
      }
      return {
        dateKey: day.dateKey,
        workingSetCountsByMuscle: Object.fromEntries([...identitiesByMuscle].map(([id, identities]) => [id, identities.size])),
        sessionIds: [...new Set(day.contributions.map((contribution) => contribution.sessionId))],
        totalVolume: acc.totalVolume,
        workingSetCount: acc.workingSetCount,
        estimatedRM1: acc.bestRM1,
        highestWeight: acc.highestWeight,
      };
    })
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
