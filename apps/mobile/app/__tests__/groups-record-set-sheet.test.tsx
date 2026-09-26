/* eslint-disable import/first */

/**
 * M25-T10 stream record items, row detail sheet, and certification writes
 * (card AC2, AC5–AC8; product E2, E3, P10–P18; groups contract §4.6, §7):
 * the group screen's stream renders record cards under their session card,
 * record-removed and link rows; Certify on a card and in the sheet; Remove my
 * certification and Cancel certification confirm first; offline refuses before
 * any request; CONFLICT, a lost record, and lost access; full-board rows open
 * the same sheet. The group RPCs are mocked; `group_cache` is the real table on
 * the in-memory SQLite fixture.
 */

import * as mockReact from 'react';
import { Alert, StyleSheet, type ViewStyle } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

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
  Stack: { Screen: () => null },
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  getGroup: jest.fn(),
  getGroupStream: jest.fn(),
  getGroupSessionDetail: jest.fn(),
  getGroupBoard: jest.fn(),
  listMyGroups: jest.fn(),
  certifyGroupSet: jest.fn(),
  withdrawGroupCertification: jest.fn(),
  cancelGroupCertification: jest.fn(),
}));

import { uiRoles } from '@/components/ui';
import { groupCache } from '@/src/data/schema';
import {
  GROUP_OFFLINE_ACTION_MESSAGE,
  GroupApiError,
  groupCacheKeys,
  writeGroupCache,
  type BoardRow,
  type GroupGetResult,
  type GroupRole,
  type GroupStreamResult,
  type StreamItem,
  setLastViewedGroupId,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';

import GroupsTabRoute from '../(tabs)/groups';
import GroupBoardRoute from '../group/[groupId]/leaderboards/[exerciseId]/index';

import {
  RECORD_AT_MS,
  certificationPayload,
  linkItem,
  recordItem,
  sessionCardItem,
  voidedItem,
} from './helpers/group-record-fixtures';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

const ME = 'me';
const GROUP_ID = 'g1';
const RECORD_CARD = 'group-stream-record-card-ev-record-1';

const groupPayload = (role: GroupRole = 'member'): GroupGetResult => ({
  group: { group_id: GROUP_ID, name: 'Crew', description: null, member_count: 3, my_role: role },
  members: [{ user_id: ME, username: 'me', role }],
});

/** My role, as the Groups screen (My groups) and the board route (the group) read it. */
const mockMyRole = (role: GroupRole) => {
  api.getGroup.mockResolvedValue(groupPayload(role));
  api.listMyGroups.mockResolvedValue({ groups: [groupPayload(role).group] });
};

const page = (items: StreamItem[]): GroupStreamResult => ({ items, next_cursor: null, has_more: false });

const cacheKeys = () =>
  fixture.database
    .select()
    .from(groupCache)
    .all()
    .map((entry) => entry.cacheKey)
    .sort();

const alertSpy = jest.spyOn(Alert, 'alert');
/** Presses the destructive button of the last confirmation Alert. */
const confirmAlert = async () => {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] ?? [];
  const destructive = buttons.find((button) => button.style === 'destructive');
  await act(async () => {
    destructive?.onPress?.();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy.mockImplementation(() => undefined);
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
  mockInitialOnline = null;
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: ME } });
  setLastViewedGroupId(null);
  mockMyRole('member');
  api.getGroupStream.mockResolvedValue(page([linkItem(), recordItem(), sessionCardItem()]));
  api.getGroupSessionDetail.mockResolvedValue({ session: sessionCardItem() });
  api.getGroupBoard.mockResolvedValue({
    exercise: { group_exercise_id: 'ge-bench', name: 'Bench Press', load_input_mode: 'per_side_load', source_exercise_id: null, archived_at_ms: null },
    metric: 'weight',
    certified: false,
    rows: [],
    next_cursor: null,
    has_more: false,
  });
});

afterEach(() => {
  fixture.close();
});

/** testIDs of the host components under `root` painted `accent` (G6: one primary per sheet). */
type TestNode = typeof screen.UNSAFE_root;
const accentGrounds = (root: TestNode): string[] =>
  root
    .findAll((node: TestNode) => typeof node.type === 'string')
    .filter((node: TestNode) => (StyleSheet.flatten(node.props.style) as ViewStyle | undefined)?.backgroundColor === uiRoles.accent)
    .map((node: TestNode) => String(node.props.testID));

const openGroupStream = async () => {
  mockParams = { groupId: GROUP_ID };
  render(<GroupsTabRoute />);
  return screen.findByTestId(RECORD_CARD);
};

describe('stream items (E3, D15, P16)', () => {
  it('renders the record card below its session card with the "1 record" highlight, plus link and record-removed rows', async () => {
    api.getGroupStream.mockResolvedValue(
      page([
        linkItem(),
        recordItem(),
        sessionCardItem(),
        recordItem({ key: 'ev-old', session_id: 's-gone', set_id: 'x', voided: { key: 'v', reason: 'deleted', occurred_at_ms: 1 } }),
        voidedItem(),
      ]),
    );
    await openGroupStream();

    expect(screen.getByTestId('group-stream-link-ev-link-1-sentence')).toHaveTextContent(
      'dave linked Bench (comp grip) to Bench Press — now #1 on Weight and 1RM',
    );
    expect(screen.getByTestId('group-stream-session-card-u2:s1-records')).toHaveTextContent('1 record');
    expect(screen.getByTestId(`${RECORD_CARD}-title`)).toHaveTextContent('dave — group record');
    // The exercise, then its figures: no unit, `1RM` (G7).
    expect(screen.getByTestId(`${RECORD_CARD}-value`)).toHaveTextContent(/^Bench Press\s+140\.0 × 1 · 1RM 142\.5$/);
    // A standing record carries the `record` band with its title (T11-D2); a voided one has none.
    expect(screen.getByTestId(`${RECORD_CARD}-band`)).toHaveTextContent('dave — group record');
    expect(screen.queryByTestId('group-stream-record-card-ev-old-band')).toBeNull();
    expect(screen.getByTestId('group-stream-record-card-ev-old-title')).toHaveTextContent('dave — group record');
    expect(screen.getByTestId(`${RECORD_CARD}-status`)).toHaveTextContent('Not certified yet');
    expect(screen.getByTestId(`${RECORD_CARD}-certify`)).toBeTruthy();
    expect(screen.getByTestId('group-stream-record-card-ev-old-status')).toHaveTextContent('Voided · set deleted');
    expect(screen.queryByTestId('group-stream-record-card-ev-old-certify')).toBeNull();
    expect(screen.getByTestId('group-stream-record-removed-ev-void-1-sentence')).toHaveTextContent(/dave's Bench Press record removed/);

    // The single-group stream names no group.
    expect(screen.queryByTestId(`${RECORD_CARD}-group`)).toBeNull();

    // Order: link, session, its record, the orphaned voided record, the removed row.
    const list = screen.getByTestId('groups-stream-list');
    const ids = new Set([
      'group-stream-link-ev-link-1',
      'group-stream-session-card-u2:s1',
      RECORD_CARD,
      'group-stream-record-card-ev-old',
      'group-stream-record-removed-ev-void-1',
    ]);
    const order = within(list)
      .getAllByTestId(/^group-stream-/)
      .map((node) => node.props.testID as string)
      .filter((id) => ids.has(id));
    expect(order).toEqual([
      'group-stream-link-ev-link-1',
      'group-stream-session-card-u2:s1',
      RECORD_CARD,
      'group-stream-record-card-ev-old',
      'group-stream-record-removed-ev-void-1',
    ]);
  });

  it('my own record offers no Certify', async () => {
    api.getGroupStream.mockResolvedValue(
      page([recordItem({ member: { user_id: ME, username: 'me' } }), sessionCardItem({ key: `${ME}:s1`, member: { user_id: ME, username: 'me' } })]),
    );
    await openGroupStream();
    expect(screen.getByTestId(`${RECORD_CARD}-title`)).toHaveTextContent('You — group record');
    expect(screen.queryByTestId(`${RECORD_CARD}-certify`)).toBeNull();
  });

  it('a cached page from before record items renders offline', async () => {
    mockInitialOnline = false;
    api.listMyGroups.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    api.getGroupStream.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    writeGroupCache(fixture.database, {
      cacheKey: groupCacheKeys.mine,
      userId: ME,
      payload: { groups: [groupPayload().group] },
      fetchedAtMs: RECORD_AT_MS,
    });
    writeGroupCache(fixture.database, {
      cacheKey: groupCacheKeys.stream(GROUP_ID),
      userId: ME,
      payload: page([sessionCardItem()]),
      fetchedAtMs: RECORD_AT_MS,
    });
    mockParams = { groupId: GROUP_ID };
    render(<GroupsTabRoute />);
    expect(await screen.findByTestId('group-stream-session-card-u2:s1')).toBeTruthy();
    expect(screen.queryByTestId('group-stream-session-card-u2:s1-records')).toBeNull();
    expect(screen.getByTestId('groups-offline-banner')).toBeTruthy();
  });
});

describe('certify from the card (E3)', () => {
  it('offline: refused before any request, inline on the card', async () => {
    await openGroupStream();
    act(() => {
      for (const listener of mockNetInfoListeners) listener({ isConnected: false });
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`${RECORD_CARD}-certify`));
    });
    expect(await screen.findByTestId(`${RECORD_CARD}-notice`)).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(api.certifyGroupSet).not.toHaveBeenCalled();
    expect(screen.getByTestId(`${RECORD_CARD}-status`)).toHaveTextContent('Not certified yet');
  });

  it('success: shows the server state at once, refreshes the stream, and opens no sheet', async () => {
    api.certifyGroupSet.mockResolvedValue({ certification: certificationPayload(), created: true });
    await openGroupStream();
    const streamCalls = api.getGroupStream.mock.calls.length;
    // The re-read after the write carries the certification.
    api.getGroupStream.mockResolvedValue(
      page([linkItem(), recordItem({ certified: true, certification: { certification_id: 'cert-1', certified_by: { user_id: ME, username: 'me' }, certified_at_ms: 1 } }), sessionCardItem()]),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId(`${RECORD_CARD}-certify`));
    });

    expect(api.certifyGroupSet).toHaveBeenCalledWith({ groupId: GROUP_ID, groupExerciseId: 'ge-bench', memberUserId: 'u2', setId: 'set-1' });
    await waitFor(() => expect(screen.getByTestId(`${RECORD_CARD}-status`)).toHaveTextContent('Certified by you'));
    expect(screen.getByTestId(`${RECORD_CARD}-notice`)).toHaveTextContent('Certified. Certified boards update in a few seconds.');
    expect(screen.queryByTestId(`${RECORD_CARD}-certify`)).toBeNull();
    await waitFor(() => expect(api.getGroupStream.mock.calls.length).toBeGreaterThan(streamCalls));
    expect(screen.queryByTestId('group-record-sheet')).toBeNull();
    // The write itself caches nothing: only the reads' own keys exist.
    expect(cacheKeys()).toEqual([groupCacheKeys.mine, groupCacheKeys.stream(GROUP_ID)].sort());
  });

  it('a stream read that lands with the pre-write state does not undo the shown certification', async () => {
    api.certifyGroupSet.mockResolvedValue({ certification: certificationPayload(), created: true });
    await openGroupStream();
    // The re-read after the write is stale (e.g. a poll already in flight when the write committed).
    const streamCalls = api.getGroupStream.mock.calls.length;
    await act(async () => {
      fireEvent.press(screen.getByTestId(`${RECORD_CARD}-certify`));
    });
    await waitFor(() => expect(api.getGroupStream.mock.calls.length).toBeGreaterThan(streamCalls));
    await waitFor(() => expect(screen.getByTestId(`${RECORD_CARD}-status`)).toHaveTextContent('Certified by you'));
    expect(screen.queryByTestId(`${RECORD_CARD}-certify`)).toBeNull();
  });

  it('CONFLICT: says nothing was certified and re-reads the stream', async () => {
    api.certifyGroupSet.mockRejectedValue(new GroupApiError('CONFLICT', 'the set changed; refresh and try again'));
    await openGroupStream();
    const streamCalls = api.getGroupStream.mock.calls.length;
    await act(async () => {
      fireEvent.press(screen.getByTestId(`${RECORD_CARD}-certify`));
    });
    expect(await screen.findByTestId(`${RECORD_CARD}-notice`)).toHaveTextContent(
      'This set changed since it loaded. Nothing was certified — refresh and try again.',
    );
    await waitFor(() => expect(api.getGroupStream.mock.calls.length).toBeGreaterThan(streamCalls));
  });

  it('group NOT_FOUND: evicts the group, and My groups no longer lists it', async () => {
    api.certifyGroupSet.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    await openGroupStream();
    api.listMyGroups.mockResolvedValue({ groups: [] });
    api.getGroupStream.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    await act(async () => {
      fireEvent.press(screen.getByTestId(`${RECORD_CARD}-certify`));
    });
    expect(await screen.findByTestId('groups-empty-state')).toBeTruthy();
    await waitFor(() => expect(cacheKeys()).toEqual([groupCacheKeys.mine]));
  });
});

describe('the row detail sheet (E2)', () => {
  const openSheet = async () => {
    await openGroupStream();
    fireEvent.press(screen.getByTestId(`${RECORD_CARD}-open`));
    return screen.findByTestId('group-record-sheet');
  };

  it('shows values, date and gym, logged-as from the session detail, and View full session', async () => {
    await openSheet();
    // The sheet's title row (a `Sheet`, G5) names the lifter and the exercise.
    expect(screen.getByTestId('group-record-sheet-header')).toHaveTextContent('dave · Bench Press');
    expect(screen.getByTestId('group-record-sheet-value').props.accessibilityLabel).toBe('140.0 × 1 · 1RM 142.5');
    // No Close: the backdrop dismisses. Certify is the sheet's one accent (G6).
    expect(screen.queryByTestId('group-record-sheet-close')).toBeNull();
    expect(accentGrounds(screen.getByTestId('group-record-sheet'))).toEqual(['group-record-sheet-certify']);
    expect(screen.queryByTestId('group-record-sheet-logged')).toBeNull();
    expect(await screen.findByTestId('group-record-sheet-logged-as')).toHaveTextContent('Logged as "Bench (comp grip)"');
    expect(screen.getByTestId('group-record-sheet-date')).toHaveTextContent('12 Sep 2026 · Iron Temple');
    expect(api.getGroupSessionDetail).toHaveBeenCalledWith('u2', 's1');
    expect(screen.getByTestId('group-record-sheet-certify')).toBeTruthy();
    expect(screen.queryByTestId('group-record-sheet-cancel')).toBeNull();

    fireEvent.press(screen.getByTestId('group-record-sheet-view-session'));
    expect(mockRouter.push).toHaveBeenCalledWith('/group-session/u2/s1');
    expect(screen.queryByTestId('group-record-sheet')).toBeNull();
  });

  it('a session the server no longer shows hides View full session', async () => {
    api.getGroupSessionDetail.mockRejectedValue(new GroupApiError('NOT_FOUND', 'session not found'));
    await openSheet();
    await waitFor(() => expect(screen.queryByTestId('group-record-sheet-view-session')).toBeNull());
  });

  it('certify in the sheet, with a record set that is no longer a record', async () => {
    api.certifyGroupSet.mockRejectedValue(new GroupApiError('NOT_FOUND', 'record set not found'));
    await openSheet();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-record-sheet-certify'));
    });
    expect(await screen.findByTestId('group-record-sheet-notice')).toHaveTextContent('This set is no longer a record. Nothing was certified.');
    // The card does not duplicate the sheet's notice.
    expect(screen.queryByTestId(`${RECORD_CARD}-notice`)).toBeNull();
  });

  it('Remove my certification confirms first; dismissing sends nothing; confirming withdraws', async () => {
    const mine = { certification_id: 'cert-1', certified_by: { user_id: ME, username: 'me' }, certified_at_ms: RECORD_AT_MS };
    api.getGroupStream.mockResolvedValue(page([recordItem({ certified: true, certification: mine }), sessionCardItem()]));
    api.withdrawGroupCertification.mockResolvedValue({
      certification: certificationPayload({ ended_at_ms: 2, end_reason: 'withdrawn', ended_by: { user_id: ME, username: 'me' } }),
    });
    await openSheet();
    expect(screen.getByTestId('group-record-sheet-status')).toHaveTextContent('Certified by you · 12 Sep');

    fireEvent.press(screen.getByTestId('group-record-sheet-withdraw'));
    expect(alertSpy).toHaveBeenCalledWith('Remove your certification?', expect.any(String), expect.any(Array));
    expect(api.withdrawGroupCertification).not.toHaveBeenCalled();

    // The stream re-read after the write no longer carries the certification.
    api.getGroupStream.mockResolvedValue(page([recordItem(), sessionCardItem()]));
    await confirmAlert();
    expect(api.withdrawGroupCertification).toHaveBeenCalledWith(GROUP_ID, 'cert-1');
    expect(await screen.findByTestId('group-record-sheet-notice')).toHaveTextContent('Your certification was removed.');
    await waitFor(() => expect(screen.getByTestId('group-record-sheet-status')).toHaveTextContent('Not certified yet'));
  });

  it('a member sees neither Cancel nor Remove on someone else\'s certification', async () => {
    const other = { certification_id: 'cert-9', certified_by: { user_id: 'u3', username: 'sam' }, certified_at_ms: RECORD_AT_MS };
    api.getGroupStream.mockResolvedValue(page([recordItem({ certified: true, certification: other }), sessionCardItem()]));
    await openSheet();
    expect(screen.queryByTestId('group-record-sheet-cancel')).toBeNull();
    expect(screen.queryByTestId('group-record-sheet-withdraw')).toBeNull();
  });

  it('as owner: a confirmed Cancel certification ends it', async () => {
    const other = { certification_id: 'cert-9', certified_by: { user_id: 'u3', username: 'sam' }, certified_at_ms: RECORD_AT_MS };
    mockMyRole('owner');
    api.getGroupStream.mockResolvedValue(page([recordItem({ certified: true, certification: other }), sessionCardItem()]));
    api.cancelGroupCertification.mockResolvedValue({
      certification: certificationPayload({
        certification_id: 'cert-9',
        certified_by: other.certified_by,
        ended_at_ms: 3,
        end_reason: 'cancelled',
        ended_by: { user_id: ME, username: 'me' },
      }),
    });
    await openSheet();
    fireEvent.press(await screen.findByTestId('group-record-sheet-cancel'));
    await confirmAlert();
    expect(api.cancelGroupCertification).toHaveBeenCalledWith(GROUP_ID, 'cert-9');
    expect(await screen.findByTestId('group-record-sheet-notice')).toHaveTextContent('Certification cancelled.');
    expect(screen.getByTestId('group-record-sheet-status')).toHaveTextContent('Not certified yet');
  });

  it('as admin: Cancel certification confirms, and FORBIDDEN (role changed) refreshes', async () => {
    const other = { certification_id: 'cert-9', certified_by: { user_id: 'u3', username: 'sam' }, certified_at_ms: RECORD_AT_MS };
    mockMyRole('admin');
    api.getGroupStream.mockResolvedValue(page([recordItem({ certified: true, certification: other }), sessionCardItem()]));
    api.cancelGroupCertification.mockRejectedValue(new GroupApiError('FORBIDDEN', 'only the owner or an admin can cancel a certification'));
    await openSheet();
    const groupCalls = api.listMyGroups.mock.calls.length;

    fireEvent.press(await screen.findByTestId('group-record-sheet-cancel'));
    expect(alertSpy).toHaveBeenCalledWith('Cancel this certification?', expect.any(String), expect.any(Array));
    await confirmAlert();
    expect(api.cancelGroupCertification).toHaveBeenCalledWith(GROUP_ID, 'cert-9');
    expect(await screen.findByTestId('group-record-sheet-notice')).toHaveTextContent('Only owners and admins can cancel a certification.');
    await waitFor(() => expect(api.listMyGroups.mock.calls.length).toBeGreaterThan(groupCalls));
  });
});

describe('full-board rows open the sheet (card AC8)', () => {
  const converted = (overrides: Partial<BoardRow> = {}): BoardRow => ({
    rank: 1,
    member: { user_id: 'u2', username: 'dave' },
    former: false,
    value_kg: 51.25,
    weight_kg: 51.25,
    reps: 5,
    e1rm_kg: 59.79,
    entered_weight_kg: 102.5,
    load_factor: 0.5,
    achieved_at_ms: RECORD_AT_MS,
    session_id: 's1',
    set_id: 'set-1',
    exercise_name: 'Bench Press',
    certified: false,
    certification: null,
    ...overrides,
  });

  const boardWith = (rows: BoardRow[]) => ({
    exercise: { group_exercise_id: 'ge-bench', name: 'Prowler Push', load_input_mode: 'per_side_load' as const, source_exercise_id: null, archived_at_ms: null },
    metric: 'weight' as const,
    certified: false,
    rows,
    next_cursor: null,
    has_more: false,
  });

  it('opens the row, certifies, and refetches the board first page', async () => {
    api.getGroupBoard.mockResolvedValue(boardWith([converted()]));
    api.certifyGroupSet.mockResolvedValue({ certification: certificationPayload(), created: true });
    mockParams = { groupId: GROUP_ID, exerciseId: 'ge-bench', metric: 'weight', scope: 'all' };
    render(<GroupBoardRoute />);

    fireEvent.press(await screen.findByTestId('group-board-row-1'));
    expect(await screen.findByTestId('group-record-sheet')).toBeTruthy();
    expect(screen.getByTestId('group-record-sheet-header')).toHaveTextContent('dave · Prowler Push');
    expect(screen.getByTestId('group-record-sheet-logged')).toHaveTextContent('Logged 102.5 kg total · counted as 51.25 kg per side');
    expect(screen.getByTestId('group-record-sheet-logged-as')).toHaveTextContent('Logged as "Bench Press"');

    const boardCalls = api.getGroupBoard.mock.calls.length;
    api.getGroupBoard.mockResolvedValue(
      boardWith([
        converted({ certified: true, certification: { certification_id: 'cert-1', certified_by: { user_id: ME, username: 'me' }, certified_at_ms: RECORD_AT_MS } }),
      ]),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-record-sheet-certify'));
    });
    expect(api.certifyGroupSet).toHaveBeenCalledWith({ groupId: GROUP_ID, groupExerciseId: 'ge-bench', memberUserId: 'u2', setId: 'set-1' });
    await waitFor(() => expect(api.getGroupBoard.mock.calls.length).toBeGreaterThan(boardCalls));
    expect(api.getGroupBoard).toHaveBeenLastCalledWith(expect.objectContaining({ after: null }));
    await waitFor(() => expect(screen.getByTestId('group-record-sheet-status')).toHaveTextContent(/^Certified by you · /));
    expect(screen.getByTestId('group-board-row-1-mark-certified', { includeHiddenElements: true })).toBeTruthy();
  });

  it('a former member\'s row offers no Certify; an admin sees Cancel on a certified row', async () => {
    mockMyRole('admin');
    api.getGroupBoard.mockResolvedValue(
      boardWith([
        converted({ former: true }),
        converted({
          rank: 2,
          member: { user_id: 'u5', username: 'kim' },
          set_id: 'set-5',
          certified: true,
          certification: { certification_id: 'cert-5', certified_by: { user_id: 'u3', username: 'sam' }, certified_at_ms: RECORD_AT_MS },
        }),
      ]),
    );
    mockParams = { groupId: GROUP_ID, exerciseId: 'ge-bench', metric: 'weight', scope: 'all' };
    render(<GroupBoardRoute />);

    fireEvent.press(await screen.findByTestId('group-board-row-1'));
    expect(await screen.findByTestId('group-record-sheet')).toBeTruthy();
    expect(screen.queryByTestId('group-record-sheet-certify')).toBeNull();
    fireEvent.press(screen.getByTestId('group-record-sheet-backdrop', { includeHiddenElements: true }));
    await waitFor(() => expect(screen.queryByTestId('group-record-sheet')).toBeNull());

    fireEvent.press(screen.getByTestId('group-board-row-2'));
    expect(await screen.findByTestId('group-record-sheet-cancel')).toBeTruthy();
  });
});

describe('the Groups screen', () => {
  it('takes my role from My groups and refreshes the selected group after a write', async () => {
    const other = { certification_id: 'cert-9', certified_by: { user_id: 'u3', username: 'sam' }, certified_at_ms: RECORD_AT_MS };
    mockMyRole('admin');
    api.getGroupStream.mockResolvedValue(
      page([recordItem(), sessionCardItem(), recordItem({ key: 'ev-cert', set_id: 'set-9', session_id: 's9', certified: true, certification: other })]),
    );
    api.certifyGroupSet.mockResolvedValue({ certification: certificationPayload(), created: true });
    render(<GroupsTabRoute />);

    await screen.findByTestId(RECORD_CARD);
    // One group's stream names no group.
    expect(screen.queryByTestId(`${RECORD_CARD}-group`)).toBeNull();
    expect(api.getGroupStream).toHaveBeenCalledWith({ groupId: GROUP_ID });

    const streamCalls = api.getGroupStream.mock.calls.length;
    await act(async () => {
      fireEvent.press(screen.getByTestId(`${RECORD_CARD}-certify`));
    });
    await waitFor(() => expect(api.getGroupStream.mock.calls.length).toBeGreaterThan(streamCalls));
    expect(api.getGroupStream).toHaveBeenLastCalledWith({ groupId: GROUP_ID });

    fireEvent.press(screen.getByTestId('group-stream-record-card-ev-cert-open'));
    expect(await screen.findByTestId('group-record-sheet-cancel')).toBeTruthy();
  });
});
