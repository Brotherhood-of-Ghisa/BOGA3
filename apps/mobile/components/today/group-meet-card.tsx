import { View } from 'react-native';
import { MeetSummaryCard } from '@/components/groups/meet-summary-card';
import { pickTodayMeet } from '@/src/groups/meet-today';
import { useMeetClock, useMeets } from '@/src/groups/use-meets';

/** Today's meet card ([[meets.today-card]]); absence, a failed first read and lost access take no space, as the CoW card does. */
export function TodayMeetCard({ groupId, userId }: { groupId: string; userId: string }) {
  const meets = useMeets(groupId, userId);
  const now = useMeetClock();
  const meet = meets.data && !meets.lostAccess ? pickTodayMeet(meets.data, now) : null;
  if (!meet) return null;
  return <View testID="today-meet-card"><MeetSummaryCard meet={meet} /></View>;
}
