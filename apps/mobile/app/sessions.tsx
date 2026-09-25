import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ActiveSessionRow,
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  HistoryList,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import { uiColors, uiSpace, uiTypography } from '@/components/ui';
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
    <View style={styles.screen} testID="sessions-screen">
      <View style={styles.pinnedTopRegion}>
        {activeSession ? (
          <View style={styles.sectionBlock}>
            <Text allowFontScaling={false} selectable style={styles.activeTitle}>
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
      </View>

      <HistoryList
        sessions={completedSessions}
        isLoading={isLoadingSessions}
        loadErrorMessage={loadErrorMessage}
        showDeletedSessions={showDeletedSessions}
        onToggleShowDeletedSessions={() => setShowDeletedSessions((current) => !current)}
        showGlobalEmptyState={showGlobalEmptyState}
        onOpenCompletedSession={openCompletedSessionEdit}
        onSetCompletedSessionDeleted={setCompletedSessionDeleted}
        onEditCompletedSession={openCompletedSessionEdit}
        onAppendCompletedSession={appendCompletedSession}
      />
    </View>
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
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  pinnedTopRegion: {
    gap: uiSpace.sm,
    flexShrink: 0,
  },
  sectionBlock: {
    gap: uiSpace.sm,
  },
  activeTitle: {
    fontSize: uiTypography.size.xl,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
});
