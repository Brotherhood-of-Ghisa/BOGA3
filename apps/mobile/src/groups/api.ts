import { isCompetitionBoardWire, isCompetitionContractWire } from './competition-wire-guards';
import { isCompetitionCertificationResultWire, isCompetitionCertifyResultWire, isCompetitionExerciseListWire,
  isCompetitionExerciseWriteWire, isCompetitionHistoryWire, isCompetitionPodiumsWire, isCompetitionRevisionsWire,
  isCompetitionSessionDetailWire, isCompetitionStreamWire, isCompetitionWeekSummaryWire } from './competition-reader-guards';
import type { CompetitionBoardWire, CompetitionCertifyResultWire, CompetitionCertificationResultWire, CompetitionContractWire,
  CompetitionExerciseListWire, CompetitionExerciseWriteWire, CompetitionHistoricalMetric, CompetitionHistoryWire,
  CompetitionPodiumsWire, CompetitionRevisionsWire, CompetitionSessionDetailWire, CompetitionStreamWire, CompetitionWeekSummaryWire } from './competition-wire';
import type { CompetitionMetric } from './competition-contract';
import { validateGroupExerciseRules, type GroupExerciseRules, type GroupMetric } from './metric-contract';
import { isGroupMetricBoardWire, isGroupMetricCertificationWire, isGroupMetricExerciseWire,
  isGroupMetricHistoryWire, isGroupMetricPodiumWire, isGroupMetricRevisionWire,
  isGroupMetricStreamCursor, isGroupMetricStreamItem, isRenderedGroupMetricStreamKind } from './metric-wire-guards';
import type { GroupMetricBoardWire, GroupMetricCertificationResultWire, GroupMetricExerciseListWire,
  GroupMetricExerciseWriteWire, GroupMetricHistoryWire, GroupMetricPodiumWire, GroupMetricRevisionsWire,
  GroupMetricStreamWire, GroupMetricStreamCursor } from './metric-wire';

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
  type GroupBoardCursor,
  type GroupBoardHistoryCursor,
  type GroupBoardHistoryResult,
  type GroupBoardMetric,
  type GroupBoardPodiumsResult,
  type GroupBoardResult,
  type GroupCertificationEndResult,
  type GroupCertifyResult,
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
  type GroupWeekSummaryResult,
  type StreamCursor,
  type StreamItem,
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
  | 'group_exercise_unarchive'
  | 'group_board_podiums'
  | 'group_board'
  | 'group_board_history'
  | 'group_certify'
  | 'group_certification_withdraw'
  | 'group_certification_cancel'
  | 'group_week_summary'
  | 'group_stream_v2'
  | 'group_exercise_list_v2'
  | 'group_exercise_create_v2'
  | 'group_exercise_update_v2'
  | 'group_exercise_archive_v2'
  | 'group_exercise_unarchive_v2'
  | 'group_metric_board'
  | 'group_metric_podiums'
  | 'group_metric_revisions'
  | 'group_metric_history'
  | 'group_metric_certify'
  | 'group_metric_certification_get'
  | 'group_metric_certification_end'
  | 'group_competition_contract'
  | 'group_competition_board'
  | 'group_competition_podiums'
  | 'group_competition_exercise_list'
  | 'group_competition_exercise_create'
  | 'group_competition_exercise_update'
  | 'group_competition_exercise_archive'
  | 'group_competition_certify'
  | 'group_competition_certification_get'
  | 'group_competition_certification_end'
  | 'group_competition_revisions'
  | 'group_competition_history'
  | 'group_competition_stream'
  | 'group_competition_session_detail'
  | 'group_competition_week_summary';

type RpcResponse = { data: unknown; error: RpcErrorLike | null; status?: number | null };

const callGroupRpc = async (name: GroupRpcName, args: Record<string, unknown>, capability?: 4): Promise<unknown> => {
  let client: ReturnType<typeof getRequiredSupabaseMobileClient>;
  try {
    client = getRequiredSupabaseMobileClient();
  } catch (error) {
    throw new GroupApiError('INTERNAL', describeUnknownError(error, 'Groups are unavailable in this build.'));
  }

  let response: RpcResponse;
  try {
    const request = client.schema('app_public').rpc(name, args);
    response = (await (capability === 4 ? request.setHeader('x-boga-group-contract','4') : request)) as RpcResponse;
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
  /** One group; the app never reads the server's all-groups stream (`p_group_id` null). */
  groupId: string;
  /** Null = first page. */
  before?: StreamCursor | null;
  /** `1..50`; defaults to 20. */
  limit?: number;
};

/** The stream item kinds this build renders (M25-T10: all five); a later server may send more. */
const RENDERED_STREAM_KINDS: ReadonlySet<string> = new Set<StreamItem['kind']>([
  'session',
  'membership',
  'record',
  'record_voided',
  'link',
]);

/**
 * One stream page. Items of a kind this build does not know are dropped here,
 * so no screen or cache ever sees them; `next_cursor` is the server's, so paging
 * still walks past them. Items of a known kind are trusted as typed (the server
 * shapes are asserted by `groups-leaderboards`).
 */
export const getGroupStream = async ({
  groupId,
  before = null,
  limit = GROUP_STREAM_DEFAULT_LIMIT,
}: GroupStreamRequest): Promise<GroupStreamResult> => {
  const page = expectShape<GroupStreamResult>(
    'group_stream',
    await callGroupRpc('group_stream', { p_group_id: groupId, p_before: before, p_limit: limit }),
    (r) => Array.isArray(r.items) && typeof r.has_more === 'boolean',
  );
  return { ...page, items: page.items.filter((item) => RENDERED_STREAM_KINDS.has(item.kind)) };
};

export const getGroupSessionDetail = async (memberUserId: string, sessionId: string): Promise<GroupSessionDetailResult> =>
  expectShape(
    'group_session_detail',
    await callGroupRpc('group_session_detail', { p_member_user_id: memberUserId, p_session_id: sessionId }),
    (r) => isRecord(r.session),
  );

export type GroupWeekSummaryRequest = {
  groupId: string;
  /** The window's local start and end (Monday 00:00 to the next), epoch ms; the device owns the time zone. */
  windowStartMs: number;
  windowEndMs: number;
};

/** One group's week (contract §4.7): its board, who is training now and the latest completed session. */
export const getGroupWeekSummary = async ({
  groupId,
  windowStartMs,
  windowEndMs,
}: GroupWeekSummaryRequest): Promise<GroupWeekSummaryResult> =>
  expectShape(
    'group_week_summary',
    await callGroupRpc('group_week_summary', {
      p_group_id: groupId,
      p_window_start_ms: windowStartMs,
      p_window_end_ms: windowEndMs,
    }),
    (r) =>
      Array.isArray(r.members) &&
      Array.isArray(r.training_now) &&
      (r.latest_completed === null || isRecord(r.latest_completed)),
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
export type GroupUpdateInput = GroupDetailsInput & { bodyweightCalculationsEnabled: boolean };

export const createGroup = async ({ name, description }: GroupDetailsInput): Promise<GroupCreateResult> =>
  expectShape(
    'group_create',
    await callGroupRpc('group_create', { p_name: name, p_description: description }),
    (r) => isString(r.group_id),
  );

export const updateGroup = async (groupId: string, {
  name, description, bodyweightCalculationsEnabled,
}: GroupUpdateInput): Promise<GroupUpdateResult> =>
  expectShape(
    'group_update',
    await callGroupRpc('group_update', { p_group_id: groupId, p_name: name, p_description: description,
      p_bodyweight_calculations_enabled: bodyweightCalculationsEnabled }),
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

// All current catalogue consumers use the versioned reader, including legacy exercises.
export const listGroupExercises = async (groupId: string): Promise<GroupExerciseListResult> =>
  listGroupComparisons(groupId);

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
  archiveGroupComparison(groupId, groupExerciseId);

export const unarchiveGroupExercise = async (groupId: string, groupExerciseId: string): Promise<GroupExerciseWriteResult> =>
  unarchiveGroupComparison(groupId, groupExerciseId);

// ---- Boards (M25-T05, contract §4.5) --------------------------------------------

export const GROUP_BOARD_DEFAULT_LIMIT = 50;
export const GROUP_BOARD_HISTORY_DEFAULT_LIMIT = 20;

const isNotFoundMessage = (error: unknown, message: string): boolean =>
  isGroupApiError(error) && error.code === 'NOT_FOUND' && error.message.trim().toLowerCase() === message;

/**
 * `NOT_FOUND: group exercise not found` (the board's target is not in the
 * group) as opposed to `NOT_FOUND: group not found` (access lost, §4.5 check
 * order). Only the latter may evict the group.
 */
export const isGroupExerciseNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'group exercise not found');

/** `NOT_FOUND: group not found`: the caller is not (or no longer) a member. The only `NOT_FOUND` that evicts. */
export const isGroupNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'group not found');

/** `NOT_FOUND: record set not found` (§4.6 step 6): the set is not, or no longer, a record set. */
export const isRecordSetNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'record set not found');

/** `NOT_FOUND: certification not found`. */
export const isCertificationNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'certification not found');

/** `NOT_FOUND: member not found`: the lifter is no longer a current member. */
export const isGroupMemberNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'member not found');

/** The podium page: every group exercise on Certified · 1RM. */
export const getGroupBoardPodiums = async (groupId: string): Promise<GroupBoardPodiumsResult> =>
  expectShape(
    'group_board_podiums',
    await callGroupRpc('group_board_podiums', { p_group_id: groupId, p_metric: 'e1rm', p_certified: true }),
    (r) => Array.isArray(r.exercises),
  );

export type GroupBoardView = {
  groupId: string;
  groupExerciseId: string;
  metric: GroupBoardMetric;
  certified: boolean;
};

export type GroupBoardRequest = GroupBoardView & {
  /** Null = first page; otherwise the previous page's `next_cursor`, verbatim. */
  after?: GroupBoardCursor | null;
  /** `1..100`; defaults to 50. */
  limit?: number;
};

export const getGroupBoard = async ({
  groupId,
  groupExerciseId,
  metric,
  certified,
  after = null,
  limit = GROUP_BOARD_DEFAULT_LIMIT,
}: GroupBoardRequest): Promise<GroupBoardResult> =>
  expectShape(
    'group_board',
    await callGroupRpc('group_board', {
      p_group_id: groupId,
      p_group_exercise_id: groupExerciseId,
      p_metric: metric,
      p_certified: certified,
      p_after: after,
      p_limit: limit,
    }),
    (r) => isRecord(r.exercise) && Array.isArray(r.rows) && typeof r.has_more === 'boolean',
  );

export type GroupBoardHistoryRequest = GroupBoardView & {
  /** Null = newest page; otherwise the previous page's `next_cursor`, verbatim. */
  before?: GroupBoardHistoryCursor | null;
  /** `1..50`; defaults to 20. */
  limit?: number;
};

export const getGroupBoardHistory = async ({
  groupId,
  groupExerciseId,
  metric,
  certified,
  before = null,
  limit = GROUP_BOARD_HISTORY_DEFAULT_LIMIT,
}: GroupBoardHistoryRequest): Promise<GroupBoardHistoryResult> =>
  expectShape(
    'group_board_history',
    await callGroupRpc('group_board_history', {
      p_group_id: groupId,
      p_group_exercise_id: groupExerciseId,
      p_metric: metric,
      p_certified: certified,
      p_before: before,
      p_limit: limit,
    }),
    (r) => Array.isArray(r.items) && typeof r.has_more === 'boolean',
  );

// ---- Certification (M25-T06, contract §4.6) --------------------------------------

const isCertificationPayload = (r: Record<string, unknown>): boolean =>
  isRecord(r.certification) && isString(r.certification.certification_id);

export type CertifyGroupSetInput = {
  groupId: string;
  groupExerciseId: string;
  /** The lifter. */
  memberUserId: string;
  setId: string;
};

/** Certify a record set (P10). Any current member except the lifter; idempotent (`created: false`). */
export const certifyGroupSet = async ({
  groupId,
  groupExerciseId,
  memberUserId,
  setId,
}: CertifyGroupSetInput): Promise<GroupCertifyResult> =>
  expectShape(
    'group_certify',
    await callGroupRpc('group_certify', {
      p_group_id: groupId,
      p_group_exercise_id: groupExerciseId,
      p_member_user_id: memberUserId,
      p_set_id: setId,
    }),
    (r) => isCertificationPayload(r) && typeof r.created === 'boolean',
  );

/** The certifier removes their own certification (P11). */
export const withdrawGroupCertification = async (
  groupId: string,
  certificationId: string,
): Promise<GroupCertificationEndResult> =>
  expectShape(
    'group_certification_withdraw',
    await callGroupRpc('group_certification_withdraw', { p_group_id: groupId, p_certification_id: certificationId }),
    isCertificationPayload,
  );

/** The owner or an admin cancels any certification (P11, D5). */
export const cancelGroupCertification = async (
  groupId: string,
  certificationId: string,
): Promise<GroupCertificationEndResult> =>
  expectShape(
    'group_certification_cancel',
    await callGroupRpc('group_certification_cancel', { p_group_id: groupId, p_certification_id: certificationId }),
    isCertificationPayload,
  );


// Versioned comparisons: no ratio/reps value passes through a kg-only reader.
const checkedMetricRulesArgs = (input: GroupExerciseRules) => {
  const result = validateGroupExerciseRules(input);
  if (!result.ok) throw new GroupApiError('VALIDATION', result.message);
  const rule = result.value;
  return { p_name: rule.name, p_load_input_mode: rule.loadInputMode,
    p_bodyweight_contribution: rule.bodyweightContribution, p_default_metric: rule.defaultMetric };
};
const isMetricExerciseWrite = (value: Record<string, unknown>) =>
  value.contract_version === 3 && isGroupMetricExerciseWire(value.exercise);
const isMetricCertificationResult = (value: Record<string, unknown>) =>
  value.contract_version === 3 && isGroupMetricCertificationWire(value.certification);

export const listGroupComparisons = async (groupId: string): Promise<GroupMetricExerciseListWire> =>
  expectShape('group_exercise_list_v2', await callGroupRpc('group_exercise_list_v2', { p_group_id: groupId }),
    value => value.contract_version === 3 && Array.isArray(value.exercises) && value.exercises.every(isGroupMetricExerciseWire));
export const createGroupComparison = async (
  groupId: string, input: GroupExerciseRules & { sourceExerciseId: string | null },
): Promise<GroupMetricExerciseWriteWire> => expectShape('group_exercise_create_v2',
  await callGroupRpc('group_exercise_create_v2', { p_group_id: groupId,
    ...checkedMetricRulesArgs(input), p_source_exercise_id: input.sourceExerciseId }), isMetricExerciseWrite);
export const updateGroupComparison = async (
  groupId: string, exerciseId: string, expectedRevision: number, input: GroupExerciseRules,
): Promise<GroupMetricExerciseWriteWire> => expectShape('group_exercise_update_v2',
  await callGroupRpc('group_exercise_update_v2', { p_group_id: groupId, p_exercise_id: exerciseId,
    p_expected_revision: expectedRevision, ...checkedMetricRulesArgs(input) }), isMetricExerciseWrite);
export const archiveGroupComparison = async (groupId: string, exerciseId: string): Promise<GroupMetricExerciseWriteWire> =>
  expectShape('group_exercise_archive_v2', await callGroupRpc('group_exercise_archive_v2', {
    p_group_id: groupId, p_exercise_id: exerciseId }), isMetricExerciseWrite);
export const unarchiveGroupComparison = async (groupId: string, exerciseId: string): Promise<GroupMetricExerciseWriteWire> =>
  expectShape('group_exercise_unarchive_v2', await callGroupRpc('group_exercise_unarchive_v2', {
    p_group_id: groupId, p_exercise_id: exerciseId }), isMetricExerciseWrite);

export type GroupMetricView = {
  groupId: string; groupExerciseId: string; metric: GroupMetric; certified: boolean; revision?: number | null;
};
export const getGroupMetricBoard = async (view: GroupMetricView & { after?: string | null; limit?: number }): Promise<GroupMetricBoardWire> =>
  expectShape('group_metric_board', await callGroupRpc('group_metric_board', {
    p_group_id: view.groupId, p_group_exercise_id: view.groupExerciseId, p_metric: view.metric,
    p_certified: view.certified, p_revision: view.revision ?? null, p_after: view.after ?? null, p_limit: view.limit ?? 50,
  }), value => isGroupMetricBoardWire(value) && value.exercise.group_exercise_id === view.groupExerciseId &&
    value.metric === view.metric && value.certified === view.certified && (view.revision == null || value.rules_revision === view.revision));
export const getGroupMetricPodiums = async (groupId: string, certified = true): Promise<GroupMetricPodiumWire> =>
  expectShape('group_metric_podiums', await callGroupRpc('group_metric_podiums', { p_group_id: groupId, p_certified: certified }), isGroupMetricPodiumWire);
export const getGroupMetricHistory = async (view: GroupMetricView & { before?: string | null; limit?: number }): Promise<GroupMetricHistoryWire> =>
  expectShape('group_metric_history', await callGroupRpc('group_metric_history', {
    p_group_id: view.groupId, p_group_exercise_id: view.groupExerciseId, p_metric: view.metric,
    p_certified: view.certified, p_revision: view.revision ?? null, p_before: view.before ?? null, p_limit: view.limit ?? 20,
  }), value => isGroupMetricHistoryWire(value) && isRecord(value.exercise) && isRecord(value.revision) && isRecord(value.revision.rules) &&
    value.exercise.group_exercise_id === view.groupExerciseId && value.metric === view.metric && value.certified === view.certified &&
    (view.revision == null || value.revision.rules.rules_revision === view.revision));
export const getGroupMetricRevisions = async (groupId: string, exerciseId: string): Promise<GroupMetricRevisionsWire> =>
  expectShape('group_metric_revisions', await callGroupRpc('group_metric_revisions', { p_group_id: groupId, p_group_exercise_id: exerciseId }),
    value => value.contract_version === 3 && isGroupMetricExerciseWire(value.exercise) && value.exercise.group_exercise_id === exerciseId &&
      Array.isArray(value.revisions) && value.revisions.every(isGroupMetricRevisionWire));

export const certifyGroupMetric = async (input: GroupMetricView & {
  memberUserId: string; setId: string; expectedRevision: number; expectedFingerprint: string;
}): Promise<GroupMetricCertificationResultWire> => expectShape('group_metric_certify',
  await callGroupRpc('group_metric_certify', { p_group_id: input.groupId, p_group_exercise_id: input.groupExerciseId,
    p_member_user_id: input.memberUserId, p_set_id: input.setId, p_metric: input.metric,
    p_expected_revision: input.expectedRevision, p_expected_fingerprint: input.expectedFingerprint }),
  value => isMetricCertificationResult(value) && isGroupMetricCertificationWire(value.certification) &&
    value.certification.metric === input.metric && value.certification.performance.set_id === input.setId);
export const getGroupMetricCertification = async (groupId: string, certificationId: string, metric?: GroupMetric): Promise<GroupMetricCertificationResultWire> =>
  expectShape('group_metric_certification_get', await callGroupRpc('group_metric_certification_get', {
    p_group_id: groupId, p_certification_id: certificationId, ...(metric ? { p_metric: metric } : {}) }), value => isMetricCertificationResult(value) &&
    isGroupMetricCertificationWire(value.certification) && value.certification.certification_id === certificationId &&
    (metric === undefined || value.certification.metric === metric));
export const endGroupMetricCertification = async (
  groupId: string, certificationId: string, action: 'withdraw' | 'cancel',
): Promise<GroupMetricCertificationResultWire> => expectShape('group_metric_certification_end',
  await callGroupRpc('group_metric_certification_end', { p_group_id: groupId,
    p_certification_id: certificationId, p_action: action }), value => isMetricCertificationResult(value) &&
    isGroupMetricCertificationWire(value.certification) && value.certification.certification_id === certificationId);


export const getGroupMetricStream = async ({ groupId, before = null, limit = GROUP_STREAM_DEFAULT_LIMIT }:
  Omit<GroupStreamRequest, 'before'> & { before?: GroupMetricStreamCursor | null }): Promise<GroupMetricStreamWire> => {
  const raw = await callGroupRpc('group_stream_v2', { p_group_id: groupId, p_before: before, p_limit: limit });
  const page = expectShape<GroupMetricStreamWire>('group_stream_v2', raw, value =>
    value.contract_version === 3 && typeof value.has_more === 'boolean' && isGroupMetricStreamCursor(value.next_cursor) &&
    Array.isArray(value.items) && value.items.every(item => isRecord(item) &&
      (!isRenderedGroupMetricStreamKind(item.kind) || isGroupMetricStreamItem(item))));
  return { ...page, items: page.items.filter(item => isRenderedGroupMetricStreamKind(item.kind)) };
};

// Protocol 4 stays dormant until negotiation is active; UI activation is separate.
// Headers belong to the request, never mutable client-wide auth/config.
const competitionRpc = async <T>(name: GroupRpcName, args: Record<string, unknown>, guard: (v: unknown) => v is T, matches?: (v: T) => boolean): Promise<T> => {
  const data = await callGroupRpc(name,args,4);
  if (!guard(data) || (matches !== undefined && !matches(data))) throw new GroupApiError('INTERNAL', `${name} returned an unexpected competition payload.`);
  return data;
};
export const getCompetitionContract = (groupId: string): Promise<CompetitionContractWire> =>
  competitionRpc('group_competition_contract',{ p_group_id: groupId },isCompetitionContractWire);
export const listCompetitionExercises = (groupId: string): Promise<CompetitionExerciseListWire> =>
  competitionRpc('group_competition_exercise_list',{ p_group_id: groupId },isCompetitionExerciseListWire);
export const getCompetitionBoard = ({ groupId, exerciseId, metric, certified = true, limit = 50, cursor = null }: {
  groupId: string; exerciseId: string; metric: CompetitionMetric; certified?: boolean; limit?: number; cursor?: string | null }): Promise<CompetitionBoardWire> =>
  competitionRpc('group_competition_board',{ p_group_id: groupId, p_group_exercise_id: exerciseId, p_metric: metric,
    p_certified: certified, p_limit: limit, p_cursor: cursor },isCompetitionBoardWire,b => b.group_exercise_id === exerciseId && b.metric === metric && b.certified === certified);
export const getCompetitionPodiums = (groupId: string, certified = true): Promise<CompetitionPodiumsWire> =>
  competitionRpc('group_competition_podiums',{ p_group_id: groupId, p_certified: certified },isCompetitionPodiumsWire,p => p.certified === certified);
export const getCompetitionRevisions = (groupId: string, exerciseId: string): Promise<CompetitionRevisionsWire> =>
  competitionRpc('group_competition_revisions',{ p_group_id: groupId, p_group_exercise_id: exerciseId },isCompetitionRevisionsWire,p => p.exercise.group_exercise_id === exerciseId);
export const getCompetitionHistory = ({ groupId, exerciseId, metric, certified, revision = null, before = null, limit = 50 }: {
  groupId: string; exerciseId: string; metric: CompetitionHistoricalMetric; certified: boolean; revision?: number | null; before?: string | null; limit?: number }): Promise<CompetitionHistoryWire> =>
  competitionRpc('group_competition_history',{ p_group_id: groupId, p_group_exercise_id: exerciseId, p_metric: metric,
    p_certified: certified, p_revision: revision, p_before: before, p_limit: limit },isCompetitionHistoryWire,p => p.exercise.group_exercise_id === exerciseId && p.metric === metric &&
      p.certified === certified && p.revision.rules_revision === (revision ?? p.exercise.rules.rules_revision));
export const getCompetitionStream = (groupId: string | null = null, before: string | null = null, limit = 20): Promise<CompetitionStreamWire> =>
  competitionRpc('group_competition_stream',{ p_group_id: groupId, p_before: before, p_limit: limit },isCompetitionStreamWire,
    p => groupId === null || p.items.every(item => item.kind === 'session' ? item.groups.every(g => g.group_id === groupId) :
      item.kind === 'competition' ? item.event.group.group_id === groupId : item.group.group_id === groupId));
export const getCompetitionSession = (groupId: string, memberId: string, sessionId: string): Promise<CompetitionSessionDetailWire> =>
  competitionRpc('group_competition_session_detail',{ p_group_id: groupId, p_member_user_id: memberId, p_session_id: sessionId },isCompetitionSessionDetailWire,p => p.group_id === groupId && p.session.member.user_id === memberId && p.session.session_id === sessionId);
export const getCompetitionWeek = (groupId: string, start: number, end: number): Promise<CompetitionWeekSummaryWire> =>
  competitionRpc('group_competition_week_summary',{ p_group_id: groupId, p_window_start_ms: start, p_window_end_ms: end },isCompetitionWeekSummaryWire,p => p.group_id === groupId);
export const certifyCompetition = ({ groupId, exerciseId, memberId, setId, metric, revision, token }: {
  groupId: string; exerciseId: string; memberId: string; setId: string; metric: CompetitionMetric; revision: number; token: string }): Promise<CompetitionCertifyResultWire> =>
  competitionRpc('group_competition_certify',{ p_group_id: groupId, p_group_exercise_id: exerciseId, p_member_user_id: memberId,
    p_set_id: setId, p_metric: metric, p_expected_revision: revision, p_write_token: token },isCompetitionCertifyResultWire,p => p.certification.metric === metric);
export const getCompetitionCertification = (groupId: string, certificateId: string, metric: CompetitionMetric): Promise<CompetitionCertificationResultWire> =>
  competitionRpc('group_competition_certification_get',{ p_group_id: groupId, p_certification_id: certificateId, p_metric: metric },isCompetitionCertificationResultWire,p => p.certification.metric === metric && p.certification.certification_id === certificateId);
export const endCompetitionCertification = (groupId: string, certificateId: string, metric: CompetitionMetric,
  action: 'withdraw' | 'cancel'): Promise<CompetitionCertificationResultWire> =>
  competitionRpc('group_competition_certification_end',{ p_group_id: groupId, p_certification_id: certificateId, p_metric: metric,
    p_action: action },isCompetitionCertificationResultWire,p => p.certification.metric === metric && p.certification.certification_id === certificateId);
export const createCompetitionExercise = ({ groupId, name, mode, contribution = 0, metric = 'e1rm', sourceId = null }: {
  groupId: string; name: string; mode: 'total_load' | 'per_side_load'; contribution?: number; metric?: CompetitionMetric; sourceId?: string | null }): Promise<CompetitionExerciseWriteWire> =>
  competitionRpc('group_competition_exercise_create',{ p_group_id: groupId, p_name: name, p_load_input_mode: mode,
    p_bodyweight_contribution: contribution, p_default_metric: metric, p_source_exercise_id: sourceId },isCompetitionExerciseWriteWire,p => p.exercise.rules.load_input_mode === mode &&
      p.exercise.rules.bodyweight_contribution === contribution && p.exercise.rules.default_metric === metric);
export const updateCompetitionExercise = ({ groupId, exerciseId, revision, name, mode, contribution, metric }: {
  groupId: string; exerciseId: string; revision: number; name: string; mode: 'total_load' | 'per_side_load'; contribution: number; metric: CompetitionMetric }): Promise<CompetitionExerciseWriteWire> =>
  competitionRpc('group_competition_exercise_update',{ p_group_id: groupId, p_exercise_id: exerciseId, p_expected_revision: revision,
    p_name: name, p_load_input_mode: mode, p_bodyweight_contribution: contribution, p_default_metric: metric },isCompetitionExerciseWriteWire,p => p.exercise.group_exercise_id === exerciseId &&
      p.exercise.rules.load_input_mode === mode && p.exercise.rules.bodyweight_contribution === contribution && p.exercise.rules.default_metric === metric);
export const archiveCompetitionExercise = (groupId: string, exerciseId: string, archived: boolean): Promise<CompetitionExerciseWriteWire> =>
  competitionRpc('group_competition_exercise_archive',{ p_group_id: groupId, p_exercise_id: exerciseId, p_archived: archived },isCompetitionExerciseWriteWire,p => p.exercise.group_exercise_id === exerciseId && (p.exercise.archived_at_ms !== null) === archived);
