import { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseCoreFields } from '@/components/exercise-core/exercise-core-fields';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { Notice } from '@/components/ui/notice';
import { PageSheet } from '@/components/ui/page-sheet';
import { StatePanel } from '@/components/ui/state-panel';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useBodyweightCalculationsEnabled } from '@/src/bodyweight/calculation-preference';
import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import {
  muscleSelectorOptions,
  type EditableSecondaryMuscleRow,
  type ExerciseEditorPrefill,
} from '@/src/exercise-catalog/editor-model';

import { useExerciseEditorForm, type ExerciseEditorSaveInput } from './use-exercise-editor-form';

export type { ExerciseEditorPrefill } from '@/src/exercise-catalog/editor-model';
export type { ExerciseEditorSaveInput } from './use-exercise-editor-form';

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

type MuscleGroupLookup = Map<string, ExerciseCatalogMuscleGroup>;

export function ExerciseEditorModal({
  visible,
  editingExercise,
  onRequestClose,
  onSaved,
  prefill = null,
  onSave,
  title,
}: ExerciseEditorModalProps) {
  const form = useExerciseEditorForm({ visible, editingExercise, prefill, onRequestClose, onSaved, onSave });
  const isSelectorOpen = form.muscleSelectorMode !== null;
  const selectorTitle = form.muscleSelectorMode === 'primary' ? 'Select primary muscle' : 'Add secondary muscle';
  const editorTitle = title ?? (editingExercise ? 'Edit Exercise' : 'Create Exercise');

  // A sub-page (`ux-rules.md` "Sheets"): swipe down or X to leave without
  // saving, except while a save is in flight.
  return (
    <PageSheet
      closeLabel="Close exercise editor"
      dismissDisabled={form.isSaving}
      headerLeading={
        isSelectorOpen ? (
          <IconButton
            accessibilityLabel="Back to exercise"
            name="chevron-left"
            onPress={form.closeMuscleSelector}
            testID="exercise-editor-muscle-selector-back"
          />
        ) : undefined
      }
      keyboardAvoiding
      onDismiss={form.close}
      testID="exercise-editor"
      title={isSelectorOpen ? selectorTitle : editorTitle}
      visible={visible}>
      <EditorBody form={form} />
    </PageSheet>
  );
}

type EditorForm = ReturnType<typeof useExerciseEditorForm>;

/** The form and the muscle selector once the muscle groups have loaded; a state panel until then. */
function EditorBody({ form }: { form: EditorForm }) {
  const bodyweightCalculationsEnabled = useBodyweightCalculationsEnabled();
  const catalog = useExerciseCatalog();
  const muscleGroups = catalog.muscleGroups;
  const muscleGroupById = useMemo(
    () => new Map(muscleGroups.map((muscleGroup) => [muscleGroup.id, muscleGroup])),
    [muscleGroups]
  );
  if (catalog.status === 'idle' || catalog.status === 'loading') {
    return <StatePanel body="Loading muscle groups…" kind="loading" />;
  }
  if (catalog.status === 'error') {
    return <StatePanel body={catalog.lastError ?? 'Unable to load muscle groups right now.'} kind="error" />;
  }

  const mode = form.muscleSelectorMode;
  return (
    <>
      {/* Hidden, not unmounted, while the selector panel shows: the name
          field keeps its value and does not autofocus again on return. */}
      <View style={mode ? styles.hidden : styles.panel}>
        <ScrollView
          contentContainerStyle={styles.formContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={styles.panel}>
          <ExerciseCoreFields
            autoFocus
            loadInputMode={form.loadInputMode}
            bodyweightContribution={bodyweightCalculationsEnabled ? {
              value: form.bodyweightContributionField,
              error: form.bodyweightContributionError,
              onChange: form.changeContribution,
            } : undefined}
            name={form.exerciseName}
            nameError={form.validation.nameError}
            onChangeLoadInputMode={form.setLoadInputMode}
            onChangeName={form.changeName}
            testIDPrefix="exercise-editor"
          />
          <PrimaryMuscleField
            error={form.validation.primaryMuscleError}
            muscleGroupById={muscleGroupById}
            onOpen={() => form.openMuscleSelector('primary')}
            primaryMuscleGroupId={form.primaryMuscleGroupId}
          />
          <SecondaryMusclesField
            error={form.validation.secondaryMusclesError}
            muscleGroupById={muscleGroupById}
            onOpen={() => form.openMuscleSelector('secondary')}
            onRemove={form.removeSecondaryMuscle}
            rows={form.secondaryMuscleRows}
          />
        </ScrollView>

        <View style={styles.footer}>
          <ActionButton
            accessibilityLabel="Save exercise definition"
            disabled={form.isSaving}
            label={form.isSaving ? 'Saving…' : 'Save Exercise'}
            onPress={form.save}
            variant="primary"
          />
          {form.saveError ? <Notice live message={form.saveError} testID="exercise-editor-save-error" tone="danger" /> : null}
        </View>
      </View>

      {mode ? (
        <MuscleSelectorList
          mode={mode}
          onPick={(muscleGroupId) => (mode === 'primary' ? form.selectPrimaryMuscle(muscleGroupId) : form.addSecondaryMuscle(muscleGroupId))}
          options={muscleSelectorOptions(mode, muscleGroups, form.primaryMuscleGroupId, form.selectedSecondaryMuscleIds)}
          primaryMuscleGroupId={form.primaryMuscleGroupId}
        />
      ) : null}
    </>
  );
}

function FieldError({ message }: { message: string | null }) {
  return message ? (
    <Text allowFontScaling={false} accessibilityLiveRegion="polite" selectable style={styles.errorText}>
      {message}
    </Text>
  ) : null;
}

function PrimaryMuscleField({ primaryMuscleGroupId, muscleGroupById, error, onOpen }: {
  primaryMuscleGroupId: string | null;
  muscleGroupById: MuscleGroupLookup;
  error: string | null;
  onOpen: () => void;
}) {
  const muscleGroup = primaryMuscleGroupId ? muscleGroupById.get(primaryMuscleGroupId) : undefined;
  return (
    <View style={styles.group}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
        Primary muscle
      </Text>
      <View style={[styles.triggerFrame, error ? styles.triggerFrameInvalid : null]}>
        <ListRow
          accessibilityLabel="Open primary muscle selector"
          density="list"
          divider={false}
          label={primaryMuscleGroupId ? muscleGroup?.displayName ?? primaryMuscleGroupId : undefined}
          meta={
            primaryMuscleGroupId ? (
              <Text allowFontScaling={false} numberOfLines={1} style={styles.metaText}>
                {muscleGroup?.familyName ?? ''}
              </Text>
            ) : undefined
          }
          onPress={onOpen}
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
      <FieldError message={error} />
    </View>
  );
}

function SecondaryMusclesField({ rows, muscleGroupById, error, onOpen, onRemove }: {
  rows: EditableSecondaryMuscleRow[];
  muscleGroupById: MuscleGroupLookup;
  error: string | null;
  onOpen: () => void;
  onRemove: (rowId: string) => void;
}) {
  return (
    <View style={styles.group}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
        Secondary muscles
      </Text>
      {rows.length > 0 ? (
        <Card>
          {rows.map((row, index) => {
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
                    onPress={() => onRemove(row.rowId)}
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
      <FieldError message={error} />
      <View style={styles.addSecondary}>
        <ActionButton
          accessibilityLabel="Open secondary muscle selector"
          label="Add secondary muscle"
          onPress={onOpen}
          testID="exercise-editor-secondary-muscle-trigger"
          variant="outline"
        />
      </View>
    </View>
  );
}

function MuscleSelectorList({ mode, options, primaryMuscleGroupId, onPick }: {
  mode: 'primary' | 'secondary';
  options: ExerciseCatalogMuscleGroup[];
  primaryMuscleGroupId: string | null;
  onPick: (muscleGroupId: string) => void;
}) {
  const isPrimary = mode === 'primary';
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      contentContainerStyle={styles.selectorContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={styles.panel}
      testID="exercise-editor-muscle-selector-list">
      {options.map((muscleGroup, index) => {
        const isCurrent = isPrimary && muscleGroup.id === primaryMuscleGroupId;
        return (
          <ListRow
            accessibilityLabel={`${isPrimary ? 'Select primary muscle' : 'Select secondary muscle'} ${muscleGroup.displayName}`}
            divider={index > 0}
            key={muscleGroup.id}
            label={muscleGroup.displayName}
            leading={
              <Icon
                color={isCurrent ? uiRoles.accent : uiRoles.inkMuted}
                name={isPrimary ? (isCurrent ? 'radio-on' : 'radio-off') : 'plus'}
                size="md"
              />
            }
            meta={
              <Text allowFontScaling={false} numberOfLines={1} style={styles.metaText}>
                {muscleGroup.familyName}
              </Text>
            }
            onPress={() => onPick(muscleGroup.id)}
            selected={isCurrent}
            testID={`exercise-editor-muscle-option-${muscleGroup.id}`}
          />
        );
      })}
      {options.length === 0 ? (
        <StatePanel
          body={
            isPrimary
              ? 'No primary muscle options available.'
              : 'All available muscle groups are already selected as primary or secondary.'
          }
          fill={false}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  // `rule` hairline at the control radius that turns `danger` when
  // the choice is missing.
  triggerFrame: {
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
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
