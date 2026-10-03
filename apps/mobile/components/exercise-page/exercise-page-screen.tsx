import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EMPTY_SESSION_WEIGHT, isValidSessionWeight } from '@/src/bodyweight/weight-entry';
import { useBodyweightCalculationsEnabled } from '@/src/bodyweight/calculation-preference';
import { personalLoadContext } from '@/src/exercise-calculations/analytics';
import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { nextSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { exerciseLinkHref } from '@/src/navigation/routes';
import {
  addSet,
  buildSetRows,
  sessionRecordBlocks,
  commitSet,
  describeCompleteExercisePlan,
  discardSetEntry,
  findCursorIndex,
  loggerValuesFor,
  planCompleteExercise,
  recordBandFor,
  toggleSetPerformed,
  updateLoggerValues,
} from '@/src/session-recorder/exercise-page-model';
import { recordBaselineOf } from '@/src/session-recorder/exercise-records';
import type { SessionExerciseDraftClient } from '@/src/session-recorder/session-exercise-draft';
import { useExerciseRecords, type LoadExerciseRecords } from '@/src/session-recorder/use-exercise-records';
import { useSessionExerciseDraft } from '@/src/session-recorder/use-session-exercise-draft';

import { EffortSheet, ExerciseOptionsSheet } from './exercise-sheets';
import { ExerciseSwapSheet } from './exercise-swap-sheet';
import { ExerciseTopBar } from './exercise-top-bar';
import { RecordsPanel, type RecordsView } from './records-panel';
import { SetLogger } from './set-logger';
import { SetRow } from './set-row';
import { SwipeSetRow } from './swipe-set-row';
import { pageText } from './text-styles';

type ExercisePageScreenProps = {
  sessionId: string;
  sessionExerciseId: string;
  // Injected by tests; production uses the session repositories.
  draftClient?: SessionExerciseDraftClient;
  loadRecords?: LoadExerciseRecords;
};

type OpenSheet = 'none' | 'effort' | 'options' | 'swap' | 'edit';

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
  loadRecords,
}: ExercisePageScreenProps) {
  const router = useRouter();
  const bodyweightCalculationsEnabled = useBodyweightCalculationsEnabled();
  const [, setPreferenceFocusRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    setPreferenceFocusRevision((value) => value + 1);
  }, []));
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
  const currentGymId = draft.state.status === 'ready' ? draft.state.gymId : null;
  const [listPreferences] = useExerciseListPreferences();
  const isFilteredByGym = listPreferences.pastRecordsGymScope === 'current-gym' && Boolean(currentGymId);
  const records = useExerciseRecords(
    exercise?.exerciseDefinitionId ?? null,
    loadRecords,
    isCompletedSession ? sessionId : null,
    {
      scope: listPreferences.pastRecordsGymScope,
      currentGymId,
    },
    JSON.stringify([recordsRevision, editingExercise?.bodyweightContribution, editingExercise?.loadInputMode])
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
  const bodyWeight = draft.state.status === 'ready' ? draft.state.bodyWeight : EMPTY_SESSION_WEIGHT;
  const loadContext = personalLoadContext(
    bodyweightCalculationsEnabled,
    editingExercise ? {
      bodyweightContribution: editingExercise.bodyweightContribution,
      loadInputMode: editingExercise.loadInputMode,
    } : null,
    isValidSessionWeight(bodyWeight) ? bodyWeight : null,
  );
  const baseline = records.status === 'ready'
    ? recordBaselineOf(records.summary.records) : null;
  const recordSession = exercise && draft.state.status === 'ready'
    ? sessionRecordBlocks(exercise, draft.state.sessionBlocks) : null;
  const rows = buildSetRows(sets, baseline, loadContext, recordSession);
  const recordBand = recordBandFor(rows);
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

  /**
   * Swipe right on the in-progress set (`ux-rules.md` §14a.3): confirm it and
   * move on — the same write as the tick. On the last set, the deterministic
   * continuation is Add set: the fresh row opens in the logger with the
   * copied values and the weight focused. Invalid values change nothing.
   */
  const onSwipeRight = (setId: string) => {
    Keyboard.dismiss();
    const isTargetOpen = openSet?.id === setId;
    const target = sets.find((s) => s.id === setId);
    if (!target) return;
    const committed = commitSet(sets, setId, loggerValuesFor(target));
    if (committed === sets) return;
    if (sets[sets.length - 1]?.id !== setId) {
      updateSets(() => committed, 'structural');
      if (isTargetOpen) setOpenSetId(null);
      return;
    }
    const next = addSet(committed);
    updateSets(() => next, 'structural');
    setOpenSetId(next[next.length - 1]?.id ?? null);
    requestAnimationFrame(() => weightInputRef.current?.focus());
  };

  /** Swipe left: drop the in-progress entry; the row keeps its place (`discardSetEntry`). */
  const onSwipeLeft = (setId: string) => {
    updateSets((current) => discardSetEntry(current, setId), 'structural');
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
          <Card testID="exercise-set-list">
            {recordBand ? (
              <View style={styles.recordBand} testID="exercise-record-band">
                <Icon color={uiRoles.record} name="arrow-up" size="xs" />
                <Text allowFontScaling={false} style={styles.recordBandLabel}>{recordBand.label}</Text>
              </View>
            ) : null}
            {rows.map((row, index) => {
              const isOpen = row.id === openSet?.id;
              const followsLogger = index > 0 && rows[index - 1]?.id === openSet?.id;
              if (isOpen || row.isCursor) {
                // The in-progress row carries the swipes; the accessibility
                // actions are the non-gesture path for the same two moves.
                const rowContent = isOpen && loggerValues ? (
                  <SetLogger
                    loadContext={loadContext}
                    number={row.number}
                    onChangeReps={(repsValue) => onChangeLogger({ repsValue })}
                    onChangeWeight={(weightValue) => onChangeLogger({ weightValue })}
                    onCommit={onCommit}
                    onConfirm={() => onSwipeRight(row.id)}
                    onCycleEffort={() => onSelectEffort(nextSessionSetType(loggerValues.setType))}
                    onDrop={() => onSwipeLeft(row.id)}
                    onOpenEffort={() => setOpenSheet('effort')}
                    ref={weightInputRef}
                    repsValue={loggerValues.repsValue}
                    setType={loggerValues.setType}
                    weightValue={loggerValues.weightValue}
                  />
                ) : (
                  <SetRow
                    divider={index > 0 && !followsLogger}
                    key={row.id}
                    onConfirm={() => onSwipeRight(row.id)}
                    onDrop={() => onSwipeLeft(row.id)}
                    onOpen={setOpenSetId}
                    onToggle={onToggle}
                    row={row}
                  />
                );
                return (
                  <SwipeSetRow
                    key={row.id}
                    onSwipeLeft={() => onSwipeLeft(row.id)}
                    onSwipeRight={() => onSwipeRight(row.id)}
                    testID={`exercise-set-swipe-${row.number}`}>
                    {rowContent}
                  </SwipeSetRow>
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
          {/* In the scroll, after the set list — not a pinned footer, which
              cost a row of screen above the keyboard on every set. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isCompleting }}
            disabled={isCompleting}
            onPress={onComplete}
            style={({ pressed }) => [styles.complete, pressed ? styles.pressed : null]}
            testID="exercise-complete">
            <Text allowFontScaling={false} style={pageText.controlLabel}>Complete exercise</Text>
          </Pressable>
        </ScreenScroll>
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
        onEdit={() => { void draft.flush().then(saved => { if (saved) setOpenSheet('edit'); }); }}
        onLink={
          groupLinkingUserId && exercise.exerciseDefinitionId
            ? () => {
                setOpenSheet('none');
                // Pending edits are written before the Link screen opens, so
                // linking mid-session cannot race the autosave debounce and
                // the session is left exactly as it reads (`ux-rules.md` §14a.5).
                void draft.flush().then((saved) => {
                  if (saved) router.push(exerciseLinkHref(exercise.exerciseDefinitionId));
                });
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
    backgroundColor: uiRoles.paper,
  },
  addSetDivider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  saveError: {
    color: uiRoles.danger,
  },
  // The record band, the session view card's (`exercise-sets-card.tsx`), on
  // the page's set list.
  recordBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
    backgroundColor: uiRoles.recordWash,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.recordRule,
  },
  recordBandLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.record,
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
