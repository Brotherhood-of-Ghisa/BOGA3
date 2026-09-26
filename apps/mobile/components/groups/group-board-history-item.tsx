import { StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { BoardHistoryItemViewModel } from '@/src/groups';

import { cardListItemStyles } from './screen-styles';

type GroupBoardHistoryItemProps = {
  item: BoardHistoryItemViewModel;
  testID: string;
  /** Its place in the history's one card (the list draws the card across its cells). */
  index: number;
  count: number;
};

/** One lead change (E1.3), a row of the history's card: the date in small Plex Mono, then the sentence. */
export function GroupBoardHistoryItem({ item, testID, index, count }: GroupBoardHistoryItemProps) {
  return (
    <View style={cardListItemStyles(index, count)}>
      <View
        accessibilityLabel={`${item.dateLabel}, ${item.sentence}`}
        accessible
        style={[styles.item, index > 0 ? styles.divider : null]}
        testID={testID}>
        <Text allowFontScaling={false} style={styles.date} testID={`${testID}-date`}>
          {item.dateLabel}
        </Text>
        <Text allowFontScaling={false} style={styles.sentence} testID={`${testID}-sentence`}>
          {item.sentence}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  divider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  date: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    color: uiRoles.inkMuted,
  },
  sentence: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
});
