import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { UiButton, UiText, uiColors, uiSpace } from '@/components/ui';
import type { GroupApiError } from '@/src/groups';

type GroupPagesFooterProps = {
  loadingMore: boolean;
  loadMoreError: GroupApiError | null;
  onRetry: () => void;
  /** e.g. "rows", "history" — "Couldn't load more <noun>." */
  noun: string;
  /** testIDs `<prefix>-loading-more`, `<prefix>-load-more-error`, `<prefix>-load-more-retry`. */
  testIDPrefix: string;
};

/** The footer of an online paged list: a spinner while the next page loads, or its failure with Retry. */
export function GroupPagesFooter({ loadingMore, loadMoreError, onRetry, noun, testIDPrefix }: GroupPagesFooterProps) {
  if (loadingMore) {
    return <ActivityIndicator color={uiColors.textSecondary} testID={`${testIDPrefix}-loading-more`} />;
  }
  if (!loadMoreError) {
    return null;
  }
  return (
    <View style={styles.footer} testID={`${testIDPrefix}-load-more-error`}>
      <UiText variant="bodyMuted">{`Couldn't load more ${noun}. ${loadMoreError.message}`}</UiText>
      <UiButton label="Retry" onPress={onRetry} testID={`${testIDPrefix}-load-more-retry`} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: uiSpace.sm,
  },
});
