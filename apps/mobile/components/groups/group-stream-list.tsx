import { useMemo, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { UiButton, UiText, uiColors, uiSpace } from '@/components/ui';
import {
  buildStreamViewModel,
  type GroupStreamState,
  type StreamMembershipViewModel,
  type StreamSessionCardViewModel,
} from '@/src/groups';

import { groupScreenStyles } from './screen-styles';
import { GroupStreamMembershipItem } from './stream-membership-item';
import { GroupStreamSessionCard } from './stream-session-card';

type GroupStreamListProps = {
  stream: GroupStreamState;
  /** All: name each item's groups. A single group's stream does not. */
  showGroupNames: boolean;
  onPressSession: (card: StreamSessionCardViewModel) => void;
  onPressMembership?: (item: StreamMembershipViewModel) => void;
  pulling: boolean;
  onRefresh: () => void;
  header: ReactElement;
  emptyState: ReactElement;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID: string;
};

/** Newest-first stream with pull-to-refresh and online infinite scroll (older pages). */
export function GroupStreamList({
  stream,
  showGroupNames,
  onPressSession,
  onPressMembership,
  pulling,
  onRefresh,
  header,
  emptyState,
  contentContainerStyle,
  testID,
}: GroupStreamListProps) {
  const viewModels = useMemo(() => buildStreamViewModel(stream.items), [stream.items]);
  const { loadMore, loadMoreError, loadingMore } = stream;

  let footer: ReactElement | null = null;
  if (loadingMore) {
    footer = <ActivityIndicator color={uiColors.textSecondary} testID={`${testID}-loading-more`} />;
  } else if (loadMoreError) {
    footer = (
      <View style={styles.footer}>
        <UiText variant="bodyMuted">{`Couldn't load older items. ${loadMoreError.message}`}</UiText>
        <UiButton label="Retry" onPress={() => void loadMore()} testID={`${testID}-load-more-retry`} variant="secondary" />
      </View>
    );
  }

  return (
    <FlatList
      ListEmptyComponent={emptyState}
      ListFooterComponent={footer}
      ListHeaderComponent={header}
      contentContainerStyle={[groupScreenStyles.content, contentContainerStyle]}
      data={viewModels}
      keyExtractor={(item) => `${item.kind}:${item.key}`}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      renderItem={({ item }) =>
        item.kind === 'session' ? (
          <GroupStreamSessionCard card={item} onPress={onPressSession} showGroupNames={showGroupNames} />
        ) : (
          <GroupStreamMembershipItem item={item} onPress={onPressMembership} showGroupName={showGroupNames} />
        )
      }
      style={groupScreenStyles.screen}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: uiSpace.sm,
  },
});
