import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { uiColors } from '@/components/ui';
import { reopenCompletedSessionDraft } from '@/src/data';

export type SessionsScreenProps = {
  dataClient?: SessionListDataClient;
  initialSessions?: SessionListItem[];
  reloadToken?: number;
};

export function SessionsScreen({
  dataClient,
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  reloadToken = 0,
}: SessionsScreenProps) {
  const router = useRouter();
  const [showDeletedSessions, setShowDeletedSessions] = useState(false);
  const [activeDurationNowMs, setActiveDurationNowMs] = useState(() => Date.now());

  const { sessions, setSessions, isLoadingSessions, loadErrorMessage, reloadSessions } =
    useSessionListData({
      dataClient,
      initialSessions,
      showDeletedSessions,
      reloadToken,
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
  const reopenDisabled = Boolean(activeSession);

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

  const navigateToSessionRecorder = () => {
    router.push('/session-recorder');
  };

  const completeActiveSession = () => {
    if (dataClient && activeSession) {
      return (async () => {
        await dataClient.completeActiveSession(activeSession.id);
        await reloadSessions();
      })();
    }

    setSessions((currentSessions) =>
      currentSessions.map((session) => {
        if (session.status !== 'active' || session.deletedAt !== null) {
          return session;
        }

        return {
          ...session,
          status: 'completed',
          completedAt: '2026-02-20T18:15:00.000Z',
        };
      })
    );
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

  const openCompletedSessionEdit = (sessionId: string) => {
    router.push(`/session-recorder?mode=completed-edit&sessionId=${sessionId}`);
  };

  const reopenCompletedSession = (sessionId: string) => {
    if (activeSession) {
      return;
    }
    if (dataClient) {
      return (async () => {
        await dataClient.reopenCompletedSession(sessionId);
        await reloadSessions();
      })();
    }
    return (async () => {
      await reopenCompletedSessionDraft(sessionId);
      await reloadSessions();
    })();
  };

  const navigateToCompletedSessionDetail = (sessionId: string) => {
    router.push(`/completed-session/${sessionId}`);
  };

  return (
    <View style={styles.screen} testID="sessions-screen">
      <View style={styles.pinnedTopRegion}>
        {activeSession ? (
          <View style={styles.sectionBlock}>
            <Text selectable style={styles.activeTitle}>
              Active
            </Text>
            <ActiveSessionRow
              session={activeSession}
              nowMs={activeDurationNowMs}
              onResume={navigateToSessionRecorder}
              onComplete={() => {
                void completeActiveSession();
              }}
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
        onOpenCompletedSession={navigateToCompletedSessionDetail}
        onSetCompletedSessionDeleted={setCompletedSessionDeleted}
        onEditCompletedSession={openCompletedSessionEdit}
        onReopenCompletedSession={reopenCompletedSession}
        reopenDisabled={reopenDisabled}
      />
    </View>
  );
}

export default function SessionsRoute() {
  const [reloadToken, setReloadToken] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setReloadToken((current) => current + 1);
    }, [])
  );
  return (
    <SessionsScreen
      dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
      reloadToken={reloadToken}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: 16,
    gap: 12,
  },
  pinnedTopRegion: {
    gap: 8,
    flexShrink: 0,
  },
  sectionBlock: {
    gap: 8,
  },
  activeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
});
