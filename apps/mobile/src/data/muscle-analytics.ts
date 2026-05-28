import { computeSetVolume, parseSetReps, parseSetWeight } from '@/src/exercise-calculations';

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
  muscleGroupId: string;
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
  const contributions = collectMuscleSetContributions(input).filter(
    (contribution) => contribution.muscleGroupId === options.muscleGroupId
  );

  for (const contribution of contributions) {
    const dateKey = formatLocalDateKey(contribution.sessionCompletedAt, options.timeZone);
    const entry = entriesByDate.get(dateKey) ?? {
      dateKey,
      muscleGroupId: options.muscleGroupId,
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
