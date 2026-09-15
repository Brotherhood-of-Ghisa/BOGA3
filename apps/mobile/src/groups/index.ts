export * from './types';
export {
  GROUP_STREAM_DEFAULT_LIMIT,
  GroupApiError,
  archiveGroupExercise,
  createGroup,
  createGroupExercise,
  getGroup,
  getGroupInviteCode,
  getGroupSessionDetail,
  getGroupStream,
  groupExerciseCore,
  isGroupApiError,
  joinGroup,
  leaveGroup,
  listGroupExercises,
  listMyGroups,
  mapGroupRpcError,
  matchGroupErrorToken,
  previewGroupInvite,
  regenerateGroupInviteCode,
  removeGroupMember,
  setGroupMemberRole,
  toGroupApiError,
  transferGroupOwnership,
  unarchiveGroupExercise,
  updateGroup,
  updateGroupExercise,
  type CreateGroupExerciseInput,
  type GroupDetailsInput,
  type GroupRpcName,
  type GroupStreamRequest,
} from './api';
export {
  deleteGroupCacheEntry,
  evictGroup,
  groupCacheKeys,
  readGroupCache,
  wipeGroupCache,
  writeGroupCache,
  type GroupCacheDatabase,
  type GroupCacheEntry,
} from './cache';
export * from './session-metrics';
export * from './set-facts';
export * from './stream-view-model';
export {
  GROUP_RESOURCE_POLL_INTERVAL_MS,
  useGroupResource,
  type GroupResourceOptions,
  type GroupResourceState,
} from './use-group-resource';
export {
  compareStreamOrder,
  mergeStreamPages,
  useGroupStream,
  type GroupStreamState,
} from './use-group-stream';
export {
  GROUP_OFFLINE_ACTION_MESSAGE,
  useGroupAction,
  type GroupActionResult,
  type GroupActionState,
} from './use-group-action';
export { projectNetInfoOnline, useNetworkOnline } from './use-network-online';
export * from './link-view-model';
// `use-group-exercise-linking.ts` is imported by path, not from this barrel: it
// reads the auth store (`@/src/auth`), and the barrel must stay loadable without
// initializing auth (the group API and hook tests mock the Supabase client).
export { evictGroupFromDevice } from './evict-local';
export * from './write-view-model';
