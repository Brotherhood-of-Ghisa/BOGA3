import { type ProviderOutcome, remainingLifetime } from '../../../apps/mobile/src/notifications/delivery-decisions.ts';
import { type WorkoutTarget, workoutContributions } from '../../../apps/mobile/src/notifications/workout-events.ts';
import { encryptProjection, fetchReceipt, sendPush } from './provider.ts';

export type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
type Job = { id: number; claim_id: string; generation: number };
type Prepared = {
  delivery_id: number; claim_id: string; generation: number; binding_id: string; encryption_key: string;
  token: string; provider: 'local' | 'expo'; expires_at: string; projection: unknown;
};
type ReceiptJob = { id: number; receipt_claim_id: string; ticket_id: string; provider: 'local' | 'expo' };
type WorkoutJob = { member_user_id: string; session_id: string; generation: number; targets: WorkoutTarget[] };
const json = (status: number, body: unknown): Response => Response.json(body, { status });

export const notificationServiceKeys = (legacyKey = '', secretKeysJson = '{}'): string[] => {
  try {
    const keys = JSON.parse(secretKeysJson) as { default?: unknown } | null;
    return [keys?.default, legacyKey].filter((key): key is string => typeof key === 'string' && key.length > 0);
  } catch { return []; }
};

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
  const lifetime = remainingLifetime(prepared.expires_at, Date.now());
  let outcome: ProviderOutcome;
  try {
    if (lifetime === 0) outcome = { outcome: 'failed', code: 'INVALID_PAYLOAD' };
    else {
      const data = await encryptProjection(prepared.encryption_key, prepared.binding_id, prepared.projection);
      outcome = await sendPush(prepared.provider, { to: prepared.token, title: 'BoGa',
        body: 'Open the app to view your notification', expiration: Math.floor(Date.parse(prepared.expires_at) / 1000), mutableContent: true, categoryId: 'boga-workout', data }, accessToken);
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
  serviceKeys: readonly string[]; rpc: Rpc; accessToken?: string;
}): Promise<Response> => {
  if (request.method !== 'POST' && request.method !== 'GET') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!dependencies.serviceKeys.some(key => key.length > 0 && equalSecret(request.headers.get('apikey') ?? '', key))) {
    return json(401, { error: 'UNAUTHORIZED' });
  }
  if (request.method === 'GET') return json(200, { ok: true });
  // The hourly pg_cron sweep marks its calls; transaction kicks send an empty body.
  const fromSweep = ((await request.json().catch(() => null)) as { source?: unknown } | null)?.source === 'sweep';
  const outcomes: Record<string, number> = {};
  const record = (outcome: string) => { outcomes[outcome] = (outcomes[outcome] ?? 0) + 1; };
  try {
    if (!await dependencies.rpc<boolean>('notification_work_pending')) {
      return json(200, { claimed: 0, receipts: 0, outcomes, idle: true });
    }
    let admitted = 0;
    try {
      const workouts = await dependencies.rpc<{ jobs: WorkoutJob[]; admitted?: number }>('notification_workout_prepare', { p_limit: 20 });
      admitted = workouts.admitted ?? 0;
      for (const workout of workouts.jobs) {
        try {
          const accepted = await dependencies.rpc<boolean>('notification_workout_enqueue', {
            p_member: workout.member_user_id, p_session: workout.session_id, p_generation: workout.generation,
            p_contributions: workoutContributions(workout.targets, workout.member_user_id),
          });
          record(accepted ? 'workout_ready' : 'workout_requeued');
        } catch { record('workout_save_failed'); }
      }
    } catch { record('workout_prepare_failed'); }
    let receiptCount = 0;
    let sendCount = 0;
    let disabled = false;
    // Fresh four-job claims start immediately; five bounded rounds cover twenty jobs per phase.
    for (let round = 0; round < 5; round += 1) {
      const receipts = await dependencies.rpc<{ jobs: ReceiptJob[] }>('notification_receipt_claim', { p_limit: 4 });
      receiptCount += receipts.jobs.length;
      if (receipts.jobs.length === 0) break;
      await Promise.all(receipts.jobs.map(async (job) => {
        try { record(await processReceipt(dependencies.rpc, job, dependencies.accessToken)); }
        catch { record('receipt_save_failed'); }
      }));
    }
    for (let round = 0; round < 5; round += 1) {
      const claimed = await dependencies.rpc<{ jobs: Job[]; disabled: boolean }>('notification_claim', { p_limit: 4 });
      sendCount += claimed.jobs.length;
      disabled = claimed.disabled;
      if (claimed.jobs.length === 0) break;
      await Promise.all(claimed.jobs.map(async (job) => {
        try { record(await processSend(dependencies.rpc, job, dependencies.accessToken)); }
        catch { record('send_save_failed'); }
      }));
    }
    const pruned = fromSweep && await dependencies.rpc<boolean>('notification_prune_due');
    await dependencies.rpc('notification_prune');
    // A sweep-started run that did anything records how much; its work stands
    // even if the record fails.
    const total = Object.values(outcomes).reduce((sum, n) => sum + n, 0);
    if (fromSweep && (admitted + receiptCount + sendCount + total > 0 || pruned)) {
      await dependencies.rpc('sweep_record_work', { p_event: 'notification.sweep_work', p_work: {
        admitted, receipts: receiptCount, sends: sendCount, pruned, outcomes,
      } }).catch(() => console.error('notification-worker: sweep work record failed'));
    }
    return json(200, { claimed: sendCount, receipts: receiptCount, disabled, outcomes });
  } catch {
    // Provider/DB errors may contain tokens or private row data; retain only a fixed diagnostic.
    console.error('notification-worker: drain failed');
    return json(500, { error: 'INTERNAL' });
  }
};
