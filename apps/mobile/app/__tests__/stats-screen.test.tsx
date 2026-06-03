import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  default as StatsRoute,
  StatsScreenShell,
  type StatsScreenShellProps,
  type StatsViewMode,
  formatDelta,
} from '../(tabs)/stats-history';
import type { SelectedMuscleWeeklyEffort, StatsSummary } from '@/src/data';

jest.mock('@/src/data', () => ({
  computeSelectedMuscleWeeklyEffort: jest.fn(),
  computeStatsSummary: jest.fn(),
}));

jest.mock('@/src/exercise-catalog/cache', () => ({
  useExerciseCatalog: jest.fn(() => ({ exercises: [], status: 'ready', muscleGroups: [], muscleGroupsById: {}, lastError: null })),
}));

jest.mock('expo-router', () => {
  const mockPush = jest.fn();
  let latestFocusCallback: (() => void) | null = null;

  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void) => {
      latestFocusCallback = callback;
    },
    __mockPush: mockPush,
    __triggerFocus: () => {
      latestFocusCallback?.();
    },
  };
});

const {
  computeSelectedMuscleWeeklyEffort: mockComputeSelectedMuscleWeeklyEffort,
  computeStatsSummary: mockComputeStatsSummary,
} = jest.requireMock('@/src/data') as {
  computeSelectedMuscleWeeklyEffort: jest.Mock;
  computeStatsSummary: jest.Mock;
};

const { __mockPush: mockPush, __triggerFocus: triggerFocus } = jest.requireMock(
  'expo-router'
) as { __mockPush: jest.Mock; __triggerFocus: () => void };

const buildSummary = (overrides: Partial<StatsSummary> = {}): StatsSummary => ({
  current: {
    period: {
      days: 7,
      start: new Date('2026-05-12T15:00:00.000Z'),
      end: new Date('2026-05-19T15:00:00.000Z'),
    },
    totals: {
      sessionCount: 4,
      totalSets: 38,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          sessionCount: 3,
          totalWeight: 1800,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              sessionCount: 3,
              totalWeight: 1800,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          sessionCount: 2,
          totalWeight: 900,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              sessionCount: 2,
              totalWeight: 600,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              sessionCount: 1,
              totalWeight: 300,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          sessionCount: 0,
          totalWeight: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              sessionCount: 0,
              totalWeight: 0,
            },
          ],
        },
      ],
    },
  },
  previous: {
    period: {
      days: 7,
      start: new Date('2026-05-05T15:00:00.000Z'),
      end: new Date('2026-05-12T15:00:00.000Z'),
    },
    totals: {
      sessionCount: 3,
      totalSets: 30,
      muscleFamilies: [
        {
          familyName: 'Chest',
          sortOrder: 10,
          sessionCount: 2,
          totalWeight: 1500,
          muscles: [
            {
              muscleGroupId: 'chest',
              displayName: 'Chest',
              familyName: 'Chest',
              sortOrder: 10,
              sessionCount: 2,
              totalWeight: 1500,
            },
          ],
        },
        {
          familyName: 'Shoulders',
          sortOrder: 20,
          sessionCount: 1,
          totalWeight: 600,
          muscles: [
            {
              muscleGroupId: 'front_delts',
              displayName: 'Front Delts',
              familyName: 'Shoulders',
              sortOrder: 20,
              sessionCount: 1,
              totalWeight: 400,
            },
            {
              muscleGroupId: 'rear_delts',
              displayName: 'Rear Delts',
              familyName: 'Shoulders',
              sortOrder: 21,
              sessionCount: 1,
              totalWeight: 200,
            },
          ],
        },
        {
          familyName: 'Legs',
          sortOrder: 40,
          sessionCount: 0,
          totalWeight: 0,
          muscles: [
            {
              muscleGroupId: 'calves',
              displayName: 'Calves',
              familyName: 'Legs',
              sortOrder: 40,
              sessionCount: 0,
              totalWeight: 0,
            },
          ],
        },
      ],
    },
  },
  ...overrides,
});

beforeEach(() => {
  mockComputeSelectedMuscleWeeklyEffort.mockReset();
  mockComputeStatsSummary.mockReset();
  mockPush.mockReset();
});

const buildShellProps = (
  overrides: Partial<StatsScreenShellProps> = {}
): StatsScreenShellProps => ({
  summary: buildSummary(),
  periodDays: 7,
  onSelectPeriod: jest.fn(),
  onPressSessionsCard: jest.fn(),
  onPressMuscleHistory: jest.fn(),
  onDismissMuscleHistory: jest.fn(),
  onSelectMuscleHistoryWeek: jest.fn(),
  isLoading: false,
  errorMessage: null,
  selectedMuscle: null,
  muscleHistoryWeeklyEffort: [],
  isMuscleHistoryLoading: false,
  muscleHistoryErrorMessage: null,
  selectedMuscleHistoryWeekKey: null,
  muscleHistoryMetric: 'totalVolume',
  onSelectMuscleHistoryMetric: jest.fn(),
  viewMode: 'muscle' as StatsViewMode,
  onSelectViewMode: jest.fn(),
  exercises: [],
  onPressExercise: jest.fn(),
  ...overrides,
});

const renderStatsScreenShell = (overrides: Partial<StatsScreenShellProps> = {}) =>
  render(<StatsScreenShell {...buildShellProps(overrides)} />);

const buildWeeklyEffort = (): SelectedMuscleWeeklyEffort => ({
  weekStartDateKey: '2026-05-11',
  monthKey: '2026-05',
  weekOfMonth: 2,
  totalVolume: 1100,
  nearFailureCount: 2,
  estimatedRM1: 150,
  highestWeight: 120,
});

const captureUiEvidence = (name: string, tree: unknown) => {
  const evidenceDir = process.env.UI_EVIDENCE_DIR;
  if (!evidenceDir) return;

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, `${name}.json`), JSON.stringify(tree, null, 2));
};

describe('formatDelta', () => {
  it('renders em-dash when both periods are zero', () => {
    expect(formatDelta(0, 0)).toEqual({ text: '—', tone: 'neutral' });
  });

  it('renders the "new" tone when previous was zero but current is positive', () => {
    expect(formatDelta(4, 0)).toEqual({ text: '+4 (new)', tone: 'new' });
  });

  it('renders positive delta with absolute and percent change', () => {
    expect(formatDelta(8, 6)).toEqual({
      text: '+2 (+33%)',
      tone: 'positive',
    });
  });

  it('renders negative delta with minus sign and percent change', () => {
    const delta = formatDelta(3, 6);
    expect(delta.tone).toBe('negative');
    expect(delta.text).toContain('3');
    expect(delta.text).toContain('50%');
  });
});

describe('StatsScreenShell', () => {
  it('renders summary cards with deltas', () => {
    renderStatsScreenShell();

    const sessionsCard = screen.getByTestId('stats-card-sessions');
    expect(sessionsCard).toHaveTextContent(/Sessions/);
    expect(sessionsCard).toHaveTextContent(/4/);
    expect(sessionsCard).toHaveTextContent(/\+1 \(\+33%\)/);

    const setsCard = screen.getByTestId('stats-card-sets');
    expect(setsCard).toHaveTextContent(/38/);
    expect(setsCard).toHaveTextContent(/\+8 \(\+27%\)/);
  });

  it('renders family cards with sessions + total weight, including a previous-period delta', () => {
    renderStatsScreenShell();

    // Shoulders: current 2 sessions / 900, previous 1 / 600 → +1 (+100%), +300 (+50%).
    const shouldersSessions = screen.getByTestId('stats-family-sessions-shoulders');
    expect(shouldersSessions).toHaveTextContent(/2/);
    expect(shouldersSessions).toHaveTextContent(/\+1 \(\+100%\)/);

    const shouldersWeight = screen.getByTestId('stats-family-weight-shoulders');
    expect(shouldersWeight).toHaveTextContent(/900/);
    expect(shouldersWeight).toHaveTextContent(/\+300 \(\+50%\)/);

    // Nested muscle row also carries its own delta.
    const frontDeltsSessions = screen.getByTestId('stats-muscle-sessions-front_delts');
    expect(frontDeltsSessions).toHaveTextContent(/\+1 \(\+100%\)/);
  });

  it('collapses a family whose only muscle matches the family name', () => {
    renderStatsScreenShell();

    // Chest contains only one muscle named "Chest" — the nested row must be hidden.
    expect(screen.getByTestId('stats-family-card-chest')).toBeTruthy();
    expect(screen.queryByTestId('stats-muscle-row-chest')).toBeNull();

    // Shoulders has multiple muscles → nested rows still render.
    expect(screen.getByTestId('stats-muscle-row-front_delts')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-rear_delts')).toBeTruthy();

    // Untrained family with a single non-matching muscle still expands.
    expect(screen.getByTestId('stats-family-card-legs')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-row-calves')).toHaveTextContent(/Calves/);
  });

  it('invokes onSelectPeriod when switching period chips', () => {
    const onSelectPeriod = jest.fn();
    renderStatsScreenShell({ onSelectPeriod });

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));
    expect(onSelectPeriod).toHaveBeenCalledWith(30);
  });

  it('shows an error panel when summary load fails', () => {
    renderStatsScreenShell({ summary: null, errorMessage: 'Boom' });

    expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Boom/);
  });

  it('invokes onPressSessionsCard when the Sessions card is tapped', () => {
    const onPress = jest.fn();
    renderStatsScreenShell({ onPressSessionsCard: onPress });

    fireEvent.press(screen.getByTestId('stats-card-sessions'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('opens muscle history from expanded muscle rows and collapsed single-muscle headers', () => {
    const onPressMuscleHistory = jest.fn();
    renderStatsScreenShell({ onPressMuscleHistory });

    fireEvent.press(screen.getByTestId('stats-muscle-row-front_delts'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({
      muscleGroupIds: ['front_delts'],
      displayName: 'Front Delts',
      familyName: 'Shoulders',
    });

    fireEvent.press(screen.getByTestId('stats-family-header-button-chest'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({
      muscleGroupIds: ['chest'],
      displayName: 'Chest',
      familyName: 'Chest',
    });
  });

  it('opens family-level muscle history from a multi-muscle family header', () => {
    const onPressMuscleHistory = jest.fn();
    renderStatsScreenShell({ onPressMuscleHistory });

    fireEvent.press(screen.getByTestId('stats-family-header-shoulders'));
    expect(onPressMuscleHistory).toHaveBeenCalledWith({
      muscleGroupIds: ['front_delts', 'rear_delts'],
      displayName: 'Shoulders',
      familyName: 'Shoulders',
    });
  });

  it('renders muscle-history overlay states: loading, error, empty, populated, and dismiss', () => {
    const onDismissMuscleHistory = jest.fn();
    const onSelectMuscleHistoryWeek = jest.fn();
    const { rerender, toJSON } = render(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          isMuscleHistoryLoading: true,
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );

    expect(screen.getByTestId('stats-muscle-history-title')).toHaveTextContent(
      /Front Delts/
    );
    expect(screen.getByTestId('stats-muscle-history-loading')).toHaveTextContent(/Loading/);
    captureUiEvidence('stats-muscle-history-loading', toJSON());

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          muscleHistoryErrorMessage: 'Nope',
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Nope/);
    captureUiEvidence('stats-muscle-history-error', toJSON());

    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          muscleHistoryWeeklyEffort: [],
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-empty')).toHaveTextContent(/No history yet/);
    captureUiEvidence('stats-muscle-history-empty', toJSON());

    const effort = [buildWeeklyEffort()];
    rerender(
      <StatsScreenShell
        {...buildShellProps({
          selectedMuscle: {
            muscleGroupIds: ['front_delts'],
            displayName: 'Front Delts',
            familyName: 'Shoulders',
          },
          muscleHistoryWeeklyEffort: effort,
          selectedMuscleHistoryWeekKey: '2026-05-11',
          onDismissMuscleHistory,
          onSelectMuscleHistoryWeek,
        })}
      />
    );
    expect(screen.getByTestId('stats-muscle-history-heatmap')).toBeTruthy();
    captureUiEvidence('stats-muscle-history-populated', toJSON());

    fireEvent.press(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-11'));
    expect(onSelectMuscleHistoryWeek).toHaveBeenCalledWith(null); // deselect since it's already selected

    fireEvent.press(screen.getByTestId('stats-muscle-history-backdrop'));
    expect(onDismissMuscleHistory).toHaveBeenCalledTimes(1);
  });

  it('renders metric selector chips in the overlay', () => {
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      muscleHistoryMetric: 'totalVolume',
    });

    expect(screen.getByTestId('stats-muscle-history-metric-chip-totalVolume')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-nearFailureCount')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-estimatedRM1')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-metric-chip-highestWeight')).toBeTruthy();
  });

  it('shows the week selection banner with date range and metric value when a week is selected', () => {
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      selectedMuscleHistoryWeekKey: '2026-05-11',
      muscleHistoryMetric: 'totalVolume',
    });

    const banner = screen.getByTestId('stats-muscle-history-week-banner');
    expect(banner).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-week-banner-range')).toHaveTextContent(/May/);
    expect(screen.getByTestId('stats-muscle-history-week-banner-value')).toHaveTextContent(/Volume/);
  });

  it('shows a placeholder in the banner when no week is selected', () => {
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      selectedMuscleHistoryWeekKey: null,
      muscleHistoryMetric: 'totalVolume',
    });

    expect(screen.getByTestId('stats-muscle-history-week-banner')).toBeTruthy();
    expect(screen.getByTestId('stats-muscle-history-week-banner-placeholder')).toBeTruthy();
  });

  it('calls onSelectMuscleHistoryMetric when a metric chip is pressed', () => {
    const onSelectMuscleHistoryMetric = jest.fn();
    renderStatsScreenShell({
      selectedMuscle: {
        muscleGroupIds: ['front_delts'],
        displayName: 'Front Delts',
        familyName: 'Shoulders',
      },
      muscleHistoryWeeklyEffort: [buildWeeklyEffort()],
      muscleHistoryMetric: 'totalVolume',
      onSelectMuscleHistoryMetric,
    });

    fireEvent.press(screen.getByTestId('stats-muscle-history-metric-chip-nearFailureCount'));
    expect(onSelectMuscleHistoryMetric).toHaveBeenCalledWith('nearFailureCount');
  });
});

describe('StatsScreenShell — view mode chip', () => {
  it('renders "By Exercise" chip when in muscle view', () => {
    renderStatsScreenShell({ viewMode: 'muscle' });
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('By Exercise');
  });

  it('renders "By Muscle" chip when in exercise view', () => {
    renderStatsScreenShell({ viewMode: 'exercise' });
    expect(screen.getByTestId('stats-view-mode-chip')).toHaveTextContent('By Muscle');
  });

  it('calls onSelectViewMode with opposite mode when tapped from muscle view', () => {
    const onSelectViewMode = jest.fn();
    renderStatsScreenShell({ viewMode: 'muscle', onSelectViewMode });
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
    expect(onSelectViewMode).toHaveBeenCalledWith('exercise');
  });

  it('calls onSelectViewMode with opposite mode when tapped from exercise view', () => {
    const onSelectViewMode = jest.fn();
    renderStatsScreenShell({ viewMode: 'exercise', onSelectViewMode });
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));
    expect(onSelectViewMode).toHaveBeenCalledWith('muscle');
  });

  it('renders exercise list in exercise view and hides muscle scroll', () => {
    renderStatsScreenShell({
      viewMode: 'exercise',
      exercises: [{ id: 'bench', name: 'Bench Press', searchText: '', deletedAt: null, mappings: [] }],
    });
    expect(screen.getByTestId('stats-exercise-row-bench')).toHaveTextContent('Bench Press');
    expect(screen.queryByTestId('stats-scroll')).toBeNull();
  });

  it('renders empty state when exercise view has no exercises', () => {
    renderStatsScreenShell({ viewMode: 'exercise', exercises: [] });
    expect(screen.getByTestId('stats-exercise-empty')).toBeTruthy();
    expect(screen.queryByTestId('stats-scroll')).toBeNull();
  });

  it('calls onPressExercise with the exercise id when an exercise row is tapped', () => {
    const onPressExercise = jest.fn();
    renderStatsScreenShell({
      viewMode: 'exercise',
      exercises: [{ id: 'squat', name: 'Squat', searchText: '', deletedAt: null, mappings: [] }],
      onPressExercise,
    });
    fireEvent.press(screen.getByTestId('stats-exercise-row-squat'));
    expect(onPressExercise).toHaveBeenCalledWith('squat');
  });
});

describe('StatsRoute', () => {
  it('loads the summary on focus and re-loads when the period changes', async () => {
    mockComputeStatsSummary
      .mockResolvedValueOnce(buildSummary())
      .mockResolvedValueOnce(
        buildSummary({
          current: {
            ...buildSummary().current,
            totals: {
              sessionCount: 12,
              totalSets: 100,
              muscleFamilies: buildSummary().current.totals.muscleFamilies,
            },
          },
        })
      );

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(mockComputeStatsSummary).toHaveBeenCalledWith({ periodDays: 7 });
    });

    // Switch to muscle view to see summary cards.
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/4/);
    });

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));

    await waitFor(() => {
      expect(mockComputeStatsSummary).toHaveBeenLastCalledWith({ periodDays: 30 });
    });
    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/12/);
    });
  });

  it('navigates to the sessions list when the Sessions card is tapped', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    // Switch to muscle view to see the sessions card.
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-card-sessions')).toHaveTextContent(/4/);
    });

    fireEvent.press(screen.getByTestId('stats-card-sessions'));
    expect(mockPush).toHaveBeenCalledWith('/sessions');
  });

  it('loads selected-muscle weekly heatmap data when a muscle row is tapped', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    mockComputeSelectedMuscleWeeklyEffort.mockResolvedValue([buildWeeklyEffort()]);

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    // Switch to muscle view to access muscle rows.
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-muscle-row-front_delts')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('stats-muscle-row-front_delts'));

    await waitFor(() => {
      expect(mockComputeSelectedMuscleWeeklyEffort).toHaveBeenCalledWith({
        muscleGroupIds: ['front_delts'],
        start: expect.any(Date),
        end: expect.any(Date),
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('stats-muscle-history-title')).toHaveTextContent(
        /Front Delts/
      );
    });
    expect(screen.getByTestId('stats-muscle-history-heatmap-cell-2026-05-11')).toBeTruthy();
  });

  it('shows an overlay error when selected-muscle heatmap data fails to load', async () => {
    mockComputeStatsSummary.mockResolvedValue(buildSummary());
    mockComputeSelectedMuscleWeeklyEffort.mockRejectedValue(new Error('Weekly boom'));

    render(<StatsRoute />);

    await act(async () => {
      triggerFocus();
    });

    // Switch to muscle view to access family header buttons.
    fireEvent.press(screen.getByTestId('stats-view-mode-chip'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-family-header-button-chest')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('stats-family-header-button-chest'));

    await waitFor(() => {
      expect(screen.getByTestId('stats-muscle-history-error')).toHaveTextContent(/Weekly boom/);
    });

    fireEvent.press(screen.getByTestId('stats-muscle-history-backdrop'));
    expect(screen.queryByTestId('stats-muscle-history-overlay')).toBeNull();
  });
});
