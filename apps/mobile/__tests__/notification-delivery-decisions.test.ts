import { providerOutcome, remainingLifetime } from '@/src/notifications/delivery-decisions';

describe('notification delivery decisions', () => {
  test('retry TTL retains the original expiry and never extends an old event', () => {
    const expiry = new Date(86400000).toISOString();
    expect(remainingLifetime(expiry, 0)).toBe(86400);
    expect(remainingLifetime(expiry, 86398000)).toBe(2);
    expect(remainingLifetime(expiry, 86399999)).toBe(0);
    expect(remainingLifetime(expiry, 86400000)).toBe(0);
    expect(remainingLifetime('invalid', 0)).toBe(0);
  });
  test.each([
    [429, {}, { outcome: 'retry', code: 'RATE_LIMIT' }],
    [503, {}, { outcome: 'retry', code: 'PROVIDER_TEMPORARY' }],
    [401, {}, { outcome: 'failed', code: 'INVALID_CREDENTIALS' }],
    [403, {}, { outcome: 'failed', code: 'INVALID_CREDENTIALS' }],
    [400, {}, { outcome: 'failed', code: 'INVALID_PAYLOAD' }],
    [200, { status: 'ok', id: 'ticket' }, { outcome: 'ticket', ticketId: 'ticket' }],
    [200, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { outcome: 'device_unregistered', code: 'DEVICE_NOT_REGISTERED' }],
    [200, { status: 'error', details: { error: 'MessageRateExceeded' } }, { outcome: 'retry', code: 'RATE_LIMIT' }],
    [200, { status: 'error', details: { error: 'InvalidCredentials' } }, { outcome: 'failed', code: 'INVALID_CREDENTIALS' }],
    [200, { status: 'error', details: { error: 'MessageTooBig' } }, { outcome: 'failed', code: 'INVALID_PAYLOAD' }],
    [200, { status: 'ok' }, { outcome: 'uncertain', code: 'PROVIDER_INVALID_RESPONSE' }],
    [200, ['wrong-shape'], { outcome: 'uncertain', code: 'PROVIDER_INVALID_RESPONSE' }],
    [200, null, { outcome: 'uncertain', code: 'PROVIDER_INVALID_RESPONSE' }],
  ])('classifies provider %s without exposing its raw diagnostics', (status, body, expected) => {
    expect(providerOutcome(status, body)).toEqual(expected);
  });
  test('a receipt success is acceptance, with no second send ticket', () => {
    expect(providerOutcome(200, { status: 'ok' }, true)).toEqual({ outcome: 'ticket' });
  });
});
