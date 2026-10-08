export * from './types';
export {
  GroupApiError,
  createGroup,
  getGroup,
  getGroupInviteCode,
  groupExerciseCore,
  isGroupApiError,
  isGroupExerciseNotFound,
  isGroupMemberNotFound,
  isGroupNotFound,
  joinGroup,
  leaveGroup,
  listMyGroups,
  mapGroupRpcError,
  matchGroupErrorToken,
  previewGroupInvite,
  regenerateGroupInviteCode,
  removeGroupMember,
  setGroupMemberRole,
  toGroupApiError,
  transferGroupOwnership,
  updateGroup,
  type GroupDetailsInput,
  type GroupUpdateInput,
  type GroupRpcName,
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
export * from './set-facts';
export * from './stream-view-model';
export * from './last-viewed-group';
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
export * from './week-summary-view-model';
// `use-group-exercise-linking.ts` is imported by path, not from this barrel: it
// reads the auth store (`@/src/auth`), and the barrel must stay loadable without
// initializing auth (the group API and hook tests mock the Supabase client).
export { evictGroupFromDevice } from './evict-local';
export * from './write-view-model';
export * from './exercise-view-model';
export { useMyGroupExerciseLinks, type MyGroupExerciseLinksState } from './use-my-group-exercise-links';
export { useMountedRef } from './use-mounted-ref';
export * from './board-view-model';
export {
  appendUniqueByKey,
  useGroupOnlinePages,
  type GroupOnlinePagesOptions,
  type GroupOnlinePagesState,
} from './use-group-online-pages';
export {
  archiveCompetitionExercise, certifyCompetition, createCompetitionExercise, endCompetitionCertification,
  getCompetitionBoard, getCompetitionCertification, getCompetitionContract, getCompetitionHistory,
  getCompetitionPodiums, getCompetitionRevisions, getCompetitionSession, getCompetitionSessionRecords, getCompetitionStream,
  getCompetitionWeek, listCompetitionExercises, updateCompetitionExercise,
} from './api';
export type * from './competition-wire';
