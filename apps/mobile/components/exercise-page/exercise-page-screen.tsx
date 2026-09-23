import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import {
  addSet,
  buildSetRows,
  commitSet,
  describeCompleteExercisePlan,
  findCursorIndex,
  loggerValuesFor,
  planCompleteExercise,
  toggleSetPerformed,
  updateLoggerValues,
} from '@/src/session-recorder/exercise-page-model';
import { recordBaselineOf } from '@/src/session-recorder/exercise-records';
import type { SessionExerciseDraftClient } from '@/src/session-recorder/session-exercise-draft';
import { useExerciseRecords, type LoadExerciseHistory } from '@/src/session-recorder/use-exercise-records';
import { useSessionExerciseDraft } from '@/src/session-recorder/use-session-exercise-draft';

import { EffortSheet, ExerciseOptionsSheet } from './exercise-sheets';
import { ExerciseSwapSheet } from './exercise-swap-sheet';
import { ExerciseTopBar } from './exercise-top-bar';
import { RecordsPanel, type RecordsView } from './records-panel';
import { SetLogger } from './set-logger';
import { SetRow } from './set-row';
import { pageText } from './text-styles';

type ExercisePageScreenProps = {
  sessionId: string;
  sessionExerciseId: string;
  // Injected by tests; production uses the recorder's repositories.
  draftClient?: SessionExerciseDraftClient;
  loadHistory?: LoadExerciseHistory;
};

type OpenSheet = 'none' | 'effort' | 'options' | 'swap' | 'edit';

const LOAD_ERROR_MESSAGES = {
  'missing-session': 'This session no longer exists.',
  'not-active': 'This session is not in progress, so its sets cannot be edited here.',
  'missing-exercise': 'This exercise is no longer in the session.',
  'load-failed': 'The exercise could not be loaded.',
} as const;

// Until the session view (step 5) is the entry point, a page opened without
// history (a deep link) has nothing to go back to; Train is the training hub.
const FALLBACK_BACK_ROUTE = '/train' as Href;

/**
 * The exercise page (build spec, "Exercise page"): one page per session
 * exercise, the set list with the in-place logger, and two exits — Back leaves
 * set states untouched, `Complete exercise` resolves the sets still waiting.
 */
export function ExercisePageScreen({
  sessionId,
  sessionExerciseId,
  draftClient,
  loadHistory,
}: ExercisePageScreenProps) {
  const router = useRouter();
  const draft = useSessionExerciseDraft({
    sessionId,
    sessionExerciseId,
    client: draftClient,
  });
  const exercise = draft.state.status === 'ready' ? draft.state.exercise : null;
  const records = useExerciseRecords(exercise?.exerciseDefinitionId ?? null, loadHistory);
  const [listPreferences] = useExerciseListPreferences();
  const catalog = useExerciseCatalog();

  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const [recordsView, setRecordsView] = useState<RecordsView>('records');
  const [openSheet, setOpenSheet] = useState<OpenSheet>('none');
  // `null` follows the cursor: the logger sits on the first set not performed.
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const weightInputRef = useRef<TextInput>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(FALLBACK_BACK_ROUTE);
  }, [router]);

  const sets = useMemo(() => exercise?.sets ?? [], [exercise]);
  const baseline = records.status === 'ready' ? recordBaselineOf(records.summary.records) : null;
  const rows = useMemo(() => buildSetRows(sets, baseline), [baseline, sets]);
  const cursorIndex = findCursorIndex(sets);
  const openSet =
    sets.find((set) => set.id === openSetId) ?? (cursorIndex !== null ? sets[cursorIndex] : undefined);
  const loggerValues = openSet ? loggerValuesFor(openSet) : null;

  const updateSets = useCallback(
    (recipe: (current: typeof sets) => typeof sets, kind: 'text' | 'structural') =>
      draft.update((current) => {
        const nextSets = recipe(current.sets);
        return nextSets === current.sets ? current : { ...current, sets: nextSets };
      }, kind),
    [draft]
  );

  const onChangeLogger = (values: { weightValue?: string; repsValue?: string }) => {
    if (!openSet) return;
    updateSets((current) => updateLoggerValues(current, openSet.id, values), 'text');
  };

  const onSelectEffort = (setType: SessionSetTypeValue) => {
    setOpenSheet('none');
    if (!openSet) return;
    updateSets((current) => updateLoggerValues(current, openSet.id, { setType }), 'structural');
  };

  const onCommit = () => {
    if (!openSet || !loggerValues) return;
    Keyboard.dismiss();
    updateSets((current) => commitSet(current, openSet.id, loggerValues), 'structural');
    setOpenSetId(null);
  };

  const onToggle = (setId: string) => {
    const next = toggleSetPerformed(sets, setId);
    if (next === null) {
      setOpenSetId(setId);
      return;
    }
    updateSets(() => next, 'structural');
    if (setId === openSet?.id) setOpenSetId(null);
  };

  const onAddSet = () => {
    const next = addSet(sets);
    const added = next[next.length - 1];
    updateSets(() => next, 'structural');
    setOpenSetId(added?.id ?? null);
    // Ready to overwrite the copied weight (`ux-rules.md` §5.11).
    requestAnimationFrame(() => weightInputRef.current?.focus());
  };

  const finishComplete = async (nextSets: typeof sets) => {
    setIsCompleting(true);
    updateSets(() => nextSets, 'structural');
    const saved = await draft.flush();
    setIsCompleting(false);
    if (saved) goBack();
  };

  const onComplete = () => {
    Keyboard.dismiss();
    const plan = planCompleteExercise(sets);
    if (!plan.needsConfirmation) {
      void finishComplete(plan.nextSets);
      return;
    }
    Alert.alert('Complete exercise?', describeCompleteExercisePlan(plan), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete',
        style: 'destructive',
        onPress: () => void finishComplete(plan.nextSets),
      },
    ]);
  };

  const onRemove = () => {
    setOpenSheet('none');
    if (!exercise) return;
    Alert.alert(
      'Remove from session?',
      `${exercise.name} and its ${sets.length} ${sets.length === 1 ? 'set' : 'sets'} will be removed from this session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void draft
              .remove()
              .then(goBack)
              .catch((error: unknown) =>
                Alert.alert(
                  'Could not remove',
                  error instanceof Error ? error.message : 'Nothing was changed.'
                )
              );
          },
        },
      ]
    );
  };

  const editingExercise = exercise
    ? (catalog.exercises.find((candidate) => candidate.id === exercise.exerciseDefinitionId) ?? null)
    : null;

  if (draft.state.status !== 'ready' || !exercise) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <ExerciseTopBar onBack={goBack} title="" />
        <View style={styles.state} testID="exercise-page-state">
          <Text style={pageText.body}>
            {draft.state.status === 'error' ? LOAD_ERROR_MESSAGES[draft.state.reason] : 'Loading…'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen} testID="exercise-page">
      <ExerciseTopBar onBack={goBack} onOpenOptions={() => setOpenSheet('options')} title={exercise.name} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.body}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID="exercise-page-scroll">
          <RecordsPanel
            dateFormat={listPreferences.dateFormat}
            expanded={recordsExpanded}
            onOpenHistory={() =>
              router.push({
                pathname: '/exercise-history',
                params: { exerciseDefinitionId: exercise.exerciseDefinitionId },
              })
            }
            onSelectView={setRecordsView}
            onToggleExpanded={() => setRecordsExpanded((current) => !current)}
            state={records}
            view={recordsView}
          />
          <Card testID="exercise-set-list">
            {rows.map((row, index) => {
              const isOpen = row.id === openSet?.id;
              const followsLogger = index > 0 && rows[index - 1]?.id === openSet?.id;
              if (isOpen && loggerValues) {
                return (
                  <SetLogger
                    key={row.id}
                    number={row.number}
                    onChangeReps={(repsValue) => onChangeLogger({ repsValue })}
                    onChangeWeight={(weightValue) => onChangeLogger({ weightValue })}
                    onCommit={onCommit}
                    onOpenEffort={() => setOpenSheet('effort')}
                    ref={weightInputRef}
                    repsValue={loggerValues.repsValue}
                    setType={loggerValues.setType}
                    weightValue={loggerValues.weightValue}
                  />
                );
              }
              return (
                <SetRow
                  divider={index > 0 && !followsLogger}
                  key={row.id}
                  onOpen={setOpenSetId}
                  onToggle={onToggle}
                  row={row}
                />
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={onAddSet}
              style={({ pressed }) => [
                styles.addSet,
                rows.length > 0 ? styles.addSetDivider : null,
                pressed ? styles.pressed : null,
              ]}
              testID="exercise-add-set">
              <Icon color={uiRoles.ink} name="plus" size="xs" />
              <Text style={pageText.controlLabel}>Add set</Text>
            </Pressable>
          </Card>
          {draft.saveError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[pageText.body, styles.saveError]}
              testID="exercise-save-error">
              {`Not saved: ${draft.saveError}`}
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isCompleting }}
            disabled={isCompleting}
            onPress={onComplete}
            style={({ pressed }) => [styles.complete, pressed ? styles.pressed : null]}
            testID="exercise-complete">
            <Text style={pageText.controlLabel}>Complete exercise</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <EffortSheet
        onDismiss={() => setOpenSheet('none')}
        onSelect={onSelectEffort}
        selected={loggerValues?.setType ?? null}
        visible={openSheet === 'effort'}
      />
      <ExerciseOptionsSheet
        exerciseName={exercise.name}
        onDismiss={() => setOpenSheet('none')}
        onEdit={() => setOpenSheet('edit')}
        onRemove={onRemove}
        onSwap={() => setOpenSheet('swap')}
        visible={openSheet === 'options'}
      />
      <ExerciseSwapSheet
        currentExerciseDefinitionId={exercise.exerciseDefinitionId}
        onDismiss={() => setOpenSheet('none')}
        onSelect={(picked) => {
          setOpenSheet('none');
          draft.update(
            (current) => ({
              ...current,
              exerciseDefinitionId: picked.id,
              name: picked.name,
            }),
            'structural'
          );
        }}
        visible={openSheet === 'swap'}
      />
      <ExerciseEditorModal
        editingExercise={editingExercise}
        onRequestClose={() => setOpenSheet('none')}
        onSaved={(saved) => {
          setOpenSheet('none');
          draft.update((current) => ({ ...current, name: saved.name }), 'structural');
        }}
        visible={openSheet === 'edit' && editingExercise !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  body: {
    flex: 1,
  },
  // Page gutter: the target's 14 snaps to `md` 12, the same inset as a card's
  // content, so page and card share one rhythm.
  content: {
    gap: uiSpace.md,
    padding: uiSpace.md,
  },
  state: {
    padding: uiSpace.lg,
  },
  addSet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.xs,
    minHeight: uiGeometry.tapTarget,
    backgroundColor: uiRoles.surfaceSubtle,
  },
  addSetDivider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  pressed: {
    backgroundColor: uiRoles.surfaceSubtle,
  },
  saveError: {
    color: uiRoles.danger,
  },
  footer: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.md,
  },
  // An outline, not a second `accent`: the logger's tick is the screen's one
  // primary (`design-language.md` §5).
  complete: {
    minHeight: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ink,
    borderRadius: uiGeometry.radius.control,
  },
});
