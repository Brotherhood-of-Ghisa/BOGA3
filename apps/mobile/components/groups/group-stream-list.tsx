import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { UiButton, UiText, uiColors, uiSpace } from '@/components/ui';
import {
  buildStreamItemViewModel,
  buildStreamViewModel,
  recordSetFromStreamRecord,
  recordSetKey,
  useRecordSetCertification,
  type GroupRole,
  type GroupStreamState,
  type RecordSetDetail,
  type StreamItemViewModel,
  type StreamMembershipViewModel,
  type StreamSessionCardViewModel,
} from '@/src/groups';

import { RecordSetSheet } from './record-set-sheet';
import { groupScreenStyles } from './screen-styles';
import { GroupStreamMembershipItem } from './stream-membership-item';
import { GroupStreamRecordCard } from './stream-record-card';
import { GroupStreamSentenceItem } from './stream-sentence-item';
import { GroupStreamSessionCard } from './stream-session-card';

type GroupStreamListProps = {
  stream: GroupStreamState;
  userId: string;
  /** My role in a record's group (Cancel certification); null when unknown. */
  roleForGroup: (groupId: string) => GroupRole | null;
  /**
   * Re-read after a certification write, or after one that found the data (or
   * my access) had moved on. It refreshes the stream at least.
   */
  onCertificationChanged: () => void;
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

/**
 * Newest-first stream with pull-to-refresh and online infinite scroll (older
 * pages). Record cards open the shared row detail sheet and certify inline; the
 * list owns the one certification write state both use (M25-T10).
 */
export function GroupStreamList({
  stream,
  userId,
  roleForGroup,
  onCertificationChanged,
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
  const certification = useRecordSetCertification({
    myUserId: userId,
    onChanged: onCertificationChanged,
    onLostAccess: onCertificationChanged,
  });
  // The open sheet follows the live stream item, so a refresh after a write shows the server's state.
  const [sheetSnapshot, setSheetSnapshot] = useState<{ itemKey: string; detail: RecordSetDetail } | null>(null);
  const sheetDetail = useMemo(() => {
    if (!sheetSnapshot) return null;
    const live = stream.items.find((item) => item.kind === 'record' && item.key === sheetSnapshot.itemKey);
    return live && live.kind === 'record' ? recordSetFromStreamRecord(live) : sheetSnapshot.detail;
  }, [sheetSnapshot, stream.items]);

  // New stream data carries the write; stop overriding it.
  const { clearWritten, written, reset } = certification;
  useEffect(() => {
    clearWritten();
  }, [stream.items, clearWritten]);

  const viewModels = useMemo(() => {
    const models = buildStreamViewModel(stream.items, userId);
    if (!written) return models;
    return models.map((model): StreamItemViewModel => {
      if (model.kind !== 'record' || model.record.voided !== null) return model;
      if (recordSetKey(recordSetFromStreamRecord(model.record)) !== written.setKey) return model;
      return buildStreamItemViewModel(
        { ...model.record, certified: written.certification !== null, certification: written.certification },
        userId,
      );
    });
  }, [stream.items, userId, written]);
  const { loadMore, loadMoreError, loadingMore } = stream;

  const openSheet = useCallback(
    (itemKey: string, detail: RecordSetDetail) => {
      reset();
      setSheetSnapshot({ itemKey, detail });
    },
    [reset],
  );

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

  const renderItem = ({ item }: { item: StreamItemViewModel }) => {
    switch (item.kind) {
      case 'session':
        return <GroupStreamSessionCard card={item} onPress={onPressSession} showGroupNames={showGroupNames} />;
      case 'membership':
        return <GroupStreamMembershipItem item={item} onPress={onPressMembership} showGroupName={showGroupNames} />;
      case 'record': {
        const detail = recordSetFromStreamRecord(item.record);
        const setKey = recordSetKey(detail);
        return (
          <GroupStreamRecordCard
            card={item}
            certifying={certification.pendingSetKey === setKey}
            notice={sheetDetail === null && certification.notice?.setKey === setKey ? certification.notice : null}
            onCertify={() => void certification.certify(detail)}
            onPress={() => openSheet(item.key, detail)}
            showGroupName={showGroupNames}
          />
        );
      }
      default:
        return <GroupStreamSentenceItem item={item} showGroupName={showGroupNames} />;
    }
  };

  return (
    <>
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
        renderItem={renderItem}
        style={groupScreenStyles.screen}
        testID={testID}
      />
      <RecordSetSheet
        certification={certification}
        detail={sheetDetail}
        myRole={sheetDetail ? roleForGroup(sheetDetail.groupId) : null}
        onClose={() => setSheetSnapshot(null)}
        userId={userId}
      />
    </>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: uiSpace.sm,
  },
});
