/* eslint-disable import/first */

/**
 * The Today tab. Its training half runs over real data: the session-list
 * client and the shared session-entry coordinator over the migrated in-memory
 * SQLite database (helpers/local-data.ts), with sessions written through the
 * app's draft → complete path. Only the native database open and the router
 * are replaced.
 *
 * Two inputs stay injected as props, as the route builds them from sources
 * outside the local database: the joined-group activity (`socialState`, the
 * group stream read from the server) and the plan (`planState`; planning has
 * no data source yet), whose materializer writes a real draft. Named states
 * real data cannot produce: a plan launch still pending, a failed plan write
 * and a failed session read.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { DEFAULT_SESSION_LIST_DATA_CLIENT } from '@/components/session-list';
import { upsertLocalGym } from '@/src/data/local-gyms';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { listSessionListBuckets, setSessionDeletedState } from '@/src/data/session-list';
import { GroupApiError, type StreamItem } from '@/src/groups';
import { SESSION_VIEW_FIXTURE } from '@/src/maestro/session-view-fixture';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import type { SessionEntryCoordinator } from '@/src/session-entry';

import { recordItem } from './helpers/group-record-fixtures';
import { bootLocalApp, closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';

import {
  TodayScreen,
  type TodayPlanState,
  type TodayScreenProps,
  type TodaySocialState,
} from '../(tabs)/today';

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

// A plan's materializer: writes the planned draft through the app's own path.
const plannedDraft = () =>
  persistSessionDraftSnapshot({
    sessionId: 'planned-session',
    gymId: null,
    startedAt: new Date(),
    status: 'active',
    exercises: [],
  });

const readyPlan = (materialize: () => Promise<{ sessionId: string }> = jest.fn(plannedDraft)): TodayPlanState => ({
  status: 'ready',
  title: 'Upper body',
  detail: 'Bench press · Row · Pull-up',
  materialize,
});

// A completed 1-hour session at Iron House, 09:00–10:00 local time on `day`:
// two exercises, six sets. Local instants: the list labels read the device
// clock, so the expected stamps hold in every zone the suite runs in.
const logSession = async (id: string, day: number) => {
  const startedAt = new Date(2026, 8, day, 9, 0);
  const completedAt = new Date(2026, 8, day, 10, 0);
  const sets = (exercise: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${id}_${exercise}_${index + 1}`,
      weightValue: '100',
      repsValue: '5',
      setType: 'rir_2' as const,
      performanceStatus: null,
    }));
  await upsertLocalGym({ id: 'iron-house', name: 'Iron House' });
  await persistSessionDraftSnapshot(
    {
      sessionId: id,
      gymId: 'iron-house',
      startedAt,
      exercises: [
        { id: `${id}_bench`, exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Barbell Bench Press', sets: sets('bench', 3) },
        { id: `${id}_squat`, exerciseDefinitionId: 'seed_barbell_back_squat', name: 'Barbell Back Squat', sets: sets('squat', 3) },
      ],
    },
    { now: completedAt }
  );
  await completeSessionDraft(id, { completedAt, now: completedAt });
};

const renderToday = async (props: Partial<TodayScreenProps> = {}) => {
  await bootLocalApp();
  render(<TodayScreen dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT} socialState={socialState()} {...props} />);
  await waitFor(() => expect(screen.queryByTestId('today-recents-loading')).toBeNull());
};

const activeSessionId = async () => (await listSessionListBuckets()).active?.id ?? null;

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Today: training over real data', () => {
  it('promotes the workout in progress and replaces the planned-session action', async () => {
    const plan = readyPlan();
    await loadMaestroFixture('session-view');
    await renderToday({ planState: plan });

    fireEvent.press(screen.getByTestId('today-resume-session-button'));

    expect(screen.getByTestId('today-active-session-card')).toBeTruthy();
    // "Current" rides the ring glyph and the words, not a success colour (G3).
    expect(screen.getByTestId('today-active-session-glyph', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('today-start-planned-session-button')).toBeNull();
    expect(plan.status === 'ready' && plan.materialize).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(`/session/${SESSION_VIEW_FIXTURE.sessionId}`);
  });

  it('starts a ready plan once on a double tap and opens its session', async () => {
    const plan = readyPlan();
    await renderToday({ planState: plan });

    const action = screen.getByTestId('today-start-planned-session-button');
    fireEvent.press(action);
    fireEvent.press(action);
    expect(screen.getByText('Starting…')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Start planned workout')).toBeTruthy());
    expect(plan.status === 'ready' && plan.materialize).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/session/planned-session');
    expect(await activeSessionId()).toBe('planned-session');
  });

  it('keeps a failed planned launch retryable and inline (a failed plan write)', async () => {
    const materialize = jest.fn().mockRejectedValueOnce(new Error('materialization failed')).mockImplementation(plannedDraft);
    await renderToday({ planState: readyPlan(materialize) });

    fireEvent.press(screen.getByTestId('today-start-planned-session-button'));

    expect(await screen.findByTestId('today-plan-launch-error')).toHaveTextContent(
      "Couldn't start this planned session. Try again.",
    );
    expect(await activeSessionId()).toBeNull();

    fireEvent.press(screen.getByTestId('today-start-planned-session-button'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/planned-session'));
    expect(materialize).toHaveBeenCalledTimes(2);
  });

  it('shows a bounded newest-first recent snapshot and opens existing destinations', async () => {
    await logSession('session-1', 13);
    await logSession('session-4', 16);
    await logSession('session-2', 14);
    await logSession('session-3', 15);
    await renderToday();

    expect(screen.getByTestId('today-recent-session-session-4')).toBeTruthy();
    expect(screen.getByTestId('today-recent-session-session-3')).toBeTruthy();
    expect(screen.getByTestId('today-recent-session-session-2')).toBeTruthy();
    expect(screen.queryByTestId('today-recent-session-session-1')).toBeNull();
    expect(screen.getByTestId('today-recent-session-session-4').props.accessibilityLabel).toBe(
      'Completed session on 9/16 10:00, 1h, 6 sets, 2 exercises, at Iron House',
    );
    expect(screen.getByTestId('today-recent-session-session-4').props.accessibilityLabel).not.toContain('session-4');
    expect(screen.getByTestId('today-recent-session-summary-session-4-start')).toHaveTextContent('9/16 09:00');

    fireEvent.press(screen.getByTestId('today-recent-session-session-4'));
    fireEvent.press(screen.getByTestId('today-view-progress-button'));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/completed-session/session-4');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/progress');
  });

  it('leaves deleted sessions out of the recent snapshot', async () => {
    await logSession('session-1', 13);
    await logSession('session-2', 14);
    await logSession('session-3', 15);
    await setSessionDeletedState('session-3', true);
    await renderToday();

    expect(screen.queryByTestId('today-recent-session-session-3')).toBeNull();
    expect(screen.getByTestId('today-recent-session-session-2')).toBeTruthy();
    expect(screen.getByTestId('today-recent-session-session-1')).toBeTruthy();
  });

  it('reports a failed session read inline and retries through the client (a failed read)', async () => {
    const load = jest
      .spyOn(DEFAULT_SESSION_LIST_DATA_CLIENT, 'loadSessions')
      .mockRejectedValueOnce(new Error('Unable to read sessions'));
    await bootLocalApp();
    render(<TodayScreen dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT} socialState={socialState()} />);

    expect(await screen.findByTestId('today-recents-error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('today-recents-error-retry'));

    expect(await screen.findByTestId('today-recents-empty')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is honest when the planning dependency is unavailable', async () => {
    await renderToday();

    expect(screen.getByTestId('today-plan-unavailable')).toBeTruthy();
    expect(screen.getByText('Watch this space 👀')).toBeTruthy();
    fireEvent.press(screen.getByTestId('today-open-train-button'));
    expect(mockPush).toHaveBeenCalledWith('/train');
  });
});

describe('Today: launch and group-activity states', () => {
  it('shows Starting… while a plan launch is pending (a pending launch)', async () => {
    const pending: Pick<SessionEntryCoordinator, 'startPlannedOrResume'> = {
      startPlannedOrResume: () => new Promise(() => undefined),
    };
    await renderToday({ planState: readyPlan(), sessionEntry: pending as SessionEntryCoordinator });

    fireEvent.press(screen.getByTestId('today-start-planned-session-button'));

    expect(screen.getByText('Starting…')).toBeTruthy();
  });

  it('bounds joined-group activity to sessions, records and membership changes', async () => {
    await renderToday({
      socialState: socialState([
        linkItem,
        streamSession('member-1:session-1', 'member-1', 'session-1'),
        recordItem({ member: { user_id: 'member-1', username: 'Alex' }, session_id: 'session-1' }),
        membershipItem,
        streamSession('member-3:session-3', 'member-3', 'session-3'),
      ]),
    });

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

  it('keeps signed-out and offline-without-cache group states explicit', async () => {
    await renderToday({ socialState: { status: 'signed-out' } });

    fireEvent.press(screen.getByTestId('today-social-sign-in'));
    expect(mockPush).toHaveBeenCalledWith(SIGN_IN_ROUTE);

    screen.rerender(
      <TodayScreen
        dataClient={DEFAULT_SESSION_LIST_DATA_CLIENT}
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
});
