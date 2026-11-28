import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { ActionButton, ListRow, Sheet, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import { buildMeetLeaderboard, TROPHY_PLACE_LABELS, TROPHY_PLACE_WORDS, trophyLabel } from '@/src/groups/meet-results-view-model';
import { meetHref } from '@/src/groups/meet-presentation';
import type { MedalRow } from '@/src/groups/medal-view-model';
import type { MeetLeaderboardWire } from '@/src/groups/meet-results-wire';
import { useMeetTrophies } from '@/src/groups/use-meet-results';
import type { GroupResourceState } from '@/src/groups/use-group-resource';
import { useDateFormat } from '@/src/preferences/hooks';
import { GroupMedalBoard } from './group-medal-board';
import { GroupInlineError, GroupMissingDataState, pickInlineError } from './group-state-view';
import { GroupOfflineBanner } from './offline-banner';

/**
 * The Meets leaderboard pinned on the Meets page: trophy counts per member
 * from the server's ranks (ties share one), former members marked. A row opens
 * that member's trophies, each linking to its meet.
 */
export function MeetLeaderboard({ groupId, userId, resource }: { groupId: string; userId: string; resource: GroupResourceState<MeetLeaderboardWire> }) {
  const [member, setMember] = useState<MedalRow | null>(null);
  const board = useMemo(() => resource.data ? buildMeetLeaderboard(resource.data, userId) : null, [resource.data, userId]);
  const error = pickInlineError(resource.error);
  if (!board) return resource.lostAccess || !(error || resource.offline) ? null
    : <GroupMissingDataState error={error} offline={resource.offline} onRetry={() => void resource.refresh()} testIDPrefix="meet-leaderboard" />;
  return <>
    {resource.offline ? <GroupOfflineBanner lastUpdatedAtMs={resource.lastUpdatedAtMs} /> : null}
    {error ? <GroupInlineError testID="meet-leaderboard-error" error={error} onRetry={() => void resource.refresh()} /> : null}
    <GroupMedalBoard board={board} title="Meets leaderboard" testIDPrefix="meet-leaderboard" emptyLabel="No trophies yet" medalMarks onOpenMember={setMember} />
    {member ? <MeetTrophiesSheet key={member.userId} groupId={groupId} userId={userId} member={member} onDismiss={() => setMember(null)} /> : null}
  </>;
}

function MeetTrophiesSheet({ groupId, userId, member, onDismiss }: { groupId: string; userId: string; member: MedalRow; onDismiss: () => void }) {
  const router = useRouter(); const text = useUiText(); const tone = useUiTextTone(); const format = useDateFormat();
  const trophies = useMeetTrophies(groupId, member.userId, userId);
  const error = pickInlineError(trophies.error, trophies.loadMoreError);
  return <Sheet visible onDismiss={onDismiss} dismissLabel="Dismiss trophies" testID="meet-trophies" title={`${member.memberLabel} · Trophies`}>
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: uiSpace.md, gap: uiSpace.sm }}>
      {!trophies.firstPage ? <GroupMissingDataState error={error} offline={trophies.offline} onRetry={() => void trophies.refresh()} testIDPrefix="meet-trophies" /> : <>
        {trophies.items.map(trophy => <ListRow key={trophy.challenge_id} density="compact" testID={`meet-trophy-${trophy.challenge_id}`}
          label={`${TROPHY_PLACE_LABELS[trophy.place]} ${trophy.exercise_name}`} description={trophyLabel(trophy, format)}
          accessibilityLabel={`${TROPHY_PLACE_WORDS[trophy.place]}, ${trophy.exercise_name}, ${trophyLabel(trophy, format)}`}
          accessibilityHint="Opens the meet" onPress={() => { onDismiss(); router.push(meetHref(groupId, trophy.meet_id)); }} />)}
        {!trophies.items.length ? <Text allowFontScaling={false} style={[text.body, tone.muted]} testID="meet-trophies-empty">No trophies yet</Text> : null}
        {error ? <GroupInlineError testID="meet-trophies-error" error={error} onRetry={() => void trophies.loadMore()} /> : null}
        {trophies.hasMore ? <ActionButton label={trophies.loadingMore ? 'Loading…' : 'More trophies'} variant="text" disabled={trophies.loadingMore || trophies.offline}
          testID="meet-trophies-more" onPress={() => void trophies.loadMore()} /> : null}
      </>}
    </ScrollView>
  </Sheet>;
}
