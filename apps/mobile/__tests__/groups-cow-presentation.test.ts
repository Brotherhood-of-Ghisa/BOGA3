import { coWAccessibleDates, coWDateRange, coWFigure, coWMetric, coWMetricHeading, coWStatus } from '@/src/groups/cow-presentation';
import { cowResult } from './helpers/cow-fixtures';

it('uses the group calendar key through DST and across viewer zones, with Today fixed date copy', () => {
  expect(coWDateRange('2026-10-26', 'DD-MM-YYYY')).toBe('26 Oct – 1 Nov 2026');
  expect(coWDateRange('2026-10-26', 'MM-DD-YYYY', true)).toBe('26 Oct – 1 Nov 26');
  expect(coWDateRange('2026-12-28', 'DD-MM-YYYY', true)).toBe('28 Dec 26 – 3 Jan 27');
  expect(coWAccessibleDates('2026-10-26', 'YYYY-MM-DD')).toBe('2026-10-26 – 2026-11-01');
});
it('keeps attained %BW distinct from signed improvement and preserves numeric zero', () => {
  expect(coWMetricHeading({ metric: 'e1rm', unit: 'percent_bw' })).toBe('1RM %BW');
  expect(coWMetricHeading({ metric: 'improvement', unit: 'percent' })).toBe('Improvement %');
  expect(coWMetricHeading({ metric: 'volume', unit: 'percent_bw_reps' })).toBe('Volume %BW·reps');
  expect(coWMetricHeading({ metric: 'volume', unit: 'kg_reps' })).toBe('Volume');
  expect(coWFigure(-5.019, 'improvement')).toBe('−5.0%');
  expect(coWFigure(20, 'improvement')).toBe('+20.0%');
  expect(coWFigure(-0.001, 'improvement')).toBe('0.0%');
  expect(coWFigure(120, 'e1rm')).toBe('120.0');
  expect(coWFigure(1520.4, 'volume')).toBe('1520');
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
