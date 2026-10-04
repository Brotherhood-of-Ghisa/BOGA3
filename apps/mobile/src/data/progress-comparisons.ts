import { addFiniteVolume } from '@/src/exercise-calculations/analytics';
import { collectMuscleSetContributions, type MuscleAnalyticsInput, type MuscleSetContribution } from './muscle-analytics';

export type ProgressPeriodValues = {
  workingSetCount: number;
  totalVolume: number | null;
  knownVolume: number | null;
  volumeSetCount: number;
  knownVolumeSetCount: number;
};

/** Same Volume comparison semantics as Progress, without display strings. */
export type ProgressVolumeChange =
  | { kind: 'incomplete' | 'empty' | 'new' | 'increased' }
  | { kind: 'percent'; percent: number };

export type ProgressComparison = {
  current: ProgressPeriodValues;
  previous: ProgressPeriodValues;
  workingSetChange: number;
  volumeChange: ProgressVolumeChange;
};

export type ProgressExerciseComparison = ProgressComparison & {
  exerciseDefinitionId: string;
  displayName: string;
  role: 'primary' | 'secondary';
};

export type ProgressMuscleComparison = ProgressComparison & {
  muscleGroupId: string;
  displayName: string;
  familyName: string;
  sortOrder: number;
  exercises: ProgressExerciseComparison[];
};

export type ProgressComparisonPeriods = {
  current: { start: Date; end: Date };
  previous: { start: Date; end: Date };
};

export const compareProgressVolume = (current: number | null, previous: number | null): ProgressVolumeChange => {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { kind: 'incomplete' };
  }
  if (current === 0 && previous === 0) return { kind: 'empty' };
  if (previous === 0) return { kind: 'new' };
  const percent = Math.round(((current - previous) / previous) * 100);
  return Number.isFinite(percent) ? { kind: 'percent', percent } : { kind: 'increased' };
};

type PeriodAccumulator = ProgressPeriodValues & { workingSetIdentities: Set<string> };
const emptyPeriod = (): PeriodAccumulator => ({
  workingSetCount: 0, totalVolume: 0, knownVolume: 0,
  volumeSetCount: 0, knownVolumeSetCount: 0, workingSetIdentities: new Set(),
});

const accumulate = (values: PeriodAccumulator, contribution: MuscleSetContribution): void => {
  if (contribution.working) values.workingSetIdentities.add(contribution.setIdentity);
  values.workingSetCount = values.workingSetIdentities.size;
  if (!contribution.volumeIncluded) return;
  values.volumeSetCount += 1;
  if (contribution.weightedVolume !== null) values.knownVolumeSetCount += 1;
  values.knownVolume = addFiniteVolume(values.knownVolume, contribution.weightedVolume ?? 0);
  values.totalVolume = addFiniteVolume(values.totalVolume, contribution.weightedVolume);
};

const periodValues = ({ workingSetIdentities: _identities, ...values }: PeriodAccumulator): ProgressPeriodValues => values;
type ComparisonAccumulator = { current: PeriodAccumulator; previous: PeriodAccumulator };
const emptyComparison = (): ComparisonAccumulator => ({ current: emptyPeriod(), previous: emptyPeriod() });
const comparison = (values: ComparisonAccumulator): ProgressComparison => ({
  current: periodValues(values.current), previous: periodValues(values.previous),
  workingSetChange: values.current.workingSetCount - values.previous.workingSetCount,
  volumeChange: compareProgressVolume(values.current.totalVolume, values.previous.totalVolume),
});

const contains = (period: ProgressComparisonPeriods['current'], date: Date): boolean =>
  date >= period.start && date < period.end;

type ExerciseAccumulator = ComparisonAccumulator & {
  exerciseDefinitionId: string;
  displayName: string;
  role: 'primary' | 'secondary';
};
type MuscleAccumulator = ComparisonAccumulator & { exercises: Map<string, ExerciseAccumulator> };

/** Both tables and both periods are projections of one input/policy snapshot. */
export const aggregateProgressComparisons = (
  input: MuscleAnalyticsInput, periods: ProgressComparisonPeriods,
): ProgressMuscleComparison[] => {
  const muscles = new Map<string, MuscleAccumulator>();
  const definitionNames = new Map((input.exerciseDefinitions ?? []).map(definition => [definition.id, definition.name]));
  for (const contribution of collectMuscleSetContributions(input)) {
    const period = contains(periods.current, contribution.sessionCompletedAt) ? 'current'
      : contains(periods.previous, contribution.sessionCompletedAt) ? 'previous' : null;
    if (period === null) continue;
    const muscle: MuscleAccumulator = muscles.get(contribution.muscleGroupId) ?? { ...emptyComparison(), exercises: new Map() };
    muscles.set(contribution.muscleGroupId, muscle);
    const exercise: ExerciseAccumulator = muscle.exercises.get(contribution.exerciseDefinitionId) ?? {
      ...emptyComparison(), exerciseDefinitionId: contribution.exerciseDefinitionId,
      displayName: definitionNames.get(contribution.exerciseDefinitionId) ?? contribution.exerciseName ?? contribution.exerciseDefinitionId,
      role: 'secondary',
    };
    muscle.exercises.set(contribution.exerciseDefinitionId, exercise);
    if (contribution.role === 'primary') exercise.role = 'primary';
    accumulate(muscle[period], contribution);
    accumulate(exercise[period], contribution);
  }

  return [...input.muscleGroups]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id))
    .map(group => {
      const muscle = muscles.get(group.id) ?? { ...emptyComparison(), exercises: new Map<string, ExerciseAccumulator>() };
      return {
        muscleGroupId: group.id, displayName: group.displayName, familyName: group.familyName, sortOrder: group.sortOrder,
        ...comparison(muscle),
        exercises: [...muscle.exercises.values()]
          .map(exercise => ({ exerciseDefinitionId: exercise.exerciseDefinitionId,
            displayName: exercise.displayName, role: exercise.role, ...comparison(exercise) }))
          .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.exerciseDefinitionId.localeCompare(right.exerciseDefinitionId)),
      };
    });
};
