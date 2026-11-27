import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { ActionButton, uiSpace } from '@/components/ui';
import { canManageGroup, type GroupRole } from '@/src/groups';
import { useMeets } from '@/src/groups/use-meets';
import { meetHref, meetScheduleHref } from '@/src/groups/meet-presentation';
import { MeetSummaryCard } from './meet-summary-card';
import { GroupMissingDataState, pickInlineError } from './group-state-view';
import { GroupOfflineBanner } from './offline-banner';

export function MeetGroupPreview({ groupId, userId, role }: { groupId: string; userId: string; role: GroupRole }) {
  const router = useRouter(); const meets = useMeets(groupId, userId);
  if (meets.lostAccess) return null;
  return <View style={{ gap: uiSpace.sm }} testID="group-meets-preview">
    {meets.offline && meets.data ? <GroupOfflineBanner lastUpdatedAtMs={meets.lastUpdatedAtMs} /> : null}
    {meets.data ? <>
      {meets.data.upcoming[0] ? <MeetSummaryCard meet={meets.data.upcoming[0]} /> : null}
      <ActionButton label="Meets" variant="text" onPress={() => router.push(meetHref(groupId))} />
      {canManageGroup(role) ? <ActionButton label="Schedule meet" variant="text" testID="group-meets-schedule" onPress={() => router.push(meetScheduleHref(groupId))} /> : null}
    </> : <GroupMissingDataState error={pickInlineError(meets.error)} offline={meets.offline} onRetry={() => void meets.refresh()} testIDPrefix="group-meets" />}
  </View>;
}
