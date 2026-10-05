import { useMemo, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, type StyleProp, type ViewStyle } from 'react-native';
import { StatePanel } from '@/components/ui';
import type { GroupRole, GroupStreamState, StreamMembershipViewModel } from '@/src/groups';
import { buildCompetitionStreamItem, type CompetitionSessionCard, type CompetitionStreamModel } from '@/src/groups/competition-stream-view-model';
import { GroupMetricStreamRecordSheet } from './group-metric-stream-record-sheet';
import { GroupMetricStreamCard } from './group-metric-stream-card';
import { groupScreenStyles } from './screen-styles';
import { GroupStreamMembershipItem } from './stream-membership-item';
import { GroupStreamSessionCard } from './stream-session-card';

type Props = {
  stream: GroupStreamState; userId: string; roleForGroup: (groupId: string) => GroupRole | null;
  onCertificationChanged: () => void; showGroupNames: boolean;
  onPressSession: (card: CompetitionSessionCard) => void;
  onPressMembership?: (item: StreamMembershipViewModel) => void;
  pulling: boolean; onRefresh: () => void; header: ReactElement; emptyState: ReactElement;
  contentContainerStyle?: StyleProp<ViewStyle>; testID: string;
};

export function GroupStreamList({ stream,userId,roleForGroup,onCertificationChanged,showGroupNames,
  onPressSession,onPressMembership,pulling,onRefresh,header,emptyState,contentContainerStyle,testID }: Props) {
  const [selectedKey,setSelectedKey] = useState<string | null>(null);
  // No snapshot fallback: access, mode or account changes immediately remove an open detail.
  const live = stream.items.find(item => item.key === selectedKey);
  const models = useMemo(() => stream.items.map(buildCompetitionStreamItem),[stream.items]);
  const refresh = async () => { await stream.refresh(); onCertificationChanged(); };
  const renderItem = ({ item }: { item: CompetitionStreamModel }) => {
    if (item.kind === 'session') return <GroupStreamSessionCard card={item} onPress={onPressSession} showGroupNames={showGroupNames} />;
    if (item.kind === 'membership') return <GroupStreamMembershipItem item={item} onPress={onPressMembership} showGroupName={showGroupNames} />;
    return <GroupMetricStreamCard item={item.event} userId={userId} showGroupName={showGroupNames}
      onPress={item.event.kind === 'record' ? () => setSelectedKey(item.key) : undefined}
      pressHint={item.event.kind === 'record' ? 'View record and certification' : undefined} />;
  };
  const footer = stream.loadingMore ? <StatePanel fill={false} kind="loading" testID={`${testID}-loading-more`} />
    : stream.loadMoreError ? <StatePanel fill={false} kind="error" body="Could not load older items."
      action={{ label: 'Retry',onPress: () => void stream.loadMore(),testID: `${testID}-load-more-retry` }} /> : undefined;
  return <>
    <FlatList ListEmptyComponent={emptyState} ListFooterComponent={footer} ListHeaderComponent={header}
      contentContainerStyle={[groupScreenStyles.content,contentContainerStyle]} data={models}
      keyExtractor={item => `${item.kind}:${item.key}`} renderItem={renderItem}
      onEndReached={() => void stream.loadMore()} onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      style={groupScreenStyles.screen} testID={testID} />
    {live?.kind === 'competition' && live.event.kind === 'record' ?
      <GroupMetricStreamRecordSheet key={`${userId}:${live.key}`} record={live.event} userId={userId}
        myRole={roleForGroup(live.event.group.group_id)} onClose={() => setSelectedKey(null)} onChanged={refresh} /> : null}
  </>;
}
