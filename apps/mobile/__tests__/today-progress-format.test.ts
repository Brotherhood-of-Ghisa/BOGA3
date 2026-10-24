/**
 * The Progress card's words and chart geometry (pure). The figures themselves
 * are proven in `progress-summary-*.test.ts`; the screen over real data in
 * `today-screen.test.tsx`. The suite runs in Europe/London (jest.config.js).
 */

import {
  CHART_RIGHT_GUTTER,
  formatSessionSummaryFigures,
  formatPeriodDayLabel,
  formatPeriodRange,
  formatPersonalRecordLead,
  formatSignedCount,
  formatWeekRange,
  sessionSummaryRecordLine,
  sessionSummaryAccessibilityLabel,
  periodChartAccessibilityLabel,
  periodChartAccessibilityValue,
  periodChartGeometry,
  periodDayAtX,
  periodDayFigures,
  periodFiguresAccessibilityLabel,
  todayLabelAnchor,
  toPolyline,
  weekShare,
} from '@/components/today/progress-format';
import type { LatestSessionSummary, ProgressCounts, SessionPersonalRecord, TodayProgressPeriod } from '@/src/progress-summary';
import { localPeriodWindow, localWeekWindow } from '@/src/utils/local-calendar';
import { formatDayMonth } from '@/src/utils/local-time';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);
const counts = (workingSets: number, sessions = 0, prs = 0): ProgressCounts => ({ sessions, workingSets, prs });

// A period as the read shapes it; only the fields a test names matter. Today
// is the last day of `cumulative`.
const period = (overrides: {
  now: Date;
  weeks?: number;
  cumulative: number[];
  previousCumulative?: number[];
  projected?: number;
  toDate?: ProgressCounts;
  toSameDay?: ProgressCounts;
  total?: ProgressCounts;
}): TodayProgressPeriod => {
  const { now, weeks = 4 } = overrides;
  const last = (values: number[]) => values[values.length - 1] ?? 0;
  const previousCumulative = overrides.previousCumulative ?? [];
  return {
    window: localPeriodWindow(now, weeks),
    weeks,
    dayOfPeriod: overrides.cumulative.length,
    daysInPeriod: weeks * 7,
    cumulativeWorkingSets: overrides.cumulative,
    toDate: overrides.toDate ?? counts(last(overrides.cumulative)),
    projectedWorkingSets: overrides.projected ?? 0,
    previous: {
      window: localPeriodWindow(now, weeks, -1),
      cumulativeWorkingSets: previousCumulative,
      toSameDay: overrides.toSameDay ?? counts(0),
      total: overrides.total ?? counts(last(previousCumulative)),
    },
  };
};
const days = (count: number, value: (index: number) => number) => Array.from({ length: count }, (_, index) => value(index));

const BENCH_1RM: SessionPersonalRecord = { kind: 'oneRepMax', exerciseName: 'Bench Press', value: 102.53, reps: null };
const BENCH_WEIGHT: SessionPersonalRecord = { kind: 'weight', exerciseName: 'Bench Press', value: 90, reps: 5 };

const latest = (overrides: Partial<LatestSessionSummary> = {}): LatestSessionSummary => ({
  id: 'session-1',
  startedAt: local(2026, 10, 15, 7, 12),
  completedAt: local(2026, 10, 15, 8, 17),
  durationSec: 3_900,
  gymName: 'Canal Street Gym',
  workingSets: 12,
  exerciseCount: 4,
  records: [BENCH_1RM, BENCH_WEIGHT],
  ...overrides,
});

describe('week labels and bars', () => {
  it('names a week by its Monday and Sunday, and both months when it spans two', () => {
    expect(formatWeekRange(localWeekWindow(local(2026, 10, 16)), 'DD-MM-YYYY')).toBe('12-10-2026 – 18-10-2026');
    expect(formatWeekRange(localWeekWindow(local(2026, 10, 1)), 'DD-MM-YYYY')).toBe('28-09-2026 – 04-10-2026');
  });

  it('fills a bar by this week over last week in laps of last week, empty at zero', () => {
    // Up to last week's total: the first lap.
    expect(weekShare({ current: 0, previous: 3 })).toEqual({ lap: 0, fraction: 0 });
    expect(weekShare({ current: 2, previous: 4 })).toEqual({ lap: 0, fraction: 0.5 });
    expect(weekShare({ current: 3, previous: 3 })).toEqual({ lap: 0, fraction: 1 });
    // 4 to 6 over 3: the second lap.
    expect(weekShare({ current: 4, previous: 3 }).lap).toBe(1);
    expect(weekShare({ current: 4, previous: 3 }).fraction).toBeCloseTo(1 / 3);
    expect(weekShare({ current: 6, previous: 3 })).toEqual({ lap: 1, fraction: 1 });
    // The third lap, then the bar stops full.
    expect(weekShare({ current: 15, previous: 6 })).toEqual({ lap: 2, fraction: 0.5 });
    expect(weekShare({ current: 9, previous: 3 })).toEqual({ lap: 2, fraction: 1 });
    expect(weekShare({ current: 20, previous: 3 })).toEqual({ lap: 2, fraction: 1 });
    // No last week to measure against: any figure has passed it.
    expect(weekShare({ current: 1, previous: 0 })).toEqual({ lap: 1, fraction: 1 });
    expect(weekShare({ current: 0, previous: 0 })).toEqual({ lap: 0, fraction: 0 });
  });
});

describe('the period against the previous period', () => {
  // Friday 23 October 2026: day 19 of the 4-week period 5 Oct – 1 Nov.
  const now = local(2026, 10, 23, 12);

  it('says the difference as a signed absolute count, never a percentage', () => {
    expect(formatSignedCount(4)).toBe('+4');
    expect(formatSignedCount(-3)).toBe('−3');
    expect(formatSignedCount(0)).toBe('0');
  });

  it('compares today with the previous period at the same day', () => {
    const october = period({ now, cumulative: days(19, (index) => index + 84), toSameDay: counts(98) });
    expect(periodDayFigures(october, null)).toEqual({
      dayIndex: 18,
      date: local(2026, 10, 23),
      previousDate: local(2026, 9, 25),
      when: 'today',
      workingSets: 102,
      previousWorkingSets: 98,
      difference: 4,
    });
    expect(formatPeriodDayLabel(periodDayFigures(october, null), 'DD-MM-YYYY')).toBe('Today');
  });

  it('gives a selected past day its counts, and a later day the projection at the same rate', () => {
    const october = period({
      now,
      cumulative: days(19, (index) => (index + 1) * 2),
      previousCumulative: days(28, (index) => index * 3),
      projected: 56,
    });

    const past = periodDayFigures(october, 4);
    expect(past).toMatchObject({ when: 'past', workingSets: 10, previousWorkingSets: 12, difference: -2 });
    expect(formatPeriodDayLabel(past, 'MM-DD-YYYY')).toBe('Oct 9');

    // 38 sets over 19 days: 2 a day, reaching the projection on the last day.
    const projected = periodDayFigures(october, 21);
    expect(projected).toMatchObject({ when: 'projected', workingSets: 44, previousWorkingSets: 63, difference: -19 });
    expect(formatPeriodDayLabel(projected, 'DD-MM-YYYY')).toBe('26 Oct (projected)');
    expect(periodDayFigures(october, 27).workingSets).toBe(october.projectedWorkingSets);

    // A selection outside the period stays on its edge.
    expect(periodDayFigures(october, -3).dayIndex).toBe(0);
    expect(periodDayFigures(october, 40).dayIndex).toBe(27);
  });

  it('names both periods by month and day, Monday to Sunday, without the year', () => {
    const october = period({ now, cumulative: days(19, () => 0) });
    expect(formatPeriodRange(october.window, 'YYYY-MM-DD')).toBe('Oct 5 to Nov 1');
    expect(formatPeriodRange(october.previous.window, 'DD-MM-YYYY')).toBe('7 Sep to 4 Oct');
    expect(formatDayMonth(local(2026, 12, 28), 'MM-DD-YYYY')).toBe('Dec 28');
    expect(formatDayMonth(new Date(Number.NaN), 'DD-MM-YYYY')).toBe('—');
    expect(formatWeekRange(october.window, 'DD-MM-YYYY')).toBe('05-10-2026 – 01-11-2026');
  });

  it('speaks both periods with the selected day as one heading', () => {
    const october = period({ now, cumulative: days(19, () => 18), toSameDay: counts(6) });
    expect(periodFiguresAccessibilityLabel(october, periodDayFigures(october, null), 'YYYY-MM-DD')).toBe(
      '4-week period, Oct 5 to Nov 1: Today 18 sets, against the last period, Sep 7 to Oct 4: 6 sets by Sep 25, +12',
    );
    expect(periodChartAccessibilityValue(periodDayFigures(october, null), 'YYYY-MM-DD')).toBe('Today: 18 sets, last period 6');
  });

  it('speaks the chart as one sentence', () => {
    const october = period({ now, cumulative: days(19, () => 102), projected: 150, toSameDay: counts(98), total: counts(193) });
    expect(periodChartAccessibilityLabel(october)).toBe(
      'Cumulative sets: this period 102 by day 19 of 28 against the last period 98 by day 19; the last period finished at 193. On course for 150.',
    );
  });
});

describe('the period chart geometry', () => {
  const width = 326;
  const plotWidth = width - CHART_RIGHT_GUTTER;
  const now = local(2026, 10, 23, 12);

  it('spans the period across the plot, scales to the highest line and marks each week after the first', () => {
    const geometry = periodChartGeometry(
      period({
        now,
        cumulative: days(19, (index) => (index + 1) * 5),
        previousCumulative: days(28, (index) => (index + 1) * 4),
        projected: 147,
        toSameDay: counts(76),
      }),
      width,
    );

    expect(geometry.plot.width).toBe(plotWidth);
    expect(geometry.current).toHaveLength(19);
    expect(geometry.current[0].x).toBe(0);
    expect(geometry.previous[27].x).toBeCloseTo(plotWidth);
    expect(geometry.weekStartsX.map((x) => x / plotWidth)).toEqual([7 / 27, 14 / 27, 21 / 27].map((share) => expect.closeTo(share, 6)));
    // The projection (147) is the highest figure: it reaches the plot's top at the period's end.
    expect(geometry.projection.to).toEqual({ x: expect.closeTo(plotWidth, 6), y: geometry.plot.top });
    expect(geometry.projection.from).toEqual(geometry.today.current);
    expect(geometry.today.current).toEqual(geometry.current[18]);
    expect(geometry.today.previous).toEqual(geometry.previous[18]);
    // Zero sits on the baseline.
    expect(periodChartGeometry(period({ now, cumulative: [0], previousCumulative: [0] }), width).current[0].y).toBe(
      geometry.plot.bottom,
    );
  });

  it('lets the previous period\'s total top the scale, and draws no week marks for a one-week period', () => {
    const geometry = periodChartGeometry(
      period({ now, weeks: 1, cumulative: days(5, () => 10), previousCumulative: days(7, () => 20), projected: 14, toSameDay: counts(20) }),
      width,
    );
    expect(geometry.previous[0].y).toBe(geometry.plot.top);
    expect(geometry.weekStartsX).toEqual([]);
    expect(geometry.previous[6].x).toBeCloseTo(plotWidth);
  });

  it('fits the plot to a given height, keeping the axis room under it (the cards layout)', () => {
    const input = period({ now, cumulative: [0, 10], previousCumulative: days(28, (index) => index), projected: 20 });
    expect(periodChartGeometry(input, width).plot).toEqual({ width: plotWidth, top: 6, bottom: 108 });
    const tall = periodChartGeometry(input, width, 240);
    expect(tall.plot.bottom).toBe(222);
    expect(tall.current[0].y).toBe(222);
    // Never a plot upside down, however short the space.
    expect(periodChartGeometry(input, width, 10).plot.bottom).toBe(6);
  });

  it('marks the selected day, on the projection after today', () => {
    const october = period({ now, cumulative: days(19, (index) => (index + 1) * 2), previousCumulative: days(28, () => 10), projected: 56, toSameDay: counts(10) });
    const atToday = periodChartGeometry(october, width);
    expect(atToday.selected).toEqual({ current: atToday.today.current, previous: atToday.today.previous, projected: false });

    const later = periodChartGeometry(october, width, undefined, periodDayFigures(october, 27));
    expect(later.selected.projected).toBe(true);
    expect(later.selected.current).toEqual(later.projection.to);
    expect(later.selected.previous).toEqual(later.previous[27]);
  });

  it('picks the day nearest a touch across the plot, within the period', () => {
    expect(periodDayAtX(0, plotWidth, 28)).toBe(0);
    expect(periodDayAtX(plotWidth / 2, plotWidth, 28)).toBe(14);
    expect(periodDayAtX(plotWidth, plotWidth, 28)).toBe(27);
    expect(periodDayAtX(plotWidth + 30, plotWidth, 28)).toBe(27);
    expect(periodDayAtX(-5, plotWidth, 28)).toBe(0);
    expect(periodDayAtX(10, 0, 28)).toBe(0);
    expect(periodDayAtX(10, plotWidth, 1)).toBe(0);
  });

  it('centres TODAY under today, flush with an edge it would overrun', () => {
    expect(todayLabelAnchor(0, plotWidth)).toBe('start');
    expect(todayLabelAnchor(17.9, plotWidth)).toBe('start');
    expect(todayLabelAnchor(18, plotWidth)).toBe('middle');
    expect(todayLabelAnchor(plotWidth - 18, plotWidth)).toBe('middle');
    expect(todayLabelAnchor(plotWidth - 17.9, plotWidth)).toBe('end');
    expect(todayLabelAnchor(plotWidth, plotWidth)).toBe('end');
  });

  it('draws nothing wider than the space it is given, and writes points to one decimal', () => {
    const narrow = periodChartGeometry(period({ now, cumulative: [1, 2] }), 10);
    expect(narrow.plot.width).toBe(0);
    expect(narrow.today.previous.x).toBe(0);
    expect(toPolyline([{ x: 0, y: 80.25 }, { x: 9.731, y: 6 }])).toBe('0.0,80.3 9.7,6.0');
  });
});

describe('the latest session row', () => {
  it('says its figures and its whole summary', () => {
    expect(formatSessionSummaryFigures(latest())).toBe('12 sets · 4 exercises');
    expect(formatSessionSummaryFigures(latest({ exerciseCount: 1 }))).toBe('12 sets · 1 exercise');
    expect(sessionSummaryAccessibilityLabel(latest(), 'DD-MM-YYYY')).toBe(
      'Completed session on 15-10-2026 07:12, 1h 5m, 12 sets, 4 exercises, at Canal Street Gym, 2 PRs',
    );
    expect(sessionSummaryAccessibilityLabel(latest(), 'DD-MM-YYYY')).toBe(
      'Completed session on 15-10-2026 07:12, 1h 5m, 12 sets, 4 exercises, at Canal Street Gym, 2 PRs',
    );
    expect(sessionSummaryAccessibilityLabel(latest(), 'YYYY-MM-DD')).toBe(
      'Completed session on 2026-10-15 07:12, 1h 5m, 12 sets, 4 exercises, at Canal Street Gym, 2 PRs',
    );
  });

  it('leaves out a missing gym and a session without PRs', () => {
    expect(sessionSummaryAccessibilityLabel(latest({ gymName: '  ', records: [], workingSets: 1, exerciseCount: 1 }), 'DD-MM-YYYY')).toBe(
      'Completed session on 15-10-2026 07:12, 1h 5m, 1 set, 1 exercise',
    );
    expect(sessionSummaryAccessibilityLabel(latest({ gymName: null, records: [BENCH_1RM] }), 'DD-MM-YYYY'))
      .toContain('4 exercises, Bench Press 1RM 102.5 · PR');
  });
});

describe("the latest session's PRs", () => {
  it('names each record kind with its figure, without a unit', () => {
    expect(formatPersonalRecordLead(BENCH_1RM)).toBe('Bench Press 1RM 102.5');
    expect(formatPersonalRecordLead(BENCH_WEIGHT)).toBe('Bench Press Weight 90.0 × 5');
    expect(formatPersonalRecordLead({ ...BENCH_WEIGHT, value: 92.5, reps: null })).toBe('Bench Press Weight 92.5');
    expect(formatPersonalRecordLead({ kind: 'volume', exerciseName: ' Deadlift ', value: 4199.6, reps: null }))
      .toBe('Deadlift Volume 4200');
  });

  it('names one PR and only counts several, one per record kind', () => {
    expect(sessionSummaryRecordLine(latest({ records: [] }))).toBeNull();
    expect(sessionSummaryRecordLine(latest({ records: [BENCH_WEIGHT] })))
      .toEqual({ kind: 'one', lead: 'Bench Press Weight 90.0 × 5', note: 'PR' });
    // One exercise taking 1RM and Weight is two PRs.
    expect(sessionSummaryRecordLine(latest())).toEqual({ kind: 'many', count: '2 PRs' });
  });
});
