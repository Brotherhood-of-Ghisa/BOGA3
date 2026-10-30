import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Card, uiSpace } from '@/components/ui';
import { useDateFormat } from '@/src/preferences/hooks';
import { useCoWSummary } from '@/src/groups/use-cow-summary';
import { coWsHref } from '@/src/navigation/routes';
import { CoWPreview } from './cow-preview';
import { GroupInlineError, GroupMissingDataState, pickInlineError } from './group-state-view';
import { GroupOfflineBanner } from './offline-banner';

/** Confirmed absence uses no space; a populated preview opens the displayed CoW. */
export function CoWGroupPreview({ groupId, userId, today = false }: { groupId: string; userId: string; today?: boolean }) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const summary = useCoWSummary(groupId, userId);
  const error = pickInlineError(summary.error);
  const prefix = today ? 'today-cow' : 'group-cow';
  if (summary.lostAccess) return null;
  const result = summary.data?.result;
  if (summary.data?.selection === 'none') return null;
  return <View style={{ gap: uiSpace.sm }} testID={`${prefix}-section`}>
    {summary.offline && result ? <GroupOfflineBanner lastUpdatedAtMs={summary.lastUpdatedAtMs} /> : null}
    {error && result ? <GroupInlineError error={error} onRetry={() => void summary.refresh()} testID={`${prefix}-error`} /> : null}
    {result ? <CoWPreview key={`${groupId}:${result.cow.cow_id}`} result={result} userId={userId} dateFormat={dateFormat} today={today}
      previous={summary.data?.selection === 'previous_final'} testID={prefix}
      onOpen={metric => router.push(coWsHref(groupId, result.cow.cow_id, metric))} />
      : <Card><GroupMissingDataState error={error} offline={summary.offline} onRetry={() => void summary.refresh()} testIDPrefix={prefix} /></Card>}
  </View>;
}
