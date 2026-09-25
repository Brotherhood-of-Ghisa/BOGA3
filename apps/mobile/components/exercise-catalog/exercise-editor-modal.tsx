import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ExerciseCoreFields } from '@/components/exercise-core/exercise-core-fields';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { Notice } from '@/components/ui/notice';
import { Sheet } from '@/components/ui/sheet';
import { StatePanel } from '@/components/ui/state-panel';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
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

// The editor is a tall sheet: its body keeps this share of the window, and
// shrinks with the sheet when the keyboard is up (as the exercise picker's).
const EDITOR_SHARE_OF_SCREEN = 0.8;

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

  const { height } = useWindowDimensions();
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

  const isSelectorOpen = muscleSelectorMode !== null;

  return (
    <Sheet
      dismissLabel="Dismiss exercise editor overlay"
      headerLeading={
        isSelectorOpen ? (
          <IconButton
            accessibilityLabel="Back to exercise"
            name="chevron-left"
            onPress={() => setMuscleSelectorMode(null)}
            testID="exercise-editor-muscle-selector-back"
          />
        ) : undefined
      }
      keyboardAvoiding
      onDismiss={closeEditorModal}
      testID="exercise-editor"
      title={isSelectorOpen ? selectorTitle : editorTitle}
      visible={visible}>
      <View style={[styles.body, { height: height * EDITOR_SHARE_OF_SCREEN }]}>
        {isLoadingMuscleGroups ? <StatePanel body="Loading muscle groups…" kind="loading" /> : null}

        {!isLoadingMuscleGroups && muscleGroupLoadError ? (
          <StatePanel body={muscleGroupLoadError} kind="error" />
        ) : null}

        {!isLoadingMuscleGroups && !muscleGroupLoadError ? (
          <>
            {/* Hidden, not unmounted, while the selector panel shows: the name
                field keeps its value and does not autofocus again on return. */}
            <View style={isSelectorOpen ? styles.hidden : styles.panel}>
              <ScrollView
                contentContainerStyle={styles.formContent}
                keyboardShouldPersistTaps="handled"
                style={styles.panel}>
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

                <View style={styles.group}>
                  <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
                    Primary muscle
                  </Text>
                  <View style={[styles.triggerFrame, validation.primaryMuscleError ? styles.triggerFrameInvalid : null]}>
                    <ListRow
                      accessibilityLabel="Open primary muscle selector"
                      density="list"
                      divider={false}
                      label={primaryMuscleGroupId ? getMuscleDisplayName(primaryMuscleGroupId, muscleGroupById) : undefined}
                      meta={
                        primaryMuscleGroupId ? (
                          <Text allowFontScaling={false} numberOfLines={1} style={styles.metaText}>
                            {muscleGroupById.get(primaryMuscleGroupId)?.familyName ?? ''}
                          </Text>
                        ) : undefined
                      }
                      onPress={() => openMuscleSelector('primary')}
                      testID="exercise-editor-primary-muscle-trigger"
                      trailing={<Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />}>
                      {primaryMuscleGroupId ? null : (
                        // Faint until chosen, as a field's placeholder is.
                        <Text allowFontScaling={false} numberOfLines={1} style={styles.triggerPlaceholder}>
                          Select primary muscle
                        </Text>
                      )}
                    </ListRow>
                  </View>
                  {validation.primaryMuscleError ? (
                    <Text allowFontScaling={false} accessibilityLiveRegion="polite" selectable style={styles.errorText}>
                      {validation.primaryMuscleError}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.group}>
                  <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
                    Secondary muscles
                  </Text>
                  {secondaryMuscleRows.length > 0 ? (
                    <Card>
                      {secondaryMuscleRows.map((row, index) => {
                        const muscleGroup = muscleGroupById.get(row.muscleGroupId);
                        const displayName = muscleGroup?.displayName ?? row.muscleGroupId;
                        return (
                          <ListRow
                            density="list"
                            divider={index > 0}
                            key={row.rowId}
                            label={displayName}
                            meta={
                              <Text allowFontScaling={false} numberOfLines={1} style={styles.metaText}>
                                {muscleGroup?.familyName ?? 'Unknown'}
                              </Text>
                            }
                            trailing={
                              <IconButton
                                accessibilityLabel={`Remove secondary muscle ${displayName}`}
                                name="x"
                                onPress={() => removeSecondaryMuscle(row.rowId)}
                                size="sm"
                                tone="danger"
                              />
                            }
                          />
                        );
                      })}
                    </Card>
                  ) : (
                    <Text allowFontScaling={false} selectable style={styles.helperText}>
                      No secondary muscles selected.
                    </Text>
                  )}
                  {validation.secondaryMusclesError ? (
                    <Text allowFontScaling={false} accessibilityLiveRegion="polite" selectable style={styles.errorText}>
                      {validation.secondaryMusclesError}
                    </Text>
                  ) : null}
                  <View style={styles.addSecondary}>
                    <ActionButton
                      accessibilityLabel="Open secondary muscle selector"
                      label="Add secondary muscle"
                      onPress={() => openMuscleSelector('secondary')}
                      testID="exercise-editor-secondary-muscle-trigger"
                      variant="outline"
                    />
                  </View>
                </View>
              </ScrollView>

              <View style={styles.footer}>
                <ActionButton
                  accessibilityLabel="Save exercise definition"
                  disabled={isSaving}
                  label={isSaving ? 'Saving…' : 'Save Exercise'}
                  onPress={saveEditor}
                  variant="primary"
                />
                {saveError ? <Notice live message={saveError} testID="exercise-editor-save-error" tone="danger" /> : null}
              </View>
            </View>

            {isSelectorOpen ? (
              <ScrollView
                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                contentContainerStyle={styles.selectorContent}
                contentInsetAdjustmentBehavior="automatic"
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                style={styles.panel}
                testID="exercise-editor-muscle-selector-list">
                {selectorOptions.map((muscleGroup, index) => {
                  const isCurrent = muscleSelectorMode === 'primary' && muscleGroup.id === primaryMuscleGroupId;
                  return (
                    <ListRow
                      accessibilityLabel={`${
                        muscleSelectorMode === 'primary' ? 'Select primary muscle' : 'Select secondary muscle'
                      } ${muscleGroup.displayName}`}
                      divider={index > 0}
                      key={muscleGroup.id}
                      label={muscleGroup.displayName}
                      leading={
                        <Icon
                          color={isCurrent ? uiRoles.accent : uiRoles.inkMuted}
                          name={muscleSelectorMode === 'primary' ? (isCurrent ? 'radio-on' : 'radio-off') : 'plus'}
                          size="md"
                        />
                      }
                      meta={
                        <Text allowFontScaling={false} numberOfLines={1} style={styles.metaText}>
                          {muscleGroup.familyName}
                        </Text>
                      }
                      onPress={() => {
                        if (muscleSelectorMode === 'primary') {
                          selectPrimaryMuscle(muscleGroup.id);
                          return;
                        }

                        addSecondaryMuscle(muscleGroup.id);
                      }}
                      selected={isCurrent}
                      testID={`exercise-editor-muscle-option-${muscleGroup.id}`}
                    />
                  );
                })}
                {selectorOptions.length === 0 ? (
                  <StatePanel
                    body={
                      muscleSelectorMode === 'primary'
                        ? 'No primary muscle options available.'
                        : 'All available muscle groups are already selected as primary or secondary.'
                    }
                    fill={false}
                  />
                ) : null}
              </ScrollView>
            ) : null}
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // A tall body that shrinks with the sheet when the keyboard is up.
  body: {
    flexShrink: 1,
  },
  panel: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  formContent: {
    gap: uiSpace.lg,
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.lg,
  },
  group: {
    gap: uiSpace.sm,
  },
  sectionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  // The primary-muscle trigger is framed like a field (`FormField`): a
  // `rule-strong` hairline at the control radius that turns `danger` when
  // the choice is missing.
  triggerFrame: {
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleStrong,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.surface,
  },
  triggerFrameInvalid: {
    borderColor: uiRoles.danger,
  },
  triggerPlaceholder: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.inkFaint,
  },
  metaText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  addSecondary: {
    alignSelf: 'flex-start',
  },
  helperText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  errorText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.danger,
  },
  footer: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.md,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  selectorContent: {
    paddingBottom: uiSpace.lg,
  },
});
