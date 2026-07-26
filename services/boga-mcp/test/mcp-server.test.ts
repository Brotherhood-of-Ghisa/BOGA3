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
import { createBogaMcpApp } from '../src/server.js';

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
    recent_performances: [],
  },
  '/functions/v1/agent-api/v1/agent/workouts/recent': {
    next_cursor: null,
    workouts: [{ id: 'workout-a' }],
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

const startMcp = async () => {
  const requests: URL[] = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
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
  it('discovers exactly the four read-only tools', async () => {
    const running = await startMcp();
    active.push(running);
    const result = await running.client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      'get_exercise_context',
      'get_recent_workouts',
      'get_training_profile',
      'search_exercises',
    ]);
    for (const tool of result.tools) {
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        readOnlyHint: true,
      });
    }
  });

  it('translates all four tools into the dedicated API routes', async () => {
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

    const called = running.requests.map((url) => `${url.pathname}${url.search}`);
    expect(called).toContain(
      '/functions/v1/agent-api/v1/agent/exercises?limit=7&query=bench',
    );
    expect(called).toContain(
      '/functions/v1/agent-api/v1/agent/exercises/exercise-a/context?recent_sessions=3',
    );
    expect(called).toContain(
      '/functions/v1/agent-api/v1/agent/workouts/recent?limit=4',
    );
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
      running.requests.slice(before).filter((url) => url.pathname.endsWith('/exercises')),
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
  });

  it('has no database, SQL, or Supabase runtime dependency', async () => {
    const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(packageJson.dependencies)).not.toContain('pg');
    expect(Object.keys(packageJson.dependencies)).not.toContain('@supabase/supabase-js');
    expect(Object.keys(packageJson.dependencies)).not.toContain('postgres');

    const sourcePaths = ['api-client.ts', 'config.ts', 'index.ts', 'server.ts', 'tools.ts'];
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
