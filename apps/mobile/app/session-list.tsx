import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import {
  completeSessionDraft,
  formatSessionListCompactDuration,
  listSessionListBuckets,
  persistSessionDraftSnapshot,
  reopenCompletedSessionDraft,
  setSessionDeletedState,
} from '@/src/data';
import { TopLevelTabs } from '@/components/navigation/top-level-tabs';
import { uiColors } from '@/components/ui';

export type SessionListItem = {
  id: string;
  startedAt: string;
  status: 'active' | 'completed';
  completedAt: string | null;
  durationSec: number | null;
  durationDisplay: string;
  gymName: string | null;
  exerciseCount: number;
  setCount: number;
  totalWeight: number;
  deletedAt: string | null;
};

export const DEFAULT_SESSION_LIST_ITEMS: SessionListItem[] = [
  {
    id: 'session-active-1',
    startedAt: '2026-02-20T17:30:00.000Z',
    status: 'active',
    completedAt: null,
    durationSec: 2700,
    durationDisplay: '45m',
    gymName: 'Westside Barbell Club',
    exerciseCount: 4,
    setCount: 14,
    totalWeight: 6125,
    deletedAt: null,
  },
  {
    id: 'session-completed-1',
    startedAt: '2026-02-19T16:00:00.000Z',
    status: 'completed',
    completedAt: '2026-02-19T16:58:00.000Z',
    durationSec: 3480,
    durationDisplay: '58m',
    gymName: 'Westside Barbell Club',
    exerciseCount: 5,
    setCount: 18,
    totalWeight: 9420,
    deletedAt: null,
  },
  {
    id: 'session-completed-2',
    startedAt: '2026-02-17T18:10:00.000Z',
    status: 'completed',
    completedAt: '2026-02-17T19:15:00.000Z',
    durationSec: 3900,
    durationDisplay: '1h 5m',
    gymName: 'Downtown Fitness',
    exerciseCount: 4,
    setCount: 16,
    totalWeight: 7840,
    deletedAt: '2026-02-18T08:00:00.000Z',
  },
];

export type SessionListScreenShellProps = {
  initialSessions?: SessionListItem[];
  dataClient?: SessionListDataClient;
  reloadToken?: number;
};

type CompletedSessionMenuState = {
  action: 'delete' | 'undelete';
  sessionId: string;
};

export type SessionListDataClient = {
  loadSessions(input: { showDeletedSessions: boolean }): Promise<SessionListItem[]>;
  startSession(): Promise<void>;
  completeActiveSession(sessionId: string): Promise<void>;
  discardActiveSession(sessionId: string): Promise<void>;
  setCompletedSessionDeletedState(sessionId: string, isDeleted: boolean): Promise<void>;
  reopenCompletedSession(sessionId: string): Promise<void>;
};

const COMPLETED_ROW_DELETE_EXIT_MS = 350;

function formatDateTimeStamp(isoTimestamp: string): string {
  const [datePart, timePartWithZone = '00:00:00'] = isoTimestamp.split('T');
  const [, month, day] = datePart.split('-');
  const timePart = timePartWithZone.slice(0, 5);

  return `${Number(month)}/${Number(day)} ${timePart}`;
}

export const formatCompactDuration = formatSessionListCompactDuration;

function formatSetCount(setCount: number): string {
  return `${setCount} sets`;
}

function formatExerciseCount(exerciseCount: number): string {
  return `${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}`;
}

function formatLocationLabel(gymName: string | null): string | null {
  const trimmedGymName = gymName?.trim();
  return trimmedGymName ? trimmedGymName : null;
}

const mapRepositorySummaryToListItem = (
  summary: Awaited<ReturnType<typeof listSessionListBuckets>>['completed'][number] | Awaited<ReturnType<typeof listSessionListBuckets>>['active']
): SessionListItem | null => {
  if (!summary) {
    return null;
  }

  return {
    id: summary.id,
    startedAt: summary.startedAt.toISOString(),
    status: summary.status,
    completedAt: summary.completedAt ? summary.completedAt.toISOString() : null,
    durationSec: summary.durationSec,
    durationDisplay: summary.compactDuration,
    gymName: summary.gymName,
    exerciseCount: summary.exerciseCount,
    setCount: summary.setCount,
    totalWeight: 0,
    deletedAt: summary.deletedAt ? summary.deletedAt.toISOString() : null,
  };
};

export const DEFAULT_SESSION_LIST_DATA_CLIENT: SessionListDataClient = {
  async loadSessions({ showDeletedSessions }) {
    const buckets = await listSessionListBuckets({
      includeDeleted: showDeletedSessions,
    });

    const active = mapRepositorySummaryToListItem(buckets.active);
    const completed = buckets.completed
      .map((summary) => mapRepositorySummaryToListItem(summary))
      .filter((summary): summary is SessionListItem => summary !== null);

    return active ? [active, ...completed] : completed;
  },
  async startSession() {
    await persistSessionDraftSnapshot({
      gymId: null,
      startedAt: new Date(),
      status: 'active',
      exercises: [],
    });
  },
  async completeActiveSession(sessionId) {
    await completeSessionDraft(sessionId);
  },
  async discardActiveSession(sessionId) {
    await setSessionDeletedState(sessionId, true);
  },
  async setCompletedSessionDeletedState(sessionId, isDeleted) {
    await setSessionDeletedState(sessionId, isDeleted);
  },
  async reopenCompletedSession(sessionId) {
    await reopenCompletedSessionDraft(sessionId);
  },
};

function SessionSummaryLine({
  session,
  testIdPrefix,
  nowMs = Date.now(),
}: {
  session: SessionListItem;
  testIdPrefix: string;
  nowMs?: number;
}) {
  const durationLabel =
    session.status === 'active'
      ? formatCompactDuration(
          Math.max(0, Math.floor((nowMs - new Date(session.startedAt).getTime()) / 1000))
        )
      : session.durationDisplay || formatCompactDuration(session.durationSec);
  const locationLabel = formatLocationLabel(session.gymName);

  return (
    <View style={styles.summaryLines}>
      <View style={styles.summaryRow}>
        <Text
          selectable
          numberOfLines={1}
          style={[styles.summaryToken, styles.summaryTokenPrimary, styles.summaryTokenStrong]}
          testID={`${testIdPrefix}-start`}>
          {formatDateTimeStamp(session.startedAt)}
        </Text>
        <Text selectable style={styles.summarySeparator}>
          •
        </Text>
        <Text selectable numberOfLines={1} style={[styles.summaryToken, styles.summaryTokenStrong]} testID={`${testIdPrefix}-duration`}>
          {durationLabel}
        </Text>
        {locationLabel ? (
          <>
            <Text selectable style={[styles.summaryToken, styles.summaryAtToken, styles.summaryTokenStrong]}>
              @
            </Text>
            <Text
              selectable
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.summaryToken, styles.summaryLocationToken, styles.summaryTokenStrong]}
              testID={`${testIdPrefix}-gym`}>
              {locationLabel}
            </Text>
          </>
        ) : null}
      </View>

      <View style={styles.summaryRow}>
        <Text selectable numberOfLines={1} style={[styles.summaryToken, styles.summaryTokenSecondary]} testID={`${testIdPrefix}-sets`}>
          {formatSetCount(session.setCount)}
        </Text>
        <Text selectable style={styles.summarySeparator}>
          •
        </Text>
        <Text
          selectable
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.summaryToken, styles.summaryTokenSecondary, styles.summaryFlexibleToken]}
          testID={`${testIdPrefix}-exercises`}>
          {formatExerciseCount(session.exerciseCount)}
        </Text>
      </View>
    </View>
  );
}

export function SessionListScreenShell({
  initialSessions = DEFAULT_SESSION_LIST_ITEMS,
  dataClient,
  reloadToken = 0,
}: SessionListScreenShellProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionListItem[]>(dataClient ? [] : initialSessions);
  const [showDeletedSessions, setShowDeletedSessions] = useState(false);
  const [activeDurationNowMs, setActiveDurationNowMs] = useState(() => Date.now());
  const [isLoadingSessions, setIsLoadingSessions] = useState(Boolean(dataClient));
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [activeSessionMenuVisible, setActiveSessionMenuVisible] = useState(false);
  const [completedSessionMenuVisible, setCompletedSessionMenuVisible] = useState(false);
  const [completedSessionMenuState, setCompletedSessionMenuState] = useState<CompletedSessionMenuState | null>(
    null
  );
  const [deletingCompletedSessionId, setDeletingCompletedSessionId] = useState<string | null>(null);
  const [optimisticallyHiddenCompletedSessionIds, setOptimisticallyHiddenCompletedSessionIds] = useState<string[]>([]);
  const deletingCompletedRowOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  useEffect(() => {
    if (!dataClient) {
      return;
    }

    let isCancelled = false;

    setIsLoadingSessions(true);
    setLoadErrorMessage(null);

    dataClient
      .loadSessions({ showDeletedSessions })
      .then((loadedSessions) => {
        if (isCancelled) {
          return;
        }

        setSessions(loadedSessions);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load sessions');
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }

        setIsLoadingSessions(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [dataClient, showDeletedSessions, reloadToken]);

  const reloadSessions = async () => {
    if (!dataClient) {
      return;
    }

    setIsLoadingSessions(true);
    setLoadErrorMessage(null);

    try {
      const loadedSessions = await dataClient.loadSessions({ showDeletedSessions });
      setSessions(loadedSessions);
    } catch (error) {
      setLoadErrorMessage(error instanceof Error ? error.message : 'Unable to load sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const activeSession = sessions.find((session) => session.status === 'active' && session.deletedAt === null);
  const completedSessions = sessions
    .filter((session) => session.status === 'completed')
    .filter((session) => showDeletedSessions || session.deletedAt === null)
    .sort((left, right) => {
      const leftTime = left.completedAt ? new Date(left.completedAt).getTime() : 0;
      const rightTime = right.completedAt ? new Date(right.completedAt).getTime() : 0;
      return rightTime - leftTime;
    });
  const visibleCompletedSessions = completedSessions.filter(
    (session) => !optimisticallyHiddenCompletedSessionIds.includes(session.id)
  );

  const showEmptyState = !isLoadingSessions && !loadErrorMessage && !activeSession && visibleCompletedSessions.length === 0;
  const reopenMenuDisabled = Boolean(activeSession);

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

  useEffect(() => {
    if (showDeletedSessions) {
      setOptimisticallyHiddenCompletedSessionIds([]);
    }
  }, [showDeletedSessions]);

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
        setActiveSessionMenuVisible(false);
      })();
    }

    setSessions((currentSessions) => currentSessions.filter((session) => session.status !== 'active'));
    setActiveSessionMenuVisible(false);
  };

  const toggleDeletedState = (sessionId: string) => {
    if (dataClient) {
      const targetSession = sessions.find((session) => session.id === sessionId);
      return (async () => {
        await dataClient.setCompletedSessionDeletedState(sessionId, !targetSession?.deletedAt);
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
          deletedAt: session.deletedAt ? null : '2026-02-23T12:00:00.000Z',
        };
      })
    );
  };

  const openCompletedSessionMenu = (session: SessionListItem) => {
    setCompletedSessionMenuState({
      sessionId: session.id,
      action: session.deletedAt ? 'undelete' : 'delete',
    });
    setCompletedSessionMenuVisible(true);
  };

  const closeCompletedSessionMenu = () => {
    setCompletedSessionMenuVisible(false);
  };

  const openCompletedSessionEdit = () => {
    if (!completedSessionMenuState) {
      return;
    }

    const sessionId = completedSessionMenuState.sessionId;
    closeCompletedSessionMenu();
    router.push(`/session-recorder?mode=completed-edit&sessionId=${sessionId}`);
  };

  const attemptCompletedSessionReopen = () => {
    if (!completedSessionMenuState) {
      return;
    }

    if (activeSession) {
      return;
    }

    const sessionId = completedSessionMenuState.sessionId;
    const pendingAction = dataClient
      ? (async () => {
          await dataClient.reopenCompletedSession(sessionId);
          await reloadSessions();
          setCompletedSessionMenuVisible(false);
        })()
      : (async () => {
          await reopenCompletedSessionDraft(sessionId);
          await reloadSessions();
          setCompletedSessionMenuVisible(false);
        })();

    void pendingAction.catch(() => {
      setCompletedSessionMenuVisible(false);
    });
  };

  const applyCompletedSessionMenuAction = () => {
    if (!completedSessionMenuState) {
      return;
    }

    const shouldAnimateHiddenDelete =
      completedSessionMenuState.action === 'delete' && !showDeletedSessions && deletingCompletedSessionId === null;
    if (shouldAnimateHiddenDelete) {
      const { sessionId } = completedSessionMenuState;
      setCompletedSessionMenuVisible(false);
      setDeletingCompletedSessionId(sessionId);
      deletingCompletedRowOpacity.setValue(1);

      Animated.timing(deletingCompletedRowOpacity, {
        toValue: 0,
        duration: COMPLETED_ROW_DELETE_EXIT_MS,
        useNativeDriver: false,
      }).start(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setDeletingCompletedSessionId((current) => (current === sessionId ? null : current));
        setOptimisticallyHiddenCompletedSessionIds((current) =>
          current.includes(sessionId) ? current : [...current, sessionId]
        );

        const pendingAction = toggleDeletedState(sessionId);
        if (!pendingAction) {
          return;
        }

        void pendingAction.catch(() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOptimisticallyHiddenCompletedSessionIds((current) => current.filter((id) => id !== sessionId));
        });
      });
      return;
    }

    const pendingAction = toggleDeletedState(completedSessionMenuState.sessionId);
    if (pendingAction) {
      void pendingAction.finally(() => {
        setCompletedSessionMenuVisible(false);
      });
      return;
    }

    setCompletedSessionMenuVisible(false);
  };

  return (
    <>
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
              <View style={[styles.sessionRow, styles.activeSessionRow]} testID={`active-session-row-${activeSession.id}`}>
                <Pressable
                  accessibilityLabel="Resume active session"
                  accessibilityRole="button"
                  onPress={() => {
                    void navigateToSessionRecorder();
                  }}
                  style={styles.sessionRowMainPressable}
                  testID="resume-active-session-button">
                  <SessionSummaryLine
                    session={activeSession}
                    testIdPrefix={`session-summary-${activeSession.id}`}
                    nowMs={activeDurationNowMs}
                  />
                </Pressable>

                <View style={styles.sessionRowActions}>
                  <Pressable
                    accessibilityLabel="Complete active session"
                    accessibilityRole="button"
                    onPress={() => {
                      void completeActiveSession();
                    }}
                    style={[styles.iconActionButton, styles.completeButton]}
                    testID="complete-active-session-button">
                    <Text style={[styles.iconGlyphText, styles.completeGlyphText]}>✓</Text>
                  </Pressable>

                  <Pressable
                    accessibilityLabel="Open active session actions"
                    accessibilityRole="button"
                    onPress={() => setActiveSessionMenuVisible(true)}
                    style={[styles.iconActionButton, styles.menuButton]}
                    testID="active-session-menu-button">
                    <Text style={styles.iconGlyphText}>⋮</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={styles.historyRegion}>
          <View style={styles.sectionHeaderRow}>
            <Text selectable style={styles.sectionTitle}>
              History
            </Text>
            <Pressable
              accessibilityLabel={showDeletedSessions ? 'Hide deleted sessions' : 'Show deleted sessions'}
              accessibilityRole="button"
              onPress={() => setShowDeletedSessions((current) => !current)}
              style={styles.toggleButton}
              testID="toggle-deleted-sessions-button">
              <Text style={styles.toggleButtonText}>
                {showDeletedSessions ? 'Hide deleted' : 'Show deleted'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.historyScroll}
            contentContainerStyle={styles.historyScrollContent}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            testID="completed-history-scroll">
            {isLoadingSessions ? (
              <View style={styles.emptyPanel} testID="session-list-loading-state">
                <Text selectable style={styles.metaText}>
                  Loading sessions...
                </Text>
              </View>
            ) : loadErrorMessage ? (
              <View style={styles.emptyPanel} testID="session-list-load-error">
                <Text selectable style={styles.metaText}>
                  {loadErrorMessage}
                </Text>
              </View>
            ) : visibleCompletedSessions.length === 0 ? (
              <View style={styles.emptyPanel}>
                <Text selectable style={styles.metaText}>
                  No completed sessions
                </Text>
              </View>
            ) : (
              <View style={styles.completedList}>
                {visibleCompletedSessions.map((session) => (
                  <Animated.View
                    key={session.id}
                    style={[
                      styles.sessionRow,
                      session.deletedAt ? styles.deletedCompletedRow : null,
                      deletingCompletedSessionId === session.id ? { opacity: deletingCompletedRowOpacity } : null,
                    ]}
                    testID={`completed-session-row-${session.id}`}>
                    <Pressable
                      accessibilityLabel={`Open completed session ${session.id}`}
                      accessibilityRole="button"
                      onPress={() => navigateToCompletedSessionDetail(session.id)}
                      style={styles.sessionRowMainPressable}
                      testID={`completed-session-open-button-${session.id}`}>
                      <SessionSummaryLine session={session} testIdPrefix={`session-summary-${session.id}`} />
                    </Pressable>

                    <Pressable
                      accessibilityLabel={`Open completed session actions ${session.id}`}
                      accessibilityRole="button"
                      onPress={() => openCompletedSessionMenu(session)}
                      style={[styles.iconActionButton, styles.menuButton]}
                      testID={`completed-session-menu-button-${session.id}`}>
                      <Text style={styles.iconGlyphText}>⋮</Text>
                    </Pressable>
                  </Animated.View>
                ))}
              </View>
            )}

            {showEmptyState ? (
              <View style={styles.globalEmptyState} testID="session-list-empty-state">
                <Text selectable style={styles.globalEmptyTitle}>
                  No sessions yet
                </Text>
                <Text selectable style={styles.metaText}>
                  Start your first workout session to see it here.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>

        <TopLevelTabs
          activeTab="sessions"
          onPressSessions={() => {}}
          onPressExercises={() => router.push('/exercise-catalog')}
          onPressStats={() => router.push('/stats')}
          onPressSettings={() => router.push('/settings')}
        />
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={activeSessionMenuVisible}
        onRequestClose={() => setActiveSessionMenuVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Dismiss active session menu overlay"
            onPress={() => setActiveSessionMenuVisible(false)}
            style={styles.modalOverlay}
            testID="active-session-menu-overlay"
          />
          <View style={styles.modalPanel}>
            <Pressable
              accessibilityLabel="Delete active session"
              accessibilityRole="button"
              onPress={() => {
                void discardActiveSession();
              }}
              style={[styles.modalActionButton, styles.modalDangerButton]}
              testID="discard-active-session-button">
              <Text style={styles.modalDangerButtonText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={completedSessionMenuVisible}
        onDismiss={() => setCompletedSessionMenuState(null)}
        onRequestClose={closeCompletedSessionMenu}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Dismiss completed session menu overlay"
            onPress={closeCompletedSessionMenu}
            style={styles.modalOverlay}
            testID="completed-session-menu-overlay"
          />
          {completedSessionMenuState?.action === 'delete' ? (
            <View style={styles.modalPanel} testID="completed-session-delete-modal-card">
              <View style={styles.modalActionRow} testID="completed-session-menu-action-row">
                <Pressable
                  accessibilityLabel="Edit completed session"
                  accessibilityRole="button"
                  onPress={openCompletedSessionEdit}
                  style={[styles.modalActionButton, styles.modalActionRowButton, styles.modalNeutralButton]}
                  testID="completed-session-edit-menu-action-button">
                  <Text style={styles.modalNeutralButtonText}>Edit</Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Reopen completed session"
                  accessibilityRole="button"
                  disabled={reopenMenuDisabled}
                  onPress={attemptCompletedSessionReopen}
                  style={[
                    styles.modalActionButton,
                    styles.modalActionRowButton,
                    styles.modalNeutralButton,
                    reopenMenuDisabled ? styles.modalDisabledButton : null,
                  ]}
                  testID="completed-session-reopen-menu-action-button">
                  <Text
                    style={[
                      styles.modalNeutralButtonText,
                      reopenMenuDisabled ? styles.modalDisabledButtonText : null,
                    ]}>
                    Reopen
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Delete completed session"
                  accessibilityRole="button"
                  onPress={() => {
                    void applyCompletedSessionMenuAction();
                  }}
                  style={[styles.modalActionButton, styles.modalActionRowButton, styles.modalDangerButton]}
                  testID="completed-session-modal-action-button">
                  <Text style={styles.modalDangerButtonText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {completedSessionMenuState?.action === 'undelete' ? (
            <View style={styles.modalPanel} testID="completed-session-undelete-modal-card">
              <View style={styles.modalActionRow} testID="completed-session-menu-action-row">
                <Pressable
                  accessibilityLabel="Edit completed session"
                  accessibilityRole="button"
                  onPress={openCompletedSessionEdit}
                  style={[styles.modalActionButton, styles.modalActionRowButton, styles.modalNeutralButton]}
                  testID="completed-session-edit-menu-action-button">
                  <Text style={styles.modalNeutralButtonText}>Edit</Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Reopen completed session"
                  accessibilityRole="button"
                  disabled={reopenMenuDisabled}
                  onPress={attemptCompletedSessionReopen}
                  style={[
                    styles.modalActionButton,
                    styles.modalActionRowButton,
                    styles.modalNeutralButton,
                    reopenMenuDisabled ? styles.modalDisabledButton : null,
                  ]}
                  testID="completed-session-reopen-menu-action-button">
                  <Text
                    style={[
                      styles.modalNeutralButtonText,
                      reopenMenuDisabled ? styles.modalDisabledButtonText : null,
                    ]}>
                    Reopen
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Undelete completed session"
                  accessibilityRole="button"
                  onPress={() => {
                    void applyCompletedSessionMenuAction();
                  }}
                  style={[styles.modalActionButton, styles.modalActionRowButton, styles.modalNeutralButton]}
                  testID="completed-session-modal-action-button">
                  <Text style={styles.modalNeutralButtonText}>Undelete</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

export default function SessionListRoute() {
  const [reloadToken, setReloadToken] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setReloadToken((current) => current + 1);
    }, [])
  );

  return <SessionListScreenShell dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT} reloadToken={reloadToken} />;
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
  historyRegion: {
    flex: 1,
    minHeight: 0,
    gap: 8,
  },
  historyScroll: {
    flex: 1,
    minHeight: 0,
  },
  historyScrollContent: {
    gap: 12,
    paddingBottom: 16,
  },
  sectionBlock: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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
  emptyPanel: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfacePage,
    padding: 12,
  },
  sessionRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeSessionRow: {
    borderColor: uiColors.borderSuccess,
    backgroundColor: uiColors.surfaceSuccess,
  },
  deletedCompletedRow: {
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
    opacity: 0.9,
  },
  sessionRowMainPressable: {
    flex: 1,
    minWidth: 0,
  },
  sessionRowMain: {
    flex: 1,
    minWidth: 0,
  },
  sessionRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconActionButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeButton: {
    backgroundColor: uiColors.surfaceSuccess,
    borderColor: uiColors.borderSuccess,
  },
  menuButton: {
    backgroundColor: uiColors.actionNeutralSubtleBg,
    borderColor: uiColors.actionNeutralSubtleBorder,
  },
  iconGlyphText: {
    color: uiColors.actionNeutralSubtleText,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  completeGlyphText: {
    color: uiColors.textSuccess,
  },
  summaryLines: {
    gap: 2,
    minHeight: 34,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 4,
    minWidth: 0,
  },
  summaryToken: {
    color: uiColors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  summaryTokenPrimary: {
    color: uiColors.textAccentStrong,
  },
  summaryTokenStrong: {
    fontSize: 13,
    fontWeight: '700',
  },
  summaryTokenSecondary: {
    color: uiColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryAtToken: {
    color: uiColors.textSecondary,
  },
  summaryLocationToken: {
    flexShrink: 1,
    minWidth: 0,
  },
  summaryFlexibleToken: {
    flexShrink: 1,
    minWidth: 0,
  },
  summarySeparator: {
    color: uiColors.textDisabled,
    fontSize: 11,
  },
  metaText: {
    color: uiColors.textSecondary,
    fontSize: 13,
  },
  completedList: {
    gap: 10,
  },
  toggleButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: uiColors.actionNeutralSubtleBorder,
    backgroundColor: uiColors.actionNeutralSubtleBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toggleButtonText: {
    color: uiColors.actionNeutralSubtleText,
    fontSize: 12,
    fontWeight: '600',
  },
  globalEmptyState: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 16,
    gap: 6,
    alignItems: 'center',
  },
  globalEmptyTitle: {
    color: uiColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  modalPanel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: 14,
    gap: 10,
  },
  modalActionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  modalActionButton: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionRowButton: {
    flex: 1,
  },
  modalDangerButton: {
    backgroundColor: uiColors.actionDangerSubtleBg,
    borderWidth: 1,
    borderColor: uiColors.actionDangerSubtleBorder,
  },
  modalDangerButtonText: {
    color: uiColors.actionDangerText,
    fontWeight: '700',
  },
  modalNeutralButton: {
    backgroundColor: uiColors.actionNeutralSubtleBg,
    borderWidth: 1,
    borderColor: uiColors.actionNeutralSubtleBorder,
  },
  modalDisabledButton: {
    backgroundColor: uiColors.surfaceDisabled,
    borderColor: uiColors.borderMuted,
  },
  modalNeutralButtonText: {
    color: uiColors.actionNeutralSubtleText,
    fontWeight: '700',
  },
  modalDisabledButtonText: {
    color: uiColors.textDisabled,
  },
});
