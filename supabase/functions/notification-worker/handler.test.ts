import { handleNotificationRequest, type Rpc } from './handler.ts';
import { encryptProjection, sendPush, fetchReceipt, type PushMessage } from './provider.ts';
const assert = (condition: boolean, message = 'assertion failed') => { if (!condition) throw new Error(message); };
const equal = (a: unknown, b: unknown) => assert(JSON.stringify(a) === JSON.stringify(b));
const key = btoa('k'.repeat(32));
const binding = '13fd126c-f1cc-49de-822d-a8cefa38c355';

Deno.test('service auth fails closed before any privileged RPC', async () => {
  for (const apikey of ['', 'normal-user-jwt', 'service-key-wrong']) {
    let calls = 0;
    const rpc: Rpc = async <T>() => { calls += 1; return null as T; };
    const response = await handleNotificationRequest(new Request('https://local/worker', {
      method: 'POST', headers: { apikey },
    }), { serviceKey: 'service-key', rpc });
    equal(response.status, 401); equal(calls, 0);
  }
  const response = await handleNotificationRequest(new Request('https://local/worker'), {
    serviceKey: 'service-key', rpc: async <T>() => null as T,
  });
  equal(response.status, 405);
});

Deno.test('AES-GCM standard native format authenticates binding and ciphertext', async () => {
  const projection = { recipientUserId: 'account', identity: 'Alex · Group', route: { sessionId: 'private-route' } };
  const envelope = await encryptProjection(key, binding, projection);
  equal(Object.keys(envelope), ['v', 'bindingId', 'nonce', 'ciphertext']);
  assert(!JSON.stringify(envelope).includes('Alex'));
  const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const nativeKey = await crypto.subtle.importKey('raw', decode(key), 'AES-GCM', false, ['decrypt']);
  const nonce = decode(envelope.nonce); const combined = decode(envelope.ciphertext);
  equal(nonce.length, 12); assert(combined.length > 16);
  const decrypt = (bindingId: string, value: Uint8Array) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce,
    additionalData: new TextEncoder().encode(`boga-notification-v1:${bindingId}`), tagLength: 128 }, nativeKey, value);
  equal(JSON.parse(new TextDecoder().decode(await decrypt(binding, combined))), projection);
  for (const [id, bytes] of [['wrong-binding', combined], [binding, combined.slice(0, -1)]] as const) {
    let rejected = false; try { await decrypt(id, bytes); } catch { rejected = true; } assert(rejected);
  }
  let missingRejected = false; try { await encryptProjection('', binding, projection); } catch { missingRejected = true; }
  assert(missingRejected);
});

Deno.test('local sink exercises provider ticket, rejection and receipt boundary', async () => {
  const data = await encryptProjection(key, binding, { expiresAt: Date.now() + 10000 });
  const message: PushMessage = { to: 'LocalPushToken[ok]', title: 'BoGa', body: 'Open the app to view your notification',
    ttl: 10, mutableContent: true, categoryId: 'boga-workout', data };
  const accepted = await sendPush('local', message);
  equal(accepted.outcome, 'ticket'); assert(!!accepted.ticketId);
  equal((await fetchReceipt('local', accepted.ticketId!)).outcome, 'ticket');
  equal((await sendPush('local', { ...message, to: 'LocalPushToken[rate]' })).outcome, 'retry');
  equal((await sendPush('local', { ...message, to: 'LocalPushToken[dead]' })).outcome, 'device_unregistered');
  equal((await sendPush('local', { ...message, to: 'LocalPushToken[invalid]' })).outcome, 'failed');
  equal((await sendPush('local', { ...message, to: 'LocalPushToken[unknown]' })).outcome, 'uncertain');
  equal((await sendPush('local', { ...message, to: 'ExpoPushToken[production]' })).outcome, 'failed');
  const dead = await sendPush('local', { ...message, to: 'LocalPushToken[receipt-dead]' });
  equal((await fetchReceipt('local', dead.ticketId!)).outcome, 'device_unregistered');
  equal((await sendPush('local', { ...message, body: 'x'.repeat(5000) })).outcome, 'failed');
});

Deno.test('worker bounds work, reports only outcomes and persists accepted tickets', async () => {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const rpc: Rpc = async <T>(name: string, args?: Record<string, unknown>) => {
    calls.push([name,args]);
    if (name === 'notification_claim') return { jobs: [{ id: 1, claim_id: 'claim', generation: 1 }], disabled: false } as T;
    if (name === 'notification_receipt_claim') return { jobs: [] } as T;
    if (name === 'notification_begin_send') return { delivery_id: 1,claim_id: 'claim',generation: 1,
      binding_id: binding,encryption_key: key,token: 'LocalPushToken[ok]',provider: 'local',
      expires_at: new Date(Date.now()+60000).toISOString(),projection: { identity: 'SECRET NAME' } } as T;
    return true as T;
  };
  const response = await handleNotificationRequest(new Request('https://local/worker', {
    method: 'POST', headers: { apikey: 'service-key' },
  }), { serviceKey: 'service-key', rpc });
  equal(response.status,200);
  const body = await response.text(); assert(!body.includes('SECRET')); assert(!body.includes('LocalPushToken'));
  assert(calls.some(([name,args]) => name === 'notification_send_result' && args?.p_outcome === 'ticket'));
  equal(calls.filter(([name])=>name==='notification_claim').length,1);
});
