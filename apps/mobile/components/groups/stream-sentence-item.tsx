import { StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
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
      style={streamRowStyles.row}
      testID={testID}>
      <Text allowFontScaling={false} style={streamRowStyles.sentence} testID={`${testID}-sentence`}>
        {item.sentence}
      </Text>
      {showGroupName ? (
        <Text allowFontScaling={false} numberOfLines={1} style={streamRowStyles.group}>
          {item.groupName}
        </Text>
      ) : null}
    </View>
  );
}

/** The stream's light rows (membership, link, record removed): words on the page ground behind a `rule` hairline. */
export const streamRowStyles = StyleSheet.create({
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
    backgroundColor: uiRoles.surfaceSubtle,
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
