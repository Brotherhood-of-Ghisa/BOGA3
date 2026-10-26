/**
 * Today's Plan page, derived ([[comparison.allowed-periods]]): the window, the recovery rows and their order, the week's days and the next
 * planned sessions. Pure; the suite runs in Europe/London (jest.config.js).
 */

import type { MuscleDailySets } from '@/src/data';
import {
  derivePlanWeek,
  deriveRecoveryRows,
  selectNextPlans,
  todayPlanWindow,
  type PlannedSessionInput,
} from '@/src/today-plan';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);

// Saturday 31 Oct 2026, 15:00: the week is Mon 26 Oct – Sun 1 Nov, the recovery days Wed 28 – Fri 30.
const NOW = local(2026, 10, 31, 15);
const window = todayPlanWindow(NOW);

const TARGETS = { weeklyTarget: 8, overrides: {} };

const muscle = (id: string, sortOrder: number) => ({ id, displayName: id[0].toUpperCase() + id.slice(1), familyName: 'F', sortOrder });

describe('todayPlanWindow', () => {
  it('covers the three days before today, this calendar week and today', () => {
    expect(window.recoveryDays).toEqual([local(2026, 10, 28), local(2026, 10, 29), local(2026, 10, 30)]);
    expect(window.week).toEqual({ start: local(2026, 10, 26), end: local(2026, 11, 2) });
    expect(window.today).toEqual(local(2026, 10, 31));
    expect(window.read).toEqual({ start: local(2026, 10, 26), end: local(2026, 11, 1) });
  });

  it('reads back into last week when the recovery days start before Monday', () => {
    const monday = todayPlanWindow(local(2026, 10, 26, 9));
    expect(monday.recoveryDays).toEqual([local(2026, 10, 23), local(2026, 10, 24), local(2026, 10, 25)]);
    expect(monday.read).toEqual({ start: local(2026, 10, 23), end: local(2026, 10, 27) });
  });

  it('keeps local midnights across the clocks going back (25 Oct 2026)', () => {
    const tuesday = todayPlanWindow(local(2026, 10, 27, 8));
    expect(tuesday.recoveryDays.map((day) => day.getHours())).toEqual([0, 0, 0]);
    expect(tuesday.recoveryDays.map((day) => day.getDate())).toEqual([24, 25, 26]);
  });
});

describe('deriveRecoveryRows', () => {
  const daily: MuscleDailySets = {
    muscles: [muscle('chest', 1), muscle('back', 2), muscle('biceps', 3), muscle('quads', 4), muscle('calves', 5)],
    sets: {
      // Monday's chest is this week, not a recovery day.
      chest: { '2026-10-26': 10, '2026-10-30': 4 },
      back: { '2026-10-27': 10, '2026-10-30': 4 },
      biceps: { '2026-10-27': 6 },
      quads: { '2026-10-29': 9 },
      // Last Sunday is outside both.
      calves: { '2026-10-25': 3, '2026-10-29': 1.5 },
    },
    sessionDays: [],
  };

  it('fills the recovery days oldest first, blank where a muscle got no sets', () => {
    const rows = deriveRecoveryRows(daily, window, TARGETS);
    expect(rows.find((row) => row.muscleGroupId === 'quads')?.days).toEqual([null, 9, null]);
    expect(rows.find((row) => row.muscleGroupId === 'biceps')?.days).toEqual([null, null, null]);
  });

  it("counts this week's sets, today included, and never last week's", () => {
    const withToday = { ...daily, sets: { ...daily.sets, calves: { ...daily.sets.calves, '2026-10-31': 2 } } };
    const rows = deriveRecoveryRows(withToday, window, TARGETS);
    expect(rows.find((row) => row.muscleGroupId === 'calves')?.weekSets).toBe(3.5);
    expect(rows.find((row) => row.muscleGroupId === 'chest')?.weekSets).toBe(14);
  });

  it('puts the least trained over the recovery days first, then the fewest this week, then muscle order', () => {
    const rows = deriveRecoveryRows(daily, window, TARGETS);
    // biceps 0 (week 6) · calves 1.5 · chest 4 (week 14) and back 4 (week 14) by order · quads 9.
    expect(rows.map((row) => row.muscleGroupId)).toEqual(['biceps', 'calves', 'chest', 'back', 'quads']);
  });

  it('shows an untrained muscle with every day blank', () => {
    const rows = deriveRecoveryRows({ muscles: [muscle('core', 9)], sets: {}, sessionDays: [] }, window, TARGETS);
    expect(rows).toEqual([{ muscleGroupId: 'core', name: 'Core', days: [null, null, null], today: null, weekSets: 0, target: 8 }]);
  });

  it("carries today's sets so far in their own column, outside the order", () => {
    // Today's 20 calves sets would make it the most trained; it stays second.
    const withToday = { ...daily, sets: { ...daily.sets, calves: { ...daily.sets.calves, '2026-10-31': 20 } } };
    const rows = deriveRecoveryRows(withToday, window, TARGETS);
    expect(rows.map((row) => row.muscleGroupId)).toEqual(['biceps', 'calves', 'chest', 'back', 'quads']);
    expect(rows.find((row) => row.muscleGroupId === 'calves')?.today).toBe(20);
    expect(rows.find((row) => row.muscleGroupId === 'calves')?.days).toEqual([null, 1.5, null]);
    expect(rows.find((row) => row.muscleGroupId === 'chest')?.today).toBeNull();
  });

  it("takes a muscle's own target where one is set, else the default", () => {
    const rows = deriveRecoveryRows(daily, window, { weeklyTarget: 8, overrides: { chest: 12 } });
    expect(rows.find((row) => row.muscleGroupId === 'chest')?.target).toBe(12);
    expect(rows.find((row) => row.muscleGroupId === 'back')?.target).toBe(8);
  });
});

describe('the next planned sessions and the week', () => {
  const plan = (planId: string, scheduledFor: Date, completed = false): PlannedSessionInput => ({ planId, title: planId, scheduledFor, completed });
  const plans = [
    plan('sun', local(2026, 11, 1, 10)),
    plan('missed-thu', local(2026, 10, 29, 18)),
    plan('this-morning', local(2026, 10, 31, 7)),
    plan('done-sat', local(2026, 10, 31, 9), true),
    plan('next-week', local(2026, 11, 2, 7)),
  ];

  it("lists the plans still to do from today's 00:00 to the end of the week, soonest first", () => {
    expect(selectNextPlans(plans, window).map((row) => row.planId)).toEqual(['this-morning', 'sun']);
  });

  it('marks trained days and the days still planned, Monday first', () => {
    const week = derivePlanWeek(window, ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-31'], plans);
    expect(week.map((day) => day.date.getDate())).toEqual([26, 27, 28, 29, 30, 31, 1]);
    expect(week.map((day) => day.trained)).toEqual([true, true, false, false, false, true, false]);
    // A missed plan earlier in the week is no longer planned.
    expect(week.map((day) => day.planned)).toEqual([false, false, false, false, false, true, true]);
    expect(week.map((day) => day.isToday)).toEqual([false, false, false, false, false, true, false]);
  });
});
