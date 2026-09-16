import { StyleSheet } from 'react-native';

import { UiSurface, UiText, uiSpace } from '@/components/ui';
import type { BoardHistoryItemViewModel } from '@/src/groups';

/** One lead change (E1.3): the date, then the sentence. */
export function GroupBoardHistoryItem({ item, testID }: { item: BoardHistoryItemViewModel; testID: string }) {
  return (
    <UiSurface
      accessibilityLabel={`${item.dateLabel}, ${item.sentence}`}
      accessible
      style={styles.item}
      testID={testID}>
      <UiText testID={`${testID}-date`} variant="subtitle">
        {item.dateLabel}
      </UiText>
      <UiText testID={`${testID}-sentence`} variant="body">
        {item.sentence}
      </UiText>
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  item: {
    padding: uiSpace.lg,
    gap: uiSpace.xxs,
  },
});
