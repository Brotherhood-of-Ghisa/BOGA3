import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, IconButton, ListRow, Sheet, uiRoles, uiSpace } from '@/components/ui';

import { formatDateTimeStamp, SessionSummaryLine } from './session-summary-line';
import type { SessionListItem } from './types';

export type ActiveSessionRowProps = {
  session: SessionListItem;
  nowMs?: number;
  onResume: () => void;
  onComplete: () => void;
  onDelete: () => void;
};

/**
 * The active session as a card: its summary (resume), a check (review and
 * complete) and ⋮, which opens a sheet with Delete. Discarding an active
 * session cannot be undone, so Delete asks first (T10-D4).
 */
export function ActiveSessionRow({
  session,
  nowMs,
  onResume,
  onComplete,
  onDelete,
}: ActiveSessionRowProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  const closeMenu = () => setMenuVisible(false);

  // The alert opens over the sheet; either answer closes both.
  const confirmDelete = () => {
    Alert.alert(
      'Discard this workout?',
      'The active session and its sets will be deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: closeMenu },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            closeMenu();
            onDelete();
          },
        },
      ],
      { cancelable: true, onDismiss: closeMenu }
    );
  };

  return (
    <>
      <Card testID={`active-session-row-${session.id}`}>
        <ListRow
          density="list"
          divider={false}
          leading={<Icon color={uiRoles.ink} name="set-current" size="sm" />}
          meta={
            <IconButton
              accessibilityLabel="Review and complete active session"
              name="check"
              onPress={onComplete}
              testID="complete-active-session-button"
            />
          }
          trailing={
            <IconButton
              accessibilityLabel="Open active session actions"
              name="more-vertical"
              onPress={() => setMenuVisible(true)}
              tone="muted"
              testID="active-session-menu-button"
            />
          }>
          <Pressable
            accessibilityLabel="Resume active session"
            accessibilityRole="button"
            onPress={onResume}
            style={styles.summary}
            testID="resume-active-session-button">
            <SessionSummaryLine nowMs={nowMs} session={session} testIdPrefix={`session-summary-${session.id}`} />
          </Pressable>
        </ListRow>
      </Card>

      <Sheet
        dismissLabel="Dismiss active session actions"
        onDismiss={closeMenu}
        testID="active-session-menu"
        title={formatDateTimeStamp(session.startedAt)}
        visible={menuVisible}>
        <View>
          <ListRow
            accessibilityLabel="Delete active session"
            label="Delete"
            onPress={confirmDelete}
            testID="discard-active-session-button"
            tone="danger"
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  summary: {
    paddingVertical: uiSpace.sm,
  },
});
