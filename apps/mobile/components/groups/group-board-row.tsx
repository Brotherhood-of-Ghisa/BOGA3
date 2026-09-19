import { Pressable, StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiSpace } from '@/components/ui';
import type { BoardRowViewModel } from '@/src/groups';

/**
 * One full-board row (E1.2): rank, member ("You", "(former)"), value, date, and
 * on All the ✓ / ○ uncertified mark. The whole row opens the row detail sheet
 * (E2, M25-T10).
 */
export function GroupBoardRow({ row, onPress }: { row: BoardRowViewModel; onPress: (row: BoardRowViewModel) => void }) {
  const testID = `group-board-row-${row.rank}`;
  return (
    <Pressable
      accessibilityHint="Opens the set"
      accessibilityLabel={row.accessibilityLabel}
      accessibilityRole="button"
      onPress={() => onPress(row)}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
      testID={testID}>
      <UiSurface
        style={styles.row}
        // My own row stands out on a muted panel; "You" says so in text too.
        variant={row.isMe ? 'panelMuted' : 'card'}>
        <UiText style={styles.rank} variant="title">
          {row.rankLabel}
        </UiText>
        <View style={styles.body}>
          <UiText numberOfLines={1} testID={`${testID}-member`} variant="label">
            {row.memberLabel}
          </UiText>
          <UiText testID={`${testID}-value`} variant="body">
            {row.valueLabel}
          </UiText>
          {row.detailLabel ? (
            <UiText testID={`${testID}-detail`} variant="bodyMuted">
              {row.detailLabel}
            </UiText>
          ) : null}
        </View>
        <View style={styles.trailing}>
          <UiText testID={`${testID}-date`} variant="subtitle">
            {row.dateLabel}
          </UiText>
          {row.certifiedMark ? (
            <UiText testID={`${testID}-mark`} variant="subtitle">
              {row.certifiedMark}
            </UiText>
          ) : null}
        </View>
      </UiSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.92,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    padding: uiSpace.md,
  },
  rank: {
    minWidth: 28,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: uiSpace.xs,
  },
});
