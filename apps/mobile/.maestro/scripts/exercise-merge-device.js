// Real second-device edits for the existing ios-sync-e2e fixture user.
// Native presentation is the claim; arithmetic and conflict permutations stay in Jest/backend.
/* global STEP, SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL, PASSWORD, http, json, output */
function post(path, body, auth) {
  var response = http.post(output.mergeUrl + path, { headers: {
    apikey: output.mergeKey, Authorization: 'Bearer ' + (auth || output.mergeToken || output.mergeKey),
    'Content-Type': 'application/json', 'Content-Profile': 'app_public', 'x-boga-sync-protocol': '5'
  }, body: JSON.stringify(body) });
  var value = json(response.body);
  if (response.status !== 200) throw new Error('Merge fixture HTTP ' + response.status + ': ' + response.body);
  return value;
}
function rpc(name, body) { return post('/rest/v1/rpc/' + name, body); }
if (STEP === 'seed') {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+\/?$/.test(SUPABASE_URL)) throw new Error('Local merge fixture required');
  output.mergeUrl = SUPABASE_URL; output.mergeKey = SUPABASE_ANON_KEY;
  output.mergeToken = post('/auth/v1/token?grant_type=password', { email: EMAIL, password: PASSWORD }).access_token;
  var at = Date.now(), id = 'native-merge-' + at;
  output.mergeSource = id + '-a'; output.mergeDestination = id + '-b';
  function entity(type, key, fields) { return { type: type, id: key, client_updated_at_ms: at,
    fields: Object.assign({ created_at: at, updated_at: at, deleted_at: null }, fields) }; }
  output.mergeSavedSet = entity('exercise_sets', id + '-set', { session_exercise_id: id + '-block',
    order_index: 0, weight_value: '40', reps_value: '5', planned_weight_value: '50', planned_reps_value: '5',
    set_type: null, planned_set_type: null, performance_status: null, source_plan_set_id: null, merge_revision: 0 });
  rpc('sync_push', { entities: [
    entity('exercise_definitions', output.mergeSource, { name: 'Maestro Merge Source', load_input_mode: 'total_load',
      bodyweight_contribution: 0, split_by_gym: false, rest_timer_sec: null }),
    entity('exercise_definitions', output.mergeDestination, { name: 'Maestro Merge Destination', load_input_mode: 'per_side_load',
      bodyweight_contribution: 0, split_by_gym: false, rest_timer_sec: null }),
    entity('sessions', id + '-session', { status: 'completed', started_at: at - 60000, completed_at: at,
      duration_sec: 60, gym_id: null, source_plan_id: null }),
    entity('session_exercises', id + '-block', { session_id: id + '-session', exercise_definition_id: output.mergeSource,
      name: 'Maestro Merge Source', machine_name: null, source_plan_exercise_id: null, order_index: 0, merge_revision: 0 }),
    output.mergeSavedSet
  ] });
} else if (STEP === 'invalid' || STEP === 'repair') {
  var edited = output.mergeSavedSet;
  edited.client_updated_at_ms = Date.now(); edited.fields.weight_value = STEP === 'invalid' ? 'bad' : '40';
  rpc('sync_push', { entities: [edited] });
} else if (STEP === 'stale') {
  var saved = output.mergeSavedSet;
  saved.client_updated_at_ms = Date.now() + 1000; saved.fields.weight_value = '50';
  var ack = rpc('sync_push', { entities: [saved] });
  if (!ack.outcomes || ack.outcomes[0].outcome !== 'preserved') throw new Error('Stale device edit was not preserved');
} else if (STEP === 'verify') {
  var snapshot = rpc('exercise_merge_snapshot', { p_after: 0 });
  var found = snapshot.rows.filter(function(row) { return row.id === output.mergeSavedSet.id; })[0];
  if (!found || found.fields.weight_value !== '25') throw new Error('Reviewed weight did not reach the server');
} else throw new Error('Unknown merge fixture step');
