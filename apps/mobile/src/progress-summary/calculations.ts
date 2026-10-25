// Today's progress figures (pure). Every window places a session, its working
// sets and its PRs by the session's `completed_at`, the stamp both the stats
// aggregation and the exercise session facts use.

import { countedMuscleAnalyticsSessionIds, countMuscleAnalyticsWorkingSets } from '@/src/data/muscle-analytics';
import type { StatsAggregationInput } from '@/src/data/stats';
import type { RecordKind } from '@/src/exercise-calculations/records';
import {
  isInWindow,
  localDaysBetween,
  localPeriodWindow,
  localWeekWindow,
  startOfLocalDay,
  type LocalWindow,
} from '@/src/utils/local-calendar';

export type ProgressCounts = { sessions: number; workingSets: number; prs: number };

/** A completed session and its working sets. */
export type ProgressSession = { id: string; completedAt: Date; workingSets: number };

export type TodayProgressWeek = {
  window: LocalWindow;
  /** Current counts under [[comparison.window]]. */
  current: ProgressCounts;
  /** The whole previous calendar week. */
  previous: ProgressCounts;
};

export type TodayProgressPeriod = {
  /**
   * The fixed period holding today: consecutive N-week periods (N is Settings'
   * Progress period) anchored on Monday 29 Dec 2025, compared with the previous
   * period up to the same day.
   */
  window: LocalWindow;
  weeks: number;
  /** How many periods back the compared period is: 1 is the previous period. */
  compareBack: number;
  /** Today's day of the period: 1 on its first day. */
  dayOfPeriod: number;
  daysInPeriod: number;
  /** Working sets through each day so far: index 0 is the first day, the last is today. */
  cumulativeWorkingSets: number[];
  /** The first day through the end of today. */
  toDate: ProgressCounts;
  /** Linear: working sets so far per elapsed day (today included) over the whole period. */
  projectedWorkingSets: number;
  /** The compared period: the previous one unless Today stepped further back. */
  previous: {
    window: LocalWindow;
    /** Working sets through each day of the whole compared period. */
    cumulativeWorkingSets: number[];
    /** Through the same day of the period. */
    toSameDay: ProgressCounts;
    total: ProgressCounts;
  };
};

/** One PR of a session: an exercise and one record kind it took (`sessionRecordKinds`). */
export type SessionPersonalRecord = {
  kind: RecordKind;
  exerciseName: string;
  /** The session's best 1RM (kg), its top Weight (raw entered kg) or its Volume (kg·reps). */
  value: number;
  /** The top Weight's reps; null for 1RM and Volume. */
  reps: number | null;
};

export type LatestSessionSummary = {
  id: string;
  startedAt: Date;
  completedAt: Date;
  durationSec: number | null;
  gymName: string | null;
  workingSets: number;
  exerciseCount: number;
  /** Its PRs, one per record kind, in exercise then kind order; the count is the length. */
  records: SessionPersonalRecord[];
};

export type TodayProgress =
  | { status: 'empty' }
  | {
      status: 'ready';
      week: TodayProgressWeek;
      period: TodayProgressPeriod;
      /** The latest session, or an older one Today stepped back to. */
      latest: LatestSessionSummary;
      /** How many completed sessions are newer than `latest`: 0 is the latest. */
      latestOffset: number;
      hasOlderSession: boolean;
    };

export type TodayProgressInput = {
  now: Date;
  /** Settings' Progress period, in weeks. */
  periodWeeks: number;
  /** The compared period, in periods back; 1 (the previous period) when absent. */
  compareBack?: number;
  /** Counted sessions (`workingSetsBySession`) covering at least `todayProgressLoadWindow(now, periodWeeks, compareBack)`. */
  sessions: ProgressSession[];
  /** `completed_at` of each PR over the same range: one per record kind (`sessionRecordKinds`). */
  prAchievedAt: Date[];
  /** Null when the user has no completed session. */
  latest: LatestSessionSummary | null;
  latestOffset?: number;
  hasOlderSession?: boolean;
};

/**
 * The one range that covers the compared period through this one, which
 * always holds last week and this week too: a period is whole Monday–Sunday weeks.
 */
export const todayProgressLoadWindow = (now: Date, periodWeeks: number, compareBack = 1): LocalWindow => ({
  start: localPeriodWindow(now, periodWeeks, -compareBack).start,
  end: localPeriodWindow(now, periodWeeks).end,
});

const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string | undefined): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
};

/**
 * Each counted session (`isCountedSession`: at least one working set) with its
 * working sets. A warm-up-only or empty session is not a session here.
 */
export const workingSetsBySession = (input: StatsAggregationInput): ProgressSession[] => {
  const counted = countedMuscleAnalyticsSessionIds(input);
  const exercisesBySession = groupBy(input.sessionExercises, (exercise) => exercise.sessionId);
  const sessionIdByExercise = new Map(input.sessionExercises.map((exercise) => [exercise.id, exercise.sessionId]));
  const setsBySession = groupBy(input.exerciseSets, (set) => sessionIdByExercise.get(set.sessionExerciseId));
  return input.sessions.filter((session) => counted.has(session.id)).map((session) => ({
    id: session.id,
    completedAt: session.completedAt,
    workingSets: countMuscleAnalyticsWorkingSets({
      ...input,
      sessions: [session],
      sessionExercises: exercisesBySession.get(session.id) ?? [],
      exerciseSets: setsBySession.get(session.id) ?? [],
    }),
  }));
};

const countIn = (input: TodayProgressInput, window: LocalWindow): ProgressCounts => {
  const sessions = input.sessions.filter((session) => isInWindow(session.completedAt, window));
  return {
    sessions: sessions.length,
    workingSets: sessions.reduce((total, session) => total + session.workingSets, 0),
    prs: input.prAchievedAt.filter((achievedAt) => isInWindow(achievedAt, window)).length,
  };
};

const cumulativeByDay = (sessions: ProgressSession[], period: LocalWindow, days: number): number[] => {
  const perDay = new Array<number>(days).fill(0);
  for (const session of sessions) {
    if (isInWindow(session.completedAt, period)) perDay[localDaysBetween(period.start, session.completedAt)] += session.workingSets;
  }
  let running = 0;
  return perDay.map((count) => (running += count));
};

const derivePeriod = (input: TodayProgressInput): TodayProgressPeriod => {
  const { now, periodWeeks, compareBack = 1 } = input;
  const window = localPeriodWindow(now, periodWeeks);
  const previousWindow = localPeriodWindow(now, periodWeeks, -compareBack);
  const daysInPeriod = periodWeeks * 7;
  const dayOfPeriod = localDaysBetween(window.start, now) + 1;
  const toDate = countIn(input, { start: window.start, end: startOfLocalDay(now, 1) });
  return {
    window,
    weeks: periodWeeks,
    compareBack,
    dayOfPeriod,
    daysInPeriod,
    cumulativeWorkingSets: cumulativeByDay(input.sessions, window, daysInPeriod).slice(0, dayOfPeriod),
    toDate,
    projectedWorkingSets: Math.round((toDate.workingSets / dayOfPeriod) * daysInPeriod),
    previous: {
      window: previousWindow,
      cumulativeWorkingSets: cumulativeByDay(input.sessions, previousWindow, daysInPeriod),
      toSameDay: countIn(input, { start: previousWindow.start, end: startOfLocalDay(previousWindow.start, dayOfPeriod) }),
      total: countIn(input, previousWindow),
    },
  };
};

export const deriveTodayProgress = (input: TodayProgressInput): TodayProgress => {
  if (input.latest === null) return { status: 'empty' };
  const week = localWeekWindow(input.now);
  return {
    status: 'ready',
    week: {
      window: week,
      current: countIn(input, { start: week.start, end: input.now }),
      previous: countIn(input, localWeekWindow(input.now, -1)),
    },
    period: derivePeriod(input),
    latest: input.latest,
    latestOffset: input.latestOffset ?? 0,
    hasOlderSession: input.hasOlderSession ?? false,
  };
};
