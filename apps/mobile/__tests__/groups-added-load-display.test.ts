import { formatCompetitionValue, formatCompetitionHistoricalValue, competitionDisplayValue } from '@/src/groups/competition-view-model';
import { isCompetitionBoardWire } from '@/src/groups/competition-wire-guards';
import { isCompetitionEventWire } from '@/src/groups/competition-reader-guards';
import { isNormalizedSetMetrics } from '@/src/groups/competition-set-display';
import { coWRowFigure } from '@/src/groups/cow-presentation';
import { buildSessionRecordRows } from '@/src/groups/competition-session-records-view-model';
import { isCoWResultWire } from '@/src/groups/cow-wire';
import { competitionBoard, competitionRow, competitionEvent } from './helpers/competition-fixtures';
import { cowResult } from './helpers/cow-fixtures';

test.each([0, 28.3, 123.456])('a positive ranked score displays added %s without changing its rank or score', added => {
  const row = { ...competitionRow, added_e1rm_percent_bw: added };
  expect(isCompetitionBoardWire({ ...competitionBoard, entries: [row] })).toBe(true);
  expect(formatCompetitionValue(row)).toBe(`${added.toFixed(1)} %BW`);
  expect(row.value).toBe(competitionRow.value);
  expect(row.rank).toBe(1);
});

test.each([undefined, null])('missing added projection %p never falls back to the total percentage', added => {
  expect(formatCompetitionValue({ ...competitionRow, added_e1rm_percent_bw: added })).toBe('Score unavailable');
});

test('a displayed added zero never makes an otherwise invalid total score eligible', () => {
  const row = { ...competitionRow, value: 0, added_e1rm_percent_bw: 0 };
  expect(isCompetitionBoardWire({ ...competitionBoard, entries: [row] })).toBe(false);
  expect(formatCompetitionValue(row)).toBe('Score unavailable');
});

test('the shared-session records card uses the same added 1RM projection as its board and Stream', () => {
  const rows = buildSessionRecordRows({ records: [{ event: competitionEvent,
    boards: [{ metric: 'e1rm', leader: competitionRow.member, leads: true }] }],
    places: new Map(), groupId: 'g1', userId: 'me' });
  expect(rows[0].value).toBe('45.7 %BW');
});

test('history displays its supplied original projection without requiring current rule context', () => {
  const value = { ...competitionEvent.values[0], value: 98.3, added_e1rm_percent_bw: 28.3 };
  const event = { ...competitionEvent, values: [value], record_context: null };
  expect(isCompetitionEventWire(event)).toBe(true);
  expect(formatCompetitionHistoricalValue(value)).toBe('1RM 28.3 %BW');
  expect(formatCompetitionHistoricalValue({ ...value, unavailable: true, value: null })).toBe('Score unavailable');
});

test.each([-1, Infinity, NaN, '28.3'])('closed readers reject malformed added projection %p', added => {
  expect(isCompetitionBoardWire({ ...competitionBoard, entries: [{ ...competitionRow, added_e1rm_percent_bw: added }] })).toBe(false);
  expect(isCompetitionEventWire({ ...competitionEvent, values: [{ ...competitionEvent.values[0], added_e1rm_percent_bw: added }] })).toBe(false);
  expect(isNormalizedSetMetrics({ added_load_percent_bw: 0, e1rm_percent_bw: 100,
    volume_percent_bw_reps: 100, added_e1rm_percent_bw: added })).toBe(false);
});

test('legacy shapes remain accepted and added fields cannot cross into ordinary or Volume values', () => {
  const { added_e1rm_percent_bw: _added, ...legacy } = competitionRow;
  expect(isCompetitionBoardWire({ ...competitionBoard, entries: [legacy] })).toBe(true);
  expect(isCompetitionBoardWire({ ...competitionBoard, metric: 'volume', entries: [{ ...competitionRow,
    metric: 'volume', unit: 'percent_bw_reps' }] })).toBe(false);
  expect(competitionDisplayValue({ metric: 'volume', unit: 'percent_bw_reps', value: 625 })).toBe(625);
  expect(competitionDisplayValue({ metric: 'weight', unit: 'percent_bw', value: 25 })).toBe(25);
});

test('CoW uses the frozen public added projection, with unchanged Volume and improvement', () => {
  const result = cowResult();
  result.exercise = { ...result.exercise!, rules: { ...result.exercise!.rules, bodyweight_contribution: 0.7 } };
  const ranking = result.rankings[0];
  const row = { ...ranking.entries[0], value: 100, added_e1rm_percent_bw: 0 };
  ranking.entries = [row];
  expect(isCoWResultWire(result)).toBe(true);
  expect(coWRowFigure(row, ranking)).toBe('0.0');
  expect(coWRowFigure({ ...row, added_e1rm_percent_bw: null }, ranking)).toBe('Unavailable');
  expect(coWRowFigure({ ...row, value: 625 }, { metric: 'volume', unit: 'percent_bw_reps' })).toBe('625');
  expect(coWRowFigure({ ...row, value: 5 }, { metric: 'improvement', unit: 'percent' })).toBe('+5.0%');
});
