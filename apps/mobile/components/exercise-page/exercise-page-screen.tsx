import { LoadingEstimateSheet } from '@/components/bodyweight/loading-estimate-sheet';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LegacyLoadReviewSheet } from '@/components/bodyweight/legacy-load-review-sheet';
import { SessionBodyWeight } from '@/components/bodyweight/session-body-weight';
import { isValidSessionWeight } from '@/src/bodyweight/weight-entry';
import type { LoadContext } from '@/src/exercise-calculations/effective-load';
import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import { nextSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { exerciseLinkHref } from '@/src/navigation/routes';
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
  // Injected by tests; production uses the session repositories.
  draftClient?: SessionExerciseDraftClient;
  loadHistory?: LoadExerciseHistory;
};

type OpenSheet = 'none' | 'effort' | 'options' | 'swap' | 'edit' | 'review';

const LOAD_ERROR_MESSAGES = {
  'missing-session': 'This session no longer exists.',
  'not-editable': 'This session was deleted, so its sets cannot be edited here.',
  'missing-exercise': 'This exercise is no longer in the session.',
  'load-failed': 'The exercise could not be loaded.',
} as const;

// Until the session view (step 5) is the entry point, a page opened without
// history (a deep link) has nothing to go back to; Train is the training hub.
const FALLBACK_BACK_ROUTE = '/train' as Href;

/**
 * The exercise page (`ux-rules` §14a): one page per session
 * exercise, the set list with the in-place logger, and two exits — Back leaves
 * set states untouched, `Complete exercise` resolves the sets still waiting.
 * The same page edits an exercise of a completed session (opened from the
 * session view's completed edit); its records then leave that session out.
 */
export function ExercisePageScreen({
  sessionId,
  sessionExerciseId,
  draftClient,
  loadHistory,
}: ExercisePageScreenProps) {
  const router = useRouter();
  const groupLinkingUserId = useGroupLinkingUserId();
  const draft = useSessionExerciseDraft({
    sessionId,
    sessionExerciseId,
    client: draftClient,
  });
  const exercise = draft.state.status === 'ready' ? draft.state.exercise : null;
  const isCompletedSession = draft.state.status === 'ready' && draft.state.sessionStatus === 'completed';
  const catalog = useExerciseCatalog();
  const editingExercise = exercise
    ? (catalog.exercises.find((candidate) => candidate.id === exercise.exerciseDefinitionId) ?? null)
    : null;
  const [recordsRevision, setRecordsRevision] = useState(0);
  const [estimateVisible, setEstimateVisible] = useState(false);
  const currentGymId = draft.state.status === 'ready' ? draft.state.gymId : null;
  const [listPreferences] = useExerciseListPreferences();
  const isFilteredByGym = listPreferences.pastRecordsGymScope === 'current-gym' && Boolean(currentGymId);
  const records = useExerciseRecords(
    exercise?.exerciseDefinitionId ?? null,
    loadHistory,
    isCompletedSession ? sessionId : null,
    {
      scope: listPreferences.pastRecordsGymScope,
      currentGymId,
    },
    JSON.stringify([recordsRevision, editingExercise?.bodyweightCoefficient, editingExercise?.loadInputMode, editingExercise?.localBodyweightMetadataKnown])
  );

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
  const bodyWeight = draft.state.status === 'ready' ? draft.state.bodyWeight : {};
  const loadContext: LoadContext = {
    bodyweightCoefficient: !editingExercise || editingExercise.localBodyweightMetadataKnown === false ? NaN : editingExercise.bodyweightCoefficient ?? 0,
    loadInputMode: editingExercise?.loadInputMode ?? 'total_load',
    bodyWeightKg: bodyWeight?.localBodyweightMetadataKnown !== false && isValidSessionWeight(bodyWeight ?? {}) ? bodyWeight?.bodyWeightKg : null,
  };
  const baseline = records.status === 'ready'
    ? recordBaselineOf(records.summary.records) : null;
  const rows = buildSetRows(sets, baseline, loadContext);
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

  const onChangeLogger = (values: { weightValue?: string; repsValue?: string; weightUnit?: string; externalLoadMode?: string }) => {
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
    updateSets((current) => commitSet(current, openSet.id, { ...loggerValues, externalLoadMode: loggerValues.externalLoadMode ?? (loadContext.bodyweightCoefficient === 0 ? 'added' : null) }), 'structural');
    setOpenSetId(null);
  };

  const onToggle = (setId: string) => {
    const set = sets.find(candidate => candidate.id === setId);
    if (set && loadContext.bodyweightCoefficient > 0 && loggerValuesFor(set).externalLoadMode == null) {
      setOpenSetId(setId); return;
    }
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

  if (draft.state.status !== 'ready' || !exercise) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <ExerciseTopBar onBack={goBack} title="" />
        {draft.state.status === 'error' ? (
          <StatePanel kind="error" testID="exercise-page-state" title={LOAD_ERROR_MESSAGES[draft.state.reason]} />
        ) : (
          <StatePanel kind="loading" testID="exercise-page-state" title="Loading…" />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen} testID="exercise-page">
      <ExerciseTopBar onBack={goBack} onOpenOptions={() => setOpenSheet('options')} title={exercise.name} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.body}>
        {/* Page gutter: the target's 14 snaps to `md` 12, the same inset as a
            card's content, so page and card share one rhythm. */}
        <ScreenScroll gutter="md" keyboardShouldPersistTaps="handled" testID="exercise-page-scroll">
          <RecordsPanel
            bodyweight={loadContext.bodyweightCoefficient > 0}
            onEstimate={() => setEstimateVisible(true)}
            dateFormat={listPreferences.dateFormat}
            expanded={recordsExpanded}
            isFilteredByGym={isFilteredByGym}
            onOpenHistory={() =>
              router.push({
                pathname: '/exercise-history',
                params: {
                  exerciseDefinitionId: exercise.exerciseDefinitionId,
                  ...(currentGymId ? { currentGymId } : {}),
                },
              })
            }
            onSelectView={setRecordsView}
            onToggleExpanded={() => setRecordsExpanded((current) => !current)}
            state={records}
            view={recordsView}
          />
          {loadContext.bodyweightCoefficient > 0 ? <SessionBodyWeight sessionId={sessionId}
            snapshot={draft.state.bodyWeight} metadataKnown={draft.state.bodyWeight?.localBodyweightMetadataKnown}
            onSaved={snapshot => draft.setBodyWeight({ ...snapshot, localBodyweightMetadataKnown: true })} /> : null}
          <Card testID="exercise-set-list">
            {rows.map((row, index) => {
              const isOpen = row.id === openSet?.id;
              const followsLogger = index > 0 && rows[index - 1]?.id === openSet?.id;
              if (isOpen && loggerValues) {
                return (
                  <SetLogger
                    key={row.id}
                    loadContext={loadContext}
                    weightUnit={loggerValues.weightUnit}
                    externalLoadMode={loggerValues.externalLoadMode}
                    metadataKnown={openSet?.localBodyweightMetadataKnown !== false && editingExercise?.localBodyweightMetadataKnown !== false}
                    requiresReview={openSet?.localBodyweightMetadataKnown === false ||
                      (loadContext.bodyweightCoefficient > 0 && loggerValues.externalLoadMode == null)}
                    onChangeLoad={onChangeLogger}
                    onReview={() => { void draft.flush().then(saved => { if (saved) setOpenSheet('review'); }); }}
                    number={row.number}
                    onChangeReps={(repsValue) => onChangeLogger({ repsValue })}
                    onChangeWeight={(weightValue) => onChangeLogger({ weightValue })}
                    onCommit={onCommit}
                    onCycleEffort={() => onSelectEffort(nextSessionSetType(loggerValues.setType))}
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
              <Text allowFontScaling={false} style={pageText.controlLabel}>Add set</Text>
            </Pressable>
          </Card>
          {draft.saveError ? (
            <Text
              allowFontScaling={false}
              accessibilityLiveRegion="polite"
              style={[pageText.body, styles.saveError]}
              testID="exercise-save-error">
              {`Not saved: ${draft.saveError}`}
            </Text>
          ) : null}
        </ScreenScroll>
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isCompleting }}
            disabled={isCompleting}
            onPress={onComplete}
            style={({ pressed }) => [styles.complete, pressed ? styles.pressed : null]}
            testID="exercise-complete">
            <Text allowFontScaling={false} style={pageText.controlLabel}>Complete exercise</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <EffortSheet
        onDismiss={() => setOpenSheet('none')}
        onSelect={onSelectEffort}
        selected={loggerValues?.setType ?? null}
        visible={openSheet === 'effort'}
      />
      <LoadingEstimateSheet visible={estimateVisible} exerciseId={exercise.exerciseDefinitionId}
        context={loadContext} onDismiss={() => setEstimateVisible(false)} />
      <LegacyLoadReviewSheet visible={openSheet === 'review'} exerciseId={exercise.exerciseDefinitionId}
        onDismiss={() => setOpenSheet('none')} onApplied={() => { void draft.reload(); setRecordsRevision(value => value + 1); }} />
      <ExerciseOptionsSheet
        onReview={loadContext.bodyweightCoefficient > 0 ? () => { void draft.flush().then(saved => { if (saved) setOpenSheet('review'); }); } : undefined}
        exerciseName={exercise.name}
        onDismiss={() => setOpenSheet('none')}
        onEdit={() => { void draft.flush().then(saved => { if (saved) setOpenSheet('edit'); }); }}
        onLink={
          groupLinkingUserId && exercise.exerciseDefinitionId
            ? () => {
                setOpenSheet('none');
                router.push(exerciseLinkHref(exercise.exerciseDefinitionId));
              }
            : undefined
        }
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
          // Review may have converted sets outside this page's draft. Reload
          // them before any graph autosave can write the older values back.
          void draft.reload().then(loaded => {
            setRecordsRevision(value => value + 1);
            if (loaded) draft.update((current) => ({ ...current, name: saved.name }), 'structural');
            setOpenSheet('none');
          });
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
