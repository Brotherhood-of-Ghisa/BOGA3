import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SessionsRoute, { SessionsScreen } from '../sessions';
import {
  DEFAULT_SESSION_LIST_DATA_CLIENT,
  type SessionListDataClient,
  type SessionListItem,
} from '@/components/session-list';

const mockDismissTo = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    dismissTo: mockDismissTo,
    push: mockPush,
  }),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

const activeSession: SessionListItem = {
  id: 'active-session-1',
  startedAt: '2026-07-25T09:00:00.000Z',
  status: 'active',
  completedAt: null,
  durationSec: null,
  durationDisplay: '5m',
  gymName: null,
  exerciseCount: 1,
  setCount: 3,
  totalWeight: 0,
  deletedAt: null,
};

const completedSession: SessionListItem = {
  ...activeSession,
  id: 'completed-session-1',
  status: 'completed',
  completedAt: '2026-07-25T10:00:00.000Z',
  durationSec: 3_600,
  durationDisplay: '1h',
};

const newerCompletedSession: SessionListItem = {
  ...completedSession,
  id: 'completed-session-2',
  completedAt: '2026-07-26T10:00:00.000Z',
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const buildDataClient = (): jest.Mocked<SessionListDataClient> => ({
  loadSessions: jest.fn().mockResolvedValue([activeSession]),
  startSession: jest.fn().mockResolvedValue(undefined),
  completeActiveSession: jest.fn().mockResolvedValue(undefined),
  discardActiveSession: jest.fn().mockResolvedValue(undefined),
  setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
  appendCompletedSessionAsPlanned: jest.fn().mockResolvedValue(undefined),
});

describe('SessionsScreen active-session navigation', () => {
  beforeEach(() => {
    mockDismissTo.mockClear();
    mockPush.mockClear();
  });

  it('dismisses back to the existing recorder when resuming an active session', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} />);

    fireEvent.press(await screen.findByTestId('resume-active-session-button'));

    expect(mockDismissTo).toHaveBeenCalledWith('/session-recorder');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('routes completion through the recorder cleanup flow instead of completing directly', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} />);

    fireEvent.press(await screen.findByLabelText('Review and complete active session'));

    expect(mockDismissTo).toHaveBeenCalledWith('/session-recorder');
    expect(dataClient.completeActiveSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SessionsScreen focus-aware loading', () => {
  beforeEach(() => {
    mockDismissTo.mockClear();
    mockPush.mockClear();
  });

  it('wires the focused route to one initial repository load', async () => {
    const loadSessions = jest
      .spyOn(DEFAULT_SESSION_LIST_DATA_CLIENT, 'loadSessions')
      .mockResolvedValue([]);

    render(<SessionsRoute />);

    await waitFor(() => {
      expect(loadSessions).toHaveBeenCalledTimes(1);
    });
    loadSessions.mockRestore();
  });

  it('loads exactly once for the initial focused presentation', async () => {
    const dataClient = buildDataClient();
    const view = render(<SessionsScreen dataClient={dataClient} isFocused />);

    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });

    view.rerender(<SessionsScreen dataClient={dataClient} isFocused />);
    expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
  });

  it('loads once when an already-mounted screen blurs and regains focus', async () => {
    const dataClient = buildDataClient();
    const view = render(<SessionsScreen dataClient={dataClient} isFocused />);

    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });

    view.rerender(<SessionsScreen dataClient={dataClient} isFocused={false} />);
    expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);

    view.rerender(<SessionsScreen dataClient={dataClient} isFocused />);
    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(2);
    });
  });

  it('loads exactly once for a deleted-session filter change', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });

    fireEvent.press(screen.getByTestId('toggle-deleted-sessions-button'));

    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(2);
    });
    expect(dataClient.loadSessions.mock.calls).toEqual([
      [{ showDeletedSessions: false }],
      [{ showDeletedSessions: true }],
    ]);
  });

  it('performs one explicit refresh after a session mutation', async () => {
    const dataClient = buildDataClient();
    dataClient.loadSessions
      .mockResolvedValueOnce([activeSession])
      .mockResolvedValueOnce([]);
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    fireEvent.press(await screen.findByTestId('active-session-menu-button'));
    fireEvent.press(screen.getByTestId('discard-active-session-button'));

    await waitFor(() => {
      expect(dataClient.discardActiveSession).toHaveBeenCalledWith(activeSession.id);
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(2);
    });
  });

  it('does not let a superseded request overwrite the newer filter result', async () => {
    const firstLoad = createDeferred<SessionListItem[]>();
    const secondLoad = createDeferred<SessionListItem[]>();
    const dataClient = buildDataClient();
    dataClient.loadSessions
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise);
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });
    fireEvent.press(screen.getByTestId('toggle-deleted-sessions-button'));
    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondLoad.resolve([newerCompletedSession]);
      await secondLoad.promise;
    });
    expect(await screen.findByTestId(`completed-session-row-${newerCompletedSession.id}`)).toBeTruthy();

    await act(async () => {
      firstLoad.resolve([completedSession]);
      await firstLoad.promise;
    });
    expect(screen.getByTestId(`completed-session-row-${newerCompletedSession.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`completed-session-row-${completedSession.id}`)).toBeNull();
  });

  it('invalidates an in-flight request when the consumer unmounts', async () => {
    const lateLoad = createDeferred<SessionListItem[]>();
    const dataClient = buildDataClient();
    dataClient.loadSessions.mockImplementationOnce(() => lateLoad.promise);
    const view = render(<SessionsScreen dataClient={dataClient} isFocused />);

    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });
    view.unmount();

    await act(async () => {
      lateLoad.resolve([completedSession]);
      await lateLoad.promise;
    });
    expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
  });
});
