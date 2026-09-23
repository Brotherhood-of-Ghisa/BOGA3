import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MainTabs } from '@/components/navigation/main-tabs';
import { ExercisePicker } from '@/components/session-recorder/exercise-picker';
import {
  OutlineButton,
  SessionExerciseCard,
  SessionGymSheet,
  SessionOptionsSheet,
  SessionSummaryCard,
  SessionTopBar,
} from '@/components/session-view';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ExerciseBlockHistorySuggestedPlan } from '@/src/data';
import { sessionExerciseHref } from '@/src/navigation/active-session-entry';
import { mainTabHref } from '@/src/navigation/main-tabs';
import { listSessionGymOptions, type SessionGymOption } from '@/src/session-recorder/gym-options';
import {
  abandonActiveSession,
  addExerciseToActiveSession,
  appendPlanToActiveSession,
  completeActiveSession,
  loadActiveSessionGraph,
  setActiveSessionGym,
} from '@/src/session-recorder/session-lifecycle';
import {
  describeSubmitCleanupPrompt,
  nextSubmitCleanup,
  sessionHasInvalidSetValues,
  SUBMIT_CLEANUP_CANCEL_LABEL,
} from '@/src/session-recorder/session-model';
import { buildSessionViewModel } from '@/src/session-recorder/session-view-model';
import { useSessionView } from '@/src/session-recorder/use-session-view';

const TRAIN_ROUTE = mainTabHref('train');
const EXERCISE_CATALOG_MANAGE_ROUTE = '/exercise-catalog?source=session-recorder&intent=manage' as Href;

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

export type SessionViewScreenProps = {
  sessionId: string | null;
};

/**
 * The session view (redesign step 5): the active session, read-only and
 * navigational. Each exercise card links to its exercise page, where editing
 * happens; Finish and Abandon run the recorder's own lifecycle
 * (`src/session-recorder/session-lifecycle.ts`), and Add exercise the
 * recorder's picker. Reached from the app's active-session entries while the
 * new exercise/session screens setting is on.
 */
export function SessionViewScreen({ sessionId }: SessionViewScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, reload } = useSessionView(sessionId);
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);
  const [gymPicker, setGymPicker] = useState<{ visible: boolean; options: SessionGymOption[] | null }>({
    visible: false,
    options: null,
  });
  const [picker, setPicker] = useState({ visible: false, openRequestId: 0 });
  const [isFinishing, setIsFinishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const restorePickerOnFocusRef = useRef(false);

  const model = useMemo(
    () =>
      state.status === 'ready'
        ? buildSessionViewModel(state.data.session, state.data.historicalBestByDefinitionId)
        : null,
    [state]
  );

  // Back from Manage: the picker returns as it was left, like the recorder's.
  useFocusEffect(
    useCallback(() => {
      if (restorePickerOnFocusRef.current) {
        restorePickerOnFocusRef.current = false;
        setPicker((current) => ({ ...current, visible: true }));
      }
    }, [])
  );

  const openTab = (href: Href) => router.dismissTo(href);

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
      if (sessionHasInvalidSetValues(graph.session)) {
        const names = graph.session.exercises
          .filter((exercise) => sessionHasInvalidSetValues({ ...graph.session, exercises: [exercise] }))
          .map((exercise) => exercise.name);
        Alert.alert("Can't finish yet", `Fix the set values in ${names.join(', ')} first.`);
        return;
      }

      let cleanup = nextSubmitCleanup(graph.session);
      while (cleanup.kind === 'prompt') {
        const copy = describeSubmitCleanupPrompt(cleanup.prompt, 'active');
        const confirmed = await confirmAlert({ ...copy, cancelLabel: SUBMIT_CLEANUP_CANCEL_LABEL });
        if (!confirmed) return;
        cleanup = nextSubmitCleanup(cleanup.prompt.nextSession);
      }

      const completedSessionId = await completeActiveSession({
        sessionId: graph.sessionId,
        gymId: graph.gymId,
        startedAt: graph.startedAt,
        completedHistorySession: cleanup.session,
      });
      router.replace(`/completed-session/${completedSessionId}?presentation=completion` as Href);
    } catch {
      setNotice("Couldn't finish this session. Try again.");
    } finally {
      setIsFinishing(false);
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

  const openGymPicker = () => {
    setGymPicker({ visible: true, options: null });
    listSessionGymOptions()
      .then((options) => setGymPicker((current) => ({ ...current, options })))
      .catch(() => {
        setGymPicker({ visible: false, options: null });
        setNotice("Couldn't load your gyms. Try again.");
      });
  };

  const selectGym = async (gym: SessionGymOption | null) => {
    setGymPicker({ visible: false, options: null });
    if (!sessionId) return;
    setNotice(null);
    try {
      await setActiveSessionGym(sessionId, gym);
    } catch {
      setNotice("Couldn't change the gym. Try again.");
    }
    await reload();
  };

  const hidePicker = () => setPicker((current) => ({ ...current, visible: false }));

  const runPickerWrite = async (write: () => Promise<unknown>) => {
    hidePicker();
    setNotice(null);
    try {
      await write();
    } catch {
      setNotice("Couldn't add that exercise. Try again.");
    }
    await reload();
  };

  const addExercise = (exerciseDefinitionId: string, exerciseName: string) => {
    if (!sessionId) return;
    void runPickerWrite(() =>
      addExerciseToActiveSession(sessionId, { id: exerciseDefinitionId, name: exerciseName })
    );
  };

  const appendPlan = (exercise: { id: string; name: string }, suggestion: ExerciseBlockHistorySuggestedPlan) => {
    if (!sessionId) return;
    void runPickerWrite(() => appendPlanToActiveSession(sessionId, exercise, suggestion));
  };

  const openManage = () => {
    restorePickerOnFocusRef.current = true;
    hidePicker();
    router.push(EXERCISE_CATALOG_MANAGE_ROUTE);
  };

  let body: ReactNode;
  if (state.status === 'loading') {
    body = (
      <View style={styles.state} testID="session-view-loading">
        <ActivityIndicator color={uiRoles.inkMuted} />
      </View>
    );
  } else if (state.status === 'missing' || state.status === 'error' || !sessionId) {
    body = (
      <View style={styles.state} testID={state.status === 'error' ? 'session-view-error' : 'session-view-missing'}>
        <Text style={styles.stateText}>
          {state.status === 'error' ? "Couldn't load this session." : 'This session is no longer active.'}
        </Text>
        {state.status === 'error' ? (
          <OutlineButton label="Retry" onPress={() => void reload()} testID="session-view-retry" />
        ) : (
          <OutlineButton label="Back to Train" onPress={() => openTab(TRAIN_ROUTE)} testID="session-view-back" />
        )}
      </View>
    );
  } else if (model) {
    const data = state.data;
    body = (
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="session-view-scroll">
        <SessionSummaryCard
          gymName={data.gymName}
          onPressGym={openGymPicker}
          performedSetCount={model.performedSetCount}
          startedAt={data.startedAt}
          volume={model.volume}
        />
        {model.cards.map((card) => (
          <SessionExerciseCard
            card={card}
            key={card.id}
            onPress={() => router.push(sessionExerciseHref(data.sessionId, card.id))}
          />
        ))}
        <OutlineButton
          label="+ Add exercise"
          onPress={() => setPicker((current) => ({ visible: true, openRequestId: current.openRequestId + 1 }))}
          testID="session-view-add-exercise"
        />
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice} testID="session-view-notice">
            {notice}
          </Text>
        ) : null}
      </ScrollView>
    );
  }

  const isReady = state.status === 'ready';

  return (
    <View style={styles.screen} testID="session-view-screen">
      {isReady ? (
        <SessionTopBar
          finishDisabled={isFinishing}
          onFinish={() => void finish()}
          onOpenOptions={() => setIsOptionsVisible(true)}
        />
      ) : (
        <View style={[styles.statusSpacer, { paddingTop: insets.top }]} />
      )}
      {body}
      <View style={[styles.tabs, { paddingBottom: Math.max(uiSpace.sm, insets.bottom) }]}>
        <MainTabs activeTab="train" onSelect={(tab) => openTab(mainTabHref(tab))} />
      </View>

      <SessionOptionsSheet
        onAbandon={() => void abandon()}
        onDismiss={() => setIsOptionsVisible(false)}
        visible={isOptionsVisible}
      />
      <SessionGymSheet
        onDismiss={() => setGymPicker({ visible: false, options: null })}
        onSelect={(gym) => void selectGym(gym)}
        options={gymPicker.options}
        selectedGymId={state.status === 'ready' ? state.data.gymId : null}
        visible={gymPicker.visible}
      />
      <ExercisePicker
        mode="add"
        onAppendPlan={appendPlan}
        onDismiss={hidePicker}
        onOpenManage={openManage}
        onSelectExercise={addExercise}
        openRequestId={picker.openRequestId}
        visible={picker.visible}
      />
    </View>
  );
}

export default function SessionViewRoute() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  return <SessionViewScreen sessionId={coerceParam(params.sessionId)} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  statusSpacer: {
    backgroundColor: uiRoles.surface,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.md,
    padding: uiSpace.lg,
  },
  stateText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.inkMuted,
    textAlign: 'center',
  },
  notice: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
  tabs: {
    paddingHorizontal: uiSpace.sm,
    paddingTop: uiSpace.sm,
  },
});
