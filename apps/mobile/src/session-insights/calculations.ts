import {
  collectMuscleSetContributions,
  countMuscleAnalyticsPerformedSets,
  countMuscleAnalyticsWorkingSets,
  type MuscleAnalyticsInput,
  type MuscleContributionRole,
} from '@/src/data/muscle-analytics';
import { estimateOneRepMax, parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import {
  isConfirmedPerformedSet,
  type SessionSetPerformanceStatus,
} from '@/src/session-recorder/set-semantics';

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
  deletedAt?: Date | null;
};

export type SessionInsightExerciseDefinition = {
  id: string;
  loadInputMode: 'total_load' | 'per_side_load';
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
  exercises: SessionInsightExerciseInput[];
  exerciseDefinitions: SessionInsightExerciseDefinition[];
  muscleMappings: SessionInsightMuscleMapping[];
  muscleGroups: SessionInsightMuscleGroup[];
};

export type SessionMuscleLoadEntry = SessionInsightMuscleGroup & {
  weightedVolume: number;
  relativeVolume: number;
};

export type CurrentSessionMuscleSummary = {
  state: 'empty' | 'unmapped' | 'mapped';
  performedSetCount: number;
  workingSetCount: number;
  mappedSetCount: number;
  unmappedSetCount: number;
  contributingMuscleCount: number;
  muscles: SessionMuscleLoadEntry[];
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
  status: 'active' | 'completed';
  completedAt: Date | null;
  deletedAt?: Date | null;
  exercises: SessionInsightExerciseInput[];
};

export type SessionPersonalRecordsInput = {
  targetSession: PersonalRecordSessionInput;
  historicalSessions: PersonalRecordSessionInput[];
};

const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const ensureValidDate = (value: Date, label: string): void => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
};

const compareExerciseOrder = (
  left: SessionInsightExerciseInput,
  right: SessionInsightExerciseInput
): number => {
  if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
  return left.id.localeCompare(right.id);
};

const compareSetOrder = (left: SessionInsightSetInput, right: SessionInsightSetInput): number => {
  if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
  return left.id.localeCompare(right.id);
};

const isEligiblePerformedSet = (set: SessionInsightSetInput): boolean =>
  (set.deletedAt ?? null) === null &&
  isConfirmedPerformedSet({
    reps: set.repsValue,
    weight: set.weightValue,
    performanceStatus: set.performanceStatus,
  }) &&
  parseSetWeight(set.weightValue) !== null &&
  parseSetReps(set.repsValue) !== null;

export const adaptCurrentSessionToMuscleAnalyticsInput = (
  input: CurrentSessionMuscleSummaryInput
): MuscleAnalyticsInput => {
  ensureValidDate(input.sessionAt, 'sessionAt');

  const exercises = [...input.exercises]
    .filter((exercise) => (exercise.deletedAt ?? null) === null)
    .sort(compareExerciseOrder);

  return {
    sessions: [{ id: input.sessionId, completedAt: input.sessionAt }],
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
        }))
    ),
    muscleMappings: input.muscleMappings,
    muscleGroups: input.muscleGroups,
  };
};

export const summarizeCurrentSessionMuscleLoad = (
  input: CurrentSessionMuscleSummaryInput
): CurrentSessionMuscleSummary => {
  const analyticsInput = adaptCurrentSessionToMuscleAnalyticsInput(input);
  const performedSetCount = countMuscleAnalyticsPerformedSets(analyticsInput);
  const workingSetCount = countMuscleAnalyticsWorkingSets(analyticsInput);
  const muscleGroupById = new Map(input.muscleGroups.map((group) => [group.id, group]));
  const contributions = collectMuscleSetContributions(analyticsInput);
  const mappedSetIdentities = new Set(
    contributions
      .filter((contribution) => muscleGroupById.has(contribution.muscleGroupId))
      .map((contribution) => contribution.setIdentity)
  );
  const weightedVolumeByMuscle = new Map<string, number>();

  for (const contribution of contributions) {
    if (!muscleGroupById.has(contribution.muscleGroupId)) continue;
    weightedVolumeByMuscle.set(
      contribution.muscleGroupId,
      (weightedVolumeByMuscle.get(contribution.muscleGroupId) ?? 0) +
        contribution.weightedVolume
    );
  }

  const positiveMuscles = Array.from(weightedVolumeByMuscle, ([muscleGroupId, weightedVolume]) => ({
    muscleGroup: muscleGroupById.get(muscleGroupId) as SessionInsightMuscleGroup,
    weightedVolume,
  })).filter((entry) => entry.weightedVolume > 0);
  const largestWeightedVolume = positiveMuscles.reduce(
    (largest, entry) => Math.max(largest, entry.weightedVolume),
    0
  );
  const muscles = positiveMuscles
    .map(({ muscleGroup, weightedVolume }) => ({
      ...muscleGroup,
      weightedVolume,
      relativeVolume: weightedVolume / largestWeightedVolume,
    }))
    .sort((left, right) => {
      if (left.weightedVolume !== right.weightedVolume) {
        return right.weightedVolume - left.weightedVolume;
      }
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      const nameDifference = left.displayName.localeCompare(right.displayName);
      return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id);
    });
  const mappedSetCount = mappedSetIdentities.size;

  return {
    state: performedSetCount === 0 ? 'empty' : muscles.length === 0 ? 'unmapped' : 'mapped',
    performedSetCount,
    workingSetCount,
    mappedSetCount,
    unmappedSetCount: Math.max(0, performedSetCount - mappedSetCount),
    contributingMuscleCount: muscles.length,
    muscles,
  };
};

type PersonalRecordCandidate = Omit<
  ExercisePersonalRecord,
  'historicalBestEstimatedOneRepMax'
>;

const findBestPersonalRecordCandidate = (
  exerciseDefinitionId: string,
  exercises: SessionInsightExerciseInput[]
): PersonalRecordCandidate | null => {
  const orderedExercises = exercises
    .filter(
      (exercise) =>
        (exercise.deletedAt ?? null) === null &&
        exercise.exerciseDefinitionId === exerciseDefinitionId
    )
    .sort(compareExerciseOrder);
  const groupOrderIndex = orderedExercises[0]?.orderIndex;
  if (groupOrderIndex === undefined) return null;

  const candidates = orderedExercises
    .flatMap((exercise) =>
      exercise.sets.map((set) => ({ exercise, set }))
    )
    .filter(({ set }) => isEligiblePerformedSet(set))
    .sort((left, right) => {
      const setDifference = compareSetOrder(left.set, right.set);
      if (setDifference !== 0) return setDifference;
      return compareExerciseOrder(left.exercise, right.exercise);
    });

  let best: PersonalRecordCandidate | null = null;
  for (const { exercise, set } of candidates) {
    const weight = parseSetWeight(set.weightValue);
    const reps = parseSetReps(set.repsValue);
    if (weight === null || reps === null) continue;

    const estimatedOneRepMax = estimateOneRepMax(weight, reps);
    if (estimatedOneRepMax === null) continue;
    if (best !== null && estimatedOneRepMax <= best.estimatedOneRepMax) continue;

    best = {
      exerciseDefinitionId,
      exerciseName: exercise.exerciseName,
      sessionExerciseId: exercise.id,
      sessionExerciseOrderIndex: groupOrderIndex,
      setId: set.id,
      setOrderIndex: set.orderIndex,
      weight,
      reps,
      estimatedOneRepMax,
    };
  }

  return best;
};

export const deriveExercisePersonalRecord = (
  input: ExercisePersonalRecordInput
): ExercisePersonalRecord | null => {
  const historicalBest = input.historicalBestEstimatedOneRepMax;
  if (historicalBest === null || !Number.isFinite(historicalBest)) return null;

  const best = findBestPersonalRecordCandidate(input.exerciseDefinitionId, input.exercises);
  if (!best || best.estimatedOneRepMax <= historicalBest) return null;

  return {
    ...best,
    historicalBestEstimatedOneRepMax: historicalBest,
  };
};

const compareSessionOrder = (
  left: Pick<PersonalRecordSessionInput, 'sessionId' | 'completedAt'>,
  right: Pick<PersonalRecordSessionInput, 'sessionId' | 'completedAt'>
): number => {
  if (left.completedAt === null || right.completedAt === null) return 0;
  const completedAtDifference = left.completedAt.getTime() - right.completedAt.getTime();
  return completedAtDifference !== 0
    ? completedAtDifference
    : left.sessionId.localeCompare(right.sessionId);
};

const collectHistoricalBestByExerciseDefinition = (
  targetSession: PersonalRecordSessionInput,
  historicalSessions: PersonalRecordSessionInput[]
): Map<string, number> => {
  const bestByDefinition = new Map<string, number>();

  for (const session of historicalSessions) {
    if (
      session.status !== 'completed' ||
      session.completedAt === null ||
      (session.deletedAt ?? null) !== null
    ) {
      continue;
    }
    ensureValidDate(session.completedAt, 'historical completedAt');
    if (compareSessionOrder(session, targetSession) >= 0) continue;

    const exerciseDefinitionIds = new Set(
      session.exercises
        .filter((exercise) => (exercise.deletedAt ?? null) === null)
        .map((exercise) => exercise.exerciseDefinitionId)
        .filter((id): id is string => id !== null)
    );
    for (const exerciseDefinitionId of exerciseDefinitionIds) {
      const candidate = findBestPersonalRecordCandidate(
        exerciseDefinitionId,
        session.exercises
      );
      if (!candidate) continue;
      const currentBest = bestByDefinition.get(exerciseDefinitionId);
      if (currentBest === undefined || candidate.estimatedOneRepMax > currentBest) {
        bestByDefinition.set(exerciseDefinitionId, candidate.estimatedOneRepMax);
      }
    }
  }

  return bestByDefinition;
};

export const deriveSessionPersonalRecords = (
  input: SessionPersonalRecordsInput
): ExercisePersonalRecord[] => {
  const target = input.targetSession;
  if (
    target.status !== 'completed' ||
    target.completedAt === null ||
    (target.deletedAt ?? null) !== null
  ) {
    return [];
  }
  ensureValidDate(target.completedAt, 'target completedAt');

  const historicalBestByDefinition = collectHistoricalBestByExerciseDefinition(
    target,
    input.historicalSessions
  );
  const orderedTargetExercises = target.exercises
    .filter((exercise) => (exercise.deletedAt ?? null) === null)
    .sort(compareExerciseOrder);
  const exerciseDefinitionIds = Array.from(
    new Set(
      orderedTargetExercises
        .map((exercise) => exercise.exerciseDefinitionId)
        .filter((id): id is string => id !== null)
    )
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
