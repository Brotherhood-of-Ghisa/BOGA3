/* eslint-disable import/first */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import type { SessionListDataClient, SessionListItem } from '@/components/session-list';
import type { SessionEntryCoordinator } from '@/src/session-entry';
import {
  __resetNewScreensPreferenceForTests,
  setNewScreensEnabled,
} from '@/src/session-recorder/new-screens-preference';

import { TrainScreen, type TrainPlanningState } from '../(tabs)/train';

const activeSession: SessionListItem = {
  id: 'active-session',
  startedAt: '2026-09-16T09:00:00.000Z',
  status: 'active',
  completedAt: null,
  durationSec: null,
  durationDisplay: '20m',
  gymName: 'Iron House',
  exerciseCount: 2,
  setCount: 5,
  totalWeight: 0,
  deletedAt: null,
};

const dataClient = (sessions: SessionListItem[]): jest.Mocked<SessionListDataClient> => ({
  loadSessions: jest.fn().mockResolvedValue(sessions),
  startSession: jest.fn().mockResolvedValue(undefined),
  completeActiveSession: jest.fn().mockResolvedValue(undefined),
  discardActiveSession: jest.fn().mockResolvedValue(undefined),
  setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
  appendCompletedSessionAsPlanned: jest.fn().mockResolvedValue(undefined),
});

const sessionEntry = (): jest.Mocked<SessionEntryCoordinator> => ({
  startEmptyOrResume: jest
    .fn()
    .mockResolvedValue({ kind: 'started', sessionId: 'empty-session' }),
  startPlannedOrResume: jest
    .fn()
    .mockResolvedValue({ kind: 'started', sessionId: 'planned-session' }),
});

describe('Train screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    __resetNewScreensPreferenceForTests();
  });

  it('opens the session view by default, not the recorder', async () => {
    const entry = sessionEntry();
    const { unmount } = render(<TrainScreen dataClient={dataClient([activeSession])} sessionEntry={entry} />);

    fireEvent.press(await screen.findByTestId('train-resume-session-button'));
    expect(mockPush).toHaveBeenCalledWith('/session/active-session');
    unmount();

    render(<TrainScreen initialSessions={[]} sessionEntry={entry} />);
    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/empty-session'));
    expect(mockPush).not.toHaveBeenCalledWith('/session-recorder');
  });

  it('opens the recorder when the new screens setting is off', async () => {
    await setNewScreensEnabled(false);
    const entry = sessionEntry();
    const { unmount } = render(<TrainScreen dataClient={dataClient([activeSession])} sessionEntry={entry} />);

    fireEvent.press(await screen.findByTestId('train-resume-session-button'));
    expect(mockPush).toHaveBeenCalledWith('/session-recorder');
    unmount();

    render(<TrainScreen initialSessions={[]} sessionEntry={entry} />);
    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
    expect(mockPush).toHaveBeenLastCalledWith('/session-recorder');
  });

  it('replaces every new-session action with Resume when a draft exists', async () => {
    const entry = sessionEntry();
    render(
      <TrainScreen
        dataClient={dataClient([activeSession])}
        planningState={{
          status: 'ready',
          title: 'Lower body',
          detail: '4 exercises',
          materialize: jest.fn(),
          openManager: jest.fn(),
        }}
        sessionEntry={entry}
      />,
    );

    fireEvent.press(await screen.findByTestId('train-resume-session-button'));

    expect(screen.getByTestId('train-active-session-card')).toBeTruthy();
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
    expect(screen.queryByTestId('train-start-planned-button')).toBeNull();
    expect(entry.startEmptyOrResume).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/session/active-session');
  });

  it('starts one empty draft and opens its session view', async () => {
    let resolveStart!: (value: { kind: 'started'; sessionId: string }) => void;
    const entry = sessionEntry();
    entry.startEmptyOrResume.mockImplementation(
      () => new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    render(<TrainScreen initialSessions={[]} sessionEntry={entry} />);

    const action = screen.getByTestId('train-start-empty-button');
    fireEvent.press(action);
    fireEvent.press(action);

    expect(entry.startEmptyOrResume).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Starting…')).toBeTruthy();
    resolveStart({ kind: 'started', sessionId: 'empty-session' });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/empty-session'));
  });

  it('disables planned launch without relabeling it while an empty launch is running', () => {
    const entry = sessionEntry();
    entry.startEmptyOrResume.mockImplementation(() => new Promise(() => undefined));
    render(
      <TrainScreen
        initialSessions={[]}
        planningState={{
          status: 'ready',
          title: 'Upper body',
          detail: '3 exercises',
          materialize: jest.fn(),
          openManager: jest.fn(),
        }}
        sessionEntry={entry}
      />,
    );

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    expect(screen.getByTestId('train-start-planned-button')).toBeDisabled();
    expect(screen.getByTestId('train-start-planned-button')).toHaveTextContent(
      'Start planned workout',
    );
    expect(screen.getByTestId('train-start-empty-button')).toHaveTextContent('Starting…');
  });

  it('shows empty-launch failure inline and keeps the action retryable', async () => {
    const entry = sessionEntry();
    entry.startEmptyOrResume.mockRejectedValue(new Error('write failed'));
    render(<TrainScreen initialSessions={[]} sessionEntry={entry} />);

    fireEvent.press(screen.getByTestId('train-start-empty-button'));

    expect(await screen.findByTestId('train-empty-launch-error')).toHaveTextContent(
      "Couldn't start a workout. Try again.",
    );
    fireEvent.press(screen.getByTestId('train-start-empty-button'));
    await waitFor(() => expect(entry.startEmptyOrResume).toHaveBeenCalledTimes(2));
  });

  it('starts an available plan through the same coordinator and opens management', async () => {
    const entry = sessionEntry();
    const materialize = jest.fn().mockResolvedValue({ sessionId: 'planned-session' });
    const openManager = jest.fn();
    const planningState: TrainPlanningState = {
      status: 'ready',
      title: 'Upper body',
      detail: 'Bench press · Row · Pull-up',
      materialize,
      openManager,
    };
    render(
      <TrainScreen
        initialSessions={[]}
        planningState={planningState}
        sessionEntry={entry}
      />,
    );

    fireEvent.press(screen.getByTestId('train-start-planned-button'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/planned-session'));
    expect(entry.startPlannedOrResume).toHaveBeenCalledWith(materialize);

    fireEvent.press(screen.getByTestId('train-manage-planning-button'));
    expect(openManager).toHaveBeenCalledTimes(1);
  });

  it('keeps planned-launch failure inline without disabling empty training', async () => {
    const entry = sessionEntry();
    entry.startPlannedOrResume.mockRejectedValue(new Error('stale plan'));
    render(
      <TrainScreen
        initialSessions={[]}
        planningState={{
          status: 'ready',
          title: 'Upper body',
          detail: '3 exercises',
          materialize: jest.fn(),
          openManager: jest.fn(),
        }}
        sessionEntry={entry}
      />,
    );

    fireEvent.press(screen.getByTestId('train-start-planned-button'));

    expect(await screen.findByTestId('train-planned-launch-error')).toHaveTextContent(
      "Couldn't start this planned workout. Try again.",
    );
    expect(screen.getByTestId('train-start-empty-button')).not.toBeDisabled();
  });

  it('states the missing planning dependency without blocking empty training', () => {
    render(<TrainScreen initialSessions={[]} sessionEntry={sessionEntry()} />);

    expect(screen.getByTestId('train-planning-unavailable')).toBeTruthy();
    expect(screen.getByText('Watch this space 👀')).toBeTruthy();
    expect(screen.getByTestId('train-start-empty-button')).not.toBeDisabled();
    expect(screen.queryByTestId('train-manage-planning-button')).toBeNull();
  });

  it('does not offer a new workout when active-session detection fails', async () => {
    const client = dataClient([]);
    client.loadSessions
      .mockRejectedValueOnce(new Error('Unable to read sessions'))
      .mockResolvedValueOnce([]);
    render(<TrainScreen dataClient={client} sessionEntry={sessionEntry()} />);

    expect(await screen.findByTestId('train-session-error')).toBeTruthy();
    expect(screen.queryByTestId('train-start-empty-button')).toBeNull();
    fireEvent.press(screen.getByTestId('train-session-error-retry'));

    await waitFor(() => expect(client.loadSessions).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('train-start-empty-button')).toBeTruthy();
  });
});
