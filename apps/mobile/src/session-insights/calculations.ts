import { type LoadContext } from '@/src/exercise-calculations/load-metrics';
import { addFiniteVolume, calculateAnalyticsSetMetrics, ordinaryLoadContext, summarizeExerciseLoad } from '@/src/exercise-calculations/analytics';
import { isWorkingSessionSetType } from "@/src/data/set-types";
import {
  collectMuscleSetContributions,
  countMuscleAnalyticsPerformedSets,
  countMuscleAnalyticsWorkingSets,
  type MuscleAnalyticsInput,
  type MuscleContributionRole,
} from "@/src/data/muscle-analytics";
import {
  parseSetReps,
  parseSetWeight,
} from "@/src/exercise-calculations";
import { canonicalizeWeightForReps,
  isConfirmedPerformedSet,
  type SessionSetPerformanceStatus,
} from "@/src/exercise-calculations/set-semantics";

export type SessionInsightSetInput = {
  id: string;
  orderIndex: number;
  weightValue: string;
  repsValue: string;
  setType: string | null;
  performanceStatus?: SessionSetPerformanceStatus;
  deletedAt?: Date | null;
};

export type SessionInsightExerciseInput = {
  id: string;
  orderIndex: number;
  exerciseDefinitionId: string | null;
  exerciseName: string;
  sets: SessionInsightSetInput[];
  loadContext?: LoadContext;
  deletedAt?: Date | null;
};

export type SessionInsightExerciseDefinition = {
  id: string;
  loadInputMode: "total_load" | "per_side_load";
  bodyweightContribution: number;
};

export type SessionInsightMuscleMapping = {
  exerciseDefinitionId: string;
  muscleGroupId: string;
  role: MuscleContributionRole;
  weight?: number;
};

export type SessionInsightMuscleGroup = {
  id: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
};

export type CurrentSessionMuscleSummaryInput = {
  sessionId: string;
  sessionAt: Date;
  bodyWeightKg?: number | null;
  exercises: SessionInsightExerciseInput[];
  exerciseDefinitions: SessionInsightExerciseDefinition[];
  muscleMappings: SessionInsightMuscleMapping[];
  muscleGroups: SessionInsightMuscleGroup[];
};

export type SessionMuscleLoadEntry = SessionInsightMuscleGroup & {
  workingSetCount: number;
  weightedVolume: number;
  relativeVolume: number;
};

export type SessionMuscleWorkingSetEntry = SessionInsightMuscleGroup & {
  workingSetCount: number;
};

export type CurrentSessionMuscleSummary = {
  state: "empty" | "unmapped" | "mapped";
  performedSetCount: number;
  workingSetCount: number;
  mappedSetCount: number;
  unmappedSetCount: number;
  contributingMuscleCount: number;
  volumeComplete?: boolean;
  muscles: SessionMuscleLoadEntry[];
  workingSetsByMuscle: SessionMuscleWorkingSetEntry[];
};

export type ExercisePersonalRecordInput = {
  exerciseDefinitionId: string;
  exercises: SessionInsightExerciseInput[];
  historicalBestEstimatedOneRepMax: number | null;
};

export type ExercisePersonalRecord = {
  exerciseDefinitionId: string;
  exerciseName: string;
  sessionExerciseId: string;
  sessionExerciseOrderIndex: number;
  setId: string;
  setOrderIndex: number;
  weight: number;
  reps: number;
  estimatedOneRepMax: number;
  historicalBestEstimatedOneRepMax: number;
};

export type PersonalRecordSessionInput = {
  sessionId: string;
  status: "active" | "completed";
  completedAt: Date | null;
  bodyWeightKg?: number | null;
  deletedAt?: Date | null;
  exercises: SessionInsightExerciseInput[];
};

export type SessionPersonalRecordsInput = {
  targetSession: PersonalRecordSessionInput;
  historicalSessions: PersonalRecordSessionInput[];
};

export type ExerciseVolumeComparisonState =
  | "incomplete"
  | "no-history"
  | "single-baseline"
  | "constant-baseline"
  | "distribution";

export type ExerciseVolumeComparison = {
  exerciseDefinitionId: string | null;
  exerciseName: string;
  sessionExerciseIds: string[];
  sessionExerciseOrderIndex: number;
  setCount: number;
  workingSetCount: number;
  currentVolume: number | null;
  knownVolume?: number | null;
  historicalSessionCount: number;
  excludedHistoricalSessionCount?: number;
  medianVolume: number | null;
  percentile5Volume: number | null;
  percentile95Volume: number | null;
  state: ExerciseVolumeComparisonState;
};

export type SessionExerciseVolumeComparisonsInput = SessionPersonalRecordsInput;

export type CompletedSessionInsights = {
  personalRecords: ExercisePersonalRecord[];
  exerciseVolumeComparisons: ExerciseVolumeComparison[];
  muscleVolumeComparisons: ExerciseVolumeComparison[];
};

export type SessionMuscleVolumeComparisonsInput =
  SessionPersonalRecordsInput & {
    exerciseDefinitions?: SessionInsightExerciseDefinition[];
    muscleMappings?: SessionInsightMuscleMapping[];
    muscleGroups?: SessionInsightMuscleGroup[];
  };

const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const ensureValidDate = (value: Date, label: string): void => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const compareExerciseOrder = (
  left: SessionInsightExerciseInput,
  right: SessionInsightExerciseInput,
): number => {
  if (left.orderIndex !== right.orderIndex)
    return left.orderIndex - right.orderIndex;
  return left.id.localeCompare(right.id);
};

const compareSetOrder = (
  left: SessionInsightSetInput,
  right: SessionInsightSetInput,
): number => {
  if (left.orderIndex !== right.orderIndex)
    return left.orderIndex - right.orderIndex;
  return left.id.localeCompare(right.id);
};

const isEligiblePerformedSet = (set: SessionInsightSetInput): boolean =>
  (set.deletedAt ?? null) === null &&
  isConfirmedPerformedSet({
    reps: set.repsValue,
    weight: set.weightValue,
    performanceStatus: set.performanceStatus,
  }) &&
  parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue)) !== null &&
  parseSetReps(set.repsValue) !== null;

export const calculateLinearPercentile = (
  sortedValues: number[],
  percentile: number,
): number => {
  if (sortedValues.length === 0) {
    throw new Error("Percentile requires at least one value");
  }
  if (percentile < 0 || percentile > 1 || !Number.isFinite(percentile)) {
    throw new Error("Percentile must be between 0 and 1");
  }

  const position = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];
  if (lowerValue === undefined || upperValue === undefined) {
    throw new Error("Percentile values must be sorted finite numbers");
  }
  if (lowerIndex === upperIndex) return lowerValue;

  return lowerValue + (upperValue - lowerValue) * (position - lowerIndex);
};

export const adaptCurrentSessionToMuscleAnalyticsInput = (
  input: CurrentSessionMuscleSummaryInput,
): MuscleAnalyticsInput => {
  ensureValidDate(input.sessionAt, "sessionAt");

  const exercises = [...input.exercises]
    .filter((exercise) => (exercise.deletedAt ?? null) === null)
    .sort(compareExerciseOrder);

  return {
    bodyweightCalculationsEnabled: exercises.some(exercise => exercise.loadContext?.policy === 'personal'),
    sessions: [{ id: input.sessionId, completedAt: input.sessionAt, bodyWeightKg: input.bodyWeightKg ?? exercises[0]?.loadContext?.bodyWeightKg }],
    exerciseDefinitions: input.exerciseDefinitions,
    sessionExercises: exercises.map((exercise) => ({
      id: exercise.id,
      sessionId: input.sessionId,
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      exerciseName: exercise.exerciseName,
    })),
    exerciseSets: exercises.flatMap((exercise) =>
      [...exercise.sets]
        .filter((set) => (set.deletedAt ?? null) === null)
        .sort(compareSetOrder)
        .map((set) => ({
          id: set.id,
          sessionExerciseId: exercise.id,
          orderIndex: set.orderIndex,
          setType: set.setType,
          weightValue: set.weightValue,
          repsValue: set.repsValue,
          performanceStatus: set.performanceStatus,
        })),
    ),
    muscleMappings: input.muscleMappings,
    muscleGroups: input.muscleGroups,
  };
};

export const summarizeCurrentSessionMuscleLoad = (
  input: CurrentSessionMuscleSummaryInput,
): CurrentSessionMuscleSummary => {
  const analyticsInput = adaptCurrentSessionToMuscleAnalyticsInput(input);
  const performedSetCount = countMuscleAnalyticsPerformedSets(analyticsInput);
  const workingSetCount = countMuscleAnalyticsWorkingSets(analyticsInput);
  const muscleGroupById = new Map(
    input.muscleGroups.map((group) => [group.id, group]),
  );
  const contributions = collectMuscleSetContributions(analyticsInput);
  const mappedSetIdentities = new Set(
    contributions
      .filter((contribution) => muscleGroupById.has(contribution.muscleGroupId))
      .map((contribution) => contribution.setIdentity),
  );
  const weightedVolumeByMuscle = new Map<string, number | null>();
  const workingSetIdentitiesByMuscle = new Map<string, Set<string>>();

  for (const contribution of contributions) {
    if (!muscleGroupById.has(contribution.muscleGroupId)) continue;
    weightedVolumeByMuscle.set(
      contribution.muscleGroupId,
      addFiniteVolume(weightedVolumeByMuscle.get(contribution.muscleGroupId), contribution.weightedVolume),
    );

    if (isWorkingSessionSetType(contribution.setType)) {
      const workingSetIdentities =
        workingSetIdentitiesByMuscle.get(contribution.muscleGroupId) ??
        new Set<string>();
      workingSetIdentities.add(contribution.setIdentity);
      workingSetIdentitiesByMuscle.set(
        contribution.muscleGroupId,
        workingSetIdentities,
      );
    }
  }

  const positiveMuscles = Array.from(
    weightedVolumeByMuscle,
    ([muscleGroupId, weightedVolume]) => ({
      muscleGroup: muscleGroupById.get(
        muscleGroupId,
      ) as SessionInsightMuscleGroup,
      weightedVolume,
    }),
  ).flatMap((entry) => entry.weightedVolume !== null && entry.weightedVolume > 0
    ? [{ ...entry, weightedVolume: entry.weightedVolume }] : []);
  const largestWeightedVolume = positiveMuscles.reduce(
    (largest, entry) => Math.max(largest, entry.weightedVolume),
    0,
  );
  const muscles = positiveMuscles
    .map(({ muscleGroup, weightedVolume }) => ({
      ...muscleGroup,
      workingSetCount:
        workingSetIdentitiesByMuscle.get(muscleGroup.id)?.size ?? 0,
      weightedVolume,
      relativeVolume: weightedVolume / largestWeightedVolume,
    }))
    .sort((left, right) => {
      if (left.weightedVolume !== right.weightedVolume) {
        return right.weightedVolume - left.weightedVolume;
      }
      if (left.sortOrder !== right.sortOrder)
        return left.sortOrder - right.sortOrder;
      const nameDifference = left.displayName.localeCompare(right.displayName);
      return nameDifference !== 0
        ? nameDifference
        : left.id.localeCompare(right.id);
    });
  const workingSetsByMuscle = Array.from(
    workingSetIdentitiesByMuscle,
    ([muscleGroupId, setIdentities]) => ({
      muscleGroup: muscleGroupById.get(muscleGroupId),
      workingSetCount: setIdentities.size,
    }),
  )
    .filter(
      (
        entry,
      ): entry is {
        muscleGroup: SessionInsightMuscleGroup;
        workingSetCount: number;
      } => entry.muscleGroup !== undefined && entry.workingSetCount > 0,
    )
    .map(({ muscleGroup, workingSetCount }) => ({
      ...muscleGroup,
      workingSetCount,
    }))
    .sort((left, right) => {
      if (left.workingSetCount !== right.workingSetCount) {
        return right.workingSetCount - left.workingSetCount;
      }
      if (left.sortOrder !== right.sortOrder)
        return left.sortOrder - right.sortOrder;
      const nameDifference = left.displayName.localeCompare(right.displayName);
      return nameDifference !== 0
        ? nameDifference
        : left.id.localeCompare(right.id);
    });
  const mappedSetCount = mappedSetIdentities.size;

  return {
    state:
      performedSetCount === 0
        ? "empty"
        : mappedSetCount === 0
          ? "unmapped"
          : "mapped",
    performedSetCount,
    workingSetCount,
    mappedSetCount,
    unmappedSetCount: Math.max(0, performedSetCount - mappedSetCount),
    contributingMuscleCount: muscles.length,
    volumeComplete: Array.from(weightedVolumeByMuscle.values()).every(volume => volume !== null),
    muscles,
    workingSetsByMuscle,
  };
};

type PersonalRecordCandidate = Omit<
  ExercisePersonalRecord,
  "historicalBestEstimatedOneRepMax"
>;

const findBestPersonalRecordCandidate = (
  exerciseDefinitionId: string,
  exercises: SessionInsightExerciseInput[],
): PersonalRecordCandidate | null => {
  const orderedExercises = exercises
    .filter(
      (exercise) =>
        (exercise.deletedAt ?? null) === null &&
        exercise.exerciseDefinitionId === exerciseDefinitionId,
    )
    .sort(compareExerciseOrder);
  const groupOrderIndex = orderedExercises[0]?.orderIndex;
  if (groupOrderIndex === undefined) return null;

  const candidates = orderedExercises
    .flatMap((exercise) => exercise.sets.map((set) => ({ exercise, set })))
    .filter(({ set }) => isEligiblePerformedSet(set))
    // Session order (block, then set): the first tied set keeps the record.
    .sort((left, right) =>
      compareExerciseOrder(left.exercise, right.exercise) ||
      compareSetOrder(left.set, right.set));

  let best: PersonalRecordCandidate | null = null;
  for (const { exercise, set } of candidates) {
    const weight = parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue));
    const reps = parseSetReps(set.repsValue);
    if (weight === null || reps === null) continue;

    const metric = calculateAnalyticsSetMetrics({ ...set, ...(exercise.loadContext ?? ordinaryLoadContext()) });
    const estimatedOneRepMax = metric.estimatedOneRepMaxKg;
    if (estimatedOneRepMax === null) continue;
    if (best !== null && estimatedOneRepMax <= best.estimatedOneRepMax)
      continue;

    best = {
      exerciseDefinitionId,
      exerciseName: exercise.exerciseName,
      sessionExerciseId: exercise.id,
      sessionExerciseOrderIndex: groupOrderIndex,
      setId: set.id,
      setOrderIndex: set.orderIndex,
      weight: metric.eligible && metric.load.status === 'known' ? metric.load.enteredWeightKg : weight,
      reps,
      estimatedOneRepMax,
    };
  }

  return best;
};

export const deriveExercisePersonalRecord = (
  input: ExercisePersonalRecordInput,
): ExercisePersonalRecord | null => {
  const historicalBest = input.historicalBestEstimatedOneRepMax;
  if (historicalBest === null || !Number.isFinite(historicalBest)) return null;

  const best = findBestPersonalRecordCandidate(
    input.exerciseDefinitionId,
    input.exercises,
  );
  if (!best || best.estimatedOneRepMax <= historicalBest) return null;

  return {
    ...best,
    historicalBestEstimatedOneRepMax: historicalBest,
  };
};

const compareSessionOrder = (
  left: Pick<PersonalRecordSessionInput, "sessionId" | "completedAt">,
  right: Pick<PersonalRecordSessionInput, "sessionId" | "completedAt">,
): number => {
  if (left.completedAt === null || right.completedAt === null) return 0;
  const completedAtDifference =
    left.completedAt.getTime() - right.completedAt.getTime();
  return completedAtDifference !== 0
    ? completedAtDifference
    : left.sessionId.localeCompare(right.sessionId);
};

const collectHistoricalBestByExerciseDefinition = (
  targetSession: PersonalRecordSessionInput,
  historicalSessions: PersonalRecordSessionInput[],
): Map<string, number> => {
  const bestByDefinition = new Map<string, number>();

  for (const session of historicalSessions) {
    if (
      session.status !== "completed" ||
      session.completedAt === null ||
      (session.deletedAt ?? null) !== null
    ) {
      continue;
    }
    ensureValidDate(session.completedAt, "historical completedAt");
    if (compareSessionOrder(session, targetSession) >= 0) continue;

    const exerciseDefinitionIds = new Set(
      session.exercises
        .filter((exercise) => (exercise.deletedAt ?? null) === null)
        .map((exercise) => exercise.exerciseDefinitionId)
        .filter((id): id is string => id !== null),
    );
    for (const exerciseDefinitionId of exerciseDefinitionIds) {
      const candidate = findBestPersonalRecordCandidate(
        exerciseDefinitionId,
        session.exercises,
      );
      if (!candidate) continue;
      const currentBest = bestByDefinition.get(exerciseDefinitionId);
      if (
        currentBest === undefined ||
        candidate.estimatedOneRepMax > currentBest
      ) {
        bestByDefinition.set(
          exerciseDefinitionId,
          candidate.estimatedOneRepMax,
        );
      }
    }
  }

  return bestByDefinition;
};

export const deriveSessionPersonalRecords = (
  input: SessionPersonalRecordsInput,
): ExercisePersonalRecord[] => {
  const target = input.targetSession;
  if (
    target.status !== "completed" ||
    target.completedAt === null ||
    (target.deletedAt ?? null) !== null
  ) {
    return [];
  }
  ensureValidDate(target.completedAt, "target completedAt");

  const historicalBestByDefinition = collectHistoricalBestByExerciseDefinition(
    target,
    input.historicalSessions,
  );
  const orderedTargetExercises = target.exercises
    .filter((exercise) => (exercise.deletedAt ?? null) === null)
    .sort(compareExerciseOrder);
  const exerciseDefinitionIds = Array.from(
    new Set(
      orderedTargetExercises
        .map((exercise) => exercise.exerciseDefinitionId)
        .filter((id): id is string => id !== null),
    ),
  );

  const records: ExercisePersonalRecord[] = [];
  for (const exerciseDefinitionId of exerciseDefinitionIds) {
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId,
      exercises: orderedTargetExercises,
      historicalBestEstimatedOneRepMax:
        historicalBestByDefinition.get(exerciseDefinitionId) ?? null,
    });
    if (record) records.push(record);
  }

  return records;
};

type ExerciseVolumeObservation = {
  exerciseDefinitionId: string | null;
  exerciseName: string;
  sessionExerciseIds: string[];
  sessionExerciseOrderIndex: number;
  setCount: number;
  workingSetCount: number;
  volume: number | null;
  knownVolume: number | null;
};

const collectExerciseVolumeObservations = (
  exercises: SessionInsightExerciseInput[],
): ExerciseVolumeObservation[] => {
  const observationsByIdentity = new Map<string, ExerciseVolumeObservation>();

  for (const exercise of [...exercises]
    .filter((candidate) => (candidate.deletedAt ?? null) === null)
    .sort(compareExerciseOrder)) {
    const eligibleSets = [...exercise.sets]
      .filter(isEligiblePerformedSet)
      .sort(compareSetOrder);
    if (eligibleSets.length === 0) continue;

    const identity = exercise.exerciseDefinitionId
      ? `definition:${exercise.exerciseDefinitionId}`
      : `legacy:${exercise.id}`;
    const current = observationsByIdentity.get(identity) ?? {
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      exerciseName: exercise.exerciseName,
      sessionExerciseIds: [],
      sessionExerciseOrderIndex: exercise.orderIndex,
      setCount: 0,
      workingSetCount: 0,
      volume: 0,
      knownVolume: 0,
    };

    current.sessionExerciseIds.push(exercise.id);
    current.setCount += eligibleSets.length;
    current.workingSetCount += eligibleSets.filter((set) =>
      isWorkingSessionSetType(set.setType),
    ).length;
    const coverage = summarizeExerciseLoad(eligibleSets, exercise.loadContext ?? ordinaryLoadContext()).volumeCoverage;
    current.knownVolume = addFiniteVolume(current.knownVolume, coverage.knownVolumeKgReps);
    current.volume = addFiniteVolume(current.volume, coverage.totalVolumeKgReps);
    observationsByIdentity.set(identity, current);
  }

  return Array.from(observationsByIdentity.values()).sort((left, right) => {
    if (left.sessionExerciseOrderIndex !== right.sessionExerciseOrderIndex) {
      return left.sessionExerciseOrderIndex - right.sessionExerciseOrderIndex;
    }
    return (
      left.sessionExerciseIds[0]?.localeCompare(
        right.sessionExerciseIds[0] ?? "",
      ) ?? 0
    );
  });
};

export const deriveSessionExerciseVolumeComparisons = (
  input: SessionExerciseVolumeComparisonsInput,
): ExerciseVolumeComparison[] => {
  const target = input.targetSession;
  if (
    target.status !== "completed" ||
    target.completedAt === null ||
    (target.deletedAt ?? null) !== null
  ) {
    return [];
  }
  ensureValidDate(target.completedAt, "target completedAt");

  const historicalVolumesByDefinition = new Map<string, number[]>();
  const excludedByDefinition = new Map<string, number>();
  for (const session of input.historicalSessions) {
    if (
      session.status !== "completed" ||
      session.completedAt === null ||
      (session.deletedAt ?? null) !== null
    ) {
      continue;
    }
    ensureValidDate(session.completedAt, "historical completedAt");
    if (compareSessionOrder(session, target) >= 0) continue;

    for (const observation of collectExerciseVolumeObservations(
      session.exercises,
    )) {
      if (!observation.exerciseDefinitionId) continue;
      if (observation.volume === null) {
        excludedByDefinition.set(observation.exerciseDefinitionId, (excludedByDefinition.get(observation.exerciseDefinitionId) ?? 0) + 1);
        continue;
      }
      const bucket =
        historicalVolumesByDefinition.get(observation.exerciseDefinitionId) ??
        [];
      bucket.push(observation.volume);
      historicalVolumesByDefinition.set(
        observation.exerciseDefinitionId,
        bucket,
      );
    }
  }

  return collectExerciseVolumeObservations(target.exercises).map(
    (observation) => {
      const { volume, ...exerciseSummary } = observation;
      const excluded = observation.exerciseDefinitionId ? excludedByDefinition.get(observation.exerciseDefinitionId) ?? 0 : 0;
      const excludedCoverage = excluded > 0 ? { excludedHistoricalSessionCount: excluded } : {};
      const historicalVolumes = observation.exerciseDefinitionId
        ? [
            ...(historicalVolumesByDefinition.get(
              observation.exerciseDefinitionId,
            ) ?? []),
          ].sort((left, right) => left - right)
        : [];
      if (volume === null || historicalVolumes.length === 0) {
        return {
          ...exerciseSummary,
          ...excludedCoverage,
          currentVolume: volume,
          historicalSessionCount: 0,
          medianVolume: null,
          percentile5Volume: null,
          percentile95Volume: null,
          state: volume === null ? "incomplete" as const : "no-history" as const,
        };
      }

      const medianVolume = calculateLinearPercentile(historicalVolumes, 0.5);
      const percentile5Volume = calculateLinearPercentile(
        historicalVolumes,
        0.05,
      );
      const percentile95Volume = calculateLinearPercentile(
        historicalVolumes,
        0.95,
      );
      const state: ExerciseVolumeComparisonState =
        historicalVolumes.length === 1
          ? "single-baseline"
          : percentile5Volume === percentile95Volume
            ? "constant-baseline"
            : "distribution";

      return {
        ...exerciseSummary,
        ...excludedCoverage,
        currentVolume: volume,
        historicalSessionCount: historicalVolumes.length,
        medianVolume,
        percentile5Volume,
        percentile95Volume,
        state,
      };
    },
  );
};

export const deriveSessionMuscleVolumeComparisons = (
  input: SessionMuscleVolumeComparisonsInput,
): ExerciseVolumeComparison[] => {
  if (
    !input.exerciseDefinitions ||
    !input.muscleMappings ||
    !input.muscleGroups
  )
    return [];
  const exerciseDefinitions = input.exerciseDefinitions;
  const muscleMappings = input.muscleMappings;
  const muscleGroups = input.muscleGroups;
  const target = input.targetSession;
  if (target.completedAt === null || (target.deletedAt ?? null) !== null)
    return [];

  const groupById = new Map(muscleGroups.map((group) => [group.id, group]));
  // Comparison observations include every valid mapped performed set, even
  // when its volume is zero. The positive-only muscle-load bars are a separate
  // presentation and cannot supply a distribution's observations or counts.
  const observe = (session: PersonalRecordSessionInput) => {
    const contributions = collectMuscleSetContributions(
      adaptCurrentSessionToMuscleAnalyticsInput({
        sessionId: session.sessionId,
        sessionAt: session.completedAt ?? (target.completedAt as Date),
        bodyWeightKg: session.bodyWeightKg,
        exercises: session.exercises,
        exerciseDefinitions,
        muscleMappings,
        muscleGroups,
      }),
    );
    const byMuscle = new Map<string, {
      weightedVolume: number | null;
      knownVolume: number | null;
      setIds: Set<string>;
      workingSetIds: Set<string>;
    }>();
    for (const contribution of contributions) {
      if (!groupById.has(contribution.muscleGroupId)) continue;
      const observation = byMuscle.get(contribution.muscleGroupId) ?? {
        weightedVolume: 0,
        knownVolume: 0,
        setIds: new Set<string>(),
        workingSetIds: new Set<string>(),
      };
      observation.knownVolume = addFiniteVolume(observation.knownVolume, contribution.weightedVolume ?? 0);
      observation.weightedVolume = addFiniteVolume(observation.weightedVolume, contribution.weightedVolume);
      observation.setIds.add(contribution.setIdentity);
      if (isWorkingSessionSetType(contribution.setType)) {
        observation.workingSetIds.add(contribution.setIdentity);
      }
      byMuscle.set(contribution.muscleGroupId, observation);
    }
    return Array.from(byMuscle, ([id, observation]) => ({
      ...groupById.get(id)!,
      weightedVolume: observation.weightedVolume,
      knownVolume: observation.knownVolume,
      setCount: observation.setIds.size,
      workingSetCount: observation.workingSetIds.size,
    })).sort((left, right) =>
      (right.knownVolume ?? -1) - (left.knownVolume ?? -1) ||
      left.sortOrder - right.sortOrder ||
      left.displayName.localeCompare(right.displayName) ||
      left.id.localeCompare(right.id),
    );
  };
  const historyByMuscle = new Map<string, number[]>();
  const excludedByMuscle = new Map<string, number>();
  for (const session of input.historicalSessions) {
    if (
      session.status !== "completed" ||
      session.completedAt === null ||
      (session.deletedAt ?? null) !== null ||
      compareSessionOrder(session, target) >= 0
    )
      continue;
    for (const muscle of observe(session)) {
      if (muscle.weightedVolume === null) {
        excludedByMuscle.set(muscle.id, (excludedByMuscle.get(muscle.id) ?? 0) + 1);
        continue;
      }
      const values = historyByMuscle.get(muscle.id) ?? [];
      values.push(muscle.weightedVolume);
      historyByMuscle.set(muscle.id, values);
    }
  }

  return observe(target).map((muscle, index) => {
    const history = (muscle.weightedVolume === null ? [] : [...(historyByMuscle.get(muscle.id) ?? [])]).sort(
      (a, b) => a - b,
    );
    const median = history.length
      ? calculateLinearPercentile(history, 0.5)
      : null;
    const low = history.length
      ? calculateLinearPercentile(history, 0.05)
      : null;
    const high = history.length
      ? calculateLinearPercentile(history, 0.95)
      : null;
    return {
      exerciseDefinitionId: muscle.id,
      exerciseName: muscle.displayName,
      sessionExerciseIds: [muscle.id],
      sessionExerciseOrderIndex: index,
      setCount: muscle.setCount,
      workingSetCount: muscle.workingSetCount,
      currentVolume: muscle.weightedVolume,
      knownVolume: muscle.knownVolume,
      ...((excludedByMuscle.get(muscle.id) ?? 0) > 0 ? { excludedHistoricalSessionCount: excludedByMuscle.get(muscle.id) } : {}),
      historicalSessionCount: history.length,
      medianVolume: median,
      percentile5Volume: low,
      percentile95Volume: high,
      state:
        muscle.weightedVolume === null ? "incomplete" : history.length === 0
          ? "no-history"
          : history.length === 1
            ? "single-baseline"
            : low === high
              ? "constant-baseline"
              : "distribution",
    };
  });
};

export const deriveCompletedSessionInsights = (
  input: SessionMuscleVolumeComparisonsInput,
): CompletedSessionInsights => ({
  personalRecords: deriveSessionPersonalRecords(input),
  exerciseVolumeComparisons: deriveSessionExerciseVolumeComparisons(input),
  muscleVolumeComparisons: deriveSessionMuscleVolumeComparisons(input),
});
