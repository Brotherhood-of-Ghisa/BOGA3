import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { uiColors } from '@/components/ui';

import { SessionSummaryLine } from './session-summary-line';
import type { SessionListItem } from './types';

export type ActiveSessionRowProps = {
  session: SessionListItem;
  nowMs?: number;
  onResume: () => void;
  onComplete: () => void;
  onDelete: () => void;
};

/**
 * Renders the active-session row (date/duration/gym summary plus resume/complete
 * actions) and owns its overflow menu modal (currently only a Delete action).
 */
export function ActiveSessionRow({
  session,
  nowMs,
  onResume,
  onComplete,
  onDelete,
}: ActiveSessionRowProps) {
  const [menuVisible, setMenuVisible] = useState(false);

  const handleDelete = () => {
    setMenuVisible(false);
    onDelete();
  };

  return (
    <>
      <View
        style={[styles.sessionRow, styles.activeSessionRow]}
        testID={`active-session-row-${session.id}`}>
        <Pressable
          accessibilityLabel="Resume active session"
          accessibilityRole="button"
          onPress={onResume}
          style={styles.sessionRowMainPressable}
          testID="resume-active-session-button">
          <SessionSummaryLine
            session={session}
            testIdPrefix={`session-summary-${session.id}`}
            nowMs={nowMs}
          />
        </Pressable>

        <View style={styles.sessionRowActions}>
          <Pressable
            accessibilityLabel="Complete active session"
            accessibilityRole="button"
            onPress={onComplete}
            style={[styles.iconActionButton, styles.completeButton]}
            testID="complete-active-session-button">
            <Text style={[styles.iconGlyphText, styles.completeGlyphText]}>✓</Text>
          </Pressable>

          <Pressable
            accessibilityLabel="Open active session actions"
            accessibilityRole="button"
            onPress={() => setMenuVisible(true)}
            style={[styles.iconActionButton, styles.menuButton]}
            testID="active-session-menu-button">
            <Text style={styles.iconGlyphText}>⋮</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={menuVisible}
        onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Dismiss active session menu overlay"
            onPress={() => setMenuVisible(false)}
            style={styles.modalOverlay}
            testID="active-session-menu-overlay"
          />
          <View style={styles.modalPanel}>
            <Pressable
              accessibilityLabel="Delete active session"
              accessibilityRole="button"
              onPress={handleDelete}
              style={[styles.modalActionButton, styles.modalDangerButton]}
              testID="discard-active-session-button">
              <Text style={styles.modalDangerButtonText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  sessionRowMainPressable: {
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
  modalActionButton: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
});
