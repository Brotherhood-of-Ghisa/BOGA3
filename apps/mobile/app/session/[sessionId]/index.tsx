import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { useOpenMainTab } from '@/components/navigation/use-open-main-tab';
import type { Session } from '@/components/session-recorder/types';
import {
  SessionExerciseCard,
  SessionGymSheet,
  SessionOptionsSheet,
  SessionSummaryCard,
  SessionTopBar,
} from '@/components/session-view';
import { ActionButton } from '@/components/ui/action-button';
import { Screen, ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import { sessionAddExerciseHref, sessionCompareHref, sessionExerciseHref } from '@/src/navigation/active-session-entry';
import { mainTabHref } from '@/src/navigation/main-tabs';
import { GYMS_ROUTE } from '@/src/navigation/routes';
import { findNearbyGym } from '@/src/location/gym-location-reads';
import { activeGymOptions, listGymDirectory, type SessionGymOption } from '@/src/session-recorder/gym-options';
import {
  abandonActiveSession,
  completeActiveSession,
  loadActiveSessionGraph,
  loadEditableSessionGraph,
  saveCompletedSessionEdit,
  setCompletedSessionTimes,
  setSessionGym,
} from '@/src/session-recorder/session-lifecycle';
import {
  describeSubmitCleanupPrompt,
  nextSubmitCleanup,
  sessionHasInvalidSetValues,
  SUBMIT_CLEANUP_CANCEL_LABEL,
  type SubmitCleanupResult,
} from '@/src/session-recorder/session-model';
import { buildSessionViewModel } from '@/src/session-recorder/session-view-model';
import { useCompletedSessionTimes } from '@/src/session-recorder/use-completed-session-times';
import { useSessionView } from '@/src/session-recorder/use-session-view';

const TRAIN_ROUTE = mainTabHref('train');

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

// Resolves true when the user confirms. Dismissing the alert (Android back,
// tapping outside) is a cancel.
const confirmAlert = (input: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}): Promise<boolean> =>
  new Promise((resolve) => {
    Alert.alert(
      input.title,
      input.message,
      [
        { text: input.cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: input.confirmLabel,
          style: input.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });

// Blocks on invalid set values, then walks the submit cleanup prompts (`session-model.ts`).
// Resolves the completed-history session, or `null` when the user stops.
const confirmSubmitCleanup = async (
  session: Session,
  mode: 'active' | 'completed-edit'
): Promise<Session | null> => {
  if (sessionHasInvalidSetValues(session)) {
    const names = session.exercises
      .filter((exercise) => sessionHasInvalidSetValues({ ...session, exercises: [exercise] }))
      .map((exercise) => exercise.name);
    Alert.alert(
      mode === 'active' ? "Can't finish yet" : "Can't save yet",
      `Fix the set values in ${names.join(', ')} first.`
    );
    return null;
  }

  let cleanup: SubmitCleanupResult = nextSubmitCleanup(session);
  while (cleanup.kind === 'prompt') {
    const copy = describeSubmitCleanupPrompt(cleanup.prompt, mode);
    const confirmed = await confirmAlert({ ...copy, cancelLabel: SUBMIT_CLEANUP_CANCEL_LABEL });
    if (!confirmed) return null;
    cleanup = nextSubmitCleanup(cleanup.prompt.nextSession);
  }
  return cleanup.session;
};

type GymPickerState = {
  visible: boolean;
  options: SessionGymOption[] | null;
  suggestion: SessionGymOption | null;
};

const CLOSED_GYM_PICKER: GymPickerState = { visible: false, options: null, suggestion: null };

export type SessionViewScreenProps = {
  sessionId: string | null;
};

/**
 * The session view (`ux-rules` §14b): the active session, read-only and
 * navigational. Each exercise card links to its exercise page, where editing
 * happens; Finish and Abandon run the session lifecycle
 * (`src/session-recorder/session-lifecycle.ts`), and Add exercise opens the
 * exercise picker's route (`add-exercise`, a page sheet). Every
 * active-session entry in the app opens it.
 *
 * A completed session opens here to be edited (History, completed-session
 * `Edit`): Start/End replace the elapsed Time, and Done — the
 * completed-edit save — replaces Finish and Abandon. It never replays
 * completion.
 */
export function SessionViewScreen({ sessionId }: SessionViewScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, reload } = useSessionView(sessionId);
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);
  const [gymPicker, setGymPicker] = useState<GymPickerState>(CLOSED_GYM_PICKER);
  // Bumped on every open and close, so a lookup that resolves after the sheet
  // has closed (or reopened) is dropped.
  const gymPickerGenerationRef = useRef(0);
  const restoreGymPickerOnFocusRef = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const completedTimes = useMemo(
    () =>
      state.status === 'ready' && state.data.status === 'completed' && state.data.completedAt
        ? { startedAt: state.data.startedAt, completedAt: state.data.completedAt }
        : null,
    [state]
  );
  const times = useCompletedSessionTimes({
    sessionId,
    persisted: completedTimes,
    // Records count the sessions before End, so a saved End re-reads them.
    save: async (id, nextTimes) => {
      await setCompletedSessionTimes(id, nextTimes);
      await reload();
    },
  });

  const model = useMemo(
    () =>
      state.status === 'ready'
        ? buildSessionViewModel(state.data.session, state.data.recordBaselineByDefinitionId)
        : null,
    [state]
  );

  const openGymPicker = useCallback(() => {
    const generation = ++gymPickerGenerationRef.current;
    const isCurrent = () => gymPickerGenerationRef.current === generation;
    setGymPicker({ visible: true, options: null, suggestion: null });
    listGymDirectory()
      .then((directory) => {
        if (!isCurrent()) return;
        const options = activeGymOptions(directory);
        setGymPicker((current) => ({ ...current, options }));
        // Suggest only: a confident match becomes the sheet's first row and is
        // never selected for the lifter. The permission prompt, when one is
        // due, first appears here.
        const candidates = directory.filter((gym) => !gym.archived);
        return findNearbyGym(candidates).then((nearby) => {
          if (!isCurrent() || !nearby) return;
          setGymPicker((current) => ({ ...current, suggestion: { id: nearby.id, name: nearby.name } }));
        });
      })
      .catch(() => {
        if (!isCurrent()) return;
        setGymPicker(CLOSED_GYM_PICKER);
        setNotice("Couldn't load your gyms. Try again.");
      });
  }, []);

  const closeGymPicker = () => {
    gymPickerGenerationRef.current += 1;
    setGymPicker(CLOSED_GYM_PICKER);
  };

  // Back from the Gyms screen: the gym sheet reopens with the list reloaded.
  useFocusEffect(
    useCallback(() => {
      if (restoreGymPickerOnFocusRef.current) {
        restoreGymPickerOnFocusRef.current = false;
        openGymPicker();
      }
    }, [openGymPicker])
  );

  const openTab = useCallback((href: Href) => router.dismissTo(href), [router]);
  const openMainTab = useOpenMainTab(openTab);

  const finish = async () => {
    if (!sessionId || isFinishing) return;
    setIsFinishing(true);
    setNotice(null);
    try {
      // Read at press time, so the last write from the exercise page counts.
      const graph = await loadActiveSessionGraph(sessionId);
      if (!graph) {
        await reload();
        return;
      }
      const completedHistorySession = await confirmSubmitCleanup(graph.session, 'active');
      if (!completedHistorySession) return;

      const completedSessionId = await completeActiveSession({
        sessionId: graph.sessionId,
        gymId: graph.gymId,
        startedAt: graph.startedAt,
        completedHistorySession,
      });
      router.replace(`/completed-session/${completedSessionId}?presentation=completion` as Href);
    } catch {
      setNotice("Couldn't finish this session. Try again.");
    } finally {
      setIsFinishing(false);
    }
  };

  // Done on a completed session: the completed-edit save (valid
  // times, set values and cleanup prompts, confirmed rows only), then back to
  // where the edit was opened from.
  const saveEdit = async () => {
    if (!sessionId || isSavingEdit) return;
    setNotice(null);
    const editedTimes = times.submit();
    if (!editedTimes) return;
    setIsSavingEdit(true);
    try {
      if (!(await times.flush())) {
        setNotice("Couldn't save the times. Try again.");
        return;
      }
      // Read at press time, so the last write from the exercise page counts.
      const graph = await loadEditableSessionGraph(sessionId);
      if (!graph || graph.status !== 'completed') {
        await reload();
        return;
      }
      const completedHistorySession = await confirmSubmitCleanup(graph.session, 'completed-edit');
      if (!completedHistorySession) return;

      await saveCompletedSessionEdit({
        sessionId: graph.sessionId,
        gymId: graph.gymId,
        times: editedTimes,
        completedHistorySession,
      });
      if (router.canGoBack()) router.back();
      else router.replace(`/completed-session/${encodeURIComponent(graph.sessionId)}` as Href);
    } catch {
      setNotice("Couldn't save this session. Try again.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const abandon = async () => {
    if (!sessionId) return;
    // Asked over the open sheet: iOS drops an alert raised while a modal closes.
    const confirmed = await confirmAlert({
      title: 'Abandon session?',
      message: 'This session and everything logged in it will be deleted.',
      confirmLabel: 'Abandon',
      cancelLabel: 'Keep session',
      destructive: true,
    });
    setIsOptionsVisible(false);
    if (!confirmed) return;
    try {
      await abandonActiveSession(sessionId);
      openTab(TRAIN_ROUTE);
    } catch {
      setNotice("Couldn't abandon this session. Try again.");
    }
  };

  const openCompare = () => {
    setIsOptionsVisible(false);
    if (sessionId) router.push(sessionCompareHref(sessionId));
  };

  const openGymsScreen = () => {
    restoreGymPickerOnFocusRef.current = true;
    closeGymPicker();
    router.push(GYMS_ROUTE as Href);
  };

  const selectGym = async (gym: SessionGymOption | null) => {
    closeGymPicker();
    if (!sessionId) return;
    setNotice(null);
    try {
      await setSessionGym(sessionId, gym);
    } catch {
      setNotice("Couldn't change the gym. Try again.");
    }
    await reload();
  };

  let body: ReactNode;
  if (state.status === 'loading') {
    body = <StatePanel kind="loading" testID="session-view-loading" />;
  } else if (state.status === 'missing' || state.status === 'error' || !sessionId) {
    body =
      state.status === 'error' ? (
        <StatePanel
          action={{ label: 'Retry', onPress: () => void reload(), testID: 'session-view-retry' }}
          kind="error"
          testID="session-view-error"
          title="Couldn't load this session."
        />
      ) : (
        <StatePanel
          action={{ label: 'Back to Train', onPress: () => openTab(TRAIN_ROUTE), testID: 'session-view-back' }}
          testID="session-view-missing"
          title="This session is no longer active."
        />
      );
  } else if (model) {
    const data = state.data;
    body = (
      <ScreenScroll keyboardShouldPersistTaps="handled" testID="session-view-scroll">
        <SessionSummaryCard
          exerciseCount={model.cards.length}
          gymName={data.gymName}
          onPressGym={openGymPicker}
          workingSetCount={model.workingSetCount}
          times={
            data.status === 'completed'
              ? {
                  text: times.text,
                  errors: times.errors,
                  notice: times.notice ?? (times.saveError ? `Not saved: ${times.saveError}` : null),
                  onChangeStart: times.setStart,
                  onChangeEnd: times.setEnd,
                  onCommitStart: times.commitStart,
                  onCommitEnd: times.commitEnd,
                }
              : undefined
          }
          volume={model.volume}
          volumeNote={model.volumeNote}
        />
        {model.cards.map((card) => (
          <SessionExerciseCard
            card={card}
            key={card.id}
            onPress={() => router.push(sessionExerciseHref(data.sessionId, card.id))}
          />
        ))}
        <ActionButton
          label="+ Add exercise"
          onPress={() => router.push(sessionAddExerciseHref(data.sessionId))}
          testID="session-view-add-exercise"
          variant="outline"
        />
        {notice ? (
          <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={styles.notice} testID="session-view-notice">
            {notice}
          </Text>
        ) : null}
      </ScreenScroll>
    );
  }

  const isCompleted = state.status === 'ready' && state.data.status === 'completed';

  return (
    <Screen testID="session-view-screen">
      {/* A workout in progress is left by the tab bar, not the back gesture:
          Train opens the workout in progress, so going back to it would only
          come straight back here. */}
      <Stack.Screen options={{ gestureEnabled: isCompleted }} />
      {state.status === 'ready' ? (
        isCompleted ? (
          <SessionTopBar doneDisabled={isSavingEdit} mode="completed" onDone={() => void saveEdit()} />
        ) : (
          <SessionTopBar
            finishDisabled={isFinishing}
            mode="active"
            startedAt={state.data.startedAt}
            onFinish={() => void finish()}
            onOpenOptions={() => setIsOptionsVisible(true)}
          />
        )
      ) : (
        <View style={[styles.statusSpacer, { paddingTop: insets.top }]} />
      )}
      {body}
      {/* A completed session is history, which lives under Progress. */}
      {/* Train while this workout is in progress is this screen: nothing to open. */}
      <MainTabBar
        activeTab={isCompleted ? 'progress' : 'train'}
        onSelect={(tab) => (tab === 'train' && !isCompleted ? undefined : openMainTab(tab))}
      />

      <SessionOptionsSheet
        onAbandon={() => void abandon()}
        onCompare={openCompare}
        onDismiss={() => setIsOptionsVisible(false)}
        visible={isOptionsVisible}
      />
      <SessionGymSheet
        onDismiss={closeGymPicker}
        onManage={openGymsScreen}
        onSelect={(gym) => void selectGym(gym)}
        options={gymPicker.options}
        selectedGymId={state.status === 'ready' ? state.data.gymId : null}
        suggestion={gymPicker.suggestion}
        visible={gymPicker.visible}
      />
    </Screen>
  );
}

export default function SessionViewRoute() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  return <SessionViewScreen sessionId={coerceParam(params.sessionId)} />;
}

const styles = StyleSheet.create({
  statusSpacer: {
    backgroundColor: uiRoles.surface,
  },
  notice: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
});
