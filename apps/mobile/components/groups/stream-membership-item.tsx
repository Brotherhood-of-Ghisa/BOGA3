import { Pressable, Text, View } from 'react-native';

import type { StreamMembershipViewModel } from '@/src/groups';

import { streamRowStyles } from './stream-sentence-item';

type GroupStreamMembershipItemProps = {
  item: StreamMembershipViewModel;
  showGroupName: boolean;
  /** Opens the item's group. Omitted on the group screen (already there). */
  onPress?: (item: StreamMembershipViewModel) => void;
};

/** "X joined / left the group / was removed" (C7.3): a light row, not a card (08 pattern 6). */
export function GroupStreamMembershipItem({ item, showGroupName, onPress }: GroupStreamMembershipItemProps) {
  const testID = `group-stream-membership-${item.key}`;
  const content = (
    <View style={streamRowStyles.row}>
      <Text allowFontScaling={false} style={streamRowStyles.sentence}>
        {item.sentence}
      </Text>
      {showGroupName ? (
        <Text allowFontScaling={false} numberOfLines={1} style={streamRowStyles.group}>
          {item.groupName}
        </Text>
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
      style={({ pressed }) => (pressed ? streamRowStyles.pressed : null)}
      testID={testID}>
      {content}
    </Pressable>
  );
}
