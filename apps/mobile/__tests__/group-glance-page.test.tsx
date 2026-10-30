/**
 * The Groups screen's At a glance page: the stepper and the metric pinned on
 * one row, then three cards headed inside — `Group stats` (the week's total),
 * `Top brothers` (the period board by the chosen metric) and `Rankings over
 * time` (the position chart, the selected week fourth where it can be); a held read drawn as its own period, faded after a delay. The read, the metric, the period and the
 * offset are the screen's (groups-screens.test.tsx), so they arrive as props;
 * here a fixed six-week series pins every figure.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Circle, Svg } from 'react-native-svg';

import { GROUP_GLANCE_HOLD_FADE_DELAY_MS, GroupGlancePage } from '@/components/groups/group-glance-page';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import { GroupApiError } from '@/src/groups/api';
import {
  GROUP_HOME_BOARD_SIZE,
  GROUP_RANK_PERIODS,
  groupHomeSeriesWindows,
  groupRankSeriesEnd,
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
  series = seriesFor(period, groupRankSeriesEnd(offset)),
  held = null,
  onOffsetChange = jest.fn(),
  onMetricChange = jest.fn(),
  error = null,
  offline = false,
}: {
  metric?: GroupHomeMetric;
  period?: GroupHomePeriod;
  offset?: number;
  series?: GroupHomeWindow[] | null;
  held?: GroupGlanceHeld | null;
  onOffsetChange?: (next: number) => void;
  onMetricChange?: (next: GroupHomeMetric) => void;
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
      onMetricChange={onMetricChange}
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
  it('pins the period and the metric on one row above the scrolling cards, each card headed inside', () => {
    const onMetricChange = jest.fn();
    renderPage({ onMetricChange });

    const controls = within(byId('group-glance-controls'));
    expect(controls.getByTestId('group-home-period-stepper')).toBeTruthy();
    expect(controls.getByTestId('groups-filter-metric')).toHaveTextContent('Sets');
    // The controls sit outside the scroller, so they never scroll away.
    expect(within(byId('groups-glance-scroll')).queryByTestId('group-glance-controls')).toBeNull();
    expect(within(byId('group-week-totals-card')).getByTestId('group-week-totals-title')).toHaveTextContent('Group stats');
    expect(within(byId('group-home-board-card')).getByText('Top brothers')).toBeTruthy();
    expect(within(byId('group-position-card')).getByTestId('group-position-title')).toHaveTextContent('Rankings over time');
    // The board is the ranking: the chart card repeats no table.
    expect(screen.queryByTestId('group-rank-table')).toBeNull();

    fireEvent.press(byId('groups-filter-metric'));
    expect(onMetricChange).toHaveBeenCalledWith('prs');
  });
  it('opens on this week by sets: the top five, and my place on its own line', () => {
    renderPage();

    expect(byId('group-home-period-title')).toHaveTextContent('This week');
    expect(within(byId('group-home-board')).getByText('Sets')).toBeTruthy();
    expect(screen.getAllByTestId(/^group-home-board-row-[a-z]+$/)).toHaveLength(GROUP_HOME_BOARD_SIZE);
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
    // A week with no name is named by its dates.
    expect(byId('group-home-period-title')).toHaveTextContent('28-09-2026 – 04-10-2026');
    fireEvent.press(byId('group-home-period-later'));
    expect(onOffsetChange).toHaveBeenLastCalledWith(-1);
  });

});

describe('At a glance: before the read lands', () => {
  it('keeps the stepper and shows the loading state in place of the cards', () => {
    renderPage({ series: null });

    expect(byId('group-home-period-title')).toHaveTextContent('This week');
    expect(screen.queryByTestId('group-week-totals-card')).toBeNull();
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
    // Stepped back three weeks, which moves the chart one week back; its read is still on the way.
    renderPage({ offset: -3, series: seriesFor('week', 0), held: { period: 'week', offset: 0 } });

    expect(byId('group-home-period-title')).toHaveTextContent('21-09-2026 – 27-09-2026');
    expect(screen.queryByTestId('group-glance-loading')).toBeNull();
    expect(boardValues()).toEqual(['40', '35', '30', '25', '20']);
    // Drawn as the week it was read for: its newest column is still this week.
    expect(byId(`group-rank-chart-label-${GROUP_RANK_PERIODS - 1}`)).toHaveTextContent('12 Oct');
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
        offset={-3}
        onMetricChange={jest.fn()}
        onOffsetChange={jest.fn()}
        onRetry={jest.fn()}
        period="week"
        series={seriesFor('week', -1)}
      />,
    );
    expect(opacity()).toBeUndefined();
    expect(byId('group-glance-figures').props.accessibilityState).toEqual({ busy: false });
    expect(byId(`group-rank-chart-label-${GROUP_RANK_PERIODS - 1}`)).toHaveTextContent('5 Oct');
  });

});

describe('At a glance: a held read that does not reach the selection', () => {
  it('shows its nearest week with one before it, and words the comparison for that week', () => {
    // Ten weeks back; the read in hand ends at this week.
    renderPage({ offset: -10, series: seriesFor('week', 0), held: { period: 'week', offset: 0 } });
    expect(byId('group-rank-chart-label-1').props.accessibilityState).toEqual({ selected: true });
    // Against the oldest week (249 sets, my 99 among them): never against nothing.
    expect(byId('group-week-totals-sets-previous')).toHaveTextContent('vs 249 wk before');
  });
});

describe('At a glance: position over time', () => {
  it('charts every member over the last six periods and opens on the newest', () => {
    renderPage();

    expect(byId('group-rank-chart')).toBeTruthy();
    expect(screen.getAllByTestId(/^group-rank-chart-label-\d+$/)).toHaveLength(GROUP_RANK_PERIODS);
    expect(byId(`group-rank-chart-label-${GROUP_RANK_PERIODS - 1}`).props.accessibilityState).toEqual({ selected: true });
    // The selection shows on the chart alone: no date line above the table.
    expect(screen.queryByTestId('group-position-selected')).toBeNull();
  });

  it('names each column by its Monday, without the year', () => {
    renderPage();
    const labels = screen.getAllByTestId(/^group-rank-chart-label-\d+$/).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(['7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct']);
  });

  it('centres each column\'s points in its band, 30pt a place', () => {
    renderPage();
    // Jest runs no layout pass: the plot keeps its 300pt fallback width, 50pt a column.
    const xs = [...new Set(screen.UNSAFE_getAllByType(Circle).map((circle) => Number(circle.props.cx)))].sort((a, b) => a - b);
    expect(xs).toEqual([25, 75, 125, 175, 225, 275]);
    expect(within(byId('group-rank-chart-plot')).UNSAFE_getByType(Svg).props.height).toBe(NEWEST.length * 30);
  });

  it('keeps the selected week fourth, except near the current week, and selects a week by its column', () => {
    const onOffsetChange = jest.fn();
    const selectedColumn = () =>
      screen.getAllByTestId(/^group-rank-chart-label-\d+$/).findIndex((node) => node.props.accessibilityState?.selected);

    renderPage({ offset: -4, onOffsetChange });
    expect(selectedColumn()).toBe(3);
    // The newest column is two weeks after the selection.
    expect(byId(`group-rank-chart-label-${GROUP_RANK_PERIODS - 1}`)).toHaveTextContent('28 Sep');

    // The oldest column: three weeks earlier; every card follows the screen's selection.
    fireEvent.press(byId('group-rank-chart-label-0'));
    expect(onOffsetChange).toHaveBeenLastCalledWith(-7);

    screen.unmount();
    renderPage({ offset: -1, onOffsetChange });
    // Only one later week exists: the chart ends at the current one.
    expect(selectedColumn()).toBe(4);
    fireEvent.press(byId(`group-rank-chart-label-${GROUP_RANK_PERIODS - 1}`));
    expect(onOffsetChange).toHaveBeenLastCalledWith(0);
  });

  it('reads the selected week into the board and the totals', () => {
    // The oldest column is the selection: six weeks back, and I led it.
    renderPage({ offset: -5, series: seriesFor('week', groupRankSeriesEnd(-5)).map((read, index) => (index === 0 ? read : { ...read, members: index === 3 ? OLDEST : NEWEST })) });
    expect(byId(`group-home-board-row-${ME}-value`)).toHaveTextContent('99');
    expect(byId(`group-home-board-row-${ME}-rank`)).toHaveTextContent('1');
  });
});

describe('At a glance: the group total', () => {
  // The week before the newest: fewer sets, more records.
  const withPreviousWeek = (series: GroupHomeWindow[]): GroupHomeWindow[] =>
    series.map((read, index) =>
      index === series.length - 2 ? { ...read, members: [member('marco', 'Marco', 50, 3), member(ME, 'You', 30, 6)] } : read,
    );

  it('sums every member\'s sets and PRs for the week, against last week, above the board', () => {
    renderPage({ series: withPreviousWeek(seriesFor('week')) });
    const totals = within(byId('group-week-totals-card'));

    expect(within(byId('group-glance-figures')).getAllByTestId(/-card$/).map((node) => node.props.testID)).toEqual([
      'group-week-totals-card',
      'group-home-board-card',
      'group-position-card',
    ]);
    expect(totals.getByTestId('group-week-totals-title')).toHaveTextContent('Group stats');
    expect(byId('group-week-totals-sets-value')).toHaveTextContent('160');
    expect(byId('group-week-totals-sets-previous')).toHaveTextContent('vs 80 last wk');
    expect(byId('group-week-totals-prs-value')).toHaveTextContent('7');
    expect(byId('group-week-totals-prs-previous')).toHaveTextContent('vs 9 last wk');
    expect(byId('group-week-totals-sets').props.accessibilityLabel).toBe('Sets 160, vs 80 last week');
  });

  it('follows the stepper: an earlier week compares with the week before it', () => {
    // The chart ends at the current week; the selection is its fourth column.
    const series = seriesFor('week', 0).map((read, index) =>
      index === 2 ? { ...read, members: [member('marco', 'Marco', 50, 3), member(ME, 'You', 30, 6)] } : read,
    );
    renderPage({ offset: -2, series });

    expect(byId('group-week-totals-sets-previous')).toHaveTextContent('vs 80 wk before');
    expect(byId('group-week-totals-prs').props.accessibilityLabel).toBe('PRs 7, vs 9 the week before');
  });
});

// The shared text roles (`design-language.md` §3, "Text roles"): names in the
// body face, my own one step heavier; figures in Plex Mono; words never in it.
describe('At a glance: text roles', () => {
  const body = { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
  const figureSmall = { fontFamily: uiFonts.figure.family, fontWeight: '500' as const, fontSize: uiTypography.size.sm };

  it('heads the cards with micro-labels, and names the week in the stepper', () => {
    renderPage();

    const label = { textTransform: 'uppercase' as const, color: uiRoles.ink };
    expect(byId('group-week-totals-title')).toHaveStyle(label);
    expect(byId('group-position-title')).toHaveStyle(label);
    expect(within(byId('group-home-board-card')).getByText('Top brothers')).toHaveStyle(label);
    expect(byId('group-home-period-title')).toHaveStyle(label);
  });
  it('draws board names as body and figures as small ink figures', () => {
    renderPage({ metric: 'prs' });

    expect(byId('group-home-board-row-marco-name')).toHaveStyle({ ...body, fontWeight: '400' });
    expect(byId(`group-home-board-row-${ME}-name`)).toHaveStyle({ ...body, fontWeight: '600' });
    expect(byId('group-home-board-row-marco-rank')).toHaveStyle({ ...figureSmall, color: uiRoles.inkMuted });
    expect(byId('group-home-board-row-luca-value')).toHaveStyle({ ...figureSmall, color: uiRoles.ink });
    // A PR count above zero is a record: the record colour, drawn heavy.
    expect(byId(`group-home-board-row-${ME}-value`)).toHaveStyle({ fontFamily: uiFonts.figure.family, fontWeight: '700', color: uiRoles.record });
  });

  it('keeps my closing line in words, with only my place in the figure face', () => {
    renderPage();

    const line = byId('group-home-board-me-label');
    expect(line).toHaveStyle(body);
    expect(within(line).getByText('You')).toHaveStyle({ fontWeight: '600' });
    // `6th`: the digit in Plex Mono, the suffix stays in the line's body face.
    expect(within(line).getByText('6')).toHaveStyle({ fontFamily: uiFonts.figure.family });
    expect(line).toHaveTextContent('You · 6th');
  });


});
