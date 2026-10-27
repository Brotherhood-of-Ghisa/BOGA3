import { createHmac } from 'node:crypto';

import {
  createAuthedTestClient, readSyncTestEndpoint, USER_E, type AuthedTestClient,
} from './helpers/sync-test-endpoint';

type Entity = { type: string; id: string; client_updated_at_ms: number; fields: Record<string, unknown> };
type Preview = { token: string; setCount: number; factor: number };
type Receipt = { id: string; sequence: number };
type Review = { id: string; entityId: string; token: string; saved: Record<string, unknown>; current: Record<string, unknown> | null };
const endpoint = readSyncTestEndpoint();
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
const prefix = () => 'merge-' + Date.now() + '-' + (++serial) + '-' + Math.random().toString(36).slice(2);
const times = (stamp: number) => ({ created_at: stamp, updated_at: stamp, deleted_at: null });

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
});
afterAll(async () => {
  await account?.teardown(); await other?.teardown();
  if (isolatedUserId) await adminUser('DELETE', '/' + isolatedUserId);
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
  const ack = await push([{ ...c.sets[0], client_updated_at_ms: Date.now() + 60 * 60000,
    fields: { ...c.sets[0].fields, weight_value: '50' } }]);
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
