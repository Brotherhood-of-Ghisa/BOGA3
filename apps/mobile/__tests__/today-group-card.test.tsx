/* eslint-disable import/first */

/**
 * Today's Group activity card through the production route: My groups and the
 * week summary go through the real cache-first hooks over the in-memory app
 * database (helpers/local-data.ts, so `group_cache` is real). Only the group
 * RPCs, auth, NetInfo and the router are replaced. The week summary's own
 * rules are groups-week-summary-view-model.test.ts.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

type MockNetInfoListener = (state: { isConnected: boolean | null }) => void;
let mockInitialOnline: boolean | null = null;
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: MockNetInfoListener) => {
      if (mockInitialOnline !== null) listener({ isConnected: mockInitialOnline });
      return () => undefined;
    },
  },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
  getCompetitionWeek: jest.fn(),
  getCompetitionStream: jest.fn(),
}));

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import * as groupsApi from '@/src/groups/api';
import {
  GroupApiError,
  getLastViewedGroupId,
  groupCacheKeys,
  setLastViewedGroupId,
  writeGroupCache,
  type GroupSummary,
} from '@/src/groups';
import type { CompetitionWeekSummaryWire as GroupWeekSummaryResult } from '@/src/groups/competition-wire';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { updatePreferences } from '@/src/preferences/hooks';
import { localWeekWindow } from '@/src/utils/local-calendar';
import { competitionEvent, competitionSession } from './helpers/competition-fixtures';

import { bootLocalApp, closeLocalData, resetLocalData } from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

import TodayRoute from '../app/(tabs)/today';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
const ME = 'me';

// The clock is pinned to local midday, built from local fields (spec 09), so
// every fixture instant below falls on today whatever the real time is.
const NOW = new Date(2026, 9, 6, 12, 0);

const group = (groupId: string, name: string): GroupSummary => ({
  group_id: groupId,
  name,
  description: null,
  member_count: 5,
  my_role: 'member',
  bodyweight_calculations_enabled: false,
});

const IRON = group('g1', 'Iron Wednesdays');
const LUNCH = group('g2', 'Lunch Club');

const member = (userId: string) => ({ user_id: userId, username: userId });

const summary = (overrides: Partial<GroupWeekSummaryResult> = {}): GroupWeekSummaryResult => ({
  contract_version: 4,group_id: 'g1',members: [
    { rank: 1, member: member('dave'), working_sets: 58, group_records: 3 },
    { rank: 2, member: member('maria'), working_sets: 39, group_records: 1 },
    { rank: 3, member: member('sam'), working_sets: 35, group_records: 2 },
    { rank: 4, member: member(ME), working_sets: 21, group_records: 0 },
  ],
  training_now: [],
  latest_completed: {
    member: member('dave'),
    session_id: 'dave-done',
    started_at_ms: Date.now() - 3 * 60 * 60 * 1000,
    completed_at_ms: Date.now() - 2 * 60 * 60 * 1000,
    duration_sec: 3_600,
    gym_name: 'Iron Works',
    working_sets: 18,
    exercise_count: 4,
    group_records: [],
  },
  ...overrides,
});

const live = (userId: string) => ({
  member: member(userId),
  session_id: `${userId}-live`,
  started_at_ms: Date.now() - 30 * 60 * 1000,
  gym_name: 'Iron Works',
  working_sets: 7,
  exercise_count: 3,
});

const signedIn = () => mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: ME } });

// Boot first, as the app's root layout does.
const renderToday = async () => {
  await bootLocalApp();
  const view = render(<TodayRoute />);
  await waitForGone(() => screen.queryByTestId('today-progress-loading'));
  return view;
};

const byId = (testID: string) => screen.getByTestId(testID);

beforeEach(() => {
  resetLocalData();
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask', 'hrtime'] });
  jest.setSystemTime(NOW);
  mockPush.mockReset();
  mockInitialOnline = null;
  setLastViewedGroupId(null);
  api.listMyGroups.mockReset();
  api.getCompetitionWeek.mockReset();
  api.getCompetitionStream.mockReset();
  signedIn();
});

afterEach(() => {
  jest.useRealTimers();
  closeLocalData();
});

describe('Today: the group card account states', () => {
  it('asks a signed-out user to sign in and reads nothing', async () => {
    mockUseAuth.mockReturnValue({ isConfigured: true, user: null });
    await renderToday();

    fireEvent.press(byId('today-group-sign-in'));
    fireEvent.press(byId('today-view-groups-button'));
    expect(mockPush.mock.calls).toEqual([[SIGN_IN_ROUTE], ['/groups']]);
    expect(api.listMyGroups).not.toHaveBeenCalled();
  });

  it('explains a build without sign-in', async () => {
    mockUseAuth.mockReturnValue({ isConfigured: false, user: null });
    await renderToday();

    expect(byId('today-group-auth-unavailable')).toBeTruthy();
    expect(api.listMyGroups).not.toHaveBeenCalled();
  });

  it('offers Find a group to a member of no group', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [] });
    await renderToday();

    await waitFor(() => expect(byId('today-group-empty')).toBeTruthy());
    expect(screen.getByText('Train with friends')).toBeTruthy();
    fireEvent.press(byId('today-group-find-group'));
    expect(mockPush).toHaveBeenCalledWith('/group/mine');
    expect(api.getCompetitionWeek).not.toHaveBeenCalled();
  });
});

describe('Today: the group card', () => {
  it('with one group: the heading names it with no switch, and this local week is read', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary());
    await renderToday();

    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    const week = localWeekWindow(new Date());
    expect(api.getCompetitionWeek).toHaveBeenCalledWith('g1',week.start.getTime(),week.end.getTime());
    expect(byId('today-group-title')).toHaveTextContent('Iron Wednesdays');
    expect(screen.queryByTestId('today-group-switch')).toBeNull();
    expect(byId('today-group-board-title')).toHaveTextContent('This week');

    // The top three, the leader's bar in the darker step, then my own line.
    expect(byId('today-group-board-row-dave-name')).toHaveTextContent('dave');
    expect(byId('today-group-board-row-sam-rank')).toHaveTextContent('3');
    expect(byId('today-group-board-row-maria-fill')).toHaveStyle({ width: '67%' });
    expect(screen.queryByTestId('today-group-board-row-me')).toBeNull();
    expect(byId('today-group-board-me-rank')).toHaveTextContent('You · 4th');
    expect(byId('today-group-board-me-working-sets')).toHaveTextContent('21');
    // The count column is the working sets, labelled `Sets` like every set count.
    expect(within(byId('today-group-board')).getByText('Sets')).toBeTruthy();
    expect(byId('today-group-board').props.accessibilityLabel).toContain('You, 4th, 21 sets,');

    fireEvent.press(byId('today-group-latest-completed'));
    fireEvent.press(byId('today-group-board'));
    // The heading opens the group on the Groups screen, At a glance.
    fireEvent.press(byId('today-group-title'));
    expect(mockPush.mock.calls).toEqual([
      ['/group-session/dave/dave-done?groupId=g1'],
      ['/groups?groupId=g1'],
      ['/groups?groupId=g1&section=glance'],
    ]);
  });

  it('with several groups: the heading names the Groups screen pick, and its switch moves both', async () => {
    setLastViewedGroupId('g2');
    api.listMyGroups.mockResolvedValue({ groups: [IRON, LUNCH] });
    api.getCompetitionWeek.mockImplementation(async (groupId) =>
      summary({ group_id: groupId,members: [{ rank: 1, member: member(groupId === 'g1' ? 'dave' : 'lena'), working_sets: 5, group_records: 0 }] }),
    );
    await renderToday();

    await waitFor(() => expect(byId('today-group-board-row-lena')).toBeTruthy());
    expect(byId('today-group-title')).toHaveTextContent('Lunch Club');
    expect(byId('today-group-board-title')).toHaveTextContent('This week');
    expect(api.getCompetitionWeek).toHaveBeenLastCalledWith('g2',expect.any(Number),expect.any(Number));

    fireEvent.press(byId('today-group-switch'));
    fireEvent.press(byId('today-group-switch-g1'));
    await waitFor(() => expect(byId('today-group-board-row-dave')).toBeTruthy());
    expect(api.getCompetitionWeek).toHaveBeenLastCalledWith('g1',expect.any(Number),expect.any(Number));
    expect(getLastViewedGroupId()).toBe('g1');
  });

  it('draws the latest completed session as the Progress row, naming one group record and counting several', async () => {
    const boardValue = (metric: 'e1rm' | 'weight', value: number) =>
      ({ role: 'record' as const, metric, unit: 'kg', value, unavailable: false, member: null });
    const deadlift = { ...competitionEvent, visibility: 'ordinary' as const, group_exercise: { group_exercise_id: 'gx-dl', name: 'Deadlift' } };
    const latest = summary().latest_completed!;
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValueOnce(summary({
      latest_completed: { ...latest, group_records: [{ ...deadlift, values: [boardValue('e1rm', 213.3)] }] },
    }));
    const view = await renderToday();

    await waitFor(() => expect(byId('today-group-latest-completed')).toBeTruthy());
    expect(byId('today-group-latest-completed-member')).toHaveTextContent('dave');
    expect(screen.queryByTestId('today-group-latest-completed-training-now')).toBeNull();
    expect(byId('today-group-latest-completed-figures')).toHaveTextContent('18 sets · 4 exercises');
    expect(byId('today-group-latest-completed-record')).toHaveTextContent('Deadlift 1RM 213.3 · group record');
    view.unmount();

    // One set #1 on Weight and on 1RM: two group records, only counted.
    api.getCompetitionWeek.mockResolvedValueOnce(summary({
      latest_completed: { ...latest, group_records: [{ ...deadlift, values: [boardValue('weight', 200), boardValue('e1rm', 213.3)] }] },
    }));
    await renderToday();
    await waitFor(() => expect(byId('today-group-latest-completed-record')).toHaveTextContent('2 group records'));
    expect(screen.queryByText(/Deadlift/)).toBeNull();
  });

  it('opens one member training now on their session, and several on the group', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValueOnce(summary({ training_now: [live('maria')] }));
    const view = await renderToday();

    await waitFor(() => expect(byId('today-group-latest-training')).toBeTruthy());
    // The shared session row, under the member's name and the training-now mark.
    expect(byId('today-group-latest-training-member')).toHaveTextContent('maria');
    expect(within(byId('today-group-latest-training-training-now')).getByText('Training now')).toBeTruthy();
    expect(byId('today-group-latest-training-start')).toHaveTextContent('Started 11:30');
    expect(screen.queryByTestId('today-group-latest-training-record')).toBeNull();
    fireEvent.press(byId('today-group-latest-training'));
    expect(mockPush).toHaveBeenLastCalledWith('/group-session/maria/maria-live?groupId=g1');
    view.unmount();

    api.getCompetitionWeek.mockResolvedValueOnce(summary({ training_now: [live('maria'), live('sam'), live('tom')] }));
    await renderToday();
    await waitFor(() => expect(byId('today-group-latest-title')).toHaveTextContent('3 training now'));
    expect(screen.getByText('maria, sam and tom')).toBeTruthy();
    fireEvent.press(byId('today-group-latest-several'));
    expect(mockPush).toHaveBeenLastCalledWith('/groups?groupId=g1');
  });

  describe('stepping back through the group\'s completed sessions', () => {
    const streamSession = (userId: string, sessionId: string, startedAtMs: number, status: 'completed' | 'active' = 'completed') => ({
      kind: 'session' as const,
      key: `${userId}:${sessionId}`,
      sort_at_ms: startedAtMs,
      groups: [{ group_id: 'g1', name: 'Iron Wednesdays' }],
      session: { ...competitionSession.session, member: member(userId), session_id: sessionId, status, started_at_ms: startedAtMs,
        completed_at_ms: status === 'completed' ? startedAtMs + 3_600_000 : null, duration_sec: status === 'completed' ? 3_600 : null },
    });
    const DAY = 24 * 60 * 60 * 1000;
    const record = { ...competitionEvent, member: member('sam'), session_id: 'sam-1' };
    const firstPage = {
      contract_version: 4 as const,
      items: [
        // The latest activity's own session is not stepped to again, nor one still in progress.
        streamSession('dave', 'dave-done', NOW.getTime() - 3 * 60 * 60 * 1000),
        streamSession('tom', 'tom-live', NOW.getTime() - DAY, 'active'),
        { kind: 'competition' as const, key: 'event1', sort_at_ms: NOW.getTime() - 2 * DAY, event: record },
        streamSession('sam', 'sam-1', NOW.getTime() - 2 * DAY),
      ],
      next_cursor: 'older',
      has_more: true,
    };
    const secondPage = { contract_version: 4 as const, items: [streamSession('maria', 'maria-1', NOW.getTime() - 5 * DAY)], next_cursor: null, has_more: false };

    it('reads the stream only when asked, steps back a session at a time and forward again to the latest', async () => {
      api.listMyGroups.mockResolvedValue({ groups: [IRON] });
      api.getCompetitionWeek.mockResolvedValue(summary());
      api.getCompetitionStream.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
      await renderToday();
      await waitFor(() => expect(byId('today-group-latest-completed')).toBeTruthy());

      expect(api.getCompetitionStream).not.toHaveBeenCalled();
      expect(byId('today-group-latest-heading')).toHaveTextContent('Latest activity');
      expect(byId('today-group-latest-step-newer')).toBeDisabled();

      fireEvent.press(byId('today-group-latest-step-older'));
      await waitFor(() => expect(byId('today-group-latest-completed-member')).toHaveTextContent('sam'));
      expect(api.getCompetitionStream).toHaveBeenCalledWith('g1', null);
      expect(byId('today-group-latest-heading')).toHaveTextContent('Earlier session');
      expect(byId('today-group-latest-completed-figures')).toHaveTextContent('1 set · 1 exercise');
      expect(byId('today-group-latest-completed-record')).toHaveTextContent('Pull-up 1RM 145.7 %BW · group record');
      fireEvent.press(byId('today-group-latest-completed'));
      expect(mockPush).toHaveBeenLastCalledWith('/group-session/sam/sam-1?groupId=g1');

      // Past the first page: the next one is read.
      fireEvent.press(byId('today-group-latest-step-older'));
      await waitFor(() => expect(byId('today-group-latest-completed-member')).toHaveTextContent('maria'));
      expect(api.getCompetitionStream).toHaveBeenLastCalledWith('g1', 'older');
      expect(byId('today-group-latest-step-older')).toBeDisabled();

      fireEvent.press(byId('today-group-latest-step-newer'));
      expect(byId('today-group-latest-completed-member')).toHaveTextContent('sam');
      fireEvent.press(byId('today-group-latest-step-newer'));
      expect(byId('today-group-latest-completed-member')).toHaveTextContent('dave');
      expect(byId('today-group-latest-heading')).toHaveTextContent('Latest activity');
      expect(api.getCompetitionStream).toHaveBeenCalledTimes(2);
    });

    it('says so when the earlier sessions cannot be read, and tries again on the next tap', async () => {
      api.listMyGroups.mockResolvedValue({ groups: [IRON] });
      api.getCompetitionWeek.mockResolvedValue(summary());
      api.getCompetitionStream.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'Server unavailable')).mockResolvedValueOnce(firstPage);
      await renderToday();
      await waitFor(() => expect(byId('today-group-latest-completed')).toBeTruthy());

      fireEvent.press(byId('today-group-latest-step-older'));
      await waitFor(() => expect(byId('today-group-latest-step-failed')).toHaveTextContent("Couldn't load earlier sessions."));
      expect(byId('today-group-latest-completed-member')).toHaveTextContent('dave');

      fireEvent.press(byId('today-group-latest-step-older'));
      await waitFor(() => expect(byId('today-group-latest-completed-member')).toHaveTextContent('sam'));
      expect(screen.queryByTestId('today-group-latest-step-failed')).toBeNull();
    });
  });

  it('says so when the group has no shared session yet', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary({ latest_completed: null }));
    await renderToday();

    await waitFor(() => expect(byId('today-group-latest-empty')).toBeTruthy());
  });
});

describe('Today: the group card offline and on errors', () => {
  it('keeps the cached week, with the offline marker, when the device goes offline', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary());
    const view = await renderToday();
    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    view.unmount();

    mockInitialOnline = false;
    api.getCompetitionWeek.mockClear();
    await renderToday();

    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    expect(byId('groups-offline-banner')).toBeTruthy();
    expect(byId('today-group-board-me-rank')).toHaveTextContent('You · 4th');
    expect(api.getCompetitionWeek).not.toHaveBeenCalled();
  });

  it('never shows an earlier week from the cache as this week', async () => {
    const database = await bootstrapLocalDataLayer();
    const lastWeek = localWeekWindow(new Date(), -1).start.getTime();
    writeGroupCache(database, { cacheKey: groupCacheKeys.mine, userId: ME, payload: { groups: [IRON] }, fetchedAtMs: 1 });
    writeGroupCache(database, {
      cacheKey: groupCacheKeys.weekSummary('g1'),
      userId: ME,
      payload: { windowStartMs: lastWeek, summary: summary() },
      fetchedAtMs: 1,
    });
    mockInitialOnline = false;
    await renderToday();

    await waitFor(() => expect(byId('today-group-offline-empty-state')).toBeTruthy());
    expect(screen.queryByTestId('today-group-card')).toBeNull();
  });

  it('reports a failed first read with Retry, then a failed refresh inline above the board', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'Server unavailable'));
    api.getCompetitionWeek.mockResolvedValueOnce(summary());
    const view = await renderToday();

    await waitFor(() => expect(byId('today-group-error-state')).toBeTruthy());
    await act(async () => {
      fireEvent.press(byId('today-group-error-state-retry'));
    });
    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    view.unmount();

    api.getCompetitionWeek.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'Server unavailable'));
    api.getCompetitionWeek.mockResolvedValueOnce(summary());
    await renderToday();
    await waitFor(() => expect(byId('today-group-inline-error')).toBeTruthy());
    expect(byId('today-group-card')).toBeTruthy();
    await act(async () => {
      fireEvent.press(byId('today-group-inline-error-retry'));
    });
    await waitForGone(() => screen.queryByTestId('today-group-inline-error'));
  });

  it('moves to a remaining group when access to the shown one is lost', async () => {
    api.listMyGroups.mockResolvedValueOnce({ groups: [IRON, LUNCH] }).mockResolvedValue({ groups: [LUNCH] });
    api.getCompetitionWeek.mockImplementation(async (groupId) => {
      if (groupId === 'g1') throw new GroupApiError('NOT_FOUND', 'group not found');
      return summary({ group_id: groupId,members: [{ rank: 1, member: member('lena'), working_sets: 5, group_records: 0 }] });
    });
    await renderToday();

    await waitFor(() => expect(byId('today-group-board-row-lena')).toBeTruthy());
    expect(screen.queryByTestId('today-group-switch')).toBeNull();
    expect(byId('today-group-title')).toHaveTextContent('Lunch Club');
  });
});

describe("Today: the group card in the cards layout (Settings' Today layout: Cards)", () => {
  beforeEach(() => {
    act(() => updatePreferences({ todayLayout: 'cards' }));
  });
  afterEach(() => {
    act(() => updatePreferences({ todayLayout: 'list' }));
  });

  // Nine ranked members, me seventh.
  const nine = ['dave', 'maria', 'sam', 'kit', 'jo', 'marco', ME, 'dee', 'tom'].map((userId, index) => ({
    rank: index + 1,
    member: member(userId),
    working_sets: 60 - index * 5,
    group_records: 0,
  }));

  const boardBox = (height: number) =>
    fireEvent(byId('today-group-board-box'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 345, height } } });
  const boardRows = () => screen.queryAllByTestId(/^today-group-board-row-[^-]+$/).map((row) => row.props.testID);

  it("names the group's card after it, and offers its switch only while that card shows", async () => {
    setLastViewedGroupId('g2');
    api.listMyGroups.mockResolvedValue({ groups: [IRON, LUNCH] });
    api.getCompetitionWeek.mockResolvedValue(summary({ group_id: 'g2' }));
    await renderToday();

    await waitFor(() => expect(within(byId('today-group-section')).getByTestId('today-group-card')).toBeTruthy());
    expect(byId('today-group-section-tab')).toHaveTextContent('Lunch Club');
    expect(screen.queryByTestId('today-group-switch')).toBeNull();

    fireEvent.press(byId('today-group-section-tab'));
    fireEvent.press(byId('today-group-switch'));
    fireEvent.press(byId('today-group-switch-g1'));
    await waitFor(() => expect(byId('today-group-section-tab')).toHaveTextContent('Iron Wednesdays'));
    expect(getLastViewedGroupId()).toBe('g1');

    // The card's link opens the group At a glance, as the list layout's heading does.
    fireEvent.press(byId('today-view-group-button'));
    expect(mockPush).toHaveBeenLastCalledWith('/groups?groupId=g1&section=glance');
  });

  it('shows as many board rows as the card has room for, counting the rest', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary({ members: nine }));
    await renderToday();
    await waitFor(() => expect(byId('today-group-board-box')).toBeTruthy());

    // Before the box is measured: the list layout's three, then my own line.
    expect(boardRows()).toHaveLength(3);
    expect(byId('today-group-board-me-rank')).toHaveTextContent('You · 7th');
    expect(byId('today-group-board-more')).toHaveTextContent('+5 more');

    // 400pt: 34 of heading, 36 for my line and 22 for `+N more` leave 308, seven 40pt rows — me among them.
    boardBox(400);
    expect(boardRows()).toEqual(['dave', 'maria', 'sam', 'kit', 'jo', 'marco', ME].map((id) => `today-group-board-row-${id}`));
    expect(screen.queryByTestId('today-group-board-me')).toBeNull();
    expect(byId('today-group-board-more')).toHaveTextContent('+2 more');
    expect(byId('today-group-board').props.accessibilityLabel).toMatch(/7, You, 30 sets, 0 PRs; 2 more$/);

    // Room for everyone: no `+N more`.
    boardBox(600);
    expect(boardRows()).toHaveLength(9);
    expect(screen.queryByTestId('today-group-board-more')).toBeNull();

    // Never fewer than three.
    boardBox(120);
    expect(boardRows()).toHaveLength(3);
  });

  it('centres the loading state in the card while My groups is read (a pending read)', async () => {
    api.listMyGroups.mockReturnValue(new Promise(() => {}));
    await renderToday();

    await waitFor(() => expect(within(byId('today-group-missing')).getByTestId('today-group-loading')).toBeTruthy());
    expect(byId('today-group-missing')).toHaveStyle({ flex: 1, justifyContent: 'center' });
  });

  it('fills the card with the signed-out panel, its link opening Groups', async () => {
    mockUseAuth.mockReturnValue({ isConfigured: true, user: null });
    await renderToday();

    expect(within(byId('today-group-section')).getByTestId('today-group-signed-out')).toBeTruthy();
    expect(byId('today-group-section-tab')).toHaveTextContent('Group activity');
    fireEvent.press(byId('today-view-groups-button'));
    expect(mockPush).toHaveBeenLastCalledWith('/groups');
  });
});
