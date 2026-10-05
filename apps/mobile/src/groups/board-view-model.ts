// Pure presentation rules for group leaderboards (P6–P9, E1.1–E1.3;
// `docs/specs/tech/groups-contract.md`): podium cards,
// full-board rows, history sentences, the board's route params, and the
// ordinal / date / value formatting they share. Values arrive converted to the
// group exercise's weight entry (D6); nothing here re-ranks or re-sorts.


import { formatMemberName, formatMetricFigure, formatSetFigure } from './stream-view-model';
import type {
  BoardHolder,
  BoardRow,
  GroupBoardHistoryItem,
  GroupBoardHistoryRelated,
  GroupBoardMetric,
  GroupBoardPodiumsResult,
  GroupMemberRef,
} from './types';

// ---- Views and routes ---------------------------------------------------------

export type GroupBoardScope = 'certified' | 'all';

/** Display copy only: the `e1rm` key, the `metric=e1rm` param and testIDs stay. */
export const BOARD_METRIC_LABELS: Record<GroupBoardMetric, string> = { weight: 'Weight', e1rm: '1RM' };
export const BOARD_SCOPE_LABELS: Record<GroupBoardScope, string> = { certified: 'Certified', all: 'All' };

/** The podium page's and a card's default view (P8, D11). */
export const DEFAULT_BOARD_METRIC: GroupBoardMetric = 'e1rm';
export const DEFAULT_BOARD_SCOPE: GroupBoardScope = 'certified';

const firstValue = (value: string | string[] | undefined | null): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/** The `metric` query param; anything else is the default (1RM). */
export const parseBoardMetricParam = (value: string | string[] | undefined | null): GroupBoardMetric => {
  const raw = firstValue(value);
  return raw === 'weight' || raw === 'e1rm' ? raw : DEFAULT_BOARD_METRIC;
};

/** The `scope` query param; anything else is the default (Certified). */
export const parseBoardScopeParam = (value: string | string[] | undefined | null): GroupBoardScope => {
  const raw = firstValue(value);
  return raw === 'certified' || raw === 'all' ? raw : DEFAULT_BOARD_SCOPE;
};

/** "Certified · 1RM", "All · Weight". */
export const formatBoardViewLabel = (metric: GroupBoardMetric, scope: GroupBoardScope): string =>
  `${BOARD_SCOPE_LABELS[scope]} · ${BOARD_METRIC_LABELS[metric]}`;

/** The full board; with a view, its toggles as the query (typed-route template literals). */
export const groupBoardPath = (
  groupId: string,
  groupExerciseId: string,
  view?: { metric: GroupBoardMetric; scope: GroupBoardScope },
) =>
  view
    ? (`/group/${groupId}/leaderboards/${groupExerciseId}?metric=${view.metric}&scope=${view.scope}` as const)
    : (`/group/${groupId}/leaderboards/${groupExerciseId}` as const);

export const groupBoardHistoryPath = (
  groupId: string,
  groupExerciseId: string,
  view: { metric: GroupBoardMetric; scope: GroupBoardScope },
) => `/group/${groupId}/leaderboards/${groupExerciseId}/history?metric=${view.metric}&scope=${view.scope}` as const;

// ---- Formatting -----------------------------------------------------------------

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 101st, 111th. */
export const formatOrdinal = (value: number): string => {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`;
  }
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local "12 Sep"; "12 Sep 2025" when not in the current year. */
export const formatBoardDate = (epochMs: number, nowMs: number = Date.now()): string => {
  const date = new Date(epochMs);
  const label = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(nowMs).getFullYear() ? label : `${label} ${date.getFullYear()}`;
};

/** "142.5 kg", for sentences (prose keeps its unit), in the metric's format. */
export const formatBoardKg = (metric: GroupBoardMetric, valueKg: number): string => `${formatMetricFigure(metric, valueKg)} kg`;

/** A board value in a figure slot, no unit (design-language §6): 1RM "142.5", Weight "140.0". */
export const formatBoardFigure = (metric: GroupBoardMetric, valueKg: number): string => formatMetricFigure(metric, valueKg);

export const YOU_LABEL = 'You';

const isMe = (userId: string, myUserId: string | null): boolean => myUserId !== null && userId === myUserId;

/** "You" for my own row, else the username ("Unnamed member" fallback), plus " (former)" (P7). */
export const formatBoardMemberLabel = (member: GroupMemberRef, former: boolean, myUserId: string | null): string => {
  const name = isMe(member.user_id, myUserId) ? YOU_LABEL : formatMemberName(member.username);
  return former ? `${name} (former)` : name;
};

// ---- Board rows -------------------------------------------------------------------

/** The word beside an uncertified row's ring; a certified row's check stands alone. */
export const UNCERTIFIED_MARK_LABEL = 'uncertified';

export type BoardRowViewModel = {
  /** The member id: one row per member per board. */
  key: string;
  rank: number;
  rankLabel: string;
  memberLabel: string;
  isMe: boolean;
  former: boolean;
  /** 1RM: "142.5"; Weight: "140.0 × 1" (figures, no unit). */
  valueLabel: string;
  /** 1RM only: the set behind the estimate, "140.0 × 1". */
  detailLabel: string | null;
  dateLabel: string;
  /** On All only: the row draws a check, or a ring and "uncertified". Null on Certified. */
  certification: 'certified' | 'uncertified' | null;
  accessibilityLabel: string;
};

export const buildBoardRow = (
  row: BoardRow,
  metric: GroupBoardMetric,
  scope: GroupBoardScope,
  myUserId: string | null,
  nowMs: number = Date.now(),
): BoardRowViewModel => {
  const memberLabel = formatBoardMemberLabel(row.member, row.former, myUserId);
  const setLabel = formatSetFigure(row.weight_kg, row.reps);
  const valueLabel = metric === 'e1rm' ? formatBoardFigure(metric, row.value_kg) : setLabel;
  const detailLabel = metric === 'e1rm' ? setLabel : null;
  const dateLabel = formatBoardDate(row.achieved_at_ms, nowMs);
  const certification = scope === 'all' ? (row.certified ? 'certified' : 'uncertified') : null;
  const accessibilityLabel = [
    formatOrdinal(row.rank),
    memberLabel,
    metric === 'e1rm' ? `${BOARD_METRIC_LABELS.e1rm} ${valueLabel}` : valueLabel,
    detailLabel,
    dateLabel,
    scope === 'all' ? (row.certified ? 'certified' : 'uncertified') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
  return {
    key: row.member.user_id,
    rank: row.rank,
    rankLabel: String(row.rank),
    memberLabel,
    isMe: isMe(row.member.user_id, myUserId),
    former: row.former,
    valueLabel,
    detailLabel,
    dateLabel,
    certification,
    accessibilityLabel,
  };
};

// ---- Podium cards (E1.1) ------------------------------------------------------------

export const PODIUM_SIZE = 3;

export type PodiumRowViewModel = {
  key: string;
  rank: number;
  memberLabel: string;
  isMe: boolean;
  valueLabel: string;
  dateLabel: string;
};

export type PodiumCardViewModel = {
  exerciseId: string;
  name: string;
  archived: boolean;
  viewLabel: string;
  rows: PodiumRowViewModel[];
  /** "You: 5th" below the podium, "You: not ranked" on a non-empty board, else null. */
  youLabel: string | null;
  /** "No certified sets yet · 3 uncertified" / "No sets yet" for an empty podium, else null. */
  emptyLabel: string | null;
  accessibilityLabel: string;
};

export const NOT_RANKED_LABEL = 'You: not ranked';
export const NO_SETS_LABEL = 'No sets yet';

/** "No certified sets yet · N uncertified" (N > 0 sets on All), else "No sets yet". */
export const formatEmptyBoardLabel = (certified: boolean, allEntryCount: number): string =>
  certified && allEntryCount > 0 ? `No certified sets yet · ${allEntryCount} uncertified` : NO_SETS_LABEL;

/** One card per group exercise, in the server's order (archived last). */
export const buildPodiumCards = (
  payload: GroupBoardPodiumsResult,
  myUserId: string | null,
  nowMs: number = Date.now(),
): PodiumCardViewModel[] => {
  const scope: GroupBoardScope = payload.certified ? 'certified' : 'all';
  const viewLabel = formatBoardViewLabel(payload.metric, scope);
  return payload.exercises.map(({ exercise, podium, me, entry_count, all_entry_count }) => {
    const rows = podium.slice(0, PODIUM_SIZE).map((row) => ({
      key: row.member.user_id,
      rank: row.rank,
      memberLabel: formatBoardMemberLabel(row.member, row.former, myUserId),
      isMe: isMe(row.member.user_id, myUserId),
      valueLabel: formatBoardFigure(payload.metric, row.value_kg),
      dateLabel: formatBoardDate(row.achieved_at_ms, nowMs),
    }));
    const empty = entry_count === 0 && rows.length === 0;
    let youLabel: string | null = null;
    if (me && me.rank > PODIUM_SIZE) {
      youLabel = `You: ${formatOrdinal(me.rank)}`;
    } else if (!me && !empty) {
      youLabel = NOT_RANKED_LABEL;
    }
    const emptyLabel = empty ? formatEmptyBoardLabel(payload.certified, all_entry_count) : null;
    const archived = exercise.archived_at_ms !== null;
    const accessibilityLabel = [
      exercise.name,
      archived ? 'archived' : null,
      viewLabel,
      ...rows.map((row) => `${formatOrdinal(row.rank)} ${row.memberLabel} ${row.valueLabel} ${row.dateLabel}`),
      emptyLabel,
      youLabel,
    ]
      .filter((part): part is string => part !== null)
      .join(', ');
    return {
      exerciseId: exercise.group_exercise_id,
      name: exercise.name,
      archived,
      viewLabel,
      rows,
      youLabel,
      emptyLabel,
      accessibilityLabel,
    };
  });
};

// ---- History (E1.3) ---------------------------------------------------------------------

export type BoardHistoryItemViewModel = {
  key: string;
  dateLabel: string;
  sentence: string;
};

const holderName = (holder: BoardHolder, myUserId: string | null): string =>
  isMe(holder.member_user_id, myUserId) ? YOU_LABEL : formatMemberName(holder.member?.username);

/** Mid-sentence name: "you" for me. */
const holderNameInline = (holder: BoardHolder, myUserId: string | null): string =>
  isMe(holder.member_user_id, myUserId) ? 'you' : formatMemberName(holder.member?.username);

const holderPossessive = (holder: BoardHolder, myUserId: string | null): string =>
  isMe(holder.member_user_id, myUserId) ? 'your' : `${formatMemberName(holder.member?.username)}'s`;

const linkExerciseNames = (item: GroupBoardHistoryItem): string => {
  if (item.related?.kind !== 'link' || item.related.exercises.length === 0) {
    return 'an exercise';
  }
  return item.related.exercises.map((exercise) => exercise.name?.trim() || 'an exercise').join(', ');
};

/** "L took #1 · v", "You took #1 · v". */
const tookFirst = (leader: BoardHolder, myUserId: string | null, metric: GroupBoardMetric): string =>
  `${holderName(leader, myUserId)} took #1 · ${formatBoardKg(metric, leader.value_kg)}`;

/** "L now #1 · v", "You're now #1 · v". */
const nowFirst = (leader: BoardHolder, myUserId: string | null, metric: GroupBoardMetric): string =>
  isMe(leader.member_user_id, myUserId)
    ? `You're now #1 · ${formatBoardKg(metric, leader.value_kg)}`
    : `${holderName(leader, myUserId)} now #1 · ${formatBoardKg(metric, leader.value_kg)}`;

/** "Dave's 142.5 kg", "your 150 kg". */
const holderValue = (holder: BoardHolder, myUserId: string | null, metric: GroupBoardMetric): string =>
  `${holderPossessive(holder, myUserId)} ${formatBoardKg(metric, holder.value_kg)}`;

type CertificationEvent = Extract<GroupBoardHistoryRelated, { kind: 'certification' }>['event'];

const ENDED_CERTIFICATION_EVENTS: ReadonlySet<CertificationEvent> = new Set(['withdrawn', 'cancelled', 'voided']);

const certificationEvent = (related: GroupBoardHistoryItem['related']): CertificationEvent | null =>
  related?.kind === 'certification' ? related.event : null;

/** A void removes the record that held #1; the board may be left empty. */
const voidSentence = ({ leader, previous, related }: GroupBoardHistoryItem, myUserId: string | null, metric: GroupBoardMetric): string => {
  const cause = related?.kind === 'record_voided' ? ` — set ${related.reason}` : '';
  const removed = previous ? `${holderValue(previous, myUserId, metric)} removed${cause}` : `a record removed${cause}`;
  return leader ? `${nowFirst(leader, myUserId, metric)} (${removed})` : `No one holds #1 (${removed})`;
};

/** Any other reason with no leader left; only an ended certification says whose #1 went. */
const emptyBoardSentence = ({ reason, previous, related }: GroupBoardHistoryItem, myUserId: string | null, metric: GroupBoardMetric): string => {
  const event = certificationEvent(related);
  if (reason === 'certification' && event !== null && event !== 'certified' && previous) {
    return `No one holds #1 (${holderValue(previous, myUserId, metric)} certification ${event})`;
  }
  return 'No one holds #1';
};

const recordSentence = (leader: BoardHolder, previous: BoardHolder | null, myUserId: string | null, metric: GroupBoardMetric): string =>
  previous
    ? `${tookFirst(leader, myUserId, metric)} (from ${holderNameInline(previous, myUserId)}, ${formatBoardKg(metric, previous.value_kg)})`
    : `${holderName(leader, myUserId)} set the first record · ${formatBoardKg(metric, leader.value_kg)}`;

const linkSentence = (item: GroupBoardHistoryItem, leader: BoardHolder, myUserId: string | null, metric: GroupBoardMetric): string => {
  const { previous, related } = item;
  if (related?.kind !== 'link') {
    return tookFirst(leader, myUserId, metric);
  }
  const names = linkExerciseNames(item);
  if (related.event !== 'unlink') {
    return `${tookFirst(leader, myUserId, metric)} (linked ${names})`;
  }
  const who = previous ? `${holderNameInline(previous, myUserId)} unlinked` : 'unlinked';
  return `${tookFirst(leader, myUserId, metric)} (${who} ${names})`;
};

/** " by Kim", " by you", or nothing when the certifier is unknown. */
const certifierSuffix = (related: GroupBoardHistoryItem['related'], myUserId: string | null): string => {
  if (related?.kind !== 'certification' || !related.certified_by) {
    return '';
  }
  const { user_id, username } = related.certified_by;
  return ` by ${isMe(user_id, myUserId) ? 'you' : formatMemberName(username)}`;
};

const certificationSentence = (
  { previous, related }: GroupBoardHistoryItem,
  leader: BoardHolder,
  myUserId: string | null,
  metric: GroupBoardMetric,
): string => {
  const event = certificationEvent(related);
  if (event === null || !ENDED_CERTIFICATION_EVENTS.has(event)) {
    return `${tookFirst(leader, myUserId, metric)} (certified${certifierSuffix(related, myUserId)})`;
  }
  const lost = previous ? `${holderValue(previous, myUserId, metric)} certification ${event}` : `a certification ${event}`;
  return `${nowFirst(leader, myUserId, metric)} (${lost})`;
};

/** The lead-change sentence per reason (E1.3). An unknown reason or missing `related` reads "L took #1 · v". */
export const describeHistorySentence = (
  item: GroupBoardHistoryItem,
  myUserId: string | null,
  metric: GroupBoardMetric,
): string => {
  if (item.reason === 'void') {
    return voidSentence(item, myUserId, metric);
  }
  const { leader } = item;
  if (!leader) {
    return emptyBoardSentence(item, myUserId, metric);
  }
  switch (item.reason) {
    case 'record':
      return recordSentence(leader, item.previous, myUserId, metric);
    case 'link':
      return linkSentence(item, leader, myUserId, metric);
    case 'certification':
      return certificationSentence(item, leader, myUserId, metric);
    default:
      return tookFirst(leader, myUserId, metric);
  }
};

export const buildHistoryItem = (
  item: GroupBoardHistoryItem,
  myUserId: string | null,
  metric: GroupBoardMetric,
  nowMs: number = Date.now(),
): BoardHistoryItemViewModel => ({
  key: item.key,
  dateLabel: formatBoardDate(item.occurred_at_ms, nowMs),
  sentence: describeHistorySentence(item, myUserId, metric),
});
