// Today's Plan page, derived: each muscle's sets over the last three days and
// this week, the week's trained and planned days, and the next planned
// sessions. Pure — the repository reads, this decides. The three days are a
// fixed period of their own ([[comparison.allowed-periods]]); the week is
// [[comparison.window]]'s.

import type { MuscleDailySets } from '@/src/data/muscle-daily-sets';
import { localDateKey } from '@/src/utils/calendar-weeks';
import { localWeekWindow, startOfLocalDay, type LocalWindow } from '@/src/utils/local-calendar';

/** The days before today a muscle's recent sets cover. */
export const RECOVERY_DAYS = 3;
/** The most planned sessions the page lists. */
export const NEXT_PLANNED_LIMIT = 3;

export type TodayPlanWindow = {
  /** The last three local days before today, oldest first (each its 00:00). */
  recoveryDays: Date[];
  /** This calendar week ([[comparison.window]]). */
  week: LocalWindow;
  /** Today's 00:00. */
  today: Date;
  /** What the read covers: the recovery days and this week, until tomorrow's 00:00. */
  read: LocalWindow;
};

export const todayPlanWindow = (now: Date): TodayPlanWindow => {
  const today = startOfLocalDay(now);
  const recoveryDays = Array.from({ length: RECOVERY_DAYS }, (_, index) => startOfLocalDay(now, index - RECOVERY_DAYS));
  const week = localWeekWindow(now);
  const start = recoveryDays[0] < week.start ? recoveryDays[0] : week.start;
  return { recoveryDays, week, today, read: { start, end: startOfLocalDay(now, 1) } };
};

export type RecoveryRow = {
  muscleGroupId: string;
  name: string;
  /** Sets on each recovery day, oldest first; null for a day without any. */
  days: (number | null)[];
  /** Sets this calendar week, today included. */
  weekSets: number;
};

const sumDays = (byDay: Record<string, number>, keys: string[]) => keys.reduce((total, key) => total + (byDay[key] ?? 0), 0);

/**
 * One row per muscle, least trained over the recovery days first, then fewest
 * sets this week, then the muscles' own order.
 */
export const deriveRecoveryRows = (daily: MuscleDailySets, window: TodayPlanWindow): RecoveryRow[] => {
  const recoveryKeys = window.recoveryDays.map(localDateKey);
  const weekStartKey = localDateKey(window.week.start);
  const rows = daily.muscles.map((muscle, order) => {
    const byDay = daily.sets[muscle.id] ?? {};
    const weekKeys = Object.keys(byDay).filter((key) => key >= weekStartKey);
    return {
      order,
      recent: sumDays(byDay, recoveryKeys),
      row: {
        muscleGroupId: muscle.id,
        name: muscle.displayName,
        days: recoveryKeys.map((key) => byDay[key] ?? null),
        weekSets: sumDays(byDay, weekKeys),
      },
    };
  });
  rows.sort((left, right) => left.recent - right.recent || left.row.weekSets - right.row.weekSets || left.order - right.order);
  return rows.map(({ row }) => row);
};

/** A plan as the page reads it: its schedule, figures and muscles. */
export type PlannedSessionInput = {
  planId: string;
  title: string;
  scheduledFor: Date;
  completed: boolean;
};

export type PlanWeekDay = {
  date: Date;
  isToday: boolean;
  /** A counted session finished that day. */
  trained: boolean;
  /** Today or later, with a plan still to do. */
  planned: boolean;
};

/**
 * The plans still to do from today's 00:00 to the end of the week, soonest
 * first; one earlier this week that was never done is left out.
 */
export const selectNextPlans = <P extends PlannedSessionInput>(plans: P[], window: TodayPlanWindow): P[] =>
  plans
    .filter((plan) => !plan.completed && plan.scheduledFor >= window.today && plan.scheduledFor < window.week.end)
    .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime());

export const derivePlanWeek = (
  window: TodayPlanWindow, sessionDays: string[], plans: PlannedSessionInput[],
): PlanWeekDay[] => {
  const trained = new Set(sessionDays);
  const planned = new Set(selectNextPlans(plans, window).map((plan) => localDateKey(plan.scheduledFor)));
  const todayKey = localDateKey(window.today);
  return Array.from({ length: 7 }, (_, index) => {
    const date = startOfLocalDay(window.week.start, index);
    const key = localDateKey(date);
    return { date, isToday: key === todayKey, trained: trained.has(key), planned: planned.has(key) };
  });
};
