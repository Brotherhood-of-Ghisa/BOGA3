/**
 * The Groups stream, board and record surfaces on the shared text roles
 * (`docs/specs/ui/design-language.md` §3, "Text roles"): each line takes one
 * role, words never take the figure face, and a line mixing words and figures
 * draws only its figures in Plex Mono. The content each component shows is
 * covered by its own screen suite; this one pins the type.
 */
import { render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { GroupCertificationStatus } from '@/components/groups/certification-status';
import { GroupBoardHistoryItem } from '@/components/groups/group-board-history-item';
import { GroupBoardRow } from '@/components/groups/group-board-row';
import { GroupPodiumCard } from '@/components/groups/group-leaderboards-page';
import { GroupMetricStreamCard } from '@/components/groups/group-metric-stream-card';
import { GroupMetricStreamRecordSheet } from '@/components/groups/group-metric-stream-record-sheet';
import { GroupSessionRecordsCard } from '@/components/groups/group-session-records-card';
import { GroupStreamSessionCard } from '@/components/groups/stream-session-card';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { BoardRowViewModel, PodiumCardViewModel } from '@/src/groups/board-view-model';
import type { CompetitionSessionCard } from '@/src/groups/competition-stream-view-model';

import { competitionEvent } from './helpers/competition-fixtures';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/src/groups/use-network-online', () => ({ useNetworkOnline: () => true }));

const BODY = uiFonts.body.family;
const FIGURE = uiFonts.figure.family;

/** The nested Text drawing `part` inside `line`. */
const part = (line: ReactTestInstance, text: string) => within(line).getByText(text);

describe('board row', () => {
  const row: BoardRowViewModel = {
    key: 'sam', rank: 1, rankLabel: '1', memberLabel: 'Sam', isMe: false, former: false,
    valueLabel: '142.5', detailLabel: 'Weight 140.0 × 1', dateLabel: '12-10-2026', certification: null,
    accessibilityLabel: 'Sam',
  };

  it('draws the value as a row figure, 500 not 600', () => {
    render(<GroupBoardRow count={1} index={0} row={row} />);
    expect(screen.getByTestId('group-board-row-1-value')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '500', fontSize: uiTypography.size.base });
  });

  it('keeps the set line in words, with only its figures in Plex Mono', () => {
    render(<GroupBoardRow count={1} index={0} row={row} />);
    const detail = screen.getByTestId('group-board-row-1-detail');
    expect(detail).toHaveStyle({ fontFamily: BODY, fontSize: uiTypography.size.sm, color: uiRoles.inkMuted });
    expect(part(detail, '140.0')).toHaveStyle({ fontFamily: FIGURE });
    expect(detail).toHaveTextContent('Weight 140.0 × 1');
  });

  it('says an unavailable score in words, muted', () => {
    render(<GroupBoardRow count={1} index={0} row={{ ...row, valueLabel: 'Score unavailable' }} />);
    expect(screen.getByTestId('group-board-row-1-value')).toHaveStyle({ fontFamily: BODY, color: uiRoles.inkMuted });
  });
});

describe('podium card', () => {
  const card: PodiumCardViewModel = {
    exerciseId: 'bench', name: 'Bench Press', archived: false, viewLabel: 'All · 1RM (kg)',
    rows: [{ key: 'sam', rank: 1, memberLabel: 'Sam', isMe: false, valueLabel: '142.5', dateLabel: '12-10-2026' }],
    youLabel: 'You: 5th', emptyLabel: null, accessibilityLabel: 'Bench Press',
  };

  it('draws rank and value as row figures, 500 not 600', () => {
    render(<GroupPodiumCard card={card} onPress={jest.fn()} />);
    const podiumRow = screen.getByTestId('group-podium-card-bench-row-1');
    expect(part(podiumRow, '1')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '500' });
    expect(part(podiumRow, '142.5')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '500' });
  });

  it('reads my place in words, its figure in Plex Mono at the line weight', () => {
    render(<GroupPodiumCard card={card} onPress={jest.fn()} />);
    const you = screen.getByTestId('group-podium-card-bench-you');
    expect(you).toHaveStyle({ fontFamily: BODY, fontWeight: '600', fontSize: uiTypography.size.sm, color: uiRoles.ink });
    expect(part(you, '5')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '600' });
  });

  it('gives an empty podium its one quiet line', () => {
    render(<GroupPodiumCard card={{ ...card, rows: [], youLabel: null, emptyLabel: 'No sets yet' }} onPress={jest.fn()} />);
    expect(screen.getByTestId('group-podium-card-bench-empty')).toHaveStyle({ fontSize: uiTypography.size.sm, color: uiRoles.inkMuted });
  });
});

describe('stream session card', () => {
  const card: CompetitionSessionCard = {
    kind: 'session', key: 'k', groupId: 'g', memberUserId: 'u', sessionId: 's', memberName: 'Sam',
    isTrainingNow: false, statusLabel: 'Completed · 45m', startedAtLabel: '12-10-2026 13:03', gymName: null,
    groupNames: [], setsLabel: '3 sets', exercisesLabel: '2 exercises',
    records: [{ key: 'r', exercise: 'Bench Press', value: '1RM 120.0', certified: false, accessibilityLabel: 'Bench Press record' }],
  };

  it('keeps the counts line in words, with only the counts in Plex Mono', () => {
    render(<GroupStreamSessionCard card={card} onPress={jest.fn()} showGroupNames={false} />);
    const metrics = screen.getByTestId('group-stream-session-card-k-metrics');
    expect(metrics).toHaveStyle({ fontFamily: BODY, fontSize: uiTypography.size.sm, color: uiRoles.ink });
    expect(part(metrics, '3')).toHaveStyle({ fontFamily: FIGURE });
    expect(metrics).toHaveTextContent('3 sets · 2 exercises');
  });

  it('names a record in the body face and keeps its metric word out of Plex Mono', () => {
    render(<GroupStreamSessionCard card={card} onPress={jest.fn()} showGroupNames={false} />);
    const line = screen.getByTestId('group-stream-session-card-k-record-r');
    expect(part(line, 'Bench Press')).toHaveStyle({ fontFamily: BODY, fontWeight: '600', color: uiRoles.ink });
    expect(screen.getByTestId('group-stream-session-card-k-record-r-value')).toHaveStyle({ fontFamily: BODY, color: uiRoles.record });
    expect(part(line, '120.0')).toHaveStyle({ fontFamily: FIGURE });
  });
});

describe('metric stream card', () => {
  it('heads a record with a record micro-label and names the exercise in the body face', () => {
    render(<GroupMetricStreamCard item={competitionEvent} showGroupName={false} userId="me" />);
    expect(screen.getByTestId('group-metric-stream-event1-label')).toHaveStyle({
      fontSize: uiTypography.size.xxs, textTransform: 'uppercase', color: uiRoles.record,
    });
    expect(screen.getByTestId('group-metric-stream-event1-context')).toHaveStyle({ fontFamily: BODY, fontWeight: '600' });
  });

  it('keeps the set and the values in words, with only their figures in Plex Mono', () => {
    render(<GroupMetricStreamCard item={competitionEvent} showGroupName={false} userId="me" />);
    const set = screen.getByTestId('group-metric-stream-event1-set');
    expect(set).toHaveStyle({ fontFamily: BODY });
    expect(part(set, '5')).toHaveStyle({ fontFamily: FIGURE });
    const detail = screen.getByTestId('group-metric-stream-event1-detail-0');
    expect(detail).toHaveStyle({ fontFamily: BODY });
    expect(part(detail, '145.7')).toHaveStyle({ fontFamily: FIGURE });
  });

  it('mutes an unavailable score', () => {
    render(<GroupMetricStreamCard item={{ ...competitionEvent, values: [{ ...competitionEvent.values[0], value: null, unavailable: true }] }}
      showGroupName={false} userId="me" />);
    expect(screen.getByTestId('group-metric-stream-event1-detail-0')).toHaveStyle({ fontFamily: BODY, color: uiRoles.inkMuted });
  });
});

describe('stream record sheet', () => {
  it('names each metric in the strong body face and keeps the set in words', () => {
    render(<GroupMetricStreamRecordSheet myRole="member" onChanged={jest.fn(async () => {})} onClose={jest.fn()}
      record={{ ...competitionEvent, record_context: null }} userId="me" />);
    expect(within(screen.getByTestId('group-metric-record-e1rm')).getByText('1RM')).toHaveStyle({ fontFamily: BODY, fontWeight: '600' });
    const set = screen.getByTestId('group-metric-record-set');
    expect(set).toHaveStyle({ fontFamily: BODY, fontWeight: '400' });
    expect(part(set, '5')).toHaveStyle({ fontFamily: FIGURE });
  });
});

describe('board history item', () => {
  it('dates a lead change in quiet figures at the small size', () => {
    render(<GroupBoardHistoryItem count={1} index={0} item={{ key: 'h', dateLabel: '12-10-2026', sentence: 'Sam took the lead' }} testID="h" />);
    expect(screen.getByTestId('h-date')).toHaveStyle({ fontFamily: FIGURE, fontSize: uiTypography.size.sm });
  });
});

describe('session records card', () => {
  it('titles a record in the strong body face and draws its detail figures in Plex Mono', () => {
    render(<GroupSessionRecordsCard groupId="g" myRole="member" onChanged={jest.fn(async () => {})} online
      rows={[{ key: 'r', setId: 's', title: 'Bench Press · 1RM', value: '120.0', detail: 'Group record · 1st',
        boardHref: '/b', certification: null }]} userId="me" />);
    const row = screen.getByTestId('group-session-record-r');
    expect(part(row, 'Bench Press · 1RM')).toHaveStyle({ fontFamily: BODY, fontWeight: '600', fontSize: uiTypography.size.base });
    expect(screen.getByTestId('group-session-record-r-value')).toHaveStyle({ fontFamily: FIGURE, color: uiRoles.record });
    expect(part(screen.getByTestId('group-session-record-r-detail'), '1')).toHaveStyle({ fontFamily: FIGURE });
  });
});

describe('certification status', () => {
  it('draws the date in a status line in Plex Mono, at the line weight', () => {
    render(<GroupCertificationStatus label="Certified by sam · 12-10-2026" status="certified" testID="c" />);
    const status = screen.getByTestId('c');
    expect(part(status, '12-10-2026'.split('-')[0])).toHaveStyle({ fontFamily: FIGURE, fontWeight: '600' });
  });
});
