// Today's progress figures (pure). Every window places a session, its working
// sets and its PRs by the session's `completed_at`, the stamp both the stats
// aggregation and the exercise session facts use.

import { countedMuscleAnalyticsSessionIds, countMuscleAnalyticsWorkingSets } from '@/src/data/muscle-analytics';
import { progressComparisonWindows, type StatsAggregationInput } from '@/src/data/stats';
import type { RecordKind } from '@/src/exercise-calculations/records';
import {
  isInWindow,
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
  window: LocalWindow;
  weeks: number;
  elapsedDays: number;
  totalDays: number;
  /** Working sets through each day so far: index 0 is the first Monday, the last is today. */
  cumulativeWorkingSets: number[];
  /** The configured block through now. */
  toDate: ProgressCounts;
  /** Linear: working sets so far per elapsed day (today included) over the whole period. */
  projectedWorkingSets: number;
  previous: {
    window: LocalWindow;
    totalDays: number;
    /** Working sets through each day of the whole previous period. */
    cumulativeWorkingSets: number[];
    /** Through the same elapsed calendar day of the preceding block. */
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
      latest: LatestSessionSummary;
    };

export type TodayProgressInput = {
  now: Date;
  progressWeeks: number;
  /** Counted sessions (`workingSetsBySession`) covering at least `todayProgressLoadWindow(now, progressWeeks)`. */
  sessions: ProgressSession[];
  /** `completed_at` of each PR over the same range: one per record kind (`sessionRecordKinds`). */
  prAchievedAt: Date[];
  /** Null when the user has no completed session. */
  latest: LatestSessionSummary | null;
};

/** Both configured progress blocks also cover this week and the previous week. */
export const todayProgressLoadWindow = (now: Date, weeks: number): LocalWindow => ({
  start: progressComparisonWindows(weeks, now).previous.start,
  end: now,
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

// Calendar-day indices ignore the hour lost or gained at a DST transition.
const calendarDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;

const cumulativeByDay = (sessions: ProgressSession[], window: LocalWindow, days: number): number[] => {
  const perDay = new Array<number>(days).fill(0);
  for (const session of sessions) {
    if (isInWindow(session.completedAt, window)) {
      const index = calendarDay(session.completedAt) - calendarDay(window.start);
      perDay[index] += session.workingSets;
    }
  }
  let running = 0;
  return perDay.map((count) => (running += count));
};

const derivePeriod = (input: TodayProgressInput): TodayProgressPeriod => {
  const { now } = input;
  const weeks = input.progressWeeks;
  const windows = progressComparisonWindows(weeks, now);
  const window = { start: windows.current.start, end: localWeekWindow(now).end };
  const previousWindow = windows.previous;
  const elapsedDays = calendarDay(now) - calendarDay(window.start) + 1;
  const totalDays = weeks * 7;
  const toDate = countIn(input, windows.current);
  return {
    window, weeks, elapsedDays, totalDays,
    cumulativeWorkingSets: cumulativeByDay(input.sessions, windows.current, totalDays).slice(0, elapsedDays),
    toDate,
    projectedWorkingSets: Math.round((toDate.workingSets / elapsedDays) * totalDays),
    previous: {
      window: previousWindow,
      totalDays,
      cumulativeWorkingSets: cumulativeByDay(input.sessions, previousWindow, totalDays),
      toSameDay: countIn(input, { start: previousWindow.start, end: startOfLocalDay(previousWindow.start, elapsedDays) }),
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
  };
};
