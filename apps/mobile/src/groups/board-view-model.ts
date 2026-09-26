// Pure presentation rules for group leaderboards (M25-T09; product P6–P9,
// E1.1–E1.3; `docs/specs/tech/groups-contract.md` §2.11, §4.5): podium cards,
// full-board rows, history sentences, the board's route params, and the
// ordinal / date / value formatting they share. Values arrive converted to the
// group exercise's weight entry (D6); nothing here re-ranks or re-sorts.

import { formatOneRepMaxFigure, formatWeightFigure } from '@/src/session-recorder/session-view-model';

import { formatKg, formatMemberName, formatSetFigure } from './stream-view-model';
import type {
  BoardHolder,
  BoardRow,
  GroupBoardHistoryItem,
  GroupBoardMetric,
  GroupBoardPodiumsResult,
  GroupMemberRef,
} from './types';

// ---- Views and routes ---------------------------------------------------------

export type GroupBoardScope = 'certified' | 'all';

/** Display copy only: the `e1rm` key, the `metric=e1rm` param and testIDs stay (G7, DLM-T12-D2). */
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

/** "142.5 kg", for sentences (prose keeps its unit). */
export const formatBoardKg = (valueKg: number): string => `${formatKg(valueKg)} kg`;

/** A board value in a figure slot, no unit (design-language §6): 1RM "142.5", Weight "140.0". */
export const formatBoardFigure = (metric: GroupBoardMetric, valueKg: number): string =>
  metric === 'e1rm' ? formatOneRepMaxFigure(valueKg) : formatWeightFigure(valueKg);

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

/** One card per group exercise, in the server's order (archived last, §4.5). */
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
const tookFirst = (leader: BoardHolder, myUserId: string | null): string =>
  `${holderName(leader, myUserId)} took #1 · ${formatBoardKg(leader.value_kg)}`;

/** The lead-change sentence per reason (E1.3). An unknown reason or missing `related` reads "L took #1 · v". */
export const describeHistorySentence = (item: GroupBoardHistoryItem, myUserId: string | null): string => {
  const { leader, previous, reason, related } = item;

  if (reason === 'void') {
    const cause = related?.kind === 'record_voided' ? ` — set ${related.reason}` : '';
    const removed = previous
      ? `${holderPossessive(previous, myUserId)} ${formatBoardKg(previous.value_kg)} removed${cause}`
      : `a record removed${cause}`;
    if (!leader) {
      return `No one holds #1 (${removed})`;
    }
    const now = isMe(leader.member_user_id, myUserId)
      ? `You're now #1 · ${formatBoardKg(leader.value_kg)}`
      : `${holderName(leader, myUserId)} now #1 · ${formatBoardKg(leader.value_kg)}`;
    return `${now} (${removed})`;
  }

  if (!leader) {
    if (reason === 'certification' && related?.kind === 'certification' && related.event !== 'certified' && previous) {
      return `No one holds #1 (${holderPossessive(previous, myUserId)} ${formatBoardKg(previous.value_kg)} certification ${related.event})`;
    }
    return 'No one holds #1';
  }

  if (reason === 'record') {
    if (!previous) {
      return `${holderName(leader, myUserId)} set the first record · ${formatBoardKg(leader.value_kg)}`;
    }
    return `${tookFirst(leader, myUserId)} (from ${holderNameInline(previous, myUserId)}, ${formatBoardKg(previous.value_kg)})`;
  }

  if (reason === 'link' && related?.kind === 'link') {
    const names = linkExerciseNames(item);
    if (related.event === 'unlink') {
      const who = previous ? `${holderNameInline(previous, myUserId)} unlinked` : 'unlinked';
      return `${tookFirst(leader, myUserId)} (${who} ${names})`;
    }
    return `${tookFirst(leader, myUserId)} (linked ${names})`;
  }

  if (reason === 'certification') {
    const event = related?.kind === 'certification' ? related.event : null;
    if (event === 'withdrawn' || event === 'cancelled' || event === 'voided') {
      const lost = previous
        ? `${holderPossessive(previous, myUserId)} ${formatBoardKg(previous.value_kg)} certification ${event}`
        : `a certification ${event}`;
      const now = isMe(leader.member_user_id, myUserId)
        ? `You're now #1 · ${formatBoardKg(leader.value_kg)}`
        : `${holderName(leader, myUserId)} now #1 · ${formatBoardKg(leader.value_kg)}`;
      return `${now} (${lost})`;
    }
    const certifier =
      related?.kind === 'certification' && related.certified_by
        ? ` by ${related.certified_by.user_id === myUserId ? 'you' : formatMemberName(related.certified_by.username)}`
        : '';
    return `${tookFirst(leader, myUserId)} (certified${certifier})`;
  }

  return tookFirst(leader, myUserId);
};

export const buildHistoryItem = (
  item: GroupBoardHistoryItem,
  myUserId: string | null,
  nowMs: number = Date.now(),
): BoardHistoryItemViewModel => ({
  key: item.key,
  dateLabel: formatBoardDate(item.occurred_at_ms, nowMs),
  sentence: describeHistorySentence(item, myUserId),
});
