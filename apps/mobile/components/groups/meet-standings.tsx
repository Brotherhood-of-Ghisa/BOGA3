import { Text, View } from 'react-native';
import { uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import { buildMeetStandingRows, splitMeetStandings } from '@/src/groups/meet-results-view-model';
import type { MeetResultsWire } from '@/src/groups/meet-results-wire';
import type { MeetChallengeWire } from '@/src/groups/meet-wire';
import { useDateFormat } from '@/src/preferences/hooks';
import { GroupBoardRow } from './group-board-row';

/**
 * One challenge's standings from the server's places: the podium (places 1–3,
 * ties kept together) over the rest of the standings, in the board row. Rows
 * show the ✓ of a certified set; a hidden figure reads "Unavailable" with its
 * place kept.
 */
export function MeetStandings({ results, challenge, userId }: { results: MeetResultsWire; challenge: MeetChallengeWire; userId: string }) {
  const text = useUiText(); const tone = useUiTextTone(); const format = useDateFormat();
  const standings = results.challenges.find(entry => entry.challenge.challenge_id === challenge.challenge_id)?.standings ?? [];
  const testID = `meet-standings-${challenge.challenge_id}`;
  if (!standings.length) return <Text allowFontScaling={false} style={[text.meta, tone.muted]} testID={`${testID}-empty`}>{emptyLabel(results)}</Text>;
  const { podium, rest } = splitMeetStandings(buildMeetStandingRows(results, standings, challenge.metric, userId, format));
  return <View style={{ gap: uiSpace.sm }} testID={testID}>
    <Text allowFontScaling={false} style={[text.label, tone.muted]}>Podium</Text>
    <View testID={`${testID}-podium`}>{podium.map((row, index) => <GroupBoardRow key={row.key} row={row} index={index} count={podium.length} />)}</View>
    {rest.length ? <>
      <Text allowFontScaling={false} style={[text.label, tone.muted]}>Full standings</Text>
      <View testID={`${testID}-rest`}>{rest.map((row, index) => <GroupBoardRow key={row.key} row={row} index={index} count={rest.length} />)}</View>
    </> : null}
  </View>;
}

const emptyLabel = (results: MeetResultsWire) => results.results.state === 'scheduled' ? 'Standings appear once the meet starts'
  : results.results.state === 'cancelled' ? 'This meet was cancelled' : 'No qualifying sets yet';
