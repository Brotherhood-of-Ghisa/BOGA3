import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from './bootstrap';
import {
  exerciseMuscleMappings,
  exerciseSets,
  muscleGroups,
  sessionExercises,
  sessions,
} from './schema';

export type StatsPeriodDays = 7 | 30;

export type StatsPeriodBounds = {
  days: StatsPeriodDays;
  start: Date;
  end: Date;
};

export type StatsMuscleGroupScore = {
  muscleGroupId: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
  score: number;
};

export type StatsTotals = {
  sessionCount: number;
  totalSets: number;
  setsByMuscleGroup: StatsMuscleGroupScore[];
};

export type StatsSummary = {
  current: { period: StatsPeriodBounds; totals: StatsTotals };
  previous: { period: StatsPeriodBounds; totals: StatsTotals };
};

export type StatsAggregationInput = {
  sessions: { id: string; completedAt: Date }[];
  sessionExercises: { id: string; sessionId: string; exerciseDefinitionId: string | null }[];
  exerciseSets: { sessionExerciseId: string; setType: string | null }[];
  muscleMappings: {
    exerciseDefinitionId: string;
    muscleGroupId: string;
    role: 'primary' | 'secondary' | 'stabilizer' | null;
  }[];
  muscleGroups: {
    id: string;
    displayName: string;
    familyName: string;
    sortOrder: number;
  }[];
};

export type StatsStore = {
  loadAggregationInput(input: { start: Date; end: Date }): Promise<StatsAggregationInput>;
  loadMuscleGroupTaxonomy(): Promise<StatsAggregationInput['muscleGroups']>;
};

export type ComputeStatsSummaryOptions = {
  periodDays: StatsPeriodDays;
  now?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const ensureDate = (value: Date, label: string): Date => {
  if (!isValidDate(value)) {
    throw new Error(`${label} must be a valid Date`);
  }
  return value;
};

const muscleRoleWeight = (role: 'primary' | 'secondary' | 'stabilizer' | null): number => {
  if (role === 'primary') return 1;
  if (role === 'secondary') return 0.5;
  return 0;
};

const isWorkingSet = (setType: string | null) => setType !== 'warm_up';

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
  const sessionExerciseBySessionId = new Map<string, typeof input.sessionExercises>();
  const sessionExerciseById = new Map<string, (typeof input.sessionExercises)[number]>();
  for (const exercise of input.sessionExercises) {
    sessionExerciseById.set(exercise.id, exercise);
    const bucket = sessionExerciseBySessionId.get(exercise.sessionId) ?? [];
    bucket.push(exercise);
    sessionExerciseBySessionId.set(exercise.sessionId, bucket);
  }

  const sessionIds = new Set(input.sessions.map((session) => session.id));
  const includedExerciseIds = new Set<string>();
  for (const exercise of input.sessionExercises) {
    if (sessionIds.has(exercise.sessionId)) {
      includedExerciseIds.add(exercise.id);
    }
  }

  const workingSets = input.exerciseSets.filter(
    (set) => isWorkingSet(set.setType) && includedExerciseIds.has(set.sessionExerciseId)
  );

  const mappingsByExerciseDefinitionId = new Map<string, typeof input.muscleMappings>();
  for (const mapping of input.muscleMappings) {
    const bucket = mappingsByExerciseDefinitionId.get(mapping.exerciseDefinitionId) ?? [];
    bucket.push(mapping);
    mappingsByExerciseDefinitionId.set(mapping.exerciseDefinitionId, bucket);
  }

  const scoreByMuscleGroupId = new Map<string, number>();
  for (const set of workingSets) {
    const exercise = sessionExerciseById.get(set.sessionExerciseId);
    if (!exercise || exercise.exerciseDefinitionId === null) continue;
    const mappings = mappingsByExerciseDefinitionId.get(exercise.exerciseDefinitionId) ?? [];
    for (const mapping of mappings) {
      const weight = muscleRoleWeight(mapping.role);
      if (weight === 0) continue;
      scoreByMuscleGroupId.set(
        mapping.muscleGroupId,
        (scoreByMuscleGroupId.get(mapping.muscleGroupId) ?? 0) + weight
      );
    }
  }

  const setsByMuscleGroup: StatsMuscleGroupScore[] = input.muscleGroups
    .map((group) => ({
      muscleGroupId: group.id,
      displayName: group.displayName,
      familyName: group.familyName,
      sortOrder: group.sortOrder,
      score: scoreByMuscleGroupId.get(group.id) ?? 0,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.displayName.localeCompare(right.displayName);
    });

  return {
    sessionCount: input.sessions.length,
    totalSets: workingSets.length,
    setsByMuscleGroup,
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
            })
            .from(sessionExercises)
            .where(inArray(sessionExercises.sessionId, sessionIds))
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
              sessionExerciseId: exerciseSets.sessionExerciseId,
              setType: exerciseSets.setType,
            })
            .from(exerciseSets)
            .where(inArray(exerciseSets.sessionExerciseId, sessionExerciseIds))
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
            .where(inArray(exerciseMuscleMappings.exerciseDefinitionId, exerciseDefinitionIds))
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
});

const defaultStatsRepository = createStatsRepository();

export const computeStatsSummary = defaultStatsRepository.computeSummary;
