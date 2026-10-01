/* eslint-disable import/first */

/**
 * The Stats screen over real data: the production route, repositories and
 * catalog caches over the migrated in-memory SQLite database, seeded through
 * the Maestro harness with the same fixture the `ios-ui-regression` stats flow
 * loads (`exercise-block-history`). Only the native database open and the
 * router are replaced (helpers/local-data.ts).
 *
 * `stats-screen.test.tsx` covers the screen's logic on hand-built props; this
 * suite proves the data reaches it.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

import StatsRoute from '../(tabs)/stats-history';
import { closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

const SQUAT_ROW = 'stats-exercise-row-seed_barbell_back_squat';

const renderStats = async () => {
  render(<StatsRoute />);
  await screen.findByTestId('stats-history-screen');
};

const renderSeededStats = async () => {
  await loadMaestroFixture('exercise-block-history');
  await renderStats();
  await screen.findByTestId(SQUAT_ROW);
};

beforeEach(() => {
  resetLocalData();
  mockPush.mockClear();
});

afterEach(() => {
  closeLocalData();
});

describe('Stats over real data', () => {
  it('shows the empty state on an empty database', async () => {
    await renderStats();

    expect(await screen.findByTestId('stats-exercise-list-empty')).toBeTruthy();
  });

  it('lists the seeded exercises with the 7-day working-set card', async () => {
    await renderSeededStats();

    expect(screen.getByTestId('stats-exercise-list')).toBeTruthy();
    expect(screen.getByTestId('stats-card-sets')).toHaveTextContent(/Sets \(W\/Sets\)\s*10 \(8\)/);
    expect(screen.getByTestId('stats-exercise-sort-sets-indicator')).toBeTruthy();
  });

  it('re-queries the 30-day period, dropping the fixture invalid set, and back', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent(/15 \(11\)/)
    );

    fireEvent.press(screen.getByTestId('stats-period-chip-7'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent(/10 \(8\)/)
    );
  });

  it('breaks the seeded week down by muscle family', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));

    expect(await screen.findByTestId('stats-family-header-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-sets-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-volume-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-header-button-chest')).toBeTruthy();
  });

  it("opens a seeded exercise's history with all four metrics and both views", async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId(SQUAT_ROW));

    const title = await screen.findByTestId('stats-exercise-history-title');
    expect(title).toHaveTextContent(/Squat/);
    await screen.findByText('Weekly training load');
    for (const metric of ['totalVolume', 'workingSetCount', 'estimatedRM1', 'highestWeight']) {
      expect(screen.getByTestId(`stats-exercise-history-metric-chip-${metric}`)).toBeTruthy();
    }

    await act(async () => {
      fireEvent.press(screen.getByTestId('stats-exercise-history-view-chip-daily'));
    });
    expect(await screen.findByText('Last 12 months')).toBeTruthy();
  });

  it("opens a muscle family's history from the seeded breakdown", async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-family-header-legs'));

    const title = await screen.findByTestId('stats-muscle-history-title');
    expect(title).toHaveTextContent('Legs');
    expect(screen.getByTestId('stats-muscle-history-metric-chip-totalVolume')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-history-metric-chip-estimatedRM1')).toBeNull();
    expect(
      within(screen.getByTestId('stats-muscle-history-overlay')).queryByTestId(
        'stats-muscle-history-metric-chip-highestWeight'
      )
    ).toBeNull();
  });
});
