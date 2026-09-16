import { StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiSpace } from '@/components/ui';
import type { BoardRowViewModel } from '@/src/groups';

/**
 * One full-board row (E1.2): rank, member ("You", "(former)"), value, date, and
 * on All the ✓ / ○ uncertified mark. Not pressable until the row detail (M25-T10).
 */
export function GroupBoardRow({ row }: { row: BoardRowViewModel }) {
  const testID = `group-board-row-${row.rank}`;
  return (
    <UiSurface
      accessibilityLabel={row.accessibilityLabel}
      accessible
      style={styles.row}
      testID={testID}
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
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    padding: uiSpace.lg,
  },
  rank: {
    minWidth: 28,
    textAlign: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xxs,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: uiSpace.xxs,
  },
});
