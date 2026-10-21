/**
 * The Progress card's words and chart geometry (pure). The figures themselves
 * are proven in `progress-summary-*.test.ts`; the screen over real data in
 * `today-screen.test.tsx`. The suite runs in Europe/London (jest.config.js).
 */

import {
  CHART_RIGHT_GUTTER,
  formatSessionSummaryFigures,
  formatPacePhrase,
  formatPersonalRecordLead,
  formatSignedCount,
  formatWeekRange,
  sessionSummaryRecordLine,
  sessionSummaryAccessibilityLabel,
  periodChartAccessibilityLabel,
  periodChartGeometry,
  paceDifference,
  toPolyline,
  weekShare,
} from '@/components/today/progress-format';
import type { LatestSessionSummary, ProgressCounts, SessionPersonalRecord, TodayProgressPeriod } from '@/src/progress-summary';
import { calendarWeekBounds, shiftCalendarWeeks } from '@/src/utils/calendar-weeks';
import { localWeekWindow } from '@/src/utils/local-calendar';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);
const counts = (workingSets: number, sessions = 0, prs = 0): ProgressCounts => ({ sessions, workingSets, prs });

const period = (overrides: {
  cumulative: number[]; previousCumulative: number[]; projected?: number;
  toSameDay?: ProgressCounts; weeks?: number; elapsedDays?: number;
}): TodayProgressPeriod => {
  const weeks = overrides.weeks ?? 3;
  const current = calendarWeekBounds(weeks, local(2026, 10, 16));
  return {
    window: { start: current.start, end: local(2026, 10, 19) }, weeks,
    elapsedDays: overrides.elapsedDays ?? 19, totalDays: weeks * 7,
    cumulativeWorkingSets: overrides.cumulative,
    toDate: counts(overrides.cumulative.at(-1) ?? 0), projectedWorkingSets: overrides.projected ?? 0,
    previous: {
      window: { start: shiftCalendarWeeks(current.start, -weeks), end: current.start }, totalDays: weeks * 7,
      cumulativeWorkingSets: overrides.previousCumulative,
      toSameDay: overrides.toSameDay ?? counts(0), total: counts(overrides.previousCumulative.at(-1) ?? 0),
    },
  };
};

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

describe('the configured progress block', () => {
  it('says a signed count and compares matching elapsed days', () => {
    expect([formatSignedCount(4), formatSignedCount(-3), formatSignedCount(0)]).toEqual(['+4', '−3', '±0']);
    for (const [value, relation] of [[102, 'ahead of'], [90, 'behind'], [98, 'level with']] as const) {
      const data = period({ cumulative: [value], previousCumulative: [193], toSameDay: counts(98) });
      expect(paceDifference(data)).toBe(value - 98);
      expect(formatPacePhrase(data)).toBe(`${relation} the previous 3 weeks`);
    }
    expect(formatPacePhrase(period({ weeks: 1, cumulative: [1], previousCumulative: [] }))).toBe('ahead of the previous week');
  });

  it('speaks the configured weeks and elapsed day rather than a calendar month', () => {
    const data = period({ cumulative: [102], previousCumulative: [193], projected: 198, toSameDay: counts(98) });
    expect(periodChartAccessibilityLabel(data)).toBe(
      'Cumulative sets: 3 weeks, 102 by day 19 against 98 by day 19 in the preceding block; The preceding block finished at 193. On course for 198.');
  });
});

describe('the progress chart geometry', () => {
  const width = 326;
  const plotWidth = width - CHART_RIGHT_GUTTER;
  it('uses equal week blocks and scales to the highest line', () => {
    const geometry = periodChartGeometry(period({ cumulative: Array.from({ length: 19 }, (_, i) => (i + 1) * 5),
      previousCumulative: Array.from({ length: 21 }, (_, i) => (i + 1) * 4), projected: 155 }), width);
    expect(geometry.plot.width).toBe(plotWidth);
    expect(geometry.current).toHaveLength(19);
    expect(geometry.current[0].x).toBe(0);
    expect(geometry.periodEndX).toBeCloseTo(plotWidth);
    expect(geometry.previous[20].x).toBeCloseTo(plotWidth);
    // PREV plus its six-point offset must fit inside the SVG viewport.
    expect(width - geometry.previous[20].x).toBeGreaterThanOrEqual(40);
    expect(geometry.projection.to).toEqual({ x: geometry.periodEndX, y: geometry.plot.top });
    expect(geometry.today.current).toEqual(geometry.current[18]);
    expect(geometry.today.previous).toEqual(geometry.previous[18]);
  });
  it('keeps zero data and missing daily arrays on the baseline', () => {
    const geometry = periodChartGeometry(period({ cumulative: [0], previousCumulative: [], projected: 0 }), width);
    expect(geometry.current[0].y).toBe(geometry.plot.bottom);
    expect(geometry.today.previous.y).toBe(geometry.plot.bottom);
  });
  it('bounds narrow charts and formats coordinates', () => {
    const geometry = periodChartGeometry(period({ cumulative: [1, 2], previousCumulative: [] }), 10);
    expect(geometry.plot.width).toBe(0);
    expect(geometry.today.previous.x).toBe(0);
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
