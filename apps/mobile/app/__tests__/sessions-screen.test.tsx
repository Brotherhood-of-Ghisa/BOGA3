import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

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

  it('opens the session view when resuming an active session', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} />);

    fireEvent.press(await screen.findByTestId('resume-active-session-button'));

    expect(mockPush).toHaveBeenCalledWith('/session/active-session-1');
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('routes completion through the session cleanup flow instead of completing directly', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} />);

    fireEvent.press(await screen.findByLabelText('Review and complete active session'));

    expect(mockPush).toHaveBeenCalledWith('/session/active-session-1');
    expect(dataClient.completeActiveSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dataClient.loadSessions).toHaveBeenCalledTimes(1);
    });
  });

  it('opens a completed History row in Summary', async () => {
    const dataClient = buildDataClient();
    dataClient.loadSessions.mockResolvedValue([completedSession]);
    render(<SessionsScreen dataClient={dataClient} />);

    fireEvent.press(
      await screen.findByTestId(`completed-session-open-button-${completedSession.id}`)
    );

    expect(mockPush).toHaveBeenCalledWith(`/completed-session/${completedSession.id}`);
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

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(await screen.findByTestId('active-session-menu-button'));
    fireEvent.press(screen.getByTestId('discard-active-session-button'));
    const buttons = alertSpy.mock.calls[0][2] as AlertButton[];
    await act(async () => {
      buttons.find((button) => button.text === 'Discard')?.onPress?.();
    });
    alertSpy.mockRestore();

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

describe('SessionsScreen design-language states (DLM-T10)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPush.mockReset();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  const alertButton = (text: string): AlertButton => {
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
    const button = buttons.find((candidate) => candidate.text === text);
    if (!button) {
      throw new Error(`No alert button ${text}`);
    }
    return button;
  };

  it('marks a deleted completed row with a Deleted tag once deleted sessions are shown', async () => {
    const deletedSession: SessionListItem = {
      ...completedSession,
      deletedAt: '2026-07-26T12:00:00.000Z',
    };
    const dataClient = buildDataClient();
    dataClient.loadSessions.mockResolvedValue([deletedSession]);
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    const toggle = await screen.findByTestId('toggle-deleted-sessions-button');
    expect(toggle).toHaveProp('accessibilityState', { disabled: false, checked: false });
    expect(screen.queryByTestId(`completed-session-row-${deletedSession.id}`)).toBeNull();

    fireEvent.press(toggle);

    expect(
      await screen.findByTestId(`completed-session-deleted-tag-${deletedSession.id}`)
    ).toHaveTextContent('Deleted');
    expect(screen.getByTestId('toggle-deleted-sessions-button')).toHaveProp('accessibilityState', {
      disabled: false,
      checked: true,
    });
    expect(screen.getByTestId('toggle-deleted-sessions-button')).toHaveTextContent('Hide deleted');
  });

  it('confirms before discarding the active session, and Cancel keeps it', async () => {
    const dataClient = buildDataClient();
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    fireEvent.press(await screen.findByTestId('active-session-menu-button'));
    fireEvent.press(screen.getByTestId('discard-active-session-button'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertButton('Discard').style).toBe('destructive');
    expect(alertButton('Cancel').style).toBe('cancel');

    act(() => {
      alertButton('Cancel').onPress?.();
    });
    expect(dataClient.discardActiveSession).not.toHaveBeenCalled();
    expect(screen.getByTestId(`active-session-row-${activeSession.id}`)).toBeTruthy();

    fireEvent.press(screen.getByTestId('active-session-menu-button'));
    fireEvent.press(screen.getByTestId('discard-active-session-button'));
    await act(async () => {
      alertButton('Discard').onPress?.();
    });
    expect(dataClient.discardActiveSession).toHaveBeenCalledWith(activeSession.id);
  });

  it('reloads from the load error through Retry', async () => {
    const dataClient = buildDataClient();
    dataClient.loadSessions
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValueOnce([completedSession]);
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    const error = await screen.findByTestId('session-list-load-error');
    expect(error).toHaveTextContent(/Could not load sessions/);
    expect(error).toHaveTextContent(/Database unavailable/);

    fireEvent.press(screen.getByTestId('session-list-load-error-retry'));

    expect(await screen.findByTestId(`completed-session-row-${completedSession.id}`)).toBeTruthy();
    expect(dataClient.loadSessions).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('session-list-load-error')).toBeNull();
  });

  it('opens a completed row menu as a sheet the backdrop dismisses', async () => {
    const dataClient = buildDataClient();
    dataClient.loadSessions.mockResolvedValue([completedSession]);
    render(<SessionsScreen dataClient={dataClient} isFocused />);

    fireEvent.press(await screen.findByTestId(`completed-session-menu-button-${completedSession.id}`));
    expect(screen.getByTestId('completed-session-edit-menu-action-button')).toBeTruthy();
    expect(screen.getByTestId('completed-session-modal-action-button')).toHaveTextContent('Delete');

    fireEvent.press(screen.getByTestId('completed-session-menu-backdrop', { includeHiddenElements: true }));
    expect(screen.queryByTestId('completed-session-edit-menu-action-button')).toBeNull();
  });
});
