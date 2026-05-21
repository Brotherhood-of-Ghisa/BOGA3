import * as mockReact from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CompletedSessionDetailRoute from '../completed-session/[sessionId]';
import SessionListRoute from '../session-list';
import SessionRecorderScreen from '../(tabs)/session-recorder';

type MockSet = {
  id: string;
  repsValue: string;
  weightValue: string;
};

type MockExercise = {
  id: string;
  exerciseDefinitionId: string;
  name: string;
  machineName: string | null;
  sets: MockSet[];
};

type MockSession = {
  sessionId: string;
  status: 'active' | 'completed';
  gymId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationSec: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  exercises: MockExercise[];
};

let mockSearchParams: Record<string, string | undefined> = {};
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockDismissAll = jest.fn();
const mockNavigationAddListener = jest.fn(() => () => undefined);
const mockNavigationDispatch = jest.fn();

const mockSessionsById = new Map<string, MockSession>();
const mockGymNamesById = new Map<string, string>();

const formatCompactDuration = (durationSec: number | null) => {
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
};

const cloneExercises = (exercises: MockExercise[]) =>
  exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ ...set })),
  }));

const computeDurationSec = (startedAt: Date, completedAt: Date) =>
  Math.max(0, Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000));

const seedSessions = (sessions: MockSession[]) => {
  mockSessionsById.clear();
  sessions.forEach((session) => {
    mockSessionsById.set(session.sessionId, {
      ...session,
      exercises: cloneExercises(session.exercises),
    });
  });
};

const buildSession = (overrides: Partial<MockSession> & { sessionId: string }): MockSession => ({
  sessionId: overrides.sessionId,
  status: overrides.status ?? 'completed',
  gymId: overrides.gymId ?? 'gym-westside',
  startedAt: overrides.startedAt ?? new Date('2026-02-25T10:00:00.000Z'),
  completedAt:
    overrides.completedAt === undefined ? new Date('2026-02-25T10:45:00.000Z') : overrides.completedAt,
  durationSec: overrides.durationSec ?? 2700,
  deletedAt: overrides.deletedAt ?? null,
  createdAt: overrides.createdAt ?? new Date('2026-02-25T10:00:00.000Z'),
  updatedAt: overrides.updatedAt ?? new Date('2026-02-25T10:45:00.000Z'),
  exercises:
    overrides.exercises ??
    [
      {
        id: 'exercise-1',
        exerciseDefinitionId: 'sys_barbell_bench_press',
        name: 'Bench Press',
        machineName: 'Flat Bench',
        sets: [{ id: 'set-1', repsValue: '5', weightValue: '225' }],
      },
    ],
});

jest.mock('@/src/data', () => ({
  completeSessionDraft: jest.fn(async (sessionId: string) => {
    const session = mockSessionsById.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === 'completed' && session.completedAt && session.durationSec !== null) {
      return {
        sessionId,
        completedAt: session.completedAt,
        durationSec: session.durationSec,
        wasAlreadyCompleted: true,
      };
    }

    const completedAt = new Date();
    session.status = 'completed';
    session.completedAt = completedAt;
    session.durationSec = computeDurationSec(session.startedAt, completedAt);
    session.updatedAt = new Date();

    return {
      sessionId,
      completedAt,
      durationSec: session.durationSec,
      wasAlreadyCompleted: false,
    };
  }),
  formatSessionListCompactDuration: formatCompactDuration,
  listSessionExerciseAssignedTags: jest.fn().mockResolvedValue([]),
  listSessionListBuckets: jest.fn(async ({ includeDeleted }: { includeDeleted?: boolean } = {}) => {
    const allSessions = [...mockSessionsById.values()];
    const active = allSessions.find((session) => session.status === 'active' && session.deletedAt === null) ?? null;
    const completed = allSessions.filter(
      (session) => session.status === 'completed' && (includeDeleted ? true : session.deletedAt === null)
    );

    return {
      active: active
        ? {
            id: active.sessionId,
            status: 'active' as const,
            startedAt: active.startedAt,
            completedAt: null,
            durationSec: null,
            compactDuration: '0m',
            deletedAt: active.deletedAt,
            gymName: active.gymId ? (mockGymNamesById.get(active.gymId) ?? null) : null,
            exerciseCount: active.exercises.length,
            setCount: active.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
          }
        : null,
      completed: completed.map((session) => ({
        id: session.sessionId,
        status: 'completed' as const,
        startedAt: session.startedAt,
        completedAt: session.completedAt ?? session.startedAt,
        durationSec: session.durationSec ?? 0,
        compactDuration: formatCompactDuration(session.durationSec),
        deletedAt: session.deletedAt,
        gymName: session.gymId ? (mockGymNamesById.get(session.gymId) ?? null) : null,
        exerciseCount: session.exercises.length,
        setCount: session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
      })),
    };
  }),
  loadLocalGymById: jest.fn(async (gymId: string) =>
    mockGymNamesById.has(gymId) ? { id: gymId, name: mockGymNamesById.get(gymId)! } : null
  ),
  loadLatestSessionDraftSnapshot: jest.fn(async () => {
    const active = [...mockSessionsById.values()].find((session) => session.status === 'active' && session.deletedAt === null);
    if (!active) {
      return null;
    }

    return {
      sessionId: active.sessionId,
      gymId: active.gymId,
      status: 'active' as const,
      startedAt: active.startedAt,
      createdAt: active.createdAt,
      updatedAt: active.updatedAt,
      exercises: cloneExercises(active.exercises).map((exercise) => ({
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
  loadSessionSnapshotById: jest.fn(async (sessionId: string) => {
    const session = mockSessionsById.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      gymId: session.gymId,
      status: session.status,
      startedAt: new Date(session.startedAt),
      completedAt: session.completedAt ? new Date(session.completedAt) : null,
      durationSec: session.durationSec,
      deletedAt: session.deletedAt ? new Date(session.deletedAt) : null,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
      exercises: cloneExercises(session.exercises).map((exercise) => ({
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
  persistCompletedSessionSnapshot: jest.fn(async (input: any) => {
    const session = mockSessionsById.get(input.sessionId);
    if (!session) {
      throw new Error(`Session ${input.sessionId} not found`);
    }

    const startedAt = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt);
    const completedAt = input.completedAt instanceof Date ? input.completedAt : new Date(input.completedAt);
    const durationSec = computeDurationSec(startedAt, completedAt);

    session.status = 'completed';
    session.gymId = input.gymId ?? null;
    session.startedAt = startedAt;
    session.completedAt = completedAt;
    session.durationSec = durationSec;
    session.updatedAt = new Date();
    session.exercises = (input.exercises ?? []).map((exercise: any) => ({
      id: exercise.id ?? `exercise-${Math.random().toString(36).slice(2, 8)}`,
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      name: exercise.name,
      machineName: exercise.machineName ?? null,
      sets: (exercise.sets ?? []).map((set: any) => ({
        id: set.id ?? `set-${Math.random().toString(36).slice(2, 8)}`,
        repsValue: set.repsValue,
        weightValue: set.weightValue,
      })),
    }));

    return {
      sessionId: session.sessionId,
      completedAt,
      durationSec,
    };
  }),
  persistSessionDraftSnapshot: jest.fn(async (input: any) => {
    const sessionId = input.sessionId ?? `draft-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt);
    const existing = mockSessionsById.get(sessionId);
    const nextSession: MockSession = {
      sessionId,
      status: 'active',
      gymId: input.gymId ?? null,
      startedAt,
      completedAt: null,
      durationSec: null,
      deletedAt: existing?.deletedAt ?? null,
      createdAt: existing?.createdAt ?? startedAt,
      updatedAt: new Date(),
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
    mockSessionsById.set(sessionId, nextSession);
    return { sessionId };
  }),
  reopenCompletedSessionDraft: jest.fn(async (sessionId: string) => {
    const target = mockSessionsById.get(sessionId);
    if (!target) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const otherActive = [...mockSessionsById.values()].find(
      (session) => session.sessionId !== sessionId && session.status === 'active' && session.deletedAt === null
    );
    if (otherActive) {
      throw new Error(`Cannot reopen session ${sessionId} while another active or draft session exists`);
    }

    target.status = 'active';
    target.completedAt = null;
    target.durationSec = null;
    target.updatedAt = new Date();
  }),
  setSessionDeletedState: jest.fn(async (sessionId: string, isDeleted: boolean) => {
    const target = mockSessionsById.get(sessionId);
    if (!target) {
      throw new Error(`Session ${sessionId} not found`);
    }
    target.deletedAt = isDeleted ? new Date() : null;
    target.updatedAt = new Date();
  }),
  upsertLocalGym: jest.fn(async ({ id, name }: { id: string; name: string }) => {
    mockGymNamesById.set(id, name);
  }),
}));

jest.mock('@/src/data/exercise-catalog', () => ({
  listExerciseCatalogExercises: jest.fn().mockResolvedValue([
    { id: 'sys_barbell_back_squat', name: 'Barbell Squat', deletedAt: null, mappings: [] },
    { id: 'sys_barbell_bench_press', name: 'Bench Press', deletedAt: null, mappings: [] },
    { id: 'sys_romanian_deadlift', name: 'Deadlift', deletedAt: null, mappings: [] },
  ]),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useNavigation: () => ({
    addListener: mockNavigationAddListener,
    dispatch: mockNavigationDispatch,
  }),
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    dismissAll: mockDismissAll,
  }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: {
    Screen: () => null,
  },
}));

describe('completed session list/detail/edit/reopen journeys', () => {
  beforeEach(() => {
    mockSearchParams = {};
    mockPush.mockReset();
    mockReplace.mockReset();
    mockDismissTo.mockReset();
    mockDismissAll.mockReset();
    mockNavigationAddListener.mockClear();
    mockNavigationDispatch.mockReset();

    mockGymNamesById.clear();
    mockGymNamesById.set('gym-westside', 'Westside Barbell Club');
    mockGymNamesById.set('gym-garage', 'Garage Gym');
  });

  it('edits a completed session from detail and returns to a refreshed list with updated ordering and duration', async () => {
    seedSessions([
      buildSession({
        sessionId: 'completed-target',
        gymId: 'gym-westside',
        startedAt: new Date('2026-02-25T10:00:00.000Z'),
        completedAt: new Date('2026-02-25T10:45:00.000Z'),
        durationSec: 2700,
      }),
      buildSession({
        sessionId: 'completed-other',
        gymId: 'gym-garage',
        startedAt: new Date('2026-02-25T09:00:00.000Z'),
        completedAt: new Date('2026-02-25T10:48:00.000Z'),
        durationSec: 6480,
      }),
    ]);

    mockSearchParams = {};
    const list = render(<SessionListRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-row-completed-target')).toBeTruthy();
      expect(screen.getByTestId('completed-session-row-completed-other')).toBeTruthy();
    });

    const initialRows = screen.getAllByTestId(/completed-session-row-/);
    expect(initialRows[0]?.props.testID).toBe('completed-session-row-completed-other');

    fireEvent.press(screen.getByTestId('completed-session-open-button-completed-target'));
    expect(mockPush).toHaveBeenCalledWith('/completed-session/completed-target');

    list.unmount();

    mockSearchParams = { sessionId: 'completed-target' };
    const detail = render(<CompletedSessionDetailRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    mockPush.mockClear();
    fireEvent.press(screen.getByTestId('completed-session-detail-edit-button'));
    expect(mockPush).toHaveBeenCalledWith('/session-recorder?mode=completed-edit&sessionId=completed-target');

    detail.unmount();

    mockSearchParams = { mode: 'completed-edit', sessionId: 'completed-target' };
    const recorder = render(<SessionRecorderScreen />);

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeTruthy();
      expect(screen.getByTestId('completed-edit-end-time-input')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('completed-edit-end-time-input'), '2026-02-25 10:50');
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mockDismissTo).toHaveBeenCalledWith('/stats-history');
    });

    recorder.unmount();

    mockSearchParams = {};
    render(<SessionListRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-row-completed-target')).toBeTruthy();
    });

    expect(screen.queryByTestId('active-session-row-completed-target')).toBeNull();
    expect(screen.getByTestId('session-summary-completed-target-duration').props.children).toBe('50m');

    const rowsAfterSave = screen.getAllByTestId(/completed-session-row-/);
    expect(rowsAfterSave[0]?.props.testID).toBe('completed-session-row-completed-target');
  });

  it('reopens a completed session from detail and returns to a refreshed list with the same record in the active row', async () => {
    seedSessions([
      buildSession({
        sessionId: 'completed-reopen',
        startedAt: new Date('2026-02-25T10:00:00.000Z'),
        completedAt: new Date('2026-02-25T10:45:00.000Z'),
        durationSec: 2700,
      }),
    ]);

    mockSearchParams = {};
    const list = render(<SessionListRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-row-completed-reopen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-open-button-completed-reopen'));
    expect(mockPush).toHaveBeenCalledWith('/completed-session/completed-reopen');

    list.unmount();

    mockSearchParams = { sessionId: 'completed-reopen' };
    const detail = render(<CompletedSessionDetailRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
      expect(screen.getByText('Reopen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-detail-reopen-button'));

    await waitFor(() => {
      expect(mockDismissTo).toHaveBeenCalledWith('/');
    });

    detail.unmount();

    mockSearchParams = {};
    render(<SessionListRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('active-session-row-completed-reopen')).toBeTruthy();
    });

    expect(screen.queryByTestId('completed-session-row-completed-reopen')).toBeNull();
    expect(screen.getByTestId('resume-active-session-button')).toBeTruthy();
  });
});
