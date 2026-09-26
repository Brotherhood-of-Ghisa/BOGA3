/* eslint-disable import/first */

/**
 * M25-T08 group page (card AC1–AC8; groups contract §4.4, §6.3): the Stream ·
 * Exercises · Leaderboards segments, the Exercises page (link status from the
 * local T03 link rows, owner/admin actions), and the add / edit exercise
 * routes. The group RPCs are mocked; `group_cache`, `exercise_definitions`,
 * and `exercise_group_links` are the real tables on the in-memory SQLite
 * fixture. Every write's offline attempt is refused with no RPC.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Modal, StyleSheet, type AlertButton, type ViewStyle } from 'react-native';

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
  Stack: { Screen: () => null },
}));

const mockUseAuth = jest.fn();
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  getGroup: jest.fn(),
  getGroupStream: jest.fn(),
  listGroupExercises: jest.fn(),
  getGroupBoardPodiums: jest.fn(),
  createGroupExercise: jest.fn(),
  updateGroupExercise: jest.fn(),
  archiveGroupExercise: jest.fn(),
  unarchiveGroupExercise: jest.fn(),
}));

// Link writes are the real repository on the fixture; only the sync nudge and
// the Add-as-new graph write (covered by exercise-group-links-add-as-new.test.ts) are stubbed.
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/data/exercise-group-links', () => ({
  // One module object for named and namespace imports, so a test can spy on linkExercise.
  __esModule: true,
  ...jest.requireActual('@/src/data/exercise-group-links'),
  createExerciseWithGroupLink: jest.fn(),
}));

import { uiColors, uiRoles } from '@/components/ui';
import { SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';
import * as exerciseCatalogRepo from '@/src/data/exercise-catalog';
import * as linksRepo from '@/src/data/exercise-group-links';
import { createExerciseWithGroupLink } from '@/src/data/exercise-group-links';
import { exerciseDefinitions, exerciseGroupLinks, sessions } from '@/src/data/schema';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import {
  GROUP_OFFLINE_ACTION_MESSAGE,
  GROUP_WRITE_UNREACHABLE_MESSAGE,
  GroupApiError,
  groupCacheKeys,
  readGroupCache,
  writeGroupCache,
  type GroupExercise,
  type GroupExerciseListResult,
  type GroupGetResult,
  type GroupRole,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';

import EditGroupExerciseRoute from '../group/[groupId]/exercises/[exerciseId]/edit';
import NewGroupExerciseRoute from '../group/[groupId]/exercises/new';
import GroupScreenRoute from '../group/[groupId]/index';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

const USER_ID = 'user-me';
const GROUP_ID = 'group-a';
/** 09:05 local, so "last updated 09:05" holds in any time zone. */
const T0 = new Date(2026, 8, 11, 9, 5).getTime();

const exercise = (id: string, name: string, overrides: Partial<GroupExercise> = {}): GroupExercise => ({
  group_exercise_id: id,
  name,
  load_input_mode: 'total_load',
  source_exercise_id: null,
  archived_at_ms: null,
  ...overrides,
});

const BENCH = exercise('ge-bench', 'Bench Press', { source_exercise_id: 'seed_barbell_bench_press' });
const ROW = exercise('ge-row', 'Cable Row', { load_input_mode: 'per_side_load' });
const OLD = exercise('ge-old', 'Old Squat', { archived_at_ms: T0 });
/** Server order (contract §4.4): active first, then by name. */
const LIST: GroupExerciseListResult = { exercises: [BENCH, ROW, OLD] };

const META: Record<GroupRole, string> = {
  owner: "3 members · You're the owner",
  admin: "3 members · You're an admin",
  member: "3 members · You're a member",
};

const detailFor = (role: GroupRole): GroupGetResult => ({
  group: { group_id: GROUP_ID, name: 'Garage Gym', description: null, member_count: 3, my_role: role },
  members: [{ user_id: USER_ID, username: 'me', role }],
});

const addMyExercise = (id: string, name: string) =>
  fixture.database.insert(exerciseDefinitions).values({ id, name, loadInputMode: 'total_load' }).run();

const addLink = (groupId: string, exerciseDefinitionId: string, groupExerciseId: string, deletedAt: Date | null = null) =>
  fixture.database
    .insert(exerciseGroupLinks)
    .values({ id: `${groupId}:${exerciseDefinitionId}`, exerciseDefinitionId, groupId, groupExerciseId, deletedAt })
    .run();

const seedCache = (cacheKey: string, payload: unknown) =>
  writeGroupCache(fixture.database, { cacheKey, userId: USER_ID, payload, fetchedAtMs: T0 });

const emitNetInfo = (isConnected: boolean) => {
  act(() => {
    for (const listener of mockNetInfoListeners) listener({ isConnected });
  });
};

const alertSpy = () => jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

const pressAlertButton = async (spy: jest.SpyInstance, text: string) => {
  const buttons = spy.mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async () => {
    buttons.find((button) => button.text === text)?.onPress?.();
  });
};

const openGroupAs = async (role: GroupRole) => {
  api.getGroup.mockResolvedValue(detailFor(role));
  render(<GroupScreenRoute />);
  // Without a jest cache, CI runs this file first, so its first render also
  // pays the process's cold start; the 1 s default can expire before it lands.
  await screen.findByText(META[role], {}, { timeout: 10_000 });
};

const openExercisesAs = async (role: GroupRole) => {
  await openGroupAs(role);
  await screen.findByTestId('group-exercises-list');
};

const rowIds = () => screen.getAllByTestId(/^group-exercise-row-/).map((node) => node.props.testID as string);

type TestNode = typeof screen.UNSAFE_root;

/** Host views on a primary ground: the design-language `accent`, or the legacy primary button's. */
const primaryGrounds = (): string[] =>
  screen.UNSAFE_root
    .findAll((node: TestNode) => typeof node.type === 'string')
    .filter((node: TestNode) => {
      const ground = (StyleSheet.flatten(node.props.style) as ViewStyle | undefined)?.backgroundColor;
      return ground === uiRoles.accent || ground === uiColors.actionPrimary;
    })
    .map((node: TestNode) => String(node.props.testID));

const sheetActions = () =>
  within(screen.getByTestId('group-exercise-actions-sheet'))
    .queryAllByTestId(/^group-exercise-action-/)
    .map((node) => (node.props.testID as string).replace('group-exercise-action-', ''));

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
  mockInitialOnline = null;
  mockParams = { groupId: GROUP_ID };
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: USER_ID } });
  api.getGroup.mockResolvedValue(detailFor('owner'));
  api.getGroupStream.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
  api.listGroupExercises.mockResolvedValue(LIST);
  __resetExerciseCatalogCacheForTests();
});

afterEach(() => {
  fixture.close();
});

describe('Group page (D10, D14)', () => {
  it('is for managing the group: the header, then its Exercises; no segments, stream or leaderboards', async () => {
    await openGroupAs('member');
    expect(screen.getByTestId('group-screen-exercises-title')).toBeTruthy();
    expect(await screen.findByTestId('group-exercises-list')).toBeTruthy();
    expect(screen.queryByTestId('group-screen-segment-row')).toBeNull();
    expect(api.getGroupStream).not.toHaveBeenCalled();
    expect(api.getGroupBoardPodiums).not.toHaveBeenCalled();
  });

  // G6, T13-D1: Invite is the one accent; Add exercise, in the list or the empty state, is an outline.
  it.each<GroupRole>(['owner', 'admin', 'member'])('%s: at most one accent, and only Invite', async (role) => {
    await openExercisesAs(role);
    expect(primaryGrounds()).toEqual(role === 'member' ? [] : ['group-screen-invite-button']);
  });

  it('owner with no exercises: the empty state adds no second accent', async () => {
    api.listGroupExercises.mockResolvedValue({ exercises: [] });
    await openGroupAs('owner');
    await screen.findByTestId('group-exercises-empty');
    expect(primaryGrounds()).toEqual(['group-screen-invite-button']);
  });

  it('opens the Members screen from the header member count', async () => {
    await openGroupAs('member');
    fireEvent.press(screen.getByTestId('group-screen-members-link'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/group/${GROUP_ID}/members`);
  });
});

describe('Exercises page (E0.4)', () => {
  it('lists active exercises, then archived ones marked Archived, with weight entry and my local link status', async () => {
    addMyExercise('def-comp', 'Bench (comp grip)');
    addMyExercise('def-hotel', 'Bench (hotel gym)');
    addMyExercise('def-gone', 'Old Row');
    addMyExercise('def-other', 'Squat');
    addLink(GROUP_ID, 'def-comp', 'ge-bench');
    addLink(GROUP_ID, 'def-hotel', 'ge-bench');
    // An unlinked (tombstoned) link and a link in another group do not count.
    addLink(GROUP_ID, 'def-gone', 'ge-row', new Date(T0));
    addLink('group-b', 'def-other', 'ge-old');

    await openExercisesAs('member');
    expect(rowIds()).toEqual(['group-exercise-row-ge-bench', 'group-exercise-row-ge-row', 'group-exercise-row-ge-old']);
    expect(await screen.findByTestId('group-exercise-link-status-ge-bench')).toHaveTextContent(
      'Linked: Bench (comp grip), Bench (hotel gym)',
    );
    expect(screen.getByTestId('group-exercise-link-status-ge-row')).toHaveTextContent('Not linked');
    expect(screen.getByTestId('group-exercise-link-status-ge-old')).toHaveTextContent('Not linked');
    expect(screen.getByTestId('group-exercise-load-mode-ge-row')).toHaveTextContent('Per side');
    expect(screen.getByTestId('group-exercise-archived-ge-old')).toHaveTextContent('Archived');
    expect(screen.queryByTestId('group-exercise-archived-ge-bench')).toBeNull();
    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.groupExercises(GROUP_ID), USER_ID)).not.toBeNull());
  });

  it('member: no Add exercise and no row actions', async () => {
    await openExercisesAs('member');
    expect(screen.queryByTestId('group-exercises-add-button')).toBeNull();
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    expect(screen.queryByTestId('group-exercise-actions-sheet')).toBeNull();
  });

  it.each<GroupRole>(['owner', 'admin'])('%s: Add exercise, Rename + Archive on active rows, Unarchive only on archived ones', async (role) => {
    await openExercisesAs(role);
    fireEvent.press(screen.getByTestId('group-exercises-add-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/group/${GROUP_ID}/exercises/new`);

    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    expect(sheetActions()).toEqual(['rename', 'archive']);
    fireEvent.press(screen.getByTestId('group-exercise-action-rename'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/group/${GROUP_ID}/exercises/ge-row/edit`);
    expect(screen.queryByTestId('group-exercise-actions-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    expect(sheetActions()).toEqual(['unarchive']);
  });

  it('empty list: admins see Add exercise, members are told admins add them', async () => {
    api.listGroupExercises.mockResolvedValue({ exercises: [] });
    await openGroupAs('member');
    expect(await screen.findByTestId('group-exercises-empty')).toHaveTextContent(/Admins add exercises here/);
    expect(screen.queryByTestId('group-exercises-add-button')).toBeNull();
  });

  it('empty list as owner offers Add exercise in the empty state', async () => {
    api.listGroupExercises.mockResolvedValue({ exercises: [] });
    await openGroupAs('owner');
    const empty = await screen.findByTestId('group-exercises-empty');
    expect(within(empty).getByTestId('group-exercises-add-button')).toBeTruthy();
  });

  it('renders the cached list under the offline marker when offline', async () => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
    mockInitialOnline = false;
    api.getGroup.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    api.listGroupExercises.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    render(<GroupScreenRoute />);
    await screen.findByText(META.owner);
    await screen.findByTestId('group-exercises-list');
    expect(await screen.findByText(/Offline · last updated 09:05/)).toBeTruthy();
  });

  it('shows the offline empty state when offline with nothing cached', async () => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
    mockInitialOnline = false;
    api.listGroupExercises.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    await openGroupAs('owner');
    expect(await screen.findByTestId('group-screen-exercises-offline-empty-state')).toBeTruthy();
  });

  it("NOT_FOUND on the list shows \"You're no longer a member\" and evicts the cached list", async () => {
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
    api.listGroupExercises.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    api.getGroup.mockResolvedValue(detailFor('owner'));
    render(<GroupScreenRoute />);
    expect(await screen.findByTestId('group-screen-lost-access')).toBeTruthy();
    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.groupExercises(GROUP_ID), USER_ID)).toBeNull());
  });
});

describe('Exercises page: archive and unarchive (owner, admin)', () => {
  it('Archive confirms first; confirming archives, reports it, and refreshes the list', async () => {
    const alert = alertSpy();
    api.archiveGroupExercise.mockResolvedValue({ exercise: { ...ROW, archived_at_ms: T0 } });
    await openExercisesAs('owner');

    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    fireEvent.press(screen.getByTestId('group-exercise-action-archive'));
    expect(alert).toHaveBeenLastCalledWith('Archive Cable Row?', expect.stringMatching(/read-only/), expect.any(Array));
    await pressAlertButton(alert, 'Cancel');
    expect(api.archiveGroupExercise).not.toHaveBeenCalled();

    const reads = api.listGroupExercises.mock.calls.length;
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    fireEvent.press(screen.getByTestId('group-exercise-action-archive'));
    await pressAlertButton(alert, 'Archive');
    expect(api.archiveGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-row');
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent('Cable Row was archived.');
    await waitFor(() => expect(api.listGroupExercises.mock.calls.length).toBeGreaterThan(reads));
  });

  it('Unarchive runs without confirmation', async () => {
    const alert = alertSpy();
    api.unarchiveGroupExercise.mockResolvedValue({ exercise: { ...OLD, archived_at_ms: null } });
    await openExercisesAs('admin');
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-action-unarchive'));
    });
    expect(alert).not.toHaveBeenCalled();
    expect(api.unarchiveGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-old');
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent('Old Squat is active again.');
  });

  it('refuses to archive offline with no RPC, and says nothing changed', async () => {
    const alert = alertSpy();
    await openExercisesAs('owner');
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    fireEvent.press(screen.getByTestId('group-exercise-action-archive'));
    await pressAlertButton(alert, 'Archive');
    expect(api.archiveGroupExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
  });

  it('shows FORBIDDEN inline and refreshes the group and the list', async () => {
    api.unarchiveGroupExercise.mockRejectedValue(new GroupApiError('FORBIDDEN', 'forbidden'));
    await openExercisesAs('admin');
    const groupReads = api.getGroup.mock.calls.length;
    const listReads = api.listGroupExercises.mock.calls.length;
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-action-unarchive'));
    });
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(/not allowed to do that any more/);
    await waitFor(() => expect(api.getGroup.mock.calls.length).toBeGreaterThan(groupReads));
    await waitFor(() => expect(api.listGroupExercises.mock.calls.length).toBeGreaterThan(listReads));
  });
});

describe('Add exercise route', () => {
  const renderNew = async () => {
    render(<NewGroupExerciseRoute />);
    await screen.findByTestId('group-exercise-source-row');
  };

  const submit = async () => {
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
  };

  it('copies a standard exercise: its seed id, name, and weight entry', async () => {
    const seed = SYSTEM_EXERCISE_DEFINITION_SEEDS.find((candidate) => candidate.id === 'seed_barbell_bench_press')!;
    api.createGroupExercise.mockResolvedValue({ exercise: BENCH });
    await renderNew();
    expect(screen.getByTestId('group-exercise-pick-hint')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), 'barbell bench');
    fireEvent.press(screen.getByTestId(`group-standard-exercise-${seed.id}`));
    expect(screen.getByTestId('group-exercise-form-name-input').props.value).toBe(seed.name);
    expect(screen.getByTestId('group-exercise-form-note')).toHaveTextContent(seed.name, { exact: false });

    await submit();
    expect(api.createGroupExercise).toHaveBeenCalledWith(GROUP_ID, {
      name: seed.name,
      loadInputMode: seed.loadInputMode,
      sourceExerciseId: seed.id,
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('keeps the seed id when the copied name is changed', async () => {
    api.createGroupExercise.mockResolvedValue({ exercise: BENCH });
    await renderNew();
    fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), 'barbell bench');
    fireEvent.press(screen.getByTestId('group-standard-exercise-seed_barbell_bench_press'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Comp Bench');
    await submit();
    expect(api.createGroupExercise).toHaveBeenCalledWith(
      GROUP_ID,
      expect.objectContaining({ name: 'Comp Bench', sourceExerciseId: 'seed_barbell_bench_press' }),
    );
  });

  it('says so when no standard exercise matches', async () => {
    await renderNew();
    fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), 'zzz-no-such-lift');
    expect(screen.getByTestId('group-standard-exercise-no-match')).toBeTruthy();
  });

  it('creates a custom exercise with a trimmed name, the chosen weight entry, and no source', async () => {
    api.createGroupExercise.mockResolvedValue({ exercise: ROW });
    await renderNew();
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), '  Sled Push ');
    fireEvent.press(screen.getByTestId('group-exercise-form-load-mode-per_side_load'));
    await submit();
    expect(api.createGroupExercise).toHaveBeenCalledWith(GROUP_ID, {
      name: 'Sled Push',
      loadInputMode: 'per_side_load',
      sourceExerciseId: null,
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('validates the name with the shared ExerciseCore rules before any request', async () => {
    await renderNew();
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), ' \t ');
    await submit();
    expect(screen.getByTestId('group-exercise-form-name-error')).toHaveTextContent('Exercise name is required');
    expect(api.createGroupExercise).not.toHaveBeenCalled();
  });

  it('refuses offline with no RPC and keeps the draft', async () => {
    await renderNew();
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Sled Push');
    await submit();
    expect(api.createGroupExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(screen.getByTestId('group-exercise-form-name-input').props.value).toBe('Sled Push');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('shows a transport failure as "nothing changed" and stays', async () => {
    api.createGroupExercise.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    await renderNew();
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Sled Push');
    await submit();
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_WRITE_UNREACHABLE_MESSAGE);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('does not offer the form to a member', async () => {
    api.getGroup.mockResolvedValue(detailFor('member'));
    render(<NewGroupExerciseRoute />);
    expect(await screen.findByTestId('group-exercise-new-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('group-exercise-form')).toBeNull();
  });
});

describe('Edit exercise route', () => {
  beforeEach(() => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
  });

  const renderEdit = (exerciseId: string) => {
    mockParams = { groupId: GROUP_ID, exerciseId };
    render(<EditGroupExerciseRoute />);
  };

  it('prefills the shared form from the list and saves the new name and weight entry', async () => {
    api.updateGroupExercise.mockResolvedValue({ exercise: { ...ROW, name: 'Seated Cable Row' } });
    renderEdit('ge-row');
    const nameInput = await screen.findByTestId('group-exercise-form-name-input');
    expect(nameInput.props.value).toBe('Cable Row');
    expect(screen.getByTestId('group-exercise-form-load-mode-per_side_load').props.accessibilityState).toMatchObject({ selected: true });

    fireEvent.changeText(nameInput, 'Seated Cable Row');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
    expect(api.updateGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-row', {
      name: 'Seated Cable Row',
      loadInputMode: 'per_side_load',
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('shows a server VALIDATION refusal next to the form and stays', async () => {
    api.updateGroupExercise.mockRejectedValue(
      new GroupApiError('VALIDATION', 'an archived group exercise is read-only; unarchive it first'),
    );
    renderEdit('ge-bench');
    await screen.findByTestId('group-exercise-form');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(
      'An archived group exercise is read-only; unarchive it first. Nothing was changed.',
    );
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('does not edit an archived exercise', async () => {
    renderEdit('ge-old');
    expect(await screen.findByTestId('group-exercise-edit-archived')).toBeTruthy();
    expect(screen.queryByTestId('group-exercise-form')).toBeNull();
  });

  it('says the exercise is gone when it is not in the list', async () => {
    renderEdit('ge-missing');
    expect(await screen.findByTestId('group-exercise-edit-missing')).toBeTruthy();
  });

  it('does not offer the form to a member', async () => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('member'));
    api.getGroup.mockResolvedValue(detailFor('member'));
    renderEdit('ge-row');
    expect(await screen.findByTestId('group-exercise-edit-forbidden')).toBeTruthy();
  });
});

describe('Every exercise write: offline refusal and server failure (AC6)', () => {
  const pickBench = () => {
    fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), 'barbell bench');
    fireEvent.press(screen.getByTestId('group-standard-exercise-seed_barbell_bench_press'));
  };

  const pressSubmit = async () => {
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
  };

  it('archive: a server failure shows inline and changes nothing', async () => {
    const alert = alertSpy();
    api.archiveGroupExercise.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    await openExercisesAs('owner');
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    fireEvent.press(screen.getByTestId('group-exercise-action-archive'));
    await pressAlertButton(alert, 'Archive');
    expect(api.archiveGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-row');
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(GROUP_WRITE_UNREACHABLE_MESSAGE);
    expect(screen.queryByTestId('group-exercise-archived-ge-row')).toBeNull();
  });

  it('unarchive: refused offline with no RPC', async () => {
    await openExercisesAs('owner');
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-action-unarchive'));
    });
    expect(api.unarchiveGroupExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
  });

  it('a demoted admin loses Add exercise and the row actions after FORBIDDEN', async () => {
    api.unarchiveGroupExercise.mockRejectedValue(new GroupApiError('FORBIDDEN', 'forbidden'));
    await openExercisesAs('admin');
    // Demoted on the server meanwhile: the refresh after the refusal returns a member.
    api.getGroup.mockResolvedValue(detailFor('member'));
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-old'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-action-unarchive'));
    });
    await screen.findByText(META.member);
    expect(screen.queryByTestId('group-exercises-add-button')).toBeNull();
    fireEvent.press(screen.getByTestId('group-exercise-row-ge-row'));
    expect(screen.queryByTestId('group-exercise-actions-sheet')).toBeNull();
  });

  it('catalogue add: refused offline with no RPC, keeping the pick', async () => {
    render(<NewGroupExerciseRoute />);
    await screen.findByTestId('group-exercise-source-row');
    emitNetInfo(false);
    pickBench();
    await pressSubmit();
    expect(api.createGroupExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(screen.getByTestId('group-exercise-form-note')).toBeTruthy();
  });

  it('catalogue add: a server failure shows "nothing changed" and stays', async () => {
    api.createGroupExercise.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    render(<NewGroupExerciseRoute />);
    await screen.findByTestId('group-exercise-source-row');
    pickBench();
    await pressSubmit();
    expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_WRITE_UNREACHABLE_MESSAGE);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  describe('rename', () => {
    beforeEach(() => {
      seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
      seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
      mockParams = { groupId: GROUP_ID, exerciseId: 'ge-row' };
    });

    it('is refused offline with no RPC and keeps the edit', async () => {
      render(<EditGroupExerciseRoute />);
      const nameInput = await screen.findByTestId('group-exercise-form-name-input');
      emitNetInfo(false);
      fireEvent.changeText(nameInput, 'Seated Cable Row');
      await pressSubmit();
      expect(api.updateGroupExercise).not.toHaveBeenCalled();
      expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
      expect(screen.getByTestId('group-exercise-form-name-input').props.value).toBe('Seated Cable Row');
    });

    it('shows a transport failure as "nothing changed" and stays', async () => {
      api.updateGroupExercise.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
      render(<EditGroupExerciseRoute />);
      await screen.findByTestId('group-exercise-form');
      await pressSubmit();
      expect(screen.getByTestId('group-exercise-form-error')).toHaveTextContent(GROUP_WRITE_UNREACHABLE_MESSAGE);
      expect(mockRouter.back).not.toHaveBeenCalled();
    });
  });
});

describe('Link your exercise (E0.4, link-only pick sheet)', () => {
  const liveLinks = () =>
    fixture.database
      .select()
      .from(exerciseGroupLinks)
      .all()
      .filter((row) => row.deletedAt === null);

  it.each<GroupRole>(['member', 'admin', 'owner'])(
    '%s: offered on an active row none of mine is linked to, not on a linked or an archived row',
    async (role) => {
      addMyExercise('def-comp', 'Bench (comp grip)');
      addLink(GROUP_ID, 'def-comp', 'ge-bench');
      await openExercisesAs(role);
      expect(await screen.findByTestId('group-exercise-link-button-ge-row')).toBeTruthy();
      expect(screen.queryByTestId('group-exercise-link-button-ge-bench')).toBeNull();
      expect(screen.queryByTestId('group-exercise-link-button-ge-old')).toBeNull();
    },
  );

  it('links my suggested exercise with "Link", starts no session, and the row reads Linked', async () => {
    addMyExercise('seed_barbell_bench_press', 'Barbell Bench Press');
    await openExercisesAs('member');
    fireEvent.press(await screen.findByTestId('group-exercise-link-button-ge-bench'));
    expect(await screen.findByTestId('group-pick-sheet')).toBeTruthy();
    // The copy's source seed is my exercise: suggested and preselected.
    expect(screen.getByTestId('group-pick-sheet-option-suggested').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('group-pick-sheet-confirm')).toHaveTextContent('Link');

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });

    expect(liveLinks()).toEqual([
      expect.objectContaining({ id: `${GROUP_ID}:seed_barbell_bench_press`, groupId: GROUP_ID, groupExerciseId: 'ge-bench' }),
    ]);
    expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
    expect(screen.queryByTestId('group-pick-sheet')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('group-exercise-link-status-ge-bench')).toHaveTextContent('Linked: Barbell Bench Press'),
    );
    expect(screen.queryByTestId('group-exercise-link-button-ge-bench')).toBeNull();
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent('Linked Barbell Bench Press to Bench Press.');
  });

  it('links offline: a local write needs no connection', async () => {
    addMyExercise('seed_barbell_bench_press', 'Barbell Bench Press');
    await openExercisesAs('member');
    emitNetInfo(false);
    fireEvent.press(await screen.findByTestId('group-exercise-link-button-ge-bench'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });
    expect(liveLinks()).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId('group-exercise-link-status-ge-bench')).toHaveTextContent('Linked: Barbell Bench Press'),
    );
  });

  it('Add as new opens the prefilled editor and creates my exercise with its link, adding nothing to a session', async () => {
    const create = jest.mocked(createExerciseWithGroupLink);
    create.mockResolvedValue({
      exercise: { id: 'ex-new', name: 'Bench Press', loadInputMode: 'total_load', deletedAt: null, mappings: [] },
      link: {} as never,
    });
    await openExercisesAs('member');
    fireEvent.press(await screen.findByTestId('group-exercise-link-button-ge-bench'));
    // None of my exercises matches, so Add as new is preselected.
    expect(screen.getByTestId('group-pick-sheet-option-add-new').props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));

    expect(await screen.findByTestId('exercise-editor-name-input')).toHaveProp('value', 'Bench Press');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Save exercise definition'));
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Bench Press',
        loadInputMode: 'total_load',
        mappings: expect.arrayContaining([expect.objectContaining({ muscleGroupId: 'chest', role: 'primary' })]),
      }),
      { groupId: GROUP_ID, groupExerciseId: 'ge-bench' },
    );
    expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent('Linked Bench Press to Bench Press.');
  });
});

describe('Link your exercise: failure and "Choose another" (review follow-up)', () => {
  const liveLinks = () =>
    fixture.database
      .select()
      .from(exerciseGroupLinks)
      .all()
      .filter((row) => row.deletedAt === null);

  it('a failed link shows inline in the sheet, keeps it open, and writes nothing', async () => {
    addMyExercise('seed_barbell_bench_press', 'Barbell Bench Press');
    jest.spyOn(linksRepo, 'linkExercise').mockRejectedValueOnce(new Error('Disk is full.'));
    await openExercisesAs('member');
    fireEvent.press(await screen.findByTestId('group-exercise-link-button-ge-bench'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });
    expect(screen.getByTestId('group-pick-sheet-error')).toHaveTextContent('Disk is full.');
    expect(screen.getByTestId('group-pick-sheet')).toBeTruthy();
    expect(liveLinks()).toHaveLength(0);
    expect(screen.queryByTestId('group-exercises-action-feedback')).toBeNull();
    expect(screen.getByTestId('group-exercise-link-button-ge-bench')).toBeTruthy();
  });

  it('Choose another: my exercise already linked in this group is unavailable; another links, and the first stays put', async () => {
    addMyExercise('def-a', 'Bench A');
    addMyExercise('def-b', 'Sled B');
    addLink(GROUP_ID, 'def-a', 'ge-bench');
    await openExercisesAs('member');
    fireEvent.press(await screen.findByTestId('group-exercise-link-button-ge-row'));
    fireEvent.press(screen.getByTestId('group-pick-sheet-option-other'));
    const taken = screen.getByTestId('group-pick-sheet-choice-def-a');
    expect(taken.props.accessibilityState).toMatchObject({ disabled: true });
    expect(taken.props.accessibilityLabel).toBe('Bench A, already linked in Garage Gym');
    fireEvent.press(screen.getByTestId('group-pick-sheet-choice-def-b'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-pick-sheet-confirm'));
    });
    expect(liveLinks().map((link) => [link.exerciseDefinitionId, link.groupExerciseId]).sort()).toEqual([
      ['def-a', 'ge-bench'],
      ['def-b', 'ge-row'],
    ]);
  });
});

describe('Add / edit exercise: stale prefill and late navigation (review follow-up)', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  const FRESH_ROW: GroupExercise = { ...ROW, name: 'Seated Row', load_input_mode: 'total_load' };

  const renderEditWithPendingList = () => {
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
    const fresh = deferred<GroupExerciseListResult>();
    api.listGroupExercises.mockReturnValue(fresh.promise);
    mockParams = { groupId: GROUP_ID, exerciseId: 'ge-row' };
    render(<EditGroupExerciseRoute />);
    return fresh;
  };

  it('the rename form adopts a fresher list that lands after the cached render, so Save sends the fresh fields', async () => {
    api.updateGroupExercise.mockResolvedValue({ exercise: FRESH_ROW });
    const fresh = renderEditWithPendingList();
    expect((await screen.findByTestId('group-exercise-form-name-input')).props.value).toBe('Cable Row');

    await act(async () => {
      fresh.resolve({ exercises: [BENCH, FRESH_ROW, OLD] });
    });
    await waitFor(() => expect(screen.getByTestId('group-exercise-form-name-input').props.value).toBe('Seated Row'));
    expect(screen.getByTestId('group-exercise-form-load-mode-total_load').props.accessibilityState).toMatchObject({ selected: true });

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    });
    expect(api.updateGroupExercise).toHaveBeenCalledWith(GROUP_ID, 'ge-row', { name: 'Seated Row', loadInputMode: 'total_load' });
  });

  it('keeps what the user typed when a fresher list lands afterwards', async () => {
    const fresh = renderEditWithPendingList();
    fireEvent.changeText(await screen.findByTestId('group-exercise-form-name-input'), 'My Row');
    await act(async () => {
      fresh.resolve({ exercises: [BENCH, FRESH_ROW, OLD] });
    });
    expect(screen.getByTestId('group-exercise-form-name-input').props.value).toBe('My Row');
  });

  it('add: a save that finishes after the user left does not navigate back again', async () => {
    const pending = deferred<{ exercise: GroupExercise }>();
    api.createGroupExercise.mockReturnValue(pending.promise);
    render(<NewGroupExerciseRoute />);
    await screen.findByTestId('group-exercise-source-row');
    fireEvent.press(screen.getByTestId('group-exercise-source-custom'));
    fireEvent.changeText(screen.getByTestId('group-exercise-form-name-input'), 'Sled Push');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(api.createGroupExercise).toHaveBeenCalled();
    // The user taps the header Back while the request is in flight.
    screen.unmount();
    await act(async () => {
      pending.resolve({ exercise: ROW });
    });
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('rename: a save that finishes after the user left does not navigate back again', async () => {
    const pending = deferred<{ exercise: GroupExercise }>();
    api.updateGroupExercise.mockReturnValue(pending.promise);
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('owner'));
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
    mockParams = { groupId: GROUP_ID, exerciseId: 'ge-row' };
    render(<EditGroupExerciseRoute />);
    await screen.findByTestId('group-exercise-form');
    fireEvent.press(screen.getByTestId('group-exercise-form-submit'));
    expect(api.updateGroupExercise).toHaveBeenCalled();
    screen.unmount();
    await act(async () => {
      pending.resolve({ exercise: ROW });
    });
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('Unlink from the group exercise list', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const prepare = () => {
    addMyExercise('def-a', 'My Bench');
    addLink(GROUP_ID, 'def-a', 'ge-bench');
  };
  const unlinkButton = () => screen.getByTestId('group-exercise-unlink-button-ge-bench');
  const openConfirmation = async () => {
    const spy = alertSpy();
    fireEvent.press(unlinkButton());
    return spy;
  };
  const dismissChooser = () => screen.UNSAFE_getAllByType(Modal).find((node) => node.props.testID === 'group-unlink-modal')!.props.onDismiss;
  const choose = (id: string) => {
    const dismiss = dismissChooser();
    fireEvent.press(screen.getByTestId(`group-unlink-choice-${id}`));
    // iOS presents the alert only once the native chooser has dismissed.
    act(() => dismiss());
  };

  it.each<GroupRole>(['member', 'admin', 'owner'])('%s can cancel, then remove exactly their link without navigating', async (role) => {
    prepare();
    addLink('another-group', 'def-a', 'ge-bench');
    await openExercisesAs(role);
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const spy = await openConfirmation();
    expect(spy.mock.calls[0][0]).toBe('Unlink “My Bench”?');
    expect(spy.mock.calls[0][1]).toContain('both All and Certified leaderboards');
    expect(spy.mock.calls[0][1]).toContain('Past activity and existing certifications will be kept.');
    await pressAlertButton(spy, 'Cancel');
    expect(await linksRepo.listLinks()).toHaveLength(2);
    fireEvent.press(unlinkButton());
    await pressAlertButton(spy, 'Unlink');
    await waitFor(() => expect(screen.getByTestId('group-exercise-link-status-ge-bench')).toHaveTextContent('Not linked'));
    expect(screen.getByTestId('group-exercise-link-button-ge-bench')).toBeTruthy();
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent('Unlinked “My Bench” from “Bench Press”.');
    expect((await linksRepo.listLinks()).map((link) => link.groupId)).toEqual(['another-group']);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('chooses by stable ID among duplicate, missing, and deleted names; cancel and reopen use refreshed links', async () => {
    addMyExercise('def-a', 'Same name');
    addMyExercise('def-b', 'Same name');
    addLink(GROUP_ID, 'def-a', 'ge-bench');
    addLink(GROUP_ID, 'def-b', 'ge-bench');
    addMyExercise('missing-id', 'Unavailable');
    const listCatalog = exerciseCatalogRepo.listExerciseCatalogExercises;
    jest.spyOn(exerciseCatalogRepo, 'listExerciseCatalogExercises').mockImplementation(async (options) =>
      (await listCatalog(options)).filter((exercise) => exercise.id !== 'missing-id'));
    addLink(GROUP_ID, 'missing-id', 'ge-bench');
    fixture.database.update(exerciseDefinitions).set({ deletedAt: new Date(T0) }).run();
    await openExercisesAs('member');
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const spy = alertSpy();
    fireEvent.press(unlinkButton());
    expect(screen.getByText('Your linked exercises')).toBeTruthy();
    expect(screen.getByText('Bench Press · Garage Gym')).toBeTruthy();
    expect(screen.getByText(/Unnamed personal exercise/)).toBeTruthy();
    expect(screen.getByTestId('group-unlink-choice-def-a').props.accessibilityLabel).toContain('def-a');
    expect(screen.getByTestId('group-unlink-choice-def-b').props.accessibilityLabel).toContain('def-b');
    choose('def-b');
    await pressAlertButton(spy, 'Cancel');
    expect(await linksRepo.listLinks()).toHaveLength(3);
    fireEvent.press(unlinkButton());
    choose('def-b');
    await pressAlertButton(spy, 'Unlink');
    expect((await linksRepo.listLinks()).map((link) => link.exerciseDefinitionId)).toEqual(['def-a', 'missing-id']);
    fireEvent.press(unlinkButton());
    expect(screen.queryByTestId('group-unlink-choice-def-b')).toBeNull();
    choose('missing-id');
    expect(spy.mock.calls.at(-1)?.[0]).toMatch(/Unnamed personal exercise/);
    await pressAlertButton(spy, 'Unlink');
    expect((await linksRepo.listLinks()).map((link) => link.exerciseDefinitionId)).toEqual(['def-a']);
  });

  it('dismissing the chooser does not open a confirmation or write', async () => {
    prepare();
    addMyExercise('def-b', 'Other');
    addLink(GROUP_ID, 'def-b', 'ge-bench');
    await openExercisesAs('owner');
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const spy = alertSpy();
    fireEvent.press(unlinkButton());
    const dismiss = dismissChooser();
    fireEvent.press(screen.getByTestId('group-unlink-cancel'));
    act(() => dismiss());
    expect(spy).not.toHaveBeenCalled();
    expect(await linksRepo.listLinks()).toHaveLength(2);
  });

  it('stale confirmation cannot remove a retargeted mapping', async () => {
    prepare();
    await openExercisesAs('member');
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const spy = await openConfirmation();
    await linksRepo.linkExercise('def-a', GROUP_ID, 'ge-row');
    await pressAlertButton(spy, 'Unlink');
    expect(await linksRepo.listLinks()).toEqual([expect.objectContaining({ groupExerciseId: 'ge-row' })]);
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(/link changed.*Nothing was unlinked/i);
    expect(screen.getByTestId('group-exercise-link-status-ge-row')).toHaveTextContent('Linked: My Bench');
  });

  it('a failed write leaves the link visible and can be retried from its control', async () => {
    prepare();
    await openExercisesAs('member');
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const write = jest.spyOn(linksRepo, 'unlinkExercise').mockRejectedValueOnce(new Error('Disk unavailable'));
    const spy = await openConfirmation();
    await pressAlertButton(spy, 'Unlink');
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(/Couldn't unlink.*Try again/);
    expect(await linksRepo.listLinks()).toHaveLength(1);
    fireEvent.press(unlinkButton());
    await pressAlertButton(spy, 'Unlink');
    expect(write).toHaveBeenCalledTimes(2);
    expect(await linksRepo.listLinks()).toEqual([]);
  });

  it('pending submission disables repeat taps, including a duplicate native alert callback', async () => {
    prepare();
    await openExercisesAs('member');
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const pending = deferred<boolean>();
    const write = jest.spyOn(linksRepo, 'unlinkExercise').mockReturnValue(pending.promise);
    const spy = await openConfirmation();
    await pressAlertButton(spy, 'Unlink');
    expect(unlinkButton()).toBeDisabled();
    await pressAlertButton(spy, 'Unlink');
    fireEvent.press(unlinkButton());
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
  });

  it('does not offer link or unlink while the local read is loading; read errors have a retry', async () => {
    prepare();
    const pending = deferred<Awaited<ReturnType<typeof linksRepo.listLinks>>>();
    const read = jest.spyOn(linksRepo, 'listLinks').mockReturnValueOnce(pending.promise);
    await openExercisesAs('member');
    expect(screen.queryByTestId('group-exercise-unlink-button-ge-bench')).toBeNull();
    expect(screen.queryByTestId('group-exercise-link-button-ge-bench')).toBeNull();
    await act(async () => pending.reject(new Error('Read failed')));
    expect(screen.getByTestId('group-exercises-links-error')).toBeTruthy();
    expect(screen.queryByTestId('group-exercise-link-status-ge-bench')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('group-exercises-links-retry')));
    expect(await screen.findByTestId('group-exercise-unlink-button-ge-bench')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a read failure after a committed unlink keeps success and a separate unknown-status error', async () => {
    prepare();
    await openExercisesAs('member');
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const spy = await openConfirmation();
    jest.spyOn(linksRepo, 'listLinks').mockRejectedValueOnce(new Error('Read failed'));
    await pressAlertButton(spy, 'Unlink');
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(/Unlinked “My Bench”/);
    expect(screen.getByTestId('group-exercises-links-error')).toBeTruthy();
    expect(screen.queryByTestId('group-exercise-link-status-ge-bench')).toBeNull();
    expect(await linksRepo.listLinks()).toEqual([]);
  });

  it('unlinks offline and keeps the marker and reconnect notice', async () => {
    prepare();
    seedCache(groupCacheKeys.group(GROUP_ID), detailFor('member'));
    seedCache(groupCacheKeys.groupExercises(GROUP_ID), LIST);
    mockInitialOnline = false;
    api.getGroup.mockRejectedValue(new GroupApiError('NETWORK', 'offline'));
    api.listGroupExercises.mockRejectedValue(new GroupApiError('NETWORK', 'offline'));
    await openExercisesAs('member');
    await screen.findByTestId('group-exercise-unlink-button-ge-bench');
    const spy = await openConfirmation();
    await pressAlertButton(spy, 'Unlink');
    expect(await linksRepo.listLinks()).toEqual([]);
    expect(screen.getByTestId('groups-offline-banner')).toBeTruthy();
    expect(screen.getByTestId('group-exercises-action-feedback')).toHaveTextContent(/Leaderboards will update after you reconnect and sync/);
  });

  it('archived links remain removable and the confirmation explains the frozen board', async () => {
    addMyExercise('def-a', 'My Squat');
    addLink(GROUP_ID, 'def-a', 'ge-old');
    await openExercisesAs('member');
    const button = await screen.findByTestId('group-exercise-unlink-button-ge-old');
    const spy = alertSpy();
    fireEvent.press(button);
    expect(spy.mock.calls[0][1]).toContain('Archived leaderboards stay unchanged');
    await pressAlertButton(spy, 'Unlink');
    expect(await linksRepo.listLinks()).toEqual([]);
    expect(screen.queryByTestId('group-exercise-link-button-ge-old')).toBeNull();
  });
});
