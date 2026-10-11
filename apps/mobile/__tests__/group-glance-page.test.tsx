/**
 * The Groups screen's At a glance section (mock reads): the period board by
 * the chosen metric, the stepper back through earlier periods, and the
 * position chart with the selected period's table. `src/groups/home-mock` is
 * deterministic, so figures are asserted as relations (ranked, descending),
 * never as literals. The metric and the period are the screen's filter row,
 * so they arrive as props.
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

import { GroupGlancePage } from '@/components/groups/group-glance-page';
import type { GroupHomeMetric, GroupHomePeriod } from '@/src/groups/home-mock';
import { GROUP_HOME_BOARD_SIZE, MOCK_MY_USER_ID } from '@/src/groups/home-mock';
import { GROUP_RANK_PERIODS } from '@/src/groups/home-view-model';

// Wed 14 Oct 2026, 18:30 local: the week is Mon 12 – Sun 18 Oct.
const NOW = new Date(2026, 9, 14, 18, 30);

const renderPage = (metric: GroupHomeMetric = 'sets', period: GroupHomePeriod = 'week') =>
  render(<GroupGlancePage metric={metric} myUserId={MOCK_MY_USER_ID} now={NOW} period={period} />);

const byId = (testID: string) => screen.getByTestId(testID);

const boardValues = (): number[] =>
  screen
    .getAllByTestId(/^group-home-board-row-.*-value$/)
    .map((node) => Number(String(node.props.children).replace(/[^0-9.]/g, '')));

beforeEach(() => {
  mockPush.mockClear();
});

describe('At a glance: the board', () => {
  it('opens on this week by sets, top five ranked, with my own row marked', () => {
    renderPage();

    expect(byId('group-home-period-title')).toHaveTextContent('This week');
    expect(byId('group-home-period-detail')).toHaveTextContent('Mon 12 – Sun 18');
    expect(within(byId('group-home-board')).getByText('Sets')).toBeTruthy();
    expect(within(byId('group-home-board')).getByText(`Top ${GROUP_HOME_BOARD_SIZE}`)).toBeTruthy();

    const values = boardValues();
    expect(values).toHaveLength(GROUP_HOME_BOARD_SIZE);
    expect([...values].sort((left, right) => right - left)).toEqual(values);
    // I am either one of the five rows or on the closing line, never both.
    const mine = screen.queryByTestId(`group-home-board-row-${MOCK_MY_USER_ID}`);
    const closing = screen.queryByTestId('group-home-board-me');
    expect(Boolean(mine) !== Boolean(closing)).toBe(true);
  });

  it('ranks by the metric the screen hands it, renaming the column', () => {
    const sets = (renderPage(), boardValues());
    screen.unmount();

    renderPage('volume');
    expect(within(byId('group-home-board')).getByText('Vol')).toBeTruthy();
    const volume = boardValues();
    expect([...volume].sort((left, right) => right - left)).toEqual(volume);
    // Volume is kg·reps, so every figure is far above the set counts.
    expect(Math.min(...volume)).toBeGreaterThan(Math.max(...sets));
    screen.unmount();

    renderPage('prs');
    expect(within(byId('group-home-board')).getByText('PRs')).toBeTruthy();
  });

  it('steps back through earlier weeks and never past the current one', () => {
    renderPage();

    fireEvent.press(byId('group-home-period-earlier'));
    expect(byId('group-home-period-title')).toHaveTextContent('Last week');
    expect(byId('group-home-period-detail')).toHaveTextContent('Mon 5 – Sun 11');

    fireEvent.press(byId('group-home-period-earlier'));
    // A week the title already dates says its month underneath, not the dates twice.
    expect(byId('group-home-period-title')).toHaveTextContent('Mon 28 Sep – Sun 4 Oct');
    expect(byId('group-home-period-detail')).toHaveTextContent('September 2026');

    fireEvent.press(byId('group-home-period-later'));
    fireEvent.press(byId('group-home-period-later'));
    expect(byId('group-home-period-title')).toHaveTextContent('This week');
    // At the current period there is nowhere later to go.
    expect(byId('group-home-period-later').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(byId('group-home-period-later'));
    expect(byId('group-home-period-title')).toHaveTextContent('This week');
  });

  it('steps through months when the screen is set to months', () => {
    renderPage('sets', 'month');

    expect(byId('group-home-period-title')).toHaveTextContent('This month');
    expect(byId('group-home-period-detail')).toHaveTextContent('October 2026');
    fireEvent.press(byId('group-home-period-earlier'));
    expect(byId('group-home-period-title')).toHaveTextContent('Last month');
    expect(byId('group-home-period-detail')).toHaveTextContent('September 2026');
  });
});

describe('At a glance: position over time', () => {
  it('charts every member over the last six periods and opens on the newest', () => {
    renderPage();

    expect(byId('group-rank-chart')).toBeTruthy();
    expect(screen.getAllByTestId(/^group-rank-chart-label-\d+$/)).toHaveLength(GROUP_RANK_PERIODS);
    // The newest column is the selected one, and it is the period in view.
    expect(byId('group-position-selected')).toHaveTextContent('Mon 12 – Sun 18 · so far');
  });

  it('reads the selected period into the table, ranked, with every member', () => {
    renderPage();
    expect(byId('group-rank-chart-label-5').props.accessibilityState).toEqual({ selected: true });

    // The oldest column: six periods back, so an earlier week and never "so far".
    fireEvent.press(byId('group-rank-chart-label-0'));

    expect(byId('group-rank-chart-label-0').props.accessibilityState).toEqual({ selected: true });
    expect(String(byId('group-position-selected').props.children)).not.toContain('so far');
    const ranks = within(byId('group-rank-table'))
      .getAllByTestId(/^group-rank-table-row-/)
      .map((node) => Number(String(node.props.accessibilityLabel).split(',')[0]));
    expect(ranks.length).toBeGreaterThanOrEqual(GROUP_HOME_BOARD_SIZE);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
  });

  it('drops the metric column when the metric is already the volume', () => {
    renderPage('volume');

    const table = within(byId('group-rank-table'));
    expect(table.getByText('Vol')).toBeTruthy();
    expect(table.queryByText('Sets')).toBeNull();
  });
});
