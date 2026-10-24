// The exercise editor's decisions, as plain functions: how an exercise's
// mappings become one primary and unique secondary muscles, what the form
// opens with, which muscles the selector offers, and what Save would send.
// The editor works in the user's muscles ([[muscle.no-breakdown]]); Save turns
// them back into mappings to anatomy entries.
import type {
  ExerciseCatalogExercise,
  ExerciseCatalogExerciseMuscleMapping,
} from '@/src/data/exercise-catalog';
import {
  getMuscleContributionRoleWeight,
  type MuscleReportAssignment,
  type ReportedMuscle,
} from '@/src/data/muscle-analytics';
import { validateExerciseCore } from '@/src/exercise-core';

import { isUntrackedEntry, muscleIdOfEntry, reportedMappings } from './muscle-setup';

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
  splitByGym?: boolean;
  mappings: Pick<ExerciseCatalogExerciseMuscleMapping, 'muscleGroupId' | 'weight' | 'role'>[];
};

/** Builds prefill data to duplicate an existing catalog exercise. */
export const buildDuplicateExercisePrefill = (
  exercise: ExerciseCatalogExercise
): ExerciseEditorPrefill => ({
  name: `${exercise.name} (Copy)`,
  loadInputMode: exercise.loadInputMode ?? 'total_load',
  bodyweightContribution: exercise.bodyweightContribution,
  splitByGym: exercise.splitByGym,
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

const NO_ASSIGNMENT: MuscleReportAssignment = new Map();

type SavedMapping = Pick<ExerciseCatalogExerciseMuscleMapping, 'muscleGroupId' | 'weight' | 'role'>;

const pickPrimaryMapping = (mappings: ExerciseCatalogExercise['mappings']) =>
  mappings.find((mapping) => mapping.role === 'primary') ??
  [...mappings].sort((left, right) => right.weight - left.weight)[0] ??
  null;

/**
 * The form's muscles, in the user's muscles: the primary is the muscle a
 * mapping marks primary, else the heaviest; each other muscle appears once as
 * a secondary. Mappings to untracked entries are left out.
 */
export const buildEditorMuscleSelectionsFromExercise = (
  exercise: ExerciseCatalogExercise,
  assignment: MuscleReportAssignment = NO_ASSIGNMENT
): { primaryMuscleGroupId: string | null; secondaryMuscleRows: EditableSecondaryMuscleRow[] } => {
  const mappings = reportedMappings(exercise.mappings, assignment);
  const primaryMuscleGroupId = pickPrimaryMapping(mappings)?.muscleGroupId ?? null;
  const seenSecondaryMuscleIds = new Set<string>();
  const secondaryMuscleRows = mappings
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
  splitByGym: boolean;
};

const prefillAsExercise = (prefill: ExerciseEditorPrefill): ExerciseCatalogExercise => ({
  id: '',
  name: prefill.name,
  loadInputMode: prefill.loadInputMode,
  bodyweightContribution: 0,
  splitByGym: prefill.splitByGym ?? false,
  deletedAt: null,
  mappings: prefill.mappings.map((mapping) => ({ ...mapping, id: '' })),
});

/** What the form shows when it opens: the exercise being edited, else the prefill, else a blank exercise. */
export const editorOpenState = (
  editingExercise: ExerciseCatalogExercise | null,
  prefill: ExerciseEditorPrefill | null,
  assignment: MuscleReportAssignment = NO_ASSIGNMENT
): EditorOpenState => {
  const contribution = editingExercise?.bodyweightContribution ?? prefill?.bodyweightContribution ?? 0;
  const contributionPercentage = `${contribution * 100}`;
  if (editingExercise) {
    return {
      name: editingExercise.name,
      loadInputMode: editingExercise.loadInputMode ?? 'total_load',
      ...buildEditorMuscleSelectionsFromExercise(editingExercise, assignment),
      contributionPercentage,
      splitByGym: editingExercise.splitByGym,
    };
  }
  if (prefill) {
    const prefilled = prefillAsExercise(prefill);
    return {
      name: prefill.name,
      loadInputMode: prefill.loadInputMode,
      ...buildEditorMuscleSelectionsFromExercise(prefilled, assignment),
      contributionPercentage,
      splitByGym: prefilled.splitByGym,
    };
  }
  return {
    name: '',
    loadInputMode: 'total_load',
    primaryMuscleGroupId: null,
    secondaryMuscleRows: [],
    contributionPercentage,
    splitByGym: false,
  };
};

/** The muscles the selector offers: the current primary or any unchosen muscle; for secondaries, only unchosen ones. */
export const muscleSelectorOptions = (
  mode: MuscleSelectorMode,
  muscleGroups: ReportedMuscle[],
  primaryMuscleGroupId: string | null,
  selectedSecondaryMuscleIds: Set<string>
): ReportedMuscle[] =>
  mode === 'primary'
    ? muscleGroups.filter((muscleGroup) => muscleGroup.id === primaryMuscleGroupId || !selectedSecondaryMuscleIds.has(muscleGroup.id))
    : muscleGroups.filter((muscleGroup) => muscleGroup.id !== primaryMuscleGroupId && !selectedSecondaryMuscleIds.has(muscleGroup.id));

/** The exercise's mappings to entries the user does not track: hidden by the editor and kept on Save. */
export const untrackedMappings = <M extends { muscleGroupId: string }>(
  mappings: readonly M[], assignment: MuscleReportAssignment
): M[] => mappings.filter((mapping) => isUntrackedEntry(assignment, mapping.muscleGroupId));

const strongestRoleWeight = (mappings: readonly SavedMapping[]): number =>
  Math.max(...mappings.map((mapping) => getMuscleContributionRoleWeight(mapping.role)));

/** A kept mapping, with the weight the editor writes for its role (as every editor save does). */
const keptMapping = ({ muscleGroupId, weight, role }: SavedMapping): EditorMapping => {
  if (role === 'primary') return { muscleGroupId, weight: PRIMARY_MUSCLE_WEIGHT, role };
  if (role === 'secondary') return { muscleGroupId, weight: SECONDARY_MUSCLE_WEIGHT, role };
  return { muscleGroupId, weight, role };
};

/**
 * The mappings Save writes for the chosen muscles, given the mappings the form
 * opened with ([[muscle.no-breakdown]]). A muscle the exercise did not map
 * gets one mapping to its anchor entry (the muscle's id). A muscle that keeps
 * the strongest role it opened with keeps each mapping's role; one whose
 * role changed has every mapping to its entries rewritten to the new role. A
 * muscle no longer chosen loses all of them. Mappings to untracked entries are
 * kept: an edit never deletes what the user cannot see.
 */
export const resolveEditorMappings = (
  chosen: readonly EditorMapping[],
  opened: readonly SavedMapping[],
  assignment: MuscleReportAssignment
): EditorMapping[] => {
  const openedByMuscle = new Map<string, SavedMapping[]>();
  for (const mapping of opened) {
    if (isUntrackedEntry(assignment, mapping.muscleGroupId)) continue;
    const muscleId = muscleIdOfEntry(assignment, mapping.muscleGroupId);
    openedByMuscle.set(muscleId, [...(openedByMuscle.get(muscleId) ?? []), mapping]);
  }
  const byEntry = new Map<string, EditorMapping>();
  for (const muscle of chosen) {
    const entries = openedByMuscle.get(muscle.muscleGroupId) ?? [];
    if (entries.length === 0) {
      byEntry.set(muscle.muscleGroupId, muscle);
      continue;
    }
    const keepsRole = strongestRoleWeight(entries) === getMuscleContributionRoleWeight(muscle.role);
    for (const entry of entries) {
      byEntry.set(entry.muscleGroupId, keepsRole ? keptMapping(entry) : { ...muscle, muscleGroupId: entry.muscleGroupId });
    }
  }
  for (const mapping of untrackedMappings(opened, assignment)) {
    if (!byEntry.has(mapping.muscleGroupId)) byEntry.set(mapping.muscleGroupId, keptMapping(mapping));
  }
  return [...byEntry.values()];
};

/**
 * The editor's inline errors, and the mappings Save would send when there are
 * none. A primary is required unless a kept untracked mapping is primary.
 */
export const validateEditorInput = ({
  name,
  loadInputMode,
  primaryMuscleGroupId,
  secondaryMuscleRows,
  openedMappings = [],
  assignment = NO_ASSIGNMENT,
}: {
  name: string;
  loadInputMode: EditorLoadInputMode;
  primaryMuscleGroupId: string | null;
  secondaryMuscleRows: EditableSecondaryMuscleRow[];
  /** The mappings the form opened with: the edited exercise's, else the prefill's. */
  openedMappings?: readonly SavedMapping[];
  assignment?: MuscleReportAssignment;
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
  } else if (!untrackedMappings(openedMappings, assignment).some((mapping) => mapping.role === 'primary')) {
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
  return { validation, mappings: hasErrors ? null : resolveEditorMappings(mappings, openedMappings, assignment) };
};

/** The contribution field as a percentage; anything but a plain non-negative decimal is NaN (invalid). */
export const parseBodyweightPercentage = (text: string): number => {
  const trimmed = text.trim();
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) ? Number(trimmed) : NaN;
};
