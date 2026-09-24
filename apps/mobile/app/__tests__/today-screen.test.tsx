/* eslint-disable import/first */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import type { SessionListDataClient, SessionListItem } from '@/components/session-list';
import { GroupApiError, type StreamItem } from '@/src/groups';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import type { SessionEntryCoordinator } from '@/src/session-entry';

import { recordItem } from './helpers/group-record-fixtures';

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

const linkItem: StreamItem = {
  kind: 'link',
  key: 'link-1',
  sort_at_ms: Date.parse('2026-09-16T11:00:00.000Z'),
  event: 'link',
  group: { group_id: 'group-3', name: 'Evening Crew' },
  member: { user_id: 'member-4', username: 'Dana' },
  group_exercise: {
    group_exercise_id: 'group-exercise-1',
    name: 'Bench Press',
    load_input_mode: 'total_load',
  },
  exercises: [{ exercise_definition_id: 'exercise-1', name: 'Bench Press' }],
  effects: [],
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

const sessionEntry = (): jest.Mocked<
  Pick<SessionEntryCoordinator, 'startPlannedOrResume'>
> => ({
  startPlannedOrResume: jest
    .fn()
    .mockResolvedValue({ kind: 'started', sessionId: 'planned-session' }),
});

describe('Today screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('promotes an active session and replaces the planned-session action', async () => {
    const materialize = jest.fn();
    const entry = sessionEntry();
    render(
      <TodayScreen
        dataClient={dataClient([activeSession])}
        planState={{
          status: 'ready',
          title: 'Lower body',
          detail: '4 exercises',
          materialize,
        }}
        sessionEntry={entry}
        socialState={socialState()}
      />,
    );

    fireEvent.press(await screen.findByTestId('today-resume-session-button'));

    expect(screen.getByTestId('today-active-session-card')).toBeTruthy();
    // "Current" rides the ring glyph and the words, not a success colour (G3).
    expect(screen.getByTestId('today-active-session-glyph', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('today-start-planned-session-button')).toBeNull();
    expect(entry.startPlannedOrResume).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/session/active-1');
  });

  it('starts a ready plan once while its materializer is in flight', async () => {
    let resolveStart!: (value: { kind: 'started'; sessionId: string }) => void;
    const entry = sessionEntry();
    entry.startPlannedOrResume.mockImplementation(
      () => new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    const materialize = jest.fn().mockResolvedValue({ sessionId: 'planned-session' });
    const planState: TodayPlanState = {
      status: 'ready',
      title: 'Upper body',
      detail: 'Bench press · Row · Pull-up',
      materialize,
    };
    render(
      <TodayScreen
        initialSessions={[]}
        planState={planState}
        sessionEntry={entry}
        socialState={socialState()}
      />,
    );

    const action = screen.getByTestId('today-start-planned-session-button');
    fireEvent.press(action);
    fireEvent.press(action);

    expect(entry.startPlannedOrResume).toHaveBeenCalledTimes(1);
    expect(entry.startPlannedOrResume).toHaveBeenCalledWith(materialize);
    expect(screen.getByText('Starting…')).toBeTruthy();
    resolveStart({ kind: 'started', sessionId: 'planned-session' });
    await waitFor(() => expect(screen.getByText('Start planned workout')).toBeTruthy());
    expect(mockPush).toHaveBeenCalledWith('/session/planned-session');
  });

  it('keeps a failed planned launch retryable and inline', async () => {
    const entry = sessionEntry();
    entry.startPlannedOrResume.mockRejectedValue(new Error('materialization failed'));
    const materialize = jest.fn().mockResolvedValue({ sessionId: 'planned-session' });
    render(
      <TodayScreen
        initialSessions={[]}
        planState={{
          status: 'ready',
          title: 'Upper body',
          detail: '3 exercises',
          materialize,
        }}
        sessionEntry={entry}
        socialState={socialState()}
      />,
    );

    fireEvent.press(screen.getByTestId('today-start-planned-session-button'));

    expect(await screen.findByTestId('today-plan-launch-error')).toHaveTextContent(
      "Couldn't start this planned session. Try again.",
    );
    fireEvent.press(screen.getByTestId('today-start-planned-session-button'));
    await waitFor(() => expect(entry.startPlannedOrResume).toHaveBeenCalledTimes(2));
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
    expect(
      screen.getByTestId('today-recent-session-session-4').props.accessibilityLabel,
    ).toBe('Completed session on 9/16 10:00, 1h, 6 sets, 2 exercises, at Iron House');
    expect(
      screen.getByTestId('today-recent-session-session-4').props.accessibilityLabel,
    ).not.toContain('session-4');

    fireEvent.press(screen.getByTestId('today-recent-session-session-4'));
    fireEvent.press(screen.getByTestId('today-view-progress-button'));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/completed-session/session-4');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/progress');
  });

  it('bounds joined-group activity to sessions, records and membership changes', () => {
    render(
      <TodayScreen
        initialSessions={[]}
        socialState={socialState([
          linkItem,
          streamSession('member-1:session-1', 'member-1', 'session-1'),
          recordItem({ member: { user_id: 'member-1', username: 'Alex' }, session_id: 'session-1' }),
          membershipItem,
          streamSession('member-3:session-3', 'member-3', 'session-3'),
        ])}
      />,
    );

    expect(screen.getByTestId('group-stream-session-card-member-1:session-1')).toBeTruthy();
    expect(screen.getByTestId('group-stream-record-card-ev-record-1')).toBeTruthy();
    expect(screen.getByTestId('group-stream-membership-membership-1:joined')).toBeTruthy();
    expect(screen.queryByTestId('group-stream-link-link-1')).toBeNull();
    expect(screen.queryByTestId('group-stream-session-card-member-3:session-3')).toBeNull();
    // Read-only on Today: certifying happens on the Groups screen.
    expect(screen.queryByTestId('group-stream-record-card-ev-record-1-certify')).toBeNull();

    fireEvent.press(screen.getByTestId('group-stream-session-card-member-1:session-1'));
    fireEvent.press(screen.getByTestId('group-stream-record-card-ev-record-1-open'));
    fireEvent.press(screen.getByTestId('group-stream-membership-membership-1:joined'));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/group-session/member-1/session-1');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/groups?groupId=g1');
    expect(mockPush).toHaveBeenNthCalledWith(3, '/groups?groupId=group-2');
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
    expect(screen.getByText('Watch this space 👀')).toBeTruthy();
    fireEvent.press(screen.getByTestId('today-open-train-button'));
    expect(mockPush).toHaveBeenCalledWith('/train');
  });
});
