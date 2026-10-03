// Today's progress figures (pure). Every window places a session, its working
// sets and its PRs by the session's `completed_at`, the stamp both the stats
// aggregation and the exercise session facts use.

import { countedMuscleAnalyticsSessionIds, countMuscleAnalyticsWorkingSets } from '@/src/data/muscle-analytics';
import type { StatsAggregationInput } from '@/src/data/stats';
import {
  daysInLocalMonth,
  isInWindow,
  localMonthWindow,
  localWeekWindow,
  startOfLocalDay,
  type LocalWindow,
} from '@/src/utils/local-calendar';

export type ProgressCounts = { sessions: number; workingSets: number; prs: number };

/** A completed session and its working sets. */
export type ProgressSession = { id: string; completedAt: Date; workingSets: number };

export type TodayProgressWeek = {
  window: LocalWindow;
  /** Monday through the end of today, like the month's `toDate`. */
  current: ProgressCounts;
  /** The whole previous calendar week. */
  previous: ProgressCounts;
};

export type TodayProgressMonth = {
  window: LocalWindow;
  dayOfMonth: number;
  daysInMonth: number;
  /** Working sets through each day so far: index 0 is the 1st, the last is today. */
  cumulativeWorkingSets: number[];
  /** The 1st through the end of today. */
  toDate: ProgressCounts;
  /** Linear: working sets so far per elapsed day (today included) over the whole month. */
  projectedWorkingSets: number;
  previous: {
    window: LocalWindow;
    daysInMonth: number;
    /** Working sets through each day of the whole previous month. */
    cumulativeWorkingSets: number[];
    /** Through the same day of month, or its last day when the month is shorter. */
    toSameDay: ProgressCounts;
    total: ProgressCounts;
  };
};

export type LatestSessionSummary = {
  id: string;
  startedAt: Date;
  completedAt: Date;
  durationSec: number | null;
  gymName: string | null;
  workingSets: number;
  exerciseCount: number;
  /** Every exercise in session order; the card ellipsises. */
  exerciseNames: string[];
  prs: number;
};

export type TodayProgress =
  | { status: 'empty' }
  | {
      status: 'ready';
      week: TodayProgressWeek;
      month: TodayProgressMonth;
      latest: LatestSessionSummary;
    };

export type TodayProgressInput = {
  now: Date;
  /** Counted sessions (`workingSetsBySession`) covering at least `todayProgressLoadWindow(now)`. */
  sessions: ProgressSession[];
  /** `completed_at` of each 1RM PR fact over the same range. */
  prAchievedAt: Date[];
  /** Null when the user has no completed session. */
  latest: LatestSessionSummary | null;
};

/** The one range that covers last week, this week, last month and this month. */
export const todayProgressLoadWindow = (now: Date): LocalWindow => {
  const windows = [localWeekWindow(now, -1), localWeekWindow(now), localMonthWindow(now, -1), localMonthWindow(now)];
  return {
    start: new Date(Math.min(...windows.map((window) => window.start.getTime()))),
    end: new Date(Math.max(...windows.map((window) => window.end.getTime()))),
  };
};

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

const cumulativeByDay = (sessions: ProgressSession[], month: LocalWindow, days: number): number[] => {
  const perDay = new Array<number>(days).fill(0);
  for (const session of sessions) {
    if (isInWindow(session.completedAt, month)) perDay[session.completedAt.getDate() - 1] += session.workingSets;
  }
  let running = 0;
  return perDay.map((count) => (running += count));
};

const deriveMonth = (input: TodayProgressInput): TodayProgressMonth => {
  const { now } = input;
  const window = localMonthWindow(now);
  const previousWindow = localMonthWindow(now, -1);
  const dayOfMonth = now.getDate();
  const daysInMonth = daysInLocalMonth(window.start);
  const previousDays = daysInLocalMonth(previousWindow.start);
  const sameDay = Math.min(dayOfMonth, previousDays);
  const toDate = countIn(input, { start: window.start, end: startOfLocalDay(now, 1) });
  return {
    window,
    dayOfMonth,
    daysInMonth,
    cumulativeWorkingSets: cumulativeByDay(input.sessions, window, daysInMonth).slice(0, dayOfMonth),
    toDate,
    projectedWorkingSets: Math.round((toDate.workingSets / dayOfMonth) * daysInMonth),
    previous: {
      window: previousWindow,
      daysInMonth: previousDays,
      cumulativeWorkingSets: cumulativeByDay(input.sessions, previousWindow, previousDays),
      toSameDay: countIn(input, { start: previousWindow.start, end: startOfLocalDay(previousWindow.start, sameDay) }),
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
      current: countIn(input, { start: week.start, end: startOfLocalDay(input.now, 1) }),
      previous: countIn(input, localWeekWindow(input.now, -1)),
    },
    month: deriveMonth(input),
    latest: input.latest,
  };
};
