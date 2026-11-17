// Exercise the production Edge handler with only network/data clients replaced.
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockCreateClient = jest.fn();
const mockInsert = jest.fn(async () => ({ error: null }));
jest.mock('npm:@supabase/supabase-js@2.98.0', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}), { virtual: true });

let handler: (request: Request) => Promise<Response>;
const realFetch = globalThis.fetch;
const originalDeno = (globalThis as any).Deno;
const claims = { sub: 'private-user', client_id: 'private-client', exp: 4102444800,
  iss: 'https://auth.example/auth/v1', aud: 'authenticated', scope: 'openid offline_access' };
const token = (payload: unknown) => `header.${btoa(JSON.stringify(payload))}.signature`;
let logSpy: jest.SpyInstance;
beforeAll(() => {
  (globalThis as any).Deno = {
    env: { get: (key: string) => ({ SUPABASE_URL: 'https://auth.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' }[key]) },
    serve: (callback: typeof handler) => { handler = callback; },
  };
  require('../../../supabase/functions/agent-api/index.ts');
});
afterAll(() => { (globalThis as any).Deno = originalDeno; globalThis.fetch = realFetch; });
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  mockCreateClient.mockReset().mockImplementation(() => ({ auth: { getUser: mockGetUser }, rpc: mockRpc, from: () => ({ insert: mockInsert }) }));
  mockRpc.mockReset().mockResolvedValue({ data: '2026-01-01T00:00:00+00:00', error: null, status: 200 });
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'private-user' } }, error: null });
  // Reproduces the hosted Auth restriction. Valid OAuth requests must not call this endpoint.
  globalThis.fetch = jest.fn(async () => Response.json({ code: 'no_authorization' }, { status: 403 })) as typeof fetch;
});
afterEach(() => { logSpy.mockRestore(); });
const call = (authorization: string | null = `Bearer ${token(claims)}`) => handler(new Request('https://api.example/v1/agent/session', {
  headers: { ...(authorization === null ? {} : { authorization }), 'x-request-id': '12345678-1234-4123-8123-123456789012' },
}));
const classified = () => logSpy.mock.calls.map(call => JSON.parse(String(call[0]))).map(event => event.classification).filter(Boolean);

describe('Agent API live authentication boundary diagnostics', () => {
  it.each([[null, 'missing_credentials'], ['Basic private', 'malformed_credentials']])('classifies missing/malformed credentials', async (header, reason) => {
    expect((await call(header)).status).toBe(401);
    expect(classified()).toContain(reason);
    expect(mockGetUser).not.toHaveBeenCalled();
  });
  it.each([[401, 'auth_token_rejected', 401], [403, 'auth_token_rejected', 401], [404, 'auth_token_rejected', 401],
    [429, 'auth_user_unavailable', 503], [503, 'auth_user_unavailable', 503], [0, 'auth_user_unavailable', 503]])('classifies getUser %i', async (status, reason, expected) => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { status, code: 'bad_jwt' } });
    const response = await call();
    expect(response.status).toBe(expected);
    expect(Boolean(response.headers.get('www-authenticate'))).toBe(expected === 401);
    expect(classified()).toContain(reason);
  });
  it('classifies internal validation failures without leaking payloads', async () => {
    expect((await call(`Bearer ${token(null)}`)).status).toBe(500);
    expect(classified()).toContain('internal_error');
  });
  it('classifies Auth network errors as unavailable', async () => {
    mockGetUser.mockRejectedValue(new Error('private network details'));
    expect((await call()).status).toBe(503);
    expect(classified()).toContain('auth_user_unavailable');
  });
  it.each([
    [{ ...claims, client_id: '' }, 'oauth_client_missing'], [{ ...claims, sub: 'other' }, 'subject_mismatch'],
    [{ ...claims, exp: undefined }, 'expiry_missing'], [{ ...claims, exp: 1 }, 'token_expired'],
  ])('classifies local validated-claim failures', async (payload, reason) => {
    expect((await call(`Bearer ${token(payload)}`)).status).toBe(401);
    expect(classified()).toContain(reason);
  });
  it('classifies malformed payloads returned as valid by Auth', async () => {
    expect((await call('Bearer malformed')).status).toBe(401);
    expect(classified()).toContain('malformed_validated_claims');
  });
  it.each([401, 403, 429, 500, 503])('treats service RPC HTTP %i as unavailable, not bad OAuth credentials', async (status) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'server_failure' }, status });
    const response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(response.headers.get('retry-after')).toBe('5');
    expect(classified()).toContain('grants_unavailable');
  });
  it('rejects an absent/revoked active grant', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null, status: 200 });
    expect((await call()).status).toBe(401);
    expect(classified()).toContain('active_grant_absent');
  });
  it.each(['invalid timestamp', {}, [], 1, undefined])('fails closed on malformed RPC data without demanding consent', async (data) => {
    mockRpc.mockResolvedValue({ data, error: null, status: 200 });
    const response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(classified()).toContain('grants_invalid_response');
  });
  it('observes expired rejected tokens without trusting their claims', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { status: 403, code: 'bad_jwt' } });
    expect((await call(`Bearer ${token({ ...claims, exp: 1 })}`)).status).toBe(401);
    expect(logSpy.mock.calls.map(call => JSON.parse(String(call[0])))).toContainEqual(expect.objectContaining({
      event: 'auth.token_observations', expiry_state: 'expired', provenance: 'unverified' }));
    expect(logSpy.mock.calls.map(call => JSON.parse(String(call[0])))).toContainEqual(expect.objectContaining({
      event: 'auth.verify.result', classification: 'credentials_rejected', latency_ms: expect.any(Number) }));
  });
  it('preserves external response IDs while excluding them from diagnostics', async () => {
    const response = await handler(new Request('https://api.example/v1/agent/session', { headers: {
      authorization: `Bearer ${token(claims)}`, 'x-request-id': 'caller-private-id' } }));
    expect(response.headers.get('x-request-id')).toBe('caller-private-id');
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('caller-private-id');
  });
  it('classifies RPC network failures as unavailable', async () => {
    mockRpc.mockRejectedValue(new Error('private connection details'));
    const response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(classified()).toContain('grants_unavailable');
  });
  it('uses only Auth-validated identity and server credentials for grant lookup', async () => {
    expect((await call()).status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('agent_active_oauth_grant', { p_owner: 'private-user', p_client_id: 'private-client' });
    expect(mockCreateClient.mock.calls[1][1]).toBe('service');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    mockRpc.mockClear();
    expect((await call(`Bearer ${token({ ...claims, sub: 'other' })}`)).status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('propagates correlation through the real service SDK without forwarding the OAuth token', async () => {
    const actual = jest.requireActual('@supabase/supabase-js');
    mockCreateClient.mockImplementation((_url: string, key: string, options: unknown) => key === 'service'
      ? actual.createClient('https://auth.example', key, options)
      : { auth: { getUser: mockGetUser } });
    globalThis.fetch = jest.fn(async () => Response.json('2026-01-01T00:00:00+00:00')) as typeof fetch;
    expect((await call()).status).toBe(200);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toBe('https://auth.example/rest/v1/rpc/agent_active_oauth_grant');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer service');
    expect(headers.get('apikey')).toBe('service');
    expect(headers.get('x-request-id')).toBe('12345678-1234-4123-8123-123456789012');
    expect(JSON.parse(init.body)).toEqual({ p_owner: 'private-user', p_client_id: 'private-client' });
  });
  it('keeps write permissions bound to the current consent timestamp', async () => {
    const permission = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn(async () => ({
      data: { plan_access_enabled: true, granted_at: '2026-01-01T00:00:00Z' }, error: null,
    })) };
    permission.select.mockReturnValue(permission);
    permission.eq.mockReturnValue(permission);
    mockCreateClient.mockImplementation(() => ({ auth: { getUser: mockGetUser }, rpc: mockRpc,
      from: (table: string) => table === 'agent_plan_permissions' ? permission : { insert: mockInsert } }));
    const plans = () => handler(new Request('https://api.example/v1/agent/session-plans?limit=0', {
      headers: { authorization: `Bearer ${token(claims)}` },
    }));
    // Matching timestamp passes permission validation and reaches domain input validation.
    expect((await plans()).status).toBe(400);
    mockRpc.mockResolvedValue({ data: '2026-01-02T00:00:00+00:00', error: null, status: 200 });
    const response = await plans();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('PLAN_PERMISSION_REQUIRED');
  });
  it('rechecks every request across refresh and rejects subsequent revocation', async () => {
    for (let index = 0; index < 3; index++) expect((await call()).status).toBe(200);
    expect((await call(`Bearer ${token({ ...claims, exp: 4102444900 })}`)).status).toBe(200);
    expect(mockRpc).toHaveBeenCalledTimes(4);
    mockRpc.mockResolvedValue({ data: null, error: null, status: 200 });
    expect((await call()).status).toBe(401);
    expect(mockRpc).toHaveBeenCalledTimes(5);
  });
  it('accepts repeated consent-issued tokens and replacement tokens without exposing identity', async () => {
    for (let index = 0; index < 3; index++) expect((await call()).status).toBe(200);
    expect((await call(`Bearer ${token({ ...claims, exp: 4102444900 })}`)).status).toBe(200);
    expect(classified()).toContain('active_grant_found');
    expect(classified()).toContain('accepted');
    expect(JSON.stringify(logSpy.mock.calls)).not.toMatch(/private-user|private-client|signature|service-role/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
