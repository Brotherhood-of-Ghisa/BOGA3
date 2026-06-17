import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  default as ExerciseHistoryRoute,
  ExerciseHistoryScreenShell,
} from '../exercise-history';
import type { ExerciseHistorySummary } from '@/src/data';

jest.mock('@/src/data', () => ({
  loadExercisePerformanceHistory: jest.fn(),
}));

jest.mock('expo-router', () => {
  const mockPush = jest.fn();
  const mockReplace = jest.fn();
  let latestFocusCallback: (() => void) | null = null;
  let latestSearchParams: Record<string, string | string[] | undefined> = {};

  return {
    Stack: { Screen: () => null },
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useFocusEffect: (callback: () => void) => {
      latestFocusCallback = callback;
    },
    useLocalSearchParams: () => latestSearchParams,
    __mockPush: mockPush,
    __triggerFocus: () => {
      latestFocusCallback?.();
    },
    __setSearchParams: (next: Record<string, string | string[] | undefined>) => {
      latestSearchParams = next;
    },
  };
});

const { loadExercisePerformanceHistory: mockLoad } = jest.requireMock('@/src/data') as {
  loadExercisePerformanceHistory: jest.Mock;
};

const expoRouterMock = jest.requireMock('expo-router') as {
  __mockPush: jest.Mock;
  __triggerFocus: () => void;
  __setSearchParams: (next: Record<string, string | string[] | undefined>) => void;
};

const buildSummary = (overrides: Partial<ExerciseHistorySummary> = {}): ExerciseHistorySummary => ({
  exerciseDefinitionId: 'ex-bench',
  exerciseName: 'Bench Press',
  exerciseDeletedAt: null,
  period: 30,
  appliedTagDefinitionId: null,
  tagOptions: [
    {
      tagDefinitionId: 'tag-westside',
      name: 'Westside grip',
      deletedAt: null,
      occurrenceCount: 2,
    },
    {
      tagDefinitionId: 'tag-wide',
      name: 'Wide grip',
      deletedAt: null,
      occurrenceCount: 1,
    },
  ],
  sessions: [
    {
      sessionId: 'session-newest',
      sessionExerciseId: 'se-newest',
      completedAt: new Date('2026-05-18T16:00:00.000Z'),
      gymName: 'Westside Barbell Club',
      tagIds: ['tag-westside'],
      sets: [
        { setId: 'st-1', orderIndex: 0, weightValue: '135', repsValue: '8', setType: 'warm_up', isWorking: false },
        { setId: 'st-2', orderIndex: 1, weightValue: '185', repsValue: '6', setType: 'rir_1', isWorking: true },
      ],
      workingSetCount: 2,
      estimatedOneRepMax: 230,
      totalVolume: 185 * 8 + 185 * 6,
      topWeightSet: { weight: 185, reps: 8 },
    },
    {
      sessionId: 'session-older',
      sessionExerciseId: 'se-older',
      completedAt: new Date('2026-05-11T16:00:00.000Z'),
      gymName: null,
      tagIds: [],
      sets: [
        { setId: 'st-3', orderIndex: 0, weightValue: '175', repsValue: '5', setType: null, isWorking: true },
      ],
      workingSetCount: 1,
      estimatedOneRepMax: 200,
      totalVolume: 175 * 5,
      topWeightSet: { weight: 175, reps: 5 },
    },
  ],
  allTimeBest: {
    estimatedOneRepMax: {
      value: 230,
      sessionId: 'session-newest',
      completedAt: new Date('2026-05-18T16:00:00.000Z'),
    },
    topWeight: {
      weight: 185,
      reps: 8,
      sessionId: 'session-newest',
      completedAt: new Date('2026-05-18T16:00:00.000Z'),
    },
  },
  ...overrides,
});

beforeEach(() => {
  mockLoad.mockReset();
  expoRouterMock.__mockPush.mockReset();
  expoRouterMock.__setSearchParams({ exerciseDefinitionId: 'ex-bench' });
});

describe('ExerciseHistoryScreenShell', () => {
  it('renders the all-time best card and session list', () => {
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary()}
        period={30}
        appliedTagDefinitionId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-best-est-1rm')).toHaveTextContent(/230/);
    expect(screen.getByTestId('exercise-history-best-top-weight')).toHaveTextContent(/185.*×.*8/);
    expect(screen.getByTestId('exercise-history-session-card-se-newest')).toHaveTextContent(/2026-05-18/);
    expect(screen.getByTestId('exercise-history-session-card-se-newest')).toHaveTextContent(/W-Up/);
    expect(screen.getByTestId('exercise-history-session-card-se-older')).toBeTruthy();
  });

  it('invokes onSelectPeriod when a period chip is tapped', () => {
    const onSelectPeriod = jest.fn();
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary()}
        period={30}
        appliedTagDefinitionId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={onSelectPeriod}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    fireEvent.press(screen.getByTestId('exercise-history-period-chip-7'));
    expect(onSelectPeriod).toHaveBeenCalledWith(7);
    fireEvent.press(screen.getByTestId('exercise-history-period-chip-all'));
    expect(onSelectPeriod).toHaveBeenCalledWith('all');
  });

  it('invokes onSelectTag with tagDefinitionId and toggles back to null', () => {
    const onSelectTag = jest.fn();
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary()}
        period={30}
        appliedTagDefinitionId="tag-westside"
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={onSelectTag}
        onPressSession={jest.fn()}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    // Selecting a different tag should pick it.
    fireEvent.press(screen.getByTestId('exercise-history-tag-chip-tag-wide'));
    expect(onSelectTag).toHaveBeenLastCalledWith('tag-wide');

    // Tapping the currently-selected tag should clear the filter (toggle off).
    fireEvent.press(screen.getByTestId('exercise-history-tag-chip-tag-westside'));
    expect(onSelectTag).toHaveBeenLastCalledWith(null);

    // The dedicated "All tags" chip should also clear the filter.
    fireEvent.press(screen.getByTestId('exercise-history-tag-chip-all'));
    expect(onSelectTag).toHaveBeenLastCalledWith(null);
  });

  it('renders the in-section empty state when no sessions match the filter', () => {
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary({ sessions: [] })}
        period={7}
        appliedTagDefinitionId="tag-westside"
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-empty-state')).toHaveTextContent(
      /selected tag/
    );
  });

  it('renders the error state when errorMessage is set', () => {
    render(
      <ExerciseHistoryScreenShell
        summary={null}
        period={30}
        appliedTagDefinitionId={null}
        isLoading={false}
        errorMessage="Boom"
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-error-state')).toHaveTextContent(/Boom/);
  });

  it('opens the completed session detail when a session card is tapped', () => {
    const onPressSession = jest.fn();
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary()}
        period={30}
        appliedTagDefinitionId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={onPressSession}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    fireEvent.press(screen.getByTestId('exercise-history-session-card-se-newest'));
    expect(onPressSession).toHaveBeenCalledWith('session-newest');
  });
});

describe('ExerciseHistoryRoute', () => {
  it('loads the history on focus and reloads when the period changes', async () => {
    mockLoad
      .mockResolvedValueOnce(buildSummary({ period: 30 }))
      .mockResolvedValueOnce(buildSummary({ period: 7, sessions: [] }));

    render(<ExerciseHistoryRoute />);

    await act(async () => {
      expoRouterMock.__triggerFocus();
    });

    await waitFor(() => {
      expect(mockLoad).toHaveBeenCalledWith({
        exerciseDefinitionId: 'ex-bench',
        period: 30,
        tagDefinitionId: null,
      });
    });

    fireEvent.press(screen.getByTestId('exercise-history-period-chip-7'));

    await waitFor(() => {
      expect(mockLoad).toHaveBeenLastCalledWith({
        exerciseDefinitionId: 'ex-bench',
        period: 7,
        tagDefinitionId: null,
      });
    });
  });

  it('routes a session card tap to /completed-session/<sessionId>', async () => {
    mockLoad.mockResolvedValueOnce(buildSummary());
    render(<ExerciseHistoryRoute />);

    await act(async () => {
      expoRouterMock.__triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByTestId('exercise-history-session-card-se-newest')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('exercise-history-session-card-se-newest'));
    expect(expoRouterMock.__mockPush).toHaveBeenCalledWith('/completed-session/session-newest');
  });

  it('surfaces an error when loadExercisePerformanceHistory returns null', async () => {
    mockLoad.mockResolvedValueOnce(null);
    render(<ExerciseHistoryRoute />);

    await act(async () => {
      expoRouterMock.__triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByTestId('exercise-history-error-state')).toHaveTextContent(/Exercise not found/);
    });
  });

  it('renders the missing-id error state when exerciseDefinitionId is absent from the route', async () => {
    expoRouterMock.__setSearchParams({});
    render(<ExerciseHistoryRoute />);

    await act(async () => {
      expoRouterMock.__triggerFocus();
    });

    expect(mockLoad).not.toHaveBeenCalled();
    expect(screen.getByTestId('exercise-history-error-state')).toHaveTextContent(
      /Missing exerciseDefinitionId/
    );
  });
});

describe('ExerciseHistoryScreenShell — deleted tag visibility', () => {
  it('still renders a chip for a tag that was assigned in this period but later soft-deleted', () => {
    const summary = buildSummary({
      tagOptions: [
        {
          tagDefinitionId: 'tag-old',
          name: 'Old grip',
          deletedAt: new Date('2026-04-01T00:00:00.000Z'),
          occurrenceCount: 1,
        },
      ],
    });

    render(
      <ExerciseHistoryScreenShell
        summary={summary}
        period={30}
        appliedTagDefinitionId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-tag-chip-tag-old')).toHaveTextContent(/deleted/);
  });

  it('shows the deleted-exercise banner when the exercise itself is soft-deleted', () => {
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary({ exerciseDeletedAt: new Date('2026-05-01T00:00:00.000Z') })}
        period={30}
        appliedTagDefinitionId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-deleted-banner')).toHaveTextContent(
      /has been deleted/
    );
  });
});
