/**
 * The Groups screen's At a glance section: the stepper on its own card, the
 * period board by the chosen metric, and the position chart with the selected
 * period's table; a held read drawn as its own period, faded after a delay. The read, the metric, the period and the
 * offset are the screen's (groups-screens.test.tsx), so they arrive as props;
 * here a fixed six-week series pins every figure.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { GROUP_GLANCE_HOLD_FADE_DELAY_MS, GroupGlancePage } from '@/components/groups/group-glance-page';
import { GroupApiError } from '@/src/groups/api';
import {
  GROUP_HOME_BOARD_SIZE,
  GROUP_RANK_PERIODS,
  groupHomeSeriesWindows,
  type GroupHomeMemberTotals,
  type GroupHomeMetric,
  type GroupHomePeriod,
  type GroupHomeWindow,
} from '@/src/groups/home-periods';
import type { GroupGlanceHeld } from '@/src/groups/use-group-glance';

// Wed 14 Oct 2026, 18:30 local: the week is Mon 12 – Sun 18 Oct.
const NOW = new Date(2026, 9, 14, 18, 30);
const ME = 'me';

const member = (userId: string, name: string, sets: number, prs: number): GroupHomeMemberTotals => ({
  userId,
  name,
  isMe: userId === ME,
  sets,
  prs,
});

// Seven members, so one falls outside the top five. In the newest week I am
// sixth by sets but first by PRs; in the oldest week I lead on sets.
const NEWEST = [
  member('marco', 'Marco', 40, 1),
  member('luca', 'Luca', 35, 0),
  member('sara', 'Sara', 30, 2),
  member('enzo', 'Enzo', 25, 0),
  member('paolo', 'Paolo', 20, 0),
  member(ME, 'You', 10, 4),
  member('rocco', 'Rocco', 0, 0),
];
const OLDEST = NEWEST.map((row) => (row.userId === ME ? { ...row, sets: 99 } : row));

const seriesFor = (period: GroupHomePeriod, offset = 0): GroupHomeWindow[] =>
  groupHomeSeriesWindows({ period, offset, now: NOW }).map((window, index) => ({
    window,
    members: index === 0 ? OLDEST : NEWEST,
  }));

const renderPage = ({
  metric = 'sets',
  period = 'week',
  offset = 0,
  series = seriesFor(period, offset),
  held = null,
  onOffsetChange = jest.fn(),
  error = null,
  offline = false,
}: {
  metric?: GroupHomeMetric;
  period?: GroupHomePeriod;
  offset?: number;
  series?: GroupHomeWindow[] | null;
  held?: GroupGlanceHeld | null;
  onOffsetChange?: (next: number) => void;
  error?: GroupApiError | null;
  offline?: boolean;
} = {}) =>
  render(
    <GroupGlancePage
      error={error}
      held={held}
      metric={metric}
      myUserId={ME}
      now={NOW}
      offline={offline}
      offset={offset}
      onOffsetChange={onOffsetChange}
      onRetry={jest.fn()}
      period={period}
      series={series}
    />,
  );

const byId = (testID: string) => screen.getByTestId(testID);
const boardValues = (): string[] =>
  screen.getAllByTestId(/^group-home-board-row-.*-value$/).map((node) => String(node.props.children));

describe('At a glance: the board', () => {
  it('sets the period on a card of its own, above the board and the position cards', () => {
    renderPage();

    expect(within(byId('group-glance-period-card')).getByTestId('group-home-period-stepper')).toBeTruthy();
    expect(within(byId('group-home-board-card')).queryByTestId('group-home-period-stepper')).toBeNull();
    expect(within(byId('group-home-board-card')).getByTestId('group-home-board')).toBeTruthy();
    expect(within(byId('group-glance-figures')).getByTestId('group-position-card')).toBeTruthy();
    expect(within(byId('group-glance-figures')).getByText('Rankings')).toBeTruthy();
  });

  it('opens on this week by sets: the top five, and my place on its own line', () => {
    renderPage();

    expect(byId('group-home-period-title')).toHaveTextContent('This week');
    expect(byId('group-home-period-detail')).toHaveTextContent('12-10-2026 – 18-10-2026');
    expect(within(byId('group-home-board')).getByText('Sets')).toBeTruthy();
    expect(within(byId('group-home-board')).getByText(`Top ${GROUP_HOME_BOARD_SIZE}`)).toBeTruthy();
    expect(boardValues()).toEqual(['40', '35', '30', '25', '20']);
    expect(screen.queryByTestId(`group-home-board-row-${ME}`)).toBeNull();
    expect(byId('group-home-board-me-value')).toHaveTextContent('10');
  });

  it('ranks by PRs when the screen says so: I lead, with no closing line', () => {
    renderPage({ metric: 'prs' });

    expect(within(byId('group-home-board')).getByText('PRs')).toBeTruthy();
    expect(boardValues()).toEqual(['4', '2', '1', '0', '0']);
    expect(byId(`group-home-board-row-${ME}`)).toBeTruthy();
    expect(screen.queryByTestId('group-home-board-me')).toBeNull();
  });

  it('asks the screen for earlier periods and never past the current one', () => {
    const onOffsetChange = jest.fn();
    renderPage({ onOffsetChange });

    fireEvent.press(byId('group-home-period-earlier'));
    expect(onOffsetChange).toHaveBeenLastCalledWith(-1);
    expect(byId('group-home-period-later').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));

    screen.unmount();
    renderPage({ offset: -2, onOffsetChange });
    // A week the title already dates says its month underneath, not the dates twice.
    expect(byId('group-home-period-title')).toHaveTextContent('28-09-2026 – 04-10-2026');
    expect(byId('group-home-period-detail')).toHaveTextContent('September 2026');
    fireEvent.press(byId('group-home-period-later'));
    expect(onOffsetChange).toHaveBeenLastCalledWith(-1);
  });

});

describe('At a glance: before the read lands', () => {
  it('keeps the stepper and shows the loading state in place of the board and chart', () => {
    renderPage({ series: null });

    expect(byId('group-home-period-title')).toHaveTextContent('This week');
    expect(byId('group-glance-loading')).toBeTruthy();
    expect(screen.queryByTestId('group-home-board')).toBeNull();
    expect(screen.queryByTestId('group-rank-chart')).toBeNull();
  });

  it('says offline, or the failure with a retry, when there is nothing to show', () => {
    renderPage({ series: null, offline: true });
    expect(byId('group-glance-offline-empty-state')).toBeTruthy();

    screen.unmount();
    renderPage({ series: null, error: new GroupApiError('INTERNAL', 'Boom') });
    expect(byId('group-glance-error-state')).toBeTruthy();
    expect(byId('group-glance-error-state-retry')).toBeTruthy();
  });
});

describe('At a glance: a held read while the next one lands', () => {
  const opacity = () => StyleSheet.flatten(byId('group-glance-figures').props.style).opacity;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the figures in place under the new period, fading them only if the read is slow', () => {
    jest.useFakeTimers();
    // Stepped back to last week; this week's read is still on screen.
    renderPage({ offset: -1, series: seriesFor('week', 0), held: { period: 'week', offset: 0 } });

    expect(byId('group-home-period-title')).toHaveTextContent('Last week');
    expect(screen.queryByTestId('group-glance-loading')).toBeNull();
    expect(boardValues()).toEqual(['40', '35', '30', '25', '20']);
    // Drawn as the week it was read for: still "so far".
    expect(byId('group-position-selected')).toHaveTextContent('12-10-2026 – 18-10-2026 · so far');
    expect(byId('group-glance-figures').props.accessibilityState).toEqual({ busy: true });
    expect(opacity()).toBeUndefined();

    act(() => jest.advanceTimersByTime(GROUP_GLANCE_HOLD_FADE_DELAY_MS));
    expect(opacity()).toBe(0.5);

    // Last week lands: full strength at once, nothing busy.
    screen.rerender(
      <GroupGlancePage
        error={null}
        held={null}
        metric="sets"
        myUserId={ME}
        now={NOW}
        offline={false}
        offset={-1}
        onOffsetChange={jest.fn()}
        onRetry={jest.fn()}
        period="week"
        series={seriesFor('week', -1)}
      />,
    );
    expect(opacity()).toBeUndefined();
    expect(byId('group-glance-figures').props.accessibilityState).toEqual({ busy: false });
    expect(byId('group-position-selected')).toHaveTextContent('05-10-2026 – 11-10-2026');
  });

});

describe('At a glance: position over time', () => {
  it('charts every member over the last six periods and opens on the newest', () => {
    renderPage();

    expect(byId('group-rank-chart')).toBeTruthy();
    expect(screen.getAllByTestId(/^group-rank-chart-label-\d+$/)).toHaveLength(GROUP_RANK_PERIODS);
    expect(byId('group-position-selected')).toHaveTextContent('12-10-2026 – 18-10-2026 · so far');
  });

  it('reads the selected period into the table: place, sets and PRs for every member', () => {
    renderPage();
    const table = () => within(byId('group-rank-table'));

    expect(table().getByText('Sets')).toBeTruthy();
    expect(table().getByText('PRs')).toBeTruthy();
    expect(table().queryByText('Vol')).toBeNull();
    expect(table().getAllByTestId(/^group-rank-table-row-[a-z]+$/)).toHaveLength(NEWEST.length);
    expect(byId(`group-rank-table-row-${ME}`).props.accessibilityLabel).toBe('6, You, 10 working sets, 4 group records');

    // The oldest column: six weeks back, never "so far", and I led it.
    fireEvent.press(byId('group-rank-chart-label-0'));
    expect(byId('group-rank-chart-label-0').props.accessibilityState).toEqual({ selected: true });
    expect(byId('group-position-selected')).toHaveTextContent('07-09-2026 – 13-09-2026');
    expect(String(byId('group-position-selected').props.children)).not.toContain('so far');
    expect(byId(`group-rank-table-row-${ME}-sets`)).toHaveTextContent('99');
    expect(byId(`group-rank-table-row-${ME}`).props.accessibilityLabel).toMatch(/^1, You,/);
  });

  it('marks no column "so far" once the stepper has left the current period', () => {
    renderPage({ offset: -1 });
    expect(byId('group-position-selected')).toHaveTextContent('05-10-2026 – 11-10-2026');
    expect(String(byId('group-position-selected').props.children)).not.toContain('so far');
  });
});
