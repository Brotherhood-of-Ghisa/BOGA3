import { useIsFocused, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  ActiveSessionRow,
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  HistoryList,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import { NewProgrammeAction, PlanSection, PlanSessionAction, usePlanSections } from '@/components/session-planner/plan-sections';
import { StatePanel } from '@/components/ui/state-panel';
import { Screen, ScreenScroll, uiFonts, uiGeometry, uiRoles, uiTypography } from '@/components/ui';
import { appendCompletedSessionAsPlanned } from '@/src/data';
import { sessionViewHref } from '@/src/navigation/active-session-entry';

export type SessionsScreenProps = {
  dataClient?: SessionListDataClient;
  initialSessions?: SessionListItem[];
  isFocused?: boolean;
};

export function SessionsScreen({
  dataClient,
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  isFocused = true,
}: SessionsScreenProps) {
  const router = useRouter();
  const [showDeletedSessions, setShowDeletedSessions] = useState(false);
  const [activeDurationNowMs, setActiveDurationNowMs] = useState(() => Date.now());

  const { sessions, setSessions, isLoadingSessions, loadErrorMessage, reloadSessions } =
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
    planSections.unscheduled.length === 0 &&
    planSections.programmes.length === 0;

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

  const setCompletedSessionDeleted = (sessionId: string, isDeleted: boolean) => {
    if (dataClient) {
      return (async () => {
        await dataClient.setCompletedSessionDeletedState(sessionId, isDeleted);
        await reloadSessions();
      })();
    }

    setSessions((currentSessions) =>
      currentSessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        return {
          ...session,
          deletedAt: isDeleted ? '2026-02-23T12:00:00.000Z' : null,
        };
      })
    );
  };

  // Completed sessions are edited in the session view.
  const openCompletedSessionEdit = (sessionId: string) => {
    router.push(sessionViewHref(sessionId));
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

  const appendCompletedSession = (sessionId: string) => {
    if (dataClient) {
      return (async () => {
        await dataClient.appendCompletedSessionAsPlanned(sessionId);
        await reloadSessions();
      })();
    }
    return (async () => {
      await appendCompletedSessionAsPlanned(sessionId);
      await reloadSessions();
    })();
  };

  return (
    <Screen testID="sessions-screen">
      <ScreenScroll keyboardShouldPersistTaps="handled" testID="completed-history-scroll">
        {activeSession ? (
          <>
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
          </>
        ) : null}

        {/* The hub's persistent authoring entry; the planning sections' rows
            open the plan detail. */}
        <PlanSessionAction onPress={openPlanNew} testID="sessions-plan-session-action" />
        <NewProgrammeAction onPress={openProgrammeNew} testID="sessions-new-programme-action" />
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
          onOpenProgramme={openProgramme}
          plans={planSections.unscheduled}
          programmes={planSections.programmes}
          testID="sessions-plan-section-unscheduled"
        />

        <HistoryList
          sessions={completedSessions}
          isLoading={isLoadingSessions}
          loadErrorMessage={loadErrorMessage}
          onRetryLoad={() => {
            void reloadSessions();
          }}
          showDeletedSessions={showDeletedSessions}
          onToggleShowDeletedSessions={() => setShowDeletedSessions((current) => !current)}
          showGlobalEmptyState={showGlobalEmptyState}
          onOpenCompletedSession={openCompletedSessionSummary}
          onSetCompletedSessionDeleted={setCompletedSessionDeleted}
          onEditCompletedSession={openCompletedSessionEdit}
          onAppendCompletedSession={appendCompletedSession}
        />
      </ScreenScroll>
    </Screen>
  );
}

export default function SessionsRoute() {
  const isFocused = useIsFocused();
  return (
    <SessionsScreen
      dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
      isFocused={isFocused}
    />
  );
}

const styles = StyleSheet.create({
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
