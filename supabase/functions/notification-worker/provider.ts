import { providerOutcome, type ProviderOutcome } from '../../../apps/mobile/src/notifications/delivery-decisions.ts';

export type Envelope = { v: 1; bindingId: string; nonce: string; ciphertext: string };
export type PushMessage = { to: string; title: string; body: string; ttl: number; mutableContent: true; categoryId: string; data: Envelope };
const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unbase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export const encryptProjection = async (key: string, bindingId: string, projection: unknown): Promise<Envelope> => {
  const raw = unbase64(key);
  if (raw.length !== 32) throw new Error('INVALID_KEY');
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const imported = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
    additionalData: new TextEncoder().encode(`boga-notification-v1:${bindingId}`), tagLength: 128 },
  imported, new TextEncoder().encode(JSON.stringify(projection)));
  return { v: 1, bindingId, nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) };
};

/** Same HTTP JSON boundary as Expo, synthetic local tokens only; never forwards a request. */
export const localProvider = async (request: Request): Promise<Response> => {
  const body = await request.json();
  if (new URL(request.url).pathname.endsWith('/send')) {
    if (typeof body.to !== 'string' || !/^LocalPushToken\[[A-Za-z0-9_-]{1,120}\]$/.test(body.to)) return Response.json({}, { status: 400 });
    if (body.to.includes('[rate]')) return Response.json({}, { status: 429 });
    if (body.to.includes('[invalid]')) return Response.json({}, { status: 400 });
    if (body.to.includes('[dead]')) return Response.json({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } });
    if (body.to.includes('[unknown]')) return Response.json({ data: {} });
    const code = body.to.includes('[receipt-dead]') ? 'dead' : 'ok';
    // The binding/nonce produce distinct tickets without retaining a token or preview.
    return Response.json({ data: { status: 'ok', id: `local:${code}:${body.data.bindingId}:${body.data.nonce}` } });
  }
  const data: Record<string, unknown> = {};
  for (const id of body.ids ?? []) data[id] = String(id).startsWith('local:dead:')
    ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' };
  return Response.json({ data });
};

const call = async (provider: 'local' | 'expo', path: 'send' | 'getReceipts', body: unknown,
  accessToken?: string): Promise<{ status: number; body: unknown }> => {
  const request = new Request(`https://exp.host/--/api/v2/push/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json',
      ...(provider === 'expo' && accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const response = provider === 'local' ? await localProvider(request) : await fetch(request);
  let json: unknown;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, body: json };
};

export const sendPush = async (provider: 'local' | 'expo', message: PushMessage, accessToken?: string): Promise<ProviderOutcome> => {
  if (provider !== 'local' && provider !== 'expo') return { outcome: 'failed', code: 'INVALID_CREDENTIALS' };
  if (new TextEncoder().encode(JSON.stringify(message)).length > 4096) return { outcome: 'failed', code: 'INVALID_PAYLOAD' };
  if ((provider === 'local' && !message.to.startsWith('LocalPushToken[')) ||
      (provider === 'expo' && !/^(ExpoPushToken|ExponentPushToken)\[/.test(message.to))) return { outcome: 'failed', code: 'INVALID_PAYLOAD' };
  try {
    const result = await call(provider, 'send', message, accessToken);
    return providerOutcome(result.status, (result.body as { data?: unknown } | null)?.data);
  } catch { return { outcome: 'uncertain', code: 'HANDOFF_UNKNOWN' }; }
};

export const fetchReceipt = async (provider: 'local' | 'expo', ticketId: string, accessToken?: string): Promise<ProviderOutcome> => {
  if (provider !== 'local' && provider !== 'expo') return { outcome: 'failed', code: 'INVALID_CREDENTIALS' };
  if (provider === 'local' && !ticketId.startsWith('local:')) return { outcome: 'failed', code: 'INVALID_PAYLOAD' };
  try {
    const result = await call(provider, 'getReceipts', { ids: [ticketId] }, accessToken);
    const receipt = (result.body as { data?: Record<string, unknown> } | null)?.data?.[ticketId];
    if (result.status === 200 && receipt === undefined) return { outcome: 'retry', code: 'RECEIPT_UNKNOWN' };
    const outcome = providerOutcome(result.status, receipt, true);
    return outcome.outcome === 'uncertain' ? { outcome: 'retry', code: outcome.code } : outcome;
  } catch { return { outcome: 'retry', code: 'PROVIDER_TEMPORARY' }; }
};
