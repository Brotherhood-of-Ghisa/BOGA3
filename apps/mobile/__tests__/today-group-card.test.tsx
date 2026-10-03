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
  getGroupWeekSummary: jest.fn(),
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
  type GroupWeekSummaryResult,
} from '@/src/groups';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { localWeekWindow } from '@/src/utils/local-calendar';

import { bootLocalApp, closeLocalData, resetLocalData } from './helpers/local-data';

import TodayRoute from '../app/(tabs)/today';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
const ME = 'me';

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
  members: [
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

// waitFor predicates throw a plain error rather than `expect(…).toBeNull()`: a
// failed matcher pretty-prints the route's whole fiber on every poll, which on a
// slow runner outlasts waitFor's timeout.
const waitForGone = (testID: string) =>
  waitFor(() => {
    if (screen.queryByTestId(testID)) throw new Error(`${testID} is still on screen`);
  });

// Boot first, as the app's root layout does.
const renderToday = async () => {
  await bootLocalApp();
  const view = render(<TodayRoute />);
  await waitForGone('today-progress-loading');
  return view;
};

const byId = (testID: string) => screen.getByTestId(testID);

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
  mockInitialOnline = null;
  setLastViewedGroupId(null);
  api.listMyGroups.mockReset();
  api.getGroupWeekSummary.mockReset();
  signedIn();
});

afterEach(() => {
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
    expect(api.getGroupWeekSummary).not.toHaveBeenCalled();
  });
});

describe('Today: the group card', () => {
  it('with one group: no switcher, the board names the group, and this local week is read', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getGroupWeekSummary.mockResolvedValue(summary());
    await renderToday();

    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    const week = localWeekWindow(new Date());
    expect(api.getGroupWeekSummary).toHaveBeenCalledWith({
      groupId: 'g1',
      windowStartMs: week.start.getTime(),
      windowEndMs: week.end.getTime(),
    });
    expect(screen.queryByTestId('today-group-switcher')).toBeNull();
    expect(byId('today-group-board-title')).toHaveTextContent('Iron Wednesdays · this week');

    // The top three, the leader's bar in the darker step, then my own line.
    expect(byId('today-group-board-row-dave-name')).toHaveTextContent('dave');
    expect(byId('today-group-board-row-sam-rank')).toHaveTextContent('3');
    expect(byId('today-group-board-row-maria-fill')).toHaveStyle({ width: '67%' });
    expect(screen.queryByTestId('today-group-board-row-me')).toBeNull();
    expect(byId('today-group-board-me-rank')).toHaveTextContent('You · 4th');
    expect(byId('today-group-board-me-working-sets')).toHaveTextContent('21');

    fireEvent.press(byId('today-group-latest-completed'));
    fireEvent.press(byId('today-group-board'));
    fireEvent.press(byId('today-view-groups-button'));
    expect(mockPush.mock.calls).toEqual([
      ['/group-session/dave/dave-done'],
      ['/groups?groupId=g1'],
      ['/groups?groupId=g1'],
    ]);
  });

  it('with several groups: shows the switcher on the Groups screen pick, and a pick moves both', async () => {
    setLastViewedGroupId('g2');
    api.listMyGroups.mockResolvedValue({ groups: [IRON, LUNCH] });
    api.getGroupWeekSummary.mockImplementation(async ({ groupId }) =>
      summary({ members: [{ rank: 1, member: member(groupId === 'g1' ? 'dave' : 'lena'), working_sets: 5, group_records: 0 }] }),
    );
    await renderToday();

    await waitFor(() => expect(byId('today-group-board-row-lena')).toBeTruthy());
    expect(byId('today-group-switcher')).toBeTruthy();
    expect(byId('today-group-board-title')).toHaveTextContent('This week');
    expect(api.getGroupWeekSummary).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'g2' }));

    fireEvent.press(within(byId('today-group-switcher')).getByTestId('groups-stream-filter-g1'));
    await waitFor(() => expect(byId('today-group-board-row-dave')).toBeTruthy());
    expect(api.getGroupWeekSummary).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 'g1' }));
    expect(getLastViewedGroupId()).toBe('g1');
  });

  it('opens one member training now on their session, and several on the group', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getGroupWeekSummary.mockResolvedValueOnce(summary({ training_now: [live('maria')] }));
    const view = await renderToday();

    await waitFor(() => expect(byId('today-group-latest-training')).toBeTruthy());
    expect(within(byId('today-group-latest-status')).getByText('Training now')).toBeTruthy();
    fireEvent.press(byId('today-group-latest-training'));
    expect(mockPush).toHaveBeenLastCalledWith('/group-session/maria/maria-live');
    view.unmount();

    api.getGroupWeekSummary.mockResolvedValueOnce(summary({ training_now: [live('maria'), live('sam'), live('tom')] }));
    await renderToday();
    await waitFor(() => expect(byId('today-group-latest-title')).toHaveTextContent('3 training now'));
    expect(screen.getByText('maria, sam and tom')).toBeTruthy();
    fireEvent.press(byId('today-group-latest-several'));
    expect(mockPush).toHaveBeenLastCalledWith('/groups?groupId=g1');
  });

  it('says so when the group has no shared session yet', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getGroupWeekSummary.mockResolvedValue(summary({ latest_completed: null }));
    await renderToday();

    await waitFor(() => expect(byId('today-group-latest-empty')).toBeTruthy());
  });
});

describe('Today: the group card offline and on errors', () => {
  it('keeps the cached week, with the offline marker, when the device goes offline', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [IRON] });
    api.getGroupWeekSummary.mockResolvedValue(summary());
    const view = await renderToday();
    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    view.unmount();

    mockInitialOnline = false;
    api.getGroupWeekSummary.mockClear();
    await renderToday();

    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    expect(byId('groups-offline-banner')).toBeTruthy();
    expect(byId('today-group-board-me-rank')).toHaveTextContent('You · 4th');
    expect(api.getGroupWeekSummary).not.toHaveBeenCalled();
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
    api.getGroupWeekSummary.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'Server unavailable'));
    api.getGroupWeekSummary.mockResolvedValueOnce(summary());
    const view = await renderToday();

    await waitFor(() => expect(byId('today-group-error-state')).toBeTruthy());
    await act(async () => {
      fireEvent.press(byId('today-group-error-state-retry'));
    });
    await waitFor(() => expect(byId('today-group-card')).toBeTruthy());
    view.unmount();

    api.getGroupWeekSummary.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'Server unavailable'));
    api.getGroupWeekSummary.mockResolvedValueOnce(summary());
    await renderToday();
    await waitFor(() => expect(byId('today-group-inline-error')).toBeTruthy());
    expect(byId('today-group-card')).toBeTruthy();
    await act(async () => {
      fireEvent.press(byId('today-group-inline-error-retry'));
    });
    await waitForGone('today-group-inline-error');
  });

  it('moves to a remaining group when access to the shown one is lost', async () => {
    api.listMyGroups.mockResolvedValueOnce({ groups: [IRON, LUNCH] }).mockResolvedValue({ groups: [LUNCH] });
    api.getGroupWeekSummary.mockImplementation(async ({ groupId }) => {
      if (groupId === 'g1') throw new GroupApiError('NOT_FOUND', 'group not found');
      return summary({ members: [{ rank: 1, member: member('lena'), working_sets: 5, group_records: 0 }] });
    });
    await renderToday();

    await waitFor(() => expect(byId('today-group-board-row-lena')).toBeTruthy());
    expect(screen.queryByTestId('today-group-switcher')).toBeNull();
    expect(byId('today-group-board-title')).toHaveTextContent('Lunch Club · this week');
  });
});
