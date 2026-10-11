/**
 * The group home page's view model (pure): the period's top board by the
 * chosen metric, its newest activity cards, and who won the last four
 * periods. Words and figures only — the page draws them.
 *
 * Reads come from `home-mock` while the page is a design target; the shapes
 * here are what the shipped server read has to return.
 */
import { formatVolume } from '@/src/exercise-calculations/format';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { LocalWindow } from '@/src/utils/local-calendar';
import { formatClockTime, formatMonthDayTime } from '@/src/utils/local-time';

import { formatOrdinal } from './board-view-model';
import {
  GROUP_HOME_BOARD_SIZE,
  GROUP_HOME_WINNER_PERIODS,
  readGroupHomeWindow,
  type GroupHomeMemberTotals,
  type GroupHomeMetric,
  type GroupHomePeriod,
  type GroupHomeSession,
} from './home-mock';

/** A metric's own name, as the selector and the winners heading say it. */
export const GROUP_HOME_METRIC_LABELS: Record<GroupHomeMetric, string> = {
  sets: 'Sets',
  volume: 'Volume',
  prs: 'PRs',
};

/** The board column's micro-label; `VOL` keeps the widest figure in its column. */
export const GROUP_HOME_METRIC_COLUMN: Record<GroupHomeMetric, string> = {
  sets: 'Sets',
  volume: 'Vol',
  prs: 'PRs',
};

export const GROUP_HOME_METRIC_UNIT: Record<GroupHomeMetric, string> = {
  sets: 'working sets',
  volume: 'kg·reps',
  prs: 'group records',
};

export const groupHomeMetricValue = (totals: Pick<GroupHomeMemberTotals, 'sets' | 'volume' | 'prs'>, metric: GroupHomeMetric): number =>
  metric === 'sets' ? totals.sets : metric === 'volume' ? totals.volume : totals.prs;

/** House format: no unit and no thousands separator (`design-language.md` §6). */
export const formatGroupHomeMetric = (value: number, metric: GroupHomeMetric): string =>
  metric === 'volume' ? formatVolume(value) : String(value);

export type GroupHomeBoardRow = {
  userId: string;
  rank: number;
  name: string;
  isMe: boolean;
  value: number;
  valueLabel: string;
  /** The bar: the member's figure as a share of the leader's. */
  fraction: number;
  /** Rank 1 with a figure above zero: the bar's darker step. */
  leader: boolean;
};

export type GroupHomeBoard = {
  rows: GroupHomeBoardRow[];
  /** My own line, only when I am outside the listed rows. */
  me: { rankLabel: string; valueLabel: string } | null;
  accessibilityLabel: string;
};

/** Ranked by the metric, highest first; an equal figure shares a rank. */
const rankMembers = (members: GroupHomeMemberTotals[], metric: GroupHomeMetric): { member: GroupHomeMemberTotals; rank: number; value: number }[] => {
  const sorted = [...members].sort((left, right) => groupHomeMetricValue(right, metric) - groupHomeMetricValue(left, metric) || left.name.localeCompare(right.name));
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((member, index) => {
    const value = groupHomeMetricValue(member, metric);
    if (previous === null || value !== previous) rank = index + 1;
    previous = value;
    return { member, rank, value };
  });
};

export const buildGroupHomeBoard = ({
  members,
  metric,
  myUserId,
  size = GROUP_HOME_BOARD_SIZE,
}: {
  members: GroupHomeMemberTotals[];
  metric: GroupHomeMetric;
  myUserId: string;
  size?: number;
}): GroupHomeBoard => {
  const ranked = rankMembers(members, metric);
  const top = ranked[0]?.value ?? 0;
  const rows = ranked.slice(0, size).map(({ member, rank, value }) => ({
    userId: member.userId,
    rank,
    name: member.name,
    isMe: member.userId === myUserId,
    value,
    valueLabel: formatGroupHomeMetric(value, metric),
    fraction: top > 0 ? value / top : 0,
    leader: rank === 1 && value > 0,
  }));
  const mine = rows.some((row) => row.isMe) ? undefined : ranked.find((entry) => entry.member.userId === myUserId);
  const unit = GROUP_HOME_METRIC_UNIT[metric];
  return {
    rows,
    me: mine ? { rankLabel: formatOrdinal(mine.rank), valueLabel: formatGroupHomeMetric(mine.value, metric) } : null,
    accessibilityLabel: [
      `Top ${rows.length} by ${GROUP_HOME_METRIC_LABELS[metric].toLowerCase()}`,
      ...rows.map((row) => `${row.rank}, ${row.name}, ${row.valueLabel} ${unit}`),
      mine ? `You, ${formatOrdinal(mine.rank)}, ${formatGroupHomeMetric(mine.value, metric)} ${unit}` : null,
    ]
      .filter(Boolean)
      .join('; '),
  };
};

export type GroupHomeActivityCard = {
  sessionId: string;
  userId: string;
  name: string;
  trainingNow: boolean;
  /** `Started 07:40` while training, else `10/16 06:10`. */
  stamp: string;
  gym: string | null;
  setsLabel: string;
  volumeLabel: string;
  /** The group records taken, or null when the session took none. */
  prsLabel: string | null;
  accessibilityLabel: string;
};

const activityStamp = (session: GroupHomeSession, dateFormat?: ExerciseDateFormat): string =>
  session.trainingNow ? `Started ${formatClockTime(session.startedAtMs)}` : formatMonthDayTime(session.startedAtMs, dateFormat);

/** One small card per session: who, when, and the three figures. */
export const buildGroupHomeActivity = (sessions: GroupHomeSession[], dateFormat?: ExerciseDateFormat): GroupHomeActivityCard[] =>
  sessions.map((session) => {
    const stamp = activityStamp(session, dateFormat);
    // The figure alone; the card labels its column and the label below says the noun.
    const prsLabel = session.prs > 0 ? String(session.prs) : null;
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      name: session.name,
      trainingNow: session.trainingNow,
      stamp,
      gym: session.gymName,
      setsLabel: String(session.sets),
      volumeLabel: formatVolume(session.volume),
      prsLabel,
      accessibilityLabel: [
        session.name,
        session.trainingNow ? 'training now' : null,
        stamp,
        session.gymName && `at ${session.gymName}`,
        `${session.sets} sets`,
        session.prs > 0 ? `${session.prs} group record${session.prs === 1 ? '' : 's'}` : null,
        `${formatVolume(session.volume)} kg·reps`,
      ]
        .filter(Boolean)
        .join(', '),
    };
  });

export type GroupHomeWinner = {
  key: string;
  window: LocalWindow;
  /** The period the board is showing. */
  current: boolean;
  /** Null when nobody trained in the period. */
  winner: { userId: string; name: string; isMe: boolean; valueLabel: string } | null;
};

/**
 * Who won the metric over this period and the three before it, newest first.
 * The period in view is marked `current` so it reads as "so far".
 */
export const buildGroupHomeWinners = ({
  period,
  offset,
  now,
  metric,
  periods = GROUP_HOME_WINNER_PERIODS,
}: {
  period: GroupHomePeriod;
  offset: number;
  now: Date;
  metric: GroupHomeMetric;
  periods?: number;
}): GroupHomeWinner[] =>
  Array.from({ length: periods }, (_, index) => {
    const windowOffset = offset - index;
    const read = readGroupHomeWindow({ period, offset: windowOffset, now });
    const top = rankMembers(read.members, metric)[0];
    const value = top ? groupHomeMetricValue(top.member, metric) : 0;
    return {
      key: `${period}:${read.window.start.getTime()}`,
      window: read.window,
      current: index === 0,
      winner:
        top && value > 0
          ? {
              userId: top.member.userId,
              name: top.member.name,
              isMe: top.member.isMe,
              valueLabel: formatGroupHomeMetric(value, metric),
            }
          : null,
    };
  });

/** One member's place in one period, for the position chart and its table. */
export type GroupRankEntry = {
  userId: string;
  name: string;
  /** The initial drawn in the chart's marker. */
  initial: string;
  isMe: boolean;
  rank: number;
  valueLabel: string;
  volumeLabel: string;
};

export type GroupRankPeriod = {
  key: string;
  window: LocalWindow;
  /** The period still running. */
  current: boolean;
  /** Every current member, best first. */
  entries: GroupRankEntry[];
};

export type GroupRankLine = {
  userId: string;
  name: string;
  initial: string;
  isMe: boolean;
  /** The member's place in each period, oldest first. */
  ranks: number[];
};

export type GroupRankSeries = {
  /** Oldest first, so the chart reads left to right. */
  periods: GroupRankPeriod[];
  lines: GroupRankLine[];
  /** The deepest place anyone took: the chart's bottom row. */
  depth: number;
};

export const GROUP_RANK_PERIODS = 6;

/**
 * The position chart: every member's place by the chosen metric over the last
 * six periods, oldest first, plus each period's full ranking for the table
 * under it.
 */
export const buildGroupRankSeries = ({
  period,
  offset,
  now,
  metric,
  periods = GROUP_RANK_PERIODS,
}: {
  period: GroupHomePeriod;
  offset: number;
  now: Date;
  metric: GroupHomeMetric;
  periods?: number;
}): GroupRankSeries => {
  const read = Array.from({ length: periods }, (_, index) =>
    readGroupHomeWindow({ period, offset: offset - (periods - 1 - index), now }),
  );
  const built: GroupRankPeriod[] = read.map((window, index) => ({
    key: `${period}:${window.window.start.getTime()}`,
    window: window.window,
    current: index === periods - 1 && offset === 0,
    entries: rankMembers(window.members, metric).map(({ member, rank, value }) => ({
      userId: member.userId,
      name: member.name,
      initial: member.name.slice(0, 1).toUpperCase(),
      isMe: member.isMe,
      rank,
      valueLabel: formatGroupHomeMetric(value, metric),
      volumeLabel: formatVolume(member.volume),
    })),
  }));
  const last = built[built.length - 1]?.entries ?? [];
  return {
    periods: built,
    // One line per member, ordered by their place in the newest period.
    lines: last.map((entry) => ({
      userId: entry.userId,
      name: entry.name,
      initial: entry.initial,
      isMe: entry.isMe,
      ranks: built.map((window) => window.entries.find((row) => row.userId === entry.userId)?.rank ?? last.length),
    })),
    depth: Math.max(1, ...built.map((window) => window.entries.length)),
  };
};
