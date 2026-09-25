import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import type {
  ExerciseAggregate,
  ExerciseCatalogStats,
  ExerciseRecencyScore,
} from '@/src/data/exercise-catalog-stats';

import { filterIndexedExerciseCatalogExercises, type IndexedExerciseCatalogExercise } from './search';

export type ExerciseDateFormat = 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'YYYY-MM-DD';
export type ExerciseListSort = 'favourite' | 'name';

export type ExerciseListPreferences = {
  sort: ExerciseListSort;
  showNeverDone: boolean;
  // Used by the exercise detail records panel, independently of browser dates.
  dateFormat: ExerciseDateFormat;
};

export const DEFAULT_EXERCISE_LIST_PREFERENCES: ExerciseListPreferences = {
  sort: 'favourite',
  showNeverDone: true,
  dateFormat: 'DD-MM-YYYY',
};

export const EXERCISE_LIST_FAMILY_ORDER = [
  'Chest',
  'Shoulders',
  'Back',
  'Arms',
  'Core',
  'Legs',
  'Lower Legs',
  'Other',
] as const;

export const OTHER_EXERCISE_FAMILY = 'Other';

export type ExerciseListItem = IndexedExerciseCatalogExercise & {
  aggregate: ExerciseAggregate | undefined;
  recency: ExerciseRecencyScore | undefined;
  hasAllTimeHistory: boolean;
  lastDoneDate: Date | null;
  primaryFamilyName: string;
  muscleSummary: string;
  statsSummary: string;
};

export type ExerciseListSection = {
  familyName: string;
  count: number;
  exercises: ExerciseListItem[];
};

export type BuildExerciseListModelInput = {
  exercises: IndexedExerciseCatalogExercise[];
  muscleGroups: ExerciseCatalogMuscleGroup[];
  stats: ExerciseCatalogStats;
  preferences: ExerciseListPreferences;
  query: string;
  includeDeleted: boolean;
  now?: Date;
};

export type ExerciseListModel = {
  isSearching: boolean;
  items: ExerciseListItem[];
  sections: ExerciseListSection[];
};

export const pickPrimaryExerciseMapping = (exercise: ExerciseCatalogExercise) =>
  exercise.mappings.find((mapping) => mapping.role === 'primary') ??
  [...exercise.mappings].sort((left, right) => right.weight - left.weight)[0] ??
  null;

const getMuscleDisplayName = (
  muscleGroupId: string,
  muscleGroupById: Map<string, ExerciseCatalogMuscleGroup>
) => muscleGroupById.get(muscleGroupId)?.displayName ?? muscleGroupId;

export const getExercisePrimaryFamilyName = (
  exercise: ExerciseCatalogExercise,
  muscleGroupById: Map<string, ExerciseCatalogMuscleGroup>
): string => {
  const primaryMapping = pickPrimaryExerciseMapping(exercise);
  if (!primaryMapping) return OTHER_EXERCISE_FAMILY;
  return muscleGroupById.get(primaryMapping.muscleGroupId)?.familyName ?? OTHER_EXERCISE_FAMILY;
};

export const formatExerciseMuscleSummary = (
  exercise: ExerciseCatalogExercise,
  muscleGroupById: Map<string, ExerciseCatalogMuscleGroup>
) => {
  if (exercise.mappings.length === 0) {
    return 'No muscle links';
  }

  const primaryMapping = pickPrimaryExerciseMapping(exercise);

  if (!primaryMapping) {
    return 'No muscle links';
  }

  const secondaryMappings = exercise.mappings.filter((mapping) => mapping.id !== primaryMapping.id);
  const primaryLabel = getMuscleDisplayName(primaryMapping.muscleGroupId, muscleGroupById);

  if (secondaryMappings.length === 0) {
    return primaryLabel;
  }

  if (secondaryMappings.length === 1) {
    const secondaryLabel = getMuscleDisplayName(secondaryMappings[0].muscleGroupId, muscleGroupById);
    return `${primaryLabel} · ${secondaryLabel} (s)`;
  }

  return `${primaryLabel} · ${secondaryMappings.length} secondaries`;
};

export const formatShortDate = (date: Date, dateFormat: ExerciseDateFormat): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const year = date.getFullYear();
  if (dateFormat === 'YYYY-MM-DD') {
    return `${year}-${month}-${day}`;
  }
  if (dateFormat === 'MM-DD-YYYY') {
    return `${month}-${day}-${year}`;
  }
  return `${day}-${month}-${year}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatExerciseListStatsSummary = (
  aggregate: ExerciseAggregate | undefined,
  hasAllTimeHistory: boolean,
  lastDoneDate?: Date | null,
  now: Date = new Date()
): string => {
  if (!hasAllTimeHistory) return 'Never done';
  const count = aggregate?.sessionCount ?? 0;
  const sessions = `${count} ${count === 1 ? 'session' : 'sessions'}`;
  if (!lastDoneDate) return sessions;
  const year = lastDoneDate.getFullYear() === now.getFullYear() ? '' : ` ${lastDoneDate.getFullYear()}`;
  return `Last: ${lastDoneDate.getDate()} ${MONTHS[lastDoneDate.getMonth()]}${year} · ${sessions}`;
};

const compareExerciseNames = (left: ExerciseCatalogExercise, right: ExerciseCatalogExercise): number =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });

const compareByRecency = (left: ExerciseListItem, right: ExerciseListItem): number => {
  const leftScore = left.recency?.score ?? 0;
  const rightScore = right.recency?.score ?? 0;
  if (leftScore !== rightScore) return rightScore - leftScore;

  const leftLast = left.recency?.lastCompletedAt?.getTime() ?? 0;
  const rightLast = right.recency?.lastCompletedAt?.getTime() ?? 0;
  if (leftLast !== rightLast) return rightLast - leftLast;

  return compareExerciseNames(left, right);
};

const buildFamilyOrder = (muscleGroups: ExerciseCatalogMuscleGroup[]): string[] => {
  const familySet = new Set(EXERCISE_LIST_FAMILY_ORDER);
  const unknownFamilies = Array.from(
    new Set(
      muscleGroups
        .map((muscleGroup) => muscleGroup.familyName)
        .filter((familyName) => !familySet.has(familyName as (typeof EXERCISE_LIST_FAMILY_ORDER)[number]))
    )
  ).sort((left, right) => left.localeCompare(right));

  return [
    ...EXERCISE_LIST_FAMILY_ORDER.filter((familyName) => familyName !== OTHER_EXERCISE_FAMILY),
    ...unknownFamilies,
    OTHER_EXERCISE_FAMILY,
  ];
};

export const buildExerciseListModel = ({
  exercises,
  muscleGroups,
  stats,
  preferences,
  query,
  includeDeleted,
  now = new Date(),
}: BuildExerciseListModelInput): ExerciseListModel => {
  const muscleGroupById = new Map(muscleGroups.map((muscleGroup) => [muscleGroup.id, muscleGroup]));
  const isSearching = query.trim().length > 0;

  const visible = exercises.filter((exercise) => {
    if (!includeDeleted && exercise.deletedAt) return false;
    if (!preferences.showNeverDone && !stats.everDoneIds.has(exercise.id)) return false;
    return true;
  });

  const filtered = filterIndexedExerciseCatalogExercises(visible, query);
  const items = filtered.map<ExerciseListItem>((exercise) => {
    const aggregate = stats.aggregatesById.get(exercise.id);
    const hasAllTimeHistory = stats.everDoneIds.has(exercise.id);
    const lastDoneDate = stats.lastCompletedAtById.get(exercise.id) ?? null;
    return {
      ...exercise,
      aggregate,
      recency: stats.recencyScoresById.get(exercise.id),
      hasAllTimeHistory,
      lastDoneDate,
      primaryFamilyName: getExercisePrimaryFamilyName(exercise, muscleGroupById),
      muscleSummary: formatExerciseMuscleSummary(exercise, muscleGroupById),
      statsSummary: formatExerciseListStatsSummary(aggregate, hasAllTimeHistory, lastDoneDate, now),
    };
  });

  const sortedItems = [...items].sort(
    preferences.sort === 'favourite' ? compareByRecency : compareExerciseNames
  );

  const familyOrder = buildFamilyOrder(muscleGroups);
  const itemBuckets = new Map<string, ExerciseListItem[]>();
  for (const item of sortedItems) {
    const bucket = itemBuckets.get(item.primaryFamilyName) ?? [];
    bucket.push(item);
    itemBuckets.set(item.primaryFamilyName, bucket);
  }

  const sections = familyOrder.map<ExerciseListSection>((familyName) => {
    const sectionItems = itemBuckets.get(familyName) ?? [];
    return {
      familyName,
      count: sectionItems.length,
      exercises: sectionItems,
    };
  });

  return {
    isSearching,
    items: sortedItems,
    sections: isSearching ? sections.filter((section) => section.count > 0) : sections,
  };
};
