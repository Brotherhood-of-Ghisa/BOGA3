import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { uiColors } from '@/components/ui';
import {
  listExerciseCatalogMuscleGroups,
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

type ExerciseEditorModalProps = {
  visible: boolean;
  editingExercise: ExerciseCatalogExercise | null;
  muscleGroups?: ExerciseCatalogMuscleGroup[];
  onRequestClose: () => void;
  onSaved: (exercise: ExerciseCatalogExercise) => void;
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
  muscleGroups: providedMuscleGroups,
  onRequestClose,
  onSaved,
}: ExerciseEditorModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMuscleGroups, setIsLoadingMuscleGroups] = useState(false);
  const [muscleGroupLoadError, setMuscleGroupLoadError] = useState<string | null>(null);
  const [loadedMuscleGroups, setLoadedMuscleGroups] = useState<ExerciseCatalogMuscleGroup[]>([]);
  const [muscleSelectorMode, setMuscleSelectorMode] = useState<MuscleSelectorMode>(null);
  const [exerciseName, setExerciseName] = useState('');
  const [primaryMuscleGroupId, setPrimaryMuscleGroupId] = useState<string | null>(null);
  const [secondaryMuscleRows, setSecondaryMuscleRows] = useState<EditableSecondaryMuscleRow[]>([]);
  const [validation, setValidation] = useState<EditorValidationState>(createBlankValidationState);
  const [saveError, setSaveError] = useState<string | null>(null);

  const muscleGroups = providedMuscleGroups ?? loadedMuscleGroups;
  const muscleGroupById = useMemo(
    () => new Map(muscleGroups.map((muscleGroup) => [muscleGroup.id, muscleGroup])),
    [muscleGroups]
  );

  useEffect(() => {
    if (!visible || providedMuscleGroups) {
      return;
    }

    let cancelled = false;
    setIsLoadingMuscleGroups(true);
    setMuscleGroupLoadError(null);

    void (async () => {
      try {
        const nextMuscleGroups = await listExerciseCatalogMuscleGroups();
        if (!cancelled) {
          setLoadedMuscleGroups(nextMuscleGroups);
        }
      } catch {
        if (!cancelled) {
          setMuscleGroupLoadError('Unable to load muscle groups right now.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMuscleGroups(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [providedMuscleGroups, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (editingExercise) {
      const nextSelections = buildEditorMuscleSelectionsFromExercise(editingExercise);
      setExerciseName(editingExercise.name);
      setPrimaryMuscleGroupId(nextSelections.primaryMuscleGroupId);
      setSecondaryMuscleRows(nextSelections.secondaryMuscleRows);
    } else {
      setExerciseName('');
      setPrimaryMuscleGroupId(null);
      setSecondaryMuscleRows([]);
    }

    setMuscleSelectorMode(null);
    setValidation(createBlankValidationState());
    setSaveError(null);
  }, [editingExercise, visible]);

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
  const editorTitle = editingExercise ? 'Edit Exercise' : 'Create Exercise';

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
    const trimmedName = exerciseName.trim();
    const nextValidation = createBlankValidationState();

    if (!trimmedName) {
      nextValidation.nameError = 'Exercise name is required.';
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
      const savedExercise = await saveExerciseCatalogExercise({
        id: editingExercise?.id ?? undefined,
        name: exerciseName,
        mappings: result.parsedMappings,
      });
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
                <Text style={styles.fieldLabel}>Exercise name</Text>
                <TextInput
                  accessibilityLabel="Exercise definition name"
                  autoFocus
                  placeholder="Exercise name"
                  style={[styles.input, validation.nameError ? styles.inputError : null]}
                  value={exerciseName}
                  onChangeText={(nextValue) => {
                    setExerciseName(nextValue);
                    if (validation.nameError) {
                      setValidation((current) => ({ ...current, nameError: null }));
                    }
                    setSaveError(null);
                  }}
                />
                {validation.nameError ? (
                  <Text selectable style={styles.errorText}>
                    {validation.nameError}
                  </Text>
                ) : null}

                <Text style={styles.fieldLabel}>Primary muscle</Text>
                <Pressable
                  accessibilityLabel="Open primary muscle selector"
                  style={[styles.pickerButton, validation.primaryMuscleError ? styles.inputError : null]}
                  onPress={() => setMuscleSelectorMode('primary')}>
                  <Text
                    numberOfLines={1}
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
                            <Text numberOfLines={1} style={styles.secondaryMuscleRowTitle}>
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
                    style={styles.addMuscleLinkButton}
                    onPress={() => setMuscleSelectorMode('secondary')}>
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

              <ScrollView contentContainerStyle={styles.selectorList} keyboardShouldPersistTaps="handled">
                {selectorOptions.map((muscleGroup) => (
                  <Pressable
                    key={muscleGroup.id}
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
                      <Text numberOfLines={1} style={styles.selectorListRowTitle}>
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
    padding: 16,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  modalCard: {
    height: '80%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 14,
    gap: 12,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  centeredBodyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    gap: 10,
    paddingBottom: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: uiColors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  inputError: {
    borderColor: uiColors.actionDanger,
  },
  list: {
    gap: 8,
  },
  helperText: {
    fontSize: 13,
    color: uiColors.textSecondary,
  },
  errorText: {
    fontSize: 13,
    color: uiColors.actionDanger,
    fontWeight: '500',
  },
  pickerButton: {
    borderWidth: 1,
    borderColor: uiColors.borderDefault,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickerButtonText: {
    flex: 1,
    minWidth: 0,
    color: uiColors.textPrimary,
    fontWeight: '600',
    fontSize: 13,
  },
  pickerButtonPlaceholder: {
    flex: 1,
    minWidth: 0,
    color: uiColors.textSecondary,
    fontSize: 13,
  },
  pickerButtonChevron: {
    color: uiColors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryMuscleRow: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: 10,
    backgroundColor: uiColors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  secondaryMuscleRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secondaryMuscleLabelCell: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  secondaryMuscleRowTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  secondaryMuscleRowFamily: {
    fontSize: 11,
    color: uiColors.textSecondary,
  },
  removeButton: {
    borderRadius: 8,
    backgroundColor: uiColors.actionDanger,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  removeButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
    fontSize: 12,
  },
  addMuscleLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addMuscleLinkButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.actionPrimary,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 38,
    justifyContent: 'center',
  },
  addMuscleLinkButtonText: {
    color: uiColors.actionPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
  modalFooterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: uiColors.actionPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 42,
  },
  primaryButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
  selectorOverlayLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    padding: 12,
  },
  selectorOverlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrimSoft,
    borderRadius: 14,
  },
  selectorOverlayCard: {
    height: '80%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 14,
    gap: 10,
  },
  selectorList: {
    gap: 8,
    paddingBottom: 4,
  },
  selectorListRow: {
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    borderRadius: 8,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectorListRowTextStack: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  selectorListRowTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: uiColors.textPrimary,
  },
  selectorListRowMeta: {
    fontSize: 11,
    color: uiColors.textSecondary,
  },
  selectorListRowAction: {
    fontSize: 12,
    fontWeight: '700',
    color: uiColors.actionPrimary,
  },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: uiColors.textSecondary,
    backgroundColor: uiColors.surfaceDefault,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 42,
    flex: 1,
  },
  secondaryButtonText: {
    color: uiColors.textSecondary,
    fontWeight: '600',
  },
});
