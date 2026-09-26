import { useEffect, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';

import {
  ActionButton,
  Card,
  IconButton,
  ListRow,
  Sheet,
  StatePanel,
  Tag,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';

import { formatDateTimeStamp, SessionSummaryLine } from './session-summary-line';
import type { SessionListItem } from './types';

export type CompletedSessionMenuAction = 'delete' | 'undelete';

export type CompletedSessionMenuState = {
  action: CompletedSessionMenuAction;
  sessionId: string;
  // The sheet's title: the session's start stamp, as on its row.
  title: string;
};

export type HistoryListProps = {
  /** Completed sessions to render (already filtered by `showDeletedSessions`). */
  sessions: SessionListItem[];
  isLoading: boolean;
  loadErrorMessage: string | null;
  /** Reloads the list after a load error (the same load as a focus refresh). */
  onRetryLoad: () => void;
  showDeletedSessions: boolean;
  onToggleShowDeletedSessions: () => void;
  /** Whether the global empty-state panel should render (no active + no completed). */
  showGlobalEmptyState: boolean;
  onOpenCompletedSession: (sessionId: string) => void;
  /**
   * Invoked when the user picks the menu's delete or undelete action.
   * `isDeleted` is the desired post-action state (true = delete, false = undelete).
   * Should return a Promise so the row can settle once the toggle resolves.
   */
  onSetCompletedSessionDeleted: (sessionId: string, isDeleted: boolean) => Promise<void> | void;
  onEditCompletedSession: (sessionId: string) => void;
  onAppendCompletedSession: (sessionId: string) => Promise<void> | void;
};

const COMPLETED_ROW_DELETE_EXIT_MS = 350;

/**
 * The completed-session history: a `History` micro-label with the Show/Hide
 * deleted toggle, the rows in one card, their loading/error/empty states, and
 * each row's actions sheet (Edit / Append / Delete or Undelete). It renders
 * inside its host's scroll.
 */
export function HistoryList({
  sessions,
  isLoading,
  loadErrorMessage,
  onRetryLoad,
  showDeletedSessions,
  onToggleShowDeletedSessions,
  showGlobalEmptyState,
  onOpenCompletedSession,
  onSetCompletedSessionDeleted,
  onEditCompletedSession,
  onAppendCompletedSession,
}: HistoryListProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  // Kept after the sheet closes so its rows do not vanish during the fade.
  const [menuState, setMenuState] = useState<CompletedSessionMenuState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const deletingRowOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  useEffect(() => {
    if (showDeletedSessions) {
      setHiddenIds([]);
    }
  }, [showDeletedSessions]);

  const visibleSessions = sessions.filter((session) => !hiddenIds.includes(session.id));

  const openMenu = (session: SessionListItem) => {
    setMenuState({
      sessionId: session.id,
      action: session.deletedAt ? 'undelete' : 'delete',
      title: formatDateTimeStamp(session.startedAt),
    });
    setMenuVisible(true);
  };

  const closeMenu = () => {
    setMenuVisible(false);
  };

  const handleEdit = () => {
    if (!menuState) {
      return;
    }
    const { sessionId } = menuState;
    closeMenu();
    onEditCompletedSession(sessionId);
  };

  const handleAppend = () => {
    if (!menuState) {
      return;
    }
    const { sessionId } = menuState;
    setMenuVisible(false);
    const result = onAppendCompletedSession(sessionId);
    if (result && typeof (result as Promise<void>).then === 'function') {
      const noop = () => {};
      (result as Promise<void>).then(noop, noop);
    }
  };

  const applyMenuAction = () => {
    if (!menuState) {
      return;
    }

    const shouldAnimateHiddenDelete =
      menuState.action === 'delete' && !showDeletedSessions && deletingId === null;

    if (shouldAnimateHiddenDelete) {
      const { sessionId } = menuState;
      setMenuVisible(false);
      setDeletingId(sessionId);
      deletingRowOpacity.setValue(1);

      Animated.timing(deletingRowOpacity, {
        toValue: 0,
        duration: COMPLETED_ROW_DELETE_EXIT_MS,
        useNativeDriver: false,
      }).start(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setDeletingId((current) => (current === sessionId ? null : current));
        setHiddenIds((current) =>
          current.includes(sessionId) ? current : [...current, sessionId]
        );

        const pendingAction = onSetCompletedSessionDeleted(sessionId, true);
        if (
          !pendingAction ||
          typeof (pendingAction as Promise<void>).then !== 'function'
        ) {
          return;
        }

        void (pendingAction as Promise<void>).catch(() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setHiddenIds((current) => current.filter((id) => id !== sessionId));
        });
      });
      return;
    }

    const desiredDeletedState = menuState.action === 'delete';
    setMenuVisible(false);
    const result = onSetCompletedSessionDeleted(menuState.sessionId, desiredDeletedState);
    if (result && typeof (result as Promise<void>).then === 'function') {
      const noop = () => {};
      void (result as Promise<void>).then(noop, noop);
    }
  };

  return (
    <>
      <View style={styles.header}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
          History
        </Text>
        {/* A view toggle, not a filter group: its on state is `checked` (T10-D5). */}
        <ActionButton
          accessibilityLabel={showDeletedSessions ? 'Hide deleted sessions' : 'Show deleted sessions'}
          checked={showDeletedSessions}
          label={showDeletedSessions ? 'Hide deleted' : 'Show deleted'}
          onPress={onToggleShowDeletedSessions}
          testID="toggle-deleted-sessions-button"
          variant="text"
        />
      </View>

      {isLoading ? (
        <Card>
          <StatePanel body="Loading sessions…" fill={false} kind="loading" testID="session-list-loading-state" />
        </Card>
      ) : loadErrorMessage ? (
        <Card>
          <StatePanel
            action={{ label: 'Retry', onPress: onRetryLoad, testID: 'session-list-load-error-retry' }}
            body={loadErrorMessage}
            fill={false}
            kind="error"
            testID="session-list-load-error"
            title="Could not load sessions"
          />
        </Card>
      ) : visibleSessions.length === 0 ? (
        <Card>
          <StatePanel body="No completed sessions" fill={false} />
        </Card>
      ) : (
        <Card testID="completed-session-list">
          {visibleSessions.map((session, index) => {
            const deleted = session.deletedAt !== null;
            return (
              <Animated.View
                key={session.id}
                style={[
                  deleted ? styles.deletedRow : null,
                  deletingId === session.id ? { opacity: deletingRowOpacity } : null,
                ]}
                testID={`completed-session-row-${session.id}`}>
                <ListRow
                  density="list"
                  divider={index > 0}
                  trailing={
                    <IconButton
                      accessibilityLabel={`Open completed session actions ${session.id}`}
                      name="more-vertical"
                      onPress={() => openMenu(session)}
                      testID={`completed-session-menu-button-${session.id}`}
                      tone="muted"
                    />
                  }>
                  <Pressable
                    accessibilityLabel={`Open completed session ${session.id}`}
                    accessibilityRole="button"
                    onPress={() => onOpenCompletedSession(session.id)}
                    style={styles.rowMain}
                    testID={`completed-session-open-button-${session.id}`}>
                    <SessionSummaryLine session={session} testIdPrefix={`session-summary-${session.id}`} />
                    {/* Deleted is said in words, not only by the fade (`08` baseline 5). */}
                    {deleted ? <Tag label="Deleted" testID={`completed-session-deleted-tag-${session.id}`} tone="faint" /> : null}
                  </Pressable>
                </ListRow>
              </Animated.View>
            );
          })}
        </Card>
      )}

      {showGlobalEmptyState ? (
        <Card>
          <StatePanel
            body="Start your first workout session to see it here."
            fill={false}
            testID="session-list-empty-state"
            title="No sessions yet"
          />
        </Card>
      ) : null}

      <Sheet
        dismissLabel="Dismiss completed session actions"
        onDismiss={closeMenu}
        testID="completed-session-menu"
        title={menuState?.title}
        visible={menuVisible}>
        <View testID="completed-session-menu-action-row">
          <ListRow
            accessibilityLabel="Edit completed session"
            label="Edit"
            onPress={handleEdit}
            testID="completed-session-edit-menu-action-button"
          />
          <ListRow
            accessibilityLabel="Append completed session to workout log"
            label="Append"
            onPress={handleAppend}
            testID="completed-session-reopen-menu-action-button"
          />
          {menuState?.action === 'undelete' ? (
            <ListRow
              accessibilityLabel="Undelete completed session"
              label="Undelete"
              onPress={applyMenuAction}
              testID="completed-session-modal-action-button"
            />
          ) : (
            <ListRow
              accessibilityLabel="Delete completed session"
              label="Delete"
              onPress={applyMenuAction}
              testID="completed-session-modal-action-button"
              tone="danger"
            />
          )}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
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
  rowMain: {
    gap: uiSpace.xs,
    paddingVertical: uiSpace.sm,
  },
  // A deleted row has stepped back; the `Deleted` tag names it.
  deletedRow: {
    opacity: 0.6,
  },
});
