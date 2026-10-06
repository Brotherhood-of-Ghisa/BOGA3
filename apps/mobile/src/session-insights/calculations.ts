import { type LoadContext } from '@/src/exercise-calculations/load-metrics';
import {
  addFiniteVolume, enteredWeightKg, ordinaryLoadContext, summarizeExerciseLoad, workingSetsOnly,
} from '@/src/exercise-calculations/analytics';
import {
  compareSessionPosition,
  summarizeSessionBests,
} from '@/src/exercise-calculations/best-set';
import {
  compareRecordOrder,
  createRecordBook,
  beatsRecord,
  beatsWeightRecord,
  type RecordBaseline,
} from '@/src/exercise-calculations/records';
import {
  collectMuscleSetContributions,
  countMuscleAnalyticsWorkingSets,
  type MuscleAnalyticsInput,
  type MuscleContributionRole,
} from "@/src/data/muscle-analytics";
import {
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
  /** Physical working sets that map to the muscle as primary. */
  primarySetCount: number;
  /** Physical working sets that map to the muscle as secondary (and not primary). */
  secondarySetCount: number;
  /** `primarySetCount + secondarySetCount / 2`: the role factor applied to sets. */
  weightedSetCount: number;
};

export type CurrentSessionMuscleSummary = {
  state: "empty" | "unmapped" | "mapped";
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
  // The definition's records before this session; null without any.
  baseline: RecordBaseline | null;
};

/**
 * A set of the session that took a record (`training-metrics-contract.md`
 * §3): the session's best 1RM, its top Weight, or both when one set is both.
 */
export type ExerciseRecordSet = {
  sessionExerciseId: string;
  setId: string;
  setOrderIndex: number;
  weight: number;
  reps: number;
  // Null only for a Weight record whose load is unknown (no bodyweight reading).
  estimatedOneRepMax: number | null;
  oneRepMax: boolean;
  topWeight: boolean;
};

/**
 * Every record one exercise took in a session: one per kind, so up to three
 * (`sessionRecordKinds`). Strength records name their set; Volume is the
 * exercise's whole session.
 */
export type ExercisePersonalRecord = {
  exerciseDefinitionId: string;
  exerciseName: string;
  // The exercise's first block, where a card shows its Volume record.
  sessionExerciseId: string;
  sessionExerciseOrderIndex: number;
  // The 1RM record's set, then the Weight record's when it is another set.
  sets: ExerciseRecordSet[];
  // The exercise's complete session volume, when it beat the Volume record.
  volume: number | null;
  baseline: RecordBaseline;
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

export type SessionPersonalRecordsFromBestsInput = {
  targetSession: PersonalRecordSessionInput;
  recordBaselineByDefinitionId: ReadonlyMap<string, RecordBaseline>;
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

const isEligiblePerformedSet = (set: SessionInsightSetInput): boolean =>
  (set.deletedAt ?? null) === null &&
  isConfirmedPerformedSet({
    reps: set.repsValue,
    weight: set.weightValue,
    performanceStatus: set.performanceStatus,
  });

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
    .sort(compareSessionPosition);

  return {
    effortPolicy: exercises.find(exercise => exercise.loadContext?.effortPolicy)?.loadContext?.effortPolicy,
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
        .sort(compareSessionPosition)
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
  const workingSetCount = countMuscleAnalyticsWorkingSets(analyticsInput);
  const muscleGroupById = new Map(
    input.muscleGroups.map((group) => [group.id, group]),
  );
  // Counts use working identities; muscle load independently uses volume.
  const contributions = collectMuscleSetContributions(analyticsInput);
  const mappedSetIdentities = new Set(
    contributions
      .filter((contribution) => contribution.working !== false && muscleGroupById.has(contribution.muscleGroupId))
      .map((contribution) => contribution.setIdentity),
  );
  const weightedVolumeByMuscle = new Map<string, number | null>();
  const workingSetIdentitiesByMuscle = new Map<string, Set<string>>();
  // The strongest role each set holds for each muscle: a set counts once per muscle.
  const roleWeightBySetByMuscle = new Map<string, Map<string, number>>();

  for (const contribution of contributions) {
    if (!muscleGroupById.has(contribution.muscleGroupId)) continue;
    weightedVolumeByMuscle.set(
      contribution.muscleGroupId,
      addFiniteVolume(weightedVolumeByMuscle.get(contribution.muscleGroupId), contribution.weightedVolume),
    );
    if (contribution.working === false) continue;
    const workingSetIdentities =
      workingSetIdentitiesByMuscle.get(contribution.muscleGroupId) ??
      new Set<string>();
    workingSetIdentities.add(contribution.setIdentity);
    workingSetIdentitiesByMuscle.set(
      contribution.muscleGroupId,
      workingSetIdentities,
    );
    const roleWeightBySet =
      roleWeightBySetByMuscle.get(contribution.muscleGroupId) ??
      new Map<string, number>();
    roleWeightBySet.set(
      contribution.setIdentity,
      Math.max(roleWeightBySet.get(contribution.setIdentity) ?? 0, contribution.roleWeight),
    );
    roleWeightBySetByMuscle.set(contribution.muscleGroupId, roleWeightBySet);
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
    roleWeightBySetByMuscle,
    ([muscleGroupId, roleWeightBySet]) => {
      const roleWeights = Array.from(roleWeightBySet.values());
      const primarySetCount = roleWeights.filter((weight) => weight === 1).length;
      return {
        muscleGroup: muscleGroupById.get(muscleGroupId) as SessionInsightMuscleGroup,
        primarySetCount,
        secondarySetCount: roleWeights.length - primarySetCount,
        weightedSetCount: roleWeights.reduce((total, weight) => total + weight, 0),
      };
    },
  )
    .map(({ muscleGroup, ...counts }) => ({ ...muscleGroup, ...counts }))
    .sort((left, right) => {
      if (left.weightedSetCount !== right.weightedSetCount) {
        return right.weightedSetCount - left.weightedSetCount;
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
      workingSetCount === 0
        ? "empty"
        : mappedSetCount === 0
          ? "unmapped"
          : "mapped",
    workingSetCount,
    mappedSetCount,
    unmappedSetCount: Math.max(0, workingSetCount - mappedSetCount),
    contributingMuscleCount: muscles.length,
    volumeComplete: Array.from(weightedVolumeByMuscle.values()).every(volume => volume !== null),
    muscles,
    workingSetsByMuscle,
  };
};

/** The definition's blocks in the session, in session order. */
const definitionBlocks = (exerciseDefinitionId: string, exercises: SessionInsightExerciseInput[]) =>
  exercises
    .filter((exercise) =>
      (exercise.deletedAt ?? null) === null && exercise.exerciseDefinitionId === exerciseDefinitionId)
    .sort(compareSessionPosition)
    .map((exercise) => ({ ...exercise, loadContext: exercise.loadContext ?? ordinaryLoadContext() }));

/**
 * The records one definition took in the session, over every block of it:
 * its best 1RM, top Weight and complete Volume (`summarizeSessionBests`), each
 * where it beats the record before. Null without a baseline, or when nothing
 * beats it.
 */
export const deriveExercisePersonalRecord = (
  input: ExercisePersonalRecordInput,
): ExercisePersonalRecord | null => {
  const blocks = definitionBlocks(input.exerciseDefinitionId, input.exercises);
  const firstBlock = blocks[0];
  const bests = summarizeSessionBests(blocks);
  if (firstBlock === undefined || input.baseline === null || bests === null) return null;
  const oneRepMax = bests.oneRepMax !== null &&
    beatsRecord(bests.oneRepMax.estimatedOneRepMaxKg, input.baseline.oneRepMax) ? bests.oneRepMax : null;
  const topWeight = bests.topWeight !== null &&
    beatsWeightRecord(bests.topWeight, input.baseline.weight) ? bests.topWeight : null;
  const volume = bests.volumeComplete && beatsRecord(bests.volumeKg, input.baseline.volume) ? bests.volumeKg : null;
  const sets: ExerciseRecordSet[] = [];
  for (const best of [oneRepMax, topWeight]) {
    if (best === null || sets.some((entry) => entry.setId === best.set.id)) continue;
    const weight = enteredWeightKg(best.set);
    // A working set always has a valid Weight (§1).
    if (weight === null) throw new Error(`record set ${best.set.id} has no Weight`);
    sets.push({
      sessionExerciseId: best.block.id,
      setId: best.set.id,
      setOrderIndex: best.set.orderIndex,
      weight,
      reps: best.metric.reps,
      estimatedOneRepMax: best.metric.estimatedOneRepMaxKg,
      oneRepMax: best.set.id === oneRepMax?.set.id,
      topWeight: best.set.id === topWeight?.set.id,
    });
  }
  if (sets.length === 0 && volume === null) return null;
  return {
    exerciseDefinitionId: input.exerciseDefinitionId,
    exerciseName: firstBlock.exerciseName,
    sessionExerciseId: firstBlock.id,
    sessionExerciseOrderIndex: firstBlock.orderIndex,
    sets,
    volume,
    baseline: input.baseline,
  };
};

/** The PRs an exercise's records count: one per kind (`sessionRecordKinds`). */
export const personalRecordCount = (record: ExercisePersonalRecord): number =>
  record.sets.reduce((count, set) => count + Number(set.oneRepMax) + Number(set.topWeight), 0) +
  (record.volume === null ? 0 : 1);

/** Both sessions completed, and `session` first in record order (`compareRecordOrder`). */
const isBeforeInRecordOrder = (
  session: Pick<PersonalRecordSessionInput, "sessionId" | "completedAt">,
  target: Pick<PersonalRecordSessionInput, "sessionId" | "completedAt">,
): boolean =>
  session.completedAt !== null && target.completedAt !== null &&
  compareRecordOrder(
    { sessionId: session.sessionId, completedAt: session.completedAt },
    { sessionId: target.sessionId, completedAt: target.completedAt },
  ) < 0;

/** The replay reference's earlier records, folded by the record book from raw sets. */
const collectRecordBaselineByExerciseDefinition = (
  targetSession: PersonalRecordSessionInput,
  historicalSessions: PersonalRecordSessionInput[],
): Map<string, RecordBaseline> => {
  const books = new Map<string, ReturnType<typeof createRecordBook>>();
  const earlier = historicalSessions
    .filter((session) =>
      session.status === "completed" && session.completedAt !== null && (session.deletedAt ?? null) === null)
    .map((session) => {
      ensureValidDate(session.completedAt as Date, "historical completedAt");
      return { ...session, completedAt: session.completedAt as Date };
    })
    .filter((session) => isBeforeInRecordOrder(session, targetSession))
    .sort(compareRecordOrder);

  for (const session of earlier) {
    const exerciseDefinitionIds = new Set(
      session.exercises
        .filter((exercise) => (exercise.deletedAt ?? null) === null)
        .map((exercise) => exercise.exerciseDefinitionId)
        .filter((id): id is string => id !== null),
    );
    for (const exerciseDefinitionId of exerciseDefinitionIds) {
      const bests = summarizeSessionBests(definitionBlocks(exerciseDefinitionId, session.exercises));
      if (!bests) continue;
      const book = books.get(exerciseDefinitionId) ?? createRecordBook();
      books.set(exerciseDefinitionId, book);
      book.add({
        oneRepMax: bests.oneRepMax ? { value: bests.oneRepMax.estimatedOneRepMaxKg } : null,
        weight: bests.topWeight ? { weight: bests.topWeight.weight, reps: bests.topWeight.reps } : null,
        volume: bests.volumeComplete && bests.volumeKg !== null ? { value: bests.volumeKg } : null,
      });
    }
  }

  const baselineByDefinition = new Map<string, RecordBaseline>();
  for (const [exerciseDefinitionId, { holders }] of books) {
    baselineByDefinition.set(exerciseDefinitionId, {
      oneRepMax: holders.oneRepMax?.value ?? null,
      weight: holders.weight,
      volume: holders.volume?.value ?? null,
    });
  }
  return baselineByDefinition;
};

const isLiveCompletedTarget = (target: PersonalRecordSessionInput): boolean => {
  if (
    target.status !== "completed" ||
    target.completedAt === null ||
    (target.deletedAt ?? null) !== null
  ) {
    return false;
  }
  ensureValidDate(target.completedAt, "target completedAt");
  return true;
};

/**
 * Each definition's records in the target against its records from earlier
 * completed sessions, in first-exercise order. A
 * definition absent from the map has no earlier record and so no PR.
 */
export const deriveSessionPersonalRecordsFromBests = (
  input: SessionPersonalRecordsFromBestsInput,
): ExercisePersonalRecord[] => {
  const target = input.targetSession;
  if (!isLiveCompletedTarget(target)) return [];

  const orderedTargetExercises = target.exercises
    .filter((exercise) => (exercise.deletedAt ?? null) === null)
    .sort(compareSessionPosition);
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
      baseline: input.recordBaselineByDefinitionId.get(exerciseDefinitionId) ?? null,
    });
    if (record) records.push(record);
  }

  return records;
};

/**
 * The replay reference for the PR rule: earlier records recomputed from
 * every earlier session's sets. Runtime reads take the earlier bests from the
 * exercise session facts instead; Jest holds the two equal.
 */
export const deriveSessionPersonalRecords = (
  input: SessionPersonalRecordsInput,
): ExercisePersonalRecord[] => {
  if (!isLiveCompletedTarget(input.targetSession)) return [];
  return deriveSessionPersonalRecordsFromBests({
    targetSession: input.targetSession,
    recordBaselineByDefinitionId: collectRecordBaselineByExerciseDefinition(
      input.targetSession,
      input.historicalSessions,
    ),
  });
};

type ExerciseVolumeObservation = {
  exerciseDefinitionId: string | null;
  exerciseName: string;
  sessionExerciseIds: string[];
  sessionExerciseOrderIndex: number;
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
    .sort(compareSessionPosition)) {
    const eligibleSets = [...exercise.sets]
      .filter(isEligiblePerformedSet)
      .sort(compareSessionPosition);
    if (eligibleSets.length === 0) continue;
    const workingSets = workingSetsOnly(eligibleSets, exercise.loadContext?.effortPolicy);

    const identity = exercise.exerciseDefinitionId
      ? `definition:${exercise.exerciseDefinitionId}`
      : `legacy:${exercise.id}`;
    const current = observationsByIdentity.get(identity) ?? {
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      exerciseName: exercise.exerciseName,
      sessionExerciseIds: [],
      sessionExerciseOrderIndex: exercise.orderIndex,
      workingSetCount: 0,
      volume: 0,
      knownVolume: 0,
    };

    current.sessionExerciseIds.push(exercise.id);
    current.workingSetCount += workingSets.length;
    const coverage = summarizeExerciseLoad(eligibleSets, exercise.loadContext ?? ordinaryLoadContext()).volumeCoverage;
    current.knownVolume = addFiniteVolume(current.knownVolume, coverage.knownVolumeKgReps);
    current.volume = addFiniteVolume(current.volume, coverage.totalVolumeKgReps);
    observationsByIdentity.set(identity, current);
  }

  // Volume reads working sets; an exercise with only warm-ups is no observation.
  return Array.from(observationsByIdentity.values())
    .filter((observation) => observation.workingSetCount > 0)
    .sort((left, right) => {
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
    if (!isBeforeInRecordOrder(session, target)) continue;

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
  // A muscle is observed when it has a valid mapped working set, even when its
  // volume is zero; its volume uses the independent selection. The positive-only
  // muscle-load bars are a separate presentation and cannot supply a
  // distribution's observations or counts.
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
      workingSetIds: Set<string>;
    }>();
    for (const contribution of contributions) {
      if (!groupById.has(contribution.muscleGroupId)) continue;
      const observation = byMuscle.get(contribution.muscleGroupId) ?? {
        weightedVolume: 0,
        knownVolume: 0,
        workingSetIds: new Set<string>(),
      };
      byMuscle.set(contribution.muscleGroupId, observation);
      observation.knownVolume = addFiniteVolume(observation.knownVolume, contribution.weightedVolume ?? 0);
      observation.weightedVolume = addFiniteVolume(observation.weightedVolume, contribution.weightedVolume);
      if (contribution.working !== false) observation.workingSetIds.add(contribution.setIdentity);
    }
    return Array.from(byMuscle, ([id, observation]) => ({
      ...groupById.get(id)!,
      weightedVolume: observation.weightedVolume,
      knownVolume: observation.knownVolume,
      workingSetCount: observation.workingSetIds.size,
    })).filter((muscle) => muscle.workingSetCount > 0).sort((left, right) =>
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
      !isBeforeInRecordOrder(session, target)
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

export type CompletedSessionInsightsInput = SessionMuscleVolumeComparisonsInput &
  Pick<SessionPersonalRecordsFromBestsInput, "recordBaselineByDefinitionId">;

/** PRs read the supplied earlier bests; the comparisons read the earlier session graphs. */
export const deriveCompletedSessionInsights = (
  input: CompletedSessionInsightsInput,
): CompletedSessionInsights => ({
  personalRecords: deriveSessionPersonalRecordsFromBests(input),
  exerciseVolumeComparisons: deriveSessionExerciseVolumeComparisons(input),
  muscleVolumeComparisons: deriveSessionMuscleVolumeComparisons(input),
});
