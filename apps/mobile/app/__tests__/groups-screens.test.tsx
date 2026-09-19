/* eslint-disable import/first */

/**
 * M22-T04 group screens (groups contract §6.3, §7; task card flows 1–4): the
 * Groups tab, My groups, the group screen, and the friend's session view.
 * The four read RPCs are mocked; the cache is the real `group_cache` on the
 * shared in-memory SQLite fixture, so cache-first render, offline, and
 * NOT_FOUND eviction run through the production hooks.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
const mockCurrentDatabase = () => fixture.database;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(mockCurrentDatabase()),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: () => () => undefined },
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: { Screen: () => null },
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
  getGroup: jest.fn(),
  getGroupStream: jest.fn(),
  getGroupSessionDetail: jest.fn(),
  listGroupExercises: jest.fn(),
  getGroupBoardPodiums: jest.fn(),
}));

import { MainTabs } from '@/components/navigation/main-tabs';
import {
  GroupApiError,
  groupCacheKeys,
  mergeStreamPages,
  readGroupCache,
  setLastViewedGroupId,
  writeGroupCache,
  type GroupGetResult,
  type GroupSessionDetailResult,
  type GroupStreamResult,
  type GroupSummary,
  type StreamItem,
  type StreamMembershipItem,
  type StreamSessionItem,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { resolveMainTab } from '@/src/navigation/main-tabs';

import GroupsTabRoute from '../(tabs)/groups';
import GroupScreenRoute from '../group/[groupId]/index';
import GroupMembersRoute from '../group/[groupId]/members';
import MyGroupsRoute from '../group/mine';
import GroupSessionRoute from '../group-session/[memberId]/[sessionId]';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

const USER_ID = 'user-me';
/** 09:05 local, so "last updated 09:05" holds in any time zone. */
const T0 = new Date(2026, 8, 11, 9, 5).getTime();

const GROUP_A: GroupSummary = { group_id: 'group-a', name: 'Garage Gym', description: 'Early crew', member_count: 3, my_role: 'owner' };
const GROUP_B: GroupSummary = { group_id: 'group-b', name: 'Lunch Lifters', description: null, member_count: 2, my_role: 'member' };

const completedItem = (overrides: Partial<StreamSessionItem> = {}): StreamSessionItem => ({
  kind: 'session',
  key: 'friend-1:s-1',
  sort_at_ms: T0,
  member: { user_id: 'friend-1', username: 'alex' },
  session_id: 's-1',
  groups: [{ group_id: 'group-a', name: 'Garage Gym' }],
  gym_name: 'Iron Temple',
  status: 'completed',
  started_at_ms: T0,
  completed_at_ms: T0 + 3_900_000,
  duration_sec: 3900,
  exercises: [
    {
      session_exercise_id: 'ex-1',
      name: 'Bench Press',
      machine_name: null,
      order_index: 0,
      sets: [
        { set_id: 'b-1', order_index: 0, weight_value: '100', reps_value: '5', set_type: 'working', performance_status: null },
        { set_id: 'b-2', order_index: 1, weight_value: '102.5', reps_value: '5', set_type: 'working', performance_status: null },
      ],
    },
    {
      session_exercise_id: 'ex-2',
      name: 'Barbell Row',
      machine_name: null,
      order_index: 1,
      sets: [{ set_id: 'r-1', order_index: 0, weight_value: '60', reps_value: '10', set_type: 'warm_up', performance_status: null }],
    },
  ],
  ...overrides,
});

const liveItem = completedItem({
  key: 'friend-2:s-2',
  sort_at_ms: T0 + 60_000,
  member: { user_id: 'friend-2', username: 'sam' },
  session_id: 's-2',
  groups: [{ group_id: 'group-b', name: 'Lunch Lifters' }],
  status: 'active',
  started_at_ms: T0 + 60_000,
  completed_at_ms: null,
  duration_sec: null,
});

const joinedItem: StreamMembershipItem = {
  kind: 'membership',
  key: 'm-1:joined',
  sort_at_ms: T0 - 60_000,
  event: 'joined',
  group: { group_id: 'group-b', name: 'Lunch Lifters' },
  member: { user_id: 'friend-3', username: null },
};

const page = (items: StreamItem[], overrides: Partial<GroupStreamResult> = {}): GroupStreamResult => ({
  items,
  next_cursor: null,
  has_more: false,
  ...overrides,
});

const GROUP_A_DETAIL: GroupGetResult = {
  group: GROUP_A,
  members: [
    { user_id: USER_ID, username: 'me', role: 'owner' },
    { user_id: 'u-admin', username: 'bea', role: 'admin' },
    { user_id: 'friend-1', username: 'alex', role: 'member' },
    { user_id: 'u-anon', username: null, role: 'member' },
  ],
};

const sessionDetail = (overrides: Partial<GroupSessionDetailResult['session']> = {}): GroupSessionDetailResult => ({
  session: {
    member: { user_id: 'friend-1', username: 'alex' },
    session_id: 's-1',
    gym_name: 'Iron Temple',
    status: 'completed',
    started_at_ms: T0,
    completed_at_ms: T0 + 3_900_000,
    duration_sec: 3900,
    exercises: [
      {
        session_exercise_id: 'ex-1',
        name: 'Bench Press',
        machine_name: 'Flat bench',
        order_index: 0,
        sets: [
          { set_id: 'set-1', order_index: 0, weight_value: '60', reps_value: '10', set_type: 'warm_up', performance_status: null },
          { set_id: 'set-2', order_index: 1, weight_value: '102.5', reps_value: '5', set_type: 'rir_1', performance_status: null },
          { set_id: 'set-3', order_index: 2, weight_value: '110', reps_value: '5', set_type: 'rir_1', performance_status: 'planned' },
        ],
      },
    ],
    ...overrides,
  },
});

const seed = (cacheKey: string, payload: unknown) =>
  writeGroupCache(fixture.database, { cacheKey, userId: USER_ID, payload, fetchedAtMs: T0 });

const cached = (cacheKey: string) => readGroupCache(fixture.database, cacheKey, USER_ID);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const networkError = () => new GroupApiError('NETWORK', 'Network request failed.');
const notFound = () => new GroupApiError('NOT_FOUND', 'group not found');

const pullToRefresh = async (testID: string) => {
  await act(async () => {
    screen.getByTestId(testID).props.refreshControl.props.onRefresh();
  });
};

const cardID = (key: string) => `group-stream-session-card-${key}`;

beforeEach(() => {
  jest.clearAllMocks();
  fixture = createInMemoryDatabase();
  mockParams = {};
  setLastViewedGroupId(null);
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: USER_ID } });
  api.listMyGroups.mockResolvedValue({ groups: [GROUP_A, GROUP_B] });
  api.getGroupStream.mockResolvedValue(page([]));
  api.getGroup.mockResolvedValue(GROUP_A_DETAIL);
  api.getGroupSessionDetail.mockResolvedValue(sessionDetail());
  api.listGroupExercises.mockResolvedValue({ exercises: [] } as unknown as Awaited<ReturnType<typeof api.listGroupExercises>>);
  api.getGroupBoardPodiums.mockResolvedValue({ exercises: [] } as unknown as Awaited<ReturnType<typeof api.getGroupBoardPodiums>>);
});

afterEach(() => {
  fixture.close();
});

describe('Groups tab', () => {
  it('has no Back to More affordance, whichever way it was opened', async () => {
    mockParams = { source: 'more' };
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-title')).toBeTruthy();
    expect(screen.queryByTestId('back-to-more-button')).toBeNull();
  });

  it('shows the sign-in-required state when signed out or unconfigured, and calls no group RPC', () => {
    mockUseAuth.mockReturnValue({ isConfigured: true, user: null });
    render(<GroupsTabRoute />);
    expect(screen.getByTestId('groups-signed-out-state')).toBeTruthy();
    fireEvent.press(screen.getByTestId('groups-sign-in-button'));
    expect(mockPush).toHaveBeenCalledWith(SIGN_IN_ROUTE);

    mockUseAuth.mockReturnValue({ isConfigured: false, user: null });
    screen.rerender(<GroupsTabRoute />);
    expect(screen.getByText('Groups need an account, and sign-in is not available in this build.')).toBeTruthy();
    expect(screen.queryByTestId('groups-sign-in-button')).toBeNull();
    expect(api.listMyGroups).not.toHaveBeenCalled();
    expect(api.getGroupStream).not.toHaveBeenCalled();
  });

  it('shows the explanatory empty state when the user has no groups', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [] });
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-empty-state')).toBeTruthy();
    expect(screen.getByText('No groups yet')).toBeTruthy();
    expect(screen.queryByTestId('groups-stream-filter-row')).toBeNull();
  });

  it("renders the first group's cached stream at once, then newest-first cards", async () => {
    seed(groupCacheKeys.mine, { groups: [GROUP_A, GROUP_B] });
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    const fresh = deferred<GroupStreamResult>();
    api.getGroupStream.mockReturnValue(fresh.promise);

    render(<GroupsTabRoute />);
    expect(await screen.findByTestId(cardID('friend-1:s-1'))).toBeTruthy();
    expect(screen.queryByTestId(cardID('friend-2:s-2'))).toBeNull();

    await act(async () => {
      fresh.resolve(page([liveItem, completedItem(), joinedItem]));
    });
    await screen.findByTestId(cardID('friend-2:s-2'));

    const order = screen
      .getAllByTestId(/-member$|^group-stream-membership-/)
      .map((node) => node.props.testID as string);
    expect(order).toEqual([`${cardID('friend-2:s-2')}-member`, `${cardID('friend-1:s-1')}-member`, 'group-stream-membership-m-1:joined']);

    const completed = within(screen.getByTestId(cardID('friend-1:s-1')));
    expect(completed.getByText('alex')).toBeTruthy();
    expect(completed.getByText('Completed · 1h 5m')).toBeTruthy();
    expect(completed.getByText('9/11 09:05 · Iron Temple')).toBeTruthy();
    expect(completed.getByText('3 sets · 1,612.5 kg · 2 exercises')).toBeTruthy();
    // One group's stream does not repeat the group name on each card.
    expect(completed.queryByText('Garage Gym')).toBeNull();
    expect(within(screen.getByTestId(cardID('friend-2:s-2'))).getByText('Training now')).toBeTruthy();
    expect(screen.getByText('Unnamed member joined')).toBeTruthy();
    expect(api.getGroupStream).toHaveBeenCalledWith({ groupId: 'group-a' });
    expect(api.getGroupStream).not.toHaveBeenCalledWith({ groupId: null });

    fireEvent.press(screen.getByTestId(cardID('friend-1:s-1')));
    expect(mockPush).toHaveBeenLastCalledWith('/group-session/friend-1/s-1');
    // Already on this group: membership items do not navigate.
    fireEvent.press(screen.getByTestId('group-stream-membership-m-1:joined'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('groups-my-groups-button'));
    expect(mockPush).toHaveBeenLastCalledWith('/group/mine');
  });

  it('always shows one group: chips switch it, and there is no All chip', async () => {
    api.getGroupStream.mockImplementation(async ({ groupId }) =>
      groupId === 'group-b' ? page([liveItem]) : page([completedItem()]),
    );
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-1:s-1'));
    expect(screen.queryByTestId('groups-stream-filter-all')).toBeNull();
    expect(screen.getByTestId('groups-stream-filter-group-a').props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(screen.getByTestId('groups-stream-filter-group-b'));
    await waitFor(() => expect(screen.queryByTestId(cardID('friend-1:s-1'))).toBeNull());
    await screen.findByTestId(cardID('friend-2:s-2'));
    expect(api.getGroupStream).toHaveBeenCalledWith({ groupId: 'group-b' });
  });

  it('opens on the group named by ?groupId=', async () => {
    mockParams = { groupId: 'group-b' };
    api.getGroupStream.mockImplementation(async ({ groupId }) =>
      groupId === 'group-b' ? page([liveItem]) : page([completedItem()]),
    );
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-2:s-2'));
    expect(screen.getByTestId('groups-stream-filter-group-b').props.accessibilityState).toEqual({ selected: true });
    expect(api.getGroupStream).not.toHaveBeenCalledWith({ groupId: 'group-a' });
  });

  it('a new ?groupId= link selects that group and opens its Stream', async () => {
    api.getGroupStream.mockImplementation(async ({ groupId }) =>
      groupId === 'group-b' ? page([liveItem]) : page([completedItem()]),
    );
    render(<GroupsTabRoute />);
    fireEvent.press(await screen.findByTestId('groups-segment-leaderboards'));
    expect(await screen.findByTestId('group-leaderboards-empty')).toBeTruthy();

    mockParams = { groupId: 'group-b' };
    screen.rerender(<GroupsTabRoute />);
    expect(await screen.findByTestId(cardID('friend-2:s-2'))).toBeTruthy();
    expect(screen.getByTestId('groups-segment-stream').props.accessibilityState).toEqual({ selected: true });
  });

  it('reopens on the group last viewed', async () => {
    api.getGroupStream.mockImplementation(async ({ groupId }) =>
      groupId === 'group-b' ? page([liveItem]) : page([completedItem()]),
    );
    const first = render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-1:s-1'));
    fireEvent.press(screen.getByTestId('groups-stream-filter-group-b'));
    await screen.findByTestId(cardID('friend-2:s-2'));
    first.unmount();

    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-2:s-2'));
    expect(screen.getByTestId('groups-stream-filter-group-b').props.accessibilityState).toEqual({ selected: true });
  });

  it("switches to the selected group's leaderboards", async () => {
    render(<GroupsTabRoute />);
    await screen.findByTestId('groups-segment-leaderboards');
    expect(api.getGroupBoardPodiums).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('groups-segment-leaderboards'));
    expect(await screen.findByTestId('group-leaderboards-empty')).toBeTruthy();
    expect(api.getGroupBoardPodiums).toHaveBeenCalledWith('group-a');
  });

  it('pull-to-refresh refetches My groups and the stream', async () => {
    api.getGroupStream.mockResolvedValue(page([completedItem()]));
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-1:s-1'));
    await waitFor(() => expect(api.listMyGroups).toHaveBeenCalledTimes(1));
    const streamCalls = api.getGroupStream.mock.calls.length;

    await pullToRefresh('groups-stream-list');
    await waitFor(() => expect(api.getGroupStream.mock.calls.length).toBe(streamCalls + 1));
    expect(api.listMyGroups).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached stream under the offline marker when the refresh fails with NETWORK (AC12)', async () => {
    seed(groupCacheKeys.mine, { groups: [GROUP_A] });
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    api.listMyGroups.mockRejectedValue(networkError());
    api.getGroupStream.mockRejectedValue(networkError());

    render(<GroupsTabRoute />);
    expect(await screen.findByText('Offline · last updated 09:05')).toBeTruthy();
    expect(screen.getByTestId(cardID('friend-1:s-1'))).toBeTruthy();
    expect(screen.queryByTestId('groups-inline-error')).toBeNull();
  });

  it('shows the offline empty state when offline with nothing cached', async () => {
    api.listMyGroups.mockRejectedValue(networkError());
    api.getGroupStream.mockRejectedValue(networkError());
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-offline-empty-state')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('shows an error with Retry on a non-network failure, and Retry loads the stream', async () => {
    api.listMyGroups.mockRejectedValue(new GroupApiError('INTERNAL', 'Groups are unavailable in this build.'));
    api.getGroupStream.mockRejectedValue(new GroupApiError('INTERNAL', 'Groups are unavailable in this build.'));
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-error-state')).toBeTruthy();
    expect(screen.getByText('Groups are unavailable in this build.')).toBeTruthy();

    api.listMyGroups.mockResolvedValue({ groups: [GROUP_A] });
    api.getGroupStream.mockResolvedValue(page([completedItem()]));
    fireEvent.press(screen.getByTestId('groups-error-state-retry'));
    expect(await screen.findByTestId(cardID('friend-1:s-1'))).toBeTruthy();
  });

  it('shows the error inline, above cached cards, when data is already on screen', async () => {
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    api.getGroupStream.mockRejectedValue(new GroupApiError('INTERNAL', 'group_stream returned an unexpected payload.'));
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-inline-error')).toBeTruthy();
    expect(screen.getByTestId(cardID('friend-1:s-1'))).toBeTruthy();
  });

  it('loads older pages online at the end of the list (infinite scroll)', async () => {
    const cursor = { sort_at_ms: liveItem.sort_at_ms, kind: 'session' as const, key: liveItem.key };
    api.getGroupStream.mockImplementation(async ({ before }) =>
      before ? page([completedItem()]) : page([liveItem], { has_more: true, next_cursor: cursor }),
    );
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-2:s-2'));

    await act(async () => {
      fireEvent(screen.getByTestId('groups-stream-list'), 'onEndReached');
    });
    expect(await screen.findByTestId(cardID('friend-1:s-1'))).toBeTruthy();
    expect(api.getGroupStream).toHaveBeenCalledWith({ groupId: 'group-a', before: cursor });
  });
});

describe('mergeStreamPages', () => {
  const older = { items: [completedItem(), joinedItem], cursor: null, hasMore: false };

  it('keeps only older items after the refreshed first page boundary, deduplicated by key', () => {
    const boundary = { sort_at_ms: T0, kind: 'session' as const, key: 'friend-1:s-1' };
    const first = page([liveItem, completedItem()], { has_more: true, next_cursor: boundary });
    expect(mergeStreamPages(first, older).map((item) => item.key)).toEqual(['friend-2:s-2', 'friend-1:s-1', 'm-1:joined']);
  });

  it('ignores older pages once the first page is the whole stream', () => {
    expect(mergeStreamPages(page([liveItem]), older).map((item) => item.key)).toEqual(['friend-2:s-2']);
  });
});

describe('My groups', () => {
  it('lists my groups with count and role, and opens one', async () => {
    render(<MyGroupsRoute />);
    const row = await screen.findByTestId('group-summary-row-group-a');
    expect(within(row).getByText("3 members · You're the owner")).toBeTruthy();
    expect(screen.getByText("2 members · You're a member")).toBeTruthy();
    fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith('/group/group-a');
  });

  it('holds the Join and Create actions', async () => {
    render(<MyGroupsRoute />);
    fireEvent.press(await screen.findByTestId('group-mine-join-button'));
    expect(mockPush).toHaveBeenLastCalledWith('/group/join');
    fireEvent.press(screen.getByTestId('group-mine-create-button'));
    expect(mockPush).toHaveBeenLastCalledWith('/group/new');
  });

  it('shows the empty state when there are no groups', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [] });
    render(<MyGroupsRoute />);
    expect(await screen.findByTestId('group-mine-empty-state')).toBeTruthy();
  });
});

describe('Group screen', () => {
  beforeEach(() => {
    mockParams = { groupId: 'group-a' };
  });

  it('is for managing the group: header and exercises, no stream or leaderboards', async () => {
    render(<GroupScreenRoute />);
    expect(await screen.findByTestId('group-screen-name')).toBeTruthy();
    expect(screen.getByText('Garage Gym')).toBeTruthy();
    expect(screen.getByText('Early crew')).toBeTruthy();
    expect(screen.getByText("3 members · You're the owner")).toBeTruthy();
    expect(screen.getByTestId('group-screen-exercises-title')).toBeTruthy();
    await waitFor(() => expect(api.listGroupExercises).toHaveBeenCalledWith('group-a'));
    expect(api.getGroupStream).not.toHaveBeenCalled();
    expect(screen.queryByTestId('group-screen-segment-row')).toBeNull();
    // D14: members live behind the header member count.
    fireEvent.press(screen.getByTestId('group-screen-members-link'));
    expect(mockPush).toHaveBeenCalledWith('/group/group-a/members');
  });

  it('the Members screen lists members sorted by role then username', async () => {
    render(<GroupMembersRoute />);
    await screen.findByTestId('group-members-list');
    const rows = screen.getAllByTestId(/^group-member-row-/).map((node) => node.props.testID as string);
    expect(rows).toEqual(['group-member-row-user-me', 'group-member-row-u-admin', 'group-member-row-friend-1', 'group-member-row-u-anon']);
    expect(screen.getByText('me (you)')).toBeTruthy();
    expect(screen.getByTestId('group-member-role-u-admin').props.children).toBe('Admin');
    expect(screen.getByText('Unnamed member')).toBeTruthy();
  });

  it("shows \"You're no longer a member\" after removal, hiding and evicting cached data (C3.6.8)", async () => {
    seed(groupCacheKeys.group('group-a'), GROUP_A_DETAIL);
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    seed(groupCacheKeys.session('friend-1', 's-1'), sessionDetail());
    api.getGroup.mockRejectedValue(notFound());
    api.listGroupExercises.mockRejectedValue(notFound());

    render(<GroupScreenRoute />);
    expect(await screen.findByTestId('group-screen-lost-access')).toBeTruthy();
    expect(screen.getByText("You're no longer a member of this group")).toBeTruthy();
    expect(screen.queryByText('Garage Gym')).toBeNull();
    expect(screen.queryByTestId(cardID('friend-1:s-1'))).toBeNull();
    await waitFor(() => expect(cached(groupCacheKeys.group('group-a'))).toBeNull());
    expect(cached(groupCacheKeys.stream('group-a'))).toBeNull();
    expect(cached(groupCacheKeys.session('friend-1', 's-1'))).toBeNull();
  });
});

describe("Friend's session view", () => {
  const OWNER_ACTION_TEST_IDS = [
    'completed-session-detail-action-bar',
    'completed-session-detail-edit-button',
    'completed-session-detail-delete-button',
    'completed-session-detail-append-exercise-button-ex-1',
  ];

  beforeEach(() => {
    mockParams = { memberId: 'friend-1', sessionId: 's-1' };
  });

  it('renders exercises with performed sets (kg, reps, effort) and no owner actions (AC6)', async () => {
    render(<GroupSessionRoute />);
    const warmUp = within(await screen.findByTestId('group-session-set-row-set-1'));
    expect(warmUp.getByText('60 kg')).toBeTruthy();
    expect(warmUp.getByText('10')).toBeTruthy();
    expect(warmUp.getByText('W-Up')).toBeTruthy();
    const working = within(screen.getByTestId('group-session-set-row-set-2'));
    expect(working.getByText('102.5 kg')).toBeTruthy();
    expect(working.getByText('RIR 1')).toBeTruthy();
    // The server sends the planned set too; the device shows performed sets only.
    expect(screen.queryByTestId('group-session-set-row-set-3')).toBeNull();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('alex')).toBeTruthy();
    expect(screen.getByText('Completed · 1h 5m')).toBeTruthy();
    expect(screen.getByText('2026-09-11 09:05')).toBeTruthy();
    expect(api.getGroupSessionDetail).toHaveBeenCalledWith('friend-1', 's-1');

    for (const testID of OWNER_ACTION_TEST_IDS) {
      expect(screen.queryByTestId(testID)).toBeNull();
    }
    for (const label of ['Edit', 'Delete', 'Append']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('shows "In progress" for an active session, and pull-to-refresh updates it', async () => {
    api.getGroupSessionDetail
      .mockResolvedValueOnce(sessionDetail({ status: 'active', completed_at_ms: null, duration_sec: null }))
      .mockResolvedValue(sessionDetail());
    render(<GroupSessionRoute />);
    expect(await screen.findByText('In progress')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();

    await pullToRefresh('group-session-screen');
    expect(await screen.findByText('Completed · 1h 5m')).toBeTruthy();
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('shows "This session is no longer available" on NOT_FOUND and evicts the cached detail', async () => {
    seed(groupCacheKeys.session('friend-1', 's-1'), sessionDetail());
    api.getGroupSessionDetail.mockRejectedValue(new GroupApiError('NOT_FOUND', 'session not found'));
    render(<GroupSessionRoute />);
    expect(await screen.findByTestId('group-session-unavailable')).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
    await waitFor(() => expect(cached(groupCacheKeys.session('friend-1', 's-1'))).toBeNull());
  });

  it('shows the cached detail under the offline marker when offline', async () => {
    seed(groupCacheKeys.session('friend-1', 's-1'), sessionDetail());
    api.getGroupSessionDetail.mockRejectedValue(networkError());
    render(<GroupSessionRoute />);
    expect(await screen.findByText('Offline · last updated 09:05')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
  });
});

describe('Groups ownership in the main navigation', () => {
  it('selects More for the preserved groups route', () => {
    const onSelect = jest.fn();
    render(
      <MainTabs activeTab="more" onSelect={onSelect} />,
    );
    const tab = screen.getByTestId('top-level-tab-more');
    expect(tab.props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(tab);
    expect(onSelect).toHaveBeenCalledWith('more');
    expect(resolveMainTab(['(tabs)', 'groups'])).toBe('more');
    expect(resolveMainTab(['(tabs)', 'stats-history'])).toBe('progress');
  });
});
