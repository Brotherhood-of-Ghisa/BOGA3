import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SessionListRoute from '../session-list';
import SessionRecorderScreen from '../(tabs)/session-recorder';

type DraftStore = {
  sessionId: string;
  startedAt: Date;
  gymId: string | null;
  exercises: {
    id: string;
    exerciseDefinitionId: string;
    name: string;
    machineName: string | null;
    sets: { id: string; repsValue: string; weightValue: string }[];
  }[];
} | null;

let mockDraftStore: DraftStore = null;
let mockSessionCounter = 0;
const mockGymNamesById = new Map<string, string>();

jest.mock('@/src/data', () => ({
  completeSessionDraft: jest.fn().mockResolvedValue({
    sessionId: 'mock-complete',
    completedAt: new Date('2026-02-24T00:00:00.000Z'),
    durationSec: 0,
    wasAlreadyCompleted: false,
  }),
  formatSessionListCompactDuration: (durationSec: number | null) => {
    if (!durationSec || durationSec <= 0) {
      return '0m';
    }
    const totalMinutes = Math.floor(durationSec / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${totalMinutes}m`;
    if (minutes <= 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  },
  listSessionListBuckets: jest.fn(async () => {
    if (!mockDraftStore) {
      return { active: null, completed: [] };
    }

    return {
      active: {
        id: mockDraftStore.sessionId,
        status: 'active',
        startedAt: mockDraftStore.startedAt,
        completedAt: null,
        durationSec: null,
        compactDuration: '0m',
        deletedAt: null,
        gymName: mockDraftStore.gymId ? (mockGymNamesById.get(mockDraftStore.gymId) ?? null) : null,
        exerciseCount: mockDraftStore.exercises.length,
        setCount: mockDraftStore.exercises.reduce((total, exercise) => total + exercise.sets.length, 0),
      },
      completed: [],
    };
  }),
  loadLocalGymById: jest.fn(async (gymId: string) =>
    gymId && mockGymNamesById.has(gymId) ? { id: gymId, name: mockGymNamesById.get(gymId)! } : null
  ),
  loadSessionSnapshotById: jest.fn().mockResolvedValue(null),
  persistCompletedSessionSnapshot: jest.fn().mockResolvedValue({
    sessionId: 'mock-complete',
    completedAt: new Date('2026-02-24T00:00:00.000Z'),
    durationSec: 0,
  }),
  reopenCompletedSessionDraft: jest.fn().mockResolvedValue(undefined),
  loadLatestSessionDraftSnapshot: jest.fn(async () => {
    if (!mockDraftStore) {
      return null;
    }

    return {
      sessionId: mockDraftStore.sessionId,
      gymId: mockDraftStore.gymId,
      status: 'active',
      startedAt: mockDraftStore.startedAt,
      createdAt: mockDraftStore.startedAt,
      updatedAt: mockDraftStore.startedAt,
      exercises: mockDraftStore.exercises.map((exercise) => ({
        id: exercise.id,
        exerciseDefinitionId: exercise.exerciseDefinitionId,
        name: exercise.name,
        machineName: exercise.machineName,
        sets: exercise.sets.map((set) => ({
          id: set.id,
          repsValue: set.repsValue,
          weightValue: set.weightValue,
        })),
      })),
    };
  }),
  persistSessionDraftSnapshot: jest.fn(async (input: any) => {
    const sessionId = input.sessionId ?? `draft-session-${++mockSessionCounter}`;
    const startedAt = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt);
    mockDraftStore = {
      sessionId,
      startedAt,
      gymId: input.gymId ?? null,
      exercises: (input.exercises ?? []).map((exercise: any) => ({
        id: exercise.id ?? `exercise-${Math.random().toString(36).slice(2, 8)}`,
        exerciseDefinitionId: exercise.exerciseDefinitionId,
        name: exercise.name,
        machineName: exercise.machineName ?? null,
        sets: (exercise.sets ?? []).map((set: any) => ({
          id: set.id ?? `set-${Math.random().toString(36).slice(2, 8)}`,
          repsValue: set.repsValue,
          weightValue: set.weightValue,
        })),
      })),
    };
    return { sessionId };
  }),
  upsertLocalGym: jest.fn(async ({ id, name }: { id: string; name: string }) => {
    mockGymNamesById.set(id, name);
  }),
  setSessionDeletedState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogExercises: jest.fn().mockResolvedValue([
    { id: 'sys_barbell_back_squat', name: 'Barbell Squat', deletedAt: null, mappings: [] },
    { id: 'sys_barbell_bench_press', name: 'Bench Press', deletedAt: null, mappings: [] },
    { id: 'sys_romanian_deadlift', name: 'Deadlift', deletedAt: null, mappings: [] },
  ]),
  listExerciseCatalogMuscleGroups: jest.fn().mockResolvedValue([]),
}));

jest.mock('expo-router', () => {
  const mockPush = jest.fn();
  return {
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ addListener: jest.fn(() => () => undefined), dispatch: jest.fn() }),
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      const React = jest.requireActual('react');
      React.useEffect(() => callback(), [callback]);
    },
    __mockPush: mockPush,
  };
});

const { __mockPush: mockPush } = jest.requireMock('expo-router') as {
  __mockPush: jest.Mock;
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('session list -> recorder -> back journey', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T12:00:00.000Z'));
    mockDraftStore = null;
    mockSessionCounter = 0;
    mockGymNamesById.clear();
    mockPush.mockReset();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('shows the active session with correct exercise/set counts after editing and returning to the list', async () => {
    const list = render(<SessionListRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('start-session-button')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('start-session-button'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/session-recorder');
    });

    list.unmount();

    const recorder = render(<SessionRecorderScreen />);
    await act(async () => {
      await flushMicrotasks();
    });

    fireEvent.press(screen.getByText('Choose gym'));
    fireEvent.press(screen.getByLabelText('Select gym Westside Barbell Club'));
    fireEvent.press(screen.getByText('Log new exercise'));
    fireEvent.press(await screen.findByLabelText('Select exercise Barbell Squat'));
    fireEvent.changeText(screen.getByLabelText('Weight for exercise 1 set 1'), '225');
    fireEvent.changeText(screen.getByLabelText('Reps for exercise 1 set 1'), '5');

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();
    });

    await act(async () => {
      recorder.unmount();
      await flushMicrotasks();
    });

    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000);
      await flushMicrotasks();
    });

    render(<SessionListRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('resume-active-session-button')).toBeTruthy();
    });

    expect(screen.getByTestId('session-summary-draft-session-1-sets').props.children).toBe('1 sets');
    expect(screen.getByTestId('session-summary-draft-session-1-exercises').props.children).toBe('1 exercise');
    expect(screen.getByTestId('session-summary-draft-session-1-duration').props.children).toBe('5m');
    expect(screen.getByTestId('session-summary-draft-session-1-gym').props.children).toBe('Westside Barbell Club');
    expect(screen.queryByTestId('start-session-button')).toBeNull();
  });
});
