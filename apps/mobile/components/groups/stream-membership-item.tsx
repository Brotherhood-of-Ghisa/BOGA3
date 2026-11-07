import { Pressable, Text, View } from 'react-native';

import { makeStyles, uiBorder, uiGeometry, uiSpace, useTextRoles } from '@/components/ui';
import type { StreamMembershipViewModel } from '@/src/groups';

type GroupStreamMembershipItemProps = {
  item: StreamMembershipViewModel;
  showGroupName: boolean;
  /** Opens the item's group. Omitted on the group screen (already there). */
  onPress?: (item: StreamMembershipViewModel) => void;
};

/** "X joined / left the group / was removed": a light row, not a card (08 pattern 6). */
export function GroupStreamMembershipItem({ item, showGroupName, onPress }: GroupStreamMembershipItemProps) {
  const streamRowStyles = useStreamRowStyles();
  const { text, tone } = useTextRoles();
  const testID = `group-stream-membership-${item.key}`;
  const content = (
    <View style={streamRowStyles.row}>
      <Text allowFontScaling={false} style={[text.body, tone.muted]}>
        {item.sentence}
      </Text>
      {showGroupName ? (
        <Text allowFontScaling={false} numberOfLines={1} style={text.meta}>
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

/** The stream's light row: words on the page ground behind a `rule` hairline. */
const useStreamRowStyles = makeStyles((roles) => ({
  row: {
    minHeight: uiGeometry.tapTarget,
    justifyContent: 'center',
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    borderLeftWidth: uiBorder.width,
    borderLeftColor: roles.rule,
  },
  pressed: {
    backgroundColor: roles.paper,
  },
}));
