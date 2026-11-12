import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import request from 'supertest';

import { BogaAgentApi } from '../src/api-client.js';
import type { BogaMcpConfig } from '../src/config.js';
import { UPSTREAM_RETRY_AFTER_SECONDS } from '../src/auth.js';
import { BOGA_OAUTH_SCOPES, createBogaMcpApp } from '../src/server.js';

const token = 'integration-access-token';
const oauthMetadata: OAuthMetadata = {
  authorization_endpoint: 'http://127.0.0.1:55531/auth/v1/oauth/authorize',
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  issuer: 'http://127.0.0.1:55531/auth/v1',
  registration_endpoint: 'http://127.0.0.1:55531/auth/v1/oauth/clients/register',
  response_types_supported: ['code'],
  scopes_supported: ['openid', 'profile'],
  token_endpoint: 'http://127.0.0.1:55531/auth/v1/oauth/token',
  token_endpoint_auth_methods_supported: ['none'],
};

const config: BogaMcpConfig = {
  agentApiBaseUrl: new URL('http://127.0.0.1:55531/functions/v1/agent-api/'),
  allowedHosts: ['127.0.0.1', 'localhost'],
  host: '127.0.0.1',
  oauthIssuer: new URL(oauthMetadata.issuer),
  port: 8787,
  publicBaseUrl: new URL('http://127.0.0.1:8787/'),
  requestTimeoutMs: 2_000,
  resourceUrl: new URL('http://127.0.0.1:8787/mcp'),
};

const responses: Record<string, Record<string, unknown>> = {
  '/functions/v1/agent-api/v1/agent/session': {
    access: 'training_read_only',
    authorized: true,
    client_id: 'client-123',
    expires_at: 4_102_444_800,
    scopes: ['openid', 'profile'],
  },
  '/functions/v1/agent-api/v1/agent/profile': {
    active_gyms: [{ id: 'gym-a', name: 'A Gym' }],
    available_equipment: ['Barbell'],
    timezone: 'Europe/London',
    training_preferences: {},
    units: { load: 'kg', volume: 'kg_reps' },
  },
  '/functions/v1/agent-api/v1/agent/exercises': {
    exercises: [{ id: 'exercise-a', name: 'Bench Press' }],
    next_cursor: null,
  },
  '/functions/v1/agent-api/v1/agent/exercises/exercise-a/context': {
    exercise: { id: 'exercise-a', name: 'Bench Press' },
    metric_revision: 'working_sets_v10',
    recent_performances: [{
      session_body_weight: { status: 'known', value: 80, unit: 'kg', measured_at: '2026-09-01T10:00:00Z' },
      volume: { value: null, unit: 'kg_reps', known_subtotal: 500, complete: false },
      sets: [{ load: { value: 20, unit: 'kg' }, reps: 8,
        calculated_load: { value: 100, unit: 'kg', status: 'known', reason: null } }],
    }],
  },
  '/functions/v1/agent-api/v1/agent/workouts/recent': {
    next_cursor: null,
    metric_revision: 'working_sets_v10',
    workouts: [{ id: 'workout-a', total_volume: { value: null, known_subtotal: 500, unit: 'kg_reps', complete: false } }],
  },
  '/functions/v1/agent-api/v1/agent/exercises/exercise-a/history': {
    exercise: { id: 'exercise-a', name: 'Bench Press' },
    metric_revision: 'working_sets_v10',
    next_cursor: null,
    sets: [{ id: 'set-1', reps: 8, load: { value: 100, unit: 'kg' } }],
  },
  '/functions/v1/agent-api/v1/agent/workouts/workout-a': {
    metric_revision: 'working_sets_v10',
    workout: {
      id: 'workout-a',
      exercises: [{ id: 'block-1', name: 'Bench Press' }],
      sets: [{ id: 'set-1', reps: 8, load: { value: 100, unit: 'kg' } }],
    },
  },
  '/functions/v1/agent-api/v1/agent/session-plans': {
    next_cursor: null,
    plans: [{ id: 'plan-a', progress: 'planned', title: 'Chest day' }],
  },
  '/functions/v1/agent-api/v1/agent/programmes': {
    id: 'prog-a',
    plan_ids: ['plan-1', 'plan-2'],
  },
  '/functions/v1/agent-api/v1/agent/training-status': {
    complete: true,
    counts_secondary_sets: true,
    volume_primary_only: false,
    favourite_exercises: [{ exercise_id: 'exercise-a', name: 'Bench Press', sessions_28d: 3 }],
    metric_revision: 'working_sets_v10',
    muscles: [{ id: 'chest_sternal', name: 'Chest', week_sets: 4.5, weekly_target: 10 }],
    targets: { default_weekly_sets: 10, mode: 'single', revision: 1_730_000_000_000, uploaded: true },
  },
  '/functions/v1/agent-api/v1/agent/activities': {
    activities: [{
      activity_type: 'traditional_strength_training', duration_seconds: 3000, external_id: 'hk-1',
      overlapping_session_id: 'workout-a', overlaps_logged_session: true, source: 'apple_health',
      started_at: '2026-10-27T17:05:00.000Z',
    }],
    next_cursor: null,
    overlap_complete: true,
  },
  '/functions/v1/agent-api/v1/agent/muscle-targets': {
    idempotent_replay: false,
    overrides: { chest_sternal: 14 },
    targets: { default_weekly_sets: 10, mode: 'per_muscle', revision: 1_730_000_000_001, uploaded: true },
  },
  '/functions/v1/agent-api/v1/agent/muscles': {
    combined_muscles: [],
    muscles: [{ family: 'chest', id: 'chest_sternal', name: 'Chest', report_group: null, tracked: true }],
  },
  '/functions/v1/agent-api/v1/agent/exercises/exercise-a': {
    exercise_id: 'exercise-a',
    revision: 2,
  },
  '/functions/v1/agent-api/v1/agent/exercises/exercise-a/delete': {
    deleted: true,
    exercise_id: 'exercise-a',
  },
  '/functions/v1/agent-api/v1/agent/exercises/exercise-a/restore': {
    deleted: false,
    exercise_id: 'exercise-a',
  },
};

const envelopeResponse = (data: Record<string, unknown>): Response =>
  Response.json({
    data,
    meta: {
      api_version: 'v1',
      request_id: 'request-123',
    },
  });

const validSession = responses['/functions/v1/agent-api/v1/agent/session'];

const sessionApi = (fetchImplementation: typeof fetch): BogaAgentApi =>
  new BogaAgentApi({
    baseUrl: config.agentApiBaseUrl,
    fetchImplementation,
    timeoutMs: config.requestTimeoutMs,
  });

const initializeRequest = {
  id: 1,
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
    protocolVersion: '2025-11-25',
  },
};

const startMcp = async (overrides: Record<string, Response> = {}) => {
  const requests: Array<{ method: string; url: URL; headers: Headers; body?: string }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = init?.body ? String(init.body) : undefined;
    requests.push({ body, headers, method, url });
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    if (overrides[url.pathname]) return overrides[url.pathname].clone();
    const response = responses[url.pathname];
    if (!response) {
      return Response.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Not found.',
            request_id: 'request-404',
          },
        },
        { status: 404 },
      );
    }
    return envelopeResponse(response);
  };
  const api = new BogaAgentApi({
    baseUrl: config.agentApiBaseUrl,
    fetchImplementation,
    timeoutMs: config.requestTimeoutMs,
  });
  const app = await createBogaMcpApp({ api, config, oauthMetadata });
  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  const client = new Client({ name: 'boga-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`),
    {
      requestInit: {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    },
  );
  await client.connect(transport);
  return { app, client, httpServer, requests, transport };
};

const closeServer = async (server: Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );

const active: Array<Awaited<ReturnType<typeof startMcp>>> = [];

afterEach(async () => {
  while (active.length > 0) {
    const current = active.pop();
    if (!current) continue;
    await current.client.close();
    await closeServer(current.httpServer);
  }
});

describe('BoGa MCP server', () => {
  it('discovers exactly twenty-seven tools with correct annotations', async () => {
    const running = await startMcp();
    active.push(running);
    const result = await running.client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      'add_note',
      'create_exercise',
      'create_session_plan',
      'create_training_programme',
      'create_workout',
      'delete_exercise',
      'delete_set',
      'finish_workout',
      'get_active_workout',
      'get_exercise_context',
      'get_exercise_history',
      'get_recent_activities',
      'get_recent_workouts',
      'get_training_profile',
      'get_training_status',
      'get_upcoming_session_plans',
      'get_workout_detail',
      'list_muscles',
      'list_notes',
      'log_sets',
      'remove_note',
      'restore_exercise',
      'search_exercises',
      'set_muscle_targets',
      'start_workout',
      'update_exercise',
      'update_set',
    ]);
    const readOnlyNames = new Set([
      'get_active_workout',
      'get_exercise_context',
      'get_exercise_history',
      'get_recent_activities',
      'get_recent_workouts',
      'get_training_profile',
      'get_training_status',
      'get_upcoming_session_plans',
      'get_workout_detail',
      'list_muscles',
      'list_notes',
      'search_exercises',
    ]);
    // The instructions count the read-only tools a client can call.
    expect(readOnlyNames.size).toBe(12);
    expect(running.client.getInstructions()).toContain('Twelve read-only tools');
    // Edits, deletes and new targets replace what the person had, so clients confirm them.
    const destructiveNames = new Set(['delete_exercise', 'set_muscle_targets', 'update_exercise', 'update_set', 'delete_set', 'finish_workout', 'remove_note']);
    for (const tool of result.tools) {
      if (destructiveNames.has(tool.name)) {
        expect(tool.annotations).toMatchObject({
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
          readOnlyHint: false,
        });
      } else if (readOnlyNames.has(tool.name)) {
        expect(tool.annotations).toMatchObject({
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
          readOnlyHint: true,
        });
      } else {
        expect(tool.annotations).toMatchObject({
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
          readOnlyHint: false,
        });
      }
    }
  });

  it('forwards workout IDs, page revisions, raw results, token and operation headers to the API', async () => {
    const graph = 'a'.repeat(32);
    const snapshot = { visibility: 'server_synced_only', workout: { id: 'workout/a', revision: graph,
      status: 'completed', requires_app: true, control: { owner: 'human', client_id: null, can_edit: false } },
      rows: [{ type: 'set', id: 'set-a', weight_kg: '80', reps: '8' }], next_cursor: 's:next' };
    const mutation = { session_id: 'workout/a', revision: graph, status: 'active', idempotent_replay: false,
      session_exercise_id: 'block-a', set_ids: ['set-a'], control: { owner: 'mcp', client_id: 'coach', can_edit: true } };
    const running = await startMcp({ ...Object.fromEntries(['create', 'start', 'log-sets', 'update-set', 'delete-set', 'finish']
      .map(operation => [`/functions/v1/agent-api/v1/agent/workouts/${operation}`, envelopeResponse(mutation)])),
      '/functions/v1/agent-api/v1/agent/workouts/active': envelopeResponse(snapshot) });
    active.push(running);
    const read = await running.client.callTool({ name: 'get_active_workout', arguments: {
      session_id: 'workout/a', revision: graph, limit: 2, cursor: 'block:next',
    } });
    expect(read.structuredContent).toEqual(snapshot);
    const get = running.requests.find(r => r.url.pathname.endsWith('/workouts/active'))!;
    expect(get.method).toBe('GET');
    expect(Object.fromEntries(get.url.searchParams)).toEqual({ session_id: 'workout/a', revision: graph, limit: '2', cursor: 'block:next' });
    const common = { session_id: 'workout/a', expected_revision: graph };
    const set = { weight_kg: '80', reps: 8, set_type: 'rir_2' };
    const writes: Array<[string, string, Record<string, unknown>]> = [
      ['create_workout', 'create', { started_at: '2026-10-25T01:30:00+01:00', completed_at: '2026-10-25T01:30:00Z' }],
      ['start_workout', 'start', { gym_id: null }],
      ['log_sets', 'log-sets', { ...common, exercise_id: 'exercise-a', sets: [set] }],
      ['log_sets', 'log-sets', { ...common, session_exercise_id: 'block-a', sets: [set, set] }],
      ['update_set', 'update-set', { ...common, set_id: 'set-a', set }],
      ['delete_set', 'delete-set', { ...common, set_id: 'set-a' }],
      ['finish_workout', 'finish', common],
    ];
    for (const [name, operation, body] of writes) {
      const before = running.requests.length;
      const result = await running.client.callTool({ name, arguments: { ...body, idempotency_key: 'stable-key' } });
      expect(result.structuredContent).toEqual(mutation);
      const posted = running.requests.slice(before).find(r => r.method === 'POST')!;
      expect(posted.url.pathname).toBe(`/functions/v1/agent-api/v1/agent/workouts/${operation}`);
      expect(posted.headers.get('idempotency-key')).toBe('stable-key');
      expect(posted.headers.get('authorization')).toBe(`Bearer ${token}`);
      expect(JSON.parse(posted.body!)).toEqual(body);
    }
  });

  it.each([
    ['start_workout', { idempotency_key: 'key', owner_user_id: 'another' }],
    ['start_workout', { idempotency_key: 'bad\nheader' }],
    ['create_workout', { idempotency_key: 'key', started_at: 1, completed_at: '2026-10-25T01:30:00Z' }],
    ['create_workout', { idempotency_key: 'key', started_at: '2026-10-25T01:30:00Z' }],
    ['log_sets', { sets: [{ weight_kg: '80', reps: 8 }] }],
    ['log_sets', { exercise_id: 'e', session_exercise_id: 'b', sets: [{ weight_kg: '80', reps: 8 }] }],
    ['log_sets', { exercise_id: 'e', sets: [] }],
    ['log_sets', { exercise_id: 'e', sets: Array.from({ length: 31 }, () => ({ weight_kg: '80', reps: 8 })) }],
    ['log_sets', { exercise_id: 'e', sets: [{ weight_kg: '1e3', reps: 8 }] }],
    ['log_sets', { exercise_id: 'e', sets: [{ weight_kg: '-1', reps: 8 }] }],
    ['log_sets', { exercise_id: 'e', sets: [{ weight_kg: '80', reps: 1000 }] }],
    ['log_sets', { exercise_id: 'e', sets: [{ weight_kg: '80', reps: 2.5 }] }],
    ['log_sets', { exercise_id: 'e', sets: [{ weight_kg: '80', reps: 8, set_type: 'rir_5' }] }],
    ['log_sets', { exercise_id: 'e', sets: [{ weight_kg: '80', reps: 8, performance_status: 'planned' }] }],
    ['update_set', { set_id: 's', set: { weight_kg: '80', reps: 8, target_reps: 9 } }],
    ['finish_workout', { expected_revision: 1 }],
    ['get_active_workout', { cursor: 'x'.repeat(203) }],
    ['get_active_workout', { limit: 101 }],
    ['get_active_workout', { owner_user_id: 'another' }],
  ])('rejects invalid %s input without a workout API request', async (name, patch) => {
    const running = await startMcp(); active.push(running);
    const input = name === 'create_workout' || name === 'start_workout' || name === 'get_active_workout' ? patch : {
      session_id: 's', expected_revision: 'a'.repeat(32), idempotency_key: 'key', ...patch,
    };
    const result = await running.client.callTool({ name, arguments: input });
    expect(result.isError).toBe(true);
    expect(running.requests.filter(r => r.url.pathname.includes('/workouts/'))).toHaveLength(0);
  });

  it.each(['WORKOUT_PERMISSION_REQUIRED', 'REVISION_CONFLICT', 'ACTIVE_WORKOUT_CONFLICT', 'WORKOUT_NOT_ACTIVE',
    'AMBIGUOUS_EXERCISE_BLOCK', 'WORKOUT_REQUIRES_APP', 'WORKOUT_CONTROL_REQUIRED', 'IDEMPOTENCY_CONFLICT'])('preserves actionable workout error %s', async code => {
    const running = await startMcp({ '/functions/v1/agent-api/v1/agent/workouts/start': Response.json({
      error: { code, message: 'Read current state before continuing.', request_id: 'workout-request' },
    }, { status: code === 'WORKOUT_PERMISSION_REQUIRED' ? 403 : 409 }) }); active.push(running);
    const result = await running.client.callTool({ name: 'start_workout', arguments: { idempotency_key: 'key' } });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual({ error: {
      code, message: 'Read current state before continuing.', request_id: 'workout-request',
    } });
  });

  it('translates all tools into the dedicated API routes', async () => {
    const running = await startMcp();
    active.push(running);

    const profile = await running.client.callTool({
      arguments: {},
      name: 'get_training_profile',
    });
    const exercises = await running.client.callTool({
      arguments: { limit: 7, query: 'bench' },
      name: 'search_exercises',
    });
    const context = await running.client.callTool({
      arguments: { exercise_id: 'exercise-a', recent_sessions: 3 },
      name: 'get_exercise_context',
    });
    const workouts = await running.client.callTool({
      arguments: { limit: 4 },
      name: 'get_recent_workouts',
    });
    const history = await running.client.callTool({
      arguments: { exercise_id: 'exercise-a', limit: 10 },
      name: 'get_exercise_history',
    });
    const workoutDetail = await running.client.callTool({
      arguments: { limit: 10, session_id: 'workout-a' },
      name: 'get_workout_detail',
    });
    const status = await running.client.callTool({ arguments: {}, name: 'get_training_status' });
    const activities = await running.client.callTool({
      arguments: { from: '2026-10-01T00:00:00Z', limit: 5, to: '2026-11-01T00:00:00Z' },
      name: 'get_recent_activities',
    });
    const plans = await running.client.callTool({
      arguments: { include_unscheduled: true, limit: 5 },
      name: 'get_upcoming_session_plans',
    });
    const createPlan = await running.client.callTool({
      arguments: {
        idempotency_key: 'plan-key-1',
        plan: {
          exercises: [{ name: 'Bench', sets: [{ target_reps: 5 }] }],
          title: 'Chest day',
        },
      },
      name: 'create_session_plan',
    });
    const createProg = await running.client.callTool({
      arguments: {
        idempotency_key: 'prog-key-1',
        programme: {
          name: 'Wave',
          plans: [
            { exercises: [{ name: 'Bench', sets: [{ target_reps: 5 }] }], title: 'W1' },
            { exercises: [{ name: 'Bench', sets: [{ target_reps: 6 }] }], title: 'W2' },
          ],
        },
      },
      name: 'create_training_programme',
    });

    expect(profile.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/profile'
    ]);
    expect(exercises.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/exercises'
    ]);
    expect(context.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/exercises/exercise-a/context'
    ]);
    expect(workouts.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/workouts/recent'
    ]);
    expect(history.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/exercises/exercise-a/history'
    ]);
    expect(workoutDetail.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/workouts/workout-a'
    ]);
    expect(status.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/training-status'
    ]);
    expect(activities.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/activities'
    ]);
    expect(plans.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/session-plans'
    ]);
    expect(createPlan.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/session-plans'
    ]);
    expect(createProg.structuredContent).toEqual(responses[
      '/functions/v1/agent-api/v1/agent/programmes'
    ]);

    const called = running.requests.map((r) => `${r.method} ${r.url.pathname}${r.url.search}`);
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/exercises?limit=7&query=bench',
    );
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/exercises/exercise-a/context?recent_sessions=3',
    );
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/workouts/recent?limit=4',
    );
    expect(called).toContain('GET /functions/v1/agent-api/v1/agent/training-status');
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/activities?from=2026-10-01T00%3A00%3A00Z&limit=5&to=2026-11-01T00%3A00%3A00Z',
    );
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/exercises/exercise-a/history?limit=10',
    );
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/workouts/workout-a?limit=10',
    );
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/session-plans?include_unscheduled=true&limit=5',
    );
    expect(called).toContain(
      'POST /functions/v1/agent-api/v1/agent/session-plans',
    );
    expect(called).toContain(
      'POST /functions/v1/agent-api/v1/agent/programmes',
    );
  });

  it('forwards co-primary mappings on create and update with an idempotency key', async () => {
    const running = await startMcp();
    active.push(running);

    const muscles = await running.client.callTool({ arguments: {}, name: 'list_muscles' });
    await running.client.callTool({
      arguments: { include_deleted: true, query: 'fly' },
      name: 'search_exercises',
    });
    await running.client.callTool({
      arguments: {
        exercise: {
          muscles: [{ muscle_id: 'chest_sternal', role: 'primary' }, { muscle_id: 'triceps_long', role: 'primary' }],
          name: 'Machine Dips',
          rest_timer_sec: 120,
          split_by_gym: true,
        },
        idempotency_key: 'ex-create-1',
      },
      name: 'create_exercise',
    });
    const updated = await running.client.callTool({
      arguments: {
        changes: { load_input_mode: 'per_side_load', muscles: [{ muscle_id: 'chest_sternal', role: 'primary' }, { muscle_id: 'triceps_long', role: 'primary' }], rest_timer_sec: null, split_by_gym: false },
        exercise_id: 'exercise-a',
        expected_revision: 1,
        idempotency_key: 'ex-update-1',
      },
      name: 'update_exercise',
    });
    const deleted = await running.client.callTool({
      arguments: { exercise_id: 'exercise-a', expected_revision: 2, idempotency_key: 'ex-delete-1' },
      name: 'delete_exercise',
    });
    const restored = await running.client.callTool({
      arguments: { exercise_id: 'exercise-a', expected_revision: 3, idempotency_key: 'ex-restore-1' },
      name: 'restore_exercise',
    });

    expect(muscles.structuredContent).toEqual(responses['/functions/v1/agent-api/v1/agent/muscles']);
    expect(updated.structuredContent).toEqual(responses['/functions/v1/agent-api/v1/agent/exercises/exercise-a']);
    expect(deleted.structuredContent).toEqual(responses['/functions/v1/agent-api/v1/agent/exercises/exercise-a/delete']);
    expect(restored.structuredContent).toEqual(responses['/functions/v1/agent-api/v1/agent/exercises/exercise-a/restore']);

    const posts = running.requests
      .filter((r) => r.method === 'POST')
      .map((r) => ({
        body: JSON.parse(r.body ?? '{}') as unknown,
        key: r.headers.get('idempotency-key'),
        path: r.url.pathname.replace('/functions/v1/agent-api/v1/agent/', ''),
      }));
    expect(posts).toEqual([
      {
        body: { muscles: [{ muscle_id: 'chest_sternal', role: 'primary' }, { muscle_id: 'triceps_long', role: 'primary' }], name: 'Machine Dips', rest_timer_sec: 120, split_by_gym: true },
        key: 'ex-create-1',
        path: 'exercises',
      },
      {
        // null reaches the API, which clears the exercise's own rest timer.
        body: { expected_revision: 1, load_input_mode: 'per_side_load', muscles: [{ muscle_id: 'chest_sternal', role: 'primary' }, { muscle_id: 'triceps_long', role: 'primary' }], rest_timer_sec: null, split_by_gym: false },
        key: 'ex-update-1',
        path: 'exercises/exercise-a',
      },
      { body: { expected_revision: 2 }, key: 'ex-delete-1', path: 'exercises/exercise-a/delete' },
      { body: { expected_revision: 3 }, key: 'ex-restore-1', path: 'exercises/exercise-a/restore' },
    ]);
    expect(running.requests.map((r) => `${r.method} ${r.url.pathname}${r.url.search}`)).toContain(
      'GET /functions/v1/agent-api/v1/agent/exercises?include_deleted=true&query=fly',
    );
  });

  it('translates set_muscle_targets into a PUT of the targets with an idempotency key', async () => {
    const running = await startMcp();
    active.push(running);

    const result = await running.client.callTool({
      arguments: {
        default_weekly_sets: 10,
        expected_revision: 1_730_000_000_000,
        idempotency_key: 'targets-1',
        mode: 'per_muscle',
        overrides: { chest_sternal: 14, lats: null },
      },
      name: 'set_muscle_targets',
    });
    expect(result.structuredContent).toEqual(responses['/functions/v1/agent-api/v1/agent/muscle-targets']);

    const puts = running.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => ({
      body: JSON.parse(r.body ?? '{}') as unknown,
      key: r.headers.get('idempotency-key'),
      path: r.url.pathname.replace('/functions/v1/agent-api/v1/agent/', ''),
      type: r.headers.get('content-type'),
    }))).toEqual([{
      // null reaches the API, which clears that muscle's override.
      body: {
        default_weekly_sets: 10,
        expected_revision: 1_730_000_000_000,
        mode: 'per_muscle',
        overrides: { chest_sternal: 14, lats: null },
      },
      key: 'targets-1',
      path: 'muscle-targets',
      type: 'application/json',
    }]);
  });

  it('translates the note tools into the notes routes, forwarding idempotency keys', async () => {
    const note = {
      body: 'Squat to a bench', created_at: '2026-11-12T09:00:00.000Z', exercise_id: 'exercise-a',
      exercise_name: 'Back Squat', id: 'note-1', noted_on: '2026-11-12', source: 'agent',
    };
    const notesPath = '/functions/v1/agent-api/v1/agent/notes';
    const listed = { next_cursor: null, notes: [note] };
    const running = await startMcp({
      [notesPath]: envelopeResponse(listed),
      [`${notesPath}/note%2F1/remove`]: envelopeResponse({ idempotent_replay: false, note_id: 'note/1', removed: true }),
    });
    active.push(running);

    const list = await running.client.callTool({
      arguments: { exercise_id: 'exercise-a', from: '2026-11-01', limit: 5, to: '2026-11-12' },
      name: 'list_notes',
    });
    await running.client.callTool({
      arguments: { body: '  Squat to a bench  ', exercise_id: 'exercise-a', idempotency_key: 'note-add-1', noted_on: '2026-11-12' },
      name: 'add_note',
    });
    await running.client.callTool({ arguments: { body: 'Shoulder sore', idempotency_key: 'note-add-2' }, name: 'add_note' });
    const removed = await running.client.callTool({
      arguments: { idempotency_key: 'note-remove-1', note_id: 'note/1' },
      name: 'remove_note',
    });

    expect(list.structuredContent).toEqual(listed);
    expect(removed.structuredContent).toEqual({ idempotent_replay: false, note_id: 'note/1', removed: true });
    expect(running.requests.map((r) => `${r.method} ${r.url.pathname}${r.url.search}`)).toContain(
      'GET /functions/v1/agent-api/v1/agent/notes?exercise_id=exercise-a&from=2026-11-01&limit=5&to=2026-11-12',
    );
    expect(running.requests.filter((r) => r.method === 'POST').map((r) => ({
      body: JSON.parse(r.body ?? '{}') as unknown,
      key: r.headers.get('idempotency-key'),
      path: r.url.pathname.replace('/functions/v1/agent-api/v1/agent/', ''),
    }))).toEqual([
      { body: { body: 'Squat to a bench', exercise_id: 'exercise-a', noted_on: '2026-11-12' }, key: 'note-add-1', path: 'notes' },
      { body: { body: 'Shoulder sore' }, key: 'note-add-2', path: 'notes' },
      { body: {}, key: 'note-remove-1', path: 'notes/note%2F1/remove' },
    ]);
  });

  it.each([
    [{ body: '   ' }],
    [{ body: 'x'.repeat(1001) }],
    [{ body: 'ok', exercise_id: '' }],
    [{ body: 'ok', source: 'agent' }],
    [{ body: 'ok', omitKey: true }],
  ])('rejects add_note %j before calling the API', async (input) => {
    const running = await startMcp();
    active.push(running);
    const before = running.requests.length;
    const { omitKey, ...fields } = input as Record<string, unknown>;
    const result = await running.client.callTool({
      arguments: { ...(omitKey ? {} : { idempotency_key: 'note-bad' }), ...fields },
      name: 'add_note',
    });
    expect(result.isError).toBe(true);
    expect(running.requests.slice(before).filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('tells the coach notes are untrusted, dated from noted_on, soft-removed and need Make changes', async () => {
    const running = await startMcp();
    active.push(running);

    const { tools } = await running.client.listTools();
    const descriptionOf = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    for (const name of ['list_notes', 'get_exercise_context', 'get_training_status']) {
      expect(descriptionOf(name)).toMatch(/untrusted user data/);
      expect(descriptionOf(name)).toMatch(/the date a note applies from/);
    }
    expect(descriptionOf('remove_note')).toMatch(/soft delete: the note disappears from every list/);
    for (const name of ['add_note', 'remove_note']) {
      expect(descriptionOf(name)).toMatch(/Make changes switch/);
      expect(descriptionOf(name)).toMatch(/idempotency_key/);
    }
  });

  it('tells the coach overrides need per_muscle mode and name the revision to quote', async () => {
    const running = await startMcp();
    active.push(running);

    const { tools } = await running.client.listTools();
    const description = tools.find((tool) => tool.name === 'set_muscle_targets')?.description ?? '';
    expect(description).toMatch(/only in per_muscle mode/);
    expect(description).toMatch(/targets\.revision from get_training_status/);
  });

  it.each([
    [{ default_weekly_sets: 0 }],
    [{ default_weekly_sets: 8.5 }],
    [{ mode: 'per-muscle' }],
    [{ overrides: { chest_sternal: 0 } }],
    [{ overrides: { chest_sternal: '9' } }],
    [{ overrides: { '': 9 } }],
    [{ expected_revision: -1, default_weekly_sets: 9 }],
    [{ default_weekly_sets: 9, omitExpectedRevision: true }],
    [{ default_weekly_sets: 9, count_secondary_muscles: false }],
    [{ default_weekly_sets: 9, volume_primary_only: true }],
  ])('rejects set_muscle_targets %j before calling the API', async (changes) => {
    const running = await startMcp();
    active.push(running);
    const before = running.requests.length;

    const { omitExpectedRevision, ...fields } = changes as Record<string, unknown>;
    const result = await running.client.callTool({
      arguments: {
        idempotency_key: 'targets-bad',
        ...(omitExpectedRevision ? {} : { expected_revision: 1 }),
        ...fields,
      },
      name: 'set_muscle_targets',
    });

    expect(result.isError).toBe(true);
    expect(running.requests.slice(before).filter((r) => r.method === 'PUT')).toHaveLength(0);
  });

  it('rejects an unknown muscle role before calling the API', async () => {
    const running = await startMcp();
    active.push(running);
    const before = running.requests.length;

    const result = await running.client.callTool({
      arguments: {
        exercise: { muscles: [{ muscle_id: 'chest_sternal', role: 'stabilizer' }], name: 'Plank' },
        idempotency_key: 'ex-bad-1',
      },
      name: 'create_exercise',
    });

    expect(result.isError).toBe(true);
    expect(running.requests.slice(before).filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it.each([10, 601, 90.5, '90'])('rejects rest_timer_sec %p before calling the API', async (restTimerSec) => {
    const running = await startMcp();
    active.push(running);
    const before = running.requests.length;

    const result = await running.client.callTool({
      arguments: {
        changes: { rest_timer_sec: restTimerSec },
        exercise_id: 'exercise-a',
        expected_revision: 1,
        idempotency_key: 'ex-bad-rest',
      },
      name: 'update_exercise',
    });

    expect(result.isError).toBe(true);
    expect(running.requests.slice(before).filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('forwards the gym bucket of a split exercise to both exercise routes', async () => {
    const running = await startMcp();
    active.push(running);
    const before = running.requests.length;

    await running.client.callTool({
      arguments: { exercise_id: 'exercise-a', gym_bucket: 'gym-a' },
      name: 'get_exercise_context',
    });
    await running.client.callTool({
      arguments: { exercise_id: 'exercise-a', gym_bucket: 'gym-b' },
      name: 'get_exercise_history',
    });

    const called = running.requests.slice(before)
      .map((r) => `${r.method} ${r.url.pathname}${r.url.search}`);
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/exercises/exercise-a/context?gym_bucket=gym-a',
    );
    expect(called).toContain(
      'GET /functions/v1/agent-api/v1/agent/exercises/exercise-a/history?gym_bucket=gym-b',
    );
  });

  it('tells the coach a split exercise defaults to the whole exercise and has no no-gym bucket', async () => {
    const running = await startMcp();
    active.push(running);

    const { tools } = await running.client.listTools();
    const descriptionOf = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(descriptionOf('get_exercise_context')).toMatch(/the figures are the whole exercise/);
    for (const name of ['get_exercise_context', 'get_exercise_history']) {
      expect(descriptionOf(name)).toMatch(/one gym id/);
      expect(descriptionOf(name)).not.toMatch(/"none"/);
    }
  });

  // Machines change between gyms; dumbbells do not.
  it('tells the coach to split machines and stations and keep free weights and bodyweight exercises whole', async () => {
    const running = await startMcp();
    active.push(running);

    const { tools } = await running.client.listTools();
    for (const name of ['create_exercise', 'update_exercise']) {
      const description = tools.find((tool) => tool.name === name)?.description ?? '';
      expect(description).toMatch(/split machines and stations/);
      expect(description).toMatch(/keep free weights \(dumbbells, barbells, kettlebells\) and bodyweight exercises whole/);
    }
  });

  it('rejects caller-supplied user identity before invoking a tool API route', async () => {
    const running = await startMcp();
    active.push(running);
    const before = running.requests.length;

    const result = await running.client.callTool({
      arguments: { query: 'bench', user_id: 'user-b' },
      name: 'search_exercises',
    });

    expect(result.isError).toBe(true);
    expect(
      running.requests.slice(before).filter((r) => r.url.pathname.endsWith('/exercises')),
    ).toHaveLength(0);
  });

  it('publishes protected-resource metadata and challenges missing credentials', async () => {
    const api = new BogaAgentApi({
      baseUrl: config.agentApiBaseUrl,
      fetchImplementation: async () => envelopeResponse(responses[
        '/functions/v1/agent-api/v1/agent/session'
      ]),
      timeoutMs: config.requestTimeoutMs,
    });
    const app = await createBogaMcpApp({ api, config, oauthMetadata });

    const metadata = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(metadata.status).toBe(200);
    expect(metadata.body).toMatchObject({
      authorization_servers: [oauthMetadata.issuer],
      resource: config.resourceUrl.href,
      scopes_supported: BOGA_OAUTH_SCOPES,
    });

    const unauthorized = await request(app).post('/mcp').send({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
        protocolVersion: '2025-11-25',
      },
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers['www-authenticate']).toContain('resource_metadata=');
    expect(unauthorized.headers['www-authenticate']).toContain('scope="openid profile"');
  });

  it('advertises offline_access in metadata and the challenge when the issuer supports it', async () => {
    const app = await createBogaMcpApp({
      api: sessionApi(async () => envelopeResponse(validSession)),
      config,
      oauthMetadata: {
        ...oauthMetadata,
        scopes_supported: ['openid', 'profile', 'email', 'phone', 'offline_access'],
      },
    });

    const metadata = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(metadata.body.scopes_supported).toEqual(['openid', 'profile', 'offline_access']);

    const unauthorized = await request(app).post('/mcp').send(initializeRequest);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers['www-authenticate']).toContain(
      'scope="openid profile offline_access"',
    );
  });

  it.each([
    ['revoked or invalid', 401],
    ['not an agent token', 403],
  ])('answers a %s token with 401 and a challenge so clients refresh', async (_label, status) => {
    const app = await createBogaMcpApp({
      api: sessionApi(async () => Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
        { status },
      )),
      config,
      oauthMetadata,
    });

    const response = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer stale-token')
      .send(initializeRequest);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: 'invalid_token' });
    expect(response.headers['www-authenticate']).toMatch(/^Bearer error="invalid_token"/);
    expect(response.headers['www-authenticate']).toContain('scope="openid profile"');
    expect(response.headers['www-authenticate']).toContain(
      'resource_metadata="http://127.0.0.1:8787/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('answers a session past its expiry with 401', async () => {
    const app = await createBogaMcpApp({
      api: sessionApi(async () => envelopeResponse({ ...validSession, expires_at: 1_000 })),
      config,
      oauthMetadata,
    });

    const response = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer expired-token')
      .send(initializeRequest);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Token has expired');
  });

  it.each([
    ['an upstream outage', async () => Response.json({ error: {} }, { status: 500 })],
    ['an unreachable upstream', async () => { throw new TypeError('fetch failed'); }],
    ['upstream rate limiting', async () => Response.json({ error: {} }, { status: 429 })],
  ])('answers %s with 503 and Retry-After, not a token challenge', async (_label, fetchImplementation) => {
    const app = await createBogaMcpApp({
      api: sessionApi(fetchImplementation as typeof fetch),
      config,
      oauthMetadata,
    });

    const response = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer valid-token')
      .send(initializeRequest);

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe(String(UPSTREAM_RETRY_AFTER_SECONDS));
    expect(response.headers['www-authenticate']).toBeUndefined();
  });

  it('answers an unexpected upstream client error with 500, not a token challenge', async () => {
    const app = await createBogaMcpApp({
      api: sessionApi(async () => Response.json({ error: {} }, { status: 404 })),
      config,
      oauthMetadata,
    });

    const response = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer valid-token')
      .send(initializeRequest);

    expect(response.status).toBe(500);
    expect(response.headers['www-authenticate']).toBeUndefined();
  });

  it('aborts and classifies a stalled response body as an upstream timeout', async () => {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stalledStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
      pull() {
        return new Promise(() => {});
      },
    });

    const apiClient = new BogaAgentApi({
      baseUrl: new URL('http://127.0.0.1:55531/functions/v1/agent-api/'),
      fetchImplementation: async (_url, init) => {
        init?.signal?.addEventListener('abort', () => {
          controllerRef?.error(new DOMException('The operation was aborted', 'AbortError'));
        });
        return new Response(stalledStream, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      },
      timeoutMs: 50,
    });

    await expect(
      apiClient.createSessionPlan('valid-token', {
        idempotency_key: 'test-key',
        plan: {
          exercises: [{ name: 'Bench Press', sets: [{ target_reps: 5 }] }],
          title: 'Chest',
        },
      }),
    ).rejects.toThrow('BoGa agent API timed out.');
  });

  it('has no database, SQL, or Supabase runtime dependency', async () => {
    const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(packageJson.dependencies)).not.toContain('pg');
    expect(Object.keys(packageJson.dependencies)).not.toContain('@supabase/supabase-js');
    expect(Object.keys(packageJson.dependencies)).not.toContain('postgres');

    const sourcePaths = ['api-client.ts', 'auth.ts', 'config.ts', 'index.ts', 'server.ts', 'tools.ts'];
    const source = (
      await Promise.all(
        sourcePaths.map((name) =>
          readFile(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8')
        ),
      )
    ).join('\n').toLowerCase();
    expect(source).not.toContain('service_role');
    expect(source).not.toContain('select *');
    expect(source).not.toContain('user_id');
  });
});
