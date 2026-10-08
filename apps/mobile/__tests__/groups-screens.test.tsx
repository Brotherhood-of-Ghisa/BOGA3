/* eslint-disable import/first */

/**
 * group screens (groups contract): the
 * Groups tab, My groups, the group screen, and the friend's session view.
 * The four read RPCs are mocked; the cache is the real `group_cache` on the
 * shared in-memory SQLite fixture, so cache-first render, offline, and
 * NOT_FOUND eviction run through the production hooks.
 */

import * as mockReact from 'react';
import { Alert } from 'react-native';
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
  // The header's custom title and right action render inline, so a test can read them.
  Stack: { Screen: ({ options }: { options?: { headerTitle?: unknown; headerRight?: unknown } }) => mockReact.createElement(mockReact.Fragment, null,
    typeof options?.headerTitle === 'function' ? options.headerTitle({ children: '' }) : null,
    typeof options?.headerRight === 'function' ? options.headerRight({}) : null) },
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => {
  const streamRead = jest.fn();
  return {
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
  getGroup: jest.fn(),
  getCompetitionStream: streamRead,
  getCompetitionSession: jest.fn(),
  getCompetitionSessionRecords: jest.fn(),
  certifyCompetition: jest.fn(),
  getCompetitionCertification: jest.fn(),
  endCompetitionCertification: jest.fn(),
  listCompetitionExercises: jest.fn(),
  getCompetitionPodiums: jest.fn(),
  };
});

import { MainTabs } from '@/components/navigation/main-tabs';
import {
  GroupApiError,
  groupCacheKeys,
  mergeStreamPages,
  readGroupCache,
  getLastViewedGroupId,
  setLastViewedGroupId,
  writeGroupCache,
  type GroupGetResult,
  type GroupSummary,
  type StreamSessionItem,
} from '@/src/groups';
import type { CompetitionCertificationWire,CompetitionSessionRecordsWire,CompetitionStreamWire as GroupStreamResult,CompetitionStreamItemWire as StreamItem,CompetitionSessionDetailWire as GroupSessionDetailResult } from '@/src/groups/competition-wire';
import * as groupsApi from '@/src/groups/api';
import { SIGN_IN_ROUTE } from '@/src/navigation/routes';
import { resolveMainTab } from '@/src/navigation/main-tabs';

import GroupsTabRoute from '../app/(tabs)/groups';
import GroupScreenRoute from '../app/group/[groupId]/index';
import GroupMembersRoute from '../app/group/[groupId]/members';
import MyGroupsRoute from '../app/group/mine';
import GroupSessionRoute from '../app/group-session/[memberId]/[sessionId]';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

const USER_ID = 'user-me';
/** 09:05 local, so "last updated 09:05" holds in any time zone. */
const T0 = new Date(2026, 8, 11, 9, 5).getTime();

const GROUP_A: GroupSummary = { group_id: 'group-a', name: 'Garage Gym', description: 'Early crew', member_count: 3, my_role: 'owner', bodyweight_calculations_enabled: false };
const GROUP_B: GroupSummary = { group_id: 'group-b', name: 'Lunch Lifters', description: null, member_count: 2, my_role: 'member', bodyweight_calculations_enabled: false };

const completedItem = (overrides: Partial<StreamSessionItem> = {}): Extract<StreamItem,{ kind: 'session' }> => {
  const raw: StreamSessionItem={
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
  ...overrides };
  const { kind,key,sort_at_ms,groups,...session }=raw;
  return { kind,key,sort_at_ms,groups,session: { ...session,exercises: session.exercises.map(exercise=>({ ...exercise,visibility: 'ordinary',exercise_definition_id: null,load_input_mode: 'total_load' })) } };
};

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

const joinedItem: Extract<StreamItem,{ kind: 'membership' }> = {
  kind: 'membership',
  key: 'm-1:joined',
  sort_at_ms: T0 - 60_000,
  event: 'joined',
  group: { group_id: 'group-a', name: 'Garage Gym' },
  member: { user_id: 'friend-3', username: null },
};

const page = (items: StreamItem[], overrides: Partial<GroupStreamResult> = {}): GroupStreamResult => ({
  contract_version: 4,items,
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
  contract_version: 4,group_id: 'group-a',session: {
    member: { user_id: 'friend-1', username: 'alex' },
    session_id: 's-1',
    gym_name: 'Iron Temple',
    status: 'completed',
    started_at_ms: T0,
    completed_at_ms: T0 + 3_900_000,
    duration_sec: 3900,
    exercises: [
      {
        session_exercise_id: 'ex-1',visibility: 'ordinary',exercise_definition_id: null,load_input_mode: 'total_load',
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

const BENCH = { group_exercise_id: 'ge-bench', name: 'Bench', source_exercise_id: null, archived_at_ms: null,
  rules: { load_input_mode: 'total_load' as const, bodyweight_calculations_enabled: false, bodyweight_contribution: 0, default_metric: 'e1rm' as const, rules_revision: 1 },
  published_revision: 1, rebuilding: false };
const certificationBy = (user_id: string, username: string): CompetitionCertificationWire => ({ certification_id: 'cert-1', metric: 'e1rm',
  certified_by: { user_id, username }, certified_at_ms: T0, observed_rules_revision: 1, ended_at_ms: null, end_reason: null });
/** alex's 102.5 × 5 took #1 on 1RM (still held) and Volume (since passed by sam). */
const sessionRecords = ({ member = { user_id: 'friend-1', username: 'alex' }, certification = null as CompetitionCertificationWire | null,
  provisional = false } = {}): CompetitionSessionRecordsWire => ({
  contract_version: 4, group_id: 'group-a', member_user_id: member.user_id, session_id: 's-1',
  records: [{
    event: { event_id: 'ev-1', sequence: 7, kind: 'record', group: { group_id: 'group-a', name: 'Garage Gym' },
      group_exercise: { group_exercise_id: 'ge-bench', name: 'Bench' }, rules_revision: 1, representation_version: 4,
      visibility: 'ordinary', sort_at_ms: T0, member, metric: null, certified: null, reason: null, related_event_id: null,
      session_id: 's-1', set_id: 'set-2', reps: 5, provisional, voided: false,
      values: [{ role: 'record', metric: 'e1rm', unit: 'kg', value: 119.6, unavailable: false, member },
        { role: 'record', metric: 'volume', unit: 'kg_reps', value: 512.5, unavailable: false, member }],
      record_context: { exercise: BENCH, former: false, metrics: [
        { metric: 'e1rm', write_token: 'tok-1rm', eligible: true, certification },
        { metric: 'volume', write_token: 'tok-vol', eligible: true, certification: null }] } },
    boards: [{ metric: 'e1rm', leader: member, leads: true }, { metric: 'volume', leader: { user_id: 'friend-2', username: 'sam' }, leads: false }],
  }],
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
  api.getCompetitionStream.mockResolvedValue(page([]));
  api.getGroup.mockResolvedValue(GROUP_A_DETAIL);
  api.getCompetitionSession.mockResolvedValue(sessionDetail());
  api.getCompetitionSessionRecords.mockResolvedValue({ ...sessionRecords(), records: [] });
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [] } as unknown as Awaited<ReturnType<typeof api.listCompetitionExercises>>);
  api.getCompetitionPodiums.mockResolvedValue({ contract_version: 4,certified: true,podiums: [] });
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
    expect(api.getCompetitionStream).not.toHaveBeenCalled();
  });

  it('shows the explanatory empty state when the user has no groups', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [] });
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-empty-state')).toBeTruthy();
    expect(screen.getByText('No groups yet')).toBeTruthy();
    expect(screen.queryByTestId('groups-stream-filter-row')).toBeNull();
    // No group selected: the stream reads nothing (there is no all-groups stream).
    expect(api.getCompetitionStream).not.toHaveBeenCalled();
  });

  it("renders the first group's cached stream at once, then newest-first cards", async () => {
    seed(groupCacheKeys.mine, { groups: [GROUP_A, GROUP_B] });
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    const fresh = deferred<GroupStreamResult>();
    api.getCompetitionStream.mockReturnValue(fresh.promise);

    render(<GroupsTabRoute />);
    expect(await screen.findByTestId(cardID('friend-1:s-1'))).toBeTruthy();
    expect(screen.queryByTestId(cardID('friend-2:s-2'))).toBeNull();

    await act(async () => {
      fresh.resolve(page([{ ...liveItem,groups: [{ group_id: 'group-a',name: 'Garage Gym' }] },completedItem(),joinedItem]));
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
    // The 60 × 10 warm-up adds no set, no volume and, alone on its exercise, no exercise.
    expect(completed.getByText('2 sets · 1 exercise')).toBeTruthy();
    // One group's stream does not repeat the group name on each card.
    expect(completed.queryByText('Garage Gym')).toBeNull();
    expect(within(screen.getByTestId(cardID('friend-2:s-2'))).getByText('Training now')).toBeTruthy();
    expect(screen.getByText('Unnamed member joined')).toBeTruthy();
    expect(api.getCompetitionStream).toHaveBeenCalledWith('group-a');

    fireEvent.press(screen.getByTestId(cardID('friend-1:s-1')));
    expect(mockPush).toHaveBeenLastCalledWith('/group-session/friend-1/s-1?groupId=group-a');
    // Already on this group: membership items do not navigate.
    fireEvent.press(screen.getByTestId('group-stream-membership-m-1:joined'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('groups-my-groups-button'));
    expect(mockPush).toHaveBeenLastCalledWith('/group/mine');
  });

  it('always shows one group: chips switch it, and there is no All chip', async () => {
    api.getCompetitionStream.mockImplementation(async (groupId) =>
      groupId === 'group-b' ? page([liveItem]) : page([completedItem()]),
    );
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-1:s-1'));
    expect(screen.queryByTestId('groups-stream-filter-all')).toBeNull();
    expect(screen.getByTestId('groups-stream-filter-group-a').props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(screen.getByTestId('groups-stream-filter-group-b'));
    await waitFor(() => expect(screen.queryByTestId(cardID('friend-1:s-1'))).toBeNull());
    await screen.findByTestId(cardID('friend-2:s-2'));
    expect(api.getCompetitionStream).toHaveBeenCalledWith('group-b');
  });

  it('opens on the group named by ?groupId=', async () => {
    mockParams = { groupId: 'group-b' };
    api.getCompetitionStream.mockImplementation(async (groupId) =>
      groupId === 'group-b' ? page([liveItem]) : page([completedItem()]),
    );
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-2:s-2'));
    expect(screen.getByTestId('groups-stream-filter-group-b').props.accessibilityState).toEqual({ selected: true });
    expect(api.getCompetitionStream).not.toHaveBeenCalledWith('group-a');
  });

  it('a new ?groupId= link selects that group and opens its Stream', async () => {
    api.getCompetitionStream.mockImplementation(async (groupId) =>
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
    api.getCompetitionStream.mockImplementation(async (groupId) =>
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

  it("shares its selection with Today's group card: a later pick there wins over an earlier chip here", async () => {
    api.getCompetitionStream.mockImplementation(async (groupId) =>
      groupId === 'group-b' ? page([liveItem]) : page([completedItem()]),
    );
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-1:s-1'));
    fireEvent.press(screen.getByTestId('groups-stream-filter-group-b'));
    await screen.findByTestId(cardID('friend-2:s-2'));
    expect(getLastViewedGroupId()).toBe('group-b');

    // Today's card picks group A while this screen stays mounted.
    setLastViewedGroupId('group-a');
    screen.rerender(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-1:s-1'));
    expect(screen.getByTestId('groups-stream-filter-group-a').props.accessibilityState).toEqual({ selected: true });
  });

  it("switches to the selected group's leaderboards", async () => {
    render(<GroupsTabRoute />);
    await screen.findByTestId('groups-segment-leaderboards');
    expect(api.getCompetitionPodiums).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('groups-segment-leaderboards'));
    expect(await screen.findByTestId('group-leaderboards-empty')).toBeTruthy();
    expect(api.getCompetitionPodiums).toHaveBeenCalledWith('group-a');
  });

  it('pull-to-refresh refetches My groups and the stream', async () => {
    api.getCompetitionStream.mockResolvedValue(page([completedItem()]));
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-1:s-1'));
    await waitFor(() => expect(api.listMyGroups).toHaveBeenCalledTimes(1));
    const streamCalls = api.getCompetitionStream.mock.calls.length;

    await pullToRefresh('groups-stream-list');
    await waitFor(() => expect(api.getCompetitionStream.mock.calls.length).toBe(streamCalls + 1));
    expect(api.listMyGroups).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached stream under the offline marker when the refresh fails with NETWORK', async () => {
    seed(groupCacheKeys.mine, { groups: [GROUP_A] });
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    api.listMyGroups.mockRejectedValue(networkError());
    api.getCompetitionStream.mockRejectedValue(networkError());

    render(<GroupsTabRoute />);
    expect(await screen.findByText('Offline · last updated 09:05')).toBeTruthy();
    expect(await screen.findByTestId(cardID('friend-1:s-1'))).toBeTruthy();
    expect(screen.queryByTestId('groups-inline-error')).toBeNull();
  });

  it('shows the offline empty state when offline with nothing cached', async () => {
    api.listMyGroups.mockRejectedValue(networkError());
    api.getCompetitionStream.mockRejectedValue(networkError());
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-offline-empty-state')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('shows an error with Retry on a non-network failure, and Retry loads the stream', async () => {
    api.listMyGroups.mockRejectedValue(new GroupApiError('INTERNAL', 'Groups are unavailable in this build.'));
    api.getCompetitionStream.mockRejectedValue(new GroupApiError('INTERNAL', 'Groups are unavailable in this build.'));
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-error-state')).toBeTruthy();
    expect(screen.getByText('Groups are unavailable in this build.')).toBeTruthy();

    api.listMyGroups.mockResolvedValue({ groups: [GROUP_A] });
    api.getCompetitionStream.mockResolvedValue(page([completedItem()]));
    fireEvent.press(screen.getByTestId('groups-error-state-retry'));
    expect(await screen.findByTestId(cardID('friend-1:s-1'))).toBeTruthy();
  });

  it('shows the error inline, above cached cards, when data is already on screen', async () => {
    seed(groupCacheKeys.mine,{ groups: [GROUP_A,GROUP_B] });
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    api.getCompetitionStream.mockRejectedValue(new GroupApiError('INTERNAL', 'group_stream returned an unexpected payload.'));
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('groups-inline-error')).toBeTruthy();
    expect(screen.getByTestId(cardID('friend-1:s-1'))).toBeTruthy();
  });

  it('loads older pages online at the end of the list (infinite scroll)', async () => {
    const cursor='opaque-server-cursor';
    api.getCompetitionStream.mockImplementation(async (_groupId,before) =>
      before ? page([completedItem()]) : page([{ ...liveItem,groups: [{ group_id: 'group-a',name: 'Garage Gym' }] }], { has_more: true, next_cursor: cursor }),
    );
    render(<GroupsTabRoute />);
    await screen.findByTestId(cardID('friend-2:s-2'));

    await act(async () => {
      fireEvent(screen.getByTestId('groups-stream-list'), 'onEndReached');
    });
    expect(await screen.findByTestId(cardID('friend-1:s-1'))).toBeTruthy();
    expect(api.getCompetitionStream).toHaveBeenCalledWith('group-a',cursor);
  });
});

describe('mergeStreamPages', () => {
  const older = { items: [completedItem(), joinedItem], cursor: null, hasMore: false };

  it('keeps only older items after the refreshed first page boundary, deduplicated by key', () => {
    const boundary='opaque-boundary';
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
    await waitFor(() => expect(api.listCompetitionExercises).toHaveBeenCalledWith('group-a'));
    expect(api.getCompetitionStream).not.toHaveBeenCalled();
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
    expect(screen.getByTestId('group-member-role-u-admin')).toHaveTextContent('Admin');
    expect(screen.getByText('Unnamed member')).toBeTruthy();
  });

  it("shows \"You're no longer a member\" after removal, hiding and evicting cached data", async () => {
    seed(groupCacheKeys.group('group-a'), GROUP_A_DETAIL);
    seed(groupCacheKeys.stream('group-a'), page([completedItem()]));
    seed(groupCacheKeys.session('group-a','friend-1', 's-1'), sessionDetail());
    api.getGroup.mockRejectedValue(notFound());
    api.listCompetitionExercises.mockRejectedValue(notFound());

    render(<GroupScreenRoute />);
    expect(await screen.findByTestId('group-screen-lost-access')).toBeTruthy();
    expect(screen.getByText("You're no longer a member of this group")).toBeTruthy();
    expect(screen.queryByText('Garage Gym')).toBeNull();
    expect(screen.queryByTestId(cardID('friend-1:s-1'))).toBeNull();
    await waitFor(() => expect(cached(groupCacheKeys.group('group-a'))).toBeNull());
    expect(cached(groupCacheKeys.stream('group-a'))).toBeNull();
    expect(cached(groupCacheKeys.session('group-a','friend-1', 's-1'))).toBeNull();
  });
});

describe("Friend's session view", () => {
  const OWNER_ACTION_TEST_IDS = [
    'completed-session-detail-options-button',
    'completed-session-detail-edit-button',
    'completed-session-detail-delete-button',
    'completed-session-detail-exercise-options-ex-1',
  ];

  beforeEach(() => {
    mockParams = { groupId: 'group-a',memberId: 'friend-1',sessionId: 's-1' };
  });

  it('renders exercises with performed sets (weight × reps, effort, 1RM, volume) and no owner actions', async () => {
    render(<GroupSessionRoute />);
    // The session view's row, from the shared session-detail cards.
    const warmUp = within(await screen.findByTestId('group-session-set-row-set-1'));
    expect(warmUp.getByText('60.0 × 10')).toBeTruthy();
    expect(warmUp.getByText('W-Up')).toBeTruthy();
    expect(warmUp.getByLabelText('Vol 600')).toBeTruthy();
    const working = within(screen.getByTestId('group-session-set-row-set-2'));
    expect(working.getByText(/^102\.5 × \d+$/)).toBeTruthy();
    expect(working.getByText('RIR 1')).toBeTruthy();
    // No personal record band: the friend's history is not on this device.
    expect(screen.queryByText(/New 1RM record/)).toBeNull();
    // The header: whose session, which day, seen as which group.
    expect(screen.getByTestId('group-session-title-text')).toHaveTextContent('alex · Fri 11 Sep');
    expect(screen.getByTestId('group-session-eyebrow')).toHaveTextContent('Garage Gym · group view');
    expect(screen.queryByTestId('group-session-full-view')).toBeNull();
    // Volume sums the ordinary volume-included sets: the warm-up is left out.
    expect(screen.getByTestId('group-session-volume').props.accessibilityLabel).toBe('Volume 513');
    // The server sends the planned set too; the device shows performed sets only.
    expect(screen.queryByTestId('group-session-set-row-set-3')).toBeNull();
    // `Sets` counts working sets: the warm-up keeps its row but is no set.
    expect(screen.getByTestId('group-session-sets').props.accessibilityLabel).toBe('Sets 1');
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Completed · 1h 5m')).toBeTruthy();
    expect(screen.queryByTestId('group-session-records')).toBeNull();
    expect(screen.getByText('2026-09-11 09:05')).toBeTruthy();
    expect(api.getCompetitionSession).toHaveBeenCalledWith('group-a','friend-1','s-1');

    for (const testID of OWNER_ACTION_TEST_IDS) {
      expect(screen.queryByTestId(testID)).toBeNull();
    }
    for (const label of ['Edit', 'Delete', 'Append']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('normalized sessions show reps and effort without kg, 1RM or Volume, and no Volume total',async()=>{
    const safe=sessionDetail();
    api.getCompetitionSession.mockResolvedValue({ ...safe,session: { ...safe.session,exercises: safe.session.exercises.map(exercise=>({
      ...exercise,visibility: 'normalized',sets: exercise.sets.map(set=>({ set_id: set.set_id,order_index: set.order_index,reps_value: set.reps_value,set_type: set.set_type,performance_status: set.performance_status })) })) } });
    render(<GroupSessionRoute />);
    expect(await screen.findByTestId('group-session-set-row-set-2')).toHaveTextContent(/5 reps/);
    expect(screen.getByTestId('group-session-set-row-set-2')).toHaveTextContent(/RIR 1/);
    expect(screen.queryByText(/102.5|110.0|kg|1RM|Vol /)).toBeNull();
    expect(screen.getByTestId('group-session-volume').props.accessibilityLabel).toBe('Volume —');
  });

  it('lists the #1 records, frozen, with who passed them since, a board link, and one-tap Certify', async () => {
    api.getCompetitionSessionRecords.mockResolvedValue(sessionRecords());
    api.certifyCompetition.mockResolvedValue({ contract_version: 4, created: true, certification: certificationBy(USER_ID, 'me') });
    render(<GroupSessionRoute />);
    const rm = within(await screen.findByTestId('group-session-record-ev-1:e1rm'));
    expect(screen.getByTestId('group-session-records-count')).toHaveTextContent('2');
    expect(rm.getByText('Bench · 1RM')).toBeTruthy();
    expect(rm.getByText('119.6 kg')).toBeTruthy();
    expect(rm.getByText('#1 in group · 102.5 × 5')).toBeTruthy();
    const volume = within(screen.getByTestId('group-session-record-ev-1:volume'));
    expect(volume.getByText('512.5 kg·reps')).toBeTruthy();
    expect(volume.getByText('#1 in group · 102.5 × 5 · since passed by sam')).toBeTruthy();
    expect(volume.getByText('Not certified')).toBeTruthy();
    // One band on the set that took both: the exercise card's record line.
    expect(screen.getByText('#1 in group · 1RM + Volume')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-session-record-ev-1:volume-link'));
    expect(mockPush).toHaveBeenCalledWith('/group/group-a/leaderboards/ge-bench?metric=volume&scope=all');

    fireEvent.press(screen.getByTestId('group-session-record-ev-1:e1rm-certify'));
    await waitFor(() => expect(api.certifyCompetition).toHaveBeenCalledWith({ groupId: 'group-a', exerciseId: 'ge-bench',
      metric: 'e1rm', memberId: 'friend-1', setId: 'set-2', revision: 1, token: 'tok-1rm' }));
    expect(await rm.findByText('Certified by you · 11 Sep')).toBeTruthy();
    expect(api.getCompetitionSessionRecords).toHaveBeenCalledTimes(2);
  });

  it('a disabled Certify never opens the board, and a failed records read says so with Retry', async () => {
    api.getCompetitionSessionRecords.mockResolvedValue(sessionRecords());
    api.getCompetitionCertification.mockResolvedValue({ contract_version: 4, certification: certificationBy(USER_ID, 'me') });
    let finish!: (value: Awaited<ReturnType<typeof api.certifyCompetition>>) => void;
    api.certifyCompetition.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<GroupSessionRoute />);
    fireEvent.press(await screen.findByTestId('group-session-record-ev-1:e1rm-certify'));
    // Pending: the button is disabled, and a second tap lands nowhere.
    fireEvent.press(screen.getByTestId('group-session-record-ev-1:e1rm-certify'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(api.certifyCompetition).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ contract_version: 4, created: true, certification: certificationBy(USER_ID, 'me') }); });

    api.getCompetitionSessionRecords.mockRejectedValue(new GroupApiError('INTERNAL', 'boom'));
    await pullToRefresh('group-session-screen');
    expect(await screen.findByTestId('group-session-records-error')).toBeTruthy();
    api.getCompetitionSessionRecords.mockResolvedValue(sessionRecords());
    fireEvent.press(screen.getByTestId('group-session-records-error-retry'));
    await waitFor(() => expect(screen.queryByTestId('group-session-records-error')).toBeNull());
  });

  it('withdraws my certification after the confirmation, with the same button', async () => {
    api.getCompetitionSessionRecords.mockResolvedValue(sessionRecords({ certification: certificationBy(USER_ID, 'me') }));
    api.getCompetitionCertification.mockResolvedValue({ contract_version: 4, certification: certificationBy(USER_ID, 'me') });
    const ended = { ...certificationBy(USER_ID, 'me'), ended_at_ms: T0 + 1, end_reason: 'withdrawn' as const };
    api.endCompetitionCertification.mockImplementation(async () => {
      // From here the server reads the certification as ended and the record as uncertified.
      api.getCompetitionCertification.mockResolvedValue({ contract_version: 4, certification: ended });
      api.getCompetitionSessionRecords.mockResolvedValue(sessionRecords());
      return { contract_version: 4, certification: ended };
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    render(<GroupSessionRoute />);
    const rm = within(await screen.findByTestId('group-session-record-ev-1:e1rm'));
    expect(await rm.findByText('Certified by you · 11 Sep')).toBeTruthy();
    fireEvent.press(screen.getByTestId('group-session-record-ev-1:e1rm-withdraw'));
    const buttons = alert.mock.calls[0][2] ?? [];
    await act(async () => { buttons.find(button => button.text === 'Withdraw')?.onPress?.(); });
    expect(api.endCompetitionCertification).toHaveBeenCalledWith('group-a', 'cert-1', 'e1rm', 'withdraw');
    expect(await rm.findByText('Not certified')).toBeTruthy();
    alert.mockRestore();
  });

  it('on my own session: You in the title, a full-session action, and no Certify for my own record', async () => {
    const me = { user_id: USER_ID, username: 'me' };
    mockParams = { groupId: 'group-a', memberId: USER_ID, sessionId: 's-1' };
    api.getCompetitionSession.mockResolvedValue(sessionDetail({ member: me }));
    api.getCompetitionSessionRecords.mockResolvedValue(sessionRecords({ member: me }));
    render(<GroupSessionRoute />);
    const rm = within(await screen.findByTestId('group-session-record-ev-1:e1rm'));
    expect(screen.getByTestId('group-session-title-text')).toHaveTextContent('You · Fri 11 Sep');
    expect(rm.getByText('Not certified')).toBeTruthy();
    expect(screen.queryByTestId('group-session-record-ev-1:e1rm-certify')).toBeNull();
    fireEvent.press(screen.getByTestId('group-session-full-view'));
    expect(mockPush).toHaveBeenCalledWith('/completed-session/s-1');
  });

  it('opens my live session while it runs, and shows no records until it is completed', async () => {
    const me = { user_id: USER_ID, username: 'me' };
    mockParams = { groupId: 'group-a', memberId: USER_ID, sessionId: 's-1' };
    api.getCompetitionSession.mockResolvedValue(sessionDetail({ member: me, status: 'active', completed_at_ms: null, duration_sec: null }));
    api.getCompetitionSessionRecords.mockResolvedValue(sessionRecords({ member: me, provisional: true }));
    render(<GroupSessionRoute />);
    fireEvent.press(await screen.findByTestId('group-session-full-view'));
    expect(mockPush).toHaveBeenCalledWith('/session/s-1');
    await waitFor(() => expect(api.getCompetitionSessionRecords).toHaveBeenCalled());
    expect(screen.queryByTestId('group-session-records')).toBeNull();
    expect(screen.queryByText(/#1 in group/)).toBeNull();
  });

  it('shows "In progress" for an active session, and pull-to-refresh updates it', async () => {
    api.getCompetitionSession
      .mockResolvedValueOnce(sessionDetail({ status: 'active', completed_at_ms: null, duration_sec: null }))
      .mockResolvedValue(sessionDetail());
    render(<GroupSessionRoute />);
    expect(await screen.findByText('In progress')).toBeTruthy();
    expect(screen.getByTestId('group-session-times-end').props.accessibilityLabel).toBe('End —');

    await pullToRefresh('group-session-screen');
    expect(await screen.findByText('Completed · 1h 5m')).toBeTruthy();
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('shows "This session is no longer available" on NOT_FOUND and evicts the cached detail', async () => {
    seed(groupCacheKeys.session('group-a','friend-1', 's-1'), sessionDetail());
    api.getCompetitionSession.mockRejectedValue(new GroupApiError('NOT_FOUND', 'session not found'));
    render(<GroupSessionRoute />);
    expect(await screen.findByTestId('group-session-unavailable')).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
    await waitFor(() => expect(cached(groupCacheKeys.session('group-a','friend-1', 's-1'))).toBeNull());
  });

  it('shows the cached detail under the offline marker when offline', async () => {
    seed(groupCacheKeys.session('group-a','friend-1', 's-1'), sessionDetail());
    api.getCompetitionSession.mockRejectedValue(networkError());
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
