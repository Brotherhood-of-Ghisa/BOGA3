import { StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiSpace } from '@/components/ui';
import type { StreamSentenceViewModel } from '@/src/groups';

/**
 * A record-removed item (D15: who now holds the record) or a link item (P16:
 * what a link or unlink did to the boards). A light row, not a card, and not
 * pressable (08 pattern 6).
 */
export function GroupStreamSentenceItem({ item, showGroupName }: { item: StreamSentenceViewModel; showGroupName: boolean }) {
  const testID = item.kind === 'link' ? `group-stream-link-${item.key}` : `group-stream-record-removed-${item.key}`;
  return (
    <View
      accessibilityLabel={showGroupName ? `${item.sentence}, ${item.groupName}` : item.sentence}
      accessible
      style={styles.row}
      testID={testID}>
      <UiText style={styles.sentence} testID={`${testID}-sentence`} variant="label">
        {item.sentence}
      </UiText>
      {showGroupName ? (
        <UiText numberOfLines={1} variant="subtitle">
          {item.groupName}
        </UiText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    justifyContent: 'center',
    gap: uiSpace.xxs,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.sm,
    borderLeftWidth: 3,
    borderLeftColor: uiColors.borderMuted,
  },
  sentence: {
    color: uiColors.textSecondary,
  },
});
