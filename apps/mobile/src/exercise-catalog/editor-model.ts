// The exercise editor's decisions, as plain functions: how an exercise's
// mappings become one primary and unique secondary muscles, what the form
// opens with, which muscles the selector offers, and what Save would send.
import type {
  ExerciseCatalogExercise,
  ExerciseCatalogExerciseMuscleMapping,
  ExerciseCatalogMuscleGroup,
} from '@/src/data/exercise-catalog';
import { validateExerciseCore } from '@/src/exercise-core';

export type EditableSecondaryMuscleRow = { rowId: string; muscleGroupId: string };

export type EditorValidationState = {
  nameError: string | null;
  primaryMuscleError: string | null;
  secondaryMusclesError: string | null;
};

export type MuscleSelectorMode = 'primary' | 'secondary' | null;

export type EditorLoadInputMode = 'total_load' | 'per_side_load';

/** Initial values for a new exercise ("Add as new" from a group exercise). */
export type ExerciseEditorPrefill = {
  bodyweightContribution?: number;
  name: string;
  loadInputMode: EditorLoadInputMode;
  mappings: Pick<ExerciseCatalogExerciseMuscleMapping, 'muscleGroupId' | 'weight' | 'role'>[];
};

/** Builds prefill data to duplicate an existing catalog exercise. */
export const buildDuplicateExercisePrefill = (
  exercise: ExerciseCatalogExercise
): ExerciseEditorPrefill => ({
  name: `${exercise.name} (Copy)`,
  loadInputMode: exercise.loadInputMode ?? 'total_load',
  bodyweightContribution: exercise.bodyweightContribution,
  mappings: exercise.mappings.map((mapping) => ({
    muscleGroupId: mapping.muscleGroupId,
    weight: mapping.weight,
    role: mapping.role,
  })),
});

export type EditorMapping = { muscleGroupId: string; weight: number; role: ExerciseCatalogExerciseMuscleMapping['role'] };

export const PRIMARY_MUSCLE_WEIGHT = 1;
export const SECONDARY_MUSCLE_WEIGHT = 0.5;

export const createBlankValidationState = (): EditorValidationState => ({
  nameError: null,
  primaryMuscleError: null,
  secondaryMusclesError: null,
});

const pickPrimaryMapping = (exercise: ExerciseCatalogExercise) =>
  exercise.mappings.find((mapping) => mapping.role === 'primary') ??
  [...exercise.mappings].sort((left, right) => right.weight - left.weight)[0] ??
  null;

/** The primary is the mapping marked primary, else the heaviest; each other muscle appears once as a secondary. */
export const buildEditorMuscleSelectionsFromExercise = (
  exercise: ExerciseCatalogExercise
): { primaryMuscleGroupId: string | null; secondaryMuscleRows: EditableSecondaryMuscleRow[] } => {
  const primaryMuscleGroupId = pickPrimaryMapping(exercise)?.muscleGroupId ?? null;
  const seenSecondaryMuscleIds = new Set<string>();
  const secondaryMuscleRows = exercise.mappings
    .filter((mapping) => mapping.muscleGroupId !== primaryMuscleGroupId)
    .filter((mapping) => {
      if (seenSecondaryMuscleIds.has(mapping.muscleGroupId)) {
        return false;
      }
      seenSecondaryMuscleIds.add(mapping.muscleGroupId);
      return true;
    })
    .map((mapping) => ({
      // Built during render, so derived, not random: secondary rows are unique per muscle.
      rowId: mapping.id || `muscle-link-row-prefill-${mapping.muscleGroupId}`,
      muscleGroupId: mapping.muscleGroupId,
    }));
  return { primaryMuscleGroupId, secondaryMuscleRows };
};

export type EditorOpenState = {
  name: string;
  loadInputMode: EditorLoadInputMode;
  primaryMuscleGroupId: string | null;
  secondaryMuscleRows: EditableSecondaryMuscleRow[];
  contributionPercentage: string;
};

const prefillAsExercise = (prefill: ExerciseEditorPrefill): ExerciseCatalogExercise => ({
  id: '',
  name: prefill.name,
  loadInputMode: prefill.loadInputMode,
  bodyweightContribution: 0,
  deletedAt: null,
  mappings: prefill.mappings.map((mapping) => ({ ...mapping, id: '' })),
});

/** What the form shows when it opens: the exercise being edited, else the prefill, else a blank exercise. */
export const editorOpenState = (
  editingExercise: ExerciseCatalogExercise | null,
  prefill: ExerciseEditorPrefill | null
): EditorOpenState => {
  const contribution = editingExercise?.bodyweightContribution ?? prefill?.bodyweightContribution ?? 0;
  const contributionPercentage = `${contribution * 100}`;
  if (editingExercise) {
    return {
      name: editingExercise.name,
      loadInputMode: editingExercise.loadInputMode ?? 'total_load',
      ...buildEditorMuscleSelectionsFromExercise(editingExercise),
      contributionPercentage,
    };
  }
  if (prefill) {
    return {
      name: prefill.name,
      loadInputMode: prefill.loadInputMode,
      ...buildEditorMuscleSelectionsFromExercise(prefillAsExercise(prefill)),
      contributionPercentage,
    };
  }
  return { name: '', loadInputMode: 'total_load', primaryMuscleGroupId: null, secondaryMuscleRows: [], contributionPercentage };
};

/** The muscles the selector offers: the current primary or any unchosen muscle; for secondaries, only unchosen ones. */
export const muscleSelectorOptions = (
  mode: MuscleSelectorMode,
  muscleGroups: ExerciseCatalogMuscleGroup[],
  primaryMuscleGroupId: string | null,
  selectedSecondaryMuscleIds: Set<string>
): ExerciseCatalogMuscleGroup[] =>
  mode === 'primary'
    ? muscleGroups.filter((muscleGroup) => muscleGroup.id === primaryMuscleGroupId || !selectedSecondaryMuscleIds.has(muscleGroup.id))
    : muscleGroups.filter((muscleGroup) => muscleGroup.id !== primaryMuscleGroupId && !selectedSecondaryMuscleIds.has(muscleGroup.id));

/** The editor's inline errors, and the mappings Save would send when there are none. */
export const validateEditorInput = ({ name, loadInputMode, primaryMuscleGroupId, secondaryMuscleRows }: {
  name: string;
  loadInputMode: EditorLoadInputMode;
  primaryMuscleGroupId: string | null;
  secondaryMuscleRows: EditableSecondaryMuscleRow[];
}): { validation: EditorValidationState; mappings: EditorMapping[] | null } => {
  const validation = createBlankValidationState();
  // The shared ExerciseCore rules (same validator as group exercises and `saveExercise`).
  const core = validateExerciseCore({ name, loadInputMode });
  if (!core.ok && core.issue === 'name_required') {
    validation.nameError = core.message;
  }
  const mappings: EditorMapping[] = [];
  const seenMuscleIds = new Set<string>();
  if (primaryMuscleGroupId) {
    seenMuscleIds.add(primaryMuscleGroupId);
    mappings.push({ muscleGroupId: primaryMuscleGroupId, weight: PRIMARY_MUSCLE_WEIGHT, role: 'primary' });
  } else {
    validation.primaryMuscleError = 'Select a primary muscle before saving.';
  }
  for (const row of secondaryMuscleRows) {
    if (seenMuscleIds.has(row.muscleGroupId)) {
      validation.secondaryMusclesError = 'Duplicate secondary muscle.';
      continue;
    }
    seenMuscleIds.add(row.muscleGroupId);
    mappings.push({ muscleGroupId: row.muscleGroupId, weight: SECONDARY_MUSCLE_WEIGHT, role: 'secondary' });
  }
  const hasErrors = Object.values(validation).some((error) => error !== null);
  return { validation, mappings: hasErrors ? null : mappings };
};

/** The contribution field as a percentage; anything but a plain non-negative decimal is NaN (invalid). */
export const parseBodyweightPercentage = (text: string): number => {
  const trimmed = text.trim();
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) ? Number(trimmed) : NaN;
};
