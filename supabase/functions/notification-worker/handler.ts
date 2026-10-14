import { type ProviderOutcome, remainingLifetime } from '../../../apps/mobile/src/notifications/delivery-decisions.ts';
import { encryptProjection, fetchReceipt, sendPush } from './provider.ts';

export type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
type Job = { id: number; claim_id: string; generation: number };
type Prepared = {
  delivery_id: number; claim_id: string; generation: number; binding_id: string; encryption_key: string;
  token: string; provider: 'local' | 'expo'; expires_at: string; projection: unknown;
};
type ReceiptJob = { id: number; receipt_claim_id: string; ticket_id: string; provider: 'local' | 'expo' };
const json = (status: number, body: unknown): Response => Response.json(body, { status });

const equalSecret = (a: string, b: string): boolean => {
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index += 1) difference |= (a.charCodeAt(index) || 0) ^ b.charCodeAt(index);
  return difference === 0;
};

const processSend = async (rpc: Rpc, job: Job, accessToken?: string): Promise<string> => {
  const prepared = await rpc<Prepared | null>('notification_begin_send', {
    p_delivery_id: job.id, p_claim_id: job.claim_id, p_generation: job.generation,
  });
  if (!prepared) return 'cancelled_or_waiting';
  const ttl = remainingLifetime(prepared.expires_at, Date.now());
  let outcome: ProviderOutcome;
  try {
    if (ttl === 0) outcome = { outcome: 'failed', code: 'INVALID_PAYLOAD' };
    else {
      const data = await encryptProjection(prepared.encryption_key, prepared.binding_id, prepared.projection);
      outcome = await sendPush(prepared.provider, { to: prepared.token, title: 'BoGa',
        body: 'Open the app to view your notification', ttl, mutableContent: true, categoryId: 'boga-workout', data }, accessToken);
    }
  } catch { outcome = { outcome: 'failed', code: 'INVALID_PAYLOAD' }; }
  const saved = await rpc<boolean>('notification_send_result', { p_delivery_id: job.id,
    p_claim_id: job.claim_id, p_outcome: outcome.outcome, p_ticket_id: outcome.ticketId ?? null, p_code: outcome.code ?? null });
  return saved ? outcome.outcome : 'fenced';
};

const processReceipt = async (rpc: Rpc, job: ReceiptJob, accessToken?: string): Promise<string> => {
  const result = await fetchReceipt(job.provider, job.ticket_id, accessToken);
  const outcome = result.outcome === 'ticket' ? 'receipt_ok' : result.outcome;
  const saved = await rpc<boolean>('notification_receipt_result', {
    p_delivery_id: job.id, p_claim_id: job.receipt_claim_id, p_outcome: outcome, p_code: result.code ?? null,
  });
  return saved ? outcome : 'fenced';
};

export const handleNotificationRequest = async (request: Request, dependencies: {
  serviceKey: string; rpc: Rpc; accessToken?: string;
}): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!dependencies.serviceKey || !equalSecret(request.headers.get('apikey') ?? '', dependencies.serviceKey)) {
    return json(401, { error: 'UNAUTHORIZED' });
  }
  const outcomes: Record<string, number> = {};
  const record = (outcome: string) => { outcomes[outcome] = (outcomes[outcome] ?? 0) + 1; };
  try {
    const receipts = await dependencies.rpc<{ jobs: ReceiptJob[] }>('notification_receipt_claim', { p_limit: 20 });
    for (const job of receipts.jobs) {
      try { record(await processReceipt(dependencies.rpc, job, dependencies.accessToken)); }
      catch { record('receipt_save_failed'); }
    }
    const claimed = await dependencies.rpc<{ jobs: Job[]; disabled: boolean }>('notification_claim', { p_limit: 20 });
    for (const job of claimed.jobs) {
      try { record(await processSend(dependencies.rpc, job, dependencies.accessToken)); }
      catch { record('send_save_failed'); }
    }
    await dependencies.rpc('notification_prune');
    return json(200, { claimed: claimed.jobs.length, receipts: receipts.jobs.length, disabled: claimed.disabled, outcomes });
  } catch {
    // Provider/DB errors may contain tokens or private row data; retain only a fixed diagnostic.
    console.error('notification-worker: drain failed');
    return json(500, { error: 'INTERNAL' });
  }
};
