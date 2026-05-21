import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { reopenCompletedSessionDraft } from '@/src/data';
import { TopLevelTabs } from '@/components/navigation/top-level-tabs';
import {
  ActiveSessionRow,
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  DEFAULT_SESSION_LIST_ITEMS,
  HistoryList,
  formatCompactDuration as composedFormatCompactDuration,
  useSessionListData,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';
import { uiColors } from '@/components/ui';

// Re-exports preserve the existing public API for tests and other consumers that
// still import from `app/session-list`. The implementations now live in
// `apps/mobile/components/session-list/` so the new Stats/History and Log tabs
// can pull them in without dragging the whole screen along.
export type { SessionListItem, SessionListDataClient } from '@/components/session-list';
export {
  DEFAULT_SESSION_LIST_ITEMS,
  DEFAULT_SESSION_LIST_DATA_CLIENT,
} from '@/components/session-list';
export const formatCompactDuration = composedFormatCompactDuration;

export type SessionListScreenShellProps = {
  initialSessions?: SessionListItem[];
  dataClient?: SessionListDataClient;
  reloadToken?: number;
};

export function SessionListScreenShell({
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  dataClient,
  reloadToken = 0,
}: SessionListScreenShellProps) {
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
    if (dataClient && !activeSession) {
      return (async () => {
        await dataClient.startSession();
        await reloadSessions();
        router.push('/session-recorder');
      })();
    }

    router.push('/session-recorder');
  };

  const navigateToCompletedSessionDetail = (sessionId: string) => {
    router.push(`/completed-session/${sessionId}`);
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
          durationDisplay: session.durationDisplay || formatCompactDuration(session.durationSec),
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

  return (
    <View style={styles.screen} testID="session-list-screen">
      <View style={styles.pinnedTopRegion} testID="session-list-pinned-top-region">
        {!activeSession ? (
          <Pressable
            accessibilityLabel="Start session"
            accessibilityRole="button"
            onPress={() => {
              void navigateToSessionRecorder();
            }}
            style={[styles.actionButton, styles.primaryButton]}
            testID="start-session-button">
            <Text style={styles.primaryButtonText}>Start Session</Text>
          </Pressable>
        ) : (
          <View style={styles.sectionBlock}>
            <Text selectable style={styles.sectionTitle}>
              Active
            </Text>
            <ActiveSessionRow
              session={activeSession}
              nowMs={activeDurationNowMs}
              onResume={() => {
                void navigateToSessionRecorder();
              }}
              onComplete={() => {
                void completeActiveSession();
              }}
              onDelete={() => {
                void discardActiveSession();
              }}
            />
          </View>
        )}
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

      <TopLevelTabs
        activeTab="stats-history"
        onPressStatsHistory={() => router.push('/stats-history')}
        onPressLog={() => router.push('/session-recorder')}
        onPressExercises={() => router.push('/exercise-catalog')}
        onPressSettings={() => router.push('/settings')}
      />
    </View>
  );
}

export default function SessionListRoute() {
  const [reloadToken, setReloadToken] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setReloadToken((current) => current + 1);
    }, [])
  );

  return (
    <SessionListScreenShell dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT} reloadToken={reloadToken} />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
    padding: 16,
    gap: 16,
  },
  pinnedTopRegion: {
    gap: 8,
    flexShrink: 0,
  },
  sectionBlock: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: uiColors.textPrimary,
  },
  actionButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: uiColors.actionPrimary,
  },
  primaryButtonText: {
    color: uiColors.surfaceDefault,
    fontWeight: '700',
  },
});
