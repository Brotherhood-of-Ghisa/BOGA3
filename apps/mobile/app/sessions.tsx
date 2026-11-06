import { Stack, useIsFocused, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ActiveSessionRow,
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  HistoryList,
  parseHistoryJump,
  useSessionListData,
  type HistoryJump,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import {
  NewProgrammeAction,
  PlanSection,
  RoutinePlanSection,
  PlanSessionAction,
  usePlanSections,
} from '@/components/session-planner/plan-sections';
import { StatePanel } from '@/components/ui/state-panel';
import {
  IconButton,
  Screen,
  Sheet,
  SwitchRow,
  uiSpace,
  uiText,
  uiTextTone,
} from '@/components/ui';
import { useOpenActiveWorkout } from '@/components/navigation/use-open-main-tab';

export type SessionsScreenProps = {
  dataClient?: SessionListDataClient;
  initialSessions?: SessionListItem[];
  isFocused?: boolean;
  /** A week or day of the history to open at (`?week=` / `?day=`). */
  jumpTo?: HistoryJump | null;
};

/**
 * The planning queues hold unfinished work; Show completed plans reveals a
 * separate section before workout history, including resolved programme children.
 * Both view options last for this screen mount; workout history is independent.
 */
export function SessionsScreen({
  dataClient,
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  isFocused = true,
  jumpTo = null,
}: SessionsScreenProps) {
  const router = useRouter();
  const [showCompletedPlans, setShowCompletedPlans] = useState(false);
  const [showDeletedSessions, setShowDeletedSessions] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [activeDurationNowMs, setActiveDurationNowMs] = useState(() => Date.now());

  const { sessions, setSessions, isLoadingSessions, loadErrorMessage, loadedAtMs, reloadSessions } =
    useSessionListData({
      dataClient,
      initialSessions,
      showDeletedSessions,
      isFocused,
    });
  const planSections = usePlanSections();
  const upcoming = planSections.upcoming.filter((plan) => plan.progress !== 'completed');
  const unscheduled = planSections.unscheduled.filter((plan) => plan.progress !== 'completed');
  const programmes = planSections.programmes.filter((programme) => programme.progress !== 'completed');
  const completedPlans = showCompletedPlans ? [...new Map([
    ...planSections.upcoming,
    ...planSections.unscheduled,
    ...planSections.programmes.flatMap((programme) => programme.plans.filter((plan) => plan.scheduledFor === null)),
  ].filter((plan) => plan.progress === 'completed').map((plan) => [plan.id, plan])).values()] : [];
  const completedProgrammes = showCompletedPlans ? [...new Map(planSections.programmes
    .filter((programme) => programme.progress === 'completed')
    .map((programme) => [programme.id, programme])).values()] : [];

  const activeSession = sessions.find(
    (session) => session.status === 'active' && session.deletedAt === null
  );
  const completedSessions = sessions
    .filter((session) => session.status === 'completed')
    .filter((session) => showDeletedSessions || session.deletedAt === null)
    .sort((left, right) => {
      const leftTime = left.completedAt ? new Date(left.completedAt).getTime() : 0;
      const rightTime = right.completedAt ? new Date(right.completedAt).getTime() : 0;
      return rightTime - leftTime;
    });

  const planningEmpty =
    !planSections.isLoading &&
    !planSections.loadErrorMessage &&
    planSections.routines.length === 0 &&
    upcoming.length === 0 &&
    unscheduled.length === 0 &&
    programmes.length === 0 &&
    completedPlans.length === 0 &&
    completedProgrammes.length === 0;

  const showGlobalEmptyState =
    !isLoadingSessions &&
    !loadErrorMessage &&
    !activeSession &&
    planningEmpty &&
    completedSessions.length === 0;

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const intervalId = setInterval(() => {
      setActiveDurationNowMs(Date.now());
    }, 30_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeSession]);

  const openActiveSession = useOpenActiveWorkout();

  const discardActiveSession = () => {
    if (dataClient && activeSession) {
      return (async () => {
        await dataClient.discardActiveSession(activeSession.id);
        await reloadSessions();
      })();
    }

    setSessions((currentSessions) =>
      currentSessions.filter((session) => session.status !== 'active')
    );
  };

  const openPlanNew = () => {
    // The routes land with the plan form and detail; the cast falls away then.
    router.push('/session-plan/new' as Href);
  };

  const openPlan = (planId: string) => {
    router.push(`/session-plan/${encodeURIComponent(planId)}` as Href);
  };

  const openProgrammeNew = () => {
    router.push('/programme/new' as Href);
  };

  const openProgramme = (programmeId: string) => {
    router.push(`/programme/${encodeURIComponent(programmeId)}` as Href);
  };

  const openCompletedSessionSummary = (sessionId: string) => {
    router.push(`/completed-session/${encodeURIComponent(sessionId)}`);
  };

  const hub = (
    <>
      {activeSession ? (
        <View style={styles.block}>
          <Text allowFontScaling={false} accessibilityRole="header" style={[uiText.label, uiTextTone.faint]}>
            Active
          </Text>
          <ActiveSessionRow
            session={activeSession}
            nowMs={activeDurationNowMs}
            onResume={() => openActiveSession(activeSession.id)}
            onComplete={() => openActiveSession(activeSession.id)}
            onDelete={() => {
              void discardActiveSession();
            }}
          />
        </View>
      ) : null}

      {/* The hub's persistent authoring entry; the planning sections' rows
          open the plan detail. */}
      <PlanSessionAction onPress={openPlanNew} testID="sessions-plan-session-action" />
      <NewProgrammeAction onPress={openProgrammeNew} testID="sessions-new-programme-action" />
      <RoutinePlanSection state={planSections} onOpenPlan={openPlan} />
      <PlanSection
        label="Upcoming"
        onOpenPlan={openPlan}
        plans={upcoming}
        testID="sessions-plan-section-upcoming"
      />
      <PlanSection
        label="Unscheduled"
        onOpenPlan={openPlan}
        onOpenProgramme={openProgramme}
        plans={unscheduled}
        programmes={programmes}
        testID="sessions-plan-section-unscheduled"
      />
      <PlanSection
        label="Completed plans"
        onOpenPlan={openPlan}
        onOpenProgramme={openProgramme}
        plans={completedPlans}
        programmes={completedProgrammes}
        testID="sessions-plan-section-completed"
      />
    </>
  );

  return (
    <Screen testID="sessions-screen">
      {/* The list's view options sit behind the header's options button, as on the exercise catalog. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <IconButton
              accessibilityLabel="Session list options"
              name="more-vertical"
              onPress={() => setOptionsVisible(true)}
              testID="sessions-options-button"
            />
          ),
        }}
      />
      <HistoryList
        header={hub}
        isLoading={isLoadingSessions}
        // The plans above the history load on their own: jump once they have,
        // so they cannot push the target down after it lands.
        jumpTo={planSections.isLoading ? null : jumpTo}
        loadErrorMessage={loadErrorMessage}
        nowMs={loadedAtMs}
        onOpenCompletedSession={openCompletedSessionSummary}
        onRetryLoad={() => {
          void reloadSessions();
        }}
        sessions={completedSessions}
        showGlobalEmptyState={showGlobalEmptyState}
      />
      <Sheet
        dismissLabel="Close session list options"
        onDismiss={() => setOptionsVisible(false)}
        testID="sessions-options-sheet"
        visible={optionsVisible}>
        <View style={styles.options}>
          <SwitchRow
            label="Show completed plans"
            onValueChange={setShowCompletedPlans}
            testID="toggle-completed-plans"
            value={showCompletedPlans}
          />
          <SwitchRow
            label="Show deleted sessions"
            onValueChange={setShowDeletedSessions}
            testID="toggle-deleted-sessions"
            value={showDeletedSessions}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

export default function SessionsRoute() {
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ week?: string | string[]; day?: string | string[] }>();
  // An opening position, read once: the page never rewrites it.
  const [jumpTo] = useState(() => parseHistoryJump(params));
  return (
    <SessionsScreen
      dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
      isFocused={isFocused}
      jumpTo={jumpTo}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    gap: uiSpace.md,
  },
  options: {
    paddingBottom: uiSpace.lg,
  },
});
