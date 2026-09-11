// Pure presentation for the group stream (`docs/specs/tech/groups-contract.md`
// §6.1): card status, kg metric formatting, membership sentences, and filter
// chips. No React, no I/O.

import { formatCompactDuration } from '@/src/data/session-list';

import type {
  GroupMembershipEvent,
  GroupRole,
  GroupSummary,
  StreamItem,
  StreamMembershipItem,
  StreamPrHighlight,
  StreamSessionItem,
} from './types';

export const UNNAMED_MEMBER_LABEL = 'Unnamed member';
export const TRAINING_NOW_LABEL = 'Training now';
export const ALL_GROUPS_CHIP_LABEL = 'All';

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
 * (C7.2: indefinite), otherwise "Completed · <compact duration>" using the
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

const groupThousands = (integerDigits: string): string => integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A kg number: integers as-is, otherwise at most 2 decimals, thousands grouped with commas. */
export const formatKg = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const rounded = Number(value.toFixed(2));
  const [integerPart, fractionPart] = Math.abs(rounded).toString().split('.');
  const sign = rounded < 0 ? '-' : '';
  const grouped = groupThousands(integerPart);
  return fractionPart ? `${sign}${grouped}.${fractionPart}` : `${sign}${grouped}`;
};

export const formatVolumeKg = (totalVolumeKg: number): string => `${formatKg(totalVolumeKg)} kg`;

const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

export const formatSetCount = (count: number): string => pluralize(count, 'set', 'sets');
export const formatExerciseCount = (count: number): string => pluralize(count, 'exercise', 'exercises');

export const formatPrHighlight = (pr: StreamPrHighlight): string =>
  `PR · ${pr.exercise_name} ${formatKg(pr.weight_kg)} kg × ${pr.reps}`;

/** C7.3 wording: "X joined", "X left the group", "X was removed". */
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

const pad2 = (value: number): string => `${value}`.padStart(2, '0');

/** Local wall-clock `HH:MM` (the offline marker's "last updated"). */
export const formatClockTime = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** Local `M/D HH:MM`, the session list's start-time shape (stream cards). */
export const formatStreamStartedAt = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getMonth() + 1}/${date.getDate()} ${formatClockTime(epochMs)}`;
};

/** Local `YYYY-MM-DD HH:MM`, the View Session header shape (friend's session view). */
export const formatGroupDateTime = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${formatClockTime(epochMs)}`;
};

/** Contract §7 offline marker: "Offline · last updated HH:MM" ("Offline" with nothing cached). */
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

export type StreamSessionCardViewModel = {
  kind: 'session';
  key: string;
  memberUserId: string;
  sessionId: string;
  memberName: string;
  isTrainingNow: boolean;
  statusLabel: string;
  startedAtLabel: string;
  gymName: string | null;
  groupNames: string[];
  setsLabel: string;
  volumeLabel: string;
  exercisesLabel: string;
  prLabels: string[];
};

export type StreamMembershipViewModel = {
  kind: 'membership';
  key: string;
  sentence: string;
  groupId: string;
  groupName: string;
};

export type StreamItemViewModel = StreamSessionCardViewModel | StreamMembershipViewModel;

const buildSessionCard = (item: StreamSessionItem): StreamSessionCardViewModel => ({
  kind: 'session',
  key: item.key,
  memberUserId: item.member.user_id,
  sessionId: item.session_id,
  memberName: formatMemberName(item.member.username),
  isTrainingNow: item.status === 'active',
  statusLabel: formatSessionStatusLabel(item),
  startedAtLabel: formatStreamStartedAt(item.started_at_ms),
  gymName: item.gym_name,
  groupNames: item.groups.map((group) => group.name),
  setsLabel: formatSetCount(item.metrics.performed_sets),
  volumeLabel: formatVolumeKg(item.metrics.total_volume_kg),
  exercisesLabel: formatExerciseCount(item.metrics.exercise_count),
  prLabels: item.highlights.prs.map(formatPrHighlight),
});

const buildMembershipItem = (item: StreamMembershipItem): StreamMembershipViewModel => ({
  kind: 'membership',
  key: item.key,
  sentence: formatMembershipSentence(item.event, item.member.username),
  groupId: item.group.group_id,
  groupName: item.group.name,
});

export const buildStreamItemViewModel = (item: StreamItem): StreamItemViewModel =>
  item.kind === 'session' ? buildSessionCard(item) : buildMembershipItem(item);

export const buildStreamViewModel = (items: StreamItem[]): StreamItemViewModel[] =>
  items.map(buildStreamItemViewModel);

export type StreamFilterChip = {
  key: string;
  label: string;
  /** Null for the All chip. */
  groupId: string | null;
  selected: boolean;
};

/** "All" first, then one chip per group in the given order (the server sorts by name). */
export const buildStreamFilterChips = (
  groups: Pick<GroupSummary, 'group_id' | 'name'>[],
  selectedGroupId: string | null,
): StreamFilterChip[] => [
  { key: 'all', label: ALL_GROUPS_CHIP_LABEL, groupId: null, selected: selectedGroupId === null },
  ...groups.map((group) => ({
    key: group.group_id,
    label: group.name,
    groupId: group.group_id,
    selected: group.group_id === selectedGroupId,
  })),
];
