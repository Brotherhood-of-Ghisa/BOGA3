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
  const decrypt = (bindingId: string, value: Uint8Array<ArrayBuffer>) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce,
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
    expiration: Math.floor(Date.now()/1000)+10, mutableContent: true, categoryId: 'boga-workout', data };
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
    if (name === 'notification_workout_prepare') return { jobs: [] } as T;
    if (name === 'notification_claim') return { jobs: calls.filter(([n])=>n==='notification_claim').length===1
      ? [{ id: 1, claim_id: 'claim', generation: 1 }] : [], disabled: false } as T;
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
  equal(calls.filter(([name])=>name==='notification_claim').length,2);
});

Deno.test('real worker uses the portable final-outcome calculation and isolates intake failure', async () => {
  const rank = (members: string[]) => members.map((member_user_id,index)=>({metric:'e1rm',certified:false,member_user_id,rank:index+1}));
  let contribution: unknown;
  let sends = 0;
  const rpc: Rpc = async <T>(name: string,args?: Record<string,unknown>) => {
    if (name === 'notification_workout_prepare') return {jobs:[{member_user_id:'lifter',session_id:'workout',generation:2,
      targets:[{group_id:'group',group_exercise_id:'bench',best_metrics:['e1rm','volume'],
        before:rank(['a','b','c','lifter']),final:rank(['a','lifter','b','c']),without_workout:rank(['a','b','c','lifter'])}]}]} as T;
    if (name === 'notification_workout_enqueue') { contribution=args?.p_contributions; return true as T; }
    if (name === 'notification_claim') sends+=1;
    return {jobs:[],disabled:false} as T;
  };
  const request = () => new Request('https://local/worker',{method:'POST',headers:{apikey:'service-key'}});
  equal((await handleNotificationRequest(request(),{serviceKey:'service-key',rpc})).status,200);
  equal(contribution,[{group_id:'group',best_count:2,rank_count:3}]);
  const broken: Rpc = <T>(name: string,args?: Record<string,unknown>): Promise<T> => {
    if (name === 'notification_workout_prepare') throw new Error('PRIVATE SOURCE VALUES');
    return rpc<T>(name,args);
  };
  const response=await handleNotificationRequest(request(),{serviceKey:'service-key',rpc:broken});
  equal(response.status,200); assert(!(await response.text()).includes('PRIVATE')); equal(sends,2);
});

Deno.test('provider handoff preserves the absolute deadline and never uses a renewing TTL', async () => {
  const originalFetch = globalThis.fetch;
  const expiration = Math.floor(Date.now()/1000)+60;
  const data = await encryptProjection(key, binding, { expiresAt: expiration*1000 });
  const message: PushMessage = { to: 'ExpoPushToken[fixture-only]',title: 'BoGa',
    body: 'Open the app to view your notification', expiration,mutableContent: true,categoryId: 'boga-workout',data };
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const request = input as Request; const body = await request.json();
    equal(body.expiration,expiration); assert(!('ttl' in body));
    equal(body.title,'BoGa'); equal(body.body,'Open the app to view your notification');
    equal(Object.keys(body.data),['v','bindingId','nonce','ciphertext']);
    return Response.json({ data: { status: 'ok',id: 'fixture-ticket' } });
  };
  try {
    equal((await sendPush('expo',message)).outcome,'ticket');
    equal((await sendPush('expo',{ ...message,expiration: Math.floor(Date.now()/1000)-1 })).outcome,'failed');
    equal(calls,1);
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test('fresh bounded claims do not waste send or receipt leases on slow providers', async () => {
  const realNow = Date.now; const realFetch = globalThis.fetch;
  let now = realNow(); let sends = 0; let receipts = 0; let accepted = 0; let collected = 0;
  const leases = new Map<number,number>();
  Date.now = () => now;
  globalThis.fetch = async (input) => {
    const request = input as Request; const body = await request.json();
    // Advance a fake clock, without sleeping or touching a real provider.
    now += 9500;
    return Response.json({ data: body.ids ? Object.fromEntries(body.ids.map((id: string)=>[id,{status:'ok'}]))
      : {status:'ok',id:'fixture-ticket'} });
  };
  const rpc: Rpc = async <T>(name: string,args?: Record<string,unknown>): Promise<T> => {
    if (name === 'notification_workout_prepare') return { jobs: [] } as T;
    if (name === 'notification_receipt_claim' || name === 'notification_claim') {
      equal(args?.p_limit,4);
      const receipt = name === 'notification_receipt_claim'; const start = receipt ? receipts : sends;
      const size = Math.min(4,20-start);
      const jobs = Array.from({length:size},(_,index) => {
        const id = start+index+(receipt ? 100 : 0); leases.set(id,now+60000);
        return receipt ? {id,receipt_claim_id:'claim',ticket_id:`fixture-${id}`,provider:'expo'} : {id,claim_id:'claim',generation:1};
      });
      if (receipt) receipts += size; else sends += size;
      return {jobs,disabled:false} as T;
    }
    const id = args?.p_delivery_id as number;
    if (name === 'notification_begin_send') {
      assert(now<leases.get(id)!, 'claim expired before beginning');
      return {delivery_id:id,claim_id:'claim',generation:1,binding_id:binding,encryption_key:key,
        token:'ExpoPushToken[fixture-only]',provider:'expo',expires_at:new Date(now+86400000).toISOString(),projection:{v:1}} as T;
    }
    if (name === 'notification_send_result' || name === 'notification_receipt_result') {
      assert(now<leases.get(id)!, 'provider result outran its active lease');
      if (name === 'notification_send_result') accepted+=1; else collected+=1;
    }
    return true as T;
  };
  try {
    const response = await handleNotificationRequest(new Request('https://local/worker',{
      method:'POST',headers:{apikey:'service-key'},
    }),{serviceKey:'service-key',rpc});
    equal(response.status,200); equal(accepted,20); equal(collected,20);
    const result = await response.json(); equal(result.claimed,20); equal(result.receipts,20);
  } finally { Date.now=realNow; globalThis.fetch=realFetch; }
});
