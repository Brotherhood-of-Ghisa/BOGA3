import { Pressable, StyleSheet, View } from 'react-native';

import { UiText, uiColors, uiSpace } from '@/components/ui';
import type { StreamMembershipViewModel } from '@/src/groups';

type GroupStreamMembershipItemProps = {
  item: StreamMembershipViewModel;
  showGroupName: boolean;
  /** Opens the item's group. Omitted on the group screen (already there). */
  onPress?: (item: StreamMembershipViewModel) => void;
};

/** "X joined / left the group / was removed" (C7.3): a light row, not a card. */
export function GroupStreamMembershipItem({ item, showGroupName, onPress }: GroupStreamMembershipItemProps) {
  const testID = `group-stream-membership-${item.key}`;
  const content = (
    <View style={styles.row}>
      <UiText style={styles.sentence} variant="label">
        {item.sentence}
      </UiText>
      {showGroupName ? (
        <UiText numberOfLines={1} variant="subtitle">
          {item.groupName}
        </UiText>
      ) : null}
    </View>
  );

  if (!onPress) {
    return <View testID={testID}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityHint="Opens the group"
      accessibilityLabel={`${item.sentence}, ${item.groupName}`}
      accessibilityRole="button"
      onPress={() => onPress(item)}
      testID={testID}>
      {content}
    </Pressable>
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
