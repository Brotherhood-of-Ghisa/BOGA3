import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { CompactCard } from '@/components/ui/compact-card';
import { FormError } from '@/components/ui/form-section';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { useUiText } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { meetHref, meetTitle } from '@/src/groups/meet-presentation';
import type { SessionMeetTimes } from '@/src/groups/session-meets';
import { useSessionMeets } from '@/src/groups/use-session-meets';

type SessionMeetRowsProps = {
  sessionId: string;
  times: SessionMeetTimes;
};

/**
 * View Session's meet row ([[meets.linking]]): a finished session that overlaps
 * a meet's window shows Join or Leave until that meet's results cutoff, so a
 * cold cache offline at the gym is recovered later. It writes only this
 * session's synced link and reads cached meet lists; it renders nothing when no
 * cached meet overlaps.
 */
export function SessionMeetRows({ sessionId, times }: SessionMeetRowsProps) {
  const userId = useGroupLinkingUserId();
  const router = useRouter();
  const text = useUiText();
  const meets = useSessionMeets({ userId, sessionId, times, placement: 'page' });
  if (meets.rows.length === 0 && !meets.message) return null;
  return (
    <View style={{ gap: uiSpace.xs }} testID="session-meet-rows">
      {meets.rows.map((row) => {
        const { meet } = row;
        return (
          <CompactCard key={meet.meet_id} testID={`session-meet-row-${meet.meet_id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm }}>
              {row.joined ? <Icon name="check" size="sm" colorRole="ink" /> : null}
              <Text allowFontScaling={false} numberOfLines={1} style={[text.bodyStrong, { flex: 1 }]}>
                {row.joined ? `In ${meetTitle(meet)}` : `${meetTitle(meet)} · ${row.groupName}`}
              </Text>
              <ActionButton
                accessibilityLabel={`${row.joined ? 'Leave' : 'Join'} ${meetTitle(meet)}`}
                disabled={meets.busyMeetId !== null}
                label={row.joined ? 'Leave' : 'Join'}
                onPress={() => void (row.joined ? meets.leave(row) : meets.join(row))}
                size="compact"
                testID={`session-meet-row-${meet.meet_id}-${row.joined ? 'leave' : 'join'}`}
                variant="outline"
              />
              {row.joined ? (
                <IconButton
                  accessibilityLabel={`Open ${meetTitle(meet)}`}
                  name="chevron-right"
                  onPress={() => router.push(meetHref(meet.group_id, meet.meet_id))}
                  testID={`session-meet-row-${meet.meet_id}-open`}
                  tone="muted"
                />
              ) : null}
            </View>
          </CompactCard>
        );
      })}
      {meets.message ? <FormError message={meets.message} testID="session-meet-row-error" textRole="bodyStrong" /> : null}
    </View>
  );
}
