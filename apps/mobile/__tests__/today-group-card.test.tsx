/* eslint-disable import/first */

/**
 * Today's Groups cards through the production route: My groups and the
 * week summary go through the real cache-first hooks over the in-memory app
 * database (helpers/local-data.ts, so `group_cache` is real). Only the group
 * RPCs, auth, NetInfo and the router are replaced. The week summary's own
 * rules are groups-week-summary-view-model.test.ts.
 */

import * as mockReact from 'react';
import { ScrollView } from 'react-native';
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
  ...jest.requireActual('./helpers/cow-fixtures').coWReadMocks(),
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
  // The sessions card reads the stream when it has room; by default it holds nothing more.
  api.getCompetitionStream.mockResolvedValue({ contract_version: 4, items: [], next_cursor: null, has_more: false });
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
    expect(mockPush.mock.calls).toEqual([[SIGN_IN_ROUTE]]);
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

// Stream fixtures: a session item as the group stream carries it, and a group
// record event on one of its sessions.
const DAY = 24 * 60 * 60 * 1000;
const streamSession = (userId: string, sessionId: string, startedAtMs: number, status: 'completed' | 'active' = 'completed') => ({
  kind: 'session' as const,
  key: `${userId}:${sessionId}`,
  sort_at_ms: startedAtMs,
  groups: [{ group_id: 'g1', name: 'Iron Wednesdays' }],
  session: { ...competitionSession.session, member: member(userId), session_id: sessionId, status, started_at_ms: startedAtMs,
    completed_at_ms: status === 'completed' ? startedAtMs + 3_600_000 : null, duration_sec: status === 'completed' ? 3_600 : null },
});
const boardValue = (metric: 'e1rm' | 'weight', value: number) =>
  ({ role: 'record' as const, metric, unit: 'kg', value, unavailable: false, member: null });
const deadlift = { ...competitionEvent, visibility: 'ordinary' as const, group_exercise: { group_exercise_id: 'gx-dl', name: 'Deadlift' } };
const recordItem = (userId: string, sessionId: string, values: ReturnType<typeof boardValue>[]) => ({
  kind: 'competition' as const,
  key: `record-${sessionId}`,
  sort_at_ms: NOW.getTime() - 2 * DAY,
  event: { ...deadlift, event_id: `record-${sessionId}`, member: member(userId), session_id: sessionId, values },
});
const streamPage = (items: unknown[], nextCursor: string | null = null) =>
  ({ contract_version: 4 as const, items, next_cursor: nextCursor, has_more: nextCursor !== null }) as Awaited<
    ReturnType<typeof api.getCompetitionStream>
  >;

// The member names on the sessions cards (training now, then recent), top to bottom.
const sessionMembers = () => within(byId('today-group-section')).queryAllByTestId(/^today-group-session-.*-member$/)
  .map((node) => node.props.children as string);

describe('Today: the group card', () => {
  it("with one group: the section is Groups, the board card's header row names the group with no switch, and this local week is read", async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary());
    await renderToday();

    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    const week = localWeekWindow(new Date());
    expect(api.getCompetitionWeek).toHaveBeenCalledWith('g1',week.start.getTime(),week.end.getTime());
    expect(byId('today-group-section-tab')).toHaveTextContent('Groups');
    expect(within(byId('today-group-card')).getByTestId('today-group-title')).toHaveTextContent('Iron Wednesdays');
    expect(screen.queryByTestId('today-group-switch')).toBeNull();
    // `This week` and this local week (Mon 5 – Sun 11 Oct 2026), in Today's range format.
    expect(within(byId('today-group-card')).getByText(/This week/)).toBeTruthy();
    expect(byId('today-group-board-range')).toHaveTextContent('5 – 11 Oct 26');

    // Four members fit the top five: I am on the board, with no line of my own.
    expect(byId('today-group-board-row-dave-name')).toHaveTextContent('dave');
    expect(byId('today-group-board-row-sam-rank')).toHaveTextContent('3');
    expect(byId('today-group-board-row-maria-fill')).toHaveStyle({ width: '67%' });
    expect(byId('today-group-board-row-me-working-sets')).toHaveTextContent('21');
    expect(screen.queryByTestId('today-group-board-me')).toBeNull();
    // The count column is the working sets, labelled `Sets` like every set count.
    expect(within(byId('today-group-board')).getByText('Sets')).toBeTruthy();

    // The board and the header row's name both open the group's home page, At a glance;
    // the card carries no other link.
    expect(screen.queryByTestId('today-view-group-button')).toBeNull();
    fireEvent.press(byId('today-group-board'));
    fireEvent.press(byId('today-group-title'));
    expect(mockPush.mock.calls).toEqual([
      ['/groups?groupId=g1&section=glance'],
      ['/groups?groupId=g1&section=glance'],
    ]);
  });

  it('shows the top five on the board, then my own line when I am outside them', async () => {
    // Nine ranked members, me seventh.
    const nine = ['dave', 'maria', 'sam', 'kit', 'jo', 'marco', ME, 'dee', 'tom'].map((userId, index) => ({
      rank: index + 1,
      member: member(userId),
      working_sets: 60 - index * 5,
      group_records: index === 6 ? 2 : 0,
    }));
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary({ members: nine }));
    await renderToday();
    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());

    const boardRows = screen.queryAllByTestId(/^today-group-board-row-[^-]+$/).map((row) => row.props.testID);
    expect(boardRows).toEqual(['dave', 'maria', 'sam', 'kit', 'jo'].map((id) => `today-group-board-row-${id}`));
    expect(byId('today-group-board-me-rank')).toHaveTextContent('7th');
    expect(byId('today-group-board-me-working-sets')).toHaveTextContent('30');
    expect(byId('today-group-board-me-records')).toHaveTextContent('2');
    // No count of the members left off.
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(byId('today-group-board').props.accessibilityLabel).toMatch(/^This week, 5 – 11 Oct 26; 1, dave, 60 sets, 0 PRs;.*; You, 7th, 30 sets, 2 PRs$/);
  });

  it("with several groups: the header row names the Groups screen pick, and its switch, on the same row, moves both", async () => {
    setLastViewedGroupId('g2');
    api.listMyGroups.mockResolvedValue({ groups: [IRON, LUNCH] });
    api.getCompetitionWeek.mockImplementation(async (groupId) =>
      summary({ group_id: groupId,members: [{ rank: 1, member: member(groupId === 'g1' ? 'dave' : 'lena'), working_sets: 5, group_records: 0 }] }),
    );
    await renderToday();

    await waitFor(() => expect(byId('today-group-board-row-lena')).toBeTruthy());
    expect(byId('today-group-title')).toHaveTextContent('Lunch Club');
    expect(within(byId('today-group-card')).getByTestId('today-group-switch')).toBeTruthy();
    expect(api.getCompetitionWeek).toHaveBeenLastCalledWith('g2',expect.any(Number),expect.any(Number));

    fireEvent.press(byId('today-group-switch'));
    fireEvent.press(byId('today-group-switch-g1'));
    await waitFor(() => expect(byId('today-group-board-row-dave')).toBeTruthy());
    expect(api.getCompetitionWeek).toHaveBeenLastCalledWith('g1',expect.any(Number),expect.any(Number));
    expect(getLastViewedGroupId()).toBe('g1');
  });

  describe('the sessions card', () => {
    it('lists members training now first, then recent sessions from the summary and the stream, four in all', async () => {
      api.listMyGroups.mockResolvedValue({ groups: [IRON] });
      api.getCompetitionWeek.mockResolvedValue(summary({ training_now: [live('maria'), live('sam')] }));
      api.getCompetitionStream.mockResolvedValue(streamPage([
        // The summary's latest is shown once, and a session still in progress is not a recent one.
        streamSession('dave', 'dave-done', NOW.getTime() - 3 * 60 * 60 * 1000),
        streamSession('tom', 'tom-live', NOW.getTime() - DAY, 'active'),
        streamSession('kit', 'kit-1', NOW.getTime() - 2 * DAY),
        streamSession('jo', 'jo-1', NOW.getTime() - 3 * DAY),
      ], 'older'));
      await renderToday();

      // Two live, the summary's latest, then one from the stream: four.
      await waitFor(() => expect(sessionMembers()).toEqual(['maria', 'sam', 'dave', 'kit']));
      // Training now and recent are a card each.
      expect(within(byId('today-group-live')).queryAllByTestId(/-member$/).map((node) => node.props.children)).toEqual(['maria', 'sam']);
      expect(within(byId('today-group-sessions')).queryAllByTestId(/-member$/).map((node) => node.props.children)).toEqual(['dave', 'kit']);
      expect(api.getCompetitionStream).toHaveBeenCalledTimes(1);
      expect(api.getCompetitionStream).toHaveBeenCalledWith('g1', null);
      expect(within(byId('today-group-training-now')).getByText('Training now')).toBeTruthy();
      expect(within(byId('today-group-training-now')).getByTestId('today-group-session-sam-live')).toBeTruthy();
      expect(within(byId('today-group-recent')).getByText('Recent')).toBeTruthy();
      expect(within(byId('today-group-recent')).getByTestId('today-group-session-kit-1')).toBeTruthy();
      expect(screen.queryByTestId('today-group-session-jo-1')).toBeNull();
      expect(screen.queryByTestId('today-group-session-tom-live')).toBeNull();

      // Live: today's start time and the figures so far, no record.
      expect(byId('today-group-session-maria-live-when')).toHaveTextContent('Started 11:30');
      // The live time keeps the line's emphasis: its figure is no lighter than `Started`.
      expect(within(byId('today-group-session-maria-live-when')).getByText('11:30')).toHaveStyle({ fontWeight: '600' });
      expect(byId('today-group-session-maria-live-figures')).toHaveTextContent('3 exercises · 7 sets so far');
      expect(screen.queryByTestId('today-group-session-maria-live-record')).toBeNull();
      // Completed: Today's compact date and time, then the session's figures.
      expect(byId('today-group-session-dave-done-when')).toHaveTextContent('6 Oct 26 09:00');
      expect(byId('today-group-session-dave-done-figures')).toHaveTextContent('4 exercises · 18 sets');
      expect(byId('today-group-session-kit-1-figures')).toHaveTextContent('1 exercise · 1 set');

      // A row opens its member's session in the group.
      fireEvent.press(byId('today-group-session-maria-live'));
      fireEvent.press(byId('today-group-session-kit-1'));
      expect(mockPush.mock.calls).toEqual([
        ['/group-session/maria/maria-live?groupId=g1'],
        ['/group-session/kit/kit-1?groupId=g1'],
      ]);
    });

    it('reads the stream only when the live sessions and the latest leave room', async () => {
      api.listMyGroups.mockResolvedValue({ groups: [IRON] });
      // Four training now fill the card: no latest, no stream.
      api.getCompetitionWeek.mockResolvedValueOnce(summary({ training_now: ['maria', 'sam', 'tom', 'kit'].map(live) }));
      const view = await renderToday();
      await waitFor(() => expect(sessionMembers()).toEqual(['maria', 'sam', 'tom', 'kit']));
      expect(screen.queryByTestId('today-group-recent')).toBeNull();
      // Nothing recent to show: no recent card, only the live one.
      expect(screen.queryByTestId('today-group-sessions')).toBeNull();
      expect(api.getCompetitionStream).not.toHaveBeenCalled();
      view.unmount();

      // Three training now and the summary's latest: four again, still no stream.
      api.getCompetitionWeek.mockResolvedValueOnce(summary({ training_now: ['maria', 'sam', 'tom'].map(live) }));
      await renderToday();
      await waitFor(() => expect(sessionMembers()).toEqual(['maria', 'sam', 'tom', 'dave']));
      expect(within(byId('today-group-recent')).getByTestId('today-group-session-dave-done')).toBeTruthy();
      expect(api.getCompetitionStream).not.toHaveBeenCalled();
    });

    it('names one group record and counts several', async () => {
      const latest = summary().latest_completed!;
      api.listMyGroups.mockResolvedValue({ groups: [IRON] });
      api.getCompetitionWeek.mockResolvedValue(summary({
        latest_completed: { ...latest, group_records: [{ ...deadlift, values: [boardValue('e1rm', 213.3)] }] },
      }));
      // One set #1 on Weight and on 1RM: two group records, only counted.
      api.getCompetitionStream.mockResolvedValue(streamPage([
        recordItem('sam', 'sam-1', [boardValue('weight', 200), boardValue('e1rm', 213.3)]),
        streamSession('sam', 'sam-1', NOW.getTime() - 2 * DAY),
      ]));
      await renderToday();

      await waitFor(() => expect(byId('today-group-session-sam-1-record')).toHaveTextContent('2 group records'));
      expect(byId('today-group-session-dave-done-record')).toHaveTextContent('Deadlift 1RM 213.3');
      expect(byId('today-group-session-dave-done-figures')).toHaveTextContent('4 exercises · 18 sets · Deadlift 1RM 213.3');
      expect(byId('today-group-session-sam-1-figures')).toHaveTextContent('1 exercise · 1 set · 2 group records');
    });

    it("says so when the earlier sessions can't be read, keeping the summary's", async () => {
      api.listMyGroups.mockResolvedValue({ groups: [IRON] });
      api.getCompetitionWeek.mockResolvedValue(summary());
      api.getCompetitionStream.mockRejectedValue(new GroupApiError('INTERNAL', 'Server unavailable'));
      await renderToday();

      await waitFor(() => expect(byId('today-group-recent-failed')).toHaveTextContent("Couldn't load earlier sessions."));
      expect(sessionMembers()).toEqual(['dave']);
    });

    it('says so when the group has no shared session yet', async () => {
      api.listMyGroups.mockResolvedValue({ groups: [IRON] });
      api.getCompetitionWeek.mockResolvedValue(summary({ latest_completed: null }));
      await renderToday();

      await waitFor(() => expect(byId('today-group-latest-empty')).toHaveTextContent('No sessions shared to this group yet.'));
      expect(api.getCompetitionStream).toHaveBeenCalledWith('g1', null);
      expect(sessionMembers()).toEqual([]);
    });
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
    expect(byId('today-group-board-row-me-working-sets')).toHaveTextContent('21');
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
    // Missing data: no header row to name the group or switch it; Retry is the way on.
    expect(screen.queryByTestId('today-group-title')).toBeNull();
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

describe("Today: the group's page", () => {
  it('lets the live card take the page and scroll its rows when it is the only sessions card', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary({ training_now: ['maria', 'sam', 'tom', 'kit'].map(live) }));
    await renderToday();

    await waitFor(() => expect(byId('today-group-live')).toBeTruthy());
    expect(screen.queryByTestId('today-group-sessions')).toBeNull();
    expect(byId('today-group-live')).toHaveStyle({ flex: 1 });
    expect(within(byId('today-group-live')).UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
  });

  it("labels the tab Groups and heads the board card with the group's name and its switch", async () => {
    setLastViewedGroupId('g2');
    api.listMyGroups.mockResolvedValue({ groups: [IRON, LUNCH] });
    api.getCompetitionWeek.mockImplementation(async (groupId) => summary({ group_id: groupId }));
    await renderToday();

    await waitFor(() => expect(within(byId('today-group-section')).getByTestId('today-group-card')).toBeTruthy());
    expect(byId('today-group-section-tab')).toHaveTextContent('Groups');
    // Nothing sits beside the tabs: the name and switch are the board card's.
    expect(screen.queryByTestId('today-group-open')).toBeNull();
    const card = within(byId('today-group-card'));
    expect(card.getByTestId('today-group-title')).toHaveTextContent('Lunch Club');

    fireEvent.press(card.getByTestId('today-group-switch'));
    fireEvent.press(byId('today-group-switch-g1'));
    await waitFor(() => expect(byId('today-group-title')).toHaveTextContent('Iron Wednesdays'));
    expect(byId('today-group-section-tab')).toHaveTextContent('Groups');
    expect(getLastViewedGroupId()).toBe('g1');

    // The first page is `You`; the group's page draws its own two cards.
    expect(byId('today-progress-section-tab')).toHaveTextContent('You');
    expect(within(byId('today-group-section')).getByTestId('today-group-sessions')).toBeTruthy();

    // The name opens the shown group At a glance.
    fireEvent.press(byId('today-group-title'));
    expect(mockPush).toHaveBeenLastCalledWith('/groups?groupId=g1&section=glance');
  });

  it('with one group: the header row opens the group, and there is no switch', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getCompetitionWeek.mockResolvedValue(summary());
    await renderToday();

    await waitFor(() => expect(within(byId('today-group-section')).getByTestId('today-group-card')).toBeTruthy());
    expect(screen.queryByTestId('today-group-switch')).toBeNull();
    fireEvent.press(byId('today-group-title'));
    expect(mockPush).toHaveBeenLastCalledWith('/groups?groupId=g1&section=glance');
  });

  it('centres the loading state in the card while My groups is read (a pending read)', async () => {
    api.listMyGroups.mockReturnValue(new Promise(() => {}));
    await renderToday();

    await waitFor(() => expect(within(byId('today-group-missing')).getByTestId('today-group-loading')).toBeTruthy());
    expect(byId('today-group-missing')).toHaveStyle({ flex: 1, justifyContent: 'center' });
  });

  it("shows the signed-out panel on the group's page", async () => {
    mockUseAuth.mockReturnValue({ isConfigured: true, user: null });
    await renderToday();

    expect(within(byId('today-group-section')).getByTestId('today-group-signed-out')).toBeTruthy();
    expect(byId('today-group-section-tab')).toHaveTextContent('Groups');
    fireEvent.press(byId('today-group-sign-in'));
    expect(mockPush).toHaveBeenLastCalledWith(SIGN_IN_ROUTE);
  });
});
