import { createHash, createHmac } from 'node:crypto';
import { createInMemoryDatabase } from '../helpers/in-memory-db';
import { applyPullPage, type WireEntity } from '@/src/sync/cycle';
import type { Transaction } from '@/src/data/clock';
import type { EntityTableName } from '@/src/sync/topo-order';

import {
  createAuthedTestClient, readSyncTestEndpoint, USER_E, type AuthedTestClient,
} from './helpers/sync-test-endpoint';

type Entity = { type: string; id: string; client_updated_at_ms: number; fields: Record<string, unknown>;
  lifecycle_action?: { id: string; base_revision: number } };
type Preview = { token: string; setCount: number; factor: number };
type Receipt = { id: string; sequence: number };
type Review = { id: string; entityId: string; token: string; saved: Record<string, unknown>; current: Record<string, unknown> | null };
const endpoint = readSyncTestEndpoint();
let workoutClient: string;
let workoutGrant: string;
let account: AuthedTestClient;
let other: AuthedTestClient;
let serial = 0;
let isolatedUserId: string;
async function adminUser(method: string, path: string, body?: unknown) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(endpoint.url).hostname)) throw new Error('Local endpoint required');
  const key = process.env.SYNC_TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Run through boga test sync-infra');
  const response = await fetch(endpoint.url + '/auth/v1/admin/users' + path, {
    method, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Local fixture admin failed: ' + response.status);
  return response.json() as Promise<{ id: string }>;
}
async function serviceRequest(path: string, body: Record<string, unknown>) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(endpoint.url).hostname)) throw new Error('Local endpoint required');
  const key = process.env.SYNC_TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Run through boga test sync-infra');
  const response = await fetch(endpoint.url + '/rest/v1/' + path, {
    method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json', ...(path.startsWith('rpc/') ? { 'Content-Profile': 'app_public' } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Service fixture failed: ' + await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function workoutState(sessionId: string): Promise<{ workout: { revision: string; status: string } }> {
  return serviceRequest('rpc/agent_workout_read', {
    p_owner: isolatedUserId, p_client_id: workoutClient, p_granted_at: workoutGrant, p_session_id: sessionId,
  });
}
async function workoutWrite(operation: string, input: Record<string, unknown>) {
  return serviceRequest('rpc/agent_workout_mutate', {
    p_owner: isolatedUserId, p_client_id: workoutClient, p_granted_at: workoutGrant, p_operation: operation,
    p_input: input, p_idempotency_key: prefix(), p_payload_sha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
  });
}
const prefix = () => 'merge-' + Date.now() + '-' + (++serial) + '-' + Math.random().toString(36).slice(2);
const times = (stamp: number) => ({ created_at: stamp, updated_at: stamp, deleted_at: null });

async function authorizeWorkoutClient() {
  const redirect = 'http://127.0.0.1:3000/callback';
  const registration = await fetch(endpoint.url + '/auth/v1/oauth/clients/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: prefix(), redirect_uris: [redirect], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'], response_types: ['code'] }),
  });
  if (!registration.ok) throw new Error('Local OAuth registration failed: ' + registration.status);
  workoutClient = (await registration.json() as { client_id: string }).client_id;
  const query = new URLSearchParams({ client_id: workoutClient, redirect_uri: redirect, response_type: 'code',
    scope: 'openid profile', code_challenge: createHash('sha256').update(prefix().repeat(2)).digest('base64url'), code_challenge_method: 'S256' });
  const authorization = await fetch(endpoint.url + '/auth/v1/oauth/authorize?' + query, { redirect: 'manual' });
  const id = new URL(authorization.headers.get('location')!, endpoint.url).searchParams.get('authorization_id');
  if (authorization.status !== 302 || !id) throw new Error('Local OAuth authorization did not return a consent request');
  const details = await fetch(endpoint.url + '/auth/v1/oauth/authorizations/' + id, {
    headers: { apikey: endpoint.anonKey, Authorization: 'Bearer ' + account.jwt },
  });
  if (!details.ok || (await details.json() as { client: { id: string } }).client.id !== workoutClient) {
    throw new Error('Local OAuth consent details unavailable');
  }
  const consent = await fetch(endpoint.url + '/auth/v1/oauth/authorizations/' + id + '/consent', {
    method: 'POST', headers: { apikey: endpoint.anonKey, Authorization: 'Bearer ' + account.jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  });
  if (!consent.ok) throw new Error('Local OAuth consent failed: ' + consent.status);
  const grantsResponse = await fetch(endpoint.url + '/auth/v1/user/oauth/grants', {
    headers: { apikey: endpoint.anonKey, Authorization: 'Bearer ' + account.jwt },
  });
  type Grant = { client?: { id: string }; client_id?: string; granted_at: string };
  const data = await grantsResponse.json() as { grants: Grant[] } | Grant[];
  const grant = (Array.isArray(data) ? data : data.grants)?.find(item => (item.client_id ?? item.client?.id) === workoutClient);
  if (!grantsResponse.ok || !grant) throw new Error('Local workout grant unavailable');
  workoutGrant = grant.granted_at;
}

async function control(sessionId: string, ai: boolean) {
  const current = (await row('sessions', sessionId))!;
  return rpc<{ revision: number }>('workout_set_control', { p_id: 'control:' + prefix(), p_session_id: sessionId,
    p_base_revision: current.merge_revision, p_client_id: ai ? workoutClient : null, p_granted_at: ai ? workoutGrant : null });
}

async function rpc<T>(name: string, args: Record<string, unknown>, client = account.client): Promise<T> {
  const result = await client.schema('app_public').rpc(name, args) as { data: T; error: { message: string } | null };
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function push(entities: Entity[]) {
  let last: { outcomes: { id: string; outcome: string }[] } = { outcomes: [] };
  for (let index = 0; index < entities.length; index += 200) {
    last = await rpc('sync_push', { entities: entities.slice(index, index + 200) });
  }
  return last;
}
async function row(type: string, id: string, token = account.jwt): Promise<Record<string, unknown> | null> {
  const response = await fetch(endpoint.url + '/rest/v1/' + type + '?id=eq.' + encodeURIComponent(id) + '&select=*', {
    headers: { apikey: endpoint.anonKey, Authorization: 'Bearer ' + token, 'Accept-Profile': 'app_public' },
  });
  if (!response.ok) throw new Error('Read failed: ' + response.status);
  const values = await response.json() as Record<string, unknown>[];
  return values[0] ?? null;
}
async function chain(input: { count?: number; sourceMode?: string; targetMode?: string; weight?: string } = {}) {
  const id = prefix(), stamp = Date.now();
  const source = id + '-a', destination = id + '-b', session = id + '-session', block = id + '-block';
  const definition = (key: string, name: string, mode: string): Entity => ({
    type: 'exercise_definitions', id: key, client_updated_at_ms: stamp, fields: {
      name, load_input_mode: mode, bodyweight_contribution: 0, split_by_gym: false, rest_timer_sec: null, ...times(stamp),
    },
  });
  const entities: Entity[] = [
    definition(source, 'Source', input.sourceMode ?? 'total_load'),
    definition(destination, 'Destination', input.targetMode ?? 'per_side_load'),
    { type: 'sessions', id: session, client_updated_at_ms: stamp, fields: {
      gym_id: null, source_plan_id: null, status: 'completed', started_at: stamp - 60000, completed_at: stamp,
      duration_sec: 60, ...times(stamp),
    }},
    { type: 'session_exercises', id: block, client_updated_at_ms: stamp, fields: {
      session_id: session, exercise_definition_id: source, name: 'Source', machine_name: null,
      source_plan_exercise_id: null, order_index: 0, merge_revision: 0, ...times(stamp),
    }},
  ];
  const sets = Array.from({ length: input.count ?? 1 }, (_, index): Entity => ({
    type: 'exercise_sets', id: id + '-set-' + index, client_updated_at_ms: stamp, fields: {
      session_exercise_id: block, source_plan_set_id: null, order_index: index, weight_value: input.weight ?? '10.125',
      reps_value: '5', set_type: index === 0 ? 'warm_up' : null, planned_weight_value: '20.25',
      planned_reps_value: '8', planned_set_type: null, performance_status: null, merge_revision: 0, ...times(stamp),
    },
  }));
  entities.push(...sets);
  await push(entities);
  return { id, source, destination, session, block, entities, sets };
}
async function merge(c: Awaited<ReturnType<typeof chain>>, id = c.id + '-operation') {
  const preview = await rpc<Preview>('exercise_merge_preview', { p_source: c.source, p_destination: c.destination });
  const receipt = await rpc<Receipt>('exercise_merge_execute', { p_id: id, p_source: c.source, p_destination: c.destination, p_token: preview.token });
  return { preview, receipt, id };
}
async function reviews(): Promise<Review[]> {
  const items: Review[] = [];
  for (;;) {
    const page = await rpc<{ items: Review[]; hasMore: boolean }>('exercise_merge_review', { p_offset: items.length });
    items.push(...page.items);
    if (!page.hasMore) return items;
    if (!page.items.length) throw new Error('Review pagination stalled');
  }
}
beforeAll(async () => {
  const credentials = { email: prefix() + '@example.test', password: 'MergeFixture!234' };
  isolatedUserId = (await adminUser('POST', '', { ...credentials, email_confirm: true })).id;
  account = await createAuthedTestClient(endpoint, credentials);
  other = await createAuthedTestClient(endpoint, USER_E);
  await authorizeWorkoutClient();
  await serviceRequest('agent_workout_permissions', {
    owner_user_id: isolatedUserId, client_id: workoutClient, granted_at: workoutGrant, workout_logging_enabled: true,
  });
});
afterAll(async () => {
  await account?.teardown(); await other?.teardown();
  if (isolatedUserId) await adminUser('DELETE', '/' + isolatedUserId);
  if (workoutClient) {
    const key = process.env.SYNC_TEST_SUPABASE_SERVICE_ROLE_KEY!;
    const response = await fetch(endpoint.url + '/auth/v1/admin/oauth/clients/' + workoutClient,
      { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!response.ok) throw new Error('Local OAuth fixture cleanup failed: ' + response.status);
  }
});

async function activeWorkout() {
  const c = await chain();
  await push([{ ...c.entities[2], client_updated_at_ms: Date.now() + 1000,
    fields: { ...c.entities[2].fields, status: 'active', completed_at: null, duration_sec: null, merge_revision: 0 } }]);
  await control(c.session, true);
  return c;
}

it('restores incrementally entered dated history with its control, dates and fenced set graph', async () => {
  const c = await chain();
  const end = Date.now() - 3600000, start = end - 3600000;
  const created = await workoutWrite('create_workout', { started_at: start, completed_at: end, gym_id: null });
  const logged = await workoutWrite('log_sets', { session_id: created.session_id, expected_revision: created.revision,
    exercise_id: c.source, sets: [{ weight_kg: '80', reps: 8, set_type: null }] });
  const snapshot = await rpc<{ rows: Entity[] }>('exercise_merge_snapshot', { p_after: 0 });
  const local = createInMemoryDatabase();
  try {
    local.database.transaction(tx => {
      for (const incoming of snapshot.rows) applyPullPage(tx as unknown as Transaction,
        [incoming as WireEntity], incoming.type as EntityTableName, true);
    });
    expect(local.client.pragma('foreign_key_check')).toEqual([]);
    expect(local.client.prepare('select status, started_at, completed_at, duration_sec, logging_client_id, merge_revision from sessions where id=?').get(created.session_id))
      .toEqual({ status: 'completed', started_at: start, completed_at: end, duration_sec: 3600, logging_client_id: workoutClient, merge_revision: 2 });
    expect(local.client.prepare('select weight_value, merge_revision from exercise_sets where id=?').get(logged.set_ids[0]))
      .toEqual({ weight_value: '80', merge_revision: 2 });
  } finally { local.close(); }
  await workoutWrite('finish_workout', { session_id: created.session_id, expected_revision: logged.revision });
  expect(await row('sessions', created.session_id)).toMatchObject({ status: 'completed', started_at: start,
    completed_at: end, duration_sec: 3600, logging_client_id: null, merge_revision: 3 });
});

it('fences a chat-finished session and every set before LWW, even against a future-clock stale phone graph', async () => {
  const c = await activeWorkout();
  let state = await workoutState(c.session);
  const logged = await workoutWrite('log_sets', { session_id: c.session, expected_revision: state.workout.revision,
    session_exercise_id: c.block, sets: [{ weight_kg: '80', reps: 8, set_type: null }] });
  state = await workoutState(c.session);
  await workoutWrite('finish_workout', { session_id: c.session, expected_revision: state.workout.revision });
  const stale = [c.entities[2], c.entities[3], c.sets[0]].map(entity => ({ ...entity,
    client_updated_at_ms: Date.now() + 86400000, fields: { ...entity.fields, merge_revision: 0,
      ...(entity.type === 'sessions' ? { status: 'active', completed_at: null } : { deleted_at: Date.now() }) } }));
  expect((await push(stale)).outcomes.every(outcome => outcome.outcome === 'preserved')).toBe(true);
  expect(await row('sessions', c.session)).toMatchObject({ status: 'completed', merge_revision: 3 });
  expect(await row('exercise_sets', c.sets[0].id)).toMatchObject({ weight_value: '10.125', deleted_at: null, merge_revision: 3 });
  expect(await row('exercise_sets', logged.set_ids[0])).toMatchObject({ weight_value: '80', deleted_at: null, merge_revision: 3 });
});

it('commits a protected phone finish once, reports its receipt, and preserves a competing old lifecycle action', async () => {
  const c = await activeWorkout();
  const state = await workoutState(c.session);
  await workoutWrite('log_sets', { session_id: c.session, expected_revision: state.workout.revision,
    session_exercise_id: c.block, sets: [{ weight_kg: '80', reps: 8, set_type: null }] });
  await control(c.session, false);
  const current = (await row('sessions', c.session))!;
  const { owner_user_id: _owner, client_updated_at_ms: _clock, server_received_at: _received, id: _id, ...fields } = current;
  const completed = Date.now() + 2000;
  const action: Entity = { type: 'sessions', id: c.session, client_updated_at_ms: completed,
    lifecycle_action: { id: 'lifecycle:' + prefix(), base_revision: 3 },
    fields: { ...fields, status: 'completed', completed_at: completed,
      duration_sec: Math.floor((completed - Number(fields.started_at)) / 1000), updated_at: completed } };
  expect((await push([action])).outcomes[0].outcome).toBe('accepted');
  expect(await row('sessions', c.session)).toMatchObject({ status: 'completed', merge_revision: 4 });
  const receipt = await rpc('exercise_merge_status', { p_id: action.lifecycle_action!.id, p_row: { ...action.fields, id: c.session } });
  expect(receipt).toMatchObject({ id: action.lifecycle_action!.id, sessionId: c.session, workoutRevision: 4, matchesInput: true });
  expect((await push([action])).outcomes[0].outcome).toBe('accepted');
  expect((await row('sessions', c.session))?.merge_revision).toBe(4);
  await expect(push([{ ...action, fields: { ...action.fields, started_at: Number(fields.started_at) + 1 } }]))
    .rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  expect((await push([{ ...action, lifecycle_action: { id: 'lifecycle:' + prefix(), base_revision: 3 },
    fields: { ...fields, status: 'active', completed_at: null, duration_sec: null } }])).outcomes[0].outcome).toBe('preserved');
  expect(await row('sessions', c.session)).toMatchObject({ status: 'completed', merge_revision: 4 });
  await push([{ ...c.sets[0], client_updated_at_ms: Date.now() + 9000,
    fields: { ...c.sets[0].fields, weight_value: '19' } }]);
  const savedSet = (await reviews()).find(item => item.entityId === c.sets[0].id)!;
  await rpc('exercise_merge_resolve', { p_id: savedSet.id, p_keep: false, p_token: savedSet.token });
  expect(await row('sessions', c.session)).toMatchObject({ status: 'completed', merge_revision: 5 });
  expect(await row('exercise_sets', c.sets[0].id)).toMatchObject({ weight_value: '19', merge_revision: 5 });
  expect((await push([{ ...action, lifecycle_action: { id: 'lifecycle:' + prefix(), base_revision: 4 },
    fields: { ...action.fields, merge_revision: 4, deleted_at: Date.now() } }])).outcomes[0].outcome).toBe('preserved');
  expect((await row('sessions', c.session))?.deleted_at).toBeNull();
  const completedRow = (await row('sessions', c.session))!;
  const { owner_user_id: _owner2, client_updated_at_ms: _clock2, server_received_at: _received2, id: _id2, ...completedFields } = completedRow;
  await push([{ type: 'sessions', id: c.session, client_updated_at_ms: Date.now() + 12000,
    lifecycle_action: { id: 'lifecycle:' + prefix(), base_revision: 5 },
    fields: { ...completedFields, status: 'active', completed_at: null, duration_sec: null } }]);
  const savedEnd = completed + 1000;
  await push([{ type: 'sessions', id: c.session, client_updated_at_ms: Date.now() + 13000,
    fields: { ...completedFields, completed_at: savedEnd, duration_sec: Math.floor((savedEnd - Number(completedFields.started_at)) / 1000) } }]);
  const deferred = (await reviews()).find(item => item.entityId === c.session && item.saved?.completed_at === savedEnd)!;
  expect(deferred).toMatchObject({ invalid: true, saved: { completed_at: savedEnd },
    notice: 'Finish this workout in the app before applying its saved Start and End.' });
  const reopened = (await row('sessions', c.session))!;
  const end = Date.now() + 14000;
  await push([{ type: 'sessions', id: c.session, client_updated_at_ms: end,
    lifecycle_action: { id: 'lifecycle:' + prefix(), base_revision: Number(reopened.merge_revision) },
    fields: { ...completedFields, merge_revision: reopened.merge_revision, status: 'completed', completed_at: end,
      duration_sec: Math.floor((end - Number(reopened.started_at)) / 1000) } }]);
  const ready = (await reviews()).find(item => item.id === deferred.id)!;
  expect(ready).toMatchObject({ invalid: false, saved: { completed_at: savedEnd } });
});

it('accepts an app exercise and sets after explicit takeover of chat logging', async () => {
  const c = await activeWorkout();
  const state = await workoutState(c.session);
  await workoutWrite('log_sets', { session_id: c.session, expected_revision: state.workout.revision,
    session_exercise_id: c.block, sets: [{ weight_kg: '80', reps: 8, set_type: null }] });
  await control(c.session, false);
  const block: Entity = { ...c.entities[3], id: c.id + '-app-block', client_updated_at_ms: Date.now() + 3000,
    fields: { ...c.entities[3].fields, merge_revision: 3, order_index: 1 } };
  const set: Entity = { ...c.sets[0], id: c.id + '-app-set', client_updated_at_ms: Date.now() + 3000,
    fields: { ...c.sets[0].fields, session_exercise_id: block.id, merge_revision: 3 } };
  expect((await push([block, set])).outcomes.every(result => result.outcome === 'accepted')).toBe(true);
  expect(await row('exercise_sets', set.id)).toMatchObject({ merge_revision: 3, weight_value: '10.125', deleted_at: null });
});

it('preserves an unseen offline exercise and more than 200 child rows across arbitrary-order split batches', async () => {
  const c = await activeWorkout();
  const state = await workoutState(c.session);
  await workoutWrite('log_sets', { session_id: c.session, expected_revision: state.workout.revision,
    session_exercise_id: c.block, sets: [{ weight_kg: '80', reps: 8, set_type: null }] });
  const before = await rpc<{ merge_conflict_count: number }>('exercise_merge_sync_state', {});
  const block: Entity = { ...c.entities[3], id: c.id + '-offline-block', client_updated_at_ms: Date.now() + 10000,
    fields: { ...c.entities[3].fields, order_index: 1, merge_revision: 0 } };
  const sets = Array.from({ length: 205 }, (_, index): Entity => ({ ...c.sets[0], id: c.id + '-offline-' + index,
    client_updated_at_ms: Date.now() + 10000, fields: { ...c.sets[0].fields,
      session_exercise_id: block.id, order_index: index, merge_revision: 0 } }));
  // Parent follows 199 children in the first batch; remaining children arrive later.
  const result = await push([...sets.slice(0, 199), block, ...sets.slice(199)]);
  expect(result.outcomes.every(outcome => outcome.outcome === 'preserved')).toBe(true);
  expect(await row('session_exercises', block.id)).toBeNull();
  expect(await row('exercise_sets', sets[204].id)).toBeNull();
  const after = await rpc<{ merge_conflict_count: number }>('exercise_merge_sync_state', {});
  expect(after.merge_conflict_count - before.merge_conflict_count).toBe(206);
  const saved = (await reviews()).filter(item => item.entityId === block.id || item.entityId === sets[204].id);
  expect(saved.map(item => item.entityId)).toEqual([block.id, sets[204].id]);
  expect(saved[1]).toMatchObject({ invalid: true });
  await control(c.session, false);
  const parent = (await reviews()).find(item => item.id === saved[0].id)!;
  await rpc('exercise_merge_resolve', { p_id: parent.id, p_keep: false, p_token: parent.token });
  const child = (await reviews()).find(item => item.entityId === sets[204].id)!;
  expect(child).toMatchObject({ invalid: false });
  await rpc('exercise_merge_resolve', { p_id: child.id, p_keep: false, p_token: child.token });
  expect(await row('exercise_sets', sets[204].id)).toMatchObject({ weight_value: '10.125', deleted_at: null });
});

it('discovers an empty chat-finished workout through the durable snapshot sequence', async () => {
  const id = prefix(), stamp = Date.now();
  await push([{ type: 'sessions', id, client_updated_at_ms: stamp, fields: { gym_id: null, status: 'active',
    started_at: stamp, completed_at: null, duration_sec: null, merge_revision: 0, ...times(stamp) } }]);
  await control(id, true);
  const before = await rpc<{ merge_sequence: number }>('exercise_merge_sync_state', {});
  const state = await workoutState(id);
  await workoutWrite('finish_workout', { session_id: id, expected_revision: state.workout.revision });
  const snapshot = await rpc<{ rows: Entity[] }>('exercise_merge_snapshot', { p_after: before.merge_sequence });
  expect(snapshot.rows).toEqual([expect.objectContaining({ type: 'sessions', id,
    fields: expect.objectContaining({ status: 'completed', merge_revision: 2 }) })]);
});

it('rejects the formerly supported protocol before a stale client can write or pull a protected workout', async () => {
  for (const name of ['sync_push', 'sync_pull']) {
    const response = await fetch(endpoint.url + '/rest/v1/rpc/' + name, { method: 'POST',
      headers: { apikey: endpoint.anonKey, Authorization: 'Bearer ' + account.jwt, 'Content-Profile': 'app_public',
        'Content-Type': 'application/json', 'x-boga-sync-protocol': '6' },
      body: JSON.stringify(name === 'sync_push' ? { entities: [] } : { layer: 0, limit: 1 }),
    });
    expect(response.ok).toBe(false);
    expect(await response.text()).toContain('UPDATE_REQUIRED');
  }
});

it('atomically moves every completed set beyond a sync batch, converts planned weights, and retries once', async () => {
  const c = await chain({ count: 251 });
  const { preview, receipt, id } = await merge(c);
  expect(preview).toMatchObject({ setCount: 251, factor: 0.5 });
  expect(await row('exercise_sets', c.sets[0].id)).toMatchObject({
    weight_value: '5.0625', planned_weight_value: '10.125', merge_revision: 1, set_type: 'warm_up',
  });
  expect(await row('session_exercises', c.block)).toMatchObject({ exercise_definition_id: c.destination, merge_revision: 1 });
  expect((await row('exercise_definitions', c.source))?.deleted_at).not.toBeNull();
  expect(await rpc('exercise_merge_execute', {
    p_id: id, p_source: c.source, p_destination: c.destination, p_token: preview.token,
  })).toEqual(receipt);
  expect((await row('exercise_sets', c.sets[250].id))?.weight_value).toBe('5.0625');
  await expect(rpc('exercise_merge_execute', {
    p_id: id, p_source: c.source, p_destination: c.destination, p_token: 'different',
  })).rejects.toThrow(/CONFLICT/);
  const restored: Entity = { ...c.entities[0], client_updated_at_ms: Date.now() + 20000,
    fields: { ...c.entities[0].fields, deleted_at: null } };
  await push([restored]);
  expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe('5.0625');
});

it('refuses stale previews, including a changed graph whose visible count is the same', async () => {
  const c = await chain();
  const preview = await rpc<Preview>('exercise_merge_preview', { p_source: c.source, p_destination: c.destination });
  await push([{ ...c.sets[0], client_updated_at_ms: Date.now() + 1000, fields: { ...c.sets[0].fields, reps_value: '7' } }]);
  await expect(rpc('exercise_merge_execute', {
    p_id: c.id + '-stale', p_source: c.source, p_destination: c.destination, p_token: preview.token,
  })).rejects.toThrow(/MERGE_STALE/);
  expect(await row('session_exercises', c.block)).toMatchObject({ exercise_definition_id: c.source, merge_revision: 0 });
  expect((await row('exercise_definitions', c.source))?.deleted_at).toBeNull();
});

it('serializes a racing edit and merge without mixing an identity with old weight units', async () => {
  const c = await chain();
  const preview = await rpc<Preview>('exercise_merge_preview', { p_source: c.source, p_destination: c.destination });
  const results = await Promise.allSettled([
    rpc<Receipt>('exercise_merge_execute', { p_id: c.id + '-race', p_source: c.source, p_destination: c.destination, p_token: preview.token }),
    push([{ ...c.sets[0], client_updated_at_ms: Date.now() + 5000, fields: { ...c.sets[0].fields, weight_value: '22' } }]),
  ]);
  expect(results[1].status).toBe('fulfilled');
  if (results[0].status === 'fulfilled') {
    expect((await row('session_exercises', c.block))?.exercise_definition_id).toBe(c.destination);
    expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe('5.0625');
    expect((await reviews()).find(item => item.entityId === c.sets[0].id)?.saved.weight_value).toBe('11');
  } else {
    expect(results[0].reason.message).toContain('MERGE_STALE');
    expect((await row('session_exercises', c.block))?.exercise_definition_id).toBe(c.source);
    expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe('22');
  }
});

it('preserves future-clock stale edits and makes explicit resolution input-idempotent', async () => {
  const c = await chain();
  await merge(c);
  const stale = { ...c.sets[0], client_updated_at_ms: Date.now() + 60 * 60000,
    fields: { ...c.sets[0].fields, weight_value: '50' } };
  const ack = await push([stale]);
  await push([stale]); // A lost acknowledgement retries the exact far-future editor snapshot.
  const savedCopies = (await reviews()).filter(value => value.entityId === c.sets[0].id);
  expect(savedCopies).toHaveLength(1);
  expect(savedCopies[0].saved.client_updated_at_ms).toBe(stale.client_updated_at_ms);
  expect(ack.outcomes).toContainEqual({ type: 'exercise_sets', id: c.sets[0].id, outcome: 'preserved' });
  expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe('5.0625');
  const item = (await reviews()).find(value => value.entityId === c.sets[0].id)!;
  expect(item.saved.weight_value).toBe('25');
  await rpc('exercise_merge_resolve', { p_id: item.id, p_keep: false, p_token: item.token });
  expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe('25');
  await rpc('exercise_merge_resolve', { p_id: item.id, p_keep: false, p_token: item.token });
  await expect(rpc('exercise_merge_resolve', { p_id: item.id, p_keep: true, p_token: item.token })).rejects.toThrow(/MERGE_STALE|CONFLICT/);
});

it('applies a saved addition around a tombstone without stealing or duplicating ordering slots', async () => {
  const c = await chain();
  await merge(c);
  const addition = { ...c.sets[0], id: c.id + '-new', client_updated_at_ms: Date.now() + 2000,
    fields: { ...c.sets[0].fields, order_index: 0, weight_value: '30' } };
  await push([addition]);
  const tombstone: Record<string, unknown> = { ...(await row('exercise_sets', c.sets[0].id))!, deleted_at: Date.now() };
  const { owner_user_id: _owner, client_updated_at_ms: _clock, server_received_at: _server, id: _id, ...fields } = tombstone;
  await push([{ type: 'exercise_sets', id: c.sets[0].id, client_updated_at_ms: Date.now() + 10000, fields }]);
  const item = (await reviews()).find(value => value.entityId === addition.id)!;
  expect(item.current).toBeNull();
  await rpc('exercise_merge_resolve', { p_id: item.id, p_keep: false, p_token: item.token });
  expect(await row('exercise_sets', addition.id)).toMatchObject({ order_index: 0, weight_value: '15' });
  expect((await row('exercise_sets', c.sets[0].id))?.order_index).toBe(1);
});

it('keeps active workouts, saved plan references and deleted sessions outside the transfer', async () => {
  const c = await chain();
  const stamp = Date.now();
  const active = { ...c.entities[2], id: c.id + '-active', fields: { ...c.entities[2].fields, status: 'active', completed_at: null } };
  const activeBlock = { ...c.entities[3], id: c.id + '-active-block', fields: { ...c.entities[3].fields, session_id: active.id } };
  const removedSession = { ...c.entities[2], id: c.id + '-deleted', fields: { ...c.entities[2].fields, deleted_at: stamp } };
  const removedBlock = { ...c.entities[3], id: c.id + '-deleted-block', fields: { ...c.entities[3].fields, session_id: removedSession.id } };
  const plan: Entity = { type: 'session_plans', id: c.id + '-plan', client_updated_at_ms: stamp,
    fields: { title: 'Saved plan', provenance: 'human', last_modified_by: 'human', ...times(stamp) } };
  const planned: Entity = { type: 'session_plan_exercises', id: c.id + '-planned', client_updated_at_ms: stamp,
    fields: { session_plan_id: plan.id, exercise_definition_id: c.source, name: 'Source', order_index: 0,
      progress_status: 'pending', last_modified_by: 'human', ...times(stamp) } };
  await push([plan, planned, active, activeBlock, removedSession, removedBlock]);
  const originalPlan = await row('session_plan_exercises', planned.id);
  await merge(c);
  expect(await row('session_exercises', activeBlock.id)).toMatchObject({ exercise_definition_id: c.source, merge_revision: 0 });
  expect(await row('session_exercises', removedBlock.id)).toMatchObject({ exercise_definition_id: c.source, merge_revision: 0 });
  expect(await row('session_plan_exercises', planned.id)).toEqual(originalPlan);
});

it('keeps same-mode text verbatim and rejects invalid conversion before any mutation', async () => {
  const same = await chain({ targetMode: 'total_load', weight: '0002.2500' });
  await merge(same);
  expect((await row('exercise_sets', same.sets[0].id))?.weight_value).toBe('0002.2500');
  const bad = await chain({ weight: 'not-numeric' });
  await expect(rpc('exercise_merge_preview', { p_source: bad.source, p_destination: bad.destination })).rejects.toThrow(/VALIDATION/);
  expect((await row('session_exercises', bad.block))?.exercise_definition_id).toBe(bad.source);
  expect((await row('exercise_definitions', bad.source))?.deleted_at).toBeNull();
});

it('fences the metadata and sibling graph shown in a saved-change review', async () => {
  const c = await chain();
  await merge(c);
  await push([{ ...c.sets[0], client_updated_at_ms: Date.now() + 3000, fields: { ...c.sets[0].fields, reps_value: '10' } }]);
  const item = (await reviews()).find(value => value.entityId === c.sets[0].id)!;
  await push([{ ...c.entities[1], client_updated_at_ms: Date.now() + 20000,
    fields: { ...c.entities[1].fields, bodyweight_contribution: 0.5 } }]);
  await expect(rpc('exercise_merge_resolve', { p_id: item.id, p_keep: false, p_token: item.token })).rejects.toThrow(/MERGE_STALE/);
});

it('denies direct stale PATCH and protected reparenting, including at a newer timestamp', async () => {
  const c = await chain();
  await merge(c);
  const response = await fetch(endpoint.url + '/rest/v1/exercise_sets?id=eq.' + c.sets[0].id, {
    method: 'PATCH', headers: { apikey: endpoint.anonKey, Authorization: 'Bearer ' + account.jwt,
      'Content-Profile': 'app_public', 'Content-Type': 'application/json' }, body: JSON.stringify({ weight_value: '999' }),
  });
  expect(response.ok).toBe(false);
  expect(await response.text()).toContain('MERGE_REVIEW_REQUIRED');
  await expect(push([{ ...c.entities[3], client_updated_at_ms: Date.now() + 30000,
    fields: { ...c.entities[3].fields, merge_revision: 1, session_id: prefix() } }])).rejects.toThrow(/MERGE_REVIEW_REQUIRED/);
  expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe('5.0625');
});

it('denies anonymous, OAuth-agent and cross-account operation access', async () => {
  const c = await chain();
  const { id } = await merge(c);
  await expect(rpc('exercise_merge_preview', { p_source: c.source, p_destination: c.destination }, other.client)).rejects.toThrow(/NOT_FOUND/);
  expect(await rpc('exercise_merge_status', { p_id: id }, other.client)).toBeNull();
  const unauth = await fetch(endpoint.url + '/rest/v1/rpc/exercise_merge_status', {
    method: 'POST', headers: { apikey: endpoint.anonKey, 'Content-Type': 'application/json', 'Content-Profile': 'app_public' },
    body: JSON.stringify({ p_id: id }),
  });
  expect(unauth.ok).toBe(false);
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Local fixture JWT secret is unavailable; run through boga test sync-infra.');
  const claims = JSON.parse(Buffer.from(account.jwt.split('.')[1], 'base64url').toString());
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...claims, client_id: 'merge-agent', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const token = head + '.' + body + '.' + createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  for (const [name, args] of [
    ['exercise_merge_preview', { p_source: c.source, p_destination: c.destination }],
    ['exercise_merge_status', { p_id: id }], ['exercise_merge_review', { p_offset: 0 }],
    ['exercise_merge_snapshot', { p_after: 0 }], ['exercise_merge_sync_state', {}],
    ['exercise_merge_save_conflict', { p_type: 'exercise_sets', p_row: {} }],
  ] as const) {
    const denied = await fetch(endpoint.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: {
      apikey: endpoint.anonKey, Authorization: 'Bearer ' + token, 'Content-Profile': 'app_public', 'Content-Type': 'application/json',
    }, body: JSON.stringify(args) });
    expect(await denied.text()).toContain('AGENT_FORBIDDEN');
  }
});

it.each([
  ['2.25', 'total_load', 'per_side_load', '1.125'],
  ['0002.250', 'per_side_load', 'total_load', '4.5'],
  ['0', 'total_load', 'per_side_load', '0'],
  ['', 'total_load', 'per_side_load', ''],
  ['  ', 'total_load', 'per_side_load', '  '],
])('converts stored %s exactly from %s to %s', async (weight, sourceMode, targetMode, expected) => {
  const c = await chain({ weight, sourceMode, targetMode });
  await merge(c);
  expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe(expected);
});
it.each(['.', '1e3', '9'.repeat(309)])('refuses malformed or overflowing conversion %s atomically', async weight => {
  const c = await chain({ weight });
  await expect(merge(c)).rejects.toThrow(/VALIDATION/);
  expect((await row('exercise_definitions', c.source))?.deleted_at).toBeNull();
});

it('preserves tags, reuses deleted destination labels, and fences unchanged repeated and legacy sibling blocks', async () => {
  const c = await chain();
  const stamp = Date.now();
  const tag = (id: string, exercise: string, name: string, deleted_at: number | null = null): Entity => ({
    type: 'exercise_tag_definitions', id, client_updated_at_ms: stamp,
    fields: { exercise_definition_id: exercise, name, normalized_name: name.toLowerCase(), ...times(stamp), deleted_at },
  });
  const a = tag(c.id + '-tag-a', c.source, 'Grip');
  const b = tag(c.id + '-tag-b', c.destination, 'Grip', stamp);
  const missing = tag(c.id + '-tag-missing', c.source, 'Paused', stamp);
  const assignment = (id: string, tagId: string, deleted_at: number | null = null): Entity => ({
    type: 'session_exercise_tags', id, client_updated_at_ms: stamp,
    fields: { session_exercise_id: c.block, exercise_tag_definition_id: tagId, merge_revision: 0, ...times(stamp), deleted_at },
  });
  const repeated = { ...c.entities[3], id: c.id + '-repeat', fields: {
    ...c.entities[3].fields, exercise_definition_id: c.destination, name: 'Destination', order_index: 1,
  } };
  const legacy = { ...c.entities[3], id: c.id + '-legacy', fields: {
    ...c.entities[3].fields, exercise_definition_id: null, name: 'Legacy', order_index: 2,
  } };
  const tombstone = { ...c.sets[0], id: c.id + '-tombstone', fields: { ...c.sets[0].fields, order_index: 1, deleted_at: stamp } };
  await push([a, b, missing, repeated, legacy, tombstone, assignment(c.id + '-use', a.id), assignment(c.id + '-use-missing', missing.id, stamp)]);
  const { preview } = await merge(c);
  expect(preview.setCount).toBe(1);
  expect(await row('session_exercise_tags', c.id + '-use')).toMatchObject({ exercise_tag_definition_id: b.id, deleted_at: null });
  expect((await row('exercise_tag_definitions', b.id))?.deleted_at).toBe(stamp);
  const copiedId = (await row('session_exercise_tags', c.id + '-use-missing'))?.exercise_tag_definition_id as string;
  expect(await row('exercise_tag_definitions', copiedId)).toMatchObject({ exercise_definition_id: c.destination, name: 'Paused', deleted_at: stamp });
  expect(await row('session_exercises', repeated.id)).toMatchObject({ exercise_definition_id: c.destination, order_index: 1, merge_revision: 1 });
  expect(await row('session_exercises', legacy.id)).toMatchObject({ exercise_definition_id: null, name: 'Legacy', merge_revision: 1 });
  expect(await row('exercise_sets', tombstone.id)).toMatchObject({ deleted_at: stamp, weight_value: '5.0625' });
});

it('interprets stale weights through two successive conversions exactly once', async () => {
  const c = await chain();
  await merge(c);
  const third = { ...c.entities[0], id: c.id + '-third', fields: { ...c.entities[0].fields, name: 'Third' } };
  await push([third]);
  await merge({ ...c, source: c.destination, destination: third.id }, c.id + '-second-operation');
  await push([{ ...c.sets[0], client_updated_at_ms: Date.now() + 9000,
    fields: { ...c.sets[0].fields, weight_value: '25.125' } }]);
  const item = (await reviews()).find(value => value.entityId === c.sets[0].id)!;
  expect(item.saved.weight_value).toBe('25.125');
  await rpc('exercise_merge_resolve', { p_id: item.id, p_keep: false, p_token: item.token });
  expect((await row('exercise_sets', c.sets[0].id))?.weight_value).toBe('25.125');
});

it('serializes competing destinations and permits a zero-row merge', async () => {
  const c = await chain({ count: 0 });
  const third = { ...c.entities[1], id: c.id + '-third' };
  await push([third]);
  const previews = await Promise.all([c.destination, third.id].map(p_destination => rpc<Preview>(
    'exercise_merge_preview', { p_source: c.source, p_destination })));
  const results = await Promise.allSettled([c.destination, third.id].map((p_destination, index) => rpc(
    'exercise_merge_execute', { p_id: c.id + '-compete-' + index, p_source: c.source, p_destination, p_token: previews[index].token })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(previews.every(preview => preview.setCount === 0)).toBe(true);
});

it('copies a historical tag again after the destination copy was renamed', async () => {
  const first = await chain();
  const stamp = Date.now();
  const tag = { type: 'exercise_tag_definitions', id: first.id + '-grip', client_updated_at_ms: stamp,
    fields: { exercise_definition_id: first.source, name: 'Grip', normalized_name: 'grip', ...times(stamp) } };
  const assignment = { type: 'session_exercise_tags', id: first.id + '-assignment', client_updated_at_ms: stamp,
    fields: { session_exercise_id: first.block, exercise_tag_definition_id: tag.id, merge_revision: 0, ...times(stamp) } };
  await push([tag, assignment]); await merge(first);
  const copiedId = (await row('session_exercise_tags', assignment.id))?.exercise_tag_definition_id as string;
  const copied = (await row('exercise_tag_definitions', copiedId))!;
  const { owner_user_id: _owner, client_updated_at_ms: _clock, server_received_at: _received, id: _id, ...fields } = copied;
  await push([{ type: 'exercise_tag_definitions', id: copiedId, client_updated_at_ms: Date.now() + 20000,
    fields: { ...fields, name: 'Renamed', normalized_name: 'renamed' } }]);
  const second = await chain();
  const newTag = { ...tag, id: second.id + '-grip', fields: { ...tag.fields, exercise_definition_id: second.source } };
  const newUse = { ...assignment, id: second.id + '-assignment', fields: {
    ...assignment.fields, session_exercise_id: second.block, exercise_tag_definition_id: newTag.id } };
  await push([newTag, newUse]); await merge({ ...second, destination: first.destination });
  const nextId = (await row('session_exercise_tags', newUse.id))?.exercise_tag_definition_id as string;
  expect(nextId).not.toBe(copiedId);
  expect(await row('exercise_tag_definitions', nextId)).toMatchObject({ name: 'Grip', normalized_name: 'grip' });
});

it('requires revision-aware clients before returning or accepting sync data', async () => {
  const response = await fetch(endpoint.url + '/rest/v1/rpc/sync_pull', { method: 'POST', headers: {
    apikey: endpoint.anonKey, Authorization: 'Bearer ' + account.jwt, 'Content-Profile': 'app_public',
    'Content-Type': 'application/json', 'x-boga-sync-protocol': '4',
  }, body: JSON.stringify({ layer: 0 }) });
  expect(await response.text()).toContain('UPDATE_REQUIRED');
});

it('accepts normal post-merge block, set and tag edits when they echo the loaded revision', async () => {
  const c = await chain();
  const at = Date.now();
  const tagId = c.id + '-tag'; const useId = c.id + '-use';
  await push([
    { type: 'exercise_tag_definitions', id: tagId, client_updated_at_ms: at,
      fields: { exercise_definition_id: c.source, name: 'Grip', normalized_name: 'grip', ...times(at) } },
    { type: 'session_exercise_tags', id: useId, client_updated_at_ms: at,
      fields: { session_exercise_id: c.block, exercise_tag_definition_id: tagId, merge_revision: 0, created_at: at, deleted_at: null } },
  ]);
  await merge(c);
  const values: Entity[] = [];
  for (const [type, id, change] of [
    ['session_exercises', c.block, { machine_name: 'New machine' }],
    ['exercise_sets', c.sets[0].id, { weight_value: '19' }],
    ['session_exercise_tags', useId, { deleted_at: at + 1 }],
  ] as const) {
    const current = (await row(type, id))!;
    const { owner_user_id: _owner, client_updated_at_ms: _clock, server_received_at: _received, id: _id, ...fields } = current;
    values.push({ type, id, client_updated_at_ms: Date.now() + 30000, fields: { ...fields, ...change } });
  }
  const ack = await push(values);
  expect(ack.outcomes.every(value => value.outcome === 'accepted')).toBe(true);
  expect(await row('session_exercises', c.block)).toMatchObject({ merge_revision: 1, machine_name: 'New machine' });
  expect(await row('exercise_sets', c.sets[0].id)).toMatchObject({ merge_revision: 1, weight_value: '19' });
  expect(await row('session_exercise_tags', useId)).toMatchObject({ merge_revision: 1, deleted_at: at + 1 });
});

it.each(['exercise_sets', 'session_exercise_tags'])('deduplicates a retried stale %s ID collision without changing the other block', async type => {
  const c = await chain(), otherBlock = await chain();
  const at = Date.now();
  let originalId = otherBlock.sets[0].id;
  let fields = c.sets[0].fields;
  if (type === 'session_exercise_tags') {
    const tag = (id: string, exercise: string): Entity => ({ type: 'exercise_tag_definitions', id,
      client_updated_at_ms: at, fields: { exercise_definition_id: exercise, name: 'Grip', normalized_name: 'grip', ...times(at) } });
    const sourceTag = tag(c.id + '-tag', c.source), otherTag = tag(otherBlock.id + '-tag', otherBlock.source);
    originalId = otherBlock.id + '-assignment';
    const assignment = { session_exercise_id: otherBlock.block, exercise_tag_definition_id: otherTag.id,
      merge_revision: 0, created_at: at, deleted_at: null };
    await push([sourceTag, otherTag, { type, id: originalId, client_updated_at_ms: at, fields: assignment }]);
    fields = { ...assignment, session_exercise_id: c.block, exercise_tag_definition_id: sourceTag.id };
  }
  await merge(c);
  const original = await row(type, originalId);
  const stale: Entity = { type, id: originalId, client_updated_at_ms: Date.now() + 60 * 60000, fields };
  await push([stale]); await push([stale]);
  const copies = (await reviews()).filter(item => item.saved.merge_original_id === originalId);
  expect(copies).toHaveLength(1);
  expect(copies[0].entityId).not.toBe(originalId);
  expect(copies[0].saved.session_exercise_id).toBe(c.block);
  expect(await row(type, originalId)).toEqual(original);
});

it.each([false, true])('coalesces mapped tag pairs without revival (all deleted: %s), installs them, and reviews alias edits', async allDeleted => {
  const c = await chain();
  const at = Date.now();
  const tagA = c.id + '-tag-a', tagB = c.id + '-tag-b';
  const assignmentA = c.id + '-assignment-a', assignmentB = c.id + '-assignment-b';
  const definition = (id: string, exercise: string): Entity => ({ type: 'exercise_tag_definitions', id,
    client_updated_at_ms: at, fields: { exercise_definition_id: exercise, name: 'Grip', normalized_name: 'grip', ...times(at) } });
  const assignment = (id: string, tag: string, deleted: number | null): Entity => ({ type: 'session_exercise_tags', id,
    client_updated_at_ms: at, fields: { session_exercise_id: c.block, exercise_tag_definition_id: tag,
      merge_revision: 0, created_at: at, deleted_at: deleted } });
  await push([definition(tagA, c.source), definition(tagB, c.destination),
    assignment(assignmentA, tagA, allDeleted ? at : null), assignment(assignmentB, tagB, at)]);
  const { receipt } = await merge(c);
  const install = async () => {
    const snapshot = await rpc<{ rows: Entity[]; hasMore: boolean }>('exercise_merge_snapshot', { p_after: receipt.sequence - 1 });
    expect(snapshot.hasMore).toBe(false);
    const local = createInMemoryDatabase();
    try {
      local.database.transaction(tx => {
        for (const entity of snapshot.rows) applyPullPage(tx as unknown as Transaction,
          [entity as WireEntity], entity.type as EntityTableName, true);
      });
      return local.client.prepare('select id, deleted_at from session_exercise_tags where session_exercise_id=? order by id')
        .all(c.block) as { id: string; deleted_at: number | null }[];
    } finally { local.close(); }
  };
  expect(await install()).toEqual([{ id: assignmentA, deleted_at: allDeleted ? at : null }]);
  const late = assignment(c.id + '-late-add', tagA, null);
  expect((await push([late])).outcomes[0].outcome).toBe('preserved');
  const addition = (await reviews()).find(item => item.entityId === late.id)!;
  expect(addition.current).toMatchObject({ id: assignmentA, exercise_tag_definition_id: tagB });
  await rpc('exercise_merge_resolve', { p_id: addition.id, p_keep: false, p_token: addition.token });
  await rpc('exercise_merge_resolve', { p_id: addition.id, p_keep: false, p_token: addition.token });
  expect(await install()).toEqual([{ id: assignmentA, deleted_at: null }]);
  // A later current-context retarget must remain visible, even beside the saved destination pair.
  await push([assignment(assignmentA, tagA, null)]);
  const current = (await row('session_exercise_tags', assignmentA))!;
  const road = c.id + '-road', duplicate = c.id + '-new-grip';
  const revision = Number(current.merge_revision), stamp = Number(current.client_updated_at_ms) + 1;
  await push([{ ...definition(road, c.destination), fields: {
    ...definition(road, c.destination).fields, name: 'Road', normalized_name: 'road' } },
    { ...assignment(assignmentA, road, null), client_updated_at_ms: stamp,
      fields: { ...assignment(assignmentA, road, null).fields, merge_revision: revision } },
    { ...assignment(duplicate, tagB, null), client_updated_at_ms: stamp,
      fields: { ...assignment(duplicate, tagB, null).fields, merge_revision: revision } }]);
  const retarget = (await reviews()).find(item => item.entityId === assignmentA)!;
  expect(retarget.current).toMatchObject({ id: assignmentA, tag_name: 'Road' });
  expect(retarget.saved).toMatchObject({ tag_name: 'Grip' });
  await push([{ ...assignment(duplicate, tagB, at + 2), client_updated_at_ms: stamp + 1,
    fields: { ...assignment(duplicate, tagB, at + 2).fields, merge_revision: revision } }]);
  await expect(rpc('exercise_merge_resolve', { p_id: retarget.id, p_keep: false, p_token: retarget.token }))
    .rejects.toThrow(/MERGE_STALE/);
  const refreshed = (await reviews()).find(item => item.id === retarget.id)!;
  await rpc('exercise_merge_resolve', { p_id: refreshed.id, p_keep: false, p_token: refreshed.token });
  expect(await install()).toEqual([{ id: assignmentA, deleted_at: null }]);
  const removal = assignment(assignmentB, tagB, at + 1);
  await push([removal]);
  const removed = (await reviews()).find(item => item.entityId === assignmentB)!;
  expect(removed.current).toMatchObject({ id: assignmentA, deleted_at: null });
  await rpc('exercise_merge_resolve', { p_id: removed.id, p_keep: false, p_token: removed.token });
  await rpc('exercise_merge_resolve', { p_id: removed.id, p_keep: false, p_token: removed.token });
  expect(await install()).toEqual([{ id: assignmentA, deleted_at: at + 1 }]);
});

it('denies direct access to tag reconciliation', async () => {
  await expect(rpc('exercise_merge_coalesce_tag', { p_block: 'untrusted', p_tag: 'untrusted' }))
    .rejects.toThrow(/permission denied|Could not find/i);
});


it('restores a merged Routine workout with its use ancestor and unchanged authored targets', async () => {
  const c = await chain();
  const stamp = Date.now() + 1;
  const plan = c.id + '-routine', planned = c.id + '-planned', target = c.id + '-target', use = c.id + '-use';
  const entity = (type: string, id: string, fields: Record<string, unknown>): Entity => ({
    type, id, client_updated_at_ms: stamp, fields: { ...times(stamp), ...fields },
  });
  await push([
    entity('session_plans', plan, { title: 'Routine', is_routine: true, provenance: 'human', last_modified_by: 'human' }),
    entity('session_plan_exercises', planned, { session_plan_id: plan, exercise_definition_id: c.source,
      order_index: 0, name: 'Source', progress_status: 'pending', last_modified_by: 'human' }),
    entity('session_plan_uses', use, { session_plan_id: plan, slot_index: 1, kind: 'workout', skipped_at: null }),
    entity('session_plan_sets', target, { session_plan_exercise_id: planned, order_index: 0,
      target_weight_value: '20.25', target_reps: 8, last_modified_by: 'human' }),
    { ...c.entities[2], client_updated_at_ms: stamp, fields: { ...c.entities[2].fields, source_plan_id: plan, source_plan_use_id: use } },
    { ...c.entities[3], client_updated_at_ms: stamp, fields: { ...c.entities[3].fields,
      source_plan_exercise_id: planned, source_plan_use_id: use } },
    { ...c.sets[0], client_updated_at_ms: stamp, fields: { ...c.sets[0].fields,
      source_plan_set_id: target, source_plan_use_id: use } },
  ]);
  const authored = await row('session_plan_sets', target);
  const { receipt } = await merge(c);
  const snapshot = await rpc<{ rows: Entity[]; hasMore: boolean }>('exercise_merge_snapshot', { p_after: receipt.sequence - 1 });
  expect(snapshot.hasMore).toBe(false);
  const local = createInMemoryDatabase({ foreignKeys: true });
  try {
    local.database.transaction(tx => {
      for (const incoming of snapshot.rows) applyPullPage(tx as unknown as Transaction,
        [incoming as WireEntity], incoming.type as EntityTableName, true);
    });
    expect(local.client.pragma('foreign_key_check')).toEqual([]);
    expect(local.client.prepare('select source_plan_use_id, weight_value from exercise_sets where id=?').get(c.sets[0].id))
      .toEqual({ source_plan_use_id: use, weight_value: '5.0625' });
    expect(local.client.prepare('select session_plan_id, slot_index from session_plan_uses where id=?').get(use))
      .toEqual({ session_plan_id: plan, slot_index: 1 });
  } finally { local.close(); }
  expect(await row('session_plan_sets', target)).toEqual(authored);
});

it('moves the source exercise’s notes to the destination, raising their clock past every device stamp', async () => {
  const c = await chain();
  const stamp = Date.now();
  const note = (id: string, exercise: string | null, deleted: number | null = null): Entity => ({
    type: 'training_notes', id, client_updated_at_ms: stamp, fields: {
      exercise_definition_id: exercise, body: 'Bench touch', noted_on: '2026-11-12', source: 'app', ...times(stamp), deleted_at: deleted,
    },
  });
  const [moved, removed, general, other] = ['-note', '-note-removed', '-note-general', '-note-other'].map(suffix => c.id + suffix);
  await push([note(moved, c.source), note(removed, c.source, stamp), note(general, null), note(other, c.destination)]);
  await merge(c);

  const after = await row('training_notes', moved);
  expect(after).toMatchObject({ exercise_definition_id: c.destination, body: 'Bench touch', deleted_at: null });
  expect(Number(after!.client_updated_at_ms)).toBeGreaterThan(stamp);
  // A removed note moves too, staying removed; notes on other exercises or none are untouched.
  expect(await row('training_notes', removed)).toMatchObject({ exercise_definition_id: c.destination, deleted_at: stamp });
  expect(await row('training_notes', general)).toMatchObject({ exercise_definition_id: null, client_updated_at_ms: stamp });
  expect(await row('training_notes', other)).toMatchObject({ exercise_definition_id: c.destination, client_updated_at_ms: stamp });

  // A device holding the note on the source applies the move from the ordinary layer-1 pull.
  const local = createInMemoryDatabase({ foreignKeys: true });
  try {
    local.client.prepare("insert into exercise_definitions (id,name) values (?, 'Source'), (?, 'Destination')").run(c.source, c.destination);
    local.client.prepare("insert into training_notes (id,exercise_definition_id,body,noted_on,local_updated_at_ms) values (?,?,'Bench touch','2026-11-12',?)")
      .run(moved, c.source, stamp);
    const pulled: WireEntity[] = [];
    for (let cursor: unknown = null; ;) {
      const page = await rpc<{ entities: WireEntity[]; next_cursor: unknown; has_more: boolean }>(
        'sync_pull', { layer: 1, cursor, limit: 200 });
      pulled.push(...page.entities);
      if (!page.has_more) break;
      cursor = page.next_cursor;
    }
    const notes = pulled.filter(entity => entity.type === 'training_notes' && entity.id === moved);
    expect(notes).toHaveLength(1);
    local.database.transaction(tx => applyPullPage(tx as Transaction, notes, 'training_notes' as EntityTableName));
    expect(local.client.prepare('select exercise_definition_id from training_notes where id=?').get(moved))
      .toEqual({ exercise_definition_id: c.destination });
  } finally {
    local.close();
  }
});
