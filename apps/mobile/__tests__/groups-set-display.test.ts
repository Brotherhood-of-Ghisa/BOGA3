import { isNormalizedSetMetrics } from '@/src/groups/competition-set-display';
import { isCompetitionPerformanceWire } from '@/src/groups/competition-wire-guards';
import { isCompetitionSessionDetailWire } from '@/src/groups/competition-reader-guards';
import { competitionRow, competitionSession } from './helpers/competition-fixtures';

const metrics = { added_load_percent_bw: 25, e1rm_percent_bw: 145.7, volume_percent_bw_reps: 625 };
const sessionWith = (value: unknown) => ({ ...competitionSession, session: { ...competitionSession.session,
  exercises: competitionSession.session.exercises.map(exercise => ({ ...exercise,
    sets: exercise.sets.map(set => ({ ...set, normalized_metrics: value })) })) } });

test.each([null, metrics, { ...metrics, added_load_percent_bw: 0 },
  { ...metrics, e1rm_percent_bw: null, volume_percent_bw_reps: null }])('accepts only safe normalized display shapes: %p', value => {
  expect(isNormalizedSetMetrics(value)).toBe(true);
  expect(isCompetitionSessionDetailWire(sessionWith(value))).toBe(true);
  expect(isCompetitionPerformanceWire({ ...competitionRow.performance, normalized_metrics: value }, true)).toBe(true);
});

test.each([undefined, false, [], '25', {}, { ...metrics, added_load_percent_bw: -1 },
  { ...metrics, added_load_percent_bw: NaN }, { ...metrics, e1rm_percent_bw: Infinity },
  { ...metrics, volume_percent_bw_reps: '625' }, { ...metrics, body_weight_kg: 80 },
  { ...metrics, weight_value: '20' }, { ...metrics, reading_id: 'private' }])('rejects malformed or private normalized metrics: %p', value => {
  expect(isNormalizedSetMetrics(value)).toBe(false);
  expect(isCompetitionSessionDetailWire(sessionWith(value))).toBe(false);
  expect(isCompetitionPerformanceWire({ ...competitionRow.performance, normalized_metrics: value }, true)).toBe(false);
});

test('ordinary and legacy responses keep their exact shapes', () => {
  expect(isCompetitionSessionDetailWire(competitionSession)).toBe(true);
  expect(isCompetitionPerformanceWire(competitionRow.performance, true)).toBe(true);
  expect(isCompetitionPerformanceWire({ ...competitionRow.performance, visibility: 'ordinary', weight_value: '20',
    normalized_metrics: metrics }, false)).toBe(false);
});
