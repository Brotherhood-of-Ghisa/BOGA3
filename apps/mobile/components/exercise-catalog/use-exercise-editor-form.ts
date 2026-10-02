import { useState } from 'react';
import { Keyboard } from 'react-native';

import type { BodyweightContributionFieldValue } from '@/components/exercise-core/exercise-core-fields';
import { saveExerciseCatalogExercise, type ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import {
  createBlankValidationState,
  editorOpenState,
  parseBodyweightPercentage,
  validateEditorInput,
  type EditableSecondaryMuscleRow,
  type EditorLoadInputMode,
  type EditorMapping,
  type EditorValidationState,
  type ExerciseEditorPrefill,
  type MuscleSelectorMode,
} from '@/src/exercise-catalog/editor-model';
import { validateBodyweightContribution } from '@/src/exercise-core/bodyweight-contribution';

export type ExerciseEditorSaveInput = {
  bodyweightContribution?: number;
  name: string;
  loadInputMode: EditorLoadInputMode;
  mappings: EditorMapping[];
};

const createRowId = () => `muscle-link-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The exercise editor's form state. Opening, or a different exercise or
 * prefill, fills the form in the render that shows it — not in an effect, so
 * the autofocused name field never shows stale values.
 */
export function useExerciseEditorForm({ visible, editingExercise, prefill, onRequestClose, onSaved, onSave }: {
  visible: boolean;
  editingExercise: ExerciseCatalogExercise | null;
  prefill: ExerciseEditorPrefill | null;
  onRequestClose: () => void;
  onSaved: (exercise: ExerciseCatalogExercise) => void;
  onSave?: (input: ExerciseEditorSaveInput) => Promise<ExerciseCatalogExercise>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [muscleSelectorMode, setMuscleSelectorMode] = useState<MuscleSelectorMode>(null);
  const [exerciseName, setExerciseName] = useState('');
  const [bodyweightContributionField, setBodyweightContributionField] = useState<BodyweightContributionFieldValue>({ percentage: '0' });
  const [bodyweightContributionError, setBodyweightContributionError] = useState<string | null>(null);
  const [loadInputMode, setLoadInputMode] = useState<EditorLoadInputMode>('total_load');
  const [primaryMuscleGroupId, setPrimaryMuscleGroupId] = useState<string | null>(null);
  const [secondaryMuscleRows, setSecondaryMuscleRows] = useState<EditableSecondaryMuscleRow[]>([]);
  const [validation, setValidation] = useState<EditorValidationState>(createBlankValidationState);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [shownFor, setShownFor] = useState<{
    visible: boolean;
    editingExercise: typeof editingExercise;
    prefill: typeof prefill;
  } | null>(null);
  if (
    !shownFor ||
    shownFor.visible !== visible ||
    shownFor.editingExercise !== editingExercise ||
    shownFor.prefill !== prefill
  ) {
    setShownFor({ visible, editingExercise, prefill });
    if (visible) {
      const open = editorOpenState(editingExercise, prefill);
      setExerciseName(open.name);
      setLoadInputMode(open.loadInputMode);
      setPrimaryMuscleGroupId(open.primaryMuscleGroupId);
      setSecondaryMuscleRows(open.secondaryMuscleRows);
      setBodyweightContributionField({ percentage: open.contributionPercentage });
      setBodyweightContributionError(null);
      setMuscleSelectorMode(null);
      setValidation(createBlankValidationState());
      setSaveError(null);
    }
  }

  const selectedSecondaryMuscleIds = new Set(secondaryMuscleRows.map((row) => row.muscleGroupId));

  const openMuscleSelector = (mode: Exclude<MuscleSelectorMode, null>) => {
    Keyboard.dismiss();
    setMuscleSelectorMode(mode);
  };

  const close = () => {
    if (isSaving) {
      return;
    }
    setMuscleSelectorMode(null);
    setSaveError(null);
    onRequestClose();
  };

  const selectPrimaryMuscle = (muscleGroupId: string) => {
    setPrimaryMuscleGroupId(muscleGroupId);
    setSecondaryMuscleRows((current) => current.filter((row) => row.muscleGroupId !== muscleGroupId));
    setValidation((current) => ({ ...current, primaryMuscleError: null, secondaryMusclesError: null }));
    setMuscleSelectorMode(null);
    setSaveError(null);
  };

  const addSecondaryMuscle = (muscleGroupId: string) => {
    if (muscleGroupId === primaryMuscleGroupId || selectedSecondaryMuscleIds.has(muscleGroupId)) {
      return;
    }
    setSecondaryMuscleRows((current) => [...current, { rowId: createRowId(), muscleGroupId }]);
    setValidation((current) => ({ ...current, secondaryMusclesError: null }));
    setMuscleSelectorMode(null);
    setSaveError(null);
  };

  const removeSecondaryMuscle = (rowId: string) => {
    setSecondaryMuscleRows((current) => current.filter((row) => row.rowId !== rowId));
    setValidation((current) => (current.secondaryMusclesError === null ? current : { ...current, secondaryMusclesError: null }));
    setSaveError(null);
  };

  const changeName = (nextValue: string) => {
    setExerciseName(nextValue);
    if (validation.nameError) {
      setValidation((current) => ({ ...current, nameError: null }));
    }
    setSaveError(null);
  };

  const changeContribution = (value: BodyweightContributionFieldValue) => {
    setBodyweightContributionField(value);
    setBodyweightContributionError(null);
  };

  const save = async () => {
    setValidation(createBlankValidationState());
    setSaveError(null);
    const checked = validateEditorInput({ name: exerciseName, loadInputMode, primaryMuscleGroupId, secondaryMuscleRows });
    setValidation(checked.validation);
    if (!checked.mappings) {
      return;
    }
    const contribution = validateBodyweightContribution(parseBodyweightPercentage(bodyweightContributionField.percentage) / 100);
    if (!contribution.ok) {
      setBodyweightContributionError(contribution.message);
      return;
    }
    setBodyweightContributionError(null);
    Keyboard.dismiss();
    setIsSaving(true);
    try {
      const input = { bodyweightContribution: contribution.value, name: exerciseName, loadInputMode, mappings: checked.mappings };
      const savedExercise = onSave
        ? await onSave(input)
        : await saveExerciseCatalogExercise({ id: editingExercise?.id ?? undefined, ...input });
      onSaved(savedExercise);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save exercise.');
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isSaving,
    muscleSelectorMode,
    exerciseName,
    bodyweightContributionField,
    bodyweightContributionError,
    loadInputMode,
    primaryMuscleGroupId,
    secondaryMuscleRows,
    selectedSecondaryMuscleIds,
    validation,
    saveError,
    setLoadInputMode,
    changeName,
    changeContribution,
    openMuscleSelector,
    closeMuscleSelector: () => setMuscleSelectorMode(null),
    selectPrimaryMuscle,
    addSecondaryMuscle,
    removeSecondaryMuscle,
    close,
    save,
  };
}
