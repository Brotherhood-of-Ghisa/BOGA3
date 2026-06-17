import { useEffect, useRef, useState } from 'react';
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

import { uiColors } from '@/components/ui';

import { SessionSummaryLine } from './session-summary-line';
import type { SessionListItem } from './types';

export type CompletedSessionMenuAction = 'delete' | 'undelete';

export type CompletedSessionMenuState = {
  action: CompletedSessionMenuAction;
  sessionId: string;
};

export type HistoryListProps = {
  /** Completed sessions to render (already filtered by `showDeletedSessions`). */
  sessions: SessionListItem[];
  isLoading: boolean;
  loadErrorMessage: string | null;
  showDeletedSessions: boolean;
  onToggleShowDeletedSessions: () => void;
  /** Whether the global empty-state panel should render (no active + no completed). */
  showGlobalEmptyState: boolean;
  onOpenCompletedSession: (sessionId: string) => void;
  /**
   * Invoked when the user confirms the menu's primary toggle action.
   * `isDeleted` is the desired post-action state (true = delete, false = undelete).
   * Should return a Promise so the row can settle once the toggle resolves.
   */
  onSetCompletedSessionDeleted: (sessionId: string, isDeleted: boolean) => Promise<void> | void;
  onEditCompletedSession: (sessionId: string) => void;
  onAppendCompletedSession: (sessionId: string) => Promise<void> | void;
};

const COMPLETED_ROW_DELETE_EXIT_MS = 350;

/**
 * Renders the completed-session history list, the deleted-visibility toggle,
 * the global empty-state panel, and the per-row delete/undelete confirmation modal.
 */
export function HistoryList({
  sessions,
  isLoading,
  loadErrorMessage,
  showDeletedSessions,
  onToggleShowDeletedSessions,
  showGlobalEmptyState,
  onOpenCompletedSession,
  onSetCompletedSessionDeleted,
  onEditCompletedSession,
  onAppendCompletedSession,
}: HistoryListProps) {
  const [menuVisible, setMenuVisible] = useState(false);
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
      <View style={styles.historyRegion}>
        <View style={styles.sectionHeaderRow}>
          <Text selectable style={styles.sectionTitle}>
            History
          </Text>
          <Pressable
            accessibilityLabel={showDeletedSessions ? 'Hide deleted sessions' : 'Show deleted sessions'}
            accessibilityRole="button"
            onPress={onToggleShowDeletedSessions}
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
          {isLoading ? (
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
          ) : visibleSessions.length === 0 ? (
            <View style={styles.emptyPanel}>
              <Text selectable style={styles.metaText}>
                No completed sessions
              </Text>
            </View>
          ) : (
            <View style={styles.completedList}>
              {visibleSessions.map((session) => (
                <Animated.View
                  key={session.id}
                  style={[
                    styles.sessionRow,
                    session.deletedAt ? styles.deletedCompletedRow : null,
                    deletingId === session.id ? { opacity: deletingRowOpacity } : null,
                  ]}
                  testID={`completed-session-row-${session.id}`}>
                  <Pressable
                    accessibilityLabel={`Open completed session ${session.id}`}
                    accessibilityRole="button"
                    onPress={() => onOpenCompletedSession(session.id)}
                    style={styles.sessionRowMainPressable}
                    testID={`completed-session-open-button-${session.id}`}>
                    <SessionSummaryLine
                      session={session}
                      testIdPrefix={`session-summary-${session.id}`}
                    />
                  </Pressable>

                  <Pressable
                    accessibilityLabel={`Open completed session actions ${session.id}`}
                    accessibilityRole="button"
                    onPress={() => openMenu(session)}
                    style={[styles.iconActionButton, styles.menuButton]}
                    testID={`completed-session-menu-button-${session.id}`}>
                    <Text style={styles.iconGlyphText}>⋮</Text>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          )}

          {showGlobalEmptyState ? (
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

      <Modal
        animationType="fade"
        transparent
        visible={menuVisible}
        onDismiss={() => setMenuState(null)}
        onRequestClose={closeMenu}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Dismiss completed session menu overlay"
            onPress={closeMenu}
            style={styles.modalOverlay}
            testID="completed-session-menu-overlay"
          />
          {menuState?.action === 'delete' ? (
            <View style={styles.modalPanel} testID="completed-session-delete-modal-card">
              <View style={styles.modalActionRow} testID="completed-session-menu-action-row">
                <Pressable
                  accessibilityLabel="Edit completed session"
                  accessibilityRole="button"
                  onPress={handleEdit}
                  style={[styles.modalActionButton, styles.modalActionRowButton, styles.modalNeutralButton]}
                  testID="completed-session-edit-menu-action-button">
                  <Text style={styles.modalNeutralButtonText}>Edit</Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Append completed session to workout log"
                  accessibilityRole="button"
                  onPress={handleAppend}
                  style={[
                    styles.modalActionButton,
                    styles.modalActionRowButton,
                    styles.modalNeutralButton,
                  ]}
                  testID="completed-session-reopen-menu-action-button">
                  <Text
                    style={[
                      styles.modalNeutralButtonText,
                    ]}>Append</Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Delete completed session"
                  accessibilityRole="button"
                  onPress={applyMenuAction}
                  style={[styles.modalActionButton, styles.modalActionRowButton, styles.modalDangerButton]}
                  testID="completed-session-modal-action-button">
                  <Text style={styles.modalDangerButtonText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {menuState?.action === 'undelete' ? (
            <View style={styles.modalPanel} testID="completed-session-undelete-modal-card">
              <View style={styles.modalActionRow} testID="completed-session-menu-action-row">
                <Pressable
                  accessibilityLabel="Edit completed session"
                  accessibilityRole="button"
                  onPress={handleEdit}
                  style={[styles.modalActionButton, styles.modalActionRowButton, styles.modalNeutralButton]}
                  testID="completed-session-edit-menu-action-button">
                  <Text style={styles.modalNeutralButtonText}>Edit</Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Append completed session to workout log"
                  accessibilityRole="button"
                  onPress={handleAppend}
                  style={[
                    styles.modalActionButton,
                    styles.modalActionRowButton,
                    styles.modalNeutralButton,
                  ]}
                  testID="completed-session-reopen-menu-action-button">
                  <Text
                    style={[
                      styles.modalNeutralButtonText,
                    ]}>Append</Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="Undelete completed session"
                  accessibilityRole="button"
                  onPress={applyMenuAction}
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

const styles = StyleSheet.create({
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
  deletedCompletedRow: {
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
    opacity: 0.9,
  },
  sessionRowMainPressable: {
    flex: 1,
    minWidth: 0,
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
