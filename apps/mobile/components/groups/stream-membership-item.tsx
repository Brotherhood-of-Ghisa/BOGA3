import { Pressable, StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { StreamMembershipViewModel } from '@/src/groups';

type GroupStreamMembershipItemProps = {
  item: StreamMembershipViewModel;
  showGroupName: boolean;
  /** Opens the item's group. Omitted on the group screen (already there). */
  onPress?: (item: StreamMembershipViewModel) => void;
};

/** "X joined / left the group / was removed": a light row, not a card (08 pattern 6). */
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

/** The stream's light row: words on the page ground behind a `rule` hairline. */
const streamRowStyles = StyleSheet.create({
  row: {
    minHeight: uiGeometry.tapTarget,
    justifyContent: 'center',
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    borderLeftWidth: uiBorder.width,
    borderLeftColor: uiRoles.rule,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  sentence: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  group: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
