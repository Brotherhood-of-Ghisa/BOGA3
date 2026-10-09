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
import { PlanSection, PlanSessionAction, usePlanSections } from '@/components/session-planner/plan-sections';
import { StatePanel } from '@/components/ui/state-panel';
import {
  IconButton,
  Screen,
  Sheet,
  SwitchRow,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { sessionViewHref } from '@/src/navigation/active-session-entry';

export type SessionsScreenProps = {
  dataClient?: SessionListDataClient;
  initialSessions?: SessionListItem[];
  isFocused?: boolean;
  /** A week or day of the history to open at (`?week=` / `?day=`). */
  jumpTo?: HistoryJump | null;
};

export function SessionsScreen({
  dataClient,
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  isFocused = true,
  jumpTo = null,
}: SessionsScreenProps) {
  const router = useRouter();
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
    planSections.upcoming.length === 0 &&
    planSections.unscheduled.length === 0;

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

  const openActiveSession = (sessionId: string) => {
    router.push(sessionViewHref(sessionId));
  };

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

  const openCompletedSessionSummary = (sessionId: string) => {
    router.push(`/completed-session/${encodeURIComponent(sessionId)}`);
  };

  const hub = (
    <>
      {activeSession ? (
        <View style={styles.block}>
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
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
      {planSections.loadErrorMessage ? (
        <StatePanel
          body={planSections.loadErrorMessage}
          fill={false}
          kind="error"
          testID="sessions-plans-error"
        />
      ) : null}
      <PlanSection
        label="Upcoming"
        onOpenPlan={openPlan}
        plans={planSections.upcoming}
        testID="sessions-plan-section-upcoming"
      />
      <PlanSection
        label="Unscheduled"
        onOpenPlan={openPlan}
        plans={planSections.unscheduled}
        testID="sessions-plan-section-unscheduled"
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
        {/* A view option: deleted sessions join their weeks, faded and tagged. */}
        <View style={styles.options}>
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
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
});
