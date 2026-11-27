import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { CompactCard, CompactHeader, Icon, uiSpace, useUiText } from '@/components/ui';
import { meetCaption, meetDate, meetHref, meetTitle } from '@/src/groups/meet-presentation';
import type { MeetWire } from '@/src/groups/meet-wire';
import { useMeetClock } from '@/src/groups/use-meets';
import { useDateFormat } from '@/src/preferences/hooks';

/** Custom CompactCard composition: one destination, title and chronological meet metadata. */
export function MeetSummaryCard({ meet }: { meet: MeetWire }) {
  const router = useRouter(); const text = useUiText(); const format = useDateFormat(); const now = useMeetClock();
  const date = meetDate(meet.starts_at_ms, meet.time_zone, format);
  const spokenDate = meetDate(meet.starts_at_ms, meet.time_zone, format, true);
  const spokenCaption = meetCaption(meet, format, now, true);
  const caption = meetCaption(meet, format, now);
  return <CompactCard testID={`meet-summary-${meet.meet_id}`} onPress={() => router.push(meetHref(meet.group_id, meet.meet_id))}
    accessibilityLabel={`${meetTitle(meet)}, ${spokenDate}, ${meet.time_zone ?? 'UTC'}, ${meet.venue_name}, ${spokenCaption}`}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm }}>
      <View style={{ flex: 1, gap: uiSpace.xs }}>
        <CompactHeader label={caption} metadata={`${date} · ${meet.time_zone ?? 'UTC'}`} metadataAccessibilityLabel={`${spokenDate} · ${meet.time_zone ?? 'UTC'}`} />
        <Text allowFontScaling={false} style={text.bodyStrong}>{meetTitle(meet)}</Text>
        <Text allowFontScaling={false} style={text.body}>{meet.venue_name}</Text>
      </View><Icon name="chevron-right" colorRole="inkMuted" size="sm" />
    </View>
  </CompactCard>;
}
