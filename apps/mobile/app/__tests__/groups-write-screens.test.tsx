/* eslint-disable import/first */

/**
 * M22-T05 group write flows (groups contract §4.3, §6.3; task card flows
 * 1–5): create with the username gate, join (incl. the deep-link code param),
 * invite / share / regenerate, edit, member actions per role, and leave.
 * Every write's offline attempt is refused with no RPC (C3.10.3, AC12). The
 * RPCs and the profile API are mocked; the cache is the real `group_cache` on
 * the in-memory SQLite fixture.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Share, type AlertButton } from 'react-native';

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
      return () => {
        mockNetInfoListeners.delete(listener);
      };
    },
  },
}));

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

jest.mock('@/src/auth/profile', () => ({ loadUserProfile: jest.fn(), saveUsername: jest.fn() }));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
  getGroup: jest.fn(),
  getGroupStream: jest.fn(),
  createGroup: jest.fn(),
  updateGroup: jest.fn(),
  getGroupInviteCode: jest.fn(),
  regenerateGroupInviteCode: jest.fn(),
  previewGroupInvite: jest.fn(),
  joinGroup: jest.fn(),
  leaveGroup: jest.fn(),
  removeGroupMember: jest.fn(),
  setGroupMemberRole: jest.fn(),
  transferGroupOwnership: jest.fn(),
}));

import * as profileApi from '@/src/auth/profile';
import {
  GROUP_OFFLINE_ACTION_MESSAGE,
  GroupApiError,
  groupCacheKeys,
  readGroupCache,
  writeGroupCache,
  type GroupGetResult,
  type GroupRole,
  type GroupSummary,
} from '@/src/groups';
import * as groupsApi from '@/src/groups/api';

import GroupsTabRoute from '../(tabs)/groups';
import EditGroupRoute from '../group/[groupId]/edit';
import GroupScreenRoute from '../group/[groupId]/index';
import GroupMembersRoute from '../group/[groupId]/members';
import GroupInviteRoute from '../group/[groupId]/invite';
import JoinGroupRoute from '../group/join';
import MyGroupsRoute from '../group/mine';
import NewGroupRoute from '../group/new';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
const profile = profileApi as jest.Mocked<typeof profileApi>;

const USER_ID = 'user-me';
const GROUP_ID = 'group-a';

const profileWith = (username: string | null) => ({
  profile: { id: USER_ID, username, createdAt: '', updatedAt: '' },
  wasProvisioned: false,
});

const summary = (my_role: GroupRole): GroupSummary => ({
  group_id: GROUP_ID,
  name: 'Garage Gym',
  description: 'Early crew',
  member_count: 4,
  my_role,
});

/** `group_get` from my view: me with `myRole`, plus one member of every other role. */
const detailFor = (myRole: GroupRole): GroupGetResult => {
  const others = [
    { user_id: 'u-owner', username: 'olga', role: 'owner' as const },
    { user_id: 'u-admin', username: 'bea', role: 'admin' as const },
    { user_id: 'u-member', username: 'alex', role: 'member' as const },
  ].filter((member) => member.role !== myRole || member.role === 'member');
  return { group: summary(myRole), members: [{ user_id: USER_ID, username: 'me', role: myRole }, ...others] };
};

const emitNetInfo = (isConnected: boolean) => {
  act(() => {
    for (const listener of mockNetInfoListeners) listener({ isConnected });
  });
};

const alertSpy = () => jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

/** Presses the named button of the latest `Alert.alert`. */
const pressAlertButton = async (spy: jest.SpyInstance, text: string) => {
  const buttons = spy.mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async () => {
    buttons.find((button) => button.text === text)?.onPress?.();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  fixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
  mockParams = {};
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: USER_ID } });
  profile.loadUserProfile.mockResolvedValue(profileWith('me'));
  profile.saveUsername.mockResolvedValue(profileWith('alex').profile);
  api.listMyGroups.mockResolvedValue({ groups: [summary('owner')] });
  api.getGroupStream.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
  api.getGroup.mockResolvedValue(detailFor('owner'));
  api.getGroupInviteCode.mockResolvedValue({ code: 'ABCD2345' });
});

afterEach(() => {
  fixture.close();
});

describe('Groups tab and My groups actions', () => {
  it('keeps Join / Create off the Groups screen and on My groups', async () => {
    render(<GroupsTabRoute />);
    await screen.findByTestId('groups-stream-empty', {}, { timeout: 5_000 });
    expect(screen.queryByTestId('groups-create-button')).toBeNull();
    expect(screen.queryByTestId('groups-join-button')).toBeNull();

    screen.unmount();
    render(<MyGroupsRoute />);
    fireEvent.press(await screen.findByTestId('group-mine-create-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/group/new');
    fireEvent.press(screen.getByTestId('group-mine-join-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/group/join');
  });

  it('puts Create / Join in the empty state instead of the header when there are no groups', async () => {
    api.listMyGroups.mockResolvedValue({ groups: [] });
    render(<GroupsTabRoute />);
    const empty = within(await screen.findByTestId('groups-empty-state'));
    fireEvent.press(empty.getByTestId('groups-empty-create-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/group/new');
    fireEvent.press(empty.getByTestId('groups-empty-join-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/group/join');

    screen.unmount();
    render(<MyGroupsRoute />);
    fireEvent.press(await screen.findByTestId('group-mine-empty-create-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/group/new');
  });
});

describe('Create group (flow 1)', () => {
  const fillAndSubmit = async (name: string, description = '') => {
    fireEvent.changeText(screen.getByTestId('group-form-name-input'), name);
    fireEvent.changeText(screen.getByTestId('group-form-description-input'), description);
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-form-submit'));
    });
  };

  it('shows the username gate first when the username is blank, then creates and opens the group as owner (AC1, AC2)', async () => {
    profile.loadUserProfile.mockResolvedValue(profileWith('  '));
    api.createGroup.mockResolvedValue({ group_id: 'g-new' });
    render(<NewGroupRoute />);

    await screen.findByTestId('group-username-gate');
    expect(screen.queryByTestId('group-form')).toBeNull();
    fireEvent.press(screen.getByTestId('group-username-save'));
    expect(screen.getByTestId('group-username-error').props.children).toBe('Enter a username.');
    expect(profile.saveUsername).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('group-username-input'), ' alex ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-username-save'));
    });
    expect(profile.saveUsername).toHaveBeenCalledWith(USER_ID, 'alex');

    await screen.findByTestId('group-form');
    await fillAndSubmit('  Garage Gym ', '   ');
    expect(api.createGroup).toHaveBeenCalledWith({ name: 'Garage Gym', description: null });
    expect(mockRouter.replace).toHaveBeenCalledWith('/group/g-new');
  });

  it('validates name and description inline without calling the server', async () => {
    render(<NewGroupRoute />);
    await screen.findByTestId('group-form');
    await fillAndSubmit('   ');
    expect(screen.getByTestId('group-form-name-error').props.children).toBe('Enter a group name.');
    await fillAndSubmit('x'.repeat(51), 'y'.repeat(281));
    expect(screen.getByTestId('group-form-name-error').props.children).toBe('Use 50 characters or fewer.');
    expect(screen.getByTestId('group-form-description-error').props.children).toBe('Use 280 characters or fewer.');
    expect(api.createGroup).not.toHaveBeenCalled();
  });

  it('refuses offline with a clear error and creates nothing (AC12)', async () => {
    render(<NewGroupRoute />);
    await screen.findByTestId('group-form');
    emitNetInfo(false);
    await fillAndSubmit('Garage Gym');
    expect(screen.getByTestId('group-form-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(api.createGroup).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('re-opens the gate on the server USERNAME_REQUIRED and keeps the draft', async () => {
    api.createGroup
      .mockRejectedValueOnce(new GroupApiError('USERNAME_REQUIRED', 'username required'))
      .mockResolvedValue({ group_id: 'g-new' });
    render(<NewGroupRoute />);
    await screen.findByTestId('group-form');
    await fillAndSubmit('Garage Gym');
    expect(await screen.findByTestId('group-username-gate-notice')).toHaveTextContent('Set a username before creating a group.');

    fireEvent.changeText(screen.getByTestId('group-username-input'), 'alex');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-username-save'));
    });
    expect(screen.getByTestId('group-form-name-input').props.value).toBe('Garage Gym');
  });

  it('shows a transport failure as a clear "nothing changed" error', async () => {
    api.createGroup.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    render(<NewGroupRoute />);
    await screen.findByTestId('group-form');
    await fillAndSubmit('Garage Gym');
    expect(screen.getByTestId('group-form-error')).toHaveTextContent(/Nothing was changed/);
  });
});

describe('Join group (flow 3)', () => {
  const preview = { group_id: GROUP_ID, name: 'Garage Gym', member_count: 3, already_member: false };

  it('prefills the deep-link code param, previews it, and joins (AC3)', async () => {
    mockParams = { code: 'ABCD2345' };
    api.previewGroupInvite.mockResolvedValue(preview);
    api.joinGroup.mockResolvedValue({ group_id: GROUP_ID, joined: true });
    render(<JoinGroupRoute />);

    expect(await screen.findByTestId('group-join-preview-name')).toHaveTextContent('Garage Gym');
    expect(screen.getByTestId('group-join-code-input').props.value).toBe('ABCD2345');
    expect(screen.getByTestId('group-join-preview-meta')).toHaveTextContent('3 members');
    expect(api.previewGroupInvite).toHaveBeenCalledWith('ABCD2345');

    await act(async () => {
      fireEvent.press(screen.getByTestId('group-join-submit'));
    });
    expect(api.joinGroup).toHaveBeenCalledWith('ABCD2345');
    expect(mockRouter.replace).toHaveBeenCalledWith(`/group/${GROUP_ID}`);
  });

  it('shows "This invite code isn\'t valid" for an unknown or regenerated code (AC4)', async () => {
    api.previewGroupInvite.mockRejectedValue(new GroupApiError('INVITE_INVALID', 'invite code not valid'));
    render(<JoinGroupRoute />);
    await screen.findByTestId('group-join-form');
    fireEvent.changeText(screen.getByTestId('group-join-code-input'), 'OLDC0DE1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-join-preview-button'));
    });
    expect(screen.getByTestId('group-join-error')).toHaveTextContent("This invite code isn't valid.");
    expect(screen.queryByTestId('group-join-preview')).toBeNull();
  });

  it('opens the group without joining when already a member', async () => {
    mockParams = { code: 'ABCD2345' };
    api.previewGroupInvite.mockResolvedValue({ ...preview, already_member: true });
    render(<JoinGroupRoute />);
    expect(await screen.findByText("3 members · You're already a member")).toBeTruthy();
    fireEvent.press(screen.getByTestId('group-join-submit'));
    expect(mockRouter.replace).toHaveBeenCalledWith(`/group/${GROUP_ID}`);
    expect(api.joinGroup).not.toHaveBeenCalled();
  });

  it('runs the username gate before the code preview', async () => {
    mockParams = { code: 'ABCD2345' };
    profile.loadUserProfile.mockResolvedValue(profileWith(null));
    api.previewGroupInvite.mockResolvedValue(preview);
    render(<JoinGroupRoute />);
    await screen.findByTestId('group-username-gate');
    expect(api.previewGroupInvite).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('group-username-input'), 'alex');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-username-save'));
    });
    expect(await screen.findByTestId('group-join-preview')).toBeTruthy();
  });

  it('refuses to join offline and changes nothing (AC12)', async () => {
    mockParams = { code: 'ABCD2345' };
    api.previewGroupInvite.mockResolvedValue(preview);
    render(<JoinGroupRoute />);
    await screen.findByTestId('group-join-preview');
    emitNetInfo(false);
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-join-submit'));
    });
    expect(screen.getByTestId('group-join-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(api.joinGroup).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('drops the preview when the code is regenerated between preview and join', async () => {
    mockParams = { code: 'ABCD2345' };
    api.previewGroupInvite.mockResolvedValue(preview);
    api.joinGroup.mockRejectedValue(new GroupApiError('INVITE_INVALID', 'invite code not valid'));
    render(<JoinGroupRoute />);
    await screen.findByTestId('group-join-preview');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-join-submit'));
    });
    expect(screen.getByTestId('group-join-error')).toHaveTextContent("This invite code isn't valid.");
    expect(screen.queryByTestId('group-join-preview')).toBeNull();
  });
});

describe('Invite (flow 2)', () => {
  beforeEach(() => {
    mockParams = { groupId: GROUP_ID };
  });

  it('shows the code and shares it with the boga3:// link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    render(<GroupInviteRoute />);
    expect(await screen.findByTestId('group-invite-code')).toHaveTextContent('ABCD2345');
    expect(screen.getByTestId('group-invite-link')).toHaveTextContent('boga3://group/join?code=ABCD2345');
    await waitFor(() => expect(screen.getByText('Invite friends to Garage Gym')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-invite-share'));
    });
    expect(share).toHaveBeenCalledWith({
      message: 'Join my group "Garage Gym" on BOGA.\nInvite code: ABCD2345\nboga3://group/join?code=ABCD2345',
    });
  });

  it('regenerates only after confirmation, and shows the new code', async () => {
    const alert = alertSpy();
    api.regenerateGroupInviteCode.mockResolvedValue({ code: 'NEWC0DE9' });
    render(<GroupInviteRoute />);
    await screen.findByTestId('group-invite-code');

    fireEvent.press(screen.getByTestId('group-invite-regenerate'));
    expect(alert.mock.calls[0][1]).toMatch(/The old code stops working/);
    await pressAlertButton(alert, 'Cancel');
    expect(api.regenerateGroupInviteCode).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('group-invite-regenerate'));
    await pressAlertButton(alert, 'Regenerate');
    expect(api.regenerateGroupInviteCode).toHaveBeenCalledWith(GROUP_ID);
    expect(screen.getByTestId('group-invite-code')).toHaveTextContent('NEWC0DE9');
    expect(screen.getByTestId('group-invite-feedback')).toHaveTextContent('New code ready. The old code no longer works.');
  });

  it('refuses to regenerate offline and keeps the old code (AC12)', async () => {
    const alert = alertSpy();
    render(<GroupInviteRoute />);
    await screen.findByTestId('group-invite-code');
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-invite-regenerate'));
    await pressAlertButton(alert, 'Regenerate');
    expect(api.regenerateGroupInviteCode).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-invite-code')).toHaveTextContent('ABCD2345');
    expect(screen.getByTestId('group-invite-feedback')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
  });

  it('never shows the code to a member (C7.4)', async () => {
    writeGroupCache(fixture.database, {
      cacheKey: groupCacheKeys.group(GROUP_ID),
      userId: USER_ID,
      payload: detailFor('member'),
      fetchedAtMs: 0,
    });
    api.getGroup.mockResolvedValue(detailFor('member'));
    render(<GroupInviteRoute />);
    expect(await screen.findByTestId('group-invite-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('group-invite-code')).toBeNull();
  });

  it('shows the forbidden state when the server refuses the code', async () => {
    api.getGroupInviteCode.mockRejectedValue(new GroupApiError('FORBIDDEN', 'forbidden'));
    render(<GroupInviteRoute />);
    expect(await screen.findByTestId('group-invite-forbidden')).toBeTruthy();
  });
});

describe('Edit group (flow 5)', () => {
  beforeEach(() => {
    mockParams = { groupId: GROUP_ID };
  });

  it('prefills the shared form and saves (owner or admin)', async () => {
    api.getGroup.mockResolvedValue(detailFor('admin'));
    api.updateGroup.mockResolvedValue({ group: summary('admin') });
    render(<EditGroupRoute />);
    await screen.findByTestId('group-form');
    expect(screen.getByTestId('group-form-name-input').props.value).toBe('Garage Gym');
    expect(screen.getByTestId('group-form-description-input').props.value).toBe('Early crew');
    fireEvent.changeText(screen.getByTestId('group-form-name-input'), 'Garage Gym 2');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-form-submit'));
    });
    expect(api.updateGroup).toHaveBeenCalledWith(GROUP_ID, { name: 'Garage Gym 2', description: 'Early crew' });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('refuses offline and changes nothing (AC12)', async () => {
    render(<EditGroupRoute />);
    await screen.findByTestId('group-form');
    emitNetInfo(false);
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-form-submit'));
    });
    expect(screen.getByTestId('group-form-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(api.updateGroup).not.toHaveBeenCalled();
  });

  it('does not offer the form to a member', async () => {
    api.getGroup.mockResolvedValue(detailFor('member'));
    render(<EditGroupRoute />);
    expect(await screen.findByTestId('group-edit-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('group-form')).toBeNull();
  });
});

const metaFor = (role: GroupRole) =>
  role === 'owner' ? "4 members · You're the owner" : role === 'admin' ? "4 members · You're an admin" : "4 members · You're a member";

describe('Group screen: role-gated header actions (flow 4)', () => {
  beforeEach(() => {
    mockParams = { groupId: GROUP_ID };
  });

  it.each<GroupRole>(['owner', 'admin'])('%s: Invite and Edit push their routes', async (role) => {
    api.getGroup.mockResolvedValue(detailFor(role));
    render(<GroupScreenRoute />);
    await screen.findByText(metaFor(role));
    fireEvent.press(screen.getByTestId('group-screen-invite-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/group/${GROUP_ID}/invite`);
    fireEvent.press(screen.getByTestId('group-screen-edit-button'));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/group/${GROUP_ID}/edit`);
  });

  it('member: no Invite or Edit (C7.4)', async () => {
    api.getGroup.mockResolvedValue(detailFor('member'));
    render(<GroupScreenRoute />);
    await screen.findByText(metaFor('member'));
    expect(screen.queryByTestId('group-screen-invite-button')).toBeNull();
    expect(screen.queryByTestId('group-screen-edit-button')).toBeNull();
  });
});

describe('Members screen: role-gated member actions and leave (flows 4–5)', () => {
  beforeEach(() => {
    mockParams = { groupId: GROUP_ID };
  });

  const renderAs = async (role: GroupRole) => {
    api.getGroup.mockResolvedValue(detailFor(role));
    render(<GroupMembersRoute />);
    await screen.findByText(metaFor(role));
  };

  const sheetActions = () =>
    within(screen.getByTestId('group-member-actions-sheet'))
      .queryAllByTestId(/^group-member-action-/)
      .map((node) => (node.props.testID as string).replace('group-member-action-', ''));

  const openSheet = (userId: string) => fireEvent.press(screen.getByTestId(`group-member-row-${userId}`));

  it('owner: no Leave but the transfer notice; each other member offers exactly the §4.3 actions', async () => {
    await renderAs('owner');
    expect(screen.queryByTestId('group-members-leave-button')).toBeNull();
    expect(screen.getByTestId('group-members-owner-leave-notice')).toHaveTextContent(/Transfer ownership before leaving/);

    openSheet('u-admin');
    expect(sheetActions()).toEqual(['remove-admin', 'transfer-ownership', 'remove']);
    fireEvent.press(screen.getByTestId('group-member-actions-cancel'));
    openSheet('u-member');
    expect(sheetActions()).toEqual(['make-admin', 'transfer-ownership', 'remove']);
    fireEvent.press(screen.getByTestId('group-member-actions-cancel'));
    openSheet(USER_ID);
    expect(screen.queryByTestId('group-member-actions-sheet')).toBeNull();
  });

  it('admin: Leave; can remove members only', async () => {
    await renderAs('admin');
    expect(screen.getByTestId('group-members-leave-button')).toBeTruthy();
    openSheet('u-member');
    expect(sheetActions()).toEqual(['remove']);
    fireEvent.press(screen.getByTestId('group-member-actions-cancel'));
    for (const userId of ['u-owner', USER_ID]) {
      openSheet(userId);
      expect(screen.queryByTestId('group-member-actions-sheet')).toBeNull();
    }
  });

  it('member: no Invite or Edit (C7.4), Leave only, and no member actions', async () => {
    await renderAs('member');
    expect(screen.queryByTestId('group-screen-invite-button')).toBeNull();
    expect(screen.queryByTestId('group-screen-edit-button')).toBeNull();
    expect(screen.getByTestId('group-members-leave-button')).toBeTruthy();
    for (const userId of ['u-owner', 'u-admin', 'u-member']) {
      openSheet(userId);
      expect(screen.queryByTestId('group-member-actions-sheet')).toBeNull();
    }
  });

  it('Make admin runs without confirmation and refreshes the list in place', async () => {
    api.setGroupMemberRole.mockResolvedValue(detailFor('owner'));
    await renderAs('owner');
    const reads = api.getGroup.mock.calls.length;
    openSheet('u-member');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-member-action-make-admin'));
    });
    expect(api.setGroupMemberRole).toHaveBeenCalledWith(GROUP_ID, 'u-member', 'admin');
    expect(screen.getByTestId('group-members-action-feedback')).toHaveTextContent('alex is now an admin.');
    await waitFor(() => expect(api.getGroup.mock.calls.length).toBeGreaterThan(reads));
  });

  it('Remove and Transfer ask for confirmation first', async () => {
    const alert = alertSpy();
    api.removeGroupMember.mockResolvedValue(detailFor('owner'));
    api.transferGroupOwnership.mockResolvedValue(detailFor('admin'));
    await renderAs('owner');

    openSheet('u-member');
    fireEvent.press(screen.getByTestId('group-member-action-remove'));
    expect(alert).toHaveBeenLastCalledWith('Remove alex?', expect.any(String), expect.any(Array));
    await pressAlertButton(alert, 'Cancel');
    expect(api.removeGroupMember).not.toHaveBeenCalled();

    openSheet('u-member');
    fireEvent.press(screen.getByTestId('group-member-action-remove'));
    await pressAlertButton(alert, 'Remove');
    expect(api.removeGroupMember).toHaveBeenCalledWith(GROUP_ID, 'u-member');
    expect(screen.getByTestId('group-members-action-feedback')).toHaveTextContent('alex was removed.');

    openSheet('u-admin');
    fireEvent.press(screen.getByTestId('group-member-action-transfer-ownership'));
    await pressAlertButton(alert, 'Transfer');
    expect(api.transferGroupOwnership).toHaveBeenCalledWith(GROUP_ID, 'u-admin');
  });

  it('shows FORBIDDEN inline and refreshes the group', async () => {
    api.setGroupMemberRole.mockRejectedValue(new GroupApiError('FORBIDDEN', 'forbidden'));
    await renderAs('owner');
    const reads = api.getGroup.mock.calls.length;
    openSheet('u-admin');
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-member-action-remove-admin'));
    });
    expect(screen.getByTestId('group-members-action-feedback')).toHaveTextContent(/not allowed to do that any more/);
    await waitFor(() => expect(api.getGroup.mock.calls.length).toBeGreaterThan(reads));
  });

  it('refuses a member action offline with no RPC (AC12)', async () => {
    const alert = alertSpy();
    await renderAs('owner');
    emitNetInfo(false);
    openSheet('u-member');
    fireEvent.press(screen.getByTestId('group-member-action-remove'));
    await pressAlertButton(alert, 'Remove');
    expect(api.removeGroupMember).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-members-action-feedback')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
  });

  it('Leave confirms, evicts the group cache, and returns to the Groups tab', async () => {
    const alert = alertSpy();
    api.leaveGroup.mockResolvedValue({ group_id: GROUP_ID });
    await renderAs('member');
    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.group(GROUP_ID), USER_ID)).not.toBeNull());

    fireEvent.press(screen.getByTestId('group-members-leave-button'));
    expect(alert).toHaveBeenLastCalledWith('Leave Garage Gym?', expect.any(String), expect.any(Array));
    await pressAlertButton(alert, 'Leave');
    expect(api.leaveGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/groups');
    expect(readGroupCache(fixture.database, groupCacheKeys.group(GROUP_ID), USER_ID)).toBeNull();
  });

  it('refuses to leave offline and stays (AC12)', async () => {
    const alert = alertSpy();
    await renderAs('member');
    emitNetInfo(false);
    fireEvent.press(screen.getByTestId('group-members-leave-button'));
    await pressAlertButton(alert, 'Leave');
    expect(api.leaveGroup).not.toHaveBeenCalled();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-members-action-feedback')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
  });
});

describe('Members screen: lost access and missing data (AC2)', () => {
  beforeEach(() => {
    mockParams = { groupId: GROUP_ID };
  });

  it("NOT_FOUND shows \"You're no longer a member\", hides the list, and evicts the cached group", async () => {
    writeGroupCache(fixture.database, { cacheKey: groupCacheKeys.group(GROUP_ID), userId: USER_ID, payload: detailFor('member'), fetchedAtMs: 1 });
    api.getGroup.mockRejectedValue(new GroupApiError('NOT_FOUND', 'group not found'));
    render(<GroupMembersRoute />);
    expect(await screen.findByTestId('group-members-lost-access')).toBeTruthy();
    expect(screen.queryByTestId('group-members-list')).toBeNull();
    await waitFor(() => expect(readGroupCache(fixture.database, groupCacheKeys.group(GROUP_ID), USER_ID)).toBeNull());
  });

  it('shows the offline empty state when the read fails with NETWORK and nothing is cached', async () => {
    api.getGroup.mockRejectedValue(new GroupApiError('NETWORK', 'Network request failed.'));
    render(<GroupMembersRoute />);
    expect(await screen.findByTestId('group-members-offline-empty-state')).toBeTruthy();
  });

  it('shows the error state with Retry on a non-network failure', async () => {
    api.getGroup.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'Something broke.'));
    render(<GroupMembersRoute />);
    expect(await screen.findByTestId('group-members-error-state')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('group-members-error-state-retry'));
    });
    expect(await screen.findByTestId('group-members-list')).toBeTruthy();
  });
});
