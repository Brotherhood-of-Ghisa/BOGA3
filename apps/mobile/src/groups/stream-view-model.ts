// Pure presentation for the group stream (`docs/specs/tech/groups-contract.md`
// §6.1): card status, card metrics (computed on the device, §5) and their kg
// formatting, membership sentences, record cards and record-removed / link
// sentences (M25-T10), and filter chips. No React, no I/O.

import { formatCompactDuration } from '@/src/data/session-list';

import { computeGroupSessionMetrics } from './session-metrics';
import type {
  GroupBoardMetric,
  GroupMemberRef,
  GroupMembershipEvent,
  GroupRole,
  GroupSummary,
  StreamItem,
  StreamLinkItem,
  StreamMembershipItem,
  StreamRecordItem,
  StreamRecordVoidReason,
  StreamRecordVoidedItem,
  StreamSessionItem,
} from './types';

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
  /** "1 record" / "N records": the session's non-voided record sets among the loaded items. Null when none. */
  recordsLabel: string | null;
};

export type StreamMembershipViewModel = {
  kind: 'membership';
  key: string;
  sentence: string;
  groupId: string;
  groupName: string;
};

export type StreamRecordCardViewModel = {
  kind: 'record';
  key: string;
  /** The wire item, for the row detail sheet and the inline Certify. */
  record: StreamRecordItem;
  memberUserId: string;
  /** "dana — group record" / "dana — PR". */
  title: string;
  exerciseLabel: string;
  /** "140 kg × 1", plus " · e1RM 142.5 kg" when an e1RM board is listed. */
  valueLabel: string;
  /** Per listed board, Weight then e1RM: "PR · Weight", then "Group record · Weight" when flagged. */
  badges: string[];
  /** "Voided · set edited|set deleted", "✓ Certified by …", or "○ Not certified yet". */
  statusLabel: string;
  /** "Session in progress" while provisional and not voided. */
  provisionalLabel: string | null;
  voided: boolean;
  /** Not voided, not certified, and not my own set. */
  canCertify: boolean;
  groupId: string;
  groupName: string;
  accessibilityLabel: string;
};

/** A record-removed (D15) or link (P16) item: a light row with one sentence. */
export type StreamSentenceViewModel = {
  kind: 'record_voided' | 'link';
  key: string;
  sentence: string;
  groupId: string;
  groupName: string;
};

export type StreamItemViewModel =
  | StreamSessionCardViewModel
  | StreamMembershipViewModel
  | StreamRecordCardViewModel
  | StreamSentenceViewModel;

const buildSessionCard = (item: StreamSessionItem): StreamSessionCardViewModel => {
  const metrics = computeGroupSessionMetrics(item.exercises);
  return {
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
    setsLabel: formatSetCount(metrics.performedSets),
    volumeLabel: formatVolumeKg(metrics.totalVolumeKg),
    exercisesLabel: formatExerciseCount(metrics.exerciseCount),
    recordsLabel: null,
  };
};

const buildMembershipItem = (item: StreamMembershipItem): StreamMembershipViewModel => ({
  kind: 'membership',
  key: item.key,
  sentence: formatMembershipSentence(item.event, item.member.username),
  groupId: item.group.group_id,
  groupName: item.group.name,
});

// ---- Record cards, record-removed and link items (M25-T10) ---------------------

export const YOU_NAME = 'You';
export const METRIC_NAMES: Record<GroupBoardMetric, string> = { weight: 'Weight', e1rm: 'e1RM' };
const METRIC_ORDER: GroupBoardMetric[] = ['weight', 'e1rm'];
const metricRank = (metric: GroupBoardMetric): number => METRIC_ORDER.indexOf(metric);
const metricName = (metric: GroupBoardMetric): string => METRIC_NAMES[metric] ?? String(metric);

export const RECORD_PROVISIONAL_LABEL = 'Session in progress';
export const RECORD_UNCERTIFIED_LABEL = '○ Not certified yet';

const isMyUser = (userId: string, myUserId: string | null): boolean => myUserId !== null && userId === myUserId;

/** "You" for me, else the username ("Unnamed member" fallback). */
export const formatStreamPersonName = (member: GroupMemberRef, myUserId: string | null): string =>
  isMyUser(member.user_id, myUserId) ? YOU_NAME : formatMemberName(member.username);

const formatPossessive = (member: GroupMemberRef, myUserId: string | null): string =>
  isMyUser(member.user_id, myUserId) ? 'Your' : `${formatMemberName(member.username)}'s`;

/** "140 kg × 1". */
export const formatSetValue = (weightKg: number, reps: number): string => `${formatKg(weightKg)} kg × ${reps}`;

/** "✓ Certified by sam" / "✓ Certified by you" / "✓ Certified" (the certifier's account is gone). */
export const formatCertifiedBy = (certifiedBy: GroupMemberRef | null, myUserId: string | null): string => {
  if (!certifiedBy) return '✓ Certified';
  return isMyUser(certifiedBy.user_id, myUserId)
    ? '✓ Certified by you'
    : `✓ Certified by ${formatMemberName(certifiedBy.username)}`;
};

/** "Voided · set edited" / "Voided · set deleted". */
export const formatVoidedLabel = (reason: StreamRecordVoidReason): string => `Voided · set ${reason}`;

/** Board badges in Weight, then e1RM order; a group record also lists its PR (E3). */
export const formatRecordBadges = (boards: StreamRecordItem['boards']): string[] =>
  [...boards]
    .sort((a, b) => metricRank(a.metric) - metricRank(b.metric))
    .flatMap((board) =>
      board.group_record
        ? [`PR · ${metricName(board.metric)}`, `Group record · ${metricName(board.metric)}`]
        : [`PR · ${metricName(board.metric)}`],
    );

const buildRecordCard = (item: StreamRecordItem, myUserId: string | null): StreamRecordCardViewModel => {
  const title = `${formatStreamPersonName(item.member, myUserId)} — ${
    item.boards.some((board) => board.group_record) ? 'group record' : 'PR'
  }`;
  const setValue = formatSetValue(item.weight_kg, item.reps);
  const valueLabel =
    item.e1rm_kg !== null && item.boards.some((board) => board.metric === 'e1rm')
      ? `${setValue} · e1RM ${formatKg(item.e1rm_kg)} kg`
      : setValue;
  const voided = item.voided !== null;
  let statusLabel = RECORD_UNCERTIFIED_LABEL;
  if (item.voided) {
    statusLabel = formatVoidedLabel(item.voided.reason);
  } else if (item.certified) {
    statusLabel = formatCertifiedBy(item.certification?.certified_by ?? null, myUserId);
  }
  const provisionalLabel = item.provisional && !voided ? RECORD_PROVISIONAL_LABEL : null;
  const badges = formatRecordBadges(item.boards);
  return {
    kind: 'record',
    key: item.key,
    record: item,
    memberUserId: item.member.user_id,
    title,
    exerciseLabel: item.group_exercise.name,
    valueLabel,
    badges,
    statusLabel,
    provisionalLabel,
    voided,
    canCertify: !voided && !item.certified && myUserId !== null && item.member.user_id !== myUserId,
    groupId: item.group.group_id,
    groupName: item.group.name,
    accessibilityLabel: [title, item.group_exercise.name, valueLabel, ...badges, provisionalLabel, statusLabel]
      .filter((part): part is string => part !== null)
      .join(', '),
  };
};

/**
 * "dana's Bench Press record removed (140 kg × 1) — set edited · Now #1 on
 * Weight: sam 138 kg · No one holds #1 on e1RM" (D15).
 */
export const formatRecordVoidedSentence = (item: StreamRecordVoidedItem, myUserId: string | null): string => {
  const head = `${formatPossessive(item.member, myUserId)} ${item.group_exercise.name} record removed (${formatSetValue(
    item.record.weight_kg,
    item.record.reps,
  )}) — set ${item.reason}`;
  const leaders = [...item.leaders]
    .sort((a, b) => metricRank(a.metric) - metricRank(b.metric))
    .map(({ metric, leader }) =>
      leader
        ? `Now #1 on ${metricName(metric)}: ${formatStreamPersonName(leader.member, myUserId)} ${formatKg(leader.value_kg)} kg`
        : `No one holds #1 on ${metricName(metric)}`,
    );
  return [head, ...leaders].join(' · ');
};

/** " — now #1 on Weight and e1RM", " — now #2 on Weight, #1 on e1RM", " — off the e1RM board"; "" with no effects. */
export const formatLinkEffects = (effects: StreamLinkItem['effects']): string => {
  const sorted = [...effects].sort((a, b) => metricRank(a.metric) - metricRank(b.metric));
  const ranked = sorted.flatMap((effect) => (effect.after ? [{ metric: effect.metric, rank: effect.after.rank }] : []));
  const parts: string[] = [];
  if (ranked.length > 1 && ranked.every((effect) => effect.rank === ranked[0].rank)) {
    parts.push(`now #${ranked[0].rank} on ${ranked.map((effect) => metricName(effect.metric)).join(' and ')}`);
  } else if (ranked.length > 0) {
    parts.push(`now ${ranked.map((effect) => `#${effect.rank} on ${metricName(effect.metric)}`).join(', ')}`);
  }
  for (const effect of sorted) {
    if (effect.after === null) parts.push(`off the ${metricName(effect.metric)} board`);
  }
  return parts.length > 0 ? ` — ${parts.join(', ')}` : '';
};

/** "dana linked Bench (comp grip) to Bench Press — now #1 on e1RM" / "dana unlinked A from Bench Press — off the Weight board" (P16). */
export const formatLinkSentence = (item: StreamLinkItem, myUserId: string | null): string => {
  const names = item.exercises.map((exercise) => exercise.name?.trim() || 'an exercise');
  const exercises = names.length > 0 ? names.join(', ') : 'an exercise';
  const verb = item.event === 'unlink' ? `unlinked ${exercises} from` : `linked ${exercises} to`;
  return `${formatStreamPersonName(item.member, myUserId)} ${verb} ${item.group_exercise.name}${formatLinkEffects(item.effects)}`;
};

export const formatRecordCount = (count: number): string => pluralize(count, 'record', 'records');

const buildSentenceItem = (item: StreamRecordVoidedItem | StreamLinkItem, myUserId: string | null): StreamSentenceViewModel => ({
  kind: item.kind,
  key: item.key,
  sentence: item.kind === 'link' ? formatLinkSentence(item, myUserId) : formatRecordVoidedSentence(item, myUserId),
  groupId: item.group.group_id,
  groupName: item.group.name,
});

/** One item on its own; a session card's `recordsLabel` needs the whole list (`buildStreamViewModel`). */
export const buildStreamItemViewModel = (item: StreamItem, myUserId: string | null = null): StreamItemViewModel => {
  switch (item.kind) {
    case 'session':
      return buildSessionCard(item);
    case 'membership':
      return buildMembershipItem(item);
    case 'record':
      return buildRecordCard(item, myUserId);
    case 'record_voided':
    case 'link':
      return buildSentenceItem(item, myUserId);
    default: {
      const unhandled: never = item;
      throw new Error(`Unhandled stream item kind: ${String((unhandled as { kind?: unknown }).kind)}`);
    }
  }
};

/** A session item's key and a record's session identity share one shape: `<member_user_id>:<session_id>`. */
const recordSessionKey = (record: StreamRecordItem): string => `${record.member.user_id}:${record.session_id}`;

/**
 * Server order, except that a record whose session card is among the items
 * moves directly below that card (E3). The session card counts those records,
 * non-voided and deduplicated by set. A record whose session card is not loaded
 * stays where the server put it.
 */
export const buildStreamViewModel = (items: StreamItem[], myUserId: string | null = null): StreamItemViewModel[] => {
  const loadedSessions = new Set(items.filter((item) => item.kind === 'session').map((item) => item.key));
  const attached = new Map<string, StreamRecordItem[]>();
  for (const item of items) {
    if (item.kind === 'record' && loadedSessions.has(recordSessionKey(item))) {
      attached.set(recordSessionKey(item), [...(attached.get(recordSessionKey(item)) ?? []), item]);
    }
  }

  const models: StreamItemViewModel[] = [];
  for (const item of items) {
    if (item.kind === 'record' && attached.has(recordSessionKey(item))) {
      continue;
    }
    if (item.kind !== 'session') {
      models.push(buildStreamItemViewModel(item, myUserId));
      continue;
    }
    const records = attached.get(item.key) ?? [];
    const recordSets = new Set(records.filter((record) => record.voided === null).map((record) => record.set_id));
    models.push({ ...buildSessionCard(item), recordsLabel: recordSets.size > 0 ? formatRecordCount(recordSets.size) : null });
    models.push(...records.map((record) => buildRecordCard(record, myUserId)));
  }
  return models;
};

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
