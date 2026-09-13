// The typed group RPC client (`docs/specs/tech/groups-contract.md` §4, §6.1).
// It is the ONLY code that calls Supabase for groups. Every failure leaves this
// module as a `GroupApiError` with a contract code:
//
//   - a PostgREST error whose message starts with a known `<TOKEN>:` → that token;
//   - a transport failure (postgrest-js reports a failed fetch as `status: 0`,
//     or the call itself throws) → `NETWORK`;
//   - anything else (unknown error, unconfigured backend, malformed payload)
//     → `INTERNAL`.

import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import { validateExerciseCore, type ExerciseCore } from '@/src/exercise-core';

import {
  GROUP_SERVER_ERROR_CODES,
  type GroupCreateResult,
  type GroupErrorCode,
  type GroupExercise,
  type GroupExerciseListResult,
  type GroupExerciseWriteResult,
  type GroupGetResult,
  type GroupInviteCodeResult,
  type GroupInvitePreviewResult,
  type GroupJoinResult,
  type GroupLeaveResult,
  type GroupListMineResult,
  type GroupMemberWriteResult,
  type GroupServerErrorCode,
  type GroupSessionDetailResult,
  type GroupStreamResult,
  type GroupUpdateResult,
  type StreamCursor,
} from './types';

export class GroupApiError extends Error {
  readonly code: GroupErrorCode;

  constructor(code: GroupErrorCode, message: string) {
    super(message);
    this.name = 'GroupApiError';
    this.code = code;
  }
}

export const isGroupApiError = (value: unknown): value is GroupApiError => value instanceof GroupApiError;

const describeUnknownError = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return fallback;
};

/** Normalizes anything caught around a group call into a `GroupApiError` (`INTERNAL` unless already mapped). */
export const toGroupApiError = (error: unknown): GroupApiError =>
  isGroupApiError(error)
    ? error
    : new GroupApiError('INTERNAL', describeUnknownError(error, 'Something went wrong with groups.'));

const SERVER_ERROR_CODES: ReadonlySet<string> = new Set(GROUP_SERVER_ERROR_CODES);
const TOKEN_PREFIX_PATTERN = /^([A-Z][A-Z_]*)(?::\s*(.*))?$/s;

/** Returns the contract token a server message starts with (`'<TOKEN>: …'`), or null. */
export const matchGroupErrorToken = (message: string): GroupServerErrorCode | null => {
  const match = TOKEN_PREFIX_PATTERN.exec(message.trim());
  if (!match || !SERVER_ERROR_CODES.has(match[1])) {
    return null;
  }
  return match[1] as GroupServerErrorCode;
};

type RpcErrorLike = { message?: string | null };

/** Maps a PostgREST `{ error, status }` pair to a `GroupApiError` (see module header). */
export const mapGroupRpcError = (error: RpcErrorLike, status: number | null | undefined): GroupApiError => {
  const message = (error.message ?? '').trim();
  const token = matchGroupErrorToken(message);
  if (token) {
    const detail = message.slice(token.length).replace(/^:\s*/, '').trim();
    return new GroupApiError(token, detail.length > 0 ? detail : token);
  }
  if (status === 0) {
    return new GroupApiError('NETWORK', message.length > 0 ? message : 'Network request failed.');
  }
  return new GroupApiError('INTERNAL', message.length > 0 ? message : 'Unexpected group service error.');
};

export type GroupRpcName =
  | 'group_list_mine'
  | 'group_get'
  | 'group_stream'
  | 'group_session_detail'
  | 'group_invite_preview'
  | 'group_create'
  | 'group_update'
  | 'group_invite_get'
  | 'group_invite_regenerate'
  | 'group_join'
  | 'group_leave'
  | 'group_remove_member'
  | 'group_set_role'
  | 'group_transfer_ownership'
  | 'group_exercise_list'
  | 'group_exercise_create'
  | 'group_exercise_update'
  | 'group_exercise_archive'
  | 'group_exercise_unarchive';

type RpcResponse = { data: unknown; error: RpcErrorLike | null; status?: number | null };

const callGroupRpc = async (name: GroupRpcName, args: Record<string, unknown>): Promise<unknown> => {
  let client: ReturnType<typeof getRequiredSupabaseMobileClient>;
  try {
    client = getRequiredSupabaseMobileClient();
  } catch (error) {
    throw new GroupApiError('INTERNAL', describeUnknownError(error, 'Groups are unavailable in this build.'));
  }

  let response: RpcResponse;
  try {
    response = (await client.schema('app_public').rpc(name, args)) as RpcResponse;
  } catch (error) {
    throw new GroupApiError('NETWORK', describeUnknownError(error, 'Network request failed.'));
  }

  if (response.error) {
    throw mapGroupRpcError(response.error, response.status);
  }
  return response.data;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Minimal top-level shape check: a payload missing its contract keys is a
 * server/client contract break and fails loud as `INTERNAL` rather than
 * reaching the cache or a screen half-formed.
 */
const expectShape = <T>(rpc: GroupRpcName, data: unknown, isValid: (record: Record<string, unknown>) => boolean): T => {
  if (!isRecord(data) || !isValid(data)) {
    throw new GroupApiError('INTERNAL', `${rpc} returned an unexpected payload.`);
  }
  return data as T;
};

const isString = (value: unknown): value is string => typeof value === 'string';

// ---- Reads --------------------------------------------------------------------

export const GROUP_STREAM_DEFAULT_LIMIT = 20;

export const listMyGroups = async (): Promise<GroupListMineResult> =>
  expectShape('group_list_mine', await callGroupRpc('group_list_mine', {}), (r) => Array.isArray(r.groups));

export const getGroup = async (groupId: string): Promise<GroupGetResult> =>
  expectShape('group_get', await callGroupRpc('group_get', { p_group_id: groupId }), (r) =>
    isRecord(r.group) && Array.isArray(r.members),
  );

export type GroupStreamRequest = {
  /** Null = every group the caller is currently active in (All). */
  groupId: string | null;
  /** Null = first page. */
  before?: StreamCursor | null;
  /** `1..50`; defaults to 20. */
  limit?: number;
};

export const getGroupStream = async ({
  groupId,
  before = null,
  limit = GROUP_STREAM_DEFAULT_LIMIT,
}: GroupStreamRequest): Promise<GroupStreamResult> =>
  expectShape(
    'group_stream',
    await callGroupRpc('group_stream', { p_group_id: groupId, p_before: before, p_limit: limit }),
    (r) => Array.isArray(r.items) && typeof r.has_more === 'boolean',
  );

export const getGroupSessionDetail = async (memberUserId: string, sessionId: string): Promise<GroupSessionDetailResult> =>
  expectShape(
    'group_session_detail',
    await callGroupRpc('group_session_detail', { p_member_user_id: memberUserId, p_session_id: sessionId }),
    (r) => isRecord(r.session),
  );

export const previewGroupInvite = async (code: string): Promise<GroupInvitePreviewResult> =>
  expectShape('group_invite_preview', await callGroupRpc('group_invite_preview', { p_code: code }), (r) =>
    isString(r.group_id),
  );

// ---- Writes -------------------------------------------------------------------

export type GroupDetailsInput = {
  name: string;
  description: string | null;
};

export const createGroup = async ({ name, description }: GroupDetailsInput): Promise<GroupCreateResult> =>
  expectShape(
    'group_create',
    await callGroupRpc('group_create', { p_name: name, p_description: description }),
    (r) => isString(r.group_id),
  );

export const updateGroup = async (groupId: string, { name, description }: GroupDetailsInput): Promise<GroupUpdateResult> =>
  expectShape(
    'group_update',
    await callGroupRpc('group_update', { p_group_id: groupId, p_name: name, p_description: description }),
    (r) => isRecord(r.group),
  );

export const getGroupInviteCode = async (groupId: string): Promise<GroupInviteCodeResult> =>
  expectShape('group_invite_get', await callGroupRpc('group_invite_get', { p_group_id: groupId }), (r) =>
    isString(r.code),
  );

export const regenerateGroupInviteCode = async (groupId: string): Promise<GroupInviteCodeResult> =>
  expectShape(
    'group_invite_regenerate',
    await callGroupRpc('group_invite_regenerate', { p_group_id: groupId }),
    (r) => isString(r.code),
  );

export const joinGroup = async (code: string): Promise<GroupJoinResult> =>
  expectShape('group_join', await callGroupRpc('group_join', { p_code: code }), (r) =>
    isString(r.group_id) && typeof r.joined === 'boolean',
  );

// Membership writes (M22-T01 as-built, contract §4.3): `group_leave` returns
// `{ group_id }`; the three member-management writes return the post-write
// `group_get` payload `{ group, members }`.

const isGroupGetPayload = (r: Record<string, unknown>): boolean => isRecord(r.group) && Array.isArray(r.members);

export const leaveGroup = async (groupId: string): Promise<GroupLeaveResult> =>
  expectShape('group_leave', await callGroupRpc('group_leave', { p_group_id: groupId }), (r) => isString(r.group_id));

export const removeGroupMember = async (groupId: string, userId: string): Promise<GroupMemberWriteResult> =>
  expectShape(
    'group_remove_member',
    await callGroupRpc('group_remove_member', { p_group_id: groupId, p_user_id: userId }),
    isGroupGetPayload,
  );

export const setGroupMemberRole = async (
  groupId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<GroupMemberWriteResult> =>
  expectShape(
    'group_set_role',
    await callGroupRpc('group_set_role', { p_group_id: groupId, p_user_id: userId, p_role: role }),
    isGroupGetPayload,
  );

export const transferGroupOwnership = async (groupId: string, userId: string): Promise<GroupMemberWriteResult> =>
  expectShape(
    'group_transfer_ownership',
    await callGroupRpc('group_transfer_ownership', { p_group_id: groupId, p_user_id: userId }),
    isGroupGetPayload,
  );

// ---- Group exercises (M25-T01, contract §4.4) -----------------------------------

/** The `ExerciseCore` of a group exercise, e.g. to prefill the shared exercise form. */
export const groupExerciseCore = (exercise: GroupExercise): ExerciseCore => ({
  name: exercise.name,
  loadInputMode: exercise.load_input_mode,
});

/**
 * Runs the shared validator before any network call; a rejection is a local
 * `VALIDATION` with the validator's message. Sends the normalized (trimmed) name.
 */
const requireExerciseCore = (core: ExerciseCore): ExerciseCore => {
  const result = validateExerciseCore(core);
  if (!result.ok) {
    throw new GroupApiError('VALIDATION', result.message);
  }
  return result.value;
};

const isExerciseWritePayload = (r: Record<string, unknown>): boolean =>
  isRecord(r.exercise) && isString(r.exercise.group_exercise_id);

export const listGroupExercises = async (groupId: string): Promise<GroupExerciseListResult> =>
  expectShape('group_exercise_list', await callGroupRpc('group_exercise_list', { p_group_id: groupId }), (r) =>
    Array.isArray(r.exercises),
  );

export type CreateGroupExerciseInput = ExerciseCore & {
  /** The standard-catalogue id this copies (its name and load mode come from the client's seed data); null = custom. */
  sourceExerciseId: string | null;
};

export const createGroupExercise = async (
  groupId: string,
  { sourceExerciseId, ...core }: CreateGroupExerciseInput,
): Promise<GroupExerciseWriteResult> => {
  const { name, loadInputMode } = requireExerciseCore(core);
  return expectShape(
    'group_exercise_create',
    await callGroupRpc('group_exercise_create', {
      p_group_id: groupId,
      p_name: name,
      p_load_input_mode: loadInputMode,
      p_source_exercise_id: sourceExerciseId,
    }),
    isExerciseWritePayload,
  );
};

/** Rename and/or change the load mode (full replacement of both). Archived exercises are read-only server-side. */
export const updateGroupExercise = async (
  groupId: string,
  groupExerciseId: string,
  core: ExerciseCore,
): Promise<GroupExerciseWriteResult> => {
  const { name, loadInputMode } = requireExerciseCore(core);
  return expectShape(
    'group_exercise_update',
    await callGroupRpc('group_exercise_update', {
      p_group_id: groupId,
      p_exercise_id: groupExerciseId,
      p_name: name,
      p_load_input_mode: loadInputMode,
    }),
    isExerciseWritePayload,
  );
};

export const archiveGroupExercise = async (groupId: string, groupExerciseId: string): Promise<GroupExerciseWriteResult> =>
  expectShape(
    'group_exercise_archive',
    await callGroupRpc('group_exercise_archive', { p_group_id: groupId, p_exercise_id: groupExerciseId }),
    isExerciseWritePayload,
  );

export const unarchiveGroupExercise = async (groupId: string, groupExerciseId: string): Promise<GroupExerciseWriteResult> =>
  expectShape(
    'group_exercise_unarchive',
    await callGroupRpc('group_exercise_unarchive', { p_group_id: groupId, p_exercise_id: groupExerciseId }),
    isExerciseWritePayload,
  );
