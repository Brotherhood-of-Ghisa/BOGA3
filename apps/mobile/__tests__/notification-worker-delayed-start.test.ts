/** @jest-environment node */
import { handleNotificationRequest, type Rpc } from '../../../supabase/functions/notification-worker/handler';
import { encryptProjection, sendPush } from '../../../supabase/functions/notification-worker/provider';

jest.mock('../../../supabase/functions/notification-worker/provider', () => ({
  encryptProjection: jest.fn(async () => ({ v: 1, bindingId: 'binding', nonce: 'nonce', ciphertext: 'encrypted' })),
  sendPush: jest.fn(async () => ({ outcome: 'ticket', ticketId: 'local-ticket' })),
  fetchReceipt: jest.fn(),
}));

const startedAt = Date.UTC(2026, 9, 14, 10);
const completedAt = startedAt + 3600000;
const originalExpiry = (eventAt: number) => new Date(eventAt + 86400000).toISOString();
const job = (id: number) => ({ id, claim_id: `claim-${id}`, generation: 1 });
const prepared = (id: number, kind: 'start' | 'completion') => ({
  delivery_id: id, claim_id: `claim-${id}`, generation: 1, binding_id: 'binding', encryption_key: 'key',
  token: 'LocalPushToken[ok]', provider: 'local',
  expires_at: originalExpiry(kind === 'start' ? startedAt : completedAt), projection: { kind },
});
const request = () => new Request('https://local/worker', { method: 'POST', headers: { apikey: 'service-key' } });

describe('worker after an admitted start has already completed', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(completedAt + 3600000); jest.clearAllMocks(); });
  afterEach(() => { jest.useRealTimers(); });

  test('a completion-first claim defers, then both events retain their own original provider deadline', async () => {
    const claims = [[job(2), job(1)], [], [job(2)], []];
    let completionAttempts = 0;
    const results: Record<string, unknown>[] = [];
    const rpc: Rpc = async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
      if (name === 'notification_workout_prepare' || name === 'notification_receipt_claim') return { jobs: [] } as T;
      if (name === 'notification_claim') return { jobs: claims.shift() ?? [], disabled: false } as T;
      if (name === 'notification_begin_send') {
        if (args?.p_delivery_id === 2 && completionAttempts++ === 0) return null as T;
        return prepared(Number(args?.p_delivery_id), args?.p_delivery_id === 1 ? 'start' : 'completion') as T;
      }
      if (name === 'notification_send_result') results.push(args!);
      return true as T;
    };
    const first = await handleNotificationRequest(request(), { serviceKey: 'service-key', rpc });
    expect(await first.json()).toMatchObject({ outcomes: { cancelled_or_waiting: 1, ticket: 1 } });
    expect(results.map(result => result.p_delivery_id)).toEqual([1]);
    const second = await handleNotificationRequest(request(), { serviceKey: 'service-key', rpc });
    expect(await second.json()).toMatchObject({ outcomes: { ticket: 1 } });
    expect(results.map(result => [result.p_delivery_id, result.p_outcome])).toEqual([[1, 'ticket'], [2, 'ticket']]);
    expect(jest.mocked(encryptProjection).mock.calls.map(call => call[2])).toEqual([{ kind: 'start' }, { kind: 'completion' }]);
    expect(jest.mocked(sendPush).mock.calls.map(call => call[1].expiration)).toEqual([
      (startedAt + 86400000) / 1000, (completedAt + 86400000) / 1000,
    ]);
    expect(jest.mocked(sendPush).mock.calls.every(call => !('ttl' in call[1]))).toBe(true);
  });

  test('an expired delayed start is rejected without reaching the provider or renewing its deadline', async () => {
    jest.setSystemTime(startedAt + 86400000);
    const claims = [[job(1)], []];
    const results: Record<string, unknown>[] = [];
    const rpc: Rpc = async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
      if (name === 'notification_workout_prepare' || name === 'notification_receipt_claim') return { jobs: [] } as T;
      if (name === 'notification_claim') return { jobs: claims.shift() ?? [], disabled: false } as T;
      if (name === 'notification_begin_send') return prepared(1, 'start') as T;
      if (name === 'notification_send_result') results.push(args!);
      return true as T;
    };
    await handleNotificationRequest(request(), { serviceKey: 'service-key', rpc });
    expect(sendPush).not.toHaveBeenCalled();
    expect(encryptProjection).not.toHaveBeenCalled();
    expect(results).toEqual([{ p_delivery_id: 1, p_claim_id: 'claim-1', p_outcome: 'failed',
      p_ticket_id: null, p_code: 'INVALID_PAYLOAD' }]);
  });

  test('a recovered start retry keeps the captured deadline and fresh claim through later worker drains', async () => {
    const retryJob = { ...job(1), claim_id: 'retry-claim' };
    const claims = [[job(1)], [], [retryJob], []];
    const results: Record<string, unknown>[] = [];
    jest.mocked(sendPush).mockResolvedValueOnce({ outcome: 'retry', code: 'RATE_LIMIT' })
      .mockResolvedValueOnce({ outcome: 'ticket', ticketId: 'retry-ticket' });
    const rpc: Rpc = async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
      if (name === 'notification_workout_prepare' || name === 'notification_receipt_claim') return { jobs: [] } as T;
      if (name === 'notification_claim') return { jobs: claims.shift() ?? [], disabled: false } as T;
      if (name === 'notification_begin_send') return { ...prepared(1, 'start'), claim_id: args?.p_claim_id } as T;
      if (name === 'notification_send_result') results.push(args!);
      return true as T;
    };
    const first = await handleNotificationRequest(request(), { serviceKey: 'service-key', rpc });
    expect(await first.json()).toMatchObject({ outcomes: { retry: 1 } });
    jest.setSystemTime(completedAt + 7200000);
    const second = await handleNotificationRequest(request(), { serviceKey: 'service-key', rpc });
    expect(await second.json()).toMatchObject({ outcomes: { ticket: 1 } });
    expect(results.map(result => [result.p_claim_id, result.p_outcome])).toEqual([
      ['claim-1', 'retry'], ['retry-claim', 'ticket'],
    ]);
    expect(jest.mocked(sendPush).mock.calls.map(call => call[1].expiration)).toEqual([
      (startedAt + 86400000) / 1000, (startedAt + 86400000) / 1000,
    ]);
  });
});
