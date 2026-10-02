// The group stream's metric-event card, as plain data: one place decides each
// kind's sentence, details, board statuses and where a tap opens history.
import { formatBoardDate } from './board-view-model';
import { describeGroupRules, formatGroupMetricValue, formatGroupRawPerformance, GROUP_METRIC_LABELS } from './metric-view-model';
import type { GroupMetricRecordBoardWire, GroupMetricStreamItemWire } from './metric-wire';
import { formatMemberName, type RecordCertificationStatus } from './stream-view-model';

type StreamItem = GroupMetricStreamItemWire;
type RecordItem = Extract<StreamItem, { kind: 'record' }>;
type GroupMember = { user_id: string; username: string | null } | null | undefined;

export type MetricStreamBoardView = GroupMetricRecordBoardWire & {
  status: RecordCertificationStatus;
  statusLabel: string;
};

export type MetricStreamCardModel = {
  isRecord: boolean;
  voided: boolean;
  /** The group's name when the card is shown outside the group (Today). */
  groupName: string | null;
  label: string;
  context: string;
  details: string[];
  boards: MetricStreamBoardView[];
  accessibilityLabel: string;
  footer: string;
  historyPath: MetricStreamHistoryPath;
};

export type MetricStreamCardOptions = { showGroupName: boolean; pressHint?: string; hasOnPress: boolean };

const RECORD_REMOVED = 'Record removed';

const actorName = (member: GroupMember, userId: string | null): string =>
  member?.user_id === userId ? 'You' : formatMemberName(member?.username);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Compile-time exhaustiveness; at runtime an unexpected kind keeps the generic sentence. */
const unknownKindLabel = (_item: never): string => 'Leaderboard changed';

const describeLabel = (item: StreamItem, userId: string | null): string => {
  const who = actorName(item.member, userId);
  switch (item.kind) {
    case 'record':
      if (item.voided) return RECORD_REMOVED;
      return `${who} — ${item.boards.some(board => board.group_record) ? 'group record' : 'personal record'}`;
    case 'record_voided':
      return RECORD_REMOVED;
    case 'link':
      return `${who} ${item.event === 'unlink' ? 'unlinked' : 'linked'} ${plural(item.exercise_definition_ids.length, 'exercise')}`;
    case 'rules_change':
      return 'Group rules changed';
    case 'lead_change':
      return 'Leaderboard changed';
    default:
      return unknownKindLabel(item);
  }
};

const recordStateNote = (item: RecordItem): string[] => {
  if (item.voided) return ['This performance no longer counts. Its original event remains in history.'];
  return item.provisional ? ['Session in progress'] : [];
};

const rankOrNone = (rank: Parameters<typeof formatGroupMetricValue>[0] | null) =>
  rank ? formatGroupMetricValue(rank) : 'not ranked';

const describeDetails = (item: StreamItem): string[] => {
  switch (item.kind) {
    case 'record':
      return [`As logged: ${formatGroupRawPerformance(item.performance)}`, ...recordStateNote(item)];
    case 'record_voided':
      return [
        `The set was ${item.reason === 'deleted' ? 'deleted' : 'corrected'}. Its original record no longer counts.`,
        ...item.leaders.map(({ metric, leader }) => `${GROUP_METRIC_LABELS[metric]} · ${leader
          ? `${formatMemberName(leader.member.username)} leads with ${formatGroupMetricValue(leader)}`
          : 'no current leader'}`),
      ];
    case 'link':
      return [
        'The comparison changed after linking. This is not a newly performed set.',
        ...item.effects.map(effect => `${GROUP_METRIC_LABELS[effect.metric]}: ${rankOrNone(effect.before)} → ${rankOrNone(effect.after)}`),
      ];
    case 'rules_change':
      return [
        `Rules ${item.previous_revision} → ${item.rules_revision}. The whole board was recalculated; this is not a newly performed record.`,
        describeGroupRules({ ...item.group_exercise, ...item.rules }),
      ];
    default:
      return [];
  }
};

const certifierName = (certifiedBy: GroupMember, userId: string | null): string =>
  certifiedBy?.user_id === userId ? 'you' : certifiedBy?.username ?? 'a group member';

/** A board's certification as of the record context; no context means the card must be refreshed to know. */
const boardStatus = (board: GroupMetricRecordBoardWire, item: RecordItem, userId: string | null) => {
  if (item.voided) return { status: 'voided', statusLabel: RECORD_REMOVED } as const;
  const current = item.record_context?.metrics.find(entry => entry.metric === board.metric);
  const certification = current?.certification;
  if (certification?.ended_at_ms === null) {
    return { status: 'certified', statusLabel: `Certified by ${certifierName(certification.certified_by, userId)}` } as const;
  }
  return { status: 'uncertified', statusLabel: current ? 'Uncertified' : 'Refresh to check certification' } as const;
};

const boardViews = (item: StreamItem, userId: string | null): MetricStreamBoardView[] =>
  item.kind === 'record' ? item.boards.map(board => ({ ...board, ...boardStatus(board, item, userId) })) : [];

/** Opening history keeps the event's own rules revision. */
const historyPathFor = (item: StreamItem) => {
  const metric = item.kind === 'record' ? item.boards[0]?.metric : item.group_exercise.default_metric;
  return `/group/${item.group.group_id}/leaderboards/${item.group_exercise_id}/history?metric=${metric}&scope=all&revision=${item.rules_revision}` as const;
};
export type MetricStreamHistoryPath = ReturnType<typeof historyPathFor>;

export function buildMetricStreamCardModel(
  item: StreamItem,
  userId: string | null,
  { showGroupName, pressHint, hasOnPress }: MetricStreamCardOptions,
): MetricStreamCardModel {
  const isRecord = item.kind === 'record';
  const groupName = showGroupName ? item.group.name : null;
  const label = describeLabel(item, userId);
  const context = `${item.group_exercise.name} · Rules ${item.rules_revision}`;
  const details = describeDetails(item);
  const boards = boardViews(item, userId);
  const date = formatBoardDate(item.sort_at_ms);
  const accessibilityLabel = [
    groupName,
    label,
    context,
    ...boards.map(board => `${GROUP_METRIC_LABELS[board.metric]} ${formatGroupMetricValue(board)}, ${board.statusLabel}`),
    ...details,
    date,
    isRecord ? pressHint : null,
  ].filter(Boolean).join(', ');
  return {
    isRecord,
    voided: item.kind === 'record' && item.voided,
    groupName,
    label,
    context,
    details,
    boards,
    accessibilityLabel,
    footer: `${date} · ${pressHint ?? (hasOnPress ? 'View record' : 'View rules history')}`,
    historyPath: historyPathFor(item),
  };
}
