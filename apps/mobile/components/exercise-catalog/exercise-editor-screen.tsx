import { Stack, useNavigation, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { ExerciseNameField, ExerciseWeightSection } from '@/components/exercise-core/exercise-core-fields';
import {
  ActionButton,
  ChoiceRow,
  Icon,
  IconButton,
  InputRow,
  ListRow,
  Notice,
  Screen,
  ScreenScroll,
  Sheet,
  StatePanel,
  SwitchRow,
  FormSection,
  uiRoles,
  uiSpace,
  uiText,
  uiTextTone,
} from '@/components/ui';
import { useBodyweightCalculationsEnabled } from '@/src/bodyweight/calculation-preference';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import type { ReportedMuscle } from '@/src/data/muscle-analytics';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { muscleSelectorOptions } from '@/src/exercise-catalog/editor-model';
import { EMPTY_MUSCLE_SETUP } from '@/src/exercise-catalog/muscle-setup';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';

import type { ExerciseEditorRequest } from './exercise-editor-request';
import { ExerciseLinksSection } from './exercise-links-section';
import { useExerciseEditorForm } from './use-exercise-editor-form';

type EditorFormState = ReturnType<typeof useExerciseEditorForm>;

/**
 * The exercise editor, a page (`/exercise-edit`, `ux-rules.md` "Pages"): the
 * name, then Groups (links, the most frequent change), Muscles, Weight and
 * Options sections (`ux-rules.md` "Forms"), and Save. A muscle is chosen in
 * a picker sheet; Link opens the Link page over this one, so the form's
 * unsaved edits wait beneath it. Leaving by Back writes nothing.
 */
export function ExerciseEditorScreen({ request }: { request: ExerciseEditorRequest }) {
  const catalog = useExerciseCatalog();
  const editingId = request.exerciseDefinitionId ?? null;
  // Frozen at first sight, so a catalogue refresh never refills the form.
  const [editingExercise, setEditingExercise] = useState<ExerciseCatalogExercise | null>(null);
  const found = editingId && !editingExercise ? catalog.exercises.find((candidate) => candidate.id === editingId) : undefined;
  if (found && !found.deletedAt) setEditingExercise(found);

  const loading = catalog.status === 'idle' || catalog.status === 'loading';
  if (request.lost) {
    return <EditorState body="This edit is no longer open. Go back and start it again." kind="message" title="Edit exercise" />;
  }
  const title = editingExercise ? `Edit "${editingExercise.name}"` : request.title ?? 'New exercise';
  if (catalog.status === 'error') {
    return <EditorState body={catalog.lastError ?? 'Unable to load muscle groups right now.'} kind="error" title={title} />;
  }
  if (editingId && !editingExercise) {
    return loading
      ? <EditorState body="Loading exercise…" kind="loading" title="Edit exercise" />
      : <EditorState body="This exercise isn't available to edit." kind="message" title="Edit exercise" />;
  }
  if (loading) {
    return <EditorState body="Loading muscle groups…" kind="loading" title={title} />;
  }
  return <EditorForm editingExercise={editingExercise} request={request} title={title} />;
}

function EditorState({ title, body, kind }: { title: string; body: string; kind: 'loading' | 'error' | 'message' }) {
  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <StatePanel body={body} kind={kind} />
    </Screen>
  );
}

function EditorForm({ editingExercise, request, title }: {
  editingExercise: ExerciseCatalogExercise | null;
  request: ExerciseEditorRequest;
  title: string;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const { muscleSetup } = useExerciseCatalog();
  const bodyweightCalculationsEnabled = useBodyweightCalculationsEnabled();
  const linkingUserId = useGroupLinkingUserId();
  const [prefill] = useState(request.prefill ?? null);
  const form = useExerciseEditorForm({
    visible: true,
    editingExercise,
    prefill,
    muscleSetup,
    muscleSetupLoaded: muscleSetup !== EMPTY_MUSCLE_SETUP,
    onRequestClose: () => router.back(),
    onSaved: (saved) => {
      // Back is held while saving; still, pop only this page, never its caller.
      if (navigation.isFocused()) router.back();
      request.onSaved?.(saved);
    },
    onSave: request.onSave,
  });
  const muscleError = form.validation.primaryMuscleError ?? form.validation.secondaryMusclesError;
  const overModal = useOpensOverModal();

  return (
    <Screen>
      <Stack.Screen
        options={{
          title,
          // A save in flight holds the page: no swipe, no back (`ux-rules.md` "Sheets" 2).
          gestureEnabled: !form.isSaving,
          headerBackVisible: !form.isSaving,
          // Over the exercise picker iOS presents the page as a card with no
          // back; an X leaves it without saving, as the swipe does.
          headerLeft: overModal ? () => (
            <IconButton accessibilityLabel="Close exercise editor" name="x" nativeHeader onPress={form.close} testID="exercise-editor-close" />
          ) : undefined,
        }}
      />
      <ScreenScroll
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        testID="exercise-editor">
        <ExerciseNameField
          autoFocus={!editingExercise}
          name={form.exerciseName}
          nameError={form.validation.nameError}
          onChangeName={form.changeName}
          testIDPrefix="exercise-editor"
        />
        {editingExercise && linkingUserId ? <ExerciseLinksSection exercise={editingExercise} userId={linkingUserId} /> : null}
        <MusclesSection error={muscleError} form={form} />
        <ExerciseWeightSection
          bodyweightContribution={bodyweightCalculationsEnabled ? {
            value: form.bodyweightContributionField,
            error: form.bodyweightContributionError,
            onChange: form.changeContribution,
          } : undefined}
          loadInputMode={form.loadInputMode}
          onChangeLoadInputMode={form.setLoadInputMode}
          testIDPrefix="exercise-editor"
        />
        <OptionsSection form={form} />
        <ActionButton
          accessibilityLabel="Save exercise definition"
          disabled={form.isSaving}
          label={form.isSaving ? 'Saving…' : editingExercise ? 'Save' : 'Add exercise'}
          onPress={form.save}
          testID="exercise-editor-save"
          variant="primary"
        />
        {form.saveError ? <Notice live message={form.saveError} testID="exercise-editor-save-error" tone="danger" /> : null}
      </ScreenScroll>
      <MusclePickerSheet form={form} />
    </Screen>
  );
}

/** The routes iOS presents modally (`root-stack.tsx`). */
const MODAL_ROUTES = new Set(['session/[sessionId]/add-exercise']);

/**
 * Whether this page sits above a modally presented route (the picker, or the
 * catalogue opened from it by Manage): iOS presents every page pushed after a
 * modal as a card with no back. The page is found by name, not as the top of
 * the stack, so a page pushed over it (Link) does not change the answer.
 */
function useOpensOverModal(): boolean {
  const navigation = useNavigation();
  const routes = navigation.getState()?.routes ?? [];
  // On its first render the page is not in the state yet: all routes are beneath it.
  const index = routes.map((route) => route.name).lastIndexOf('exercise-edit');
  return routes.slice(0, index < 0 ? routes.length : index).some((route) => MODAL_ROUTES.has(route.name));
}

const muscleNames = (ids: readonly string[], musclesById: Record<string, ReportedMuscle>) =>
  ids.map((id) => musclesById[id]?.displayName ?? id).join(', ');

function MusclesSection({ form, error }: { form: EditorFormState; error: string | null }) {
  const { musclesById } = useExerciseCatalog().muscleSetup;
  const primary = form.primaryMuscleGroupIds;
  return (
    <FormSection error={error} errorTestID="exercise-editor-muscles-error" title="Muscles">
      <ChoiceRow
        label="Primary"
        onPress={() => form.openMuscleSelector('primary')}
        placeholder="Choose"
        testID="exercise-editor-primary-muscle-trigger"
        value={muscleNames(primary, musclesById)}
      />
      <ChoiceRow
        divider
        label="Secondary"
        onPress={() => form.openMuscleSelector('secondary')}
        placeholder="None"
        testID="exercise-editor-secondary-muscle-trigger"
        value={muscleNames(form.secondaryMuscleRows.map((row) => row.muscleGroupId), musclesById)}
      />
    </FormSection>
  );
}

/** Settings that change how the app behaves, not the exercise's figures. */
function OptionsSection({ form }: { form: EditorFormState }) {
  const globalRestTimerSec = useAccountLocalPreferenceState().values.restTimerDurationSec;
  return (
    <FormSection error={form.restTimerError} errorTestID="exercise-editor-rest-timer-error" title="Options">
      {/* Blank uses the global rest timer, shown as the placeholder ([[timer.rest-default]]). */}
      <InputRow
        accessibilityLabel="Rest timer seconds"
        invalid={Boolean(form.restTimerError)}
        label="Rest timer (s)"
        onChangeText={form.changeRestTimer}
        placeholder={String(globalRestTimerSec)}
        testID="exercise-editor-rest-timer"
        value={form.restTimerText}
      />
      {/* [[gym.split]] */}
      <SwitchRow
        density="list"
        divider
        label="Track each gym separately"
        onValueChange={form.setSplitByGym}
        testID="exercise-editor-split-by-gym"
        value={form.splitByGym}
      />
    </FormSection>
  );
}

/**
 * Primary and Secondary options scroll below the fixed sheet title and handle;
 * the picker stays open while muscles are ticked.
 */
function MusclePickerSheet({ form }: { form: EditorFormState }) {
  const { muscles } = useExerciseCatalog().muscleSetup;
  const mode = form.muscleSelectorMode;
  const isPrimary = mode === 'primary';
  const selected = isPrimary ? form.selectedPrimaryMuscleIds : form.selectedSecondaryMuscleIds;
  const options = mode ? muscleSelectorOptions(mode, muscles, form.selectedPrimaryMuscleIds, form.selectedSecondaryMuscleIds) : [];
  return (
    <Sheet
      dismissLabel="Close muscle picker"
      onDismiss={form.closeMuscleSelector}
      testID="exercise-editor-muscle-selector-list"
      title={isPrimary ? 'Primary muscles' : 'Secondary muscles'}
      visible={mode !== null}>
      <ScrollView style={styles.muscleOptions}>
        {options.map((muscle, index) => {
          const isOn = selected.has(muscle.id);
          return (
            <ListRow
              accessibilityLabel={`${isPrimary ? 'Select primary muscle' : 'Secondary muscle'} ${muscle.displayName}`}
              divider={index > 0}
              key={muscle.id}
              label={muscle.displayName}
              leading={<Icon color={isOn ? uiRoles.accent : uiRoles.inkMuted} name={isOn ? 'check' : 'circle'} size="md" />}
              meta={<Text allowFontScaling={false} numberOfLines={1} style={[uiText.meta, uiTextTone.muted]}>{muscle.familyName}</Text>}
              selected={isOn}
              onPress={() => (isPrimary ? form.togglePrimaryMuscle(muscle.id) : form.toggleSecondaryMuscle(muscle.id))}
              testID={`exercise-editor-muscle-option-${muscle.id}`}
            />
          );
        })}
        {mode && options.length === 0 ? <StatePanel body="No muscles to choose from." fill={false} /> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  muscleOptions: { flexShrink: 1 },
  content: {
    gap: uiSpace.lg,
  },
});
