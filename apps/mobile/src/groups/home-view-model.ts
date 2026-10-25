/**
 * The group home page's view model (pure): the period's top board by the
 * chosen metric, and every member's place over the last six periods. Words
 * and figures only — the page draws them. Reads come from `home-periods`.
 */
import type { LocalWindow } from '@/src/utils/local-calendar';

import { formatOrdinal } from './board-view-model';
import {
  GROUP_HOME_BOARD_SIZE,
  type GroupHomeMemberTotals,
  type GroupHomeMetric,
  type GroupHomePeriod,
  type GroupHomeWindow,
} from './home-periods';

/** A metric's own name, as the selector and the chart heading say it. */
export const GROUP_HOME_METRIC_LABELS: Record<GroupHomeMetric, string> = {
  sets: 'Sets',
  prs: 'PRs',
};

/** The board column's micro-label. */
export const GROUP_HOME_METRIC_COLUMN: Record<GroupHomeMetric, string> = {
  sets: 'Sets',
  prs: 'PRs',
};

export const GROUP_HOME_METRIC_UNIT: Record<GroupHomeMetric, string> = {
  sets: 'working sets',
  prs: 'group records',
};

export const groupHomeMetricValue = (totals: Pick<GroupHomeMemberTotals, 'sets' | 'prs'>, metric: GroupHomeMetric): number =>
  metric === 'sets' ? totals.sets : totals.prs;

/** House format: a count, no unit and no thousands separator (`design-language.md` §6). */
export const formatGroupHomeMetric = (value: number): string => String(value);

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
    valueLabel: formatGroupHomeMetric(value),
    fraction: top > 0 ? value / top : 0,
    leader: rank === 1 && value > 0,
  }));
  const mine = rows.some((row) => row.isMe) ? undefined : ranked.find((entry) => entry.member.userId === myUserId);
  const unit = GROUP_HOME_METRIC_UNIT[metric];
  return {
    rows,
    me: mine ? { rankLabel: formatOrdinal(mine.rank), valueLabel: formatGroupHomeMetric(mine.value) } : null,
    accessibilityLabel: [
      `Top ${rows.length} by ${GROUP_HOME_METRIC_LABELS[metric].toLowerCase()}`,
      ...rows.map((row) => `${row.rank}, ${row.name}, ${row.valueLabel} ${unit}`),
      mine ? `You, ${formatOrdinal(mine.rank)}, ${formatGroupHomeMetric(mine.value)} ${unit}` : null,
    ]
      .filter(Boolean)
      .join('; '),
  };
};

/** One member's place in one period, for the position chart and its table. */
export type GroupRankEntry = {
  userId: string;
  name: string;
  /** The initial drawn in the chart's marker. */
  initial: string;
  isMe: boolean;
  rank: number;
  setsLabel: string;
  prsLabel: string;
};

export type GroupRankPeriod = {
  key: string;
  window: LocalWindow;
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

/**
 * The position chart: every member's place by the chosen metric in each read
 * period (oldest first), plus each period's full ranking for the table under
 * it.
 */
export const buildGroupRankSeries = ({
  period,
  reads,
  metric,
}: {
  period: GroupHomePeriod;
  reads: GroupHomeWindow[];
  metric: GroupHomeMetric;
}): GroupRankSeries => {
  const built: GroupRankPeriod[] = reads.map((read) => ({
    key: `${period}:${read.window.start.getTime()}`,
    window: read.window,
    entries: rankMembers(read.members, metric).map(({ member, rank }) => ({
      userId: member.userId,
      name: member.name,
      initial: member.name.slice(0, 1).toUpperCase(),
      isMe: member.isMe,
      rank,
      setsLabel: formatGroupHomeMetric(member.sets),
      prsLabel: formatGroupHomeMetric(member.prs),
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

export type GroupWeekTotals = Record<GroupHomeMetric, number>;

const sumWindow = (read: GroupHomeWindow | undefined): GroupWeekTotals => ({
  sets: (read?.members ?? []).reduce((total, row) => total + row.sets, 0),
  prs: (read?.members ?? []).reduce((total, row) => total + row.prs, 0),
});

/**
 * The group's own total for the newest period in a read, and for the one
 * before it: every current member's working sets and group records, summed.
 * The read carries current members only, so a member who left drops out of
 * both weeks. A read of one period compares with zero.
 */
export const buildGroupWeekTotals = (reads: GroupHomeWindow[]): { current: GroupWeekTotals; previous: GroupWeekTotals } => ({
  current: sumWindow(reads[reads.length - 1]),
  previous: sumWindow(reads[reads.length - 2]),
});
