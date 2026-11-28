import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, ListCard, ListCardHeader, ListRow, useUiText, useUiTextTone } from '@/components/ui';
import { buildMeetRecordRows, buildMeetSessionRows } from '@/src/groups/meet-results-view-model';
import type { MeetResultsWire } from '@/src/groups/meet-results-wire';
import { groupSessionHref } from '@/src/navigation/routes';
import { useDateFormat } from '@/src/preferences/hooks';

/** The sessions that counted (each opens the member's session) and the group records set at the meet. */
export function MeetResultsExtras({ results, userId }: { results: MeetResultsWire; userId: string }) {
  const router = useRouter(); const text = useUiText(); const tone = useUiTextTone(); const format = useDateFormat();
  if (results.results.state === 'cancelled') return null;
  const sessions = buildMeetSessionRows(results, format, userId);
  const records = buildMeetRecordRows(results, userId);
  return <>
    <ListCard testID="meet-sessions" header={<ListCardHeader label="Sessions" />}>
      {sessions.length ? sessions.map(row => <ListRow key={row.key} density="compact" label={row.label} accessibilityLabel={row.accessibilityLabel}
        testID={`meet-session-${row.sessionId}`} onPress={() => router.push(groupSessionHref(row.memberUserId, row.sessionId, results.meet.group_id))} />)
        : <ListRow density="compact" label="No sessions yet" testID="meet-sessions-empty" />}
    </ListCard>
    <Card testID="meet-records">
      <Text allowFontScaling={false} style={text.label}>Records set at this meet</Text>
      {records.length ? records.map(row => <Text allowFontScaling={false} key={row.key} style={text.body} testID={`meet-record-${row.key}`}>
        {row.title}{'\n'}<Text allowFontScaling={false} style={[text.meta, tone.muted]}>{row.figures}</Text></Text>)
        : <Text allowFontScaling={false} style={[text.body, tone.muted]} testID="meet-records-empty">No records yet</Text>}
    </Card>
  </>;
}
