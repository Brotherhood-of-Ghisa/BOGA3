import { isCompetitionCachePayload } from './competition-cache-guards';
import { isCompetitionBoardWire } from './competition-wire-guards';
import { isCompetitionCertificationResultWire, isCompetitionCertifyResultWire, isCompetitionExerciseListWire,
  isCompetitionExerciseWriteWire, isCompetitionHistoryWire, isCompetitionPodiumsWire, isCompetitionRevisionsWire,
  isCompetitionSessionDetailWire, isCompetitionSessionRecordsWire, isCompetitionStreamWire, isCompetitionWeekSummaryWire } from './competition-reader-guards';
import type { CompetitionBoardWire, CompetitionCertifyResultWire, CompetitionCertificationResultWire,
  CompetitionExerciseListWire, CompetitionExerciseWriteWire, CompetitionHistoricalMetric, CompetitionHistoryWire,
  CompetitionPodiumsWire, CompetitionRevisionsWire, CompetitionSessionDetailWire, CompetitionSessionRecordsWire, CompetitionStreamWire, CompetitionWeekSummaryWire } from './competition-wire';
import type { CompetitionMetric } from './competition-contract';

// The typed group RPC client (`docs/specs/tech/groups-contract.md`).
// It is the ONLY code that calls Supabase for groups. Every failure leaves this
// module as a `GroupApiError` with a contract code:
//
//   - a PostgREST error whose message starts with a known `<TOKEN>:` → that token;
//   - a transport failure (postgrest-js reports a failed fetch as `status: 0`,
//     or the call itself throws) → `NETWORK`;
//   - anything else (unknown error, unconfigured backend, malformed payload)
//     → `INTERNAL`.

import { getRequiredSupabaseMobileClient } from '@/src/auth/supabase';
import type { ExerciseCore } from '@/src/exercise-core';

import {
  GROUP_SERVER_ERROR_CODES,
  type GroupCreateResult,
  type GroupErrorCode,
  type GroupExercise,
  type GroupGetResult,
  type GroupInviteCodeResult,
  type GroupInvitePreviewResult,
  type GroupJoinResult,
  type GroupLeaveResult,
  type GroupListMineResult,
  type GroupMemberWriteResult,
  type GroupServerErrorCode,
  type GroupUpdateResult,
} from './types';

export class GroupApiError extends Error {
  readonly code: GroupErrorCode;

  constructor(code: GroupErrorCode, message: string, readonly invalidPayload = false) {
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
  | 'group_competition_stream_v2'
  | 'group_competition_session_detail'
  | 'group_competition_session_records'
  | 'group_competition_week_summary';

type RpcResponse = { data: unknown; error: RpcErrorLike | null; status?: number | null };

// Every group RPC requires the contract-4 header. Headers belong to the
// request, never mutable client-wide auth/config.
const callGroupRpc = async (name: GroupRpcName, args: Record<string, unknown>): Promise<unknown> => {
  let client: ReturnType<typeof getRequiredSupabaseMobileClient>;
  try {
    client = getRequiredSupabaseMobileClient();
  } catch (error) {
    throw new GroupApiError('INTERNAL', describeUnknownError(error, 'Groups are unavailable in this build.'));
  }

  let response: RpcResponse;
  try {
    response = (await client.schema('app_public').rpc(name, args).setHeader('x-boga-group-contract','4')) as RpcResponse;
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
    throw new GroupApiError('INTERNAL', `${rpc} returned an unexpected payload.`,true);
  }
  return data as T;
};

const isString = (value: unknown): value is string => typeof value === 'string';

// ---- Reads --------------------------------------------------------------------

export const listMyGroups = async (): Promise<GroupListMineResult> =>
  expectShape('group_list_mine', await callGroupRpc('group_list_mine', {}), (r) => isCompetitionCachePayload('groups:v5:mine',r));

export const getGroup = async (groupId: string): Promise<GroupGetResult> =>
  expectShape('group_get', await callGroupRpc('group_get', { p_group_id: groupId }), (r) =>
    isCompetitionCachePayload(`group:v5:${groupId}`,r),
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

// Membership writes (contract): `group_leave` returns
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

// ---- Group exercises (contract) -----------------------------------

/** The `ExerciseCore` of a group exercise, e.g. to prefill the shared exercise form. */
export const groupExerciseCore = (exercise: GroupExercise): ExerciseCore => ({
  name: exercise.name,
  loadInputMode: exercise.load_input_mode,
});

// ---- Errors -------------------------------------------------------------------

const isNotFoundMessage = (error: unknown, message: string): boolean =>
  isGroupApiError(error) && error.code === 'NOT_FOUND' && error.message.trim().toLowerCase() === message;

/**
 * `NOT_FOUND: group exercise not found` (the board's target is not in the
 * group) as opposed to `NOT_FOUND: group not found` (access lost,
 * order). Only the latter may evict the group.
 */
export const isGroupExerciseNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'group exercise not found');

/** `NOT_FOUND: group not found`: the caller is not (or no longer) a member. The only `NOT_FOUND` that evicts. */
export const isGroupNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'group not found');

/** `NOT_FOUND: member not found`: the lifter is no longer a current member. */
export const isGroupMemberNotFound = (error: unknown): boolean => isNotFoundMessage(error, 'member not found');

const competitionRpc = async <T>(name: GroupRpcName, args: Record<string, unknown>, guard: (v: unknown) => v is T, matches?: (v: T) => boolean): Promise<T> => {
  const data = await callGroupRpc(name,args);
  if (!guard(data) || (matches !== undefined && !matches(data))) throw new GroupApiError('INTERNAL', `${name} returned an unexpected competition payload.`,true);
  return data;
};
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
  competitionRpc('group_competition_stream_v2',{ p_group_id: groupId, p_before: before, p_limit: limit },isCompetitionStreamWire,
    p => groupId === null || p.items.every(item => item.kind === 'session' ? item.groups.every(g => g.group_id === groupId) :
      item.kind === 'competition' ? item.event.group.group_id === groupId : item.group.group_id === groupId));
export const getCompetitionSession = (groupId: string, memberId: string, sessionId: string): Promise<CompetitionSessionDetailWire> =>
  competitionRpc('group_competition_session_detail',{ p_group_id: groupId, p_member_user_id: memberId, p_session_id: sessionId },isCompetitionSessionDetailWire,p => p.group_id === groupId && p.session.member.user_id === memberId && p.session.session_id === sessionId);
export const getCompetitionSessionRecords = (groupId: string, memberId: string, sessionId: string): Promise<CompetitionSessionRecordsWire> =>
  competitionRpc('group_competition_session_records',{ p_group_id: groupId, p_member_user_id: memberId, p_session_id: sessionId },isCompetitionSessionRecordsWire,p => p.group_id === groupId && p.member_user_id === memberId && p.session_id === sessionId);
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
