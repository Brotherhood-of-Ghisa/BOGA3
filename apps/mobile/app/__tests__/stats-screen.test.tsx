import type * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  default as StatsRoute,
  StatsHistoryScreenShell,
  StatsScreenShell,
  formatDelta,
} from '../(tabs)/stats-history';
import type { StatsSummary } from '@/src/data';

jest.mock('@/src/data', () => ({
  computeStatsSummary: jest.fn(),
  // History sub-view (mounted in StatsRoute) pulls these in through the
  // shared session-list data client.
  formatSessionListCompactDuration: (durationSec: number | null) => {
    if (!durationSec || durationSec <= 0) {
      return '0m';
    }
    const totalMinutes = Math.floor(durationSec / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) {
      return `${totalMinutes}m`;
    }
    if (minutes <= 0) {
      return `${hours}h`;
    }
    return `${hours}h ${minutes}m`;
  },
  listSessionListBuckets: jest.fn().mockResolvedValue({ active: null, completed: [] }),
  completeSessionDraft: jest.fn(),
  persistSessionDraftSnapshot: jest.fn(),
  reopenCompletedSessionDraft: jest.fn(),
  setSessionDeletedState: jest.fn(),
}));

jest.mock('@/src/exercise-catalog/cache', () => ({
  useExerciseCatalog: () => ({ status: 'ready', exercises: [], lastError: null }),
}));

jest.mock('@/src/exercise-catalog/search', () => ({
  filterIndexedExerciseCatalogExercises: (exercises: unknown[]) => exercises,
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

const { computeStatsSummary: mockComputeStatsSummary } = jest.requireMock(
  '@/src/data'
) as { computeStatsSummary: jest.Mock };

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
      setsByMuscleGroup: [
        {
          muscleGroupId: 'chest_sternal',
          displayName: 'Chest (sternal)',
          familyName: 'Chest',
          sortOrder: 10,
          score: 6,
        },
        {
          muscleGroupId: 'calves',
          displayName: 'Calves',
          familyName: 'Legs',
          sortOrder: 40,
          score: 0,
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
      setsByMuscleGroup: [
        {
          muscleGroupId: 'chest_sternal',
          displayName: 'Chest (sternal)',
          familyName: 'Chest',
          sortOrder: 10,
          score: 5,
        },
        {
          muscleGroupId: 'calves',
          displayName: 'Calves',
          familyName: 'Legs',
          sortOrder: 40,
          score: 0,
        },
      ],
    },
  },
  ...overrides,
});

beforeEach(() => {
  mockComputeStatsSummary.mockReset();
  mockPush.mockReset();
});

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
  it('renders summary cards with deltas and highlights untrained muscle groups', () => {
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
        onPressExerciseHistoryPicker={jest.fn()}
        isLoading={false}
        errorMessage={null}
      />
    );

    const sessionsCard = screen.getByTestId('stats-card-sessions');
    expect(sessionsCard).toHaveTextContent(/Sessions/);
    expect(sessionsCard).toHaveTextContent(/4/);
    expect(sessionsCard).toHaveTextContent(/\+1 \(\+33%\)/);

    const setsCard = screen.getByTestId('stats-card-sets');
    expect(setsCard).toHaveTextContent(/38/);
    expect(setsCard).toHaveTextContent(/\+8 \(\+27%\)/);

    const trainedRow = screen.getByTestId('stats-muscle-row-chest_sternal');
    expect(trainedRow).toHaveTextContent(/Chest \(sternal\)/);
    expect(trainedRow).toHaveTextContent(/6/);

    const untrainedRow = screen.getByTestId('stats-muscle-row-calves');
    expect(untrainedRow).toHaveTextContent(/Calves/);
    expect(untrainedRow).toHaveTextContent(/Not trained/);
  });

  it('invokes onSelectPeriod when switching period chips', () => {
    const onSelectPeriod = jest.fn();
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={onSelectPeriod}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
        onPressExerciseHistoryPicker={jest.fn()}
        isLoading={false}
        errorMessage={null}
      />
    );

    fireEvent.press(screen.getByTestId('stats-period-chip-30'));
    expect(onSelectPeriod).toHaveBeenCalledWith(30);
  });

  it('shows an error panel when summary load fails', () => {
    render(
      <StatsScreenShell
        summary={null}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
        onPressExerciseHistoryPicker={jest.fn()}
        isLoading={false}
        errorMessage="Boom"
      />
    );

    expect(screen.getByTestId('stats-error-state')).toHaveTextContent(/Boom/);
  });

  it('invokes onPressExerciseHistoryPicker when the picker row is tapped', () => {
    const onPress = jest.fn();
    render(
      <StatsScreenShell
        summary={buildSummary()}
        periodDays={7}
        onSelectPeriod={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
        onPressExerciseHistoryPicker={onPress}
        isLoading={false}
        errorMessage={null}
      />
    );

    fireEvent.press(screen.getByTestId('stats-exercise-history-picker-button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('StatsHistoryScreenShell view toggle', () => {
  const shellProps = (overrides: Partial<React.ComponentProps<typeof StatsHistoryScreenShell>> = {}) => ({
    summary: buildSummary(),
    periodDays: 7 as const,
    onSelectPeriod: jest.fn(),
    onPressExerciseHistoryPicker: jest.fn(),
    isLoading: false,
    errorMessage: null,
    onPressLog: jest.fn(),
    onPressExercises: jest.fn(),
    onPressSettings: jest.fn(),
    activeView: 'stats' as const,
    onChangeView: jest.fn(),
    ...overrides,
  });

  it('renders the Stats ↔ History toggle row with both chips', () => {
    render(<StatsHistoryScreenShell {...shellProps()} />);
    expect(screen.getByTestId('stats-history-view-chip-stats')).toBeTruthy();
    expect(screen.getByTestId('stats-history-view-chip-history')).toBeTruthy();
  });

  it('invokes onChangeView when the inactive chip is pressed', () => {
    const onChangeView = jest.fn();
    render(<StatsHistoryScreenShell {...shellProps({ onChangeView })} />);

    fireEvent.press(screen.getByTestId('stats-history-view-chip-history'));
    expect(onChangeView).toHaveBeenCalledWith('history');
  });

  it('keeps both sub-views mounted across toggling so scroll/menu state persists', () => {
    // Use `includeHiddenElements` so we still see the inactive slot, which is
    // marked `pointerEvents="none"` while inactive but stays in the React tree.
    const { rerender } = render(<StatsHistoryScreenShell {...shellProps({ activeView: 'stats' })} />);

    const statsSlot = screen.getByTestId('stats-history-stats-slot', { includeHiddenElements: true });
    const historySlot = screen.getByTestId('stats-history-history-slot', { includeHiddenElements: true });
    expect(statsSlot).toBeTruthy();
    expect(historySlot).toBeTruthy();
    expect(screen.getByTestId('stats-history-history-subview', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('stats-card-sessions')).toBeTruthy();

    rerender(<StatsHistoryScreenShell {...shellProps({ activeView: 'history' })} />);

    // After toggling, the same slot elements are still mounted (no remount).
    expect(screen.getByTestId('stats-history-stats-slot', { includeHiddenElements: true })).toBe(statsSlot);
    expect(screen.getByTestId('stats-history-history-slot')).toBe(historySlot);
    // Stats sub-view content is also still in the tree (just hidden via styles).
    expect(screen.getByTestId('stats-card-sessions', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('stats-history-history-subview')).toBeTruthy();
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
              setsByMuscleGroup: buildSummary().current.totals.setsByMuscleGroup,
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
});
