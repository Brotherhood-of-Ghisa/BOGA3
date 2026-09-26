/* eslint-disable import/first */

/**
 * M25-T09 leaderboards screens (card AC2–AC8; product E1.1–E1.3; groups
 * contract §4.5, §6.2, §6.3): the group screen's Leaderboards segment (podium
 * cards, cache-first under `boards:<groupId>`), the full board route (toggles,
 * empty Certified, paging, lost access, exercise missing, offline), and the
 * history route. The group RPCs are mocked; `group_cache` is the real table on
 * the in-memory SQLite fixture.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
const mockCurrentDatabase = () => fixture.database;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(mockCurrentDatabase()),
}));

type MockNetInfoListener = (state: { isConnected: boolean | null }) => void;
const mockNetInfoListeners = new Set<MockNetInfoListener>();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: MockNetInfoListener) => {
      mockNetInfoListeners.add(listener);
      // Tests that need "offline" from the first render set it before rendering.
      if (mockInitialOnline !== null) listener({ isConnected: mockInitialOnline });
      return () => {
        mockNetInfoListeners.delete(listener);
      };
    },
  },
}));
let mockInitialOnline: boolean | null = null;

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      mockScreenTitle = options?.title ?? null;
      return null;
    },
  },
}));
let mockScreenTitle: string | null = null;

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  getGroup: jest.fn(),
  listMyGroups: jest.fn(),
  getGroupStream: jest.fn(),
  listGroupExercises: jest.fn(),
  getGroupBoardPodiums: jest.fn(),
  getGroupBoard: jest.fn(),
  getGroupBoardHistory: jest.fn(),
}));

import { groupCache } from '@/src/data/schema';
import {
  GroupApiError,
  groupCacheKeys,
  readGroupCache,
  setLastViewedGroupId,
  writeGroupCache,
  type BoardHolder,
  type BoardRow,
  type GroupBoardHistoryResult,
  type GroupBoardPodiumsResult,
  type GroupBoardResult,
  type GroupExercise,
  type GroupGetResult,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';
import { uiRoles } from '@/components/ui';

import GroupsTabRoute from '../(tabs)/groups';
import GroupBoardRoute from '../group/[groupId]/leaderboards/[exerciseId]/index';
import GroupBoardHistoryRoute from '../group/[groupId]/leaderboards/[exerciseId]/history';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

type TestNode = typeof screen.UNSAFE_root;

/** The nearest ground behind a node: its own or an ancestor's `backgroundColor`. */
const groundOf = (node: TestNode): unknown => {
  for (let current: TestNode | null = node; current; current = current.parent) {
    const ground = (StyleSheet.flatten(current.props.style) as ViewStyle | undefined)?.backgroundColor;
    if (ground !== undefined) return ground;
  }
  return undefined;
};

const USER_ID = 'user-me';
const GROUP_ID = 'group-a';
const EXERCISE_ID = 'ge-bench';
/** 09:05 local on 11 Sep 2026, so "last updated 09:05" holds in any time zone. */
const T0 = new Date(2026, 8, 11, 9, 5).getTime();
const SEP_10 = new Date(2026, 8, 10, 18, 0).getTime();

const exercise = (id: string, name: string, archived = false): GroupExercise => ({
  group_exercise_id: id,
  name,
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: archived ? T0 : null,
});
const BENCH = exercise(EXERCISE_ID, 'Bench Press');
const OLD = exercise('ge-old', 'Old Squat', true);

const detail: GroupGetResult = {
  group: { group_id: GROUP_ID, name: 'Garage Gym', description: null, member_count: 3, my_role: 'member' },
  members: [{ user_id: USER_ID, username: 'me', role: 'member' }],
};

const row = (rank: number, userId: string, username: string, overrides: Partial<BoardRow> = {}): BoardRow => ({
  rank,
  member: { user_id: userId, username },
  former: false,
  value_kg: 150 - rank * 5,
  weight_kg: 140 - rank * 5,
  reps: 2,
  e1rm_kg: 150 - rank * 5,
  entered_weight_kg: 140 - rank * 5,
  load_factor: 1,
  achieved_at_ms: SEP_10,
  session_id: `s-${userId}`,
  set_id: `set-${userId}`,
  exercise_name: 'Bench',
  certified: false,
  certification: null,
  ...overrides,
});

const PODIUMS: GroupBoardPodiumsResult = {
  metric: 'e1rm',
  certified: true,
  exercises: [
    {
      exercise: BENCH,
      podium: [row(1, 'u1', 'Dave'), row(2, 'u2', 'Sam'), row(3, 'u3', 'Kim')],
      me: row(5, USER_ID, 'me'),
      entry_count: 5,
      all_entry_count: 6,
    },
    { exercise: OLD, podium: [], me: null, entry_count: 0, all_entry_count: 2 },
  ],
};

const boardPage = (rows: BoardRow[], overrides: Partial<GroupBoardResult> = {}): GroupBoardResult => ({
  exercise: BENCH,
  metric: 'e1rm',
  certified: true,
  rows,
  next_cursor: null,
  has_more: false,
  ...overrides,
});

const seedCache = (cacheKey: string, payload: unknown) =>
  writeGroupCache(fixture.database, { cacheKey, userId: USER_ID, payload, fetchedAtMs: T0 });

const cacheKeys = () =>
  fixture.database
    .select()
    .from(groupCache)
    .all()
    .map((entry) => entry.cacheKey)
    .sort();

/** The board route also reads `group:<groupId>` for my role (M25-T10 row detail); board rows themselves are never cached. */
const cacheKeysBesidesGroup = () => cacheKeys().filter((key) => key !== groupCacheKeys.group(GROUP_ID));

const emitNetInfo = (isConnected: boolean) => {
  act(() => {
    for (const listener of mockNetInfoListeners) listener({ isConnected });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
  mockInitialOnline = null;
  mockScreenTitle = null;
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: USER_ID } });
  setLastViewedGroupId(null);
  api.getGroup.mockResolvedValue(detail);
  api.listMyGroups.mockResolvedValue({ groups: [detail.group] });
  api.getGroupStream.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
  api.listGroupExercises.mockResolvedValue({ exercises: [BENCH, OLD] });
  api.getGroupBoardPodiums.mockResolvedValue(PODIUMS);
  api.getGroupBoard.mockResolvedValue(boardPage([]));
  api.getGroupBoardHistory.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
});

afterEach(() => {
  fixture.close();
});

describe('Groups screen Leaderboards segment (E1.1)', () => {
  const openLeaderboards = async () => {
    mockParams = { groupId: GROUP_ID };
    render(<GroupsTabRoute />);
    fireEvent.press(await screen.findByTestId('groups-segment-leaderboards'));
  };

  it('reads podiums only once the segment opens, caches them under boards:<groupId>, and renders the cards', async () => {
    mockParams = { groupId: GROUP_ID };
    render(<GroupsTabRoute />);
    await screen.findByTestId('groups-segment-leaderboards');
    expect(api.getGroupBoardPodiums).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('groups-segment-leaderboards'));
    const bench = await screen.findByTestId(`group-podium-card-${EXERCISE_ID}`);
    expect(api.getGroupBoardPodiums).toHaveBeenCalledWith(GROUP_ID);

    expect(screen.getByTestId(`group-podium-card-${EXERCISE_ID}-view`)).toHaveTextContent('Certified · 1RM');
    expect(screen.getByTestId(`group-podium-card-${EXERCISE_ID}-row-1`)).toHaveTextContent(/Dave.*145\.0.*10 Sep/);
    expect(screen.getByTestId(`group-podium-card-${EXERCISE_ID}-you`)).toHaveTextContent('You: 5th');
    expect(screen.getByTestId('group-podium-card-ge-old-archived')).toHaveTextContent('Archived');
    expect(screen.getByTestId('group-podium-card-ge-old-empty')).toHaveTextContent('No certified sets yet · 2 uncertified');
    expect(screen.queryByTestId('group-podium-card-ge-old-you')).toBeNull();

    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.boards(GROUP_ID), USER_ID)?.payload).toEqual(PODIUMS));

    fireEvent.press(bench);
    expect(mockRouter.push).toHaveBeenCalledWith(`/group/${GROUP_ID}/leaderboards/${EXERCISE_ID}`);
  });

  it('shows the empty state when the group has no exercises', async () => {
    api.getGroupBoardPodiums.mockResolvedValue({ metric: 'e1rm', certified: true, exercises: [] });
    await openLeaderboards();
    expect(await screen.findByTestId('group-leaderboards-empty')).toHaveTextContent(/No group exercises yet/);
  });

  it('offline: renders cached podiums with the offline marker, and requests nothing', async () => {
    seedCache(groupCacheKeys.mine, { groups: [detail.group] });
    seedCache(groupCacheKeys.boards(GROUP_ID), PODIUMS);
    mockInitialOnline = false;
    await openLeaderboards();

    expect(await screen.findByTestId(`group-podium-card-${EXERCISE_ID}`)).toBeTruthy();
    expect(screen.getByTestId('groups-offline-banner')).toHaveTextContent('Offline · last updated 09:05');
    expect(api.getGroupBoardPodiums).not.toHaveBeenCalled();
  });

  it('offline with no cached podiums: the offline empty state', async () => {
    seedCache(groupCacheKeys.mine, { groups: [detail.group] });
    mockInitialOnline = false;
    await openLeaderboards();
    expect(await screen.findByTestId('group-leaderboards-offline-empty-state')).toBeTruthy();
  });

  it('NOT_FOUND evicts the podiums and re-reads My groups, which drops the group', async () => {
    await openLeaderboards();
    await screen.findByTestId(`group-podium-card-${EXERCISE_ID}`);
    api.getGroupBoardPodiums.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    api.listMyGroups.mockResolvedValue({ groups: [] });

    fireEvent(screen.getByTestId('groups-segment-stream'), 'press');
    fireEvent.press(screen.getByTestId('groups-segment-leaderboards'));

    expect(await screen.findByTestId('groups-empty-state')).toBeTruthy();
    await waitFor(() => expect(cacheKeys()).not.toContain(groupCacheKeys.boards(GROUP_ID)));
  });
});

describe('Full board (E1.2)', () => {
  const openBoard = (params: Record<string, string> = {}) => {
    mockParams = { groupId: GROUP_ID, exerciseId: EXERCISE_ID, ...params };
    render(<GroupBoardRoute />);
  };

  it('opens on 1RM · Certified with the name as the header title; empty Certified offers "See all sets", which reloads All', async () => {
    api.getGroupBoard.mockImplementation(async ({ certified }) =>
      certified
        ? boardPage([])
        : boardPage([row(1, 'u1', 'Dave'), row(2, USER_ID, 'me', { certified: true }), row(3, 'u4', 'Alex', { former: true })], {
            certified: false,
          }),
    );
    openBoard();

    expect(await screen.findByTestId('group-board-empty')).toHaveTextContent(/No certified sets yet/);
    expect(api.getGroupBoard).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: GROUP_ID, groupExerciseId: EXERCISE_ID, metric: 'e1rm', certified: true, after: null }),
    );
    expect(mockScreenTitle).toBe('Bench Press');

    fireEvent.press(screen.getByTestId('group-board-see-all-button'));
    expect(await screen.findByTestId('group-board-row-1')).toBeTruthy();
    expect(api.getGroupBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm', certified: false, after: null }));

    expect(screen.getByTestId('group-board-row-1-value')).toHaveTextContent('145.0');
    expect(screen.getByTestId('group-board-row-1-detail')).toHaveTextContent('135.0 × 2');
    expect(screen.getByTestId('group-board-row-1-mark')).toHaveTextContent('uncertified');
    expect(screen.getByTestId('group-board-row-1-mark-uncertified', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('group-board-row-2-member')).toHaveTextContent('You');
    // My row sits on surface-subtle, the others on the card's surface (DLM-T12-D1).
    expect(groundOf(screen.getByTestId('group-board-row-2'))).toBe(uiRoles.surfaceSubtle);
    expect(groundOf(screen.getByTestId('group-board-row-1'))).toBe(uiRoles.surface);
    expect(screen.getByTestId('group-board-row-2-mark')).toHaveTextContent('');
    expect(screen.getByTestId('group-board-row-2-mark-certified', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('group-board-row-3-member')).toHaveTextContent('Alex (former)');
  });

  it('honours valid query params; Weight switches in place; History carries the toggles', async () => {
    api.getGroupBoard.mockResolvedValue(boardPage([row(1, 'u1', 'Dave', { certified: true })], { certified: false }));
    openBoard({ metric: 'e1rm', scope: 'all' });
    await screen.findByTestId('group-board-row-1');
    expect(api.getGroupBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm', certified: false }));

    fireEvent.press(screen.getByTestId('group-board-metric-weight'));
    await waitFor(() =>
      expect(api.getGroupBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'weight', certified: false, after: null })),
    );
    expect(await screen.findByTestId('group-board-row-1-value')).toHaveTextContent('135.0 × 2');
    expect(screen.queryByTestId('group-board-row-1-detail')).toBeNull();

    fireEvent.press(screen.getByTestId('group-board-history-button'));
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/group/${GROUP_ID}/leaderboards/${EXERCISE_ID}/history?metric=weight&scope=all`,
    );
  });

  it('invalid params fall back to 1RM · Certified; Certified rows carry no mark', async () => {
    api.getGroupBoard.mockResolvedValue(boardPage([row(1, 'u1', 'Dave', { certified: true })]));
    openBoard({ metric: 'reps', scope: 'mine' });
    await screen.findByTestId('group-board-row-1');
    expect(api.getGroupBoard).toHaveBeenCalledWith(expect.objectContaining({ metric: 'e1rm', certified: true }));
    expect(screen.queryByTestId('group-board-row-1-mark')).toBeNull();
  });

  it('pages on end-of-list with the cursor, and a failed page offers Retry', async () => {
    const cursor = { value_kg: 145, achieved_at_ms: SEP_10, member_user_id: 'u1' };
    api.getGroupBoard
      .mockResolvedValueOnce(boardPage([row(1, 'u1', 'Dave')], { next_cursor: cursor, has_more: true }))
      .mockRejectedValueOnce(new GroupApiError('INTERNAL', 'boom'))
      .mockResolvedValueOnce(boardPage([row(1, 'u1', 'Dave'), row(2, 'u2', 'Sam')]));
    openBoard();
    await screen.findByTestId('group-board-row-1');

    await act(async () => {
      fireEvent(screen.getByTestId('group-board-list'), 'onEndReached');
    });
    expect(api.getGroupBoard).toHaveBeenNthCalledWith(2, expect.objectContaining({ after: cursor }));
    expect(await screen.findByTestId('group-board-load-more-error')).toHaveTextContent(/Couldn't load more rows\. boom/);

    fireEvent.press(screen.getByTestId('group-board-load-more-retry'));
    expect(await screen.findByTestId('group-board-row-2')).toBeTruthy();
    expect(api.getGroupBoard).toHaveBeenNthCalledWith(3, expect.objectContaining({ after: cursor }));
    // The duplicate Dave row from the shifted page renders once.
    expect(screen.getAllByTestId('group-board-row-1')).toHaveLength(1);
    expect(cacheKeysBesidesGroup()).toEqual([]);
  });

  it('shows "Archived · read-only" on an archived exercise', async () => {
    api.getGroupBoard.mockResolvedValue(boardPage([], { exercise: OLD }));
    mockParams = { groupId: GROUP_ID, exerciseId: 'ge-old' };
    render(<GroupBoardRoute />);
    expect(await screen.findByTestId('group-board-archived')).toHaveTextContent('Archived · read-only');
  });

  it('group NOT_FOUND evicts and shows lost access', async () => {
    seedCache(groupCacheKeys.boards(GROUP_ID), PODIUMS);
    api.getGroupBoard.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    api.getGroup.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    openBoard();
    expect(await screen.findByTestId('group-board-lost-access')).toBeTruthy();
    await waitFor(() => expect(cacheKeys()).toEqual([]));
  });

  it('exercise NOT_FOUND shows the exercise-missing state and evicts nothing', async () => {
    seedCache(groupCacheKeys.boards(GROUP_ID), PODIUMS);
    api.getGroupBoard.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group exercise not found'));
    openBoard();
    expect(await screen.findByTestId('group-board-exercise-missing')).toHaveTextContent(/This exercise isn't in this group/);
    expect(cacheKeysBesidesGroup()).toEqual([groupCacheKeys.boards(GROUP_ID)]);
  });

  it('offline with nothing loaded: the offline empty state; a toggle while offline requests nothing', async () => {
    // NetInfo's first report lands after the mount's request, which fails in transport.
    mockInitialOnline = false;
    api.getGroupBoard.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    openBoard();
    expect(await screen.findByTestId('group-board-offline-empty-state')).toBeTruthy();
    const calls = api.getGroupBoard.mock.calls.length;

    fireEvent.press(screen.getByTestId('group-board-scope-all'));
    expect(await screen.findByTestId('group-board-offline-empty-state')).toBeTruthy();
    expect(api.getGroupBoard).toHaveBeenCalledTimes(calls);
  });

  it('going offline keeps loaded rows with the offline marker', async () => {
    api.getGroupBoard.mockResolvedValue(boardPage([row(1, 'u1', 'Dave')]));
    openBoard();
    await screen.findByTestId('group-board-row-1');
    emitNetInfo(false);
    expect(await screen.findByTestId('groups-offline-banner')).toHaveTextContent(/^Offline · last updated \d\d:\d\d$/);
    expect(screen.getByTestId('group-board-row-1')).toBeTruthy();
  });

  it('a non-network failure with nothing loaded shows the error state with Retry', async () => {
    api.getGroupBoard.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'bad payload'));
    openBoard();
    expect(await screen.findByTestId('group-board-error-state')).toHaveTextContent(/bad payload/);
    api.getGroupBoard.mockResolvedValueOnce(boardPage([row(1, 'u1', 'Dave')]));
    fireEvent.press(screen.getByTestId('group-board-error-state-retry'));
    expect(await screen.findByTestId('group-board-row-1')).toBeTruthy();
  });
});

describe('History (E1.3)', () => {
  const holder = (userId: string, username: string, valueKg: number): BoardHolder => ({
    member_user_id: userId,
    member: { user_id: userId, username },
    value_kg: valueKg,
    weight_kg: valueKg,
    reps: 1,
    e1rm_kg: valueKg,
    achieved_at_ms: SEP_10,
    set_id: `set-${userId}`,
    session_id: `s-${userId}`,
  });

  const HISTORY: GroupBoardHistoryResult = {
    items: [
      {
        key: 'lc2',
        seq: 12,
        occurred_at_ms: SEP_10,
        reason: 'record',
        leader: holder('u1', 'Dave', 142.5),
        previous: holder('u2', 'Sam', 138),
        related: { kind: 'record', key: 'r1', set_id: 'set-u1', weight_kg: 142.5, reps: 1, e1rm_kg: 142.5 },
      },
    ],
    next_cursor: { seq: 12 },
    has_more: true,
  };

  it('reads the toggles from the route, renders sentences, and pages with { seq }', async () => {
    api.getGroupBoardHistory.mockResolvedValueOnce(HISTORY).mockResolvedValueOnce({
      items: [
        {
          key: 'lc1',
          seq: 7,
          occurred_at_ms: SEP_10,
          reason: 'link',
          leader: holder('u2', 'Sam', 138),
          previous: null,
          related: { kind: 'link', key: 'l1', event: 'link', exercises: [{ exercise_definition_id: 'd', name: 'Bench Press' }] },
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    mockParams = { groupId: GROUP_ID, exerciseId: EXERCISE_ID, metric: 'weight', scope: 'all' };
    render(<GroupBoardHistoryRoute />);

    expect(await screen.findByTestId('group-board-history-item-12-sentence')).toHaveTextContent(
      'Dave took #1 · 142.5 kg (from Sam, 138 kg)',
    );
    expect(screen.getByTestId('group-board-history-item-12-date')).toHaveTextContent('10 Sep');
    expect(screen.getByTestId('group-board-history-view')).toHaveTextContent('All · Weight');
    expect(api.getGroupBoardHistory).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      groupExerciseId: EXERCISE_ID,
      metric: 'weight',
      certified: false,
      before: null,
    });

    await act(async () => {
      fireEvent(screen.getByTestId('group-board-history-list'), 'onEndReached');
    });
    expect(api.getGroupBoardHistory).toHaveBeenLastCalledWith(expect.objectContaining({ before: { seq: 12 } }));
    expect(await screen.findByTestId('group-board-history-item-7-sentence')).toHaveTextContent(
      'Sam took #1 · 138 kg (linked Bench Press)',
    );
    expect(cacheKeys()).toEqual([]);
  });

  it('no lead changes: the empty state', async () => {
    mockParams = { groupId: GROUP_ID, exerciseId: EXERCISE_ID };
    render(<GroupBoardHistoryRoute />);
    expect(await screen.findByTestId('group-board-history-empty')).toHaveTextContent('No lead changes yet');
    expect(api.getGroupBoardHistory).toHaveBeenCalledWith(expect.objectContaining({ metric: 'e1rm', certified: true }));
  });

  it('group NOT_FOUND shows lost access', async () => {
    api.getGroupBoardHistory.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    mockParams = { groupId: GROUP_ID, exerciseId: EXERCISE_ID };
    render(<GroupBoardHistoryRoute />);
    expect(await screen.findByTestId('group-board-history-lost-access')).toBeTruthy();
  });

  it('offline with nothing loaded: the offline empty state', async () => {
    mockInitialOnline = false;
    api.getGroupBoardHistory.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    mockParams = { groupId: GROUP_ID, exerciseId: EXERCISE_ID };
    render(<GroupBoardHistoryRoute />);
    expect(await screen.findByTestId('group-board-history-offline-empty-state')).toBeTruthy();
  });
});
