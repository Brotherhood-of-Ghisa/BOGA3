import { buildCompetitionRow, buildCompetitionPodiums, competitionViewLabel, describeCompetitionRules,
  formatCompetitionValue, formatCompetitionPerformance, competitionLinkExercise } from '@/src/groups/competition-view-model';
import { buildCompetitionSession } from '@/src/groups/competition-session-view-model';
import { competitionBoard,competitionExercise,competitionRow,competitionSession } from './helpers/competition-fixtures';

test.each([
  ['volume','kg_reps',125.5,'125.5 kg·reps'],['volume','percent_bw_reps',611.111111,'611.1 %BW·reps'],
  ['e1rm','kg',125.5,'125.5 kg'],['e1rm','percent_bw',145.728,'145.7 %BW'],
] as const)('formats %s with explicit %s while preserving the server value', (metric,unit,value,expected) => {
  const score={ metric,unit,value };expect(formatCompetitionValue(score)).toBe(expected);expect(score.value).toBe(value);
});
test.each([0,-1,NaN,Infinity])('invalid score %s uses generic unavailable copy', value => {
  expect(formatCompetitionValue({ metric: 'e1rm',unit: 'percent_bw',value })).toBe('Score unavailable');
});
test('normalized rows and accessibility contain reps and percentages without an absolute counterpart', () => {
  const row=buildCompetitionRow(competitionRow,'all','me',3_000);
  expect(row.valueLabel).toBe('145.7 %BW');expect(row.detailLabel).toBe('5 reps');
  expect(row.accessibilityLabel).toContain('145.7 %BW, 5 reps');expect(row.accessibilityLabel).not.toMatch(/kg|reading|bodyweight.*\d/i);
  const poisoned={ ...competitionRow.performance };
  Object.defineProperty(poisoned,'weight_value',{ get: () => { throw new Error('private load accessed'); } });
  expect(formatCompetitionPerformance(poisoned)).toBe('5 reps');
});
test('Off and c=0 use ordinary units independently of a saved positive contribution', () => {
  expect(competitionViewLabel('volume',{ ...competitionExercise.rules,bodyweight_calculations_enabled: false })).toBe('Volume kg·reps');
  expect(competitionViewLabel('e1rm',{ ...competitionExercise.rules,bodyweight_contribution: 0 })).toBe('1RM kg');
  expect(competitionViewLabel('volume',competitionExercise.rules)).toBe('Volume %BW·reps');
  expect(describeCompetitionRules(competitionExercise)).toContain('100% contribution');
  expect(competitionLinkExercise(competitionExercise)).toEqual({ group_exercise_id: 'ge1',name: 'Pull-up',source_exercise_id: null,
    archived_at_ms: null,load_input_mode: 'total_load',standard: describeCompetitionRules(competitionExercise) });
});
test('podiums preserve server order, unit and default metric; rebuilding has no stale figures', () => {
  const payload={ contract_version: 4 as const,certified: false,podiums: [{ exercise: competitionExercise,board: competitionBoard }] };
  expect(buildCompetitionPodiums(payload,'me')[0].viewLabel).toContain('All · 1RM %BW');
  expect(buildCompetitionPodiums(payload,'me')[0].rows[0].valueLabel).toBe('145.7 %BW');
  const rebuilding={ ...payload,podiums: [{ exercise: { ...competitionExercise,rebuilding: true,published_revision: null },
    board: { ...competitionBoard,state: 'rebuilding' as const,entries: [],entry_count: 0,me: null } }] };
  expect(buildCompetitionPodiums(rebuilding,'me')[0]).toMatchObject({ rows: [],youLabel: null,emptyLabel: 'Recalculating under the new rules…' });
});
test('normalized full sessions keep permitted reps and effort without derived load columns or totals', () => {
  const model=buildCompetitionSession(competitionSession.session);
  expect(model).toMatchObject({ setCount: 1,exerciseCount: 1,cards: [{ hideDerivedMetrics: true,rows: [{ weightReps: '5 reps' }] }] });
  expect(model).not.toHaveProperty('volume');expect(model).not.toHaveProperty('volumeKg');
  expect(JSON.stringify(model)).not.toMatch(/body_weight|reading|fingerprint/);
});


test.each(['bad', '-1', '1e3'])('ordinary full-session invalid Weight %s is not performed or counted', weight => {
  const exercise=competitionSession.session.exercises[0];
  const session={ ...competitionSession.session,exercises: [{ ...exercise,visibility: 'ordinary' as const,
    sets: [{ ...exercise.sets[0],weight_value: weight }] }] };
  expect(buildCompetitionSession(session)).toEqual({ cards: [],setCount: 0,exerciseCount: 0 });
});
test.each(['', '0'])('ordinary full-session Weight %s remains a valid zero-load performed set', weight => {
  const exercise=competitionSession.session.exercises[0];
  const session={ ...competitionSession.session,exercises: [{ ...exercise,visibility: 'ordinary' as const,
    sets: [{ ...exercise.sets[0],weight_value: weight }] }] };
  expect(buildCompetitionSession(session)).toMatchObject({ setCount: 1,exerciseCount: 1,
    cards: [{ hideDerivedMetrics: false,rows: [{ weightReps: '0.0 × 5' }] }] });
});
test('ordinary warm-up is rendered but never counted as working', () => {
  const exercise=competitionSession.session.exercises[0];
  const session={ ...competitionSession.session,exercises: [{ ...exercise,visibility: 'ordinary' as const,
    sets: [{ ...exercise.sets[0],weight_value: '20',set_type: 'warm_up' }] }] };
  expect(buildCompetitionSession(session)).toMatchObject({ setCount: 0,exerciseCount: 0,cards: [{ rows: [{ working: false }] }] });
});
test('public contribution labels avoid floating-point display noise', () => {
  expect(describeCompetitionRules({ rules: { ...competitionExercise.rules,bodyweight_contribution: 0.29 } })).toContain('29% contribution');
});
