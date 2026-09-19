import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';

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
            accessibilityLabel="Review and complete active session"
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
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
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
    gap: uiSpace.sm,
  },
  iconActionButton: {
    width: 28,
    height: 28,
    borderRadius: uiRadius.sm,
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
    fontSize: uiTypography.size.base,
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
    padding: uiSpace.xl,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  modalPanel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColors.borderMuted,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  modalActionButton: {
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.md,
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
