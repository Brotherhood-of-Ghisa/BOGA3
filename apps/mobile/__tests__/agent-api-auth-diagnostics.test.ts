import { authTrace, claimFailure, claimObservations, privateTag } from '../../../supabase/functions/agent-api/auth-diagnostics.ts';

const valid = { client_id: 'client', sub: 'user', exp: 2000 };
describe('Agent API authentication diagnostic classifications', () => {
  it.each([
    [{ ...valid, client_id: undefined }, 'oauth_client_missing'],
    [{ ...valid, client_id: ' ' }, 'oauth_client_missing'],
    [{ ...valid, sub: 'other' }, 'subject_mismatch'],
    [{ ...valid, exp: undefined }, 'expiry_missing'],
    [{ ...valid, exp: 1000 }, 'token_expired'],
    [valid, null],
  ])('classifies validated claims without logging identity', (claims, expected) => {
    expect(claimFailure(claims, 'user', 1000000)).toBe(expected);
  });

  it('reports issuer/audience comparisons as observations, not enforcement', () => {
    const observed = claimObservations({ ...valid, iss: 'https://auth.example/auth/v1', aud: ['authenticated'], scope: 'openid offline_access' }, 'https://auth.example/auth/v1');
    expect(observed).toMatchObject({ issuer_observed: 'matches', audience_observed: 'matches', offline_access_claimed: true, issuer_audience_enforcement: 'delegated_to_supabase_auth' });
    expect(claimObservations({ iss: 'wrong', aud: 'wrong' }, 'expected')).toMatchObject({ issuer_observed: 'mismatch', audience_observed: 'mismatch', expiry_state: 'missing' });
    expect(claimObservations({}, 'expected')).toMatchObject({ issuer_observed: 'missing', audience_observed: 'missing' });
    expect(JSON.stringify(observed)).not.toMatch(/client|https:|user/);
  });

  it('emits bounded JSON logs with correlation and suppression accounting', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const trace = authTrace('request-id');
    for (let index = 0; index < 6010; index++) trace('auth.test', { classification: 'accepted' });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(6000);
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toMatchObject({ service: 'agent-api', request_id: 'request-id', classification: 'accepted' });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
    trace('auth.test');
    expect(JSON.parse(String(spy.mock.calls.at(-1)?.[0]))).toMatchObject({ suppressed_since_last: 10 });
    clock.mockRestore();
    spy.mockRestore();
  });
});

it('logging sink errors cannot escape into authorization', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => { throw new Error('sink'); });
  expect(() => authTrace('request-id')('auth.test')).not.toThrow();
  spy.mockRestore();
});
it('uses the same domain-separated HMAC as Render', async () => {
  const { webcrypto, createHmac } = jest.requireActual('node:crypto');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  try {
    expect(await privateTag(undefined, 'token', 'secret')).toBeUndefined();
    const key = 'x'.repeat(32);
    expect(await privateTag(key, 'token', 'secret')).toBe(createHmac('sha256', key).update('token:secret').digest('hex').slice(0, 24));
    expect(await privateTag(key, 'token', 'secret')).not.toBe(await privateTag(key, 'client', 'secret'));
  } finally {
    if (prior) Object.defineProperty(globalThis, 'crypto', prior);
    else delete (globalThis as any).crypto;
  }
});
