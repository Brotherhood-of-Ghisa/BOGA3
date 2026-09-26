import { StatePanel } from '@/components/ui';
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
    return <StatePanel fill={false} kind="loading" testID={`${testIDPrefix}-loading-more`} />;
  }
  if (!loadMoreError) {
    return null;
  }
  return (
    <StatePanel
      action={{ label: 'Retry', onPress: onRetry, testID: `${testIDPrefix}-load-more-retry` }}
      body={`Couldn't load more ${noun}. ${loadMoreError.message}`}
      fill={false}
      kind="error"
      testID={`${testIDPrefix}-load-more-error`}
    />
  );
}
