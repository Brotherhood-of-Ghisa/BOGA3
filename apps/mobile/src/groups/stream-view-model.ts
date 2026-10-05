import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
// Pure presentation shared by the group screens (`docs/specs/tech/groups-contract.md`):
// member names, session status, figure and count wording, membership
// sentences, role wording, and filter chips. No React, no I/O.

import { formatCompactDuration } from '@/src/data/session-list';
import { formatClockTime, formatLocalDateTime, formatMonthDayTime } from '@/src/utils/local-time';

import type { GroupMemberRef, GroupMembershipEvent, GroupRole, GroupSummary, StreamSessionItem } from './types';

export const UNNAMED_MEMBER_LABEL = 'Unnamed member';
export const TRAINING_NOW_LABEL = 'Training now';

/** A member's display name; a null or blank username falls back to "Unnamed member". */
export const formatMemberName = (username: string | null | undefined): string => {
  const trimmed = typeof username === 'string' ? username.trim() : '';
  return trimmed.length > 0 ? trimmed : UNNAMED_MEMBER_LABEL;
};

const resolveDurationSec = (
  item: Pick<StreamSessionItem, 'duration_sec' | 'started_at_ms' | 'completed_at_ms'>,
): number | null => {
  if (item.duration_sec !== null) {
    return item.duration_sec;
  }
  if (item.completed_at_ms !== null && item.completed_at_ms >= item.started_at_ms) {
    return Math.floor((item.completed_at_ms - item.started_at_ms) / 1000);
  }
  return null;
};

/**
 * "Training now" for an `active` session regardless of how long ago it started
 * (indefinitely), otherwise "Completed · <compact duration>" using the
 * session list's compact duration format. A completed session with no duration
 * and no completion time reads plain "Completed".
 */
export const formatSessionStatusLabel = (
  item: Pick<StreamSessionItem, 'status' | 'duration_sec' | 'started_at_ms' | 'completed_at_ms'>,
): string => {
  if (item.status === 'active') {
    return TRAINING_NOW_LABEL;
  }
  const durationSec = resolveDurationSec(item);
  return durationSec === null ? 'Completed' : `Completed · ${formatCompactDuration(durationSec)}`;
};

/** A Weight or 1RM figure in its one format (`exercise-calculations/format.ts`). */
export const formatMetricFigure = (metric: 'weight' | 'e1rm', kg: number): string =>
  metric === 'e1rm' ? formatOneRepMax(kg) : formatWeight(kg);

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

export const formatSetCount = (count: number): string => pluralize(count, 'set', 'sets');
export const formatExerciseCount = (count: number): string => pluralize(count, 'exercise', 'exercises');

/** Membership wording: "X joined", "X left the group", "X was removed". */
export const formatMembershipSentence = (event: GroupMembershipEvent, username: string | null): string => {
  const name = formatMemberName(username);
  switch (event) {
    case 'joined':
      return `${name} joined`;
    case 'left':
      return `${name} left the group`;
    case 'removed':
      return `${name} was removed`;
    default: {
      const unhandled: never = event;
      return `${name} ${String(unhandled)}`;
    }
  }
};

export { formatClockTime };

/** The session list's local `M/D HH:MM` start stamp, on stream cards. */
export const formatStreamStartedAt = formatMonthDayTime;

/** Local `YYYY-MM-DD HH:MM`, the View Session header shape (friend's session view). */
export const formatGroupDateTime = formatLocalDateTime;

/** The groups contract offline marker: "Offline · last updated HH:MM" ("Offline" with nothing cached). */
export const formatOfflineMarker = (lastUpdatedAtMs: number | null): string =>
  lastUpdatedAtMs === null ? 'Offline' : `Offline · last updated ${formatClockTime(lastUpdatedAtMs)}`;

export const GROUP_ROLE_LABELS: Record<GroupRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

const MY_ROLE_SENTENCES: Record<GroupRole, string> = {
  owner: "You're the owner",
  admin: "You're an admin",
  member: "You're a member",
};

export const formatMyRole = (role: GroupRole): string => MY_ROLE_SENTENCES[role];

export const formatMemberCount = (count: number): string => pluralize(count, 'member', 'members');

export type StreamMembershipViewModel = {
  kind: 'membership';
  key: string;
  sentence: string;
  groupId: string;
  groupName: string;
};

export const YOU_NAME = 'You';

/**
 * Where a record's certification stands. The label says it in words; the card
 * draws the matching glyph (check / ring / none) beside it, so the state never
 * lives in a Unicode character inside the label.
 */
export type RecordCertificationStatus = 'certified' | 'uncertified' | 'voided';

const isMyUser = (userId: string, myUserId: string | null): boolean => myUserId !== null && userId === myUserId;

/** "You" for me, else the username ("Unnamed member" fallback). */
export const formatStreamPersonName = (member: GroupMemberRef, myUserId: string | null): string =>
  isMyUser(member.user_id, myUserId) ? YOU_NAME : formatMemberName(member.username);

/** "140.0 × 1", for a figure slot: the app's weight figure, no unit (design-language §6). */
export const formatSetFigure = (weightKg: number, reps: number): string => `${formatWeight(weightKg)} × ${reps}`;

export type StreamFilterChip = {
  key: string;
  label: string;
  groupId: string;
  selected: boolean;
};

/** One chip per group in the given order (the server sorts by name). There is no All chip. */
export const buildStreamFilterChips = (
  groups: Pick<GroupSummary, 'group_id' | 'name'>[],
  selectedGroupId: string | null,
): StreamFilterChip[] =>
  groups.map((group) => ({
    key: group.group_id,
    label: group.name,
    groupId: group.group_id,
    selected: group.group_id === selectedGroupId,
  }));

/**
 * The Groups screen always shows one group: the first of `candidates` (a
 * deep-linked group, then the last one viewed) that is still in My groups,
 * else the first group. Null only when there are no groups.
 */
export const resolveSelectedGroupId = (
  groups: Pick<GroupSummary, 'group_id'>[],
  ...candidates: (string | null | undefined)[]
): string | null => {
  for (const candidate of candidates) {
    if (candidate && groups.some((group) => group.group_id === candidate)) {
      return candidate;
    }
  }
  return groups[0]?.group_id ?? null;
};

/** The Groups screen with one group selected (Today links, membership items). */
export const groupsStreamPath = (groupId: string) => `/groups?groupId=${groupId}` as const;
