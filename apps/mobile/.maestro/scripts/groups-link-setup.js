// groups-link-setup.js — server setup for the group-exercise linking flow
// (`flows/groups-link-exercise.yaml`, lane ios-groups-e2e, M25-T07). Runs in
// Maestro's `runScript` JS engine as the flow's OWN device user (fixture
// user_e) over HTTP, with the same RPCs the app calls:
//
//   - GoTrue password sign-in: POST /auth/v1/token?grant_type=password
//   - group_create, then group_exercise_create (a copy of the standard
//     "Barbell Bench Press", `seed_barbell_bench_press`, under a distinct name)
//
// The lane's groups-fixture-reset.sh deletes user_e's groups and sync rows and
// sets its username before every run, so this always starts from nothing.
// Contract: docs/specs/tech/groups-contract.md §4.3–§4.4.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL, PASSWORD. Writes:
//   output.linkGroupId          the new group's id
//   output.linkGroupExerciseId  the group exercise's id (Link screen / picker testIDs)
//
// Any unexpected response throws, which fails the Maestro step.

/* global SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL, PASSWORD, http, json, output */

var TAG = '[groups-link-setup]';
var GROUP_NAME = 'Link Crew';
var GROUP_EXERCISE_NAME = 'Comp Bench';
var SOURCE_EXERCISE_ID = 'seed_barbell_bench_press';

function fail(message) {
  throw new Error(TAG + ' ' + message);
}

function post(path, token, body, extraHeaders) {
  var headers = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }
  for (var key in extraHeaders || {}) {
    headers[key] = extraHeaders[key];
  }
  var response = http.post(SUPABASE_URL + path, { headers: headers, body: JSON.stringify(body) });
  var parsed = null;
  try {
    parsed = json(response.body);
  } catch (error) {
    parsed = null;
  }
  return { status: response.status, body: parsed, raw: response.body };
}

function rpcOk(token, name, args) {
  var result = post('/rest/v1/rpc/' + name, token, args, { 'Content-Profile': 'app_public' });
  if (result.status !== 200 || !result.body) {
    fail(name + ' failed: HTTP ' + result.status + ' ' + result.raw);
  }
  return result.body;
}

var signIn = post('/auth/v1/token?grant_type=password', null, { email: EMAIL, password: PASSWORD });
if (signIn.status !== 200 || !signIn.body || !signIn.body.access_token) {
  fail('password sign-in for ' + EMAIL + ' failed: HTTP ' + signIn.status + ' ' + signIn.raw);
}
var token = signIn.body.access_token;

var group = rpcOk(token, 'group_create', { p_name: GROUP_NAME, p_description: null });
if (!group.group_id) {
  fail('group_create returned no group_id: ' + JSON.stringify(group));
}

var created = rpcOk(token, 'group_exercise_create', {
  p_group_id: group.group_id,
  p_name: GROUP_EXERCISE_NAME,
  p_load_input_mode: 'total_load',
  p_source_exercise_id: SOURCE_EXERCISE_ID,
});
if (!created.exercise || !created.exercise.group_exercise_id) {
  fail('group_exercise_create returned no exercise: ' + JSON.stringify(created));
}

output.linkGroupId = group.group_id;
output.linkGroupExerciseId = created.exercise.group_exercise_id;
console.log(TAG + ' group=' + output.linkGroupId + ' groupExercise=' + output.linkGroupExerciseId);
