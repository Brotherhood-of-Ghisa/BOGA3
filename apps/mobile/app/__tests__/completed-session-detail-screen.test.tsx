import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CompletedSessionDetailRoute, {
  CompletedSessionDetailScreenShell,
  type CompletedSessionDetailDataClient,
  type CompletedSessionDetailRecord,
} from '../completed-session/[sessionId]';

let mockLocalSearchParams: Record<string, string | undefined> = {
  sessionId: 'session-completed-1',
};
const mockStackScreen = jest.fn();
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
let mockLatestFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockLocalSearchParams,
  useRouter: () => ({
    push: mockPush,
    dismissTo: mockDismissTo,
    replace: mockReplace,
  }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockLatestFocusCallback = callback;
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: {
    Screen: (props: unknown) => {
      mockStackScreen(props);
      return null;
    },
  },
  __triggerFocus: () => {
    mockLatestFocusCallback?.();
  },
}));

jest.mock('@/src/data', () => ({
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
  listSessionExerciseAssignedTags: jest.fn().mockResolvedValue([]),
  loadLocalGymById: jest.fn(),
  loadSessionSnapshotById: jest.fn(),
  appendCompletedSessionExerciseAsPlanned: jest.fn(),
  normalizeSessionSetType: (value: unknown) =>
    value === 'warm_up' || value === 'rir_0' || value === 'rir_1' || value === 'rir_2' ? value : null,
  setSessionDeletedState: jest.fn(),
}));

const {
  loadLocalGymById: mockLoadLocalGymById,
  loadSessionSnapshotById: mockLoadSessionSnapshotById,
} = jest.requireMock('@/src/data') as {
  loadLocalGymById: jest.Mock;
  loadSessionSnapshotById: jest.Mock;
};

const COMPLETED_SESSION_DETAIL_FIXTURE: CompletedSessionDetailRecord = {
  id: 'completed-under-test',
  startedAt: '2026-02-20T16:00:00.000Z',
  completedAt: '2026-02-20T16:58:00.000Z',
  durationDisplay: '58m',
  gymName: 'Westside Barbell Club',
  deletedAt: null,
  exercises: [
    {
      id: 'exercise-1',
      name: 'Bench Press',
      machineName: 'Flat Bench',
      tags: [
        { tagDefinitionId: 'tag-1', name: 'Paused', deletedAt: null },
        { tagDefinitionId: 'tag-2', name: 'Tempo', deletedAt: null },
      ],
      sets: [
        { id: 'set-1', weight: '135', reps: '8', setType: 'warm_up' },
        { id: 'set-2', weight: '185', reps: '8', setType: 'rir_0' },
        { id: 'set-3', weight: '185', reps: '6', setType: 'rir_1' },
        { id: 'set-4', weight: '185', reps: '5', setType: 'rir_2' },
      ],
    },
    {
      id: 'exercise-2',
      name: 'Lat Pulldown',
      machineName: 'Cable',
      tags: [],
      sets: [
        { id: 'set-5', weight: '120', reps: '12', setType: null },
      ],
    },
  ],
};

describe('CompletedSessionDetailScreenShell', () => {
  beforeEach(() => {
    mockLoadLocalGymById.mockReset();
    mockLoadSessionSnapshotById.mockReset();
    mockStackScreen.mockReset();
    mockPush.mockReset();
    mockDismissTo.mockReset();
    mockReplace.mockReset();
    mockLatestFocusCallback = null;
  });

  it('renders loading then a recorder-like read-only detail on success', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    expect(screen.getByTestId('completed-session-detail-loading')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByText('End')).toBeTruthy();
    expect(screen.getByText('Duration')).toBeTruthy();
    expect(screen.getByText('Location')).toBeTruthy();
    expect(screen.queryByText('Date and Time')).toBeNull();
    expect(screen.queryByText('Gym')).toBeNull();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-reopen-button')).toBeNull();
    expect(screen.getAllByText('Append')).toHaveLength(2);
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-screen').props.stickyHeaderIndices).toEqual([0]);
    expect(screen.getByTestId('completed-session-detail-sets-table-header-exercise-1')).toBeTruthy();
    expect(screen.getAllByText('Weight').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reps').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Effort').length).toBeGreaterThan(0);
    expect(screen.getByText('W-Up')).toBeTruthy();
    expect(screen.getByText('RIR 0')).toBeTruthy();
    expect(screen.getByText('RIR 1')).toBeTruthy();
    expect(screen.getByText('RIR 2')).toBeTruthy();
    expect(screen.getByText('-')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Flat Bench')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-tags-exercise-1')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Tempo')).toBeTruthy();
    expect(screen.getAllByText('185').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8').length).toBeGreaterThan(0);
    expect(screen.getByText('58m')).toBeTruthy();
  });

  it('does not render tag chips when an exercise has no assigned tags', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        exercises: COMPLETED_SESSION_DETAIL_FIXTURE.exercises.map((exercise) => ({
          ...exercise,
          tags: [],
        })),
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.queryByTestId('completed-session-detail-tags-exercise-1')).toBeNull();
  });

  it('edit action navigates to the recorder completed-edit UI', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByText('Edit')).toBeTruthy();

    fireEvent.press(screen.getByTestId('completed-session-detail-edit-button'));

    expect(mockPush).toHaveBeenCalledWith('/session-recorder?mode=completed-edit&sessionId=completed-under-test');
  });

  it('per-exercise append action calls the data client and opens the recorder', async () => {
    const mockAppendCompletedSessionExercise = jest.fn().mockResolvedValue(undefined);
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
      }),
      appendCompletedSessionExerciseAsPlanned: mockAppendCompletedSessionExercise,
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1'));

    await waitFor(() => {
      expect(mockAppendCompletedSessionExercise).toHaveBeenCalledWith('completed-under-test', 'exercise-1');
      expect(mockPush).toHaveBeenCalledWith('/session-recorder');
    });
  });

  it('renders one append action for each exercise block', async () => {
    const mockAppendCompletedSessionExercise = jest.fn().mockResolvedValue(undefined);
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(COMPLETED_SESSION_DETAIL_FIXTURE),
      appendCompletedSessionExerciseAsPlanned: mockAppendCompletedSessionExercise,
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1')).toBeTruthy();
    expect(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-2')).toBeTruthy();
    expect(screen.getByLabelText('Append Bench Press block to current session')).toBeTruthy();
    expect(screen.getByLabelText('Append Lat Pulldown block to current session')).toBeTruthy();
  });

  it('shows non-destructive feedback when append fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockRejectedValue(new Error('Unable to append now')),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-detail-append-exercise-button-exercise-1'));

    await waitFor(() => {
      expect(screen.getByText('Unable to append now')).toBeTruthy();
    });
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
  });

  it('reloads the completed session when the detail screen regains focus', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest
        .fn()
        .mockResolvedValueOnce(COMPLETED_SESSION_DETAIL_FIXTURE)
        .mockResolvedValueOnce({
          ...COMPLETED_SESSION_DETAIL_FIXTURE,
          gymName: 'Updated Gym',
        }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };
    const { __triggerFocus: triggerFocus } = jest.requireMock('expo-router') as {
      __triggerFocus: () => void;
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByText('Westside Barbell Club')).toBeTruthy();
    });

    act(() => {
      triggerFocus();
    });

    await waitFor(() => {
      expect(screen.getByText('Updated Gym')).toBeTruthy();
    });
  });

  it('delete and undelete persist through the data client and update the action label', async () => {
    const mockSetCompletedSessionDeletedState = jest.fn().mockResolvedValue(undefined);
    const dataClient: CompletedSessionDetailDataClient & {
      setCompletedSessionDeletedState: jest.Mock;
    } = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: null,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: mockSetCompletedSessionDeletedState,
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    expect(screen.getByText('Delete')).toBeTruthy();
    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    await waitFor(() => {
      expect(mockSetCompletedSessionDeletedState).toHaveBeenCalledWith('completed-under-test', true);
    });
    await waitFor(() => {
      expect(screen.getByText('Undelete')).toBeTruthy();
    });
    expect(screen.queryByText('Deleting...')).toBeNull();
    expect(screen.queryByText(/viewer-only stub/i)).toBeNull();
    expect(screen.getByText('Session hidden from default history.')).toBeTruthy();

    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    await waitFor(() => {
      expect(mockSetCompletedSessionDeletedState).toHaveBeenNthCalledWith(2, 'completed-under-test', false);
    });
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByText('Session restored to default history.')).toBeTruthy();
  });

  it('disables the delete button while delete state is being persisted', async () => {
    let resolveDeleteRequest: (() => void) | undefined;
    const pendingDeleteRequest = new Promise<void>((resolve) => {
      resolveDeleteRequest = resolve;
    });

    const mockSetCompletedSessionDeletedState = jest
      .fn()
      .mockReturnValueOnce(pendingDeleteRequest)
      .mockResolvedValueOnce(undefined);

    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: null,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: mockSetCompletedSessionDeletedState,
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    const deleteButton = screen.getByTestId('completed-session-detail-delete-button');
    fireEvent.press(deleteButton);

    await waitFor(() => {
      expect(mockSetCompletedSessionDeletedState).toHaveBeenCalledWith('completed-under-test', true);
    });
    expect(screen.getByText('Deleting...')).toBeTruthy();

    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));
    expect(mockSetCompletedSessionDeletedState).toHaveBeenCalledTimes(1);

    if (!resolveDeleteRequest) {
      throw new Error('Expected delete request resolver to be set');
    }
    resolveDeleteRequest();

    await waitFor(() => {
      expect(screen.getByText('Undelete')).toBeTruthy();
    });
    expect(screen.queryByText('Deleting...')).toBeNull();
  });

  it('shows feedback and preserves the delete label when delete persistence fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue({
        ...COMPLETED_SESSION_DETAIL_FIXTURE,
        deletedAt: null,
      }),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockRejectedValue(new Error('Unable to update deleted state')),
    };

    render(<CompletedSessionDetailScreenShell sessionId="completed-under-test" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('completed-session-detail-delete-button'));

    await waitFor(() => {
      expect(screen.getByText('Unable to update deleted state')).toBeTruthy();
    });

    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.queryByText('Undelete')).toBeNull();
  });

  it('renders a stable empty state when the session is missing', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockResolvedValue(null),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="missing-session" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-empty')).toBeTruthy();
    });

    expect(screen.getByText('Session not found')).toBeTruthy();
  });

  it('renders an error state when loading fails', async () => {
    const dataClient: CompletedSessionDetailDataClient = {
      loadCompletedSession: jest.fn().mockRejectedValue(new Error('boom')),
      appendCompletedSessionExerciseAsPlanned: jest.fn().mockResolvedValue(undefined),
      setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
    };

    render(<CompletedSessionDetailScreenShell sessionId="broken-session" dataClient={dataClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-error')).toBeTruthy();
    });

    expect(screen.getByText('boom')).toBeTruthy();
  });
});

describe('CompletedSessionDetailRoute', () => {
  beforeEach(() => {
    mockLoadLocalGymById.mockReset();
    mockLoadSessionSnapshotById.mockReset();
    mockStackScreen.mockReset();
    mockPush.mockReset();
    mockDismissTo.mockReset();
    mockReplace.mockReset();
    mockLatestFocusCallback = null;
  });

  it('reads the session id from route params', async () => {
    mockLocalSearchParams = { sessionId: 'session-completed-1' };

    render(<CompletedSessionDetailRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });
    expect(screen.getByTestId('completed-session-detail-screen').props.testID).toBe('completed-session-detail-screen');
  });

  it('redirects route intent=edit to the recorder completed-edit flow', async () => {
    mockLocalSearchParams = { sessionId: 'session-completed-1', intent: 'edit' };

    render(<CompletedSessionDetailRoute />);

    expect(screen.getByTestId('completed-session-detail-edit-redirect')).toBeTruthy();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/session-recorder?mode=completed-edit&sessionId=session-completed-1');
    });
  });

  it('loads a persisted completed session by generated id via the default route data client', async () => {
    const generatedSessionId = 'generated-completed-session-id';
    mockLoadSessionSnapshotById.mockResolvedValue({
      sessionId: generatedSessionId,
      gymId: 'test-gym-1',
      status: 'completed',
      startedAt: new Date('2026-02-25T10:00:00.000Z'),
      completedAt: new Date('2026-02-25T10:45:00.000Z'),
      durationSec: 2700,
      deletedAt: null,
      createdAt: new Date('2026-02-25T10:00:00.000Z'),
      updatedAt: new Date('2026-02-25T10:45:00.000Z'),
      exercises: [
        {
          id: 'exercise-1',
          exerciseDefinitionId: 'seed_barbell_back_squat',
          name: 'Back Squat',
          machineName: 'Rack',
          sets: [
            { id: 'set-1', repsValue: '5', weightValue: '225' },
            { id: 'set-2', repsValue: '5', weightValue: '225' },
          ],
        },
      ],
    });
    mockLoadLocalGymById.mockResolvedValue({
      id: 'test-gym-1',
      name: 'Route Test Gym',
    });

    mockLocalSearchParams = { sessionId: generatedSessionId };

    render(<CompletedSessionDetailRoute />);

    await waitFor(() => {
      expect(screen.getByTestId('completed-session-detail-screen')).toBeTruthy();
    });
    expect(screen.getByText('Back Squat')).toBeTruthy();
    expect(screen.getByText('Route Test Gym')).toBeTruthy();
    expect(screen.queryByTestId('completed-session-detail-empty')).toBeNull();
    expect(mockLoadSessionSnapshotById).toHaveBeenCalledWith(generatedSessionId);
  });
});
