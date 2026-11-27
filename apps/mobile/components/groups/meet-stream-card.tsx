import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { CompactCard, CompactHeader, useUiText } from '@/components/ui';
import { MEET_METRICS, MEET_STREAM_LABELS, meetHref, meetTitle } from '@/src/groups/meet-presentation';
import type { MeetStreamItemWire } from '@/src/groups/meet-wire';
import { formatCompactDateTime, formatLocalDateTime } from '@/src/utils/local-time';
import { useDateFormat } from '@/src/preferences/hooks';

/** Definition snapshot only; every lifecycle kind opens the exact meet. */
export function MeetStreamCard({ item, groupId }: { item: MeetStreamItemWire; groupId: string }) {
  const router = useRouter(); const text = useUiText(); const format = useDateFormat();
  const title = meetTitle(item.meet); const label = MEET_STREAM_LABELS[item.event];
  const date = formatCompactDateTime(item.sort_at_ms, format);
  return <CompactCard onPress={() => router.push(meetHref(groupId, item.meet.meet_id))} accessibilityLabel={`${label}, ${title}, ${item.meet.venue_name}, ${formatLocalDateTime(item.sort_at_ms, format)}`} testID={`meet-stream-${item.key}`}>
    <CompactHeader label={label} metadata={date} metadataAccessibilityLabel={formatLocalDateTime(item.sort_at_ms, format)} />
    <Text allowFontScaling={false} style={text.bodyStrong}>{title}</Text>
    <Text allowFontScaling={false} style={text.body}>{item.meet.venue_name}</Text>
    {item.challenge ? <Text allowFontScaling={false} style={text.body}>{`${item.challenge.exercise_name} · ${MEET_METRICS[item.challenge.metric]}`}</Text> : null}
  </CompactCard>;
}
