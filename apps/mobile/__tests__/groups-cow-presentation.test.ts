import { coWAccessibleDates, coWDateRange, coWFigure, coWMetric, coWMetricHeading, coWStatus } from '@/src/groups/cow-presentation';
import { cowResult } from './helpers/cow-fixtures';

it('uses the group calendar key through DST and across viewer zones, with Today paired compact dates', () => {
  expect(coWDateRange('2026-10-26', 'DD-MM-YYYY')).toBe('26 Oct – 1 Nov 2026');
  expect(coWDateRange('2026-10-26', 'MM-DD-YYYY', true)).toBe('Oct 26 – Nov 1 26');
  expect(coWDateRange('2026-12-28', 'DD-MM-YYYY', true)).toBe('28 Dec 26 – 3 Jan 27');
  expect(coWAccessibleDates('2026-10-26', 'YYYY-MM-DD')).toBe('2026-10-26 – 2026-11-01');
});
it.each([
  ['DD-MM-YYYY', '28 Dec 26 – 3 Jan 27', '28 Dec – 3 Jan 2027', '28-12-2026 – 03-01-2027'],
  ['MM-DD-YYYY', 'Dec 28 26 – Jan 3 27', 'Dec 28 – Jan 3 2027', '12-28-2026 – 01-03-2027'],
  ['YYYY-MM-DD', '2026 Dec 28 – 2027 Jan 3', '2027 Dec 28 – Jan 3', '2026-12-28 – 2027-01-03'],
] as const)('%s keeps compact ranges, calendar headings and spoken ranges distinct', (format, compact, heading, spoken) => {
  expect(coWDateRange('2026-12-28', format, true)).toBe(compact);
  expect(coWDateRange('2026-12-28', format)).toBe(heading);
  expect(coWAccessibleDates('2026-12-28', format)).toBe(spoken);
});
it('keeps attained %BW distinct from signed improvement and preserves numeric zero', () => {
  expect(coWMetricHeading({ metric: 'e1rm', unit: 'percent_bw' })).toBe('1RM %BW');
  expect(coWMetricHeading({ metric: 'improvement', unit: 'percent' })).toBe('Improvement %');
  expect(coWMetricHeading({ metric: 'volume', unit: 'percent_bw_reps' })).toBe('Volume %BW·reps');
  expect(coWMetricHeading({ metric: 'volume', unit: 'kg_reps' })).toBe('Volume');
  expect(coWFigure({ value: -5.019 }, { metric: 'improvement', unit: 'percent' })).toBe('−5.0%');
  expect(coWFigure({ value: 20 }, { metric: 'improvement', unit: 'percent' })).toBe('+20.0%');
  expect(coWFigure({ value: -0.001 }, { metric: 'improvement', unit: 'percent' })).toBe('0.0%');
  expect(coWFigure({ value: 120 }, { metric: 'e1rm', unit: 'kg' })).toBe('120.0');
  expect(coWFigure({ value: 1520.4 }, { metric: 'volume', unit: 'kg_reps' })).toBe('1520');
});
it('uses only enabled metrics and never upgrades Finalizing by elapsed time', () => {
  expect(coWMetric('improvement', ['volume', 'e1rm'])).toBe('volume');
  expect(coWMetric('e1rm', ['volume', 'e1rm'])).toBe('e1rm');
  const cow = cowResult().cow;
  for (const [state, label] of [['scheduled','Upcoming'], ['active','Live'], ['finalizing','Finalizing'], ['final','Final'], ['unavailable','Unavailable'], ['cancelled','Cancelled']] as const) {
    expect(coWStatus({ ...cow, state })).toBe(label);
  }
  expect(coWStatus(cow, 'pending')).toBe('Updating');
});
