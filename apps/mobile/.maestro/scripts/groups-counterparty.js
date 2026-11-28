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
// Contract: docs/specs/tech/groups-contract.md (RPC conventions).
// One file, several steps (runScript files cannot import each other). Every
// call passes env STEP; `sign-in` also passes SUPABASE_URL / SUPABASE_ANON_KEY /
// EMAIL / PASSWORD, `join` passes CODE, `latency` passes LABEL. State is carried
// between calls in `output` (shared by every script of the flow), and the flow
// reads these keys:
//
//   output.groupsCounterpartyUserId  user_d's id (member row testIDs)
//   output.groupsGroupId             the group user_d joined
//   output.groupsCardKey             "<user_d>:<session>" (stream card testIDs)
//   output.groupsFirstSetId          first set of the live session (friend view)
//   output.groupsBoardExerciseId     the active custom group exercise user_d links to
//   output.groupsMeetId              the meet the device scheduled
//   output.groupsDeviceUserId        user_c's id (the device's going row)
//
// The meet steps also act as the device's own user (fixture user_c) from a
// second device: `meet-edit-elsewhere` passes DEVICE_EMAIL / DEVICE_PASSWORD
// and keeps that token for `meet-live`.
//
// Any unexpected response throws, which fails the Maestro step.

/* global STEP, SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL, PASSWORD, DEVICE_EMAIL, DEVICE_PASSWORD, CODE, LABEL, http, json, output */

var TAG = '[groups-counterparty]';
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

function signIn(email, password) {
  var result = post('/auth/v1/token?grant_type=password', null, { email: email, password: password });
  if (result.status !== 200 || !result.body || !result.body.access_token) {
    fail('password sign-in for ' + email + ' failed: HTTP ' + result.status + ' ' + result.raw);
  }
  return { token: result.body.access_token, userId: result.body.user.id };
}

function rpc(token, name, args) {
  return post('/rest/v1/rpc/' + name, token, args, { 'Content-Profile': 'app_public', 'x-boga-sync-protocol': '8', 'x-boga-group-contract': '4' });
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

// runScript has no sleep: busy-wait so a poll loop's deadline is real time,
// not a poll count (a local RPC round trip is only a few ms).
var POLL_INTERVAL_MS = 250;
var POLL_DEADLINE_MS = 90 * 1000;

function pause(ms) {
  var until = Date.now() + ms;
  while (Date.now() < until) {
    // spin
  }
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

var MEET_TITLE = 'Saturday lifting at the riverside gym';
var MEET_FIELDS = ['title', 'starts_at_ms', 'ends_at_ms', 'venue_name', 'address', 'latitude', 'longitude', 'entry_note'];

// group_meet_update as the device's user, from the meet as it stands now with
// `changes` applied; the expected version is the stored one, so it wins.
function updateMeetElsewhere(changes) {
  var current = rpcOk(output.groupsDeviceToken, 'group_meet_get', { p_group_id: output.groupsGroupId, p_meet_id: output.groupsMeetId }).meet;
  var args = { p_group_id: output.groupsGroupId, p_meet_id: output.groupsMeetId, p_expected_version: current.version };
  MEET_FIELDS.forEach(function (key) {
    args['p_' + key] = key in changes ? changes[key] : current[key];
  });
  var written = rpcOk(output.groupsDeviceToken, 'group_meet_update', args).meet;
  if (written.version !== current.version + 1) {
    fail('expected version ' + (current.version + 1) + ', got ' + JSON.stringify(written));
  }
  return written;
}

// The device-scheduled meet's results; waits until `ready` accepts them.
function waitForMeetResults(ready, what) {
  var deadline = Date.now() + POLL_DEADLINE_MS;
  var polls = 0;
  var results;
  for (;;) {
    polls += 1;
    results = rpcOk(output.groupsToken, 'group_meet_results', { p_group_id: output.groupsGroupId, p_meet_id: output.groupsMeetId });
    if (ready(results)) return { results: results, polls: polls };
    if (Date.now() > deadline) {
      fail('no ' + what + ' after ' + polls + ' polls: ' + JSON.stringify(results));
    }
    pause(POLL_INTERVAL_MS);
  }
}

var steps = {
  'sign-in': function () {
    output.groupsSupabaseUrl = SUPABASE_URL;
    output.groupsAnonKey = SUPABASE_ANON_KEY;
    var session = signIn(EMAIL, PASSWORD);
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
    var stream = rpcOk(output.groupsToken, 'group_competition_stream', { p_group_id: joined.group_id, p_before: null, p_limit: 50 });
    var mine = (stream.items || []).filter(function (item) {
      return item.kind === 'membership' && item.event === 'joined' && item.member.user_id === output.groupsCounterpartyUserId;
    });
    if (mine.length !== 1) {
      fail('expected one "joined" item for the counterparty, got ' + JSON.stringify(stream.items));
    }
    output.groupsJoinedAtMs = mine[0].sort_at_ms;
    console.log(TAG + ' joined group ' + joined.group_id + ' with code ' + code);
  },

  // One push: the live, active session. (That a pre-join session is never
  // shared is groups-contract's.)
  'push-active': function () {
    var cuam = nextClientUpdatedAt();
    var startedAt = Math.max(Date.now(), output.groupsJoinedAtMs + 1000);
    var sessionId = 'maestro-groups-' + startedAt;
    var definitionId = sessionId + '-def-bench';
    output.groupsSessionId = sessionId;
    output.groupsSessionStartedAt = startedAt;
    push([
      entity('exercise_definitions', definitionId, cuam, {
        name: 'Bench Press',
        load_input_mode: 'total_load',
        bodyweight_contribution: 0,
        created_at: cuam,
        updated_at: cuam,
        deleted_at: null,
      }),
      // The complete-volume fixture declares both conventional definitions.
      // An unconfigured definition now correctly yields incomplete metrics.
      entity('exercise_definitions', sessionId + '-def-row', cuam, {
        name: 'Barbell Row', load_input_mode: 'total_load', bodyweight_contribution: 0,
        created_at: cuam, updated_at: cuam, deleted_at: null,
      }),
      sessionEntity(sessionId, startedAt, cuam, null),
      sessionExerciseEntity(sessionId + '-bench', sessionId, definitionId, 0, 'Bench Press', cuam),
      sessionExerciseEntity(sessionId + '-row', sessionId, sessionId + '-def-row', 1, 'Barbell Row', cuam),
      benchSet1('100', cuam),
      setEntity(liveSet(2), sessionId + '-bench', 1, '100', '5', cuam),
      setEntity(liveSet(3), sessionId + '-row', 0, '50', '10', cuam),
    ]);
    output.groupsCardKey = output.groupsCounterpartyUserId + ':' + sessionId;
    output.groupsFirstSetId = liveSet(1);
    console.log(TAG + ' pushed active session ' + sessionId + ' (3 sets, 1500 kg, 2 exercises)');
  },

  // Complete the session (45 min), then — a separate, later write — edit the
  // first bench set 100 → 102.5 kg, which the card's volume must reflect.
  'push-complete-edit': function () {
    var startedAt = output.groupsSessionStartedAt;
    push([sessionEntity(output.groupsSessionId, startedAt, nextClientUpdatedAt(), startedAt + DURATION_SEC * 1000)]);
    push([benchSet1('102.5', nextClientUpdatedAt())]);
    console.log(TAG + ' completed and edited session ' + output.groupsSessionId + ' (1513 kg)');
  },

  // The time from the last sync_push to the card showing on the device.
  // Called right after the flow's wait for the card succeeds, so it includes
  // the pull-to-refresh round trip and Maestro's own polling.
  latency: function () {
    var elapsed = Date.now() - output.groupsPushedAtMs;
    output['groupsLatency_' + LABEL] = elapsed;
    console.log(TAG + ' GROUPS_E2E_LATENCY ' + LABEL + ' sync_push->card visible: ' + elapsed + ' ms');
  },

  // user_d links its pushed Bench Press (total load) to the device's
  // active custom group exercise, Sled Push (per side), with a sync_push like
  // its own app would. Its completed sets from before the link then count as a
  // link effect (contract). Waits until the evaluator has written the
  // board, so the device reads the completed 102.5 × 5 set as 512.5 kg·reps, uncertified.
  'link-board': function () {
    var list = rpcOk(output.groupsToken, 'group_competition_exercise_list', { p_group_id: output.groupsGroupId });
    var targets = (list.exercises || []).filter(function (exercise) {
      return exercise.name === 'Sled Push' && exercise.archived_at_ms === null;
    });
    if (targets.length !== 1) {
      fail('expected one active Sled Push, got ' + JSON.stringify(list.exercises));
    }
    var groupExerciseId = targets[0].group_exercise_id;
    output.groupsBoardExerciseId = groupExerciseId;

    var cuam = nextClientUpdatedAt();
    var definitionId = output.groupsSessionId + '-def-bench';
    push([
      entity('exercise_group_links', output.groupsGroupId + ':' + definitionId, cuam, {
        exercise_definition_id: definitionId,
        group_id: output.groupsGroupId,
        group_exercise_id: groupExerciseId,
        created_at: cuam,
        updated_at: cuam,
        deleted_at: null,
      }),
    ]);

    // The pg_net kick normally applies within seconds; the pg_cron sweep (5 min)
    // backs it up. Polls every POLL_INTERVAL_MS until a row or the deadline.
    // push() stamps groupsPushedAtMs, so the latency below is from the link push.
    var deadline = Date.now() + POLL_DEADLINE_MS;
    var polls = 0;
    var board;
    for (;;) {
      polls += 1;
      board = rpcOk(output.groupsToken, 'group_competition_board', {
        p_group_id: output.groupsGroupId,
        p_group_exercise_id: groupExerciseId,
        p_metric: 'volume',
        p_certified: false,
        p_cursor: null,
        p_limit: 10,
      });
      if (board.entries && board.entries.length > 0) break;
      if (Date.now() > deadline) {
        fail('no board row after the link push (' + polls + ' polls)');
      }
      pause(POLL_INTERVAL_MS);
    }
    var row = board.entries[0];
    var boardValue = Number(row.value);
    var boardReps = Number(row.performance.reps);
    var boardWeightValue = Number(row.performance.weight_value);

    if (
      board.entries.length !== 1 ||
      row.member.user_id !== output.groupsCounterpartyUserId ||
      boardValue !== 512.5 ||
      row.unit !== 'kg_reps' ||
      boardReps !== 5 ||
      boardWeightValue !== 102.5 ||
      row.performance.source_load_input_mode !== 'total_load' ||
      row.certification !== null
    ) {
      fail('unexpected Volume · All board: ' + JSON.stringify(board.entries));
    }
    console.log(
      TAG + ' GROUPS_E2E_LATENCY board sync_push->board row: ' + (Date.now() - output.groupsPushedAtMs) + ' ms (' + polls + ' polls)',
    );
  },

  // A second device of the device's own user (user_c) changes the venue while
  // the device has the edit form open, so the device's save is a stale write.
  'meet-edit-elsewhere': function () {
    var device = signIn(DEVICE_EMAIL, DEVICE_PASSWORD);
    output.groupsDeviceToken = device.token;
    output.groupsDeviceUserId = device.userId;
    var list = rpcOk(output.groupsDeviceToken, 'group_meet_list', { p_group_id: output.groupsGroupId, p_before: null, p_limit: 20 });
    var meets = (list.upcoming || []).filter(function (meet) {
      return meet.title === MEET_TITLE;
    });
    if (meets.length !== 1) {
      fail('expected one upcoming "' + MEET_TITLE + '", got ' + JSON.stringify(list));
    }
    output.groupsMeetId = meets[0].meet_id;
    var written = updateMeetElsewhere({ venue_name: 'Riverside annex' });
    console.log(TAG + ' edited meet ' + output.groupsMeetId + ' elsewhere (version ' + written.version + ')');
  },

  // The test clock: the second device moves the meet's start just before the
  // counterparty's session started (an owner may move a meet that has not
  // started into the past), so the meet is Live and that session overlaps it.
  // The real edit RPC with seeded times: no test-only server path. The join
  // time is the server's, so the start is past on both clocks whatever the
  // host/VM skew.
  'meet-live': function () {
    var startsAt = Math.min(Date.now(), output.groupsSessionStartedAt, output.groupsJoinedAtMs) - 60 * 1000;
    var written = updateMeetElsewhere({ starts_at_ms: startsAt, ends_at_ms: Date.now() + 2 * 3600 * 1000 });
    if (written.state !== 'live') {
      fail('expected a live meet, got ' + JSON.stringify(written));
    }
    console.log(TAG + ' meet ' + output.groupsMeetId + ' is live from ' + startsAt);
  },

  // user_d joins its completed session to the meet with the Sync v2 link, as
  // its recorder would (no online join), then waits until the live results
  // rank that session's Sled Push set on the meet's one challenge.
  'meet-link': function () {
    var cuam = nextClientUpdatedAt();
    var meetId = output.groupsMeetId.toLowerCase();
    push([
      entity('session_meet_links', meetId + ':' + output.groupsSessionId, cuam, {
        session_id: output.groupsSessionId,
        meet_id: meetId,
        created_at: cuam,
        updated_at: cuam,
        deleted_at: null,
      }),
    ]);
    var waited = waitForMeetResults(function (results) {
      return results.challenges.length === 1 && results.challenges[0].standings.some(function (row) {
        return row.member.user_id === output.groupsCounterpartyUserId;
      });
    }, 'live standings row for the counterparty');
    var results = waited.results;
    var standings = results.challenges[0].standings;
    if (results.results.state !== 'live' || standings.length !== 1 || standings[0].place !== 1 ||
        results.sessions.length !== 1 || results.sessions[0].session_id !== output.groupsSessionId) {
      fail('unexpected live results: ' + JSON.stringify(results));
    }
    // The roster union: on the roster by the counting link alone.
    var roster = rpcOk(output.groupsToken, 'group_meet_get', { p_group_id: output.groupsGroupId, p_meet_id: output.groupsMeetId }).roster;
    var mine = roster.filter(function (row) {
      return row.member.user_id === output.groupsCounterpartyUserId;
    });
    if (mine.length !== 1 || mine[0].joined !== false || mine[0].linked !== true) {
      fail('expected the counterparty on the roster by its link only, got ' + JSON.stringify(roster));
    }
    console.log(TAG + ' GROUPS_E2E_LATENCY meet sync_push->standings row: ' + (Date.now() - output.groupsPushedAtMs) + ' ms (' + waited.polls + ' polls)');
  },
};

if (!steps[STEP]) {
  fail('unknown step');
}
steps[STEP]();
