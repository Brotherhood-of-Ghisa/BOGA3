// Exercise the production Edge handler with only network/data clients replaced.
const mockGetUser = jest.fn();
const mockInsert = jest.fn(async () => ({ error: null }));
jest.mock('npm:@supabase/supabase-js@2.98.0', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser }, from: () => ({ insert: mockInsert }) }),
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
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'private-user' } }, error: null });
  globalThis.fetch = jest.fn(async () => Response.json([{ client_id: 'private-client', granted_at: '2026-01-01T00:00:00Z' }])) as typeof fetch;
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
  it.each([[401, 'grants_token_rejected', 401], [403, 'grants_token_rejected', 401],
    [429, 'grants_unavailable', 503], [500, 'grants_unavailable', 503]])('classifies grants HTTP %i', async (status, reason, expected) => {
    globalThis.fetch = jest.fn(async () => new Response('{}', { status })) as typeof fetch;
    expect((await call()).status).toBe(expected);
    expect(classified()).toContain(reason);
  });
  it.each([
    [[], 'active_grant_absent'], [[{ client_id: 'other', granted_at: 'date' }], 'grant_client_mismatch'],
    [[{ client_id: 'private-client' }], 'grant_timestamp_missing'],
  ])('classifies active grant lookup rejection', async (grants, reason) => {
    globalThis.fetch = jest.fn(async () => Response.json(grants)) as typeof fetch;
    expect((await call()).status).toBe(401);
    expect(classified()).toContain(reason);
  });
  it('observes grants schema drift while preserving the existing rejection', async () => {
    globalThis.fetch = jest.fn(async () => Response.json({ unexpected: true })) as typeof fetch;
    expect((await call()).status).toBe(401);
    expect(classified()).toContain('grants_unrecognized_shape');
    expect(classified()).toContain('active_grant_absent');
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
  it('classifies unreadable grants and network failures', async () => {
    globalThis.fetch = jest.fn(async () => new Response('not json')) as typeof fetch;
    expect((await call()).status).toBe(503);
    expect(classified()).toContain('grants_invalid_response');
    globalThis.fetch = jest.fn(async () => { throw new Error('private'); }) as typeof fetch;
    expect((await call()).status).toBe(503);
    expect(classified()).toContain('grants_unavailable');
  });
  it('accepts repeated consent-issued tokens and replacement tokens without exposing identity', async () => {
    for (let index = 0; index < 3; index++) expect((await call()).status).toBe(200);
    expect((await call(`Bearer ${token({ ...claims, exp: 4102444900 })}`)).status).toBe(200);
    expect(classified()).toContain('active_grant_found');
    expect(classified()).toContain('accepted');
    expect(JSON.stringify(logSpy.mock.calls)).not.toMatch(/private-user|private-client|signature|service-role/);
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ 'x-request-id': '12345678-1234-4123-8123-123456789012' }) }));
  });
});
