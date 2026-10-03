import { type LoadContext } from '@/src/exercise-calculations/load-metrics';
import {
  addFiniteVolume, enteredWeightKg, ordinaryLoadContext, summarizeExerciseLoad, workingSetsOnly,
} from '@/src/exercise-calculations/analytics';
import {
  compareSessionPosition,
  eligibleSetsByBlockInSessionOrder,
  summarizeSessionBests,
} from '@/src/exercise-calculations/best-set';
import {
  compareRecordOrder,
  createRecordBook,
  pickSessionRecordSet,
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
  workingSetCount: number;
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

/** Which record the record set is shown for: its 1RM, else its Weight. */
export type PersonalRecordKind = "oneRepMax" | "weight";

/**
 * One exercise's record set in a session (`training-metrics-contract.md` §3):
 * the one set a screen highlights.
 */
export type ExercisePersonalRecord = {
  kind: PersonalRecordKind;
  // The set also beats the Weight record; always true for a Weight record.
  weightRecord: boolean;
  exerciseDefinitionId: string;
  exerciseName: string;
  sessionExerciseId: string;
  sessionExerciseOrderIndex: number;
  setId: string;
  setOrderIndex: number;
  weight: number;
  reps: number;
  // Null only for a Weight record whose load is unknown (no bodyweight reading).
  estimatedOneRepMax: number | null;
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
  // Contributions are working sets only (§1): every figure, the set counts included.
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
    const workingSetIdentities =
      workingSetIdentitiesByMuscle.get(contribution.muscleGroupId) ??
      new Set<string>();
    workingSetIdentities.add(contribution.setIdentity);
    workingSetIdentitiesByMuscle.set(
      contribution.muscleGroupId,
      workingSetIdentities,
    );
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
 * The session's record set for one definition (`pickSessionRecordSet`), over
 * its working sets across every block: the highest 1RM that beats the 1RM
 * record, else the heaviest Weight that beats the Weight record. Null without
 * a baseline, or when nothing beats it.
 */
export const deriveExercisePersonalRecord = (
  input: ExercisePersonalRecordInput,
): ExercisePersonalRecord | null => {
  const blocks = definitionBlocks(input.exerciseDefinitionId, input.exercises);
  const groupOrderIndex = blocks[0]?.orderIndex;
  if (groupOrderIndex === undefined || input.baseline === null) return null;
  const sets = eligibleSetsByBlockInSessionOrder(blocks).flat().map((eligible) => ({
    ...eligible,
    candidate: {
      id: eligible.set.id,
      oneRepMax: eligible.metric.estimatedOneRepMaxKg,
      weight: enteredWeightKg(eligible.set),
      reps: eligible.metric.reps,
    },
  }));
  const winner = pickSessionRecordSet(sets.map(({ candidate }) => candidate), input.baseline);
  const best = winner && sets.find(({ set }) => set.id === winner.id);
  if (!winner || !best) return null;
  // A working set always has a valid Weight (§1).
  if (best.candidate.weight === null) throw new Error(`record set ${best.set.id} has no Weight`);
  return {
    kind: winner.oneRepMax ? "oneRepMax" : "weight",
    weightRecord: winner.weight,
    exerciseDefinitionId: input.exerciseDefinitionId,
    exerciseName: best.block.exerciseName,
    sessionExerciseId: best.block.id,
    sessionExerciseOrderIndex: groupOrderIndex,
    setId: best.set.id,
    setOrderIndex: best.set.orderIndex,
    weight: best.candidate.weight,
    reps: best.candidate.reps,
    estimatedOneRepMax: best.candidate.oneRepMax,
    baseline: input.baseline,
  };
};

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

/** The replay reference's earlier 1RM and Weight records, folded by the record book from raw sets. */
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
        volume: null,
      });
    }
  }

  const baselineByDefinition = new Map<string, RecordBaseline>();
  for (const [exerciseDefinitionId, { holders }] of books) {
    baselineByDefinition.set(exerciseDefinitionId, {
      oneRepMax: holders.oneRepMax?.value ?? null,
      weight: holders.weight,
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
 * The target's record sets (1RM, else Weight) against each definition's
 * records from earlier completed sessions, in first-exercise order. A
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
    const workingSets = workingSetsOnly(eligibleSets);

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
    const coverage = summarizeExerciseLoad(workingSets, exercise.loadContext ?? ordinaryLoadContext()).volumeCoverage;
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
  // volume is zero; its volume reads working sets only. The positive-only
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
      observation.workingSetIds.add(contribution.setIdentity);
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
