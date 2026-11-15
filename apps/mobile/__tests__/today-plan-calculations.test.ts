/**
 * Today's Plan page, derived ([[comparison.allowed-periods]]): the window, the recovery rows and their order, the week's days and the next
 * planned sessions. Pure; the suite runs in Europe/London (jest.config.js).
 */

import type { MuscleDailySets } from '@/src/data';
import {
  derivePlanWeek,
  deriveRecoveryRows,
  groupRecoveryRows,
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

  it('puts muscles under their target first, then the fewest sets this week, then the fewest recent, then muscle order', () => {
    const rows = deriveRecoveryRows(daily, window, TARGETS);
    // Under 8: calves 1.5 · biceps 6. At or over: quads 9 · chest 14 and back 14 (recent 4 each) by order.
    expect(rows.map((row) => row.muscleGroupId)).toEqual(['calves', 'biceps', 'quads', 'chest', 'back']);
  });

  it('judges each muscle against its own target', () => {
    // Chest's 14 is under its 20; quads' 9 is over the default 8.
    const rows = deriveRecoveryRows(daily, window, { weeklyTarget: 8, overrides: { chest: 20 } });
    expect(rows.map((row) => row.muscleGroupId)).toEqual(['calves', 'biceps', 'chest', 'quads', 'back']);
  });

  it('counts a muscle at exactly its target as reached', () => {
    // Biceps' 6 meets its 6, so it follows chest's 14 of 20.
    const rows = deriveRecoveryRows(daily, window, { weeklyTarget: 8, overrides: { biceps: 6, chest: 20 } });
    expect(rows.map((row) => row.muscleGroupId)).toEqual(['calves', 'chest', 'biceps', 'quads', 'back']);
  });

  it('breaks a tie in weekly sets by the fewest over the recovery days', () => {
    // Both 6 this week: biceps' all on Tuesday, triceps' on Friday, a recovery day.
    const rows = deriveRecoveryRows({
      muscles: [muscle('triceps', 1), muscle('biceps', 2)],
      sets: { triceps: { '2026-10-30': 6 }, biceps: { '2026-10-27': 6 } },
      sessionDays: [],
    }, window, TARGETS);
    expect(rows.map((row) => row.muscleGroupId)).toEqual(['biceps', 'triceps']);
  });

  it('shows an untrained muscle with every day blank', () => {
    const rows = deriveRecoveryRows({ muscles: [muscle('core', 9)], sets: {}, sessionDays: [] }, window, TARGETS);
    expect(rows).toEqual([{ muscleGroupId: 'core', name: 'Core', familyName: 'F', days: [null, null, null], today: null, weekSets: 0, target: 8 }]);
  });

  it("carries today's sets so far in their own column and counts them toward the order", () => {
    // Today's 20 calves sets take it past its target, so it moves to the end.
    const withToday = { ...daily, sets: { ...daily.sets, calves: { ...daily.sets.calves, '2026-10-31': 20 } } };
    const rows = deriveRecoveryRows(withToday, window, TARGETS);
    expect(rows.map((row) => row.muscleGroupId)).toEqual(['biceps', 'quads', 'chest', 'back', 'calves']);
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

it('groups using reported family names, retaining child recovery order, unrounded sums, and known zero', () => {
  const daily: MuscleDailySets = {
    muscles: [
      { ...muscle('a', 1), familyName: 'My custom family' },
      { ...muscle('b', 2), familyName: 'Other' },
      { ...muscle('c', 3), familyName: 'My custom family' },
    ],
    sets: { a: { '2026-10-30': 1.5 }, c: { '2026-10-30': 1.5 } }, sessionDays: [],
  };
  const rows = deriveRecoveryRows(daily, window, TARGETS);
  expect(groupRecoveryRows(rows)).toEqual([
    { name: 'Other', muscles: [rows[0]], days: [0, 0, 0], today: 0, weekSets: 0 },
    { name: 'My custom family', muscles: [rows[1], rows[2]], days: [0, 0, 3], today: 0, weekSets: 3 },
  ]);
  expect(groupRecoveryRows([])).toEqual([]);
});

it('keeps family daily, today and weekly sums separate, including fractional and absent contributions', () => {
  const window = todayPlanWindow(local(2026, 11, 10, 15));
  const rows = deriveRecoveryRows({
    muscles: [muscle('a', 1), muscle('b', 2)],
    sets: {
      a: { '2026-11-07': 1.5, '2026-11-09': 0.5, '2026-11-10': 2 },
      b: { '2026-11-07': 1.5, '2026-11-09': 0.5, '2026-11-10': 0.5 },
    },
    sessionDays: [],
  }, window, TARGETS);
  expect(groupRecoveryRows(rows)).toEqual([
    { name: 'F', muscles: rows, days: [3, 0, 1], today: 2.5, weekSets: 3.5 },
  ]);
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
