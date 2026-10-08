/* eslint-disable import/first */
const mockClient = jest.fn();
jest.mock('@/src/auth/supabase', () => ({ getRequiredSupabaseMobileClient: () => mockClient() }));
import * as guards from '@/src/groups/competition-reader-guards';
import * as api from '@/src/groups/api';
import type { CompetitionStreamItemWire } from '@/src/groups/competition-wire';

const member = { user_id: 'u1', username: 'Member' };
const rules = { load_input_mode: 'total_load', bodyweight_calculations_enabled: true,
  bodyweight_contribution: 1, default_metric: 'e1rm', rules_revision: 2 };
const exercise = { group_exercise_id: 'ge', name: 'Pull-up', source_exercise_id: null,
  archived_at_ms: null, rules, published_revision: 2, rebuilding: false };
const certification = { certification_id: 'c1', metric: 'e1rm', certified_by: member, certified_at_ms: 100,
  observed_rules_revision: 1, ended_at_ms: null, end_reason: null };
const revision = { rules_revision: 2, representation_version: 4,
  rules: { load_input_mode: 'total_load', bodyweight_calculations_enabled: true, bodyweight_contribution: 1, default_metric: 'e1rm' },
  reason: 'rules_change', legacy: false, published_at_ms: 100, retired_at_ms: null };
const historicalValue = { role: 'record', metric: 'e1rm', unit: 'percent_bw', value: 130, unavailable: false, member };
const event = { event_id: 'ev', sequence: 1, kind: 'record', group: { group_id: 'g', name: 'Crew' },
  group_exercise: { group_exercise_id: 'ge', name: 'Pull-up' }, rules_revision: 2, representation_version: 4,
  visibility: 'normalized', sort_at_ms: 100, member, metric: null, certified: null, reason: null, related_event_id: null,
  session_id: 's', set_id: 'set', reps: 5, provisional: false, voided: false, values: [historicalValue],
  record_context: { exercise, former: false, metrics: [{ metric: 'e1rm', write_token: 'random-uuid', eligible: true, certification }] } };
const set = { set_id: 'set', order_index: 0, reps_value: '5', set_type: null, performance_status: null };
const sessionExercise = { session_exercise_id: 'se', exercise_definition_id: 'ed', load_input_mode: 'total_load',
  name: 'Pull-up', machine_name: null, order_index: 0, visibility: 'normalized', sets: [set] };
const session = { member, session_id: 's', gym_name: null, status: 'completed', started_at_ms: 100,
  completed_at_ms: 200, duration_sec: 100, exercises: [sessionExercise] };
const performance = { visibility: 'normalized', session_id: 's', session_exercise_id: 'se', exercise_definition_id: 'ed',
  set_id: 'set', reps: 5, performance_status: null, source_load_input_mode: 'total_load', achieved_at_ms: 100,
  exercise_order_index: 0, set_order_index: 0 };
const board = { contract_version: 4, group_exercise_id: 'ge', rules, metric: 'e1rm', certified: true,
  state: 'ready', entries: [{ metric: 'e1rm', value: 130, unit: 'percent_bw', rank: 1, member, former: false,
    performance, write_token: 'random-uuid', certification }], entry_count: 1, me: null, next_cursor: null };
const history = { contract_version: 4, exercise, revision, metric: 'e1rm', certified: false, events: [event], next_cursor: null };
const detail = { contract_version: 4, group_id: 'g', session };
const records = { contract_version: 4, group_id: 'g', member_user_id: 'u1', session_id: 's',
  records: [{ event, boards: [{ metric: 'e1rm', leader: { user_id: 'u2', username: 'Rival' }, leads: false }] }] };
const stream = { contract_version: 4, items: [
  { kind: 'competition', key: 'ev', sort_at_ms: 100, event },
  { kind: 'session', key: 'u1:s', sort_at_ms: 100, groups: [{ group_id: 'g', name: 'Crew' }], session },
  { kind: 'membership', key: 'm:joined', sort_at_ms: 90, event: 'joined', group: { group_id: 'g', name: 'Crew' }, member },
], next_cursor: null, has_more: false };
const latest = { member, session_id: 's', started_at_ms: 100, completed_at_ms: 200, duration_sec: 100,
  gym_name: null, working_sets: 1, exercise_count: 1, group_records: [event] };
const week = { contract_version: 4, group_id: 'g', members: [{ rank: 1, member, working_sets: 1, group_records: 1 }],
  training_now: [{ member, session_id: 's', started_at_ms: 100, gym_name: null, working_sets: 1, exercise_count: 1 }], latest_completed: latest };
const podiums = { contract_version: 4, certified: true, podiums: [{ exercise, board }] };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

test('every new reader accepts only its exact versioned envelope', () => {
  const cases = [
    [guards.isCompetitionExerciseWire,exercise], [guards.isCompetitionExerciseListWire,{ contract_version: 4, exercises: [exercise] }],
    [guards.isCompetitionExerciseWriteWire,{ contract_version: 4, exercise }],
    [guards.isCompetitionCertificationResultWire,{ contract_version: 4, certification }],
    [guards.isCompetitionCertifyResultWire,{ contract_version: 4, certification, created: false }],
    [guards.isCompetitionPodiumsWire,podiums], [guards.isCompetitionRevisionWire,revision], [guards.isCompetitionEventWire,event],
    [guards.isCompetitionHistoryWire,history], [guards.isCompetitionRevisionsWire,{ contract_version: 4, exercise, revisions: [revision] }],
    [guards.isCompetitionSessionWire,session], [guards.isCompetitionSessionDetailWire,detail],
    [guards.isCompetitionSessionRecordsWire,records],
    [guards.isCompetitionStreamWire,stream], [guards.isCompetitionWeekSummaryWire,week],
  ] as const;
  for (const [guard,value] of cases) {
    expect(guard(value)).toBe(true); expect(guard(null)).toBe(false); expect(guard({ ...value, private_reading: 80 })).toBe(false);
  }
});

test.each(['body_weight_kg','body_weight_measurement_id','body_weight_measured_at_ms','fingerprint','observed_value','performance','weight_kg'])
  ('unknown private/audit field %s fails at every history nesting level', field => {
    for (const mutate of [
      (v: typeof event) => Object.assign(v.group,{ [field]: 80 }),
      (v: typeof event) => Object.assign(v.group_exercise,{ [field]: 80 }),
      (v: typeof event) => Object.assign(v.member,{ [field]: 80 }),
      (v: typeof event) => Object.assign(v.values[0],{ [field]: 80 }),
      (v: typeof event) => Object.assign(v.record_context,{ [field]: 80 }),
      (v: typeof event) => Object.assign(v.record_context.exercise.rules,{ [field]: 80 }),
      (v: typeof event) => Object.assign(v.record_context.metrics[0],{ [field]: 80 }),
      (v: typeof event) => Object.assign(v.record_context.metrics[0].certification,{ [field]: 80 }),
    ]) { const v = clone(event); mutate(v); expect(guards.isCompetitionEventWire(v)).toBe(false); }
  });

test('normalized history never accepts an available absolute counterpart; old labels remain unchanged when unavailable', () => {
  const v = clone(event); Object.assign(v.values[0],{ metric: 'weight', unit: 'kg', value: null, unavailable: true });
  expect(guards.isCompetitionEventWire(v)).toBe(true);
  Object.assign(v.values[0],{ value: 20, unavailable: false }); expect(guards.isCompetitionEventWire(v)).toBe(false);
  v.visibility = 'ordinary'; expect(guards.isCompetitionEventWire(v)).toBe(true);
  for (const patch of [{ value: NaN },{ value: Infinity },{ value: 0 },{ value: -1 },{ unit: 'x_bw' },{ unavailable: true }]) {
    expect(guards.isCompetitionEventWire({ ...event, values: [{ ...historicalValue,...patch }] })).toBe(false);
  }
  expect(guards.isCompetitionRevisionWire({ ...revision, representation_version: '4' })).toBe(false);
  expect(guards.isCompetitionEventWire({ ...event, representation_version: '4' })).toBe(false);
  expect(guards.isCompetitionRevisionWire({ ...revision, representation_version: 3, legacy: true,
    rules: { ...revision.rules,default_metric: 'weight' } })).toBe(true);
  expect(guards.isCompetitionRevisionWire({ ...revision, rules: { ...revision.rules,default_metric: 'weight' } })).toBe(false);
});

test('group-bound sessions keep ordinary context while rejecting normalized kg and totals', () => {
  const mixed = { ...clone(session), exercises: [sessionExercise, { ...sessionExercise, visibility: 'ordinary',
    sets: [{ ...set, weight_value: '20' }] }] };
  expect(guards.isCompetitionSessionWire(mixed)).toBe(true);
  expect(guards.isCompetitionSessionWire({ ...session,exercises: [{ ...sessionExercise,exercise_definition_id: null,load_input_mode: null }] })).toBe(true);
  for (const field of ['weight_value','effective_resistance_kg','body_weight_kg','volume_kg_reps']) {
    const v = clone(session); Object.assign(v.exercises[0].sets[0],{ [field]: 20 }); expect(guards.isCompetitionSessionWire(v)).toBe(false);
  }
  expect(guards.isCompetitionSessionWire({ ...session, volume_kg_reps: 100 })).toBe(false);
  expect(guards.isCompetitionWeekSummaryWire({ ...week, volume_kg_reps: 100 })).toBe(false);
  expect(guards.isCompetitionWeekSummaryWire({ ...week,latest_completed: null, members: [],training_now: [] })).toBe(true);
  expect(guards.isCompetitionStreamWire({ ...stream, has_more: true, next_cursor: 'scoped-cursor' })).toBe(true);
  expect(guards.isCompetitionStreamWire({ ...stream, has_more: true })).toBe(false);
  expect(guards.isCompetitionStreamWire({ ...stream, items: [{ kind: 'future', key: 'k' }] })).toBe(false);
});

test('session records name only this session\'s records, one board each, never a leading board without a leader', () => {
  const record = records.records[0];
  const variant = (patch: Record<string, unknown>) => ({ ...records, records: [{ ...record, ...patch }] });
  expect(guards.isCompetitionSessionRecordsWire({ ...records, records: [] })).toBe(true);
  expect(guards.isCompetitionSessionRecordsWire(variant({ boards: [{ metric: 'e1rm', leader: member, leads: true }] }))).toBe(true);
  expect(guards.isCompetitionSessionRecordsWire(variant({ boards: [{ metric: 'e1rm', leader: null, leads: false }] }))).toBe(true);
  // A legacy record's historic Weight board has no current leader.
  expect(guards.isCompetitionSessionRecordsWire(variant({ event: { ...event, values: [{ ...historicalValue, metric: 'weight', unit: 'kg', value: null, unavailable: true }] },
    boards: [{ metric: 'weight', leader: null, leads: false }] }))).toBe(true);
  for (const rejected of [
    variant({ boards: [] }),
    variant({ boards: [{ metric: 'e1rm', leader: null, leads: true }] }),
    variant({ boards: [{ metric: 'volume', leader: null, leads: false }] }),
    variant({ boards: [{ metric: 'e1rm', leader: null, leads: false }, { metric: 'e1rm', leader: null, leads: false }] }),
    variant({ boards: [{ metric: 'e1rm', leader: { ...member, private_reading: 80 }, leads: false }] }),
    variant({ event: { ...event, kind: 'lead_change' } }),
    variant({ event: { ...event, session_id: 'other' } }),
    variant({ event: { ...event, member: { user_id: 'u2', username: null } } }),
    variant({ event: { ...event, group: { group_id: 'other', name: 'Crew' } } }),
  ]) expect(guards.isCompetitionSessionRecordsWire(rejected)).toBe(false);
});

test('readers check nested scope/revision/scope-state coherence', () => {
  expect(guards.isCompetitionExerciseWire({ ...exercise, rebuilding: true })).toBe(false);
  expect(guards.isCompetitionExerciseWire({ ...exercise, published_revision: 3 })).toBe(false);
  expect(guards.isCompetitionExerciseWire({ ...exercise, archived_at_ms: 200, published_revision: null })).toBe(true);
  expect(guards.isCompetitionExerciseWire({ ...exercise, published_revision: null, rebuilding: true })).toBe(true);
  expect(guards.isCompetitionHistoryWire({ ...history, events: [{ ...event, rules_revision: 1 }] })).toBe(false);
  expect(guards.isCompetitionHistoryWire({ ...history, events: [{ ...event, group_exercise: { ...event.group_exercise,group_exercise_id: 'other' } }] })).toBe(false);
  expect(guards.isCompetitionPodiumsWire({ ...podiums,certified: false })).toBe(false);
  expect(guards.isCompetitionPodiumsWire({ ...podiums,podiums: [{ exercise: { ...exercise,rules: { ...rules,bodyweight_contribution: 0.5 } },board }] })).toBe(false);
});

const contract = { contract_version: 4, activation_state: 'pending', cache_version: 5, metrics: ['volume','e1rm'], default_metric: 'e1rm',
  ordinary_units: { volume: 'kg_reps', e1rm: 'kg' }, normalized_units: { volume: 'percent_bw_reps', e1rm: 'percent_bw' } };
describe('request-scoped protocol-4 API', () => {
  const rpc = jest.fn(), setHeader = jest.fn();
  const respond = (data: unknown, error: unknown = null, status = 200) => {
    const request = Object.assign(Promise.resolve({ data,error,status }),{ setHeader });
    setHeader.mockReturnValue(request); rpc.mockReturnValue(request);
  };
  beforeEach(() => { rpc.mockReset(); setHeader.mockReset(); mockClient.mockReset(); mockClient.mockReturnValue({ schema: jest.fn().mockReturnValue({ rpc }) }); });
  const calls = [
    ['contract',() => api.getCompetitionContract('g'),contract],
    ['exercise_list',() => api.listCompetitionExercises('g'),{ contract_version: 4, exercises: [exercise] }],
    ['board',() => api.getCompetitionBoard({ groupId: 'g',exerciseId: 'ge',metric: 'e1rm' }),board],
    ['podiums',() => api.getCompetitionPodiums('g'),podiums],
    ['revisions',() => api.getCompetitionRevisions('g','ge'),{ contract_version: 4, exercise, revisions: [revision] }],
    ['history',() => api.getCompetitionHistory({ groupId: 'g',exerciseId: 'ge',metric: 'e1rm',certified: false }),history],
    ['stream',() => api.getCompetitionStream('g'),stream],
    ['session_detail',() => api.getCompetitionSession('g','u1','s'),detail],
    ['session_records',() => api.getCompetitionSessionRecords('g','u1','s'),records],
    ['week_summary',() => api.getCompetitionWeek('g',0,1000),week],
    ['certify',() => api.certifyCompetition({ groupId: 'g',exerciseId: 'ge',memberId: 'u1',setId: 'set',metric: 'e1rm',revision: 2,token: 'random-uuid' }),{ contract_version: 4, certification, created: true }],
    ['certification_get',() => api.getCompetitionCertification('g','c1','e1rm'),{ contract_version: 4, certification }],
    ['certification_end',() => api.endCompetitionCertification('g','c1','e1rm','cancel'),{ contract_version: 4, certification }],
    ['exercise_create',() => api.createCompetitionExercise({ groupId: 'g',name: 'Pull-up',mode: 'total_load', contribution: 1 }),{ contract_version: 4, exercise }],
    ['exercise_update',() => api.updateCompetitionExercise({ groupId: 'g',exerciseId: 'ge',revision: 1,name: 'Pull-up',mode: 'total_load',contribution: 1,metric: 'e1rm' }),{ contract_version: 4, exercise }],
    ['exercise_archive',() => api.archiveCompetitionExercise('g','ge',true),{ contract_version: 4, exercise: { ...exercise,archived_at_ms: 200 } }],
  ] as const;
  test.each(calls)('%s sets its own header and validates before returning', async (name,call,payload) => {
    respond(payload); await expect(call()).resolves.toEqual(payload);
    expect(rpc).toHaveBeenCalledWith(`group_competition_${name}`,expect.any(Object));
    expect(setHeader).toHaveBeenCalledWith('x-boga-group-contract','4');
    respond({ ...payload, body_weight_kg: 80 }); await expect(call()).rejects.toMatchObject({ code: 'INTERNAL' });
    respond({ ...payload, contract_version: 3 }); await expect(call()).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  test('decoded but foreign group/revision/metric responses never escape the request boundary', async () => {
    respond({ ...board,group_exercise_id: 'other' }); await expect(api.getCompetitionBoard({ groupId: 'g',exerciseId: 'ge',metric: 'e1rm' })).rejects.toMatchObject({ code: 'INTERNAL' });
    respond({ ...detail,group_id: 'other' }); await expect(api.getCompetitionSession('g','u1','s')).rejects.toMatchObject({ code: 'INTERNAL' });
    respond({ ...records,session_id: 'other',records: [] }); await expect(api.getCompetitionSessionRecords('g','u1','s')).rejects.toMatchObject({ code: 'INTERNAL' });
    respond({ ...records,group_id: 'other',records: [] }); await expect(api.getCompetitionSessionRecords('g','u1','s')).rejects.toMatchObject({ code: 'INTERNAL' });
    respond({ ...history,certified: true }); await expect(api.getCompetitionHistory({ groupId: 'g',exerciseId: 'ge',metric: 'e1rm',certified: false })).rejects.toMatchObject({ code: 'INTERNAL' });
    respond({ ...week,group_id: 'other' }); await expect(api.getCompetitionWeek('g',0,1000)).rejects.toMatchObject({ code: 'INTERNAL' });
    for (const item of stream.items) {
      const foreign = clone(item) as CompetitionStreamItemWire;
      if ('groups' in foreign) foreign.groups[0].group_id = 'other';
      else if ('group' in foreign) foreign.group.group_id = 'other';
      else foreign.event.group.group_id = 'other';
      respond({ ...stream,items: [foreign] }); await expect(api.getCompetitionStream('g')).rejects.toMatchObject({ code: 'INTERNAL' });
      respond({ ...stream,items: [foreign] }); await expect(api.getCompetitionStream()).resolves.toEqual({ ...stream,items: [foreign] });
    }
    respond({ contract_version: 4,certification: { ...certification,certification_id: 'other' } }); await expect(api.getCompetitionCertification('g','c1','e1rm')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  test('unsupported/authorization and transport errors stay typed; no legacy retry', async () => {
    respond(null,{ message: 'UPDATE_REQUIRED: unavailable' },400);
    await expect(api.getCompetitionContract('g')).rejects.toMatchObject({ code: 'UPDATE_REQUIRED' }); expect(rpc).toHaveBeenCalledTimes(1);
    respond(null,{ message: 'FORBIDDEN: denied' },403); await expect(api.getCompetitionContract('g')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mockClient.mockImplementation(() => { throw new Error('unconfigured'); }); await expect(api.getCompetitionContract('g')).rejects.toMatchObject({ code: 'INTERNAL' });
    mockClient.mockReturnValue({ schema: () => ({ rpc: () => { throw new Error('offline'); } }) });
    await expect(api.getCompetitionContract('g')).rejects.toMatchObject({ code: 'NETWORK' });
  });
  test('server-normalized names on committed creates/updates are accepted', async () => {
    const payload = { contract_version: 4,exercise };
    respond(payload);
    await expect(api.createCompetitionExercise({ groupId: 'g',name: ' Pull-up ',mode: 'total_load',contribution: 1 })).resolves.toEqual(payload);
    respond(payload);
    await expect(api.updateCompetitionExercise({ groupId: 'g',exerciseId: 'ge',revision: 2,name: ' Pull-up ',mode: 'total_load',contribution: 1,metric: 'e1rm' })).resolves.toEqual(payload);
  });
});
