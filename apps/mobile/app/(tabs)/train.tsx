import { useIsFocused, useRouter, type Href } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sessionExerciseHref, type ActiveWorkoutExercise } from '@/src/navigation/active-session-entry';
import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';
import { subscribeOpenedWorkout } from '@/components/navigation/use-open-main-tab';
import { SessionViewScreen, type WorkoutEndMoment } from '@/components/session-view/session-view-screen';
import { useDailyReread } from '@/components/today/use-daily-reread';
import { StartDisc } from '@/components/train';
import {
  ActionButton,
  Card,
  FigureText,
  ScreenScroll,
  StatePanel,
  uiSpace,
  useUiText, useUiTextTone,
} from '@/components/ui';
import {
  DEFAULT_SESSION_ENTRY_COORDINATOR,
  loadActiveSessionId as loadActiveSessionIdFromDatabase,
  type PlannedSessionMaterializer,
  type SessionEntryCoordinator,
  type SessionEntryResult,
} from '@/src/session-entry';
import { isPlanEligibleToStart, planQueries, startSessionPlan } from '@/src/session-planner';
import { useDateFormat } from '@/src/preferences/hooks';
import { isInWindow, startOfLocalDay } from '@/src/utils/local-calendar';
import { formatCompactDate, formatShortDate } from '@/src/utils/local-time';

export type TrainPlanningState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry?: () => void }
  | { status: 'empty'; openManager: () => void }
  | {
      status: 'ready';
      title: string;
      scheduledFor: Date;
      detail: string;
      materialize: PlannedSessionMaterializer;
      openManager: () => void;
    };

export type TrainScreenProps = {
  isFocused?: boolean;
  loadActiveSessionId?: (preferredId?: string | null) => Promise<string | null>;
  planningState?: TrainPlanningState;
  onWorkoutEnded?: () => void;
  sessionEntry?: SessionEntryCoordinator;
  // The workout in progress, drawn in place of the disc; `onEnded` brings the disc back.
  renderWorkout?: (sessionId: string, onEnded: (moment: WorkoutEndMoment) => void) => ReactNode;
};

const renderSessionView = (sessionId: string, onEnded: (moment: WorkoutEndMoment) => void) => (
  <SessionViewScreen key={sessionId} onEnded={onEnded} placement="tab" sessionId={sessionId} />
);

type LaunchKind = 'empty' | 'planned';

type ActiveCheck =
  | { status: 'checking' }
  | { status: 'error'; message: string }
  | { status: 'done'; activeSessionId: string | null };

/**
 * Whether a workout is in progress, read again on every focus as one row
 * (`findActiveSessionId`), never the whole history. A focus marks the check
 * pending in the same render, so the disc never offers a start while a
 * workout may be in progress. The workout last read or opened (`workoutId`)
 * stays shown while a focus re-reads it, so returning to Train mid-workout
 * never blanks the session view; a failed re-read keeps it too. A workout
 * ended under a page that covers Train (Finish's summary) gives way to the
 * disc only once Train is back in focus, so the disc never shows through.
 */
function useActiveSessionCheck(
  isFocused: boolean,
  loadActiveSessionId: (preferredId?: string | null) => Promise<string | null>,
  onWorkoutEnded?: () => void,
) {
  const [check, setCheck] = useState<ActiveCheck>({ status: 'checking' });
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [endsOnReturn, setEndsOnReturn] = useState(false);
  const [checkedFocus, setCheckedFocus] = useState(isFocused);
  const preferredId = useRef<string | null>(null);
  const selectionVersion = useRef(0);
  const prevWorkoutIdRef = useRef<string | null>(null);

  if (checkedFocus !== isFocused) {
    setCheckedFocus(isFocused);
    if (isFocused) setCheck({ status: 'checking' });
    if (isFocused && endsOnReturn) {
      setEndsOnReturn(false);
      setWorkoutId(null);
    }
  }

  useEffect(() => {
    if (!isFocused) return;
    let current = true;
    const version = selectionVersion.current;
    loadActiveSessionId(preferredId.current).then(
      (activeSessionId) => {
        if (!current || version !== selectionVersion.current) return;
        setCheck({ status: 'done', activeSessionId });
        setWorkoutId(activeSessionId);
        preferredId.current = activeSessionId;
      },
      (error: unknown) => {
        if (current) setCheck({ status: 'error', message: error instanceof Error ? error.message : 'Unable to read sessions' });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, isFocused, loadActiveSessionId]);

  useEffect(() => {
    if (prevWorkoutIdRef.current !== null && workoutId === null) {
      onWorkoutEnded?.();
    }
    prevWorkoutIdRef.current = workoutId;
  }, [workoutId, onWorkoutEnded]);

  const retry = () => {
    setCheck({ status: 'checking' });
    setAttempt((value) => value + 1);
  };
  // A workout opened or ended here: known without another read.
  const show = useCallback((activeSessionId: string | null) => {
    selectionVersion.current += 1;
    preferredId.current = activeSessionId;
    setEndsOnReturn(false);
    setCheck({ status: 'done', activeSessionId });
    setWorkoutId(activeSessionId);
    if (activeSessionId === null) {
      onWorkoutEnded?.();
    }
  }, [onWorkoutEnded]);
  const end = (moment: WorkoutEndMoment) => {
    onWorkoutEnded?.();
    if (moment === 'now') return show(null);
    preferredId.current = null;
    selectionVersion.current += 1;
    setEndsOnReturn(true);
  };
  return { check, end, retry, show, workoutId };
}

/**
 * Train, the way into personal training: one large disc that starts an empty
 * workout, and no title (the tab names the page), with the planning section
 * beneath it once planning is available. While a workout is in progress Train
 * is that workout: the session view takes the disc's place, so leaving it for
 * another tab and coming back is a tab switch. Starting one swaps it in;
 * Finish and Abandon swap the disc back.
 */
export function TrainScreen({
  isFocused = true,
  loadActiveSessionId = loadActiveSessionIdFromDatabase,
  planningState = { status: 'unavailable' },
  onWorkoutEnded,
  sessionEntry = DEFAULT_SESSION_ENTRY_COORDINATOR,
  renderWorkout = renderSessionView,
}: TrainScreenProps) {
  const text = useUiText();
  const tone = useUiTextTone();
  const insets = useSafeAreaInsets();
  const launchInFlightRef = useRef(false);
  const [launchError, setLaunchError] = useState<{
    kind: LaunchKind;
    message: string;
  } | null>(null);
  const { check, end, retry, show, workoutId } = useActiveSessionCheck(isFocused, loadActiveSessionId, onWorkoutEnded);
  const router = useRouter();
  const [openedExercise, setOpenedExercise] = useState<(ActiveWorkoutExercise & { sessionId: string; accountRevision: number }) | null>(null);
  // Opened from a page over the tabs: shown before that page slides away.
  useEffect(() => subscribeOpenedWorkout((sessionId, exercise) => {
    show(sessionId);
    setOpenedExercise(exercise ? { ...exercise, sessionId, accountRevision: getAccountLocalPreferenceAccountRevision() } : null);
  }), [show]);
  const handledExercise = useRef<typeof openedExercise>(null);
  // Push only once Train owns focus, so the exercise's Back returns to the workout.
  useEffect(() => {
    if (!isFocused || !openedExercise || handledExercise.current === openedExercise) return;
    handledExercise.current = openedExercise;
    if (openedExercise.accountRevision === getAccountLocalPreferenceAccountRevision()) {
      router.push(sessionExerciseHref(openedExercise.sessionId, openedExercise.sessionExerciseId, openedExercise.setId));
    }
  }, [isFocused, openedExercise, router]);

  // Nothing on screen changes while a workout starts: the press is simply
  // ignored until the session view replaces the disc (or the start fails).
  const openRecorder = async (
    kind: LaunchKind,
    launch: () => Promise<SessionEntryResult>,
  ) => {
    if (launchInFlightRef.current) {
      return;
    }

    launchInFlightRef.current = true;
    setLaunchError(null);
    try {
      const entry = await launch();
      show(entry.sessionId);
    } catch {
      setLaunchError({
        kind,
        message:
          kind === 'empty'
            ? "Couldn't start. Try again."
            : "Couldn't start this plan. Try again.",
      });
    } finally {
      launchInFlightRef.current = false;
    }
  };

  const content = () => {
    if (check.status === 'error') {
      return (
        <View style={styles.stage}>
          <Card style={styles.stretch}>
            <StatePanel
              action={{
                label: 'Retry',
                onPress: retry,
                testID: 'train-session-error-retry',
              }}
              body={check.message}
              fill={false}
              kind="error"
              testID="train-session-error"
              title="Couldn't check your workouts"
            />
          </Card>
        </View>
      );
    }

    // New-session actions wait until the app knows no workout is in progress,
    // without the disc changing while they wait.
    const ready = check.status === 'done' && !check.activeSessionId;
    return (
      <>
        <View style={styles.stage} testID="train-start-section">
          <StartDisc
            accessibilityLabel="Start workout"
            busy={!ready}
            compact={ready && planningState.status === 'ready'}
            label="Start"
            onPress={() => {
              void openRecorder('empty', sessionEntry.startEmptyOrResume);
            }}
            testID="train-start-empty-button"
          />
          {launchError?.kind === 'empty' ? (
            <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[text.bodyStrong, tone.danger, styles.errorText]} testID="train-empty-launch-error">
              {launchError.message}
            </Text>
          ) : null}
        </View>
        {ready ? (
          <TrainPlanning
            launchError={launchError?.kind === 'planned' ? launchError.message : null}
            onStart={(materialize) => {
              void openRecorder('planned', () =>
                sessionEntry.startPlannedOrResume(materialize),
              );
            }}
            planningState={planningState}
          />
        ) : null}
      </>
    );
  };

  // The session view's own top bar clears the status bar; the disc's page does here.
  if (workoutId) return renderWorkout(workoutId, end);

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <ScreenScroll
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        testID="train-screen">
        {content()}
      </ScreenScroll>
    </View>
  );
}

// Beneath the disc, only once planning has something to say: nothing while it
// is unavailable or loading.
function TrainPlanning({
  launchError,
  onStart,
  planningState,
}: {
  launchError: string | null;
  onStart: (materialize: PlannedSessionMaterializer) => void;
  planningState: TrainPlanningState;
}) {
  const dateFormat = useDateFormat();
  const text = useUiText();
  const tone = useUiTextTone();
  if (planningState.status === 'unavailable' || planningState.status === 'loading') {
    return null;
  }

  if (planningState.status === 'error') {
    return (
      <StatePanel
        action={
          planningState.retry
            ? { label: 'Retry', onPress: planningState.retry, testID: 'train-planning-error-retry' }
            : undefined
        }
        body={planningState.message}
        fill={false}
        kind="error"
        testID="train-planning-error"
        title="Couldn't load planning"
      />
    );
  }

  if (planningState.status === 'empty') {
    return (
      <View style={styles.planningLink} testID="train-planning-empty">
        <ActionButton
          label="Plan a workout"
          onPress={planningState.openManager}
          testID="train-manage-planning-button"
          variant="text"
        />
      </View>
    );
  }

  return (
    <View style={styles.planning} testID="train-planning-section">
      <Text allowFontScaling={false} style={text.label}>Planned</Text>
      <Card style={styles.planRow} testID="train-planned-session-card">
        <View style={styles.planCopy}>
          <Text allowFontScaling={false} numberOfLines={1} style={text.bodyStrong}>
            <FigureText strong>{planningState.title}</FigureText>
          </Text>
          <Text
            accessibilityLabel={`${formatShortDate(planningState.scheduledFor, dateFormat)} · ${planningState.detail}`}
            allowFontScaling={false} numberOfLines={1} style={text.meta}>
            <FigureText>{`${formatCompactDate(planningState.scheduledFor, dateFormat)} · ${planningState.detail}`}</FigureText>
          </Text>
        </View>
        <ActionButton
          accessibilityLabel={`Start ${planningState.title}`}
          label="Start"
          onPress={() => onStart(planningState.materialize)}
          testID="train-start-planned-button"
          variant="outline"
        />
      </Card>
      {launchError ? (
        <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[text.bodyStrong, tone.danger, styles.errorText]} testID="train-planned-launch-error">
          {launchError}
        </Text>
      ) : null}
      <View style={styles.planningLink}>
        <ActionButton
          label="Manage planning"
          onPress={planningState.openManager}
          testID="train-manage-planning-button"
          variant="text"
        />
      </View>
    </View>
  );
}

export function useTrainPlanningState({
  isFocused = true,
  reloadToken = 0,
}: {
  isFocused?: boolean;
  reloadToken?: number;
} = {}): TrainPlanningState {
  const router = useRouter();
  const [state, setState] = useState<TrainPlanningState>({ status: 'loading' });
  const generationRef = useRef(0);
  const nowRef = useRef(() => new Date());
  const previousReload = useRef(reloadToken);

  const read = useCallback(function readPlanning() {
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;
    const now = nowRef.current();
    const window = { start: startOfLocalDay(now), end: startOfLocalDay(now, 4) };

    planQueries
      .listUpcomingPlans()
      .then(async (upcoming) => {
        if (!isCurrent()) return;
        const pending = upcoming.filter((plan) => plan.progress !== 'completed'
          && plan.scheduledFor !== null && isInWindow(plan.scheduledFor, window));

        let nextPlan: (typeof pending)[number] | null = null;
        for (const plan of pending) {
          const eligible = await isPlanEligibleToStart(plan.id);
          if (!isCurrent()) return;
          if (eligible) {
            nextPlan = plan;
            break;
          }
        }

        if (!nextPlan?.scheduledFor) {
          setState({
            status: 'empty',
            openManager: () => router.push('/planner' as Href),
          });
          return;
        }

        const counts = nextPlan.blockCounts;
        const totalBlocks = counts.pending + counts.attached + counts.completed + counts.skipped;
        const detail = `${totalBlocks} ${totalBlocks === 1 ? 'exercise' : 'exercises'}`;

        setState({
          status: 'ready',
          title: nextPlan.title,
          scheduledFor: nextPlan.scheduledFor,
          detail,
          materialize: async () => {
            const result = await startSessionPlan(nextPlan.id);
            if (result.status === 'started' || result.status === 'already-active') {
              return { sessionId: result.sessionId };
            }
            throw new Error('Unable to start plan');
          },
          openManager: () => router.push('/planner' as Href),
        });
      })
      .catch(() => {
        if (!isCurrent()) return;
        setState({
          status: 'error',
          message: "Couldn't load your plans.",
          retry: () => {
            setState({ status: 'loading' });
            readPlanning();
          },
        });
      });

  }, [router]);

  useDailyReread(isFocused, read, nowRef, generationRef);
  useEffect(() => {
    if (previousReload.current === reloadToken) return;
    previousReload.current = reloadToken;
    if (isFocused) read();
  }, [isFocused, read, reloadToken]);

  return state;
}

export default function TrainRoute() {
  const isFocused = useIsFocused();
  const [reloadToken, setReloadToken] = useState(0);
  const handleWorkoutEnded = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);
  const planningState = useTrainPlanningState({ isFocused, reloadToken });
  return (
    <TrainScreen
      isFocused={isFocused}
      onWorkoutEnded={handleWorkoutEnded}
      planningState={planningState}
    />
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  // The disc centres in whatever height the planning section leaves it.
  content: {
    flexGrow: 1,
    gap: uiSpace.xl,
  },
  stage: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: uiSpace.lg,
  },
  stretch: {
    alignSelf: 'stretch',
  },
  planning: {
    gap: uiSpace.sm,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    padding: uiSpace.md,
  },
  planCopy: {
    flex: 1,
    minWidth: 0,
  },
  planningLink: {
    alignItems: 'center',
  },
  errorText: {
    textAlign: 'center',
  },
});
