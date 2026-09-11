// Pure presentation rules for the group write flows (M22-T05;
// `docs/specs/tech/groups-contract.md` §4.3, §6.3): the role matrix the UI
// offers, form validation, the invite link and share text, and the
// user-facing wording for write failures. The server stays the authority —
// these rules only decide what the UI offers and how a refusal reads.

import type { GroupApiError } from './api';
import { formatMemberName } from './stream-view-model';
import type { GroupMember, GroupRole } from './types';
import { GROUP_OFFLINE_ACTION_MESSAGE } from './use-group-action';

// ---- Role matrix (contract §4.3) -------------------------------------------

export type GroupMemberAction = 'make-admin' | 'remove-admin' | 'transfer-ownership' | 'remove';

export const GROUP_MEMBER_ACTION_LABELS: Record<GroupMemberAction, string> = {
  'make-admin': 'Make admin',
  'remove-admin': 'Remove admin',
  'transfer-ownership': 'Transfer ownership',
  remove: 'Remove from group',
};

/** Actions that ask for confirmation first (08 destructive action safety pattern). */
export const DESTRUCTIVE_GROUP_MEMBER_ACTIONS: ReadonlySet<GroupMemberAction> = new Set(['transfer-ownership', 'remove']);

/**
 * Exactly the §4.3 writes my role allows against `target`:
 *
 * - owner → admin: Remove admin (`group_set_role` member), Transfer, Remove;
 * - owner → member: Make admin, Transfer, Remove;
 * - admin → member: Remove (admins remove members only);
 * - anything else — myself, the owner, an admin acting on an admin, a plain
 *   member — offers nothing. Leaving is its own action, not a member action.
 */
export const groupMemberActionsFor = (
  myRole: GroupRole,
  myUserId: string,
  target: Pick<GroupMember, 'user_id' | 'role'>,
): GroupMemberAction[] => {
  if (target.user_id === myUserId || target.role === 'owner') {
    return [];
  }
  if (myRole === 'owner') {
    return [target.role === 'admin' ? 'remove-admin' : 'make-admin', 'transfer-ownership', 'remove'];
  }
  if (myRole === 'admin' && target.role === 'member') {
    return ['remove'];
  }
  return [];
};

/** Invite, Edit (contract §4.3; C7.4: members never see the invite). */
export const canManageGroup = (role: GroupRole): boolean => role === 'owner' || role === 'admin';

/** The owner — including a sole owner — must transfer before leaving (C3.6.5). */
export const canLeaveGroup = (role: GroupRole): boolean => role !== 'owner';

export const OWNER_LEAVE_NOTICE = 'Transfer ownership before leaving';

type ActionTarget = Pick<GroupMember, 'username'>;

export const groupMemberActionConfirmation = (
  action: GroupMemberAction,
  target: ActionTarget,
): { title: string; message: string; confirmLabel: string } | null => {
  const name = formatMemberName(target.username);
  if (action === 'remove') {
    return {
      title: `Remove ${name}?`,
      message: `${name} loses access to this group. Sessions they already shared stay in the stream.`,
      confirmLabel: 'Remove',
    };
  }
  if (action === 'transfer-ownership') {
    return {
      title: `Make ${name} the owner?`,
      message: `${name} becomes the owner and you become an admin. Only the new owner can undo this.`,
      confirmLabel: 'Transfer',
    };
  }
  return null;
};

export const groupMemberActionSuccessMessage = (action: GroupMemberAction, target: ActionTarget): string => {
  const name = formatMemberName(target.username);
  switch (action) {
    case 'make-admin':
      return `${name} is now an admin.`;
    case 'remove-admin':
      return `${name} is no longer an admin.`;
    case 'transfer-ownership':
      return `${name} is now the owner.`;
    case 'remove':
      return `${name} was removed.`;
  }
};

// ---- Group details form (contract §2.1) --------------------------------------

export const GROUP_NAME_MAX_LENGTH = 50;
export const GROUP_DESCRIPTION_MAX_LENGTH = 280;

export type GroupDetailsValidation = {
  /** Trimmed name; a blank description becomes null (as the server stores it). */
  value: { name: string; description: string | null };
  errors: { name?: string; description?: string };
  valid: boolean;
};

export const validateGroupDetails = (name: string, description: string): GroupDetailsValidation => {
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const errors: GroupDetailsValidation['errors'] = {};
  if (trimmedName.length === 0) {
    errors.name = 'Enter a group name.';
  } else if (trimmedName.length > GROUP_NAME_MAX_LENGTH) {
    errors.name = `Use ${GROUP_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (trimmedDescription.length > GROUP_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Use ${GROUP_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }
  return {
    value: { name: trimmedName, description: trimmedDescription.length > 0 ? trimmedDescription : null },
    errors,
    valid: errors.name === undefined && errors.description === undefined,
  };
};

// ---- Invite (contract §6.3) ---------------------------------------------------

/** The deep link `app/group/join.tsx` opens prefilled (`boga3://group/join?code=…`). */
export const groupInviteLink = (code: string): string => `boga3://group/join?code=${encodeURIComponent(code)}`;

export const buildGroupInviteShareMessage = (groupName: string | null, code: string): string => {
  const intro = groupName ? `Join my group "${groupName}" on BOGA.` : 'Join my group on BOGA.';
  return `${intro}\nInvite code: ${code}\n${groupInviteLink(code)}`;
};

// ---- Write failures ----------------------------------------------------------

export const INVITE_INVALID_MESSAGE = "This invite code isn't valid.";
export const GROUP_WRITE_UNREACHABLE_MESSAGE = "Couldn't reach the server. Nothing was changed — try again when you're online.";

/** How a failed write reads on screen. Every write is online-only and changes nothing on failure (C3.10.3). */
export const describeGroupWriteError = (error: GroupApiError): string => {
  switch (error.code) {
    case 'NETWORK':
      return error.message === GROUP_OFFLINE_ACTION_MESSAGE ? error.message : GROUP_WRITE_UNREACHABLE_MESSAGE;
    case 'INVITE_INVALID':
      return INVITE_INVALID_MESSAGE;
    case 'FORBIDDEN':
      return "You're not allowed to do that any more. The group has been refreshed.";
    case 'NOT_FOUND':
      return 'That member or group is no longer available. The group has been refreshed.';
    case 'USERNAME_REQUIRED':
      return 'Set a username first.';
    case 'OWNER_MUST_TRANSFER':
      return `${OWNER_LEAVE_NOTICE}.`;
    case 'AUTH_REQUIRED':
      return 'Sign in again to continue.';
    default:
      return error.message;
  }
};
