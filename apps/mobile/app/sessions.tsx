import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
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

  const showGlobalEmptyState =
    !isLoadingSessions && !loadErrorMessage && !activeSession && completedSessions.length === 0;

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
