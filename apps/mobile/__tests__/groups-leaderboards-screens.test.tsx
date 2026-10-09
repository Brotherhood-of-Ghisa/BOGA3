/* eslint-disable import/first */

/**
 * Leaderboards screens (E1.1–E1.3; groups contract): the
 * group screen's Leaderboards segment (podium cards, cache-first under `boards:<groupId>`), the full board route (toggles,
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

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn(),setParams: jest.fn() };
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

jest.mock('@/src/groups/api', () => {
  const streamRead = jest.fn();
  return {
  ...jest.requireActual('@/src/groups/api'),
  getGroup: jest.fn(),
  listMyGroups: jest.fn(),
  getCompetitionStream: streamRead,
  listCompetitionExercises: jest.fn(),
  getCompetitionPodiums: jest.fn(),
  getCompetitionBoard: jest.fn(),
  getCompetitionRevisions: jest.fn(),
  getCompetitionHistory: jest.fn(),
  };
});

import { groupCache } from '@/src/data/schema';
import {
  GroupApiError,
  groupCacheKeys,
  readGroupCache,
  setLastViewedGroupId,
  writeGroupCache,
  type GroupGetResult,
} from '@/src/groups';
import type { CompetitionExerciseWire,CompetitionBoardRowWire,CompetitionBoardWire,CompetitionHistoryWire } from '@/src/groups/competition-wire';
import { competitionExercise,competitionRow,competitionBoard,competitionCertification,competitionEvent } from './helpers/competition-fixtures';
import * as groupsApi from '@/src/groups/api';
import { uiRoles } from '@/components/ui';

import GroupsTabRoute from '../app/(tabs)/groups';
import GroupBoardRoute from '../app/group/[groupId]/leaderboards/[exerciseId]/index';
import GroupBoardHistoryRoute from '../app/group/[groupId]/leaderboards/[exerciseId]/history';

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

const exercise=(id: string,name: string,archived=false): CompetitionExerciseWire=>({ ...competitionExercise,
  group_exercise_id: id,name,archived_at_ms: archived?T0:null,rules: { ...competitionExercise.rules,bodyweight_calculations_enabled: false,bodyweight_contribution: 0 } });
const BENCH=exercise(EXERCISE_ID,'Bench Press');
const OLD=exercise('ge-old','Old Squat',true);
const detail: GroupGetResult = {
  group: { group_id: GROUP_ID, name: 'Garage Gym', description: null, member_count: 3, my_role: 'member',
    bodyweight_calculations_enabled: false },
  members: [{ user_id: USER_ID, username: 'me', role: 'member' }],
};

const row=(rank: number,userId: string,username: string,overrides: Partial<CompetitionBoardRowWire>={}): CompetitionBoardRowWire=>({
  ...competitionRow,rank,member: { user_id: userId,username },value: 150-rank*5,unit: 'kg',
  performance: { ...competitionRow.performance,visibility: 'ordinary',weight_value: String(140-rank*5),reps: 2,
    achieved_at_ms: SEP_10,session_id: `s-${userId}`,set_id: `set-${userId}` },...overrides } as CompetitionBoardRowWire);
const boardPage=(rows: CompetitionBoardRowWire[],overrides: Partial<CompetitionBoardWire>={}): CompetitionBoardWire=>({
  ...competitionBoard,group_exercise_id: EXERCISE_ID,rules: BENCH.rules,certified: true,entries: rows,entry_count: rows.length,...overrides });
const METRIC_PODIUMS={ contract_version: 4 as const,certified: true,podiums: [
  { exercise: BENCH,board: boardPage([row(1,'u1','Dave',{ certification: competitionCertification }),row(2,'u2','Sam',{ certification: competitionCertification }),row(3,'u3','Kim',{ certification: competitionCertification })],{ me: row(5,USER_ID,'me',{ certification: competitionCertification }),entry_count: 5 }) },
  { exercise: OLD,board: boardPage([],{ group_exercise_id: 'ge-old',state: 'archived' }) } ] };
const revision={ rules_revision: 2,representation_version: 4 as const,rules: { bodyweight_calculations_enabled: false,
  bodyweight_contribution: 0,load_input_mode: 'total_load' as const,default_metric: 'e1rm' as const },
  reason: 'initial' as const,legacy: false,published_at_ms: SEP_10,retired_at_ms: null };
const historyPage=(overrides: Partial<CompetitionHistoryWire>={}): CompetitionHistoryWire=>({ contract_version: 4,
  exercise: BENCH,revision,metric: 'e1rm',certified: true,events: [],next_cursor: null,...overrides });
const seedCache = (cacheKey: string, payload: unknown) =>
  writeGroupCache(fixture.database, { cacheKey, userId: USER_ID, payload, fetchedAtMs: T0 });

const cacheKeys = () =>
  fixture.database
    .select()
    .from(groupCache)
    .all()
    .filter(entry=>!entry.cacheKey.startsWith('group-policy:')).map((entry) => entry.cacheKey)
    .sort();

/** The board route also reads `group:<groupId>` for my role (row detail); board rows themselves are never cached. */
const cacheKeysBesidesGroup = () => cacheKeys().filter((key) => key !== groupCacheKeys.group(GROUP_ID) && key !== groupCacheKeys.groupExercises(GROUP_ID));

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
  api.getCompetitionStream.mockResolvedValue({ contract_version: 4,items: [], next_cursor: null, has_more: false });
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4,exercises: [BENCH, OLD] });
  api.getCompetitionPodiums.mockResolvedValue(METRIC_PODIUMS);
  api.getCompetitionBoard.mockResolvedValue(boardPage([]));
  api.getCompetitionHistory.mockResolvedValue(historyPage());
  api.getCompetitionRevisions.mockResolvedValue({ contract_version: 4,exercise: BENCH,revisions: [revision] });
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
    expect(api.getCompetitionPodiums).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('groups-segment-leaderboards'));
    const bench = await screen.findByTestId(`group-podium-card-${EXERCISE_ID}`);
    expect(api.getCompetitionPodiums).toHaveBeenCalledWith(GROUP_ID);

    expect(screen.getByTestId(`group-podium-card-${EXERCISE_ID}-view`)).toHaveTextContent(/^Certified · 1RM kg$/);
    expect(screen.getByTestId(`group-podium-card-${EXERCISE_ID}-row-1`)).toHaveTextContent(/Dave.*145\.0.*10 Sep/);
    expect(screen.getByTestId(`group-podium-card-${EXERCISE_ID}-you`)).toHaveTextContent('You: 5th');
    expect(screen.getByTestId('group-podium-card-ge-old-archived')).toHaveTextContent('Archived');
    expect(screen.getByTestId('group-podium-card-ge-old-empty')).toHaveTextContent('No certified sets yet');
    expect(screen.queryByTestId('group-podium-card-ge-old-you')).toBeNull();

    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.boards(GROUP_ID), USER_ID)?.payload).toEqual(METRIC_PODIUMS));

    fireEvent.press(bench);
    expect(mockRouter.push).toHaveBeenCalledWith(`/group/${GROUP_ID}/leaderboards/${EXERCISE_ID}`);
  });

  it('narrows the podium cards by exercise name, ignoring case and outer spaces', async () => {
    await openLeaderboards();
    await screen.findByTestId(`group-podium-card-${EXERCISE_ID}`);
    fireEvent.changeText(screen.getByTestId('group-leaderboards-search'), '  SQUAT ');
    expect(screen.queryByTestId(`group-podium-card-${EXERCISE_ID}`)).toBeNull();
    expect(screen.getByTestId('group-podium-card-ge-old')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('group-leaderboards-search'), 'deadlift');
    expect(screen.getByTestId('group-leaderboards-no-match')).toHaveTextContent('No exercises match');
    expect(screen.queryByTestId('group-podium-card-ge-old')).toBeNull();
    fireEvent.changeText(screen.getByTestId('group-leaderboards-search'), '');
    expect(screen.getByTestId(`group-podium-card-${EXERCISE_ID}`)).toBeTruthy();
    expect(screen.getByTestId('group-podium-card-ge-old')).toBeTruthy();
    expect(screen.queryByTestId('group-leaderboards-no-match')).toBeNull();
  });

  it('shows the empty state when the group has no exercises', async () => {
    api.getCompetitionPodiums.mockResolvedValue({ contract_version: 4,certified: true,podiums: [] });
    await openLeaderboards();
    expect(await screen.findByTestId('group-leaderboards-empty')).toHaveTextContent(/No group exercises yet/);
    expect(screen.queryByTestId('group-leaderboards-search')).toBeNull();
  });

  it('offline: renders cached podiums with the offline marker, and requests nothing', async () => {
    seedCache(groupCacheKeys.mine, { groups: [detail.group] });
    seedCache(groupCacheKeys.boards(GROUP_ID), METRIC_PODIUMS);
    mockInitialOnline = false;
    await openLeaderboards();

    expect(await screen.findByTestId(`group-podium-card-${EXERCISE_ID}`)).toBeTruthy();
    expect(screen.getByTestId('groups-offline-banner')).toHaveTextContent('Offline · last updated 09:05');
    expect(api.getCompetitionPodiums).not.toHaveBeenCalled();
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
    api.getCompetitionPodiums.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
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
    api.getCompetitionBoard.mockImplementation(async ({ certified }) =>
      certified
        ? boardPage([])
        : boardPage([row(1, 'u1', 'Dave'), row(2, USER_ID, 'me', { certification: competitionCertification }), row(3, 'u4', 'Alex', { former: true })], {
            certified: false,
          }),
    );
    openBoard();

    expect(await screen.findByTestId('group-board-empty')).toHaveTextContent(/No certified sets yet/);
    expect(api.getCompetitionBoard).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: GROUP_ID, exerciseId: EXERCISE_ID, metric: 'e1rm', certified: true, cursor: null }),
    );
    expect(mockScreenTitle).toBe('Bench Press');

    fireEvent.press(screen.getByTestId('group-board-see-all-button'));
    expect(await screen.findByTestId('group-board-row-1')).toBeTruthy();
    expect(api.getCompetitionBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm', certified: false, cursor: null }));

    expect(screen.getByTestId('group-board-row-1-value')).toHaveTextContent('145.0 kg');
    expect(screen.getByTestId('group-board-row-1-detail')).toHaveTextContent('Weight 135.0 kg × 2');
    expect(screen.getByTestId('group-board-row-1-mark')).toHaveTextContent('uncertified');
    expect(screen.getByTestId('group-board-row-1-mark-uncertified', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('group-board-row-2-member')).toHaveTextContent('You');
    // My row sits on paper, the others on the card's surface.
    expect(groundOf(screen.getByTestId('group-board-row-2'))).toBe(uiRoles.paper);
    expect(groundOf(screen.getByTestId('group-board-row-1'))).toBe(uiRoles.surface);
    expect(screen.getByTestId('group-board-row-2-mark')).toHaveTextContent('');
    expect(screen.getByTestId('group-board-row-2-mark-certified', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('group-board-row-3-member')).toHaveTextContent('Alex (former)');
  });

  it('honours valid query params; Volume switches in place; History carries the toggles', async () => {
    api.getCompetitionBoard.mockResolvedValue(boardPage([row(1, 'u1', 'Dave', { certification: competitionCertification })], { certified: false }));
    openBoard({ metric: 'e1rm', scope: 'all' });
    await screen.findByTestId('group-board-row-1');
    expect(api.getCompetitionBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'e1rm', certified: false }));

    api.getCompetitionBoard.mockResolvedValue(boardPage([{ ...row(1,'u1','Dave'),metric: 'volume',unit: 'kg_reps',value: 270 }],{ metric: 'volume',certified: false }));
    fireEvent.press(screen.getByTestId('group-board-metric-volume'));
    await waitFor(() =>
      expect(api.getCompetitionBoard).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'volume', certified: false, cursor: null })),
    );
    expect(await screen.findByTestId('group-board-row-1-value')).toHaveTextContent('270.0 kg·reps');
    expect(screen.getByTestId('group-board-row-1-detail')).toHaveTextContent('Weight 135.0 kg × 2');

    fireEvent.press(screen.getByTestId('group-board-history-button'));
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/group/${GROUP_ID}/leaderboards/${EXERCISE_ID}/history?metric=volume&scope=all`,
    );
  });

  it('invalid params fall back to 1RM · Certified; Certified rows carry no mark', async () => {
    api.getCompetitionBoard.mockResolvedValue(boardPage([row(1, 'u1', 'Dave', { certification: competitionCertification })]));
    openBoard({ metric: 'reps', scope: 'mine' });
    await screen.findByTestId('group-board-row-1');
    expect(api.getCompetitionBoard).toHaveBeenCalledWith(expect.objectContaining({ metric: 'e1rm', certified: true }));
    expect(screen.queryByTestId('group-board-row-1-mark')).toBeNull();
  });

  it('pages on end-of-list with the cursor, and a failed page offers Retry', async () => {
    const cursor='server-page-token';
    api.getCompetitionBoard
      .mockResolvedValueOnce(boardPage([row(1, 'u1', 'Dave')], { next_cursor: cursor }))
      .mockRejectedValueOnce(new GroupApiError('INTERNAL', 'boom'))
      .mockResolvedValueOnce(boardPage([row(1, 'u1', 'Dave'), row(2, 'u2', 'Sam')]));
    openBoard();
    await screen.findByTestId('group-board-row-1');

    await act(async () => {
      fireEvent(screen.getByTestId('group-board-list'), 'onEndReached');
    });
    expect(api.getCompetitionBoard).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor }));
    expect(await screen.findByTestId('group-board-load-more-error')).toHaveTextContent(/Couldn't load more rows\. boom/);

    fireEvent.press(screen.getByTestId('group-board-load-more-retry'));
    expect(await screen.findByTestId('group-board-row-2')).toBeTruthy();
    expect(api.getCompetitionBoard).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor }));
    // The duplicate Dave row from the shifted page renders once.
    expect(screen.getAllByTestId('group-board-row-1')).toHaveLength(1);
    expect(cacheKeysBesidesGroup()).toEqual([]);
  });

  it('shows "Archived · read-only" on an archived exercise', async () => {
    api.getCompetitionBoard.mockResolvedValue(boardPage([], { group_exercise_id: 'ge-old',state: 'archived' }));
    mockParams = { groupId: GROUP_ID, exerciseId: 'ge-old' };
    render(<GroupBoardRoute />);
    expect(await screen.findByTestId('group-board-archived')).toHaveTextContent('Archived · read-only');
  });

  it('group NOT_FOUND evicts and shows lost access', async () => {
    seedCache(groupCacheKeys.boards(GROUP_ID), METRIC_PODIUMS);
    api.getCompetitionBoard.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    api.getGroup.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    api.listCompetitionExercises.mockRejectedValue(new GroupApiError('NOT_FOUND','group not found'));
    openBoard();
    expect(await screen.findByTestId('group-board-lost-access')).toBeTruthy();
    await waitFor(() => expect(cacheKeys()).toEqual([]));
  });

  it('exercise NOT_FOUND shows the exercise-missing state and evicts nothing', async () => {
    seedCache(groupCacheKeys.boards(GROUP_ID), METRIC_PODIUMS);
    api.getCompetitionBoard.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group exercise not found'));
    openBoard();
    expect(await screen.findByTestId('group-board-exercise-missing')).toHaveTextContent(/This exercise isn't in this group/);
    expect(cacheKeysBesidesGroup()).toEqual([groupCacheKeys.boards(GROUP_ID)]);
  });

  it('offline with nothing loaded: the offline empty state; a toggle while offline requests nothing', async () => {
    // NetInfo's first report lands after the mount's request, which fails in transport.
    mockInitialOnline = false;
    api.getCompetitionBoard.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    openBoard();
    expect(await screen.findByTestId('group-board-offline-empty-state')).toBeTruthy();
    await screen.findByTestId('group-board-scope-all');
    await waitFor(() => expect(api.getCompetitionBoard).toHaveBeenCalled());
    const calls = api.getCompetitionBoard.mock.calls.length;

    fireEvent.press(screen.getByTestId('group-board-scope-all'));
    expect(await screen.findByTestId('group-board-offline-empty-state')).toBeTruthy();
    expect(api.getCompetitionBoard).toHaveBeenCalledTimes(calls);
  });

  it('going offline keeps loaded rows with the offline marker', async () => {
    api.getCompetitionBoard.mockResolvedValue(boardPage([row(1, 'u1', 'Dave')]));
    openBoard();
    await screen.findByTestId('group-board-row-1');
    emitNetInfo(false);
    expect(await screen.findByTestId('groups-offline-banner')).toHaveTextContent(/^Offline · last updated \d\d:\d\d$/);
    expect(screen.getByTestId('group-board-row-1')).toBeTruthy();
  });

  it('a non-network failure with nothing loaded shows the error state with Retry', async () => {
    api.getCompetitionBoard.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'bad payload'));
    openBoard();
    expect(await screen.findByTestId('group-board-error-state')).toHaveTextContent(/bad payload/);
    api.getCompetitionBoard.mockResolvedValueOnce(boardPage([row(1, 'u1', 'Dave')]));
    fireEvent.press(screen.getByTestId('group-board-error-state-retry'));
    expect(await screen.findByTestId('group-board-row-1')).toBeTruthy();
  });
});

describe('Competition history',()=>{
  const openHistory=()=>{mockParams={ groupId: GROUP_ID,exerciseId: EXERCISE_ID,scope: 'all' };render(<GroupBoardHistoryRoute />);};
  it('keeps original units and pages with the opaque history cursor',async()=>{
    const event={ ...competitionEvent,kind: 'lead_change' as const,event_id: 'lc2',sequence: 12,sort_at_ms: SEP_10,
      group: { group_id: GROUP_ID,name: 'Garage Gym' },group_exercise: { group_exercise_id: EXERCISE_ID,name: 'Bench Press' },
      visibility: 'ordinary' as const,record_context: null,values: [{ role: 'leader' as const,metric: 'e1rm' as const,
        unit: 'kg',value: 142.5,unavailable: false,member: { user_id: 'u1',username: 'Dave' } }] };
    api.getCompetitionHistory.mockResolvedValueOnce(historyPage({ events: [event],next_cursor: 'older-events' }))
      .mockResolvedValueOnce(historyPage({ events: [{ ...event,event_id: 'lc1',sequence: 7,
        values: [{ ...event.values[0],value: 138,member: { user_id: 'u2',username: 'Sam' } }] }] }));
    openHistory();expect(await screen.findByTestId('group-board-history-item-12-sentence')).toHaveTextContent('Dave · #1 1RM · 142.5 kg.');
    expect(screen.getByTestId('group-board-history-item-12-date')).toHaveTextContent('10 Sep');
    await act(async()=>fireEvent(screen.getByTestId('group-board-history-list'),'onEndReached'));
    expect(api.getCompetitionHistory).toHaveBeenLastCalledWith(expect.objectContaining({ before: 'older-events' }));
    expect(await screen.findByTestId('group-board-history-item-7-sentence')).toHaveTextContent('Sam · #1 1RM · 138.0 kg.');
    expect(cacheKeys()).toEqual([groupCacheKeys.groupExercises(GROUP_ID)]);
  });
  it('shows empty history for the selected metric and scope',async()=>{
    openHistory();expect(await screen.findByTestId('group-board-history-empty')).toHaveTextContent('No history for this view yet');
    expect(api.getCompetitionHistory).toHaveBeenCalledWith(expect.objectContaining({ metric: 'e1rm',certified: false }));
  });
  it('shows lost access when membership ends',async()=>{
    api.getCompetitionHistory.mockRejectedValue(new GroupApiError('NOT_FOUND','group not found'));
    api.listCompetitionExercises.mockRejectedValue(new GroupApiError('NOT_FOUND','group not found'));openHistory();
    expect(await screen.findByTestId('group-board-history-lost-access')).toBeTruthy();
  });
  it('shows the offline state without a loaded page',async()=>{
    // Keep the public catalogue cached; history itself is online only.
    seedCache(groupCacheKeys.groupExercises(GROUP_ID),{ contract_version: 4,exercises: [BENCH,OLD] });
    mockInitialOnline=false;openHistory();
    expect(await screen.findByTestId('group-board-history-offline-empty-state')).toBeTruthy();
  });
});
