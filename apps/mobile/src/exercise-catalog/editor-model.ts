// The exercise editor's decisions, as plain functions: how an exercise's
// mappings become unique primary and secondary muscles, what the form
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
import { isRestTimerSec, validateExerciseRestTimerSec, type ExerciseRestTimerValidation } from '@/src/exercise-core/rest-timer';

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
  restTimerSec?: number | null;
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
  restTimerSec: exercise.restTimerSec,
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

type SavedMapping = Pick<ExerciseCatalogExerciseMuscleMapping, 'muscleGroupId' | 'weight' | 'role'> & { id?: string };

const pickPrimaryMapping = (mappings: ExerciseCatalogExercise['mappings']) =>
  mappings.find((mapping) => mapping.role === 'primary') ??
  [...mappings].sort((left, right) => right.weight - left.weight)[0] ??
  null;

/** The form shows each tracked reported muscle once, at its strongest role. */
export const buildEditorMuscleSelectionsFromExercise = (
  exercise: ExerciseCatalogExercise,
  assignment: MuscleReportAssignment = NO_ASSIGNMENT
): { primaryMuscleGroupIds: string[]; secondaryMuscleRows: EditableSecondaryMuscleRow[] } => {
  const mappings = reportedMappings(exercise.mappings, assignment);
  const primaries = mappings.filter((mapping) => mapping.role === 'primary');
  // Legacy exercises without a primary still open on their heaviest mapping.
  if (!exercise.mappings.some((mapping) => mapping.role === 'primary')) {
    const fallback = pickPrimaryMapping(mappings);
    if (fallback) primaries.push(fallback);
  }
  const primaryMuscleGroupIds = [...new Set(primaries.map((mapping) => mapping.muscleGroupId))];
  const seenMuscleIds = new Set(primaryMuscleGroupIds);
  const secondaryMuscleRows = mappings.filter((mapping) => {
    if (seenMuscleIds.has(mapping.muscleGroupId)) return false;
    seenMuscleIds.add(mapping.muscleGroupId);
    return true;
  }).map((mapping) => ({
    rowId: mapping.id || `muscle-link-row-prefill-${mapping.muscleGroupId}`,
    muscleGroupId: mapping.muscleGroupId,
  }));
  return { primaryMuscleGroupIds, secondaryMuscleRows };
};

export type EditorOpenState = {
  name: string;
  loadInputMode: EditorLoadInputMode;
  primaryMuscleGroupIds: string[];
  secondaryMuscleRows: EditableSecondaryMuscleRow[];
  contributionPercentage: string;
  splitByGym: boolean;
  /** The rest timer field's text: blank uses the global timer ([[timer.rest-default]]). */
  restTimerText: string;
};

const prefillAsExercise = (prefill: ExerciseEditorPrefill): ExerciseCatalogExercise => ({
  id: '',
  name: prefill.name,
  loadInputMode: prefill.loadInputMode,
  bodyweightContribution: 0,
  splitByGym: prefill.splitByGym ?? false,
  restTimerSec: prefill.restTimerSec ?? null,
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
      restTimerText: restTimerText(editingExercise.restTimerSec),
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
      restTimerText: restTimerText(prefilled.restTimerSec),
    };
  }
  return {
    name: '',
    loadInputMode: 'total_load',
    primaryMuscleGroupIds: [],
    secondaryMuscleRows: [],
    contributionPercentage,
    splitByGym: false,
    restTimerText: '',
  };
};

// A stored value outside the range opens blank, as the timer ignores it too.
const restTimerText = (restTimerSec: number | null) => (isRestTimerSec(restTimerSec) ? String(restTimerSec) : '');

/** What the rest timer field saves: blank is null (the global timer), else whole seconds in range. */
export const parseRestTimerText = (text: string): ExerciseRestTimerValidation => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return validateExerciseRestTimerSec(null);
  }
  return validateExerciseRestTimerSec(/^\d+$/.test(trimmed) ? Number(trimmed) : NaN);
};

/** Each multi-select excludes the muscles chosen for the other role. */
export const muscleSelectorOptions = (
  mode: MuscleSelectorMode,
  muscleGroups: ReportedMuscle[],
  selectedPrimaryMuscleIds: Set<string>,
  selectedSecondaryMuscleIds: Set<string>
): ReportedMuscle[] =>
  mode === 'primary'
    ? muscleGroups.filter((muscleGroup) => !selectedSecondaryMuscleIds.has(muscleGroup.id))
    : muscleGroups.filter((muscleGroup) => !selectedPrimaryMuscleIds.has(muscleGroup.id));

/** The exercise's mappings to entries the user does not track: hidden by the editor and kept on Save. */
export const untrackedMappings = <M extends { muscleGroupId: string }>(
  mappings: readonly M[], assignment: MuscleReportAssignment
): M[] => mappings.filter((mapping) => isUntrackedEntry(assignment, mapping.muscleGroupId));

const strongestRoleWeight = (mappings: readonly SavedMapping[]): number =>
  Math.max(...mappings.map((mapping) => getMuscleContributionRoleWeight(mapping.role)));

/** A kept visible mapping, with the weight the editor writes for its role (as every editor save does). */
const keptMapping = ({ muscleGroupId, weight, role }: SavedMapping): EditorMapping => {
  if (role === 'primary') return { muscleGroupId, weight: PRIMARY_MUSCLE_WEIGHT, role };
  if (role === 'secondary') return { muscleGroupId, weight: SECONDARY_MUSCLE_WEIGHT, role };
  return { muscleGroupId, weight, role };
};

/**
 * The mappings Save writes for the chosen muscles, given the mappings the form
 * opened with ([[muscle.no-breakdown]]). A muscle the exercise did not map
 * gets one mapping to its anchor, or a tracked entry if the anchor is hidden.
 * A muscle that keeps
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
      const entryId = isUntrackedEntry(assignment, muscle.muscleGroupId)
        ? [...assignment].find(([, entry]) => entry.tracked && entry.muscle.id === muscle.muscleGroupId)?.[0]
        : muscle.muscleGroupId;
      if (entryId) byEntry.set(entryId, { ...muscle, muscleGroupId: entryId });
      continue;
    }
    const keepsRole = strongestRoleWeight(entries) === getMuscleContributionRoleWeight(muscle.role);
    for (const entry of entries) {
      byEntry.set(entry.muscleGroupId, keepsRole ? keptMapping(entry) : { ...muscle, muscleGroupId: entry.muscleGroupId });
    }
  }
  for (const { muscleGroupId, weight, role } of untrackedMappings(opened, assignment)) {
    byEntry.set(muscleGroupId, { muscleGroupId, weight, role });
  }
  return [...byEntry.values()];
};

/**
 * The editor's inline errors, and the mappings Save would send when there are
 * none. The resolved mappings must include a primary, visible or hidden.
 */
export const validateEditorInput = ({
  name,
  loadInputMode,
  primaryMuscleGroupIds,
  secondaryMuscleRows,
  openedMappings = [],
  assignment = NO_ASSIGNMENT,
}: {
  name: string;
  loadInputMode: EditorLoadInputMode;
  primaryMuscleGroupIds: string[];
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
  for (const muscleGroupId of primaryMuscleGroupIds) {
    if (seenMuscleIds.has(muscleGroupId)) {
      validation.primaryMuscleError = 'Duplicate primary muscle.';
      continue;
    }
    seenMuscleIds.add(muscleGroupId);
    mappings.push({ muscleGroupId, weight: PRIMARY_MUSCLE_WEIGHT, role: 'primary' });
  }
  for (const row of secondaryMuscleRows) {
    if (seenMuscleIds.has(row.muscleGroupId)) {
      validation.secondaryMusclesError = 'Duplicate secondary muscle.';
      continue;
    }
    seenMuscleIds.add(row.muscleGroupId);
    mappings.push({ muscleGroupId: row.muscleGroupId, weight: SECONDARY_MUSCLE_WEIGHT, role: 'secondary' });
  }
  const resolved = resolveEditorMappings(mappings, openedMappings, assignment);
  if (!resolved.some((mapping) => mapping.role === 'primary') && !validation.primaryMuscleError) {
    validation.primaryMuscleError = 'Select a primary muscle before saving.';
  }
  const hasErrors = Object.values(validation).some((error) => error !== null);
  return { validation, mappings: hasErrors ? null : resolved };
};

/** The contribution field as a percentage; anything but a plain non-negative decimal is NaN (invalid). */
export const parseBodyweightPercentage = (text: string): number => {
  const trimmed = text.trim();
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) ? Number(trimmed) : NaN;
};
