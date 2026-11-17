import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { bogaBearerAuth } from '../src/auth.js';
import { BogaAgentApi, BogaAgentApiError } from '../src/api-client.js';
import { diagnostic, privateTag, requestDiagnostics } from '../src/diagnostics.js';

const session = { authorized: true as const, access: 'training_read_only' as const,
  client_id: 'private-client', expires_at: 4102444800, scopes: ['openid'] };
const logs = () => vi.spyOn(console, 'log').mockImplementation(() => {});
const appFor = (verifySession: () => Promise<typeof session>) => {
  const app = express();
  app.use(requestDiagnostics, express.json());
  app.post('/mcp', bogaBearerAuth({ api: { verifySession }, challengeScopes: ['openid'],
    resourceMetadataUrl: 'https://boga.example/.well-known/oauth-protected-resource' }),
  (_req, res) => res.sendStatus(200));
  return app;
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('authentication diagnostics preserve HTTP decisions', () => {
  it.each([
    [undefined, 'missing_credentials'], ['Basic secret', 'malformed_credentials'],
    ['Bearer', 'malformed_credentials'],
  ])('classifies %s without leaking credentials', async (authorization, classification) => {
    const spy = logs();
    const verify = vi.fn(async () => session);
    let req = request(appFor(verify)).post('/mcp');
    if (authorization) req = req.set('authorization', authorization);
    const response = await req.send({ method: 'tools/call', params: { name: 'private@example.com', arguments: { password: 'secret' } } });
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Bearer');
    expect(verify).not.toHaveBeenCalled();
    expect(spy.mock.calls.map(call => JSON.parse(String(call[0])))).toContainEqual(expect.objectContaining({ event: 'auth.challenge', classification }));
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('private@example.com');
  });

  it.each([
    [401, 'upstream_unauthorized', 401], [403, 'upstream_forbidden', 401],
    [429, 'upstream_unavailable', 503], [500, 'upstream_unavailable', 503],
    [502, 'upstream_unavailable', 503], [503, 'upstream_unavailable', 503],
    [400, 'upstream_error', 500],
  ])('classifies upstream %i as %s', async (status, classification, expected) => {
    const spy = logs();
    const response = await request(appFor(async () => { throw new BogaAgentApiError(status, 'SECRET', 'private error', 'private-id'); }))
      .post('/mcp').set('authorization', 'Bearer secret-token').send({ method: 'tools/list' });
    expect(response.status).toBe(expected);
    expect(Boolean(response.headers['www-authenticate'])).toBe(expected === 401);
    expect(spy.mock.calls.map(call => JSON.parse(String(call[0])))).toContainEqual(expect.objectContaining({ event: 'auth.verify.result', classification, upstream_status: status }));
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/secret-token|private error|private-id|SECRET/);
  });

  it('classifies unexpected failures without a challenge', async () => {
    const spy = logs();
    const response = await request(appFor(async () => { throw new Error('private'); }))
      .post('/mcp').set('authorization', 'Bearer secret').send({});
    expect(response.status).toBe(500);
    expect(response.headers['www-authenticate']).toBeUndefined();
    expect(spy.mock.calls.map(call => JSON.parse(String(call[0])))).toContainEqual(expect.objectContaining({ classification: 'internal_error' }));
  });

  it('accepts repeated issued credentials, rejects expiry, then accepts a refreshed token', async () => {
    const spy = logs();
    let expired = false;
    const seen: string[] = [];
    const app = appFor(vi.fn(async (...args: unknown[]) => {
      seen.push(String(args[0]));
      return { ...session, expires_at: expired ? 1 : session.expires_at };
    }));
    for (let index = 0; index < 5; index++) {
      expect((await request(app).post('/mcp').set('authorization', 'Bearer issued-token').send({ method: 'tools/list' })).status).toBe(200);
    }
    expired = true;
    expect((await request(app).post('/mcp').set('authorization', 'Bearer issued-token').send({})).status).toBe(401);
    expired = false; // Test double for Supabase-issued replacement; real refresh belongs to mcp-smoke.
    expect((await request(app).post('/mcp').set('authorization', 'Bearer refreshed-token').send({})).status).toBe(200);
    expect(seen.at(-1)).toBe('refreshed-token');
    expect(spy.mock.calls.map(call => JSON.parse(String(call[0])))).toContainEqual(expect.objectContaining({ event: 'auth.challenge', classification: 'session_expired' }));
  });

  it('propagates server correlation IDs and records upstream status', async () => {
    const spy = logs();
    let upstreamId: string | null = null;
    const api = new BogaAgentApi({ baseUrl: new URL('https://api.example/'), timeoutMs: 1000,
      fetchImplementation: async (_url, init) => {
        upstreamId = new Headers(init?.headers).get('x-request-id');
        return Response.json({ data: session, meta: { api_version: 'v1', request_id: upstreamId } });
      } });
    const app = appFor(() => api.verifySession('private-token'));
    const response = await request(app).post('/mcp').set('x-request-id', 'caller-secret')
      .set('authorization', 'Bearer private-token').send({ method: 'tools/call', params: { name: 'get_training_profile' } });
    expect(upstreamId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('caller-secret');
    const events = spy.mock.calls.map(call => JSON.parse(String(call[0])));
    expect(events).toContainEqual(expect.objectContaining({ event: 'upstream.response', status: 200, request_id: upstreamId }));
    expect(events).toContainEqual(expect.objectContaining({ event: 'http.response', tool_name: 'get_training_profile', operation: 'tools/call' }));
  });

  it('fingerprints only when explicitly keyed, with domain separation', () => {
    vi.stubEnv('AUTH_DIAGNOSTIC_HMAC_KEY', '');
    expect(privateTag('token', 'secret')).toBeUndefined();
    vi.stubEnv('AUTH_DIAGNOSTIC_HMAC_KEY', 'x'.repeat(32));
    expect(privateTag('token', 'secret')).toMatch(/^[0-9a-f]{24}$/);
    expect(privateTag('token', 'secret')).not.toBe(privateTag('client', 'secret'));
  });
});

it('caps log volume, reports suppressed records, and ignores sink failures', () => {
  const spy = logs();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
  for (let index = 0; index < 6010; index++) diagnostic('test');
  expect(spy.mock.calls).toHaveLength(6000);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
  diagnostic('test');
  expect(JSON.parse(String(spy.mock.calls.at(-1)?.[0])).suppressed_since_last).toBe(10);
  spy.mockImplementation(() => { throw new Error('sink'); });
  expect(() => diagnostic('test')).not.toThrow();
});
