/* eslint-disable import/first */

/**
 * The Today tab. Its Progress card runs over real data: the progress read
 * over the migrated in-memory SQLite database (helpers/local-data.ts), with
 * sessions written through the app's draft → complete path, and a fixed
 * clock. Only the native database open and the router are replaced. The suite
 * runs in Europe/London (jest.config.js).
 *
 * The joined-group activity stays injected (`socialState`): the route builds
 * it from the group stream read from the server. Named states real data
 * cannot produce: a pending progress read and a failed one.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { upsertLocalGym } from '@/src/data/local-gyms';
import { completeSessionDraft, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { setSessionDeletedState } from '@/src/data/session-list';
import { GroupApiError, type StreamItem } from '@/src/groups';
import { seedTodayProgressFixture } from '@/src/maestro/today-progress-fixture';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { loadTodayProgress, type TodayProgress } from '@/src/progress-summary';

import { recordItem } from './helpers/group-record-fixtures';
import { bootLocalApp, closeLocalData, resetLocalData } from './helpers/local-data';

import { TodayScreen, type TodayScreenProps, type TodaySocialState } from '../app/(tabs)/today';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);

// Friday 16 Oct 2026, noon: this week is Mon 12 – Sun 18, last week Mon 5 – Sun 11.
const NOW = local(2026, 10, 16, 12);
const clock = () => NOW;

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

// A completed 1-hour session at Iron House from `startedAt`: bench at
// `benchKg` then squat at 100, three working sets each. A heavier bench than
// every earlier session is that session's one PR (estimated 1RM).
const logSession = async (id: string, startedAt: Date, benchKg: number) => {
  const completedAt = new Date(startedAt.getTime() + 60 * 60 * 1000);
  const sets = (exercise: string, weightValue: string) =>
    Array.from({ length: 3 }, (_, index) => ({
      id: `${id}_${exercise}_${index + 1}`,
      weightValue,
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
        { id: `${id}_bench`, exerciseDefinitionId: 'seed_barbell_bench_press', name: 'Barbell Bench Press', sets: sets('bench', String(benchKg)) },
        { id: `${id}_squat`, exerciseDefinitionId: 'seed_barbell_back_squat', name: 'Barbell Back Squat', sets: sets('squat', '100') },
      ],
    },
    { now: completedAt }
  );
  await completeSessionDraft(id, { completedAt, now: completedAt });
};

// September: one session before the 16th, one after (a PR). October: Tue 6
// and Thu 8 last week (Thu a PR), Thu 15 this week (a PR, the latest).
const logHistory = async () => {
  await logSession('sep-03', local(2026, 9, 3, 9), 100);
  await logSession('sep-20', local(2026, 9, 20, 9), 105);
  await logSession('oct-06', local(2026, 10, 6, 9), 100);
  await logSession('oct-08', local(2026, 10, 8, 9), 110);
  await logSession('oct-15', local(2026, 10, 15, 7, 12), 115);
};

const renderToday = async (props: Partial<TodayScreenProps> = {}) => {
  await bootLocalApp();
  const view = render(<TodayScreen now={clock} socialState={socialState()} {...props} />);
  await waitFor(() => expect(screen.queryByTestId('today-progress-loading')).toBeNull());
  return view;
};

const text = (testID: string) => screen.getByTestId(testID);

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

describe('Today: the Progress card over real data', () => {
  it('opens on Progress with no title, next-workout card or recents list', async () => {
    await renderToday();

    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.getByText('Progress')).toBeTruthy();
    for (const removed of ['today-training-section', 'today-recents-section', 'today-plan-unavailable', 'today-active-session-card']) {
      expect(screen.queryByTestId(removed)).toBeNull();
    }
  });

  it('shows the first-run panel with no completed session, and Open Train goes to Train', async () => {
    await bootLocalApp();
    // An active draft is not a completed session.
    await persistSessionDraftSnapshot({ sessionId: 'draft', gymId: null, startedAt: local(2026, 10, 16, 9), status: 'active', exercises: [] });
    await renderToday();

    expect(text('today-progress-empty')).toBeTruthy();
    expect(screen.getByText('Your week starts here')).toBeTruthy();
    expect(screen.queryByTestId('today-progress-card')).toBeNull();

    fireEvent.press(text('today-empty-open-train'));
    expect(mockPush).toHaveBeenCalledWith('/train');
  });

  it('counts this week against the whole of last week', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    expect(text('today-progress-week-range')).toHaveTextContent('Mon 12 – Sun 18');
    const figure = (key: string) => ({
      value: within(text(`today-progress-week-${key}`)).getByTestId(`today-progress-week-${key}-value`),
      previous: text(`today-progress-week-${key}-previous`),
      fill: text(`today-progress-week-${key}-bar-fill`),
    });

    const sessions = figure('sessions');
    expect(sessions.value).toHaveTextContent('1');
    expect(sessions.previous).toHaveTextContent('of 2 last wk');
    expect(sessions.fill).toHaveStyle({ width: '50%' });
    expect(text('today-progress-week-sessions')).toHaveProp('accessibilityLabel', 'Sessions 1, of 2 last week');

    const workingSets = figure('working-sets');
    expect(workingSets.value).toHaveTextContent('6');
    expect(workingSets.previous).toHaveTextContent('of 12 last wk');

    // Thu 15's bench beat Thu 8's: one PR, matching last week's one — a full bar.
    const prs = figure('prs');
    expect(prs.value).toHaveTextContent('1');
    expect(prs.previous).toHaveTextContent('of 1 last wk');
    expect(prs.fill).toHaveStyle({ width: '100%' });
  });

  it('compares the month so far with the previous month at the same day', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    // October: 3 sessions, 18 working sets, 2 PRs. September to the 16th: 1, 6, 0; all of it: 2, 12, 1.
    expect(screen.getByText('October so far')).toBeTruthy();
    expect(text('today-progress-month-working-sets')).toHaveTextContent('18 W/sets');
    expect(text('today-progress-month-difference')).toHaveTextContent('+12');
    expect(text('today-progress-month-pace')).toHaveTextContent("ahead of Sep's pace");
    // 18 over 16 days, across 31: 34.9 → 35.
    expect(text('today-progress-month-summary')).toHaveTextContent("On course for 35 vs Sep's 12 · 3 sessions vs 1 · 2 PRs vs 0");
    expect(text('today-progress-chart')).toHaveProp(
      'accessibilityLabel',
      'Cumulative working sets: October 18 by the 16th against September 6 by the 16th; September finished at 12. On course for 35.',
    );
    expect(text('today-progress-chart')).toHaveProp('accessibilityRole', 'image');
  });

  it('shows the latest completed session and opens it, all sessions and the Progress tab', async () => {
    await bootLocalApp();
    await logHistory();
    await renderToday();

    const row = text('today-latest-session');
    expect(row).toHaveProp(
      'accessibilityLabel',
      'Completed session on 10/15 07:12, 1h, 6 working sets, 2 exercises, at Iron House, 1 PR',
    );
    expect(text('today-latest-session-start')).toHaveTextContent('10/15 07:12');
    expect(text('today-latest-session-figures')).toHaveTextContent('6 W/sets · 2 exercises');
    expect(text('today-latest-session-exercises')).toHaveTextContent('Barbell Bench Press, Barbell Back Squat');
    expect(text('today-latest-session-prs')).toHaveTextContent('1 PR');

    fireEvent.press(row);
    fireEvent.press(text('today-all-sessions-button'));
    fireEvent.press(text('today-view-progress-button'));
    expect(mockPush.mock.calls).toEqual([['/completed-session/oct-15'], ['/sessions'], ['/progress']]);
  });

  it('reads again on focus, keeping the figures on screen, so a finished or deleted session shows', async () => {
    await bootLocalApp();
    await logHistory();
    const loadProgress = jest.fn(loadTodayProgress);
    await renderToday({ loadProgress });

    await logSession('oct-16', local(2026, 10, 16, 8), 120);
    screen.rerender(<TodayScreen isFocused={false} loadProgress={loadProgress} now={clock} socialState={socialState()} />);
    screen.rerender(<TodayScreen isFocused loadProgress={loadProgress} now={clock} socialState={socialState()} />);
    expect(screen.queryByTestId('today-progress-loading')).toBeNull();
    await waitFor(() => expect(text('today-progress-week-sessions-value')).toHaveTextContent('2'));
    expect(text('today-latest-session-start')).toHaveTextContent('10/16 08:00');

    await act(async () => {
      await setSessionDeletedState('oct-16', true);
    });
    screen.rerender(<TodayScreen isFocused={false} loadProgress={loadProgress} now={clock} socialState={socialState()} />);
    screen.rerender(<TodayScreen isFocused loadProgress={loadProgress} now={clock} socialState={socialState()} />);
    await waitFor(() => expect(text('today-latest-session-start')).toHaveTextContent('10/15 07:12'));
    expect(loadProgress).toHaveBeenCalledTimes(3);
    expect(loadProgress).toHaveBeenLastCalledWith(NOW);
  });
});

describe('Today: the today-progress harness fixture', () => {
  it('draws every part of the card, ahead of the previous month', async () => {
    await bootLocalApp();
    // Sep: every third day from the 2nd (10). Oct: every other day from the 1st to the 15th (8), and this morning.
    await expect(seedTodayProgressFixture({ now: NOW })).resolves.toMatchObject({ sessionCount: 19 });
    await renderToday();

    expect(text('today-progress-week-sessions-value')).toHaveTextContent('3');
    expect(text('today-progress-week-sessions-previous')).toHaveTextContent('of 4 last wk');
    expect(text('today-progress-week-prs-value')).toHaveTextContent('1');
    expect(text('today-progress-month-difference')).toHaveTextContent('+36');
    expect(text('today-progress-month-summary')).toHaveTextContent("On course for 157 vs Sep's 90 · 9 sessions vs 5 · 2 PRs vs 1");
    expect(text('today-latest-session-start')).toHaveTextContent('10/16 07:00');
    expect(text('today-latest-session-figures')).toHaveTextContent('9 W/sets · 3 exercises');
  });
});

describe('Today: progress read states', () => {
  it('shows loading while the first read is pending (a pending read)', async () => {
    await bootLocalApp();
    render(<TodayScreen loadProgress={() => new Promise<TodayProgress>(() => {})} now={clock} socialState={socialState()} />);

    expect(text('today-progress-loading')).toBeTruthy();
    expect(screen.getByText('Loading your progress…')).toBeTruthy();
  });

  it('reports a failed read inline and retries it (a failed read)', async () => {
    const loadProgress = jest
      .fn<Promise<TodayProgress>, [Date]>()
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce({ status: 'empty' });
    await renderToday({ loadProgress });

    expect(text('today-progress-error')).toBeTruthy();
    expect(screen.getByText('database is locked')).toBeTruthy();

    fireEvent.press(text('today-progress-error-retry'));
    await waitFor(() => expect(text('today-progress-empty')).toBeTruthy());
    expect(loadProgress).toHaveBeenCalledTimes(2);
  });

  it('does not read while unfocused', async () => {
    const loadProgress = jest.fn<Promise<TodayProgress>, [Date]>().mockResolvedValue({ status: 'empty' });
    await bootLocalApp();
    render(<TodayScreen isFocused={false} loadProgress={loadProgress} now={clock} socialState={socialState()} />);

    expect(loadProgress).not.toHaveBeenCalled();
    expect(text('today-progress-loading')).toBeTruthy();
  });
});

describe('Today: group activity (unchanged until the group card)', () => {
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
    fireEvent.press(screen.getByTestId('today-view-groups-button'));

    expect(mockPush).toHaveBeenNthCalledWith(1, '/group-session/member-1/session-1');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/groups?groupId=g1');
    expect(mockPush).toHaveBeenNthCalledWith(3, '/groups?groupId=group-2');
    expect(mockPush).toHaveBeenNthCalledWith(4, '/groups');
  });

  it('keeps signed-out and offline-without-cache group states explicit', async () => {
    await renderToday({ socialState: { status: 'signed-out' } });

    fireEvent.press(screen.getByTestId('today-social-sign-in'));
    expect(mockPush).toHaveBeenCalledWith(SIGN_IN_ROUTE);

    screen.rerender(
      <TodayScreen
        now={clock}
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

  it('keeps the auth-unavailable group panel', async () => {
    await renderToday({ socialState: { status: 'auth-unavailable' } });
    expect(screen.getByTestId('today-social-auth-unavailable')).toBeTruthy();
  });
});
