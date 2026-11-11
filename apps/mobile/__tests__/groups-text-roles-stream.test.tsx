/**
 * The Groups stream, board and record surfaces on the shared text roles
 * (`docs/specs/ui/design-language.md` §3, "Text roles"): each line takes one
 * role, words never take the figure face, and a line mixing words and figures
 * draws only its figures in Plex Mono. The content each component shows is
 * covered by its own screen suite; this one pins the type.
 */
import { screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { GroupCertificationStatus } from '@/components/groups/certification-status';
import { GroupBoardHistoryItem } from '@/components/groups/group-board-history-item';
import { GroupBoardRow } from '@/components/groups/group-board-row';
import { GroupPodiumCard } from '@/components/groups/group-leaderboards-page';
import { GroupMetricStreamCard } from '@/components/groups/group-metric-stream-card';
import { GroupMetricStreamRecordSheet } from '@/components/groups/group-metric-stream-record-sheet';
import { GroupSessionRecordsCard } from '@/components/groups/group-session-records-card';
import { GroupStreamSessionCard } from '@/components/groups/stream-session-card';
import { uiFonts, uiTypography } from '@/components/ui/tokens';
import type { BoardRowViewModel, PodiumCardViewModel } from '@/src/groups/board-view-model';
import type { CompetitionSessionCard } from '@/src/groups/competition-stream-view-model';

import { competitionEvent } from './helpers/competition-fixtures';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const themeRoles = rolesFor(DEFAULT_APPEARANCE);

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
    renderWithTheme(<GroupBoardRow count={1} index={0} row={row} />);
    expect(screen.getByTestId('group-board-row-1-value')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '500', fontSize: uiTypography.size.base });
  });

  it('keeps the set line in words, with only its figures in Plex Mono', () => {
    renderWithTheme(<GroupBoardRow count={1} index={0} row={row} />);
    const detail = screen.getByTestId('group-board-row-1-detail');
    expect(detail).toHaveStyle({ fontFamily: BODY, fontSize: uiTypography.size.sm, color: themeRoles.inkMuted });
    expect(part(detail, '140.0')).toHaveStyle({ fontFamily: FIGURE });
    expect(detail).toHaveTextContent('Weight 140.0 × 1');
  });

  it('says an unavailable score in words, muted', () => {
    renderWithTheme(<GroupBoardRow count={1} index={0} row={{ ...row, valueLabel: 'Score unavailable' }} />);
    expect(screen.getByTestId('group-board-row-1-value')).toHaveStyle({ fontFamily: BODY, color: themeRoles.inkMuted });
  });
});

describe('podium card', () => {
  const card: PodiumCardViewModel = {
    exerciseId: 'bench', name: 'Bench Press', archived: false, viewLabel: 'All · 1RM (kg)',
    rows: [{ key: 'sam', rank: 1, memberLabel: 'Sam', isMe: false, valueLabel: '142.5', dateLabel: '12-10-2026' }],
    youLabel: 'You: 5th', emptyLabel: null,
    latestRecordAtMs: null, accessibilityLabel: 'Bench Press',
  };

  it('draws rank and value as row figures, 500 not 600', () => {
    renderWithTheme(<GroupPodiumCard card={card} onPress={jest.fn()} />);
    const podiumRow = screen.getByTestId('group-podium-card-bench-row-1');
    expect(part(podiumRow, '1')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '500' });
    expect(part(podiumRow, '142.5')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '500' });
  });

  it('reads my place in words, its figure in Plex Mono at the line weight', () => {
    renderWithTheme(<GroupPodiumCard card={card} onPress={jest.fn()} />);
    const you = screen.getByTestId('group-podium-card-bench-you');
    expect(you).toHaveStyle({ fontFamily: BODY, fontWeight: '600', fontSize: uiTypography.size.sm, color: themeRoles.ink });
    expect(part(you, '5')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '600' });
  });

  it('gives an empty podium its one quiet line', () => {
    renderWithTheme(<GroupPodiumCard card={{ ...card, rows: [], youLabel: null, emptyLabel: 'No sets yet' }} onPress={jest.fn()} />);
    expect(screen.getByTestId('group-podium-card-bench-empty')).toHaveStyle({ fontSize: uiTypography.size.sm, color: themeRoles.inkMuted });
  });
});

describe('stream session card', () => {
  const card: CompetitionSessionCard = {
    kind: 'session', key: 'k', groupId: 'g', memberUserId: 'u', sessionId: 's', memberName: 'Sam',
    isTrainingNow: false, statusLabel: 'Completed · 45m', startedAtLabel: '12-10-2026 13:03', gymName: null,
    groupNames: [], setsLabel: '3 sets', exercisesLabel: '2 exercises', groupRecordCount: 0, personalRecordCount: 0,
    records: [{ key: 'r', exercise: 'Bench Press', value: '1RM 120.0', certified: false, accessibilityLabel: 'Bench Press record' }],
  };

  it('keeps the counts line in words, with only the counts in Plex Mono', () => {
    renderWithTheme(<GroupStreamSessionCard card={card} onPress={jest.fn()} showGroupNames={false} />);
    const metrics = screen.getByTestId('group-stream-session-card-k-metrics');
    expect(metrics).toHaveStyle({ fontFamily: BODY, fontSize: uiTypography.size.sm, color: themeRoles.ink });
    expect(part(metrics, '3')).toHaveStyle({ fontFamily: FIGURE });
    expect(metrics).toHaveTextContent('3 sets · 2 exercises');
  });

  it('counts PRs in the counts line and the GR count after it in the record colour', () => {
    renderWithTheme(<GroupStreamSessionCard card={{ ...card, groupRecordCount: 2, personalRecordCount: 1 }} onPress={jest.fn()} showGroupNames={false} />);
    const metrics = screen.getByTestId('group-stream-session-card-k-metrics');
    expect(metrics).toHaveTextContent('3 sets · 2 exercises · 1 PR · 2 GR');
    const groupRecords = screen.getByTestId('group-stream-session-card-k-group-records');
    expect(groupRecords).toHaveStyle({ color: themeRoles.record, fontWeight: '600' });
    expect(part(groupRecords, '2')).toHaveStyle({ fontFamily: FIGURE, color: themeRoles.record });
    expect(screen.getByTestId('group-stream-session-card-k').props.accessibilityLabel).toContain('1 PR, 2 group records');
  });

  it('names a record in the body face and keeps its metric word out of Plex Mono', () => {
    renderWithTheme(<GroupStreamSessionCard card={card} onPress={jest.fn()} showGroupNames={false} />);
    const line = screen.getByTestId('group-stream-session-card-k-record-r');
    expect(part(line, 'Bench Press')).toHaveStyle({ fontFamily: BODY, fontWeight: '600', color: themeRoles.ink });
    expect(screen.getByTestId('group-stream-session-card-k-record-r-value')).toHaveStyle({ fontFamily: BODY, color: themeRoles.record });
    // The figure is as heavy as the record line's words, and `1RM` stays a word.
    expect(part(line, '120.0')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '700', color: themeRoles.record });
    expect(within(screen.getByTestId('group-stream-session-card-k-record-r-value')).queryByText('1')).toBeNull();
  });
});

describe('metric stream card', () => {
  it('heads a record with a record micro-label and names the exercise in the body face', () => {
    renderWithTheme(<GroupMetricStreamCard item={competitionEvent} showGroupName={false} userId="me" />);
    expect(screen.getByTestId('group-metric-stream-event1-label')).toHaveStyle({
      fontSize: uiTypography.size.xxs, textTransform: 'uppercase', color: themeRoles.record,
    });
    expect(screen.getByTestId('group-metric-stream-event1-context')).toHaveStyle({ fontFamily: BODY, fontWeight: '600' });
  });

  it('keeps the set and the values in words, with only their figures in Plex Mono', () => {
    renderWithTheme(<GroupMetricStreamCard item={competitionEvent} showGroupName={false} userId="me" />);
    const set = screen.getByTestId('group-metric-stream-event1-set');
    expect(set).toHaveStyle({ fontFamily: BODY });
    expect(part(set, '5')).toHaveStyle({ fontFamily: FIGURE });
    const detail = screen.getByTestId('group-metric-stream-event1-detail-0');
    expect(detail).toHaveStyle({ fontFamily: BODY });
    expect(part(detail, '45.7')).toHaveStyle({ fontFamily: FIGURE });
  });

  it('mutes an unavailable score', () => {
    renderWithTheme(<GroupMetricStreamCard item={{ ...competitionEvent, values: [{ ...competitionEvent.values[0], value: null, unavailable: true }] }}
      showGroupName={false} userId="me" />);
    expect(screen.getByTestId('group-metric-stream-event1-detail-0')).toHaveStyle({ fontFamily: BODY, color: themeRoles.inkMuted });
  });
});

describe('stream record sheet', () => {
  it('names each metric in the strong body face and keeps the set in words', () => {
    renderWithTheme(<GroupMetricStreamRecordSheet myRole="member" onChanged={jest.fn(async () => {})} onClose={jest.fn()}
      record={{ ...competitionEvent, record_context: null }} userId="me" />);
    expect(within(screen.getByTestId('group-metric-record-e1rm')).getByText('1RM')).toHaveStyle({ fontFamily: BODY, fontWeight: '600' });
    const set = screen.getByTestId('group-metric-record-set');
    expect(set).toHaveStyle({ fontFamily: BODY, fontWeight: '400' });
    expect(part(set, '5')).toHaveStyle({ fontFamily: FIGURE });
  });
});

describe('board history item', () => {
  it('dates a lead change in quiet figures at the small size', () => {
    renderWithTheme(<GroupBoardHistoryItem count={1} index={0} item={{ key: 'h', dateLabel: '12-10-2026', sentence: 'Sam took the lead' }} testID="h" />);
    expect(screen.getByTestId('h-date')).toHaveStyle({ fontFamily: FIGURE, fontSize: uiTypography.size.sm });
  });
});

describe('session records card', () => {
  it('titles a record in the strong body face and draws its detail figures in Plex Mono', () => {
    renderWithTheme(<GroupSessionRecordsCard groupId="g" myRole="member" onChanged={jest.fn(async () => {})} online
      rows={[{ key: 'r', setId: 's', title: 'Bench Press · 1RM', value: '120.0', detail: 'Group record · 1st',
        boardHref: '/b', certification: null }]} userId="me" />);
    const row = screen.getByTestId('group-session-record-r');
    expect(part(row, 'Bench Press · 1RM')).toHaveStyle({ fontFamily: BODY, fontWeight: '600', fontSize: uiTypography.size.base });
    expect(screen.getByTestId('group-session-record-r-value')).toHaveStyle({ fontFamily: FIGURE, color: themeRoles.record });
    expect(part(screen.getByTestId('group-session-record-r-detail'), '1')).toHaveStyle({ fontFamily: FIGURE });
  });
});

describe('certification status', () => {
  it('draws the date in a status line in Plex Mono, at the line weight', () => {
    renderWithTheme(<GroupCertificationStatus label="Certified by sam · 12-10-2026" status="certified" testID="c" />);
    const status = screen.getByTestId('c');
    expect(part(status, '12-10-2026')).toHaveStyle({ fontFamily: FIGURE, fontWeight: '600' });
  });
});
