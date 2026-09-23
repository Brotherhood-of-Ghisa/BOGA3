/* eslint-disable import/first */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => callback(), [callback]);
    },
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push: mockPush, replace: mockReplace, dismissTo: mockDismissTo }),
  };
});

jest.mock('@/src/data', () => ({
  completeSessionDraft: jest.fn(),
  loadLatestSessionDraftSnapshot: jest.fn(),
  loadLocalGymById: jest.fn(),
  loadRecentExerciseBlocks: jest.fn(),
  persistSessionDraftSnapshot: jest.fn(),
  setSessionDeletedState: jest.fn(),
}));

jest.mock('@/src/logging', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));

// The picker is the recorder's, covered by the recorder suites; here it only
// has to hand back a choice.
jest.mock('@/components/session-recorder/exercise-picker', () => ({
  ExercisePicker: ({
    visible,
    onSelectExercise,
  }: {
    visible: boolean;
    onSelectExercise: (id: string, name: string) => void;
  }) => {
    const { Pressable: MockPressable, Text: MockText } = jest.requireActual('react-native');
    return visible ? (
      <MockPressable onPress={() => onSelectExercise('def_row', 'Seated Row')} testID="mock-picker-choose">
        <MockText>Choose</MockText>
      </MockPressable>
    ) : null;
  },
}));

import { SessionViewScreen } from '../session/[sessionId]/index';

const data = jest.requireMock('@/src/data') as Record<string, jest.Mock>;

const set = (
  id: string,
  weightValue: string,
  repsValue: string,
  setType: string | null,
  performanceStatus: 'planned' | 'unperformed' | null = null,
  planned?: { weight: string; reps: string; setType: string }
) => ({
  id,
  weightValue,
  repsValue,
  setType,
  plannedWeightValue: planned?.weight ?? null,
  plannedRepsValue: planned?.reps ?? null,
  plannedSetType: planned?.setType ?? null,
  performanceStatus,
});

const snapshot = () => ({
  sessionId: 'session-1',
  gymId: 'gym-1',
  status: 'active' as const,
  startedAt: new Date('2026-09-23T09:00:00'),
  createdAt: new Date('2026-09-23T09:00:00'),
  updatedAt: new Date('2026-09-23T09:30:00'),
  exercises: [
    {
      id: 'bench',
      exerciseDefinitionId: 'def_bench',
      name: 'Barbell Bench Press',
      machineName: null,
      sets: [
        set('b1', '100', '10', 'warm_up'),
        set('b2', '160', '8', 'rir_2'),
        set('b3', '', '', null, 'planned', { weight: '165', reps: '5', setType: 'rir_0' }),
      ],
    },
    {
      id: 'fly',
      exerciseDefinitionId: 'def_fly',
      name: 'Cable Flys',
      machineName: null,
      sets: [set('f1', '', '', null, 'planned', { weight: '22.5', reps: '15', setType: 'rir_2' })],
    },
  ],
});

// Answers each Alert with the button labelled `answer`, recording the titles.
const answerAlerts = (answer: (title: string) => string) => {
  const titles: string[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    titles.push(title);
    const choice = answer(title);
    buttons?.find((button) => button.text === choice)?.onPress?.();
  });
  return titles;
};

describe('Session view', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockDismissTo.mockReset();
    data.loadLatestSessionDraftSnapshot.mockReset().mockImplementation(async () => snapshot());
    data.loadLocalGymById.mockReset().mockResolvedValue({ id: 'gym-1', name: 'Iron Works' });
    data.loadRecentExerciseBlocks.mockReset().mockImplementation(async ({ exerciseDefinitionId }) => ({
      exerciseDefinitionId,
      limit: null,
      blocks:
        exerciseDefinitionId === 'def_bench'
          ? [{ sessionId: 'old', completedAt: new Date(0), daysAgo: 3, sessionExerciseIds: [], estimatedOneRepMax: 190, totalVolume: 0, highestWeight: 150, workingSetCount: 1 }]
          : [],
    }));
    data.persistSessionDraftSnapshot.mockReset().mockResolvedValue({ sessionId: 'session-1' });
    data.completeSessionDraft.mockReset().mockResolvedValue({ sessionId: 'session-1' });
    data.setSessionDeletedState.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderReady = async () => {
    render(<SessionViewScreen sessionId="session-1" />);
    await screen.findByLabelText('Barbell Bench Press, 2 of 3 sets done, new 1RM record 204.3');
  };

  it('shows the summary and one read-only card per exercise, with its record band', async () => {
    await renderReady();

    expect(screen.getByLabelText('Gym Iron Works')).toBeTruthy();
    expect(screen.getByLabelText('Sets 2')).toBeTruthy();
    expect(screen.getByLabelText('Volume 2280')).toBeTruthy();
    expect(screen.getByTestId('session-view-exercise-bench-record')).toBeTruthy();
    expect(screen.getByLabelText('Cable Flys, 0 of 1 sets done')).toBeTruthy();
    expect(screen.queryByTestId('session-view-exercise-fly-record')).toBeNull();
    // Mini legends label every metric column.
    expect(screen.getAllByText('1RM').length).toBeGreaterThan(0);
  });

  it('links each card to its exercise page', async () => {
    await renderReady();
    fireEvent.press(screen.getByLabelText('Cable Flys, 0 of 1 sets done'));
    expect(mockPush).toHaveBeenCalledWith('/session/session-1/exercise/fly');
  });

  it('finishes through the recorder prompts and completion write, then opens the completion screen', async () => {
    const titles = answerAlerts((title) =>
      title.startsWith('Remove exercises') ? 'Remove empty exercises and submit' : 'unexpected'
    );
    await renderReady();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-finish-button'));
    });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/completed-session/session-1?presentation=completion')
    );
    expect(titles).toEqual(['Remove exercises with no sets and submit?']);
    // Confirmed sets only, planned columns cleared — the recorder's completed-history graph.
    const written = data.persistSessionDraftSnapshot.mock.calls.at(-1)?.[0];
    expect(written).toMatchObject({ sessionId: 'session-1', gymId: 'gym-1', status: 'active' });
    expect(written.startedAt).toEqual(new Date('2026-09-23T09:00:00'));
    expect(written.exercises).toHaveLength(1);
    expect(written.exercises[0].sets.map((row: { id: string }) => row.id)).toEqual(['b1', 'b2']);
    expect(data.completeSessionDraft).toHaveBeenCalledWith('session-1');
  });

  it('writes nothing when a finish prompt is declined', async () => {
    answerAlerts(() => 'Go back to edit session');
    await renderReady();

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-finish-button'));
    });

    expect(data.persistSessionDraftSnapshot).not.toHaveBeenCalled();
    expect(data.completeSessionDraft).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('abandons only after the destructive confirmation, then returns to Train', async () => {
    let answer = 'Keep session';
    const titles = answerAlerts(() => answer);
    await renderReady();

    fireEvent.press(screen.getByTestId('session-view-options-button'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-abandon'));
    });
    expect(titles).toEqual(['Abandon session?']);
    expect(data.setSessionDeletedState).not.toHaveBeenCalled();

    answer = 'Abandon';
    fireEvent.press(screen.getByTestId('session-view-options-button'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('session-view-abandon'));
    });
    expect(data.setSessionDeletedState).toHaveBeenCalledWith('session-1', true);
    expect(mockDismissTo).toHaveBeenCalledWith('/train');
  });

  it('adds an exercise with one empty set to the persisted draft', async () => {
    await renderReady();

    fireEvent.press(screen.getByTestId('session-view-add-exercise'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('mock-picker-choose'));
    });

    const written = data.persistSessionDraftSnapshot.mock.calls.at(-1)?.[0];
    expect(written.exercises.map((exercise: { name: string }) => exercise.name)).toEqual([
      'Barbell Bench Press',
      'Cable Flys',
      'Seated Row',
    ]);
    expect(written.exercises[2].sets).toHaveLength(1);
    expect(written.exercises[2].sets[0]).toMatchObject({ repsValue: '', weightValue: '', performanceStatus: 'unperformed' });
    // The existing sets go back unchanged.
    expect(written.exercises[0].sets.map((row: { id: string }) => row.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('says so when its session is no longer the active draft', async () => {
    data.loadLatestSessionDraftSnapshot.mockResolvedValue(null);
    render(<SessionViewScreen sessionId="session-1" />);

    expect(await screen.findByText('This session is no longer active.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('session-view-back'));
    expect(mockDismissTo).toHaveBeenCalledWith('/train');
  });

  it('shows a retryable error when the draft cannot be read', async () => {
    data.loadLatestSessionDraftSnapshot.mockRejectedValueOnce(new Error('disk'));
    render(<SessionViewScreen sessionId="session-1" />);

    fireEvent.press(await screen.findByTestId('session-view-retry'));
    expect(await screen.findByLabelText('Cable Flys, 0 of 1 sets done')).toBeTruthy();
  });
});
