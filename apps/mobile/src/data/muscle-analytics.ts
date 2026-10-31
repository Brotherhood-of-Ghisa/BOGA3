import { addCompensated, compensatedValue, createCompensatedSum, type CompensatedSum } from '../utils/sum.ts';
import type { SessionWeightContext } from '../bodyweight/as-of.ts';
import type { EffortCalculationPolicy } from '../exercise-calculations/effort-policy.ts';
import { type SetMetrics } from '../exercise-calculations/load-metrics.ts';
import { addFiniteVolume, calculateAnalyticsSetMetrics, enteredWeightKg, personalLoadContext } from '../exercise-calculations/analytics.ts';
import {
  countedSessionIds,
  isWorkingSet,
  isVolumeSet,
  type SessionSetPerformanceStatus,
} from '../exercise-calculations/set-semantics.ts';

export type MuscleContributionRole = 'primary' | 'secondary' | 'stabilizer' | null;

/** Read-time shares, assigned before visibility filtering or Broad grouping. */
export type MuscleAllocation = { primary: number; secondary: number };

export type MuscleAnalyticsInput = {
  effortPolicy?: EffortCalculationPolicy;
  countSecondarySets?: boolean;
  countSecondaryVolume?: boolean;
  bodyweightCalculationsEnabled?: boolean;
  exerciseDefinitions?: {
    id: string;
    name?: string;
    loadInputMode: 'total_load' | 'per_side_load';
    bodyweightContribution: number;
  }[];
  sessions: ({ id: string; completedAt: Date; gymId?: string | null; gymName?: string | null } & SessionWeightContext)[];
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
    allocation?: MuscleAllocation;
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
  /** Physical working eligibility before the muscle-role setting. */
  physicalWorking?: boolean;
  volumeIncluded: boolean;
  /** Stable identity of the physical source set within one aggregation run. */
  setIdentity: string;
  muscleGroupId: string;
  role: MuscleContributionRole;
  /** Set credit, independent of the Volume allocation. */
  roleWeight: number;
  allocation?: MuscleAllocation;
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

/**
 * The input a view that hides secondary work reads ([[muscle.secondary-filter]]):
 * its secondary mappings are dropped, so a muscle counts only the exercises it
 * is primary for, in Sets and Volume alike.
 */
export const withoutSecondaryMappings = <T extends MuscleAnalyticsInput>(input: T): T => ({
  ...input, muscleMappings: input.muscleMappings.filter((mapping) => mapping.role !== 'secondary'),
});

/** A muscle as a view reports it: an anatomy entry, or the group several entries report under. */
export type ReportedMuscle = MuscleAnalyticsInput['muscleGroups'][number];

/**
 * Which muscle each anatomy entry reports under, and whether the user tracks
 * it, by entry id. An entry with no assignment is its own tracked muscle.
 */
export type MuscleReportAssignment = ReadonlyMap<string, { muscle: ReportedMuscle; tracked: boolean }>;

const isSameMuscle = (left: ReportedMuscle, right: ReportedMuscle): boolean =>
  left.id === right.id && left.displayName === right.displayName
  && left.familyName === right.familyName && left.sortOrder === right.sortOrder;

/**
 * The input a view reads under the user's muscle setup ([[muscle.report-groups]]):
 * mappings receive their shares, are re-keyed from anatomy entry to muscle,
 * and all Volume shares sum; the strongest role labels and counts the muscle. Untracked
 * entries drop ([[muscle.untracked]]), and `muscleGroups` becomes the tracked
 * muscles in first-seen order. With every entry its own tracked muscle (Detailed)
 * the allocation is unchanged. Supply complete raw mappings so hidden entries
 * and metric settings cannot redistribute either Volume pool.
 */
export const applyMuscleReport = <T extends MuscleAnalyticsInput>(
  input: T, assignment: MuscleReportAssignment,
): T => {
  const grouped = new Map<string, {
    mapping: MuscleAnalyticsInput['muscleMappings'][number];
    primary: CompensatedSum; secondary: CompensatedSum;
  }>();
  for (const mapping of allocatedMuscleMappings(input.muscleMappings)) {
    const assigned = assignment.get(mapping.muscleGroupId);
    if (assigned?.tracked === false) continue;
    const muscleId = assigned?.muscle.id ?? mapping.muscleGroupId;
    const key = JSON.stringify([mapping.exerciseDefinitionId, muscleId]);
    const existing = grouped.get(key) ?? { mapping, primary: createCompensatedSum(), secondary: createCompensatedSum() };
    addCompensated(existing.primary, mapping.allocation.primary);
    addCompensated(existing.secondary, mapping.allocation.secondary);
    const role = getMuscleContributionRoleWeight(existing.mapping.role) > getMuscleContributionRoleWeight(mapping.role)
      ? existing.mapping.role : mapping.role;
    existing.mapping = { ...mapping, muscleGroupId: muscleId, role };
    grouped.set(key, existing);
  }

  const muscles = new Map<string, ReportedMuscle>();
  for (const entry of input.muscleGroups) {
    const assigned = assignment.get(entry.id);
    if (assigned?.tracked === false) continue;
    const muscle = assigned && !isSameMuscle(assigned.muscle, entry) ? assigned.muscle : entry;
    if (!muscles.has(muscle.id)) muscles.set(muscle.id, muscle);
  }

  return { ...input, muscleMappings: [...grouped.values()].map(({ mapping, primary, secondary }) => {
    return { ...mapping, allocation: { primary: compensatedValue(primary), secondary: compensatedValue(secondary) } };
  }), muscleGroups: [...muscles.values()] };
};

/**
 * The working sets a muscle got, by role and combined ([[muscle.set-count]]).
 * `weightedSetCount` is what an unqualified `Sets` for a muscle shows; the two
 * role figures are there for a surface that names them.
 */
export type MuscleSetCounts = {
  /** Physical working sets at a primary role. */
  primarySetCount: number;
  /** Secondary sets, each before its ½ weight. */
  secondarySetCount: number;
  /** The combined allocated working-set shares, without rounding. */
  weightedSetCount: number;
};

/** One bucket counts each physical set once, at its strongest role. */
export type MuscleSetCounter = {
  counts: MuscleSetCounts;
  roleWeightBySet: Map<string, number>;
};

export const createMuscleSetCounter = (): MuscleSetCounter => ({
  counts: { primarySetCount: 0, secondarySetCount: 0, weightedSetCount: 0 },
  roleWeightBySet: new Map(),
});

/** Set credit never divides by mapping cardinality or adds repeated merged entries. */
export const countMuscleSet = (counter: MuscleSetCounter, contribution: MuscleSetContribution): void => {
  if (contribution.working === false || contribution.roleWeight === 0) return;
  const previous = counter.roleWeightBySet.get(contribution.setIdentity) ?? 0;
  if (previous >= contribution.roleWeight) return;
  counter.roleWeightBySet.set(contribution.setIdentity, contribution.roleWeight);
  const counts = counter.counts;
  if (previous === 0.5) counts.secondarySetCount -= 1;
  if (contribution.roleWeight === 1) counts.primarySetCount += 1;
  else counts.secondarySetCount += 1;
  counts.weightedSetCount = counts.primarySetCount + counts.secondarySetCount / 2;
};

/** One bucket's [[muscle.set-count]] over a whole list of contributions. */
export const countMuscleSets = (contributions: Iterable<MuscleSetContribution>): MuscleSetCounts => {
  const counter = createMuscleSetCounter();
  for (const contribution of contributions) countMuscleSet(counter, contribution);
  return counter.counts;
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

/** Allocate each role's Volume pool before visibility or muscle grouping. */
const allocatedMuscleMappings = (mappings: MuscleAnalyticsInput['muscleMappings']) => {
  const byExercise = new Map<string, Map<string, MuscleAnalyticsInput['muscleMappings'][number]>>();
  for (const mapping of mappings) {
    const bucket = byExercise.get(mapping.exerciseDefinitionId) ?? new Map();
    const existing = bucket.get(mapping.muscleGroupId);
    if (!existing || getMuscleContributionRoleWeight(mapping.role) > getMuscleContributionRoleWeight(existing.role)) {
      bucket.set(mapping.muscleGroupId, mapping);
    }
    byExercise.set(mapping.exerciseDefinitionId, bucket);
  }
  return [...byExercise.values()].flatMap(bucket => {
    const entries = [...bucket.values()];
    const primaryCount = entries.filter(mapping => mapping.role === 'primary').length;
    const secondaryCount = entries.filter(mapping => mapping.role === 'secondary').length;
    return entries.map(mapping => ({ ...mapping, allocation: mapping.allocation ?? {
      primary: mapping.role === 'primary' ? 1 / primaryCount : 0,
      secondary: mapping.role === 'secondary' ? 0.5 / secondaryCount : 0,
    } }));
  });
};

const buildMappingsByExerciseDefinitionId = (input: MuscleAnalyticsInput) => {
  const byExercise = new Map<string, ReturnType<typeof allocatedMuscleMappings>>();
  for (const mapping of allocatedMuscleMappings(input.muscleMappings)) {
    const bucket = byExercise.get(mapping.exerciseDefinitionId) ?? [];
    bucket.push(mapping);
    byExercise.set(mapping.exerciseDefinitionId, bucket);
  }
  return byExercise;
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
      const roleWeight = mapping.role === 'secondary' && input.countSecondarySets === false
        ? 0 : getMuscleContributionRoleWeight(mapping.role);
      const volumeWeight = mapping.allocation.primary
        + (input.countSecondaryVolume === false ? 0 : mapping.allocation.secondary);
      if ((!working || roleWeight === 0) && (!volumeIncluded || volumeWeight === 0)) continue;

      contributions.push({
        physicalWorking: working, working: working && roleWeight > 0, volumeIncluded: volumeIncluded && volumeWeight > 0,
        setIdentity: set.id !== undefined ? `id:${set.id}` : `row:${setIndex}`,
        muscleGroupId: mapping.muscleGroupId,
        role: mapping.role,
        roleWeight, allocation: mapping.allocation,
        weightedVolume: !volumeIncluded || volumeWeight === 0 ? 0 : setVolume === null ? null : setVolume * volumeWeight,
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
    SelectedMuscleDailyEffort & { sessionIds: Set<string>; setCounter: MuscleSetCounter }
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
      setCounter: createMuscleSetCounter(),
    };

    entriesByDate.set(dateKey, entry);
    if (contribution.working !== false) {
      countMuscleSet(entry.setCounter, contribution);
      entry.setCount = entry.setCounter.counts.weightedSetCount;
      entry.sessionIds.add(contribution.sessionId);
    }
    entry.totalWeight = addFiniteVolume(entry.totalWeight, contribution.weightedVolume ?? 0);
    entry.contributions.push(contribution);
  }

  // A volume-only day has a volume cell and zero counted sets/sessions.
  return Array.from(entriesByDate.values())
    .map(({ sessionIds, setCounter: _counter, ...entry }) => ({
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
  volumeSetCount?: number;
  hasWorkingSets?: boolean;
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
  /** Per-muscle [[muscle.set-count]] for target grading, so a graded cell matches its figure. */
  workingSetCountsByMuscle?: Record<string, number>;
  /** The completed sessions whose sets make up the day, each once: a day tile opens them. */
  sessionIds?: string[];
  sessionIdsByMetric?: Partial<Record<CalendarHeatmapMetric, string[]>>;
  /** Existing all-time session-fact counts for the history views' record marks. */
  personalRecordCounts?: Record<Exclude<CalendarHeatmapMetric, 'workingSetCount'>, number>;
  totalVolume: number | null;
  volumeSetCount?: number;
  workingSetCount: number;
  estimatedRM1: number | null;
  highestWeight: number | null;
};

type EffortMetricAccumulator = {
  totalVolume: number | null;
  volumeSetCount: number;
  /** The bucket's [[muscle.set-count]]; `setCounter` keeps it weighted. */
  workingSetCount: number;
  setCounter: MuscleSetCounter;
  bestRM1: number | null;
  highestWeight: number | null;
};

export const createEffortMetricAccumulator = (): EffortMetricAccumulator => ({
  totalVolume: 0,
  volumeSetCount: 0,
  workingSetCount: 0,
  setCounter: createMuscleSetCounter(),
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
  if (contribution.volumeIncluded) acc.volumeSetCount += 1;

  if (contribution.working === false) return;
  countMuscleSet(acc.setCounter, contribution);
  acc.workingSetCount = acc.setCounter.counts.weightedSetCount;

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
  type WeekAccumulator = EffortMetricAccumulator & {
    weekStartDateKey: string;
    monthKey: string;
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
      ...createEffortMetricAccumulator(),
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
      volumeSetCount: week.volumeSetCount,
      hasWorkingSets: week.workingSetCount > 0,
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
      const counterByMuscle = new Map<string, MuscleSetCounter>();
      for (const contribution of day.contributions) {
        accumulateContributionMetrics(acc, contribution);
        if (contribution.working === false || contribution.roleWeight === 0) continue;
        const counter = counterByMuscle.get(contribution.muscleGroupId) ?? createMuscleSetCounter();
        counterByMuscle.set(contribution.muscleGroupId, counter);
        countMuscleSet(counter, contribution);
      }
      return {
        dateKey: day.dateKey,
        workingSetCountsByMuscle: Object.fromEntries(
          [...counterByMuscle].map(([id, counter]) => [id, counter.counts.weightedSetCount])),
        sessionIds: [...new Set(day.contributions.map((contribution) => contribution.sessionId))],
        sessionIdsByMetric: {
          workingSetCount: [...new Set(day.contributions.filter(row => row.working).map(row => row.sessionId))],
          totalVolume: [...new Set(day.contributions.filter(row => row.volumeIncluded).map(row => row.sessionId))],
        },
        totalVolume: acc.totalVolume,
        volumeSetCount: acc.volumeSetCount,
        workingSetCount: acc.workingSetCount,
        estimatedRM1: acc.bestRM1,
        highestWeight: acc.highestWeight,
      };
    })
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
