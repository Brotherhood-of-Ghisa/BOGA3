import { personalCalculationContext } from '@/src/config/personal-effort';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextInputInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EMPTY_SESSION_WEIGHT, isValidSessionWeight } from '@/src/bodyweight/weight-entry';
import { useBodyweightCalculationsEnabled } from '@/src/bodyweight/calculation-preference';
import { ExerciseEditorModal } from '@/components/exercise-catalog/exercise-editor-modal';
import { RecordBand } from '@/components/session-detail';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { ScreenScroll } from '@/components/ui/screen';
import { completePlanBlock, loadPlanBlockProgressStatus, reorderSessionExerciseSets } from '@/src/session-planner';
import { StatePanel } from '@/components/ui/state-panel';
import { uiBorder, uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import { nextSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { exerciseLinkHref } from '@/src/navigation/routes';
import {
  addSet,
  buildSetRows,
  sessionRecordBlocks,
  commitSet,
  describeCompleteExercisePlan,
  dropSet,
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
import { ExerciseSetRowItem } from './exercise-set-row-item';
import { SetReorderList } from './set-reorder-list';
import { useSetReorder } from './use-set-reorder';
import { pageText } from './text-styles';

/** The permutation a drag produced is a no-op when it matches the persisted order. */
const isSameOrder = (order: string[], other: string[]): boolean =>
  order.length === other.length && order.every((id, index) => id === other[index]);

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

/** The records panel filters to the current gym only under that preference. */
const isGymFiltered = (scope: string, gymId: string | null): boolean => scope === 'current-gym' && gymId !== null;

/** A completed session is edited in place (history, not a draft). */
const isCompletedEdit = (state: { status: string; sessionStatus?: string }): boolean =>
  state.status === 'ready' && state.sessionStatus === 'completed';

/** The inline words for one typed block-resolution result, against the
 * block state the page already knows. */
const blockResolutionNotice = (status: string, knownStatus: 'pending' | 'resolved' | null): string => {
  if (status === 'completed') return 'Block completed. It no longer counts as waiting.';
  if (status === 'not-resolvable') {
    return knownStatus === 'pending'
      ? 'Finish one planned set first: confirm a set the block planned.'
      : 'This block is already resolved.';
  }
  return "Couldn't complete the block. Try again.";
};

// Until the session view (step 5) is the entry point, a page opened without
// history (a deep link) has nothing to go back to; Train is the training hub.
const FALLBACK_BACK_ROUTE = '/train' as Href;

/**
 * The exercise page: one page per session
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
  const isCompletedSession = isCompletedEdit(draft.state);
  const catalog = useExerciseCatalog();
  const editingExercise = exercise
    ? (catalog.exercises.find((candidate) => candidate.id === exercise.exerciseDefinitionId) ?? null)
    : null;
  const [recordsRevision, setRecordsRevision] = useState(0);
  const currentGymId = draft.state.status === 'ready' ? draft.state.gymId : null;
  const [listPreferences] = useExerciseListPreferences();
  const { values: trainingPreferences } = useAccountLocalPreferenceState();
  const isFilteredByGym = isGymFiltered(listPreferences.pastRecordsGymScope, currentGymId);
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
  const [blockNotice, setBlockNotice] = useState<string | null>(null);
  // The sourced card's block state: Complete block is offered while the
  // block is still pending, never after it is resolved.
  const [blockStatus, setBlockStatus] = useState<'pending' | 'resolved' | null>(null);
  const reorderWriteRef = useRef(false);
  const weightInputRef = useRef<TextInputInstance>(null);

  // The sourced card's block state decides whether Complete block is
  // offered at all: a block that is already resolved never offers it again.
  const sourcePlanExerciseId = exercise?.sourcePlanExerciseId ?? null;
  useEffect(() => {
    if (sourcePlanExerciseId === null) {
      return;
    }
    let cancelled = false;
    void loadPlanBlockProgressStatus(sourcePlanExerciseId).then((status) => {
      if (cancelled) return;
      // Settled asynchronously, so the effect never sets state synchronously.
      setBlockStatus(status === 'pending' ? 'pending' : status === 'not-found' ? null : 'resolved');
    });
    return () => {
      cancelled = true;
    };
  }, [sourcePlanExerciseId]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(FALLBACK_BACK_ROUTE);
  }, [router]);

  const sets = useMemo(() => exercise?.sets ?? [], [exercise]);
  const setOrderIds = useMemo(() => sets.map((set) => set.id), [sets]);
  const reorder = useSetReorder(setOrderIds);
  const bodyWeight = draft.state.status === 'ready' ? draft.state.bodyWeight : EMPTY_SESSION_WEIGHT;
  const loadContext = personalCalculationContext(
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
  // While a drag is live the rows render in the drag's order; otherwise the
  // persisted order — a failed write just clears the overlay, restoring it.
  const orderedSets = reorder.dragOrder
    ? reorder.dragOrder
        .map((id) => sets.find((set) => set.id === id))
        .filter((set) => set !== undefined)
    : sets;
  const rows = buildSetRows(orderedSets, baseline, loadContext, recordSession);
  const recordLines = recordBandFor(sets, baseline, loadContext, recordSession);
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
    const next = addSet(sets, undefined, trainingPreferences.displayEfforts);
    const added = next[next.length - 1];
    updateSets(() => next, 'structural');
    setOpenSetId(added?.id ?? null);
    // Ready to overwrite the copied weight.
    requestAnimationFrame(() => weightInputRef.current?.focus());
  };

  /**
   * Swipe right on the in-progress set (`ux-rules.md` "Swipes on the exercise page"):
   * confirm it and move on — the same write as the tick. On the last set, the deterministic
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
    const next = addSet(committed, undefined, trainingPreferences.displayEfforts);
    updateSets(() => next, 'structural');
    setOpenSetId(next[next.length - 1]?.id ?? null);
    requestAnimationFrame(() => weightInputRef.current?.focus());
  };

  /**
   * Swipe left on the open set (`ux-rules.md` "Swipes on the exercise page"):
   * drop it (`dropSet`) — an ad-hoc row is removed and the logger falls back
   * to the cursor; a touched planned row reads as its plan again and stays
   * open. Never navigates.
   */
  const onSwipeLeft = (setId: string) => {
    Keyboard.dismiss();
    const next = dropSet(sets, setId);
    if (next === sets) return;
    updateSets(() => next, 'structural');
    if (!next.some((set) => set.id === setId)) setOpenSetId(null);
  };

  /**
   * A committed drag drop or Move earlier/later, persisted through the
   * reorder operation — never the draft graph, so the two writers cannot
   * race. Pending edits flush first; the overlay (a drag's live order)
   * settles onto the write's result: reload on success, clear on failure,
   * which restores the prior order exactly. One write at a time: overlapping
   * moves queue nowhere — a second is dropped while the first is in flight.
   */
  const persistSetReorder = async (orderedIds: string[], announcement?: string) => {
    if (reorderWriteRef.current) {
      return;
    }
    reorderWriteRef.current = true;
    try {
      if (isSameOrder(orderedIds, setOrderIds)) {
        reorder.clearDrag();
        return;
      }
      if (announcement) reorder.announce(announcement);
      if (!(await draft.flush())) {
        reorder.clearDrag();
        reorder.announce('Not saved. The previous order stays.');
        return;
      }
      const result = await reorderSessionExerciseSets(sessionExerciseId, orderedIds);
      if (result.status !== 'reordered') {
        reorder.clearDrag();
        reorder.announce("Couldn't save the new order. The previous order stays.");
        return;
      }
      // The reload is the only thing that moves the rows: a failed reload
      // keeps the local order as it was and says so, rather than leaving the
      // page reading something the store does not.
      if (!(await draft.reload())) {
        reorder.clearDrag();
        reorder.announce("Couldn't save the new order. The previous order stays.");
        return;
      }
      reorder.clearDrag();
    } finally {
      reorderWriteRef.current = false;
    }
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

  /**
   * Complete block: the sourced card's explicit resolution — the only
   * operation that advances the plan block, never attachment or confirming
   * alone. A refusal (no confirmed source-derived set yet) says so inline
   * and the recorder stays open.
   */
  const onCompleteBlock = () => {
    setOpenSheet('none');
    const sourceId = exercise?.sourcePlanExerciseId;
    if (!sourceId) return;
    void completePlanBlock(sourceId).then((result) => {
      setBlockNotice(blockResolutionNotice(result.status, blockStatus));
    });
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
            {blockNotice ? (
              <Notice live message={blockNotice} testID="exercise-block-notice" tone="neutral" />
            ) : null}
            <RecordBand lines={recordLines} placement="header" testID="exercise-record-band" />
            {reorder.announcement ? (
              <Text
                allowFontScaling={false}
                accessibilityLiveRegion="polite"
                style={styles.reorderAnnouncement}
                testID="exercise-set-reorder-announcement">
                {reorder.announcement}
              </Text>
            ) : null}
            <SetReorderList
              controller={reorder}
              items={rows}
              onReorder={(orderedIds, announcement) => void persistSetReorder(orderedIds, announcement)}
              renderRow={(row, index, reorderProps) => (
                <ExerciseSetRowItem
                  allSets={sets}
                  index={index}
                  loadContext={loadContext}
                  loggerValues={loggerValues}
                  nextSessionSetType={(setType) => nextSessionSetType(setType, trainingPreferences.displayEfforts)}
                  onChangeLogger={onChangeLogger}
                  onCommit={onCommit}
                  onCycleEffort={onSelectEffort}
                  onOpenEffort={() => setOpenSheet('effort')}
                  onOpenRow={setOpenSetId}
                  onSwipeLeft={onSwipeLeft}
                  onSwipeRight={onSwipeRight}
                  onToggleRow={onToggle}
                  openSetId={openSet?.id ?? null}
                  reorder={reorderProps}
                  row={row}
                  weightInputRef={weightInputRef}
                />
              )}
              testID="exercise-set-list-rows"
            />
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
        onCompleteBlock={
          exercise.sourcePlanExerciseId != null && blockStatus !== 'resolved' ? onCompleteBlock : undefined
        }
        onDismiss={() => setOpenSheet('none')}
        onEdit={() => { void draft.flush().then(saved => { if (saved) setOpenSheet('edit'); }); }}
        onLink={
          groupLinkingUserId && exercise.exerciseDefinitionId
            ? () => {
                setOpenSheet('none');
                // Pending edits are written before the Link screen opens, so
                // linking mid-session cannot race the autosave debounce and
                // the session is left exactly as it reads.
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
  // The VoiceOver result of a Move earlier/later, read aloud only.
  reorderAnnouncement: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
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
