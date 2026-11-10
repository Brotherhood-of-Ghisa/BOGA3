import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { useOpenMainTabFromPage } from '@/components/navigation/use-open-main-tab';
import { RestTimerBar } from '@/components/session-recorder/rest-timer-bar';
import { useTitleBarTimer } from '@/components/session-recorder/title-bar-timer';
import type { Session } from '@/components/session-recorder/types';
import { SessionExerciseCard } from '@/components/session-view/session-exercise-card';
import { SessionGymSheet } from '@/components/session-view/session-gym-sheet';
import { SessionOptionsSheet } from '@/components/session-view/session-options-sheet';
import { SessionSummaryCard } from '@/components/session-view/session-summary-card';
import { SessionTopBar } from '@/components/session-view/session-top-bar';
import { ActionButton } from '@/components/ui/action-button';
import { Screen, ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { sessionAddExerciseHref, sessionCompareHref, sessionExerciseHref } from '@/src/navigation/active-session-entry';
import { GYMS_ROUTE } from '@/src/navigation/routes';
import { findNearbyGymSuggestions } from '@/src/location/gym-location-reads';
import {
  beginSessionPosition,
  getSessionPosition,
  getSessionPositionState,
  subscribeSessionPositionState,
  type SessionPositionState,
} from '@/src/location/session-position';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { activeGymOptions, listGymDirectory, type SessionGymOption } from '@/src/session-recorder/gym-options';
import { useSessionRestTimer } from '@/src/session-recorder/rest-timer';
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
import { useWorkoutControl } from '@/src/session-recorder/use-workout-control';
import { WorkoutChangesSavedForReview, WorkoutLifecycleChanged } from '@/src/data/session-edit-baseline';

const isActiveSessionReady = (state: { status: string; data?: { status: string } }): boolean =>
  state.status === 'ready' && state.data?.status !== 'completed';

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
  suggestions: SessionGymOption[];
};

const CLOSED_GYM_PICKER: GymPickerState = { visible: false, options: null, suggestions: [] };

// When Train returns to its disc: now, or once Finish's summary has closed
// (it fades in over Train, so the disc must not show through).
export type WorkoutEndMoment = 'now' | 'on-return';

export type SessionViewScreenProps = {
  sessionId: string | null;
} & (
  // The workout in progress, shown by the Train tab in place of its Start
  // disc. Abandon, Finish and a session no longer active end it there:
  // `onEnded` returns Train to its disc.
  | { placement: 'tab'; onEnded: (moment: WorkoutEndMoment) => void }
  // Pushed over the tabs: a completed session's edit, with its own tab bar.
  | { placement: 'page' }
);

function SessionViewBody({ state, sessionId, model, times, control, reload, endWorkout, openGymPicker, router, notice }: {
  state: ReturnType<typeof useSessionView>['state']; sessionId: string | null;
  model: ReturnType<typeof buildSessionViewModel> | null;
  times: ReturnType<typeof useCompletedSessionTimes>;
  control: Pick<ReturnType<typeof useWorkoutControl>, 'blocked'>;
  reload: () => Promise<void>; endWorkout: () => void; openGymPicker: () => void;
  router: ReturnType<typeof useRouter>; notice: string | null;
}): ReactNode {
  const text = useUiText();
  const tone = useUiTextTone();
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
          action={{ label: 'Back to Train', onPress: endWorkout, testID: 'session-view-back' }}
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
          onPressGym={control.blocked ? undefined : openGymPicker}
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
        />
        {model.cards.map((card) => (
          <SessionExerciseCard
            card={card}
            key={card.id}
            onPress={control.blocked ? undefined : () => router.push(sessionExerciseHref(data.sessionId, card.id))}
          />
        ))}
        {!control.blocked ? <ActionButton
          label="+ Add exercise"
          onPress={() => router.push(sessionAddExerciseHref(data.sessionId))}
          testID="session-view-add-exercise"
          variant="outline"
        /> : null}
        {notice ? (
          <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[text.bodyStrong, tone.danger]} testID="session-view-notice">
            {notice}
          </Text>
        ) : null}
      </ScreenScroll>
    );
  }

  return body ?? null;
}

/**
 * The session view: the active session, read-only and
 * navigational. Each exercise card links to its exercise page, where editing
 * happens; Finish and Abandon run the session lifecycle
 * (`src/session-recorder/session-lifecycle.ts`), and Add exercise opens the
 * exercise picker's route (`add-exercise`, a page sheet). The workout in
 * progress lives on the Train tab (`placement: 'tab'`), so switching tabs
 * mid-workout is a tab switch, not a push or a pop.
 *
 * A completed session opens here as a page to be edited (History, completed-session
 * `Edit`): Start/End replace the elapsed Time, and Done — the
 * completed-edit save — replaces Finish and Abandon. It never replays
 * completion.
 */
export function SessionViewScreen(props: SessionViewScreenProps) {
  const { sessionId } = props;
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, reload } = useSessionView(sessionId);
  const control = useWorkoutControl(sessionId, state.status === 'ready' ? state.data.session.editBaseline : undefined, reload);
  const { values: trainingPreferences } = useAccountLocalPreferenceState();
  const developerMode = trainingPreferences.developerMode;
  const restTimer = useSessionRestTimer(sessionId, {
    defaultDurationSec: trainingPreferences.restTimerDurationSec,
    defaultRepeatingIntervalSec: trainingPreferences.repeatingTimerIntervalSec,
    autoStart: trainingPreferences.restTimerAutoStart,
    isActiveSession: isActiveSessionReady(state),
  });
  const timerHost = useTitleBarTimer(restTimer, trainingPreferences.timerInTitleBar);
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);
  const [gymPicker, setGymPicker] = useState<GymPickerState>(CLOSED_GYM_PICKER);
  // The developer GPS panel's live view of the session's position acquisition;
  // only subscribed while the gym sheet is open.
  const [gpsState, setGpsState] = useState<SessionPositionState | null>(null);
  // Bumped on every open and close, so a lookup that resolves after the sheet
  // has closed (or reopened) is dropped.
  const gymPickerGenerationRef = useRef(0);
  const gymPickerUnsubscribeRef = useRef<(() => void) | null>(null);
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
    revision: state.status === 'ready' ? Number(state.data.session.editBaseline?.find(row => row.type === 'sessions')?.fields.merge_revision ?? 0) : 0,
    // Records count the sessions before End, so a saved End re-reads them.
    save: async (id, nextTimes, baseline) => {
      try { return await setCompletedSessionTimes(id, nextTimes, baseline); }
      finally { await reload(); }
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
    // A session id is what the position cache keys on; nothing to suggest for.
    if (!sessionId || control.blocked) return;
    const generation = ++gymPickerGenerationRef.current;
    const isCurrent = () => gymPickerGenerationRef.current === generation;
    setGymPicker({ visible: true, options: null, suggestions: [] });

    // Suggest only: a nearby gym becomes the sheet's first rows and is never
    // selected for the lifter. The suggestion reads the session's cached fix
    // (`beginSessionPosition`, started when the recorder opened, plus a read
    // here for a completed session being edited) and updates live while the
    // sheet is open. The state listener also feeds the developer GPS panel.
    let directory: Awaited<ReturnType<typeof listGymDirectory>> | null = null;
    let position = getSessionPosition(sessionId);
    const applySuggestions = () => {
      if (!isCurrent() || !directory) return;
      const suggestions = findNearbyGymSuggestions(
        position,
        directory.filter((gym) => !gym.archived)
      ).map(({ id, name }) => ({ id, name }));
      setGymPicker((current) => ({ ...current, suggestions }));
    };
    gymPickerUnsubscribeRef.current?.();
    gymPickerUnsubscribeRef.current = subscribeSessionPositionState(sessionId, (latest) => {
      position = latest.position;
      setGpsState(latest);
      applySuggestions();
    });
    const initialState = getSessionPositionState(sessionId);
    setGpsState(initialState);
    // The sheet has an audience for the fix, so a spent acquisition — one that
    // ran out of its read budget with no fix or only a coarse one — resumes.
    void beginSessionPosition(sessionId, { resume: true });

    listGymDirectory()
      .then((loaded) => {
        if (!isCurrent()) return;
        directory = loaded;
        setGymPicker((current) => ({ ...current, options: activeGymOptions(loaded) }));
        applySuggestions();
      })
      .catch(() => {
        if (!isCurrent()) return;
        gymPickerUnsubscribeRef.current?.();
        gymPickerUnsubscribeRef.current = null;
        setGymPicker(CLOSED_GYM_PICKER);
        setNotice("Couldn't load your gyms. Try again.");
      });
  }, [sessionId, control.blocked]);

  const closeGymPicker = () => {
    gymPickerGenerationRef.current += 1;
    gymPickerUnsubscribeRef.current?.();
    gymPickerUnsubscribeRef.current = null;
    setGymPicker(CLOSED_GYM_PICKER);
    setGpsState(null);
  };

  // The recorder starts acquiring the session's fix the moment it opens, so
  // the gym sheet suggests right away instead of racing a cold GPS read.
  useEffect(() => {
    if (!sessionId || !isActiveSessionReady(state)) return;
    void beginSessionPosition(sessionId);
  }, [sessionId, state]);

  // A subscription left by a sheet that was open at unmount goes too.
  useEffect(
    () => () => {
      gymPickerUnsubscribeRef.current?.();
      gymPickerUnsubscribeRef.current = null;
    },
    []
  );

  // Back from the Gyms screen: the gym sheet reopens with the list reloaded.
  useFocusEffect(
    useCallback(() => {
      if (restoreGymPickerOnFocusRef.current) {
        restoreGymPickerOnFocusRef.current = false;
        openGymPicker();
      }
    }, [openGymPicker])
  );

  const openMainTab = useOpenMainTabFromPage();
  // Back to Train's disc: on the tab, in place; as a page, Train's tab.
  const endWorkout = () => (props.placement === 'tab' ? props.onEnded('now') : openMainTab('train'));

  const finish = async () => {
    if (!sessionId || isFinishing || control.blocked) return;
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
      const completionHref = `/completed-session/${completedSessionId}?presentation=completion` as Href;
      // From the tab, the summary covers the tabs; Train shows its disc on return.
      if (props.placement === 'tab') {
        endedHereRef.current = true;
        router.push(completionHref);
        props.onEnded('on-return');
      } else {
        router.replace(completionHref);
      }
    } catch (error) {
      setNotice(error instanceof WorkoutChangesSavedForReview ? error.message : "Couldn't finish this session. Try again.");
      if (error instanceof WorkoutChangesSavedForReview) await reload();
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
    let editedTimes = times.submit();
    if (!editedTimes) return;
    setIsSavingEdit(true);
    try {
      if (!(await times.flush())) {
        setNotice("Couldn't save the times. Try again.");
        return;
      }
      editedTimes = times.submit();
      if (!editedTimes) return;
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
    } catch (error) {
      setNotice(error instanceof WorkoutChangesSavedForReview ? error.message : "Couldn't save this session. Try again.");
      if (error instanceof WorkoutChangesSavedForReview) await reload();
    } finally {
      setIsSavingEdit(false);
    }
  };

  const abandon = async () => {
    if (!sessionId || control.blocked) return;
    const expectedRevision = state.status === 'ready'
      ? Number(state.data.session.editBaseline?.find(row => row.type === 'sessions')?.fields.merge_revision ?? 0) : 0;
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
      await abandonActiveSession(sessionId, expectedRevision);
      endWorkout();
    } catch (error) {
      setNotice(error instanceof WorkoutLifecycleChanged ? error.message : "Couldn't abandon this session. Try again.");
      await reload();
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

  const isCompleted = state.status === 'ready' && state.data.status === 'completed';

  // On the tab, a workout found completed (finished on another device) is
  // history, not Train's: Train returns to its disc. Not after this screen's
  // own Finish, whose summary covers Train until it closes.
  const endedHereRef = useRef(false);
  const onTabEnded = props.placement === 'tab' ? props.onEnded : null;
  useEffect(() => {
    if (onTabEnded && isCompleted && !endedHereRef.current) onTabEnded('now');
  }, [isCompleted, onTabEnded]);

  return (
    <Screen testID="session-view-screen">
      {/* As a page, a workout in progress is left by the tab bar, not the back
          gesture: it lives on Train. */}
      {props.placement === 'page' ? <Stack.Screen options={{ gestureEnabled: isCompleted }} /> : null}
      {state.status === 'ready' ? (
        isCompleted ? (
          <SessionTopBar doneDisabled={isSavingEdit} mode="completed" onDone={() => void saveEdit()} />
        ) : (
          <SessionTopBar
            aiControlled={control.aiControlled || control.pending}
            controlPending={control.pending}
            finishDisabled={isFinishing || control.blocked}
            mode="active"
            startedAt={state.data.startedAt}
            onFinish={() => void finish()}
            onOpenOptions={() => setIsOptionsVisible(true)}
            onToggleRestTimer={restTimer.toggleForSession}
            restTimerActive={restTimer.isActive}
            titleBarTimer={timerHost.titleBarTimer}
          />
        )
      ) : (
        <View style={[styles.statusSpacer, { paddingTop: insets.top }]} />
      )}
      {timerHost.cardVisible ? (
        <RestTimerBar
          onAdjust={restTimer.adjust}
          onCollapse={timerHost.collapseCard}
          onDismiss={restTimer.dismiss}
          onResetRepeating={restTimer.resetRepeating}
          onRestart={restTimer.restart}
          onSwitchMode={restTimer.switchMode}
          onToggleRepeating={restTimer.toggleRepeating}
          view={restTimer.view}
        />
      ) : null}
      <SessionViewBody control={control} endWorkout={endWorkout} model={model} notice={notice}
        openGymPicker={openGymPicker} reload={reload} router={router} sessionId={sessionId} state={state} times={times} />
      {/* On the tab, the tab layout draws the bar. A completed session is
          history, which lives under Progress. */}
      {props.placement === 'page' ? (
        <MainTabBar activeTab={isCompleted ? 'progress' : 'train'} onSelect={openMainTab} />
      ) : null}

      <SessionOptionsSheet
        control={{ ...control,
          onControl: () => { void control.openControl().then(changed => { if (changed) setIsOptionsVisible(false); }); },
          onChoose: agent => { void control.choose(agent).then(changed => { if (changed) setIsOptionsVisible(false); }); },
          onManageAgents: () => { setIsOptionsVisible(false); control.closeChoices(); router.push('/connected-agents'); },
        }}
        onAbandon={() => void abandon()}
        onCompare={openCompare}
        onDismiss={() => { setIsOptionsVisible(false); control.closeChoices(); }}
        visible={isOptionsVisible}
      />
      <SessionGymSheet
        gpsPanel={developerMode ? {
          state: gpsState,
          nearbyGymCount: gymPicker.options?.length ?? null,
          suggestionCount: gymPicker.suggestions.length,
        } : undefined}
        onDismiss={closeGymPicker}
        onManage={openGymsScreen}
        onSelect={(gym) => void selectGym(gym)}
        options={gymPicker.options}
        selectedGymId={state.status === 'ready' ? state.data.gymId : null}
        suggestions={gymPicker.suggestions}
        visible={gymPicker.visible}
      />
    </Screen>
  );
}

const useStyles = makeStyles((roles) => ({
  statusSpacer: {
    backgroundColor: roles.surface,
  },
}));
