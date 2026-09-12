// groups-counterparty.js — the scripted counterparty (fixture user_d) of the
// two-user groups flow (`flows/groups-two-user-stream.yaml`, lane
// ios-groups-e2e). Runs inside Maestro's `runScript` JS engine and talks to the
// lane's local Supabase over HTTP, exactly as the app does:
//
//   - GoTrue password sign-in: POST /auth/v1/token?grant_type=password
//   - group RPCs:  POST /rest/v1/rpc/<name>  (Content-Profile: app_public)
//   - sync_push of a session graph (the Sync v2 envelope; the share trigger
//     then puts the session in the group record)
//
// Contract: docs/specs/tech/groups-contract.md §4 (RPC shapes) and §8.
// One file, several steps (runScript files cannot import each other). Every
// call passes env STEP; `sign-in` also passes SUPABASE_URL / SUPABASE_ANON_KEY /
// EMAIL / PASSWORD, `join` passes CODE, `latency` passes LABEL. State is carried
// between calls in `output` (shared by every script of the flow), and the flow
// reads these keys:
//
//   output.groupsCounterpartyUserId  user_d's id (member row testIDs)
//   output.groupsGroupId             the group user_d joined
//   output.groupsCardKey             "<user_d>:<session>" (stream card testIDs)
//   output.groupsHistoryCardKey      the pre-join session's would-be card key
//   output.groupsFirstSetId          first set of the live session (friend view)
//
// Any unexpected response throws, which fails the Maestro step.

/* global STEP, SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL, PASSWORD, CODE, LABEL, http, json, output */

var TAG = '[groups-counterparty]';
var MINUTE_MS = 60 * 1000;
var DAY_MS = 24 * 60 * MINUTE_MS;
var DURATION_SEC = 45 * 60;

function fail(message) {
  throw new Error(TAG + ' ' + STEP + ': ' + message);
}

function parse(response) {
  try {
    return json(response.body);
  } catch (error) {
    return null;
  }
}

function post(path, token, body, extraHeaders) {
  var headers = {
    apikey: output.groupsAnonKey,
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }
  for (var key in extraHeaders || {}) {
    headers[key] = extraHeaders[key];
  }
  var response = http.post(output.groupsSupabaseUrl + path, { headers: headers, body: JSON.stringify(body) });
  return { status: response.status, body: parse(response), raw: response.body };
}

function signIn() {
  var result = post('/auth/v1/token?grant_type=password', null, { email: EMAIL, password: PASSWORD });
  if (result.status !== 200 || !result.body || !result.body.access_token) {
    fail('password sign-in for ' + EMAIL + ' failed: HTTP ' + result.status + ' ' + result.raw);
  }
  return { token: result.body.access_token, userId: result.body.user.id };
}

function rpc(token, name, args) {
  return post('/rest/v1/rpc/' + name, token, args, { 'Content-Profile': 'app_public' });
}

function rpcOk(token, name, args) {
  var result = rpc(token, name, args);
  if (result.status !== 200) {
    fail(name + ' failed: HTTP ' + result.status + ' ' + result.raw);
  }
  return result.body;
}

// A strictly increasing client_updated_at_ms, so every push wins LWW.
function nextClientUpdatedAt() {
  var next = Math.max(Date.now(), (output.groupsLastCuam || 0) + 1);
  output.groupsLastCuam = next;
  return next;
}

function entity(type, id, cuam, fields) {
  return { type: type, id: id, client_updated_at_ms: cuam, fields: fields };
}

function sessionEntity(id, startedAt, cuam, completedAt) {
  return entity('sessions', id, cuam, {
    gym_id: null,
    status: completedAt === null ? 'active' : 'completed',
    started_at: startedAt,
    completed_at: completedAt,
    duration_sec: completedAt === null ? null : Math.round((completedAt - startedAt) / 1000),
    created_at: startedAt,
    updated_at: cuam,
    deleted_at: null,
  });
}

function sessionExerciseEntity(id, sessionId, definitionId, orderIndex, name, cuam) {
  return entity('session_exercises', id, cuam, {
    session_id: sessionId,
    exercise_definition_id: definitionId,
    order_index: orderIndex,
    name: name,
    machine_name: null,
    created_at: cuam,
    updated_at: cuam,
    deleted_at: null,
  });
}

function setEntity(id, sessionExerciseId, orderIndex, weight, reps, cuam) {
  return entity('exercise_sets', id, cuam, {
    session_exercise_id: sessionExerciseId,
    order_index: orderIndex,
    weight_value: weight,
    reps_value: reps,
    set_type: 'working',
    planned_weight_value: null,
    planned_reps_value: null,
    planned_set_type: null,
    performance_status: null,
    created_at: cuam,
    updated_at: cuam,
    deleted_at: null,
  });
}

function push(entities) {
  var result = rpc(output.groupsToken, 'sync_push', { entities: entities });
  if (result.status !== 200 || !result.body || result.body.ok !== true) {
    fail('sync_push failed: HTTP ' + result.status + ' ' + result.raw);
  }
  output.groupsPushedAtMs = Date.now();
}

function liveSet(index) {
  return output.groupsSessionId + '-set-' + index;
}

// The live session's first bench set (the one the edit changes).
function benchSet1(weight, cuam) {
  return setEntity(liveSet(1), output.groupsSessionId + '-bench', 0, weight, '5', cuam);
}

var steps = {
  'sign-in': function () {
    output.groupsSupabaseUrl = SUPABASE_URL;
    output.groupsAnonKey = SUPABASE_ANON_KEY;
    var session = signIn();
    output.groupsToken = session.token;
    output.groupsCounterpartyUserId = session.userId;
    console.log(TAG + ' signed in as ' + EMAIL + ' (' + session.userId + ')');
  },

  // Joins with the code the device read off its invite screen. On iOS the
  // copied text can be the element's accessibility label ("Invite code A B …");
  // keep the 8 code characters only (the server also normalizes spaces).
  join: function () {
    var code = String(CODE).replace(/^\s*invite code/i, '').replace(/[\s-]/g, '');
    if (!/^[0-9A-Z]{8}$/.test(code)) {
      fail('could not read an 8-character invite code from "' + CODE + '"');
    }
    var joined = rpcOk(output.groupsToken, 'group_join', { p_code: code });
    if (joined.joined !== true) {
      fail('expected a new membership, got ' + JSON.stringify(joined));
    }
    output.groupsGroupId = joined.group_id;
    // The share rule compares started_at with the server's joined_at: read it
    // back from our own "joined" stream item so the live session can never
    // start before it, whatever the host/VM clock skew.
    var stream = rpcOk(output.groupsToken, 'group_stream', { p_group_id: joined.group_id, p_before: null, p_limit: 50 });
    var mine = (stream.items || []).filter(function (item) {
      return item.kind === 'membership' && item.event === 'joined' && item.member.user_id === output.groupsCounterpartyUserId;
    });
    if (mine.length !== 1) {
      fail('expected one "joined" item for the counterparty, got ' + JSON.stringify(stream.items));
    }
    output.groupsJoinedAtMs = mine[0].sort_at_ms;
    console.log(TAG + ' joined group ' + joined.group_id + ' with code ' + code);
  },

  // One push: a completed pre-join history session (never shared: the flow
  // asserts it has no card, §2.5) and the live, active session.
  'push-active': function () {
    var cuam = nextClientUpdatedAt();
    var startedAt = Math.max(Date.now(), output.groupsJoinedAtMs + 1000);
    var sessionId = 'maestro-groups-' + startedAt;
    var historyId = sessionId + '-history';
    var historyStart = output.groupsJoinedAtMs - DAY_MS;
    var definitionId = sessionId + '-def-bench';
    output.groupsSessionId = sessionId;
    output.groupsSessionStartedAt = startedAt;
    push([
      entity('exercise_definitions', definitionId, cuam, {
        name: 'Bench Press',
        created_at: cuam,
        updated_at: cuam,
        deleted_at: null,
      }),
      sessionEntity(historyId, historyStart, cuam, historyStart + DURATION_SEC * 1000),
      sessionExerciseEntity(historyId + '-bench', historyId, definitionId, 0, 'Bench Press', cuam),
      setEntity(historyId + '-set-1', historyId + '-bench', 0, '100', '5', cuam),
      sessionEntity(sessionId, startedAt, cuam, null),
      sessionExerciseEntity(sessionId + '-bench', sessionId, definitionId, 0, 'Bench Press', cuam),
      sessionExerciseEntity(sessionId + '-row', sessionId, null, 1, 'Barbell Row', cuam),
      benchSet1('100', cuam),
      setEntity(liveSet(2), sessionId + '-bench', 1, '100', '5', cuam),
      setEntity(liveSet(3), sessionId + '-row', 0, '50', '10', cuam),
    ]);
    output.groupsCardKey = output.groupsCounterpartyUserId + ':' + sessionId;
    output.groupsHistoryCardKey = output.groupsCounterpartyUserId + ':' + historyId;
    output.groupsFirstSetId = liveSet(1);
    console.log(TAG + ' pushed active session ' + sessionId + ' (3 sets, 1500 kg, 2 exercises)');
  },

  // Complete the session (45 min), then — a separate, later write — edit the
  // first bench set 100 → 102.5 kg, which the card's volume must reflect.
  'push-complete-edit': function () {
    var startedAt = output.groupsSessionStartedAt;
    push([sessionEntity(output.groupsSessionId, startedAt, nextClientUpdatedAt(), startedAt + DURATION_SEC * 1000)]);
    push([benchSet1('102.5', nextClientUpdatedAt())]);
    console.log(TAG + ' completed and edited session ' + output.groupsSessionId + ' (1512.5 kg)');
  },

  // AC4: the time from the last sync_push to the card showing on the device.
  // Called right after the flow's wait for the card succeeds, so it includes
  // the pull-to-refresh round trip and Maestro's own polling.
  latency: function () {
    var elapsed = Date.now() - output.groupsPushedAtMs;
    output['groupsLatency_' + LABEL] = elapsed;
    console.log(TAG + ' GROUPS_E2E_LATENCY ' + LABEL + ' sync_push->card visible: ' + elapsed + ' ms');
  },

  // AC11: once removed, the counterparty's next read of the group is NOT_FOUND.
  'assert-removed': function () {
    var result = rpc(output.groupsToken, 'group_stream', { p_group_id: output.groupsGroupId, p_before: null, p_limit: 20 });
    var message = result.body && result.body.message ? String(result.body.message) : '';
    if (result.status === 200 || message.indexOf('NOT_FOUND:') !== 0) {
      fail('expected NOT_FOUND after removal, got HTTP ' + result.status + ' ' + result.raw);
    }
    console.log(TAG + ' removed counterparty group_stream -> HTTP ' + result.status + ' ' + message);
  },
};

if (!steps[STEP]) {
  fail('unknown step');
}
steps[STEP]();
