import { buildCompetitionRow, buildCompetitionPodiums, competitionViewLabel, formatContributionPercent,
  formatCompetitionValue, formatCompetitionHistoricalValue, formatCompetitionPerformance, competitionLinkExercise } from '@/src/groups/competition-view-model';
import { buildCompetitionSession } from '@/src/groups/competition-session-view-model';
import { buildStreamRecordSheet } from '@/src/groups/competition-stream-view-model';
import { competitionBoard,competitionCertification,competitionEvent,competitionExercise,competitionRow,competitionSession } from './helpers/competition-fixtures';

test.each([
  ['volume','kg_reps',125.5,'125.5'],['volume','percent_bw_reps',611.111111,'611.1 %BW·reps'],
  ['e1rm','kg',125.5,'125.5'],['e1rm','percent_bw',145.728,'145.7 %BW'],
] as const)('formats %s from wire unit %s while preserving the server value', (metric,unit,value,expected) => {
  const score={ metric,unit,value };expect(formatCompetitionValue(score)).toBe(expected);expect(score.value).toBe(value);
});
test.each([
  ['kg', 'Weight 125.5'], ['kg_reps', 'Weight 125.5'],
  ['percent_bw', 'Weight 125.5 %BW'], ['percent_bw_reps', 'Weight 125.5 %BW·reps'],
])('formats historical %s without changing its wire unit', (unit, expected) => {
  const value = { ...competitionEvent.values[0], metric: 'weight' as const, unit, value: 125.5 };
  expect(formatCompetitionHistoricalValue(value)).toBe(expected);
  expect(value.unit).toBe(unit);
  expect(formatCompetitionHistoricalValue({ ...value, unavailable: true })).toBe('Score unavailable');
  expect(formatCompetitionHistoricalValue({ ...value, value: null })).toBe('Score unavailable');
});
test.each(['total_load', 'per_side_load'] as const)('retains %s context without a weight unit', source_load_input_mode => {
  const performance = { visibility: 'ordinary' as const, session_id: 's', session_exercise_id: 'se',
    exercise_definition_id: 'd', set_id: 'set', reps: 5, performance_status: null, source_load_input_mode,
    achieved_at_ms: 1, exercise_order_index: 0, set_order_index: 0, weight_value: '20' };
  expect(formatCompetitionPerformance(performance)).toBe(source_load_input_mode === 'per_side_load'
    ? 'Weight 20.0 per side × 5' : 'Weight 20.0 × 5');
});
test.each([0,-1,NaN,Infinity])('invalid score %s uses generic unavailable copy', value => {
  expect(formatCompetitionValue({ metric: 'e1rm',unit: 'percent_bw',value })).toBe('Score unavailable');
});
test('normalized rows and accessibility contain reps and percentages without an absolute counterpart', () => {
  const row=buildCompetitionRow(competitionRow,'all','me','DD-MM-YYYY');
  expect(row.valueLabel).toBe('145.7 %BW');expect(row.detailLabel).toBe('5 reps');
  expect(row.accessibilityLabel).toContain('145.7 %BW, 5 reps');expect(row.accessibilityLabel).not.toMatch(/kg|reading|bodyweight.*\d/i);
  const poisoned={ ...competitionRow.performance };
  Object.defineProperty(poisoned,'weight_value',{ get: () => { throw new Error('private load accessed'); } });
  expect(formatCompetitionPerformance(poisoned)).toBe('5 reps');
});
test('Off and c=0 use ordinary units independently of a saved positive contribution', () => {
  expect(competitionViewLabel('volume',{ ...competitionExercise.rules,bodyweight_calculations_enabled: false })).toBe('Volume');
  expect(competitionViewLabel('e1rm',{ ...competitionExercise.rules,bodyweight_contribution: 0 })).toBe('1RM');
  expect(competitionViewLabel('volume',competitionExercise.rules)).toBe('Volume %BW·reps');
  expect(competitionLinkExercise(competitionExercise)).toEqual({ group_exercise_id: 'ge1',name: 'Pull-up',source_exercise_id: null,
    archived_at_ms: null,load_input_mode: 'total_load' });
});
test('podiums preserve server order, unit and default metric; rebuilding has no stale figures', () => {
  const payload={ contract_version: 4 as const,certified: false,podiums: [{ exercise: competitionExercise,board: competitionBoard }] };
  expect(buildCompetitionPodiums(payload,'me', 'DD-MM-YYYY')[0].viewLabel).toContain('All · 1RM %BW');
  expect(buildCompetitionPodiums(payload,'me', 'DD-MM-YYYY')[0].rows[0].valueLabel).toBe('145.7 %BW');
  const rebuilding={ ...payload,podiums: [{ exercise: { ...competitionExercise,rebuilding: true,published_revision: null },
    board: { ...competitionBoard,state: 'rebuilding' as const,entries: [],entry_count: 0,me: null } }] };
  expect(buildCompetitionPodiums(rebuilding,'me', 'DD-MM-YYYY')[0]).toMatchObject({ rows: [],youLabel: null,emptyLabel: 'Recalculating under the new rules…' });
});
test('normalized full sessions keep permitted reps and effort without derived load columns or totals', () => {
  const model=buildCompetitionSession(competitionSession.session);
  expect(model).toMatchObject({ setCount: 1,exerciseCount: 1,cards: [{ hideDerivedMetrics: true,rows: [{ weightReps: '5 reps' }] }] });
  // No kg is visible, so no Volume figure either.
  expect(model.volume).toBe('—');expect(model).not.toHaveProperty('volumeKg');
  expect(JSON.stringify(model)).not.toMatch(/body_weight|reading|fingerprint/);
});

test.each([['total_load', '20', '25.5'], ['per_side_load', '10', '12.8']] as const)(
  'ordinary %s sessions keep raw rows and sum total Volume', (load_input_mode, weight_value, oneRepMax) => {
    const exercise = competitionSession.session.exercises[0];
    const input = { ...competitionSession.session, exercises: [{ ...exercise,
      load_input_mode, visibility: 'ordinary' as const,
      sets: [{ ...exercise.sets[0], weight_value, reps_value: '8' }],
    }] };
    expect(buildCompetitionSession(input)).toMatchObject({ setCount: 1, exerciseCount: 1, volume: '160',
      cards: [{ hideDerivedMetrics: false, rows: [{ weightReps: `${weight_value}.0 × 8`, oneRepMax, volume: '160' }] }] });
    expect(input.exercises[0].sets[0].weight_value).toBe(weight_value);
  });


test.each(['bad', '-1', '1e3'])('ordinary full-session invalid Weight %s is not performed or counted', weight => {
  const exercise=competitionSession.session.exercises[0];
  const session={ ...competitionSession.session,exercises: [{ ...exercise,visibility: 'ordinary' as const,
    sets: [{ ...exercise.sets[0],weight_value: weight }] }] };
  expect(buildCompetitionSession(session)).toEqual({ cards: [],setCount: 0,exerciseCount: 0,volume: '—' });
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
  expect(formatContributionPercent(0.29)).toBe('29');
});
describe('buildStreamRecordSheet', () => {
  const NOW = Date.UTC(2026, 9, 8, 12);
  const ordinary = { visibility: 'ordinary' as const, session_id: 's1', session_exercise_id: 'se1', exercise_definition_id: 'd1',
    set_id: 'set1', reps: 5, performance_status: null, source_load_input_mode: 'total_load' as const, achieved_at_ms: 1,
    exercise_order_index: 0, set_order_index: 0, weight_value: '120' };
  it('names me, shows the set from the record stream and orders 1RM before Volume', () => {
    const event = { ...competitionEvent, member: { user_id: 'me', username: 'Me' }, sort_at_ms: Date.UTC(2026, 9, 6, 12),
      values: [{ ...competitionEvent.values[0], metric: 'volume' as const, unit: 'percent_bw_reps', value: 650 }, competitionEvent.values[0]] };
    const model = buildStreamRecordSheet(event, { performance: ordinary, previous: [] }, 'me', 'DD-MM-YYYY');
    expect(model.who).toMatch(/^You · /);
    expect(model.set).toBe('120.0 × 5');
    expect(model.metrics.map(entry => [entry.label, entry.value])).toEqual([['1RM', '145.7 %BW'], ['Volume', '650.0 %BW·reps']]);
    expect(model.previous).toEqual([]);
  });
  it('certifies the set once, through the certified row, else the first certifiable (1RM first)', () => {
    const context = competitionEvent.record_context!;
    const volume = { ...context.metrics[0], metric: 'volume' as const, write_token: 'volume-token' };
    const both = { ...competitionEvent, record_context: { ...context, metrics: [volume, context.metrics[0]] } };
    expect(buildStreamRecordSheet(both, undefined, 'me', 'DD-MM-YYYY').certification?.target).toEqual(expect.objectContaining({ metric: 'e1rm', write_token: 'server-random-token' }));
    const certified = { ...both, record_context: { ...both.record_context, metrics: [{ ...volume, certification: { ...competitionCertification, metric: 'volume' as const } },
      context.metrics[0]] } };
    expect(buildStreamRecordSheet(certified, undefined, 'me', 'DD-MM-YYYY').certification?.target.metric).toBe('volume');
    const ineligible = { ...both, record_context: { ...both.record_context, metrics: [volume, { ...context.metrics[0], eligible: false }] } };
    expect(buildStreamRecordSheet(ineligible, undefined, 'me', 'DD-MM-YYYY').certification?.target.metric).toBe('volume');
    expect(buildStreamRecordSheet({ ...competitionEvent, record_context: null }, undefined, 'me', 'DD-MM-YYYY').certification).toBeNull();
  });
  it('lists the previous #1 per board with holder and set, or value only', () => {
    const record = { performance: null, previous: [
      { value: { role: 'previous' as const, metric: 'volume' as const, unit: 'kg_reps', value: 500, unavailable: false, member: { user_id: 'me', username: 'Me' } }, performance: null },
      { value: { role: 'previous' as const, metric: 'e1rm' as const, unit: 'kg', value: 110, unavailable: false, member: { user_id: 'sam', username: 'Sam' } },
        performance: { ...ordinary, weight_value: '100', reps: 3, source_load_input_mode: 'per_side_load' as const } }] };
    const model = buildStreamRecordSheet(competitionEvent, record, 'me', 'DD-MM-YYYY');
    expect(model.set).toBe('5 reps');
    expect(model.previous).toEqual([
      { metric: 'e1rm', label: '1RM', value: '110.0', holder: 'Sam', set: '100.0 × 3 per side' },
      { metric: 'volume', label: 'Volume', value: '500.0', holder: 'You', set: null }]);
  });
  it('shows a voided record as unavailable with nothing to certify, no previous, and no set without reps', () => {
    const model = buildStreamRecordSheet({ ...competitionEvent, voided: true, reps: null }, undefined, 'me', 'DD-MM-YYYY');
    expect(model.set).toBeNull();
    expect(model.certification).toBeNull();
    expect(model.metrics).toEqual([expect.objectContaining({ value: 'Score unavailable' })]);
  });
  it('omits the historical ordinary weight unit', () => {
    const model = buildStreamRecordSheet({ ...competitionEvent, values: [{ ...competitionEvent.values[0], metric: 'weight', unit: 'kg', value: 100 }] }, undefined, 'me', 'DD-MM-YYYY');
    expect(model.metrics).toEqual([{ metric: 'weight', label: 'Weight', value: '100.0' }]);
  });
});


test.each([
  ['total_load', 0, 500, '100.0'],
  ['total_load', 25, 625, '125.0'],
  ['total_load', 25, 275, '55.0'],
  ['per_side_load', 25, 625, '125.0'],
] as const)('normalized %s session sets show total load from public Volume (%s added, %s volume)', (load_input_mode, added, volume, total) => {
  const metrics = { added_load_percent_bw: added, e1rm_percent_bw: 145.728, volume_percent_bw_reps: volume };
  const exercise = competitionSession.session.exercises[0];
  const session = { ...competitionSession.session, exercises: [{ ...exercise, load_input_mode, visibility: 'normalized' as const,
    sets: exercise.sets.map(set => ({ ...set, normalized_metrics: metrics })) }] };
  const model = buildCompetitionSession(session);
  expect(model).toMatchObject({ volume: '—', setCount: 1, cards: [{ hideDerivedMetrics: false, percentageMetrics: true,
    rows: [{ weightReps: `${total} %BW × 5`, oneRepMax: '145.7 %BW', volume: `${volume}.0 %BW·reps` }] }] });
  // Other group performance labels keep their existing additional-load display.
  expect(formatCompetitionPerformance({ ...competitionRow.performance, visibility: 'normalized', normalized_metrics: metrics }))
    .toBe(`${added}.0 %BW × 5`);
});

test('normalized session load needs public Volume, never assumes a 100 percent contribution', () => {
  const exercise = competitionSession.session.exercises[0];
  for (const [volume, reps, expected] of [[null, '5', '5 reps'], [0, '5', '0.0 %BW × 5'], [811.599, '8', '101.4 %BW × 8']] as const) {
    const metrics = { added_load_percent_bw: null, e1rm_percent_bw: 145.728, volume_percent_bw_reps: volume };
    const session = { ...competitionSession.session, exercises: [{ ...exercise, visibility: 'normalized' as const,
      sets: exercise.sets.map(set => ({ ...set, reps_value: reps, normalized_metrics: metrics })) }] };
    expect(buildCompetitionSession(session).cards[0].rows[0]).toMatchObject({
      weightReps: expected, oneRepMax: '145.7 %BW',
    });
    expect(metrics.volume_percent_bw_reps).toBe(volume);
  }
});

test('an unavailable normalized projection retains reps without inventing a zero or a total', () => {
  const exercise = competitionSession.session.exercises[0];
  const input = { ...competitionSession.session, exercises: [{ ...exercise, visibility: 'normalized' as const,
    sets: exercise.sets.map(set => ({ ...set, normalized_metrics: null })) }] };
  expect(buildCompetitionSession(input)).toMatchObject({ volume: '—', cards: [{ hideDerivedMetrics: true,
    rows: [{ weightReps: '5 reps', oneRepMax: '—', volume: '—' }] }] });
});
