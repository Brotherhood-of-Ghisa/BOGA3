import { useEffect, useMemo, useState } from 'react';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ExerciseCoreFields } from '@/components/exercise-core/exercise-core-fields';
import { uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
import { validateExerciseCore } from '@/src/exercise-core';
import {
  saveExerciseCatalogExercise,
  type ExerciseCatalogExercise,
  type ExerciseCatalogExerciseMuscleMapping,
  type ExerciseCatalogMuscleGroup,
} from '@/src/data/exercise-catalog';

type EditableSecondaryMuscleRow = {
  rowId: string;
  muscleGroupId: string;
};

type EditorValidationState = {
  nameError: string | null;
  primaryMuscleError: string | null;
  secondaryMusclesError: string | null;
};

type MuscleSelectorMode = 'primary' | 'secondary' | null;

/** Initial values for a new exercise (M25-T07 "Add as new" from a group exercise). */
export type ExerciseEditorPrefill = {
  name: string;
  loadInputMode: 'total_load' | 'per_side_load';
  mappings: Pick<ExerciseCatalogExerciseMuscleMapping, 'muscleGroupId' | 'weight' | 'role'>[];
};

export type ExerciseEditorSaveInput = {
  name: string;
  loadInputMode: 'total_load' | 'per_side_load';
  mappings: { muscleGroupId: string; weight: number; role: ExerciseCatalogExerciseMuscleMapping['role'] }[];
};

type ExerciseEditorModalProps = {
  visible: boolean;
  editingExercise: ExerciseCatalogExercise | null;
  onRequestClose: () => void;
  onSaved: (exercise: ExerciseCatalogExercise) => void;
  /** Prefills a new exercise (ignored while `editingExercise` is set). */
  prefill?: ExerciseEditorPrefill | null;
  /** Replaces the default save (`saveExerciseCatalogExercise`); a rejection shows inline like any save error. */
  onSave?: (input: ExerciseEditorSaveInput) => Promise<ExerciseCatalogExercise>;
  title?: string;
};

const PRIMARY_MUSCLE_WEIGHT = 1;
const SECONDARY_MUSCLE_WEIGHT = 0.5;

const createRowId = () => `muscle-link-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createBlankValidationState = (): EditorValidationState => ({
  nameError: null,
  primaryMuscleError: null,
  secondaryMusclesError: null,
});

const getMuscleDisplayName = (
  muscleGroupId: string,
  muscleGroupById: Map<string, ExerciseCatalogMuscleGroup>
) => muscleGroupById.get(muscleGroupId)?.displayName ?? muscleGroupId;

const pickPrimaryMapping = (exercise: ExerciseCatalogExercise) =>
  exercise.mappings.find((mapping) => mapping.role === 'primary') ??
  [...exercise.mappings].sort((left, right) => right.weight - left.weight)[0] ??
  null;

const buildEditorMuscleSelectionsFromExercise = (
  exercise: ExerciseCatalogExercise
): { primaryMuscleGroupId: string | null; secondaryMuscleRows: EditableSecondaryMuscleRow[] } => {
  const primaryMapping = pickPrimaryMapping(exercise);
  const primaryMuscleGroupId = primaryMapping?.muscleGroupId ?? null;
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
      rowId: mapping.id || createRowId(),
      muscleGroupId: mapping.muscleGroupId,
    }));

  return {
    primaryMuscleGroupId,
    secondaryMuscleRows,
  };
};

export function ExerciseEditorModal({
  visible,
  editingExercise,
  onRequestClose,
  onSaved,
  prefill = null,
  onSave,
  title,
}: ExerciseEditorModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [muscleSelectorMode, setMuscleSelectorMode] = useState<MuscleSelectorMode>(null);
  const [exerciseName, setExerciseName] = useState('');
  const [loadInputMode, setLoadInputMode] = useState<'total_load' | 'per_side_load'>('total_load');
  const [primaryMuscleGroupId, setPrimaryMuscleGroupId] = useState<string | null>(null);
  const [secondaryMuscleRows, setSecondaryMuscleRows] = useState<EditableSecondaryMuscleRow[]>([]);
  const [validation, setValidation] = useState<EditorValidationState>(createBlankValidationState);
  const [saveError, setSaveError] = useState<string | null>(null);

  const catalog = useExerciseCatalog();
  const muscleGroups = catalog.muscleGroups;
  const isLoadingMuscleGroups = catalog.status === 'idle' || catalog.status === 'loading';
  const muscleGroupLoadError =
    catalog.status === 'error'
      ? catalog.lastError ?? 'Unable to load muscle groups right now.'
      : null;
  const muscleGroupById = useMemo(
    () => new Map(muscleGroups.map((muscleGroup) => [muscleGroup.id, muscleGroup])),
    [muscleGroups]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (editingExercise) {
      const nextSelections = buildEditorMuscleSelectionsFromExercise(editingExercise);
      setExerciseName(editingExercise.name);
      setLoadInputMode(editingExercise.loadInputMode ?? 'total_load');
      setPrimaryMuscleGroupId(nextSelections.primaryMuscleGroupId);
      setSecondaryMuscleRows(nextSelections.secondaryMuscleRows);
    } else if (prefill) {
      const nextSelections = buildEditorMuscleSelectionsFromExercise({
        id: '',
        name: prefill.name,
        loadInputMode: prefill.loadInputMode,
        deletedAt: null,
        mappings: prefill.mappings.map((mapping) => ({ ...mapping, id: '' })),
      });
      setExerciseName(prefill.name);
      setLoadInputMode(prefill.loadInputMode);
      setPrimaryMuscleGroupId(nextSelections.primaryMuscleGroupId);
      setSecondaryMuscleRows(nextSelections.secondaryMuscleRows);
    } else {
      setExerciseName('');
      setLoadInputMode('total_load');
      setPrimaryMuscleGroupId(null);
      setSecondaryMuscleRows([]);
    }

    setMuscleSelectorMode(null);
    setValidation(createBlankValidationState());
    setSaveError(null);
  }, [editingExercise, prefill, visible]);

  const selectedSecondaryMuscleIds = new Set(secondaryMuscleRows.map((row) => row.muscleGroupId));
  const availablePrimaryMuscleGroupsForSelector = muscleGroups.filter(
    (muscleGroup) =>
      muscleGroup.id === primaryMuscleGroupId || !selectedSecondaryMuscleIds.has(muscleGroup.id)
  );
  const availableSecondaryMuscleGroupsForSelector = muscleGroups.filter(
    (muscleGroup) =>
      muscleGroup.id !== primaryMuscleGroupId && !selectedSecondaryMuscleIds.has(muscleGroup.id)
  );
  const selectorOptions =
    muscleSelectorMode === 'primary' ? availablePrimaryMuscleGroupsForSelector : availableSecondaryMuscleGroupsForSelector;
  const selectorTitle = muscleSelectorMode === 'primary' ? 'Select primary muscle' : 'Add secondary muscle';
  const editorTitle = title ?? (editingExercise ? 'Edit Exercise' : 'Create Exercise');

  const openMuscleSelector = (mode: Exclude<MuscleSelectorMode, null>) => {
    Keyboard.dismiss();
    setMuscleSelectorMode(mode);
  };

  const closeEditorModal = () => {
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
    setValidation((current) => ({
      ...current,
      primaryMuscleError: null,
      secondaryMusclesError: null,
    }));
    setMuscleSelectorMode(null);
    setSaveError(null);
  };

  const addSecondaryMuscle = (muscleGroupId: string) => {
    if (muscleGroupId === primaryMuscleGroupId || selectedSecondaryMuscleIds.has(muscleGroupId)) {
      return;
    }

    setSecondaryMuscleRows((current) => [
      ...current,
      {
        rowId: createRowId(),
        muscleGroupId,
      },
    ]);
    setValidation((current) => ({
      ...current,
      secondaryMusclesError: null,
    }));
    setMuscleSelectorMode(null);
    setSaveError(null);
  };

  const removeSecondaryMuscle = (rowId: string) => {
    setSecondaryMuscleRows((current) => current.filter((row) => row.rowId !== rowId));
    setValidation((current) => {
      if (current.secondaryMusclesError === null) {
        return current;
      }

      return {
        ...current,
        secondaryMusclesError: null,
      };
    });
    setSaveError(null);
  };

  const validateEditor = ():
    | {
        ok: true;
        parsedMappings: { muscleGroupId: string; weight: number; role: ExerciseCatalogExerciseMuscleMapping['role'] }[];
      }
    | { ok: false } => {
    const nextValidation = createBlankValidationState();

    // The shared ExerciseCore rules (same validator as group exercises and `saveExercise`).
    const core = validateExerciseCore({ name: exerciseName, loadInputMode });
    if (!core.ok && core.issue === 'name_required') {
      nextValidation.nameError = core.message;
    }

    if (!primaryMuscleGroupId) {
      nextValidation.primaryMuscleError = 'Select a primary muscle before saving.';
    }

    const parsedMappings: { muscleGroupId: string; weight: number; role: ExerciseCatalogExerciseMuscleMapping['role'] }[] = [];
    const seenMuscleIds = new Set<string>();

    if (primaryMuscleGroupId) {
      seenMuscleIds.add(primaryMuscleGroupId);
      parsedMappings.push({
        muscleGroupId: primaryMuscleGroupId,
        weight: PRIMARY_MUSCLE_WEIGHT,
        role: 'primary',
      });
    }

    for (const row of secondaryMuscleRows) {
      if (seenMuscleIds.has(row.muscleGroupId)) {
        nextValidation.secondaryMusclesError = 'Duplicate secondary muscle.';
        continue;
      }

      seenMuscleIds.add(row.muscleGroupId);
      parsedMappings.push({
        muscleGroupId: row.muscleGroupId,
        weight: SECONDARY_MUSCLE_WEIGHT,
        role: 'secondary',
      });
    }

    const hasErrors =
      nextValidation.nameError !== null ||
      nextValidation.primaryMuscleError !== null ||
      nextValidation.secondaryMusclesError !== null;

    setValidation(nextValidation);

    if (hasErrors) {
      return { ok: false };
    }

    return { ok: true, parsedMappings };
  };

  const saveEditor = async () => {
    setValidation(createBlankValidationState());
    setSaveError(null);

    const result = validateEditor();
    if (!result.ok) {
      return;
    }

    setIsSaving(true);
    try {
      const input = { name: exerciseName, loadInputMode, mappings: result.parsedMappings };
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

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={closeEditorModal}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          accessibilityLabel="Dismiss exercise editor overlay"
          style={styles.modalOverlay}
          onPress={closeEditorModal}
        />
        <View style={styles.modalCard}>
          <View style={styles.modalHeaderRow}>
            <Text selectable style={styles.modalTitle}>
              {editorTitle}
            </Text>
          </View>

          {isLoadingMuscleGroups ? (
            <View style={styles.centeredBodyState}>
              <Text style={styles.helperText}>Loading muscle groups...</Text>
            </View>
          ) : null}

          {!isLoadingMuscleGroups && muscleGroupLoadError ? (
            <View style={styles.centeredBodyState}>
              <Text style={styles.errorText}>{muscleGroupLoadError}</Text>
            </View>
          ) : null}

          {!isLoadingMuscleGroups && !muscleGroupLoadError ? (
            <>
              <ScrollView
                style={styles.modalScroll}
                contentInsetAdjustmentBehavior="automatic"
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled">
                <ExerciseCoreFields
                  autoFocus
                  loadInputMode={loadInputMode}
                  name={exerciseName}
                  nameError={validation.nameError}
                  onChangeLoadInputMode={setLoadInputMode}
                  onChangeName={(nextValue) => {
                    setExerciseName(nextValue);
                    if (validation.nameError) {
                      setValidation((current) => ({ ...current, nameError: null }));
                    }
                    setSaveError(null);
                  }}
                  testIDPrefix="exercise-editor"
                />

                <Text style={styles.fieldLabel}>Primary muscle</Text>
                <Pressable
                  accessibilityLabel="Open primary muscle selector"
                  testID="exercise-editor-primary-muscle-trigger"
                  style={[styles.pickerButton, validation.primaryMuscleError ? styles.inputError : null]}
                  onPress={() => openMuscleSelector('primary')}>
                  <Text
                    adjustsFontSizeToFit
                    ellipsizeMode="clip"
                    minimumFontScale={0.82}
                    numberOfLines={2}
                    style={primaryMuscleGroupId ? styles.pickerButtonText : styles.pickerButtonPlaceholder}>
                    {primaryMuscleGroupId
                      ? getMuscleDisplayName(primaryMuscleGroupId, muscleGroupById)
                      : 'Select primary muscle'}
                  </Text>
                  <Text style={styles.pickerButtonChevron}>▾</Text>
                </Pressable>
                {validation.primaryMuscleError ? (
                  <Text selectable style={styles.errorText}>
                    {validation.primaryMuscleError}
                  </Text>
                ) : null}

                <Text style={styles.fieldLabel}>Secondary muscles</Text>
                <View style={styles.list}>
                  {secondaryMuscleRows.map((row) => {
                    const muscleGroup = muscleGroupById.get(row.muscleGroupId);
                    return (
                      <View key={row.rowId} style={styles.secondaryMuscleRow}>
                        <View style={styles.secondaryMuscleRowControls}>
                          <View style={styles.secondaryMuscleLabelCell}>
                            <Text
                              adjustsFontSizeToFit
                              ellipsizeMode="clip"
                              minimumFontScale={0.82}
                              numberOfLines={2}
                              style={styles.secondaryMuscleRowTitle}>
                              {muscleGroup?.displayName ?? row.muscleGroupId}
                            </Text>
                            <Text numberOfLines={1} style={styles.secondaryMuscleRowFamily}>
                              {muscleGroup?.familyName ?? 'Unknown'}
                            </Text>
                          </View>
                          <Pressable
                            accessibilityLabel={`Remove secondary muscle ${muscleGroup?.displayName ?? row.muscleGroupId}`}
                            style={styles.removeButton}
                            onPress={() => removeSecondaryMuscle(row.rowId)}>
                            <Text style={styles.removeButtonText}>Remove</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}

                  {secondaryMuscleRows.length === 0 ? (
                    <Text selectable style={styles.helperText}>
                      No secondary muscles selected.
                    </Text>
                  ) : null}
                </View>
                {validation.secondaryMusclesError ? (
                  <Text selectable style={styles.errorText}>
                    {validation.secondaryMusclesError}
                  </Text>
                ) : null}

                <View style={styles.addMuscleLinkRow}>
                  <Pressable
                    accessibilityLabel="Open secondary muscle selector"
                    testID="exercise-editor-secondary-muscle-trigger"
                    style={styles.addMuscleLinkButton}
                    onPress={() => openMuscleSelector('secondary')}>
                    <Text style={styles.addMuscleLinkButtonText}>Add secondary muscle</Text>
                  </Pressable>
                </View>

                {saveError ? (
                  <Text selectable style={styles.errorText}>
                    {saveError}
                  </Text>
                ) : null}
              </ScrollView>

              <View style={styles.modalFooterRow}>
                <Pressable
                  accessibilityLabel="Save exercise definition"
                  style={styles.primaryButton}
                  disabled={isSaving}
                  onPress={saveEditor}>
                  <Text style={styles.primaryButtonText}>{isSaving ? 'Saving…' : 'Save Exercise'}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
        {muscleSelectorMode !== null ? (
          <View style={styles.selectorOverlayLayer}>
            <Pressable
              accessibilityLabel="Dismiss muscle link selector overlay"
              style={styles.selectorOverlayBackdrop}
              onPress={() => setMuscleSelectorMode(null)}
            />
            <View style={styles.selectorOverlayCard}>
              <View style={styles.modalHeaderRow}>
                <Text selectable style={styles.modalTitle}>
                  {selectorTitle}
                </Text>
              </View>

              <ScrollView
                testID="exercise-editor-muscle-selector-list"
                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                contentInsetAdjustmentBehavior="automatic"
                contentContainerStyle={styles.selectorList}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled">
                {selectorOptions.map((muscleGroup) => (
                  <Pressable
                    key={muscleGroup.id}
                    testID={`exercise-editor-muscle-option-${muscleGroup.id}`}
                    accessibilityLabel={`${
                      muscleSelectorMode === 'primary' ? 'Select primary muscle' : 'Select secondary muscle'
                    } ${muscleGroup.displayName}`}
                    style={styles.selectorListRow}
                    onPress={() => {
                      if (muscleSelectorMode === 'primary') {
                        selectPrimaryMuscle(muscleGroup.id);
                        return;
                      }

                      addSecondaryMuscle(muscleGroup.id);
                    }}>
                    <View style={styles.selectorListRowTextStack}>
                      <Text
                        adjustsFontSizeToFit
                        ellipsizeMode="clip"
                        minimumFontScale={0.82}
                        numberOfLines={2}
                        style={styles.selectorListRowTitle}>
                        {muscleGroup.displayName}
                      </Text>
                      <Text numberOfLines={1} style={styles.selectorListRowMeta}>
                        {muscleGroup.familyName}
                      </Text>
                    </View>
                    <Text style={styles.selectorListRowAction}>
                      {muscleSelectorMode === 'primary' ? 'Select' : 'Add'}
                    </Text>
                  </Pressable>
                ))}
                {selectorOptions.length === 0 ? (
                  <Text selectable style={styles.helperText}>
                    {muscleSelectorMode === 'primary'
                      ? 'No primary muscle options available.'
                      : 'All available muscle groups are already selected as primary or secondary.'}
                  </Text>
                ) : null}
              </ScrollView>

              <Pressable
                accessibilityLabel="Close muscle link selector"
                style={styles.secondaryButton}
                onPress={() => setMuscleSelectorMode(null)}>
                <Text style={styles.secondaryButtonText}>Done</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: uiSpace.lg,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  modalCard: {
    height: '80%',
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  modalTitle: {
    flex: 1,
    fontSize: uiTypography.size.xl,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  centeredBodyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: uiSpace.xl,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    gap: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
  fieldLabel: {
    fontSize: uiTypography.size.sm,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  inputError: {
    borderColor: uiColors.actionDanger,
  },
  list: {
    gap: uiSpace.sm,
  },
  helperText: {
    fontSize: uiTypography.size.md,
    color: uiColors.textSecondary,
  },
  errorText: {
    fontSize: uiTypography.size.md,
    color: uiColors.actionDanger,
    fontWeight: '500',
  },
  pickerButton: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    minHeight: 42,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  pickerButtonText: {
    flex: 1,
    minWidth: 0,
    color: uiColors.textPrimary,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
  },
  pickerButtonPlaceholder: {
    flex: 1,
    minWidth: 0,
    color: uiColors.textSecondary,
    fontSize: uiTypography.size.md,
  },
  pickerButtonChevron: {
    color: uiColors.textSecondary,
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
  },
  secondaryMuscleRow: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceMuted,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.sm,
  },
  secondaryMuscleRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  secondaryMuscleLabelCell: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  secondaryMuscleRowTitle: {
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  secondaryMuscleRowFamily: {
    fontSize: uiTypography.size.xs,
    color: uiColors.textSecondary,
  },
  removeButton: {
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.actionDanger,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  removeButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  addMuscleLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  addMuscleLinkButton: {
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    minHeight: 38,
    justifyContent: 'center',
  },
  addMuscleLinkButtonText: {
    color: uiColors.actionPrimary,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
  },
  modalFooterRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  primaryButton: {
    width: '100%',
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.actionPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: uiSpace.md,
    paddingHorizontal: uiSpace.md,
    minHeight: 42,
  },
  primaryButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  selectorOverlayLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    padding: uiSpace.md,
  },
  selectorOverlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrimSoft,
    borderRadius: uiRadius.md,
  },
  selectorOverlayCard: {
    height: '80%',
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  selectorList: {
    gap: uiSpace.sm,
    paddingBottom: uiSpace.xl,
  },
  selectorListRow: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.sm,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  selectorListRowTextStack: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  selectorListRowTitle: {
    fontSize: uiTypography.size.md,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  selectorListRowMeta: {
    fontSize: uiTypography.size.xs,
    color: uiColors.textSecondary,
  },
  selectorListRowAction: {
    fontSize: uiTypography.size.sm,
    fontWeight: '700',
    color: uiColors.actionPrimary,
  },
  secondaryButton: {
    borderRadius: uiRadius.sm,
    borderWidth: 1,
    borderColor: uiColors.textSecondary,
    backgroundColor: uiColors.surfaceDefault,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: uiSpace.md,
    paddingHorizontal: uiSpace.md,
    minHeight: 42,
    flex: 1,
  },
  secondaryButtonText: {
    color: uiColors.textSecondary,
    fontWeight: '600',
  },
});
