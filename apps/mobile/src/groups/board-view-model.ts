// Pure presentation rules for group leaderboards (P6–P9, E1.1–E1.3;
// `docs/specs/tech/groups-contract.md`): the podium card, full-board row and
// history item shapes, the board's route params, and the ordinal / date /
// member formatting they share. Nothing here re-ranks or re-sorts.

import { formatMemberName } from './stream-view-model';
import type { CompetitionMetric } from './competition-contract';
import type { GroupMemberRef } from './types';

// ---- Views and routes ---------------------------------------------------------

export type GroupBoardScope = 'certified' | 'all';
export const DEFAULT_BOARD_SCOPE: GroupBoardScope = 'certified';

const firstValue = (value: string | string[] | undefined | null): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/** The `scope` query param; anything else is the default (Certified). */
export const parseBoardScopeParam = (value: string | string[] | undefined | null): GroupBoardScope => {
  const raw = firstValue(value);
  return raw === 'certified' || raw === 'all' ? raw : DEFAULT_BOARD_SCOPE;
};

/** The full board; with a view, its toggles as the query (typed-route template literals). */
export const groupBoardPath = (
  groupId: string,
  groupExerciseId: string,
  view?: { metric: CompetitionMetric; scope: GroupBoardScope },
) =>
  view
    ? (`/group/${groupId}/leaderboards/${groupExerciseId}?metric=${view.metric}&scope=${view.scope}` as const)
    : (`/group/${groupId}/leaderboards/${groupExerciseId}` as const);

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

// ---- History (E1.3) ---------------------------------------------------------------------

export type BoardHistoryItemViewModel = {
  key: string;
  dateLabel: string;
  sentence: string;
};
