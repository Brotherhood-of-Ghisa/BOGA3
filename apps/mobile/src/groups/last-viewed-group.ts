// The group the Groups screen last showed, so returning to Groups reopens it.
// In memory only: a cold start opens the first group. An id that is no longer
// in My groups (another account, left, removed) is ignored by
// `resolveSelectedGroupId`.

let lastViewedGroupId: string | null = null;

export const getLastViewedGroupId = (): string | null => lastViewedGroupId;

export const setLastViewedGroupId = (groupId: string | null): void => {
  lastViewedGroupId = groupId;
};
