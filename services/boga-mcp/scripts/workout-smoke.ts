import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const endpoint = new URL(required('BOGA_MCP_SMOKE_URL'));
const accessToken = required('BOGA_MCP_SMOKE_ACCESS_TOKEN');
const exerciseId = required('BOGA_MCP_SMOKE_EXERCISE_ID');
const mode = required('BOGA_MCP_WORKOUT_SMOKE_MODE');
if (process.env.BOGA_MCP_SMOKE_LOCAL_FIXTURE !== '1' ||
  !['localhost', '127.0.0.1'].includes(endpoint.hostname) || !exerciseId.startsWith('mcp-smoke-')) {
  throw new Error('Workout smoke mutations require the seeded local fixture.');
}
const clients: Client[] = [];
const connect = async (): Promise<Client> => {
  const client = new Client({ name: 'boga-workout-smoke', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  }));
  return client;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const call = async (client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError || !object(result.structuredContent)) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  return result.structuredContent;
};
const deny = async (client: Client, name: string, args: Record<string, unknown>, code: string): Promise<void> => {
  const result = await client.callTool({ name, arguments: args });
  if (!result.isError || !JSON.stringify(result).includes(code)) throw new Error(`${name} did not return ${code}: ${JSON.stringify(result)}`);
};
const key = (intent: string): string => `workout-smoke-${Date.now()}-${intent}`;

async function datedWorkoutFlow(client: Client): Promise<void> {
  const end = new Date(Date.now() - 3600000).toISOString();
  const start = new Date(Date.parse(end) - 3600000).toISOString();
  const input = { started_at: start, completed_at: end, idempotency_key: key('dated-create') };
  const created = await call(client, 'create_workout', input);
  const replay = await call(client, 'create_workout', input);
  if (created.status !== 'completed' || replay.session_id !== created.session_id || replay.idempotent_replay !== true) {
    throw new Error('Dated creation lost lifecycle or retry identity.');
  }
  const logged = await call(client, 'log_sets', { session_id: created.session_id, expected_revision: created.revision,
    exercise_id: exerciseId, sets: [{ weight_kg: '60', reps: 8 }], idempotency_key: key('dated-log') });
  const fresh = await connect();
  const read = await call(fresh, 'get_active_workout', { session_id: created.session_id });
  if (!object(read.workout) || !object(read.workout.control) || read.workout.control.can_edit !== true) {
    throw new Error('Fresh MCP client could not resume dated entry.');
  }
  const finished = await call(fresh, 'finish_workout', { session_id: created.session_id, expected_revision: logged.revision,
    idempotency_key: key('dated-finish') });
  if (finished.started_at !== start || finished.completed_at !== end || finished.duration_seconds !== 3600 ||
    !object(finished.control) || finished.control.can_edit !== false) throw new Error('Dated finish changed dates or retained editing control.');
}

async function workoutFlow(): Promise<void> {
  const client = await connect();
  const headers = await call(client, 'get_active_workout', {});
  if (!Array.isArray(headers.workouts) || headers.workouts.length !== 0 || headers.visibility !== 'server_synced_only') {
    // The smoke owns its fixture (user_g), so active work here is residue of an
    // interrupted smoke run or another suite signing in as it: fail, never clear.
    throw new Error('Local fixture already has active work; refusing to replace it. ' +
      'Only mcp-smoke may use user_g (scripts/tests/mcp-smoke-fixture-user.test.sh); ' +
      'after an interrupted run, `./boga db reset` clears it.');
  }
  const started = await call(client, 'start_workout', { idempotency_key: key('start'), gym_id: required('BOGA_MCP_SMOKE_GYM_ID') });
  const sessionId = String(started.session_id);
  await datedWorkoutFlow(client);
  const firstInput = { session_id: sessionId, expected_revision: started.revision, exercise_id: exerciseId,
    sets: [{ weight_kg: '80', reps: 8, set_type: 'rir_2' }], idempotency_key: key('first') };
  const first = await call(client, 'log_sets', firstInput);
  const replay = await call(client, 'log_sets', firstInput);
  if (!Array.isArray(first.set_ids) || first.set_ids.length !== 1 || replay.idempotent_replay !== true ||
    JSON.stringify(first.set_ids) !== JSON.stringify(replay.set_ids) || first.revision !== replay.revision) {
    throw new Error('A lost-response retry duplicated a set or changed its receipt.');
  }
  const firstSetId = first.set_ids[0];
  const second = await call(client, 'log_sets', { session_id: sessionId, expected_revision: first.revision,
    session_exercise_id: first.session_exercise_id, sets: firstInput.sets, idempotency_key: key('intentional-repeat') });
  if (!Array.isArray(second.set_ids) || second.set_ids[0] === first.set_ids[0]) throw new Error('Intentional repetition was deduplicated.');
  const beforeCorrection = await call(client, 'get_active_workout', { session_id: sessionId, limit: 100 });
  const original = Array.isArray(beforeCorrection.rows)
    ? beforeCorrection.rows.find(row => object(row) && row.id === firstSetId) : null;
  if (!object(original) || !object(beforeCorrection.workout) || original.set_type !== 'rir_2') throw new Error('Persisted set missing before correction.');
  const corrected = await call(client, 'update_set', { session_id: sessionId, expected_revision: beforeCorrection.workout.revision,
    set_id: original.id, set: { weight_kg: '75', reps: Number(original.reps), set_type: original.set_type }, idempotency_key: key('correction') });
  const deleted = await call(client, 'delete_set', { session_id: sessionId, expected_revision: corrected.revision,
    set_id: second.set_ids[0], idempotency_key: key('delete') });

  // A separate SDK Client + transport has no previous assistant response or tool result.
  const fresh = await connect();
  const page1 = await call(fresh, 'get_active_workout', { session_id: sessionId, limit: 1 });
  if (!object(page1.workout) || page1.workout.revision !== deleted.revision || typeof page1.next_cursor !== 'string') {
    throw new Error('Fresh client did not recover the persisted graph and cursor.');
  }
  const page2 = await call(fresh, 'get_active_workout', { session_id: sessionId, limit: 1,
    revision: page1.workout.revision, cursor: page1.next_cursor });
  const rows = Array.isArray(page2.rows) ? page2.rows : [];
  if (rows.length !== 1 || !object(rows[0]) || rows[0].id !== firstSetId || rows[0].weight_kg !== '75' ||
    rows[0].reps !== '8' || rows[0].set_type !== 'rir_2' || page2.next_cursor !== null) {
    throw new Error('Fresh client lost correction/effort, kept a deleted set, or duplicated a page.');
  }
  const finishInput = { session_id: sessionId, expected_revision: page1.workout.revision, idempotency_key: key('finish') };
  const finished = await call(fresh, 'finish_workout', finishInput);
  const finishReplay = await call(fresh, 'finish_workout', finishInput);
  if (finished.status !== 'completed' || typeof finished.completed_at !== 'string' ||
    finishReplay.completed_at !== finished.completed_at || finishReplay.idempotent_replay !== true) throw new Error('Finish did not persist once.');
  await deny(fresh, 'log_sets', { ...firstInput, expected_revision: finished.revision, idempotency_key: key('too-late') }, 'WORKOUT_NOT_ACTIVE');
}

try {
  if (mode === 'run') await workoutFlow();
  else if (mode === 'denied') await deny(await connect(), 'start_workout', { idempotency_key: key('denied') }, 'WORKOUT_PERMISSION_REQUIRED');
  else if (mode === 'revoked') {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'start_workout',
        arguments: { idempotency_key: key('revoked') } } }) });
    if (response.status !== 401 || !response.headers.get('www-authenticate')?.includes('resource_metadata=')) {
      throw new Error('Actually revoked grant did not reject a write with an OAuth challenge.');
    }
  } else throw new Error('Unknown workout smoke mode.');
  console.log(`[boga-mcp-smoke] PASS: workout ${mode}`);
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
}
