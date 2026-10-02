/* eslint-disable import/first */

/**
 * Exercise history. The route runs over real data: the production screen and
 * history repository over the migrated in-memory SQLite database, seeded
 * through the Maestro harness with the `exercise-block-history` fixture (eight
 * Barbell Back Squat sessions from hours to 26 days ago, at the fixture gym),
 * with list preferences set through their own store (helpers/local-data.ts).
 * A failed read is forced with `jest.spyOn` on the real module.
 *
 * The shell suites render `ExerciseHistoryScreenShell` on hand-built props for
 * presentation rules real data here cannot reach: tag chips (tags arrive only
 * by sync), the deleted-exercise banner, empty-filter copy and styling.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockScreenOptions: { headerLeft?: () => mockReact.ReactElement } = {};
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => mockCanGoBack,
  }),
  useLocalSearchParams: () => mockSearchParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

import {
  default as ExerciseHistoryRoute,
  ExerciseHistoryScreenShell,
  type ExerciseHistoryScreenShellProps,
} from '../exercise-history';
import { uiRoles } from '@/components/ui';
import type { ExerciseHistorySummary } from '@/src/data';
import * as historyRepository from '@/src/data/exercise-history';
import { upsertLocalGym } from '@/src/data/local-gyms';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import {
  __resetExerciseListPreferencesForTests,
  setExerciseListPreferences,
} from '@/src/exercise-catalog/list-preferences';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  resetLocalData,
} from './helpers/local-data';

const buildSummary = (overrides: Partial<ExerciseHistorySummary> = {}): ExerciseHistorySummary => ({
  exerciseDefinitionId: 'ex-bench',
  exerciseName: 'Bench Press',
  exerciseDeletedAt: null,
  bodyweightContribution: 0,
  period: 30,
  appliedTagDefinitionId: null,
  appliedGymId: null,
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
  gymOptions: [
    {
      gymId: 'gym-westside',
      name: 'Westside Barbell Club',
      occurrenceCount: 1,
    },
    {
      gymId: 'gym-downtown',
      name: 'Downtown Iron Temple',
      occurrenceCount: 1,
    },
  ],
  sessions: [
    {
      sessionId: 'session-newest',
      bodyWeightKg: null,
      bodyWeightSource: null,
      bodyWeightMeasurementId: null,
      bodyWeightMeasuredAt: null,
      sessionExerciseId: 'se-newest',
      completedAt: new Date('2026-05-18T16:00:00.000Z'),
      gymName: 'Westside Barbell Club',
      tagIds: ['tag-westside'],
      sets: [
        { setId: 'st-1', orderIndex: 0, weightValue: '135', repsValue: '8', setType: 'warm_up', isWorking: false },
        { setId: 'st-2', orderIndex: 1, weightValue: '185', repsValue: '6', setType: 'rir_1', isWorking: true },
      ],
      workingSetCount: 1,
      estimatedOneRepMax: 230,
      totalVolume: 185 * 8 + 185 * 6,
      topWeightSet: { weight: 185, reps: 8 },
    },
    {
      sessionId: 'session-older',
      bodyWeightKg: null,
      bodyWeightSource: null,
      bodyWeightMeasurementId: null,
      bodyWeightMeasuredAt: null,
      sessionExerciseId: 'se-older',
      completedAt: new Date('2026-05-11T16:00:00.000Z'),
      gymName: null,
      tagIds: [],
      sets: [
        { setId: 'st-3', orderIndex: 0, weightValue: '175', repsValue: '5', setType: null, isWorking: false },
      ],
      workingSetCount: 0,
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
  resetLocalData();
  __resetExerciseListPreferencesForTests();
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack = true;
  mockSearchParams = {};
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('ExerciseHistoryRoute over real data', () => {
  const SQUAT = EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const sessionCards = () =>
    screen
      .queryAllByTestId(/^exercise-history-session-card-[a-z0-9_]+$/)
      .map((node) => String(node.props.testID).replace('exercise-history-session-card-', ''));

  const openHistory = async (params: Record<string, string>, prepare?: () => Promise<void>) => {
    await loadMaestroFixture('exercise-block-history');
    await prepare?.();
    await bootLocalApp();
    mockSearchParams = params;
    render(<ExerciseHistoryRoute />);
    await waitFor(() =>
      expect(
        screen.queryByTestId('exercise-history-best-card') ?? screen.queryByTestId('exercise-history-error-state')
      ).toBeTruthy()
    );
  };

  // One more squat session, 2 days ago at another gym, through the draft → complete path.
  const logSquatElsewhere = async () => {
    const completedAt = new Date(Date.now() - 2 * DAY_MS);
    await upsertLocalGym({ id: 'gym-elsewhere', name: 'Canal Street Gym' });
    await persistSessionDraftSnapshot(
      {
        sessionId: 'history_elsewhere',
        gymId: 'gym-elsewhere',
        startedAt: new Date(completedAt.getTime() - 40 * 60 * 1000),
        exercises: [
          {
            id: 'history_elsewhere_squat',
            exerciseDefinitionId: SQUAT,
            name: 'Barbell Back Squat',
            sets: [{ id: 'history_elsewhere_set', weightValue: '200', repsValue: '5', setType: 'rir_2', performanceStatus: null }],
          },
        ],
      },
      { now: completedAt }
    );
    await completeSessionDraft('history_elsewhere', { completedAt, now: completedAt });
  };

  it('shows the all-time bests and one card per session in the period, newest first', async () => {
    await openHistory({ exerciseDefinitionId: SQUAT });

    expect(screen.getByTestId('exercise-history-period-chip-30')).toHaveProp('accessibilityState', { selected: true });
    // Eight sessions in 30 days (26 days back), the 1-day-old one with two squat blocks.
    expect(sessionCards()).toEqual([
      'maestro_m24_completion_no_pr_squat',
      'maestro_m24_completion_one_pr_squat',
      'maestro_exercise_block_history_squat_1_a',
      'maestro_exercise_block_history_squat_1_b',
      'maestro_exercise_block_history_squat_2_a',
      'maestro_exercise_block_history_squat_3_a',
      'maestro_exercise_block_history_squat_4_a',
      'maestro_exercise_block_history_squat_5_a',
      'maestro_exercise_block_history_squat_6_a',
    ]);
    // The one-PR session's 275 × 5 holds both bests.
    expect(screen.getByTestId('exercise-history-best-est-1rm-value')).toHaveTextContent('320.6');
    expect(screen.getByTestId('exercise-history-best-top-weight-value')).toHaveTextContent('275.0 × 5');
  });

  it('reloads when the period changes', async () => {
    await openHistory({ exerciseDefinitionId: SQUAT });

    fireEvent.press(screen.getByTestId('exercise-history-period-chip-7'));
    await waitFor(() => expect(sessionCards()).toHaveLength(5));

    fireEvent.press(screen.getByTestId('exercise-history-period-chip-all'));
    await waitFor(() => expect(sessionCards()).toHaveLength(9));
  });

  it('keeps to the current gym only when the preference says so', async () => {
    await openHistory(
      { exerciseDefinitionId: SQUAT, currentGymId: EXERCISE_BLOCK_HISTORY_FIXTURE.gymId },
      logSquatElsewhere
    );
    expect(sessionCards()).toContain('history_elsewhere_squat');
    screen.unmount();

    act(() => setExerciseListPreferences({ pastRecordsGymScope: 'current-gym' }));
    render(<ExerciseHistoryRoute />);
    await waitFor(() => expect(screen.queryByTestId('exercise-history-best-card')).toBeTruthy());

    await waitFor(() => expect(sessionCards()).toHaveLength(9));
    expect(sessionCards()).not.toContain('history_elsewhere_squat');
  });

  it('opens the completed session from its card and from a best', async () => {
    await openHistory({ exerciseDefinitionId: SQUAT });

    fireEvent.press(screen.getByTestId('exercise-history-session-card-maestro_exercise_block_history_squat_1_a'));
    expect(mockPush).toHaveBeenLastCalledWith('/completed-session/maestro_exercise_block_history_squat_1');

    fireEvent.press(screen.getByTestId('exercise-history-best-est-1rm'));
    expect(mockPush).toHaveBeenLastCalledWith(`/completed-session/${EXERCISE_BLOCK_HISTORY_FIXTURE.onePrCompletionSessionId}`);
  });

  it('routes the detail navigation strip through the canonical four-tab model', async () => {
    await openHistory({ exerciseDefinitionId: SQUAT });

    fireEvent.press(screen.getByTestId('top-level-tab-more'));

    expect(mockPush).toHaveBeenCalledWith('/more');
  });

  it('draws its own back arrow that pops the stack', async () => {
    await openHistory({ exerciseDefinitionId: SQUAT });

    render(mockScreenOptions.headerLeft!());
    fireEvent.press(screen.getByTestId('exercise-history-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('back falls to Progress when nothing is below it on the stack', async () => {
    mockCanGoBack = false;
    await openHistory({ exerciseDefinitionId: SQUAT });

    render(mockScreenOptions.headerLeft!());
    fireEvent.press(screen.getByTestId('exercise-history-back'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/progress');
  });

  it('says the exercise was not found for an unknown id', async () => {
    await openHistory({ exerciseDefinitionId: 'no_such_exercise' });

    expect(screen.getByTestId('exercise-history-error-state')).toHaveTextContent(/Exercise not found/);
  });

  it('renders the missing-id error state when exerciseDefinitionId is absent from the route', async () => {
    const load = jest.spyOn(historyRepository, 'loadExercisePerformanceHistory');
    await openHistory({});

    expect(load).not.toHaveBeenCalled();
    expect(screen.getByTestId('exercise-history-error-state')).toHaveTextContent(/Missing exerciseDefinitionId/);
  });

  it('shows the error state when the history read fails (a failed read)', async () => {
    jest.spyOn(historyRepository, 'loadExercisePerformanceHistory').mockRejectedValueOnce(new Error('Boom'));
    await openHistory({ exerciseDefinitionId: SQUAT });

    expect(screen.getByTestId('exercise-history-error-state')).toHaveTextContent(/Boom/);
  });
});

describe('ExerciseHistoryScreenShell', () => {
  it('renders the all-time best card and session list', () => {
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary()}
        period={30}
        appliedTagDefinitionId={null}
        appliedGymId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onSelectMainTab={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-best-est-1rm')).toHaveTextContent(/230/);
    expect(screen.getByTestId('exercise-history-best-top-weight')).toHaveTextContent(/185.*×.*8/);
    expect(screen.getByTestId('exercise-history-session-card-se-newest')).toHaveTextContent(/2026-05-18/);
    expect(screen.getByTestId('exercise-history-session-card-se-newest')).toHaveTextContent(/W-Up/);
    expect(screen.getByTestId('exercise-history-session-card-se-older')).toBeTruthy();
  });

  it('invokes onSelectTag with tagDefinitionId and toggles back to null', () => {
    const onSelectTag = jest.fn();
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary()}
        period={30}
        appliedTagDefinitionId="tag-westside"
        appliedGymId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={onSelectTag}
        onPressSession={jest.fn()}
        onSelectMainTab={jest.fn()}
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
        appliedGymId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onSelectMainTab={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-empty-state')).toHaveTextContent(
      /selected tag/
    );
  });

  it('renders empty state message tailored for gym filter when gym filter is active', () => {
    render(
      <ExerciseHistoryScreenShell
        summary={buildSummary({ sessions: [] })}
        period={7}
        appliedTagDefinitionId={null}
        appliedGymId="gym-westside"
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onSelectMainTab={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-empty-state')).toHaveTextContent(
      /this gym/
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
        appliedGymId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onSelectMainTab={jest.fn()}
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
        appliedGymId={null}
        isLoading={false}
        errorMessage={null}
        onSelectPeriod={jest.fn()}
        onSelectTag={jest.fn()}
        onPressSession={jest.fn()}
        onSelectMainTab={jest.fn()}
      />
    );

    expect(screen.getByTestId('exercise-history-deleted-banner')).toHaveTextContent(
      /has been deleted/
    );
  });
});

describe('ExerciseHistoryScreenShell — design language (DLM-T10)', () => {
  const renderShell = (overrides: Partial<ExerciseHistoryScreenShellProps> = {}) =>
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
        onSelectMainTab={jest.fn()}
        {...overrides}
      />
    );

  it('draws the all-time bests in record, labelled 1RM, and opens their session', () => {
    const onPressSession = jest.fn();
    renderShell({ onPressSession });

    expect(screen.getByTestId('exercise-history-best-est-1rm-value')).toHaveTextContent('230.0');
    expect(screen.getByTestId('exercise-history-best-est-1rm-value')).toHaveStyle({ color: uiRoles.record });
    expect(screen.getByTestId('exercise-history-best-top-weight-value')).toHaveTextContent('185.0 × 8');
    expect(screen.getByTestId('exercise-history-best-top-weight-value')).toHaveStyle({ color: uiRoles.record });
    expect(screen.getByTestId('exercise-history-best-card')).toHaveTextContent(/1RM/);
    expect(screen.queryByText(/Est\.? 1RM/)).toBeNull();

    fireEvent.press(screen.getByTestId('exercise-history-best-est-1rm'));
    expect(onPressSession).toHaveBeenCalledWith('session-newest');
  });

  it('shows a missing best as a dash that opens nothing', () => {
    renderShell({ summary: buildSummary({ allTimeBest: { estimatedOneRepMax: null, topWeight: null } }) });

    expect(screen.getByTestId('exercise-history-best-est-1rm-value')).toHaveTextContent('—');
    expect(screen.getByTestId('exercise-history-best-est-1rm-value')).toHaveStyle({ color: uiRoles.inkFaint });
  });

  it("draws each session with View Session's set rows, warm-ups included", () => {
    renderShell();

    expect(screen.getByTestId('exercise-history-set-row-st-1-values')).toHaveTextContent('135.0 × 8');
    expect(screen.getByTestId('exercise-history-set-row-st-1')).toHaveTextContent(/W-Up/);
    expect(screen.getByTestId('exercise-history-set-row-st-2')).toHaveTextContent(/RIR 1/);
    expect(screen.getByTestId('exercise-history-session-card-se-newest-count')).toHaveTextContent('2 sets');
    expect(screen.getByTestId('exercise-history-session-card-se-newest')).toHaveTextContent(/Westside Barbell Club/);
    expect(screen.getByTestId('exercise-history-session-card-se-older')).toHaveTextContent(/No gym/);
  });

  it('selects the period in a segmented control', () => {
    renderShell({ period: 'all' });

    expect(screen.getByTestId('exercise-history-period-chip-all')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('exercise-history-period-chip-30')).toHaveProp('accessibilityState', { selected: false });
  });

  it('names a deleted tag in words on a faint chip, not in a warning hue', () => {
    renderShell({
      summary: buildSummary({
        tagOptions: [
          { tagDefinitionId: 'tag-old', name: 'Old grip', deletedAt: new Date('2026-04-01T00:00:00.000Z'), occurrenceCount: 1 },
        ],
      }),
    });

    expect(screen.getByTestId('exercise-history-tag-chip-tag-old')).toHaveTextContent('Old grip (deleted) · 1');
    expect(screen.getByTestId('exercise-history-tag-chip-all')).toHaveProp('accessibilityState', { selected: true });
  });
});

it('uses ordinary strength copy while bodyweight changes only the calculation', () => {
  const summary = buildSummary({ bodyweightContribution: 1 });
  summary.sessions = [{ ...summary.sessions[0],
    loadContext: { policy: 'personal', bodyweightContribution: 1, loadInputMode: 'total_load', bodyWeightKg: 80 },
    totalVolume: null, estimatedOneRepMax: null, topWeightSet: null,
    sets: [{ ...summary.sessions[0].sets[0], weightValue: '20' }],
  }];
  summary.allTimeBest = { estimatedOneRepMax: null, topWeight: null };
  render(<ExerciseHistoryScreenShell summary={summary} period={30} appliedTagDefinitionId={null}
    isLoading={false} errorMessage={null} onSelectPeriod={jest.fn()} onSelectTag={jest.fn()}
    onPressSession={jest.fn()} onSelectMainTab={jest.fn()} />);
  expect(screen.getByTestId('exercise-history-best-est-1rm').props.accessibilityLabel).toBe('1RM —');
  expect(screen.getByTestId('exercise-history-set-row-st-1-1rm')).toHaveTextContent(/1RM.*47.7/);
  expect(screen.queryByText(/Added|BW \+|Effective load/i)).toBeNull();
  expect(screen.getByTestId('exercise-history-set-row-st-1-vol')).toHaveTextContent(/Vol.*800/);
});
