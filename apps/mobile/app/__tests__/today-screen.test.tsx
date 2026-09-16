/* eslint-disable import/first */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import type { SessionListDataClient, SessionListItem } from '@/components/session-list';
import { GroupApiError, type StreamItem } from '@/src/groups';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';

import {
  TodayScreen,
  type TodayPlanState,
  type TodaySocialState,
} from '../(tabs)/today';

const activeSession: SessionListItem = {
  id: 'active-1',
  startedAt: '2026-09-16T09:00:00.000Z',
  status: 'active',
  completedAt: null,
  durationSec: null,
  durationDisplay: '12m',
  gymName: 'Iron House',
  exerciseCount: 2,
  setCount: 6,
  totalWeight: 0,
  deletedAt: null,
};

const completedSession = (
  id: string,
  completedAt: string,
): SessionListItem => ({
  ...activeSession,
  id,
  status: 'completed',
  completedAt,
  durationSec: 3_600,
  durationDisplay: '1h',
});

const streamSession = (key: string, memberId: string, sessionId: string): StreamItem => ({
  kind: 'session',
  key,
  sort_at_ms: Date.parse('2026-09-16T10:00:00.000Z'),
  member: { user_id: memberId, username: 'Alex' },
  session_id: sessionId,
  groups: [{ group_id: 'group-1', name: 'Morning Crew' }],
  gym_name: 'Iron House',
  status: 'completed',
  started_at_ms: Date.parse('2026-09-16T09:00:00.000Z'),
  completed_at_ms: Date.parse('2026-09-16T10:00:00.000Z'),
  duration_sec: 3_600,
  exercises: [],
});

const membershipItem: StreamItem = {
  kind: 'membership',
  key: 'membership-1:joined',
  sort_at_ms: Date.parse('2026-09-16T08:00:00.000Z'),
  event: 'joined',
  group: { group_id: 'group-2', name: 'Lunch Lifters' },
  member: { user_id: 'member-2', username: 'Bea' },
};

const socialState = (items: StreamItem[] = []): TodaySocialState => ({
  status: 'available',
  hasData: true,
  offline: false,
  error: null,
  lastUpdatedAtMs: Date.parse('2026-09-16T10:00:00.000Z'),
  items,
  refresh: jest.fn().mockResolvedValue(undefined),
});

const dataClient = (sessions: SessionListItem[]): jest.Mocked<SessionListDataClient> => ({
  loadSessions: jest.fn().mockResolvedValue(sessions),
  startSession: jest.fn().mockResolvedValue(undefined),
  completeActiveSession: jest.fn().mockResolvedValue(undefined),
  discardActiveSession: jest.fn().mockResolvedValue(undefined),
  setCompletedSessionDeletedState: jest.fn().mockResolvedValue(undefined),
  appendCompletedSessionAsPlanned: jest.fn().mockResolvedValue(undefined),
});

describe('Today screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('promotes an active session and replaces the planned-session action', async () => {
    const startPlan = jest.fn();
    render(
      <TodayScreen
        dataClient={dataClient([activeSession])}
        planState={{
          status: 'ready',
          title: 'Lower body',
          detail: '4 exercises',
          start: startPlan,
        }}
        socialState={socialState()}
      />,
    );

    fireEvent.press(await screen.findByTestId('today-resume-session-button'));

    expect(screen.getByTestId('today-active-session-card')).toBeTruthy();
    expect(screen.queryByTestId('today-start-planned-session-button')).toBeNull();
    expect(startPlan).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/session-recorder');
  });

  it('starts a ready plan once while its materializer is in flight', async () => {
    let resolveStart!: () => void;
    const start = jest.fn(
      () => new Promise<void>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const planState: TodayPlanState = {
      status: 'ready',
      title: 'Upper body',
      detail: 'Bench press · Row · Pull-up',
      start,
    };
    render(
      <TodayScreen initialSessions={[]} planState={planState} socialState={socialState()} />,
    );

    const action = screen.getByTestId('today-start-planned-session-button');
    fireEvent.press(action);
    fireEvent.press(action);

    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Starting…')).toBeTruthy();
    resolveStart();
    await waitFor(() => expect(screen.getByText('Start planned workout')).toBeTruthy());
  });

  it('keeps a failed planned launch retryable and inline', async () => {
    const start = jest.fn().mockRejectedValue(new Error('materialization failed'));
    render(
      <TodayScreen
        initialSessions={[]}
        planState={{ status: 'ready', title: 'Upper body', detail: '3 exercises', start }}
        socialState={socialState()}
      />,
    );

    fireEvent.press(screen.getByTestId('today-start-planned-session-button'));

    expect(await screen.findByTestId('today-plan-launch-error')).toHaveTextContent(
      "Couldn't start this planned session. Try again.",
    );
    fireEvent.press(screen.getByTestId('today-start-planned-session-button'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });

  it('shows a bounded newest-first recent snapshot and opens existing destinations', () => {
    const sessions = [
      completedSession('session-1', '2026-09-13T10:00:00.000Z'),
      completedSession('session-4', '2026-09-16T10:00:00.000Z'),
      completedSession('session-2', '2026-09-14T10:00:00.000Z'),
      completedSession('session-3', '2026-09-15T10:00:00.000Z'),
    ];
    render(<TodayScreen initialSessions={sessions} socialState={socialState()} />);

    expect(screen.getByTestId('today-recent-session-session-4')).toBeTruthy();
    expect(screen.getByTestId('today-recent-session-session-3')).toBeTruthy();
    expect(screen.getByTestId('today-recent-session-session-2')).toBeTruthy();
    expect(screen.queryByTestId('today-recent-session-session-1')).toBeNull();

    fireEvent.press(screen.getByTestId('today-recent-session-session-4'));
    fireEvent.press(screen.getByTestId('today-view-progress-button'));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/completed-session/session-4');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/progress');
  });

  it('bounds joined-group activity and routes its two supported item kinds', () => {
    render(
      <TodayScreen
        initialSessions={[]}
        socialState={socialState([
          streamSession('member-1:session-1', 'member-1', 'session-1'),
          membershipItem,
          streamSession('member-3:session-3', 'member-3', 'session-3'),
        ])}
      />,
    );

    expect(screen.getByTestId('group-stream-session-card-member-1:session-1')).toBeTruthy();
    expect(screen.getByTestId('group-stream-membership-membership-1:joined')).toBeTruthy();
    expect(screen.queryByTestId('group-stream-session-card-member-3:session-3')).toBeNull();

    fireEvent.press(screen.getByTestId('group-stream-session-card-member-1:session-1'));
    fireEvent.press(screen.getByTestId('group-stream-membership-membership-1:joined'));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/group-session/member-1/session-1');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/group/group-2');
  });

  it('keeps signed-out and offline-without-cache group states explicit', () => {
    const view = render(
      <TodayScreen initialSessions={[]} socialState={{ status: 'signed-out' }} />,
    );

    fireEvent.press(screen.getByTestId('today-social-sign-in'));
    expect(mockPush).toHaveBeenCalledWith(SIGN_IN_ROUTE);

    view.rerender(
      <TodayScreen
        initialSessions={[]}
        socialState={{
          status: 'available',
          hasData: false,
          offline: true,
          error: new GroupApiError('NETWORK', 'offline'),
          lastUpdatedAtMs: null,
          items: [],
          refresh: jest.fn().mockResolvedValue(undefined),
        }}
      />,
    );

    expect(screen.getByTestId('groups-offline-banner')).toBeTruthy();
    expect(screen.getByTestId('today-social-offline-empty-state')).toBeTruthy();
  });

  it('reports session-load failure inline and retries through the existing client', async () => {
    const client = dataClient([]);
    client.loadSessions
      .mockRejectedValueOnce(new Error('Unable to read sessions'))
      .mockResolvedValueOnce([]);
    render(<TodayScreen dataClient={client} socialState={socialState()} />);

    expect(await screen.findByTestId('today-recents-error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('today-recents-error-retry'));

    await waitFor(() => expect(client.loadSessions).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('today-recents-empty')).toBeTruthy();
  });

  it('is honest when the planning dependency is unavailable', () => {
    render(<TodayScreen initialSessions={[]} socialState={socialState()} />);

    expect(screen.getByTestId('today-plan-unavailable')).toBeTruthy();
    fireEvent.press(screen.getByTestId('today-open-train-button'));
    expect(mockPush).toHaveBeenCalledWith('/train');
  });
});
