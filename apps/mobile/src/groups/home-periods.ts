/**
 * The group home page's periods and figures: which local weeks At a
 * glance reads, and each member's totals in them, from one
 * `group_competition_period_totals` read (groups contract, "Week summary and period totals").
 * Pure — no API, no cache, no clock of its own.
 */
import { localWeekWindow, type LocalWindow } from '@/src/utils/local-calendar';

import type { CompetitionPeriodWindow } from './api';
import { YOU_LABEL } from './board-view-model';
import type { CompetitionPeriodTotalsWire } from './competition-wire';
import { formatMemberName } from './stream-view-model';

/** The figure the board and the position chart rank by. */
export type GroupHomeMetric = 'sets' | 'prs';
/** The period a board covers; the stepper walks back through them. */
export type GroupHomePeriod = 'week';

export const GROUP_HOME_BOARD_SIZE = 5;
/** The position chart's columns: the period in view and the five before it. */
export const GROUP_RANK_PERIODS = 6;

/** Where the selected period sits in the rank chart: fourth of six, two later periods after it. */
export const GROUP_RANK_SELECTED_POSITION = 3;

/**
 * The offset of the newest period the chart draws for a selected `offset`:
 * the selection fourth, unless fewer later periods exist (the current one
 * is the last), when the chart ends at the current period.
 */
export const groupRankSeriesEnd = (offset: number): number =>
  Math.min(0, offset + (GROUP_RANK_PERIODS - 1 - GROUP_RANK_SELECTED_POSITION));

export type GroupHomeMemberTotals = {
  userId: string;
  name: string;
  isMe: boolean;
  /** Working sets ([[set.count-display]]). */
  sets: number;
  /** Group records taken in the window, one per board taken #1. */
  prs: number;
};

export type GroupHomeWindow = {
  window: LocalWindow;
  /** Every current member's window totals, in no particular order. */
  members: GroupHomeMemberTotals[];
};

const PERIOD_WINDOW: Record<GroupHomePeriod, (now: Date, offset: number) => LocalWindow> = {
  week: localWeekWindow,
};

export const groupHomeWindowFor = (period: GroupHomePeriod, now: Date, offset: number): LocalWindow =>
  PERIOD_WINDOW[period](now, offset);

/**
 * The windows one read covers, oldest first: the period at `offset` (0 the
 * current one, -1 the one before) and the `periods - 1` before it. The last
 * one is the board's; all of them are the position chart's.
 */
export const groupHomeSeriesWindows = ({
  period,
  offset,
  now,
  periods = GROUP_RANK_PERIODS,
}: {
  period: GroupHomePeriod;
  offset: number;
  now: Date;
  periods?: number;
}): LocalWindow[] =>
  Array.from({ length: periods }, (_, index) => groupHomeWindowFor(period, now, offset - (periods - 1 - index)));

/** The request's windows, as epoch ms `[start_ms, end_ms)`. */
export const toCompetitionPeriodWindows = (windows: LocalWindow[]): CompetitionPeriodWindow[] =>
  windows.map((window) => ({ start_ms: window.start.getTime(), end_ms: window.end.getTime() }));

/**
 * The read for exactly these windows, or null when `totals` answers another
 * request (a cached read from before the week turned over): last week's board
 * never shows as this week's.
 */
export const readGroupHomeSeries = ({
  totals,
  windows,
  myUserId,
}: {
  totals: CompetitionPeriodTotalsWire;
  windows: LocalWindow[];
  myUserId: string;
}): GroupHomeWindow[] | null => {
  const matches =
    totals.periods.length === windows.length &&
    totals.periods.every(
      (entry, index) => entry.start_ms === windows[index]?.start.getTime() && entry.end_ms === windows[index]?.end.getTime(),
    );
  if (!matches) return null;
  return totals.periods.map((entry, index) => ({
    window: windows[index] as LocalWindow,
    members: entry.members.map((row) => {
      const isMe = row.member.user_id === myUserId;
      return {
        userId: row.member.user_id,
        name: isMe ? YOU_LABEL : formatMemberName(row.member.username),
        isMe,
        sets: row.working_sets,
        prs: row.group_records,
      };
    }),
  }));
};
