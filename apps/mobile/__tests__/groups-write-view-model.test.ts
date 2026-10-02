/**
 * M22-T05 write rules (groups contract §4.3, §6.3): the role × target matrix
 * the UI offers (AC10 UI gating), form validation, the invite link / share
 * text, and the wording of write failures.
 */

import {
  GROUP_OFFLINE_ACTION_MESSAGE,
  GroupApiError,
  buildGroupInviteShareMessage,
  canLeaveGroup,
  canManageGroup,
  describeGroupWriteError,
  groupInviteLink,
  groupMemberActionConfirmation,
  groupMemberActionsFor,
  validateGroupDetails,
  type GroupMemberAction,
  type GroupRole,
} from '@/src/groups';

const ME = 'me';
const ROLES: GroupRole[] = ['owner', 'admin', 'member'];

// Every (my role, target) pair, with exactly the §4.3 actions.
const MATRIX: { myRole: GroupRole; target: 'self' | GroupRole; actions: GroupMemberAction[] }[] = [
  { myRole: 'owner', target: 'self', actions: [] },
  { myRole: 'owner', target: 'admin', actions: ['remove-admin', 'transfer-ownership', 'remove'] },
  { myRole: 'owner', target: 'member', actions: ['make-admin', 'transfer-ownership', 'remove'] },
  { myRole: 'admin', target: 'self', actions: [] },
  { myRole: 'admin', target: 'owner', actions: [] },
  { myRole: 'admin', target: 'admin', actions: [] },
  { myRole: 'admin', target: 'member', actions: ['remove'] },
  { myRole: 'member', target: 'self', actions: [] },
  { myRole: 'member', target: 'owner', actions: [] },
  { myRole: 'member', target: 'admin', actions: [] },
  { myRole: 'member', target: 'member', actions: [] },
];

describe('groupMemberActionsFor (§4.3 role matrix)', () => {
  it.each(MATRIX)('$myRole → $target offers $actions', ({ myRole, target, actions }) => {
    const member =
      target === 'self' ? { user_id: ME, role: myRole } : { user_id: `other-${target}`, role: target };
    expect(groupMemberActionsFor(myRole, ME, member)).toEqual(actions);
  });

  it('covers every role pair, and only the owner can promote, demote, or transfer', () => {
    const others = MATRIX.filter((row) => row.target !== 'self');
    expect(others).toHaveLength(ROLES.length * ROLES.length - 1); // no second owner
    for (const row of MATRIX.filter((entry) => entry.myRole !== 'owner')) {
      expect(row.actions).not.toEqual(expect.arrayContaining(['make-admin']));
      expect(row.actions).not.toEqual(expect.arrayContaining(['remove-admin']));
      expect(row.actions).not.toEqual(expect.arrayContaining(['transfer-ownership']));
    }
  });

  it('gates Invite/Edit to owner and admins and Leave to non-owners (C7.4, C3.6.5)', () => {
    expect(ROLES.map(canManageGroup)).toEqual([true, true, false]);
    expect(ROLES.map(canLeaveGroup)).toEqual([false, true, true]);
  });

  it('asks for confirmation only for Remove and Transfer', () => {
    const target = { username: 'alex' };
    expect(groupMemberActionConfirmation('remove', target)?.title).toBe('Remove alex?');
    expect(groupMemberActionConfirmation('transfer-ownership', target)?.title).toBe('Make alex the owner?');
    expect(groupMemberActionConfirmation('make-admin', target)).toBeNull();
    expect(groupMemberActionConfirmation('remove-admin', target)).toBeNull();
  });
});

describe('validateGroupDetails', () => {
  it('trims, and stores a blank description as null', () => {
    expect(validateGroupDetails('  Garage Gym ', '   ')).toEqual({
      value: { name: 'Garage Gym', description: null },
      errors: {},
      valid: true,
    });
  });

  it('enforces name 1–50 and description ≤280 after trimming', () => {
    expect(validateGroupDetails('   ', '').errors.name).toBe('Enter a group name.');
    expect(validateGroupDetails('x'.repeat(50), 'y'.repeat(280)).valid).toBe(true);
    expect(validateGroupDetails('x'.repeat(51), '').errors.name).toBe('Use 50 characters or fewer.');
    expect(validateGroupDetails('ok', 'y'.repeat(281)).errors.description).toBe('Use 280 characters or fewer.');
  });
});

describe('invite link and share text', () => {
  it('builds the boga3:// join link and a share message carrying the code', () => {
    expect(groupInviteLink('ABCD2345')).toBe('boga3://group/join?code=ABCD2345');
    expect(buildGroupInviteShareMessage('Garage Gym', 'ABCD2345')).toBe(
      'Join my group "Garage Gym" on BOGA.\nInvite code: ABCD2345\nboga3://group/join?code=ABCD2345',
    );
  });
});

describe('describeGroupWriteError', () => {
  it.each([
    [new GroupApiError('NETWORK', GROUP_OFFLINE_ACTION_MESSAGE), GROUP_OFFLINE_ACTION_MESSAGE],
    [new GroupApiError('NETWORK', 'Network request failed.'), "Couldn't reach the server. Nothing was changed — try again when you're online."],
    [new GroupApiError('INVITE_INVALID', 'invite code not valid'), "This invite code isn't valid."],
    [new GroupApiError('OWNER_MUST_TRANSFER', 'owner must transfer'), 'Transfer ownership before leaving.'],
    [new GroupApiError('VALIDATION', 'name must be 1-50 characters'), 'name must be 1-50 characters'],
  ])('%s', (error, message) => {
    expect(describeGroupWriteError(error)).toBe(message);
  });
});
