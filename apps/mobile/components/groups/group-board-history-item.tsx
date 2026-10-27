import { StyleSheet, Text, View } from 'react-native';

import { FigureText, uiBorder, uiRoles, uiSpace, uiText } from '@/components/ui';
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
        <Text allowFontScaling={false} style={uiText.figureSmall} testID={`${testID}-date`}>
          {item.dateLabel}
        </Text>
        <Text allowFontScaling={false} style={uiText.body} testID={`${testID}-sentence`}>
          <FigureText>{item.sentence}</FigureText>
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
});
