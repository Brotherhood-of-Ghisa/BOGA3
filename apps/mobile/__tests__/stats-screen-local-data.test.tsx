/* eslint-disable import/first */

/**
 * The Stats screen over real data: the production route, repositories and
 * catalog caches over the migrated in-memory SQLite database, seeded through
 * the Maestro harness with the `exercise-block-history` fixture. No Maestro
 * flow covers Stats beyond `ios-data-smoke`'s exercise-list read-back: this
 * suite owns the rest. Only the native database open and the
 * router are replaced (helpers/local-data.ts); the two overlay read failures
 * are forced with `jest.spyOn` on the real module, the only states real data
 * cannot produce.
 *
 * `stats-screen.test.tsx` covers the formatting and sorting rules and the
 * screen shell's presentation on hand-built props; this suite proves the data
 * reaches it.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
let mockSearchParams: Record<string, string> = {};
// Every mounted focus callback, so a test can play "the tab came back".
const mockFocusCallbacks = new Set<() => void | (() => void)>();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockSearchParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => {
      mockFocusCallbacks.add(callback);
      const cleanup = callback();
      return () => {
        mockFocusCallbacks.delete(callback);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [callback]);
  },
}));

import StatsRoute from '../app/(tabs)/stats-history';
import * as exerciseAnalytics from '@/src/data/exercise-analytics';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import * as statsRepository from '@/src/data/stats';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
const BENCH = EXERCISE_BLOCK_HISTORY_FIXTURE.secondaryExerciseId;
const PULLDOWN = EXERCISE_BLOCK_HISTORY_FIXTURE.noHistoryExerciseId;
const SQUAT_ROW = `stats-exercise-row-${SQUAT}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const renderStats = async () => {
  render(<StatsRoute />);
  await screen.findByTestId('stats-history-screen');
};

const renderSeededStats = async () => {
  await loadMaestroFixture('exercise-block-history');
  await renderStats();
  await screen.findByTestId(SQUAT_ROW);
};

const replayFocus = () =>
  act(async () => {
    mockFocusCallbacks.forEach((callback) => callback());
  });

const exerciseOrder = () =>
  screen
    .getAllByTestId(/^stats-exercise-name-/)
    .map((node) => String(node.props.testID).replace('stats-exercise-name-', ''));

// A Lat Pulldown session through the app's draft → complete path.
const logPulldown = async (daysAgo: number) => {
  const completedAt = new Date(Date.now() - daysAgo * DAY_MS);
  const startedAt = new Date(completedAt.getTime() - 30 * 60 * 1000);
  const sessionId = `stats_pulldown_${daysAgo}`;
  await persistSessionDraftSnapshot(
    {
      sessionId,
      gymId: null,
      startedAt,
      exercises: [
        {
          id: `${sessionId}_pulldown`,
          exerciseDefinitionId: PULLDOWN,
          name: 'Lat Pulldown',
          sets: [{ id: `${sessionId}_set`, weightValue: '60', repsValue: '10', setType: 'rir_2', performanceStatus: null }],
        },
      ],
    },
    { now: completedAt }
  );
  await completeSessionDraft(sessionId, { completedAt, now: completedAt });
};

beforeEach(() => {
  resetLocalData();
  mockPush.mockClear();
  mockSearchParams = {};
  mockFocusCallbacks.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
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
    // One figure, the working sets (the squat warm-up is no set), against the
    // adjacent previous 7 days of the same fixture.
    expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets9+6');
    expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*6\s*\+3/);
    expect(screen.getByTestId('stats-exercise-sort-sets-indicator')).toBeTruthy();
    // A row's own figures, from the same week.
    expect(screen.getByTestId(`stats-exercise-name-${SQUAT}`)).toHaveTextContent('Barbell Back Squat');
    expect(screen.getByTestId(`stats-exercise-sets-${SQUAT}`)).toHaveTextContent(/^7$/);
    // Sets and Volume read the 7 working sets; the warm-up adds to neither.
    expect(screen.getByTestId(`stats-exercise-volume-${SQUAT}`)).toHaveTextContent('7100');
    expect(screen.getByTestId(`stats-exercise-1rm-${SQUAT}`)).toHaveTextContent('321');
    expect(screen.queryByTestId(`stats-exercise-sessions-${SQUAT}`)).toBeNull();
    expect(screen.getByTestId(SQUAT_ROW).props.accessibilityLabel).toContain('7 sets. Volume');
  });

  it('re-queries the 30-day period, dropping the fixture invalid set, and back', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets14+14')
    );
    expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*11/);

    fireEvent.press(screen.getByTestId('stats-period-chip-7'));
    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets9+6')
    );
  });

  it('opens on the period and breakdown the route asks for', async () => {
    mockSearchParams = { period: '30', breakdown: 'muscle' };
    await loadMaestroFixture('exercise-block-history');
    await renderStats();

    await waitFor(() =>
      expect(screen.getByTestId('stats-card-sets')).toHaveTextContent('Sets14+14')
    );
    expect(screen.getByTestId('stats-period-chip-30')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('stats-view-mode-chip-muscle')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('stats-family-header-legs')).toBeTruthy();
  });

  it('lists only exercises with a performed set in the period', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(20);
    await renderStats();
    await screen.findByTestId(SQUAT_ROW);

    expect(screen.queryByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeNull();

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));
    expect(await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeTruthy();
  });

  it('sorts by most recent from each exercise’s last completed session', async () => {
    await loadMaestroFixture('exercise-block-history');
    await logPulldown(20);
    await renderStats();
    fireEvent.press(await screen.findByTestId('stats-period-chip-30'));
    await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`);

    fireEvent.press(screen.getByTestId('stats-exercise-sort-exercise'));

    // Carry (0.2 days ago), Squat (0.25), Bench (2), Pulldown (20).
    expect(exerciseOrder()).toEqual([
      EXERCISE_BLOCK_HISTORY_FIXTURE.unmappedExerciseId,
      SQUAT,
      BENCH,
      PULLDOWN,
    ]);
  });

  it('reads the database again on focus, showing a session logged elsewhere', async () => {
    await renderSeededStats();
    expect(screen.queryByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeNull();

    // Logged on another tab while Stats was in the background.
    await logPulldown(0.05);
    await replayFocus();

    expect(await screen.findByTestId(`stats-exercise-row-${PULLDOWN}`)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/Sessions\s*7/));
  });

  it('opens the Sessions list from the Sessions card', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-card-sessions'));

    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('clears the search when the breakdown changes', async () => {
    await renderSeededStats();

    fireEvent.changeText(screen.getByTestId('stats-search-input'), 'Squat');
    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', 'Squat');
    expect(screen.queryByTestId(`stats-exercise-row-${BENCH}`)).toBeNull();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));

    expect(screen.getByTestId('stats-search-input')).toHaveProp('value', '');
  });

  it('shows an error panel when the summary read fails (a failed read)', async () => {
    jest.spyOn(statsRepository, 'computeStatsSummary').mockRejectedValueOnce(new Error('Summary boom'));
    await loadMaestroFixture('exercise-block-history');
    await renderStats();

    // The summary feeds the muscle breakdown.
    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    expect(await screen.findByTestId('stats-error-state')).toHaveTextContent(/Summary boom/);
  });

  it('breaks the seeded week down by muscle family', async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));

    expect(await screen.findByTestId('stats-family-header-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-sets-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-volume-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-family-header-button-chest')).toBeTruthy();
    // Squat's 7 working sets (all but the warm-up) land on each muscle it maps
    // to; the warm-up adds neither a set nor volume.
    expect(screen.getByTestId('stats-muscle-sets-quads')).toHaveTextContent(/^Sets7/);
    expect(screen.getByTestId('stats-muscle-row-quads').props.accessibilityLabel).toContain('volume 3550');
  });

  it("opens a seeded exercise's history with all four metrics and both views, and dismisses it", async () => {
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

    fireEvent.press(screen.getByTestId('stats-exercise-history-backdrop', { includeHiddenElements: true }));
    expect(screen.queryByTestId('stats-exercise-history-overlay')).toBeNull();
  });

  it('shows an overlay error when the exercise history read fails (a failed read)', async () => {
    jest
      .spyOn(exerciseAnalytics, 'computeSelectedExerciseWeeklyEffort')
      .mockRejectedValueOnce(new Error('DB error'));
    await renderSeededStats();

    fireEvent.press(screen.getByTestId(SQUAT_ROW));

    expect(await screen.findByTestId('stats-exercise-history-error')).toHaveTextContent(/DB error/);
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

  it("opens one muscle's history from its row, switching metric and view", async () => {
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-muscle-row-quads'));

    expect(await screen.findByTestId('stats-muscle-history-title')).toHaveTextContent(/Quads/);
    expect(await screen.findByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-totalVolume')).toHaveProp('accessibilityState', {
      selected: true,
    });

    fireEvent.press(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount'));
    expect(screen.getByTestId('stats-muscle-history-metric-chip-workingSetCount')).toHaveProp('accessibilityState', {
      selected: true,
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('stats-muscle-history-view-chip-daily'));
    });
    expect(screen.getByTestId('stats-muscle-history-view-chip-daily')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('shows an overlay error when the muscle history read fails, and dismisses it (a failed read)', async () => {
    jest
      .spyOn(statsRepository, 'computeSelectedMuscleWeeklyEffort')
      .mockRejectedValueOnce(new Error('Weekly boom'));
    await renderSeededStats();

    fireEvent.press(screen.getByTestId('stats-view-mode-chip-muscle'));
    fireEvent.press(await screen.findByTestId('stats-family-header-button-chest'));

    expect(await screen.findByTestId('stats-muscle-history-error')).toHaveTextContent(/Weekly boom/);

    fireEvent.press(screen.getByTestId('stats-muscle-history-backdrop', { includeHiddenElements: true }));
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
  });
});
