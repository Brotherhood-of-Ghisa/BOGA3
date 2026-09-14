// group-eval — the M25 group evaluator (docs/specs/tech/groups-contract.md §2.10).
//
// Drains app_public.group_eval_queue. The pg_net kick (one per enqueuing
// transaction) and the pg_cron sweep POST here with the Vault-held
// `x-group-eval-secret`; the groups-leaderboards lane calls it directly. Each
// session job's raw set rows are normalized with the app's own TS set rules
// (apps/mobile/src/groups/set-facts.ts, loaded by relative path) into
// group_set_facts; target resolution, the apply seam, and all writes are SQL.
//
// A service-role boundary with no client-facing API: `verify_jwt = false`
// because the caller is Postgres, authenticated by the shared secret.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.98.0';

import {
  GROUP_EVAL_RULES_VERSION,
  normalizeGroupSetFacts,
  type GroupEvalSessionRows,
  type GroupSetFact,
} from '../../../apps/mobile/src/groups/set-facts.ts';

const CLAIM_LIMIT = 20;
const MAX_CLAIM_ROUNDS = 10;
const RULES_REQUEUE_LIMIT = 50;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
// Recorded as the job's sqlstate when the failure is not a database error.
const NON_DB_ERROR = 'EVALX';

type Job = {
  job_id: number;
  kind: 'session' | 'target';
  member_user_id: string;
  session_id: string | null;
  group_id: string | null;
  group_exercise_id: string | null;
  causes: string[];
  generation: number;
};

type Target = { group_id: string; group_exercise_id: string };

type JobResult = {
  job_id: number;
  kind: Job['kind'];
  member_user_id: string;
  session_id: string | null;
  group_id: string | null;
  group_exercise_id: string | null;
  causes: string[];
  outcome: 'completed' | 'requeued' | 'failed';
  sqlstate: string | null;
  targets: Target[];
};

class RpcError extends Error {
  constructor(readonly sqlstate: string) {
    super(`group-eval rpc failed: ${sqlstate}`);
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const requiredEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required Edge Function environment variable: ${name}`);
  }
  return value;
};

const rpc = async <T>(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.schema('app_public').rpc(name, args);
  if (error) {
    throw new RpcError(error.code && SQLSTATE_PATTERN.test(error.code) ? error.code : NON_DB_ERROR);
  }
  return data as T;
};

const processJob = async (db: SupabaseClient, job: Job): Promise<JobResult> => {
  const base = {
    job_id: job.job_id,
    kind: job.kind,
    member_user_id: job.member_user_id,
    session_id: job.session_id,
    group_id: job.group_id,
    group_exercise_id: job.group_exercise_id,
    causes: job.causes,
  };
  try {
    let facts: GroupSetFact[] | null = null;
    if (job.kind === 'session') {
      const rows = await rpc<GroupEvalSessionRows>(db, 'group_eval_session_rows', {
        p_member_user_id: job.member_user_id,
        p_session_id: job.session_id,
      });
      facts = normalizeGroupSetFacts(rows);
    }
    const done = await rpc<{ completed: boolean; targets: Target[] }>(db, 'group_eval_complete', {
      p_job_id: job.job_id,
      p_generation: job.generation,
      p_facts: facts,
    });
    return { ...base, outcome: done.completed ? 'completed' : 'requeued', sqlstate: null, targets: done.targets };
  } catch (error) {
    const sqlstate = error instanceof RpcError ? error.sqlstate : NON_DB_ERROR;
    try {
      await rpc(db, 'group_eval_fail', { p_job_id: job.job_id, p_sqlstate: sqlstate });
    } catch (failError) {
      // The lease expires and the sweep retries the job; say so loudly.
      console.error(`group-eval: could not record failure of job ${job.job_id}`, failError);
    }
    return { ...base, outcome: 'failed', sqlstate, targets: [] };
  }
};

export const handleRequest = async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json(405, { error: 'METHOD_NOT_ALLOWED' });
  }

  const db = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  try {
    const authorized = await rpc<boolean>(db, 'group_eval_check_secret', {
      p_secret: request.headers.get('x-group-eval-secret') ?? '',
    });
    if (authorized !== true) {
      return json(401, { error: 'UNAUTHORIZED' });
    }

    const rulesRequeued = await rpc<number>(db, 'group_eval_requeue_rules', {
      p_rules_version: GROUP_EVAL_RULES_VERSION,
      p_limit: RULES_REQUEUE_LIMIT,
    });

    const jobs: JobResult[] = [];
    for (let round = 0; round < MAX_CLAIM_ROUNDS; round += 1) {
      const { jobs: claimed } = await rpc<{ jobs: Job[] }>(db, 'group_eval_claim', { p_limit: CLAIM_LIMIT });
      if (claimed.length === 0) {
        break;
      }
      for (const job of claimed) {
        jobs.push(await processJob(db, job));
      }
    }

    const count = (outcome: JobResult['outcome']) => jobs.filter((job) => job.outcome === outcome).length;
    return json(200, {
      rules_version: GROUP_EVAL_RULES_VERSION,
      rules_requeued: rulesRequeued,
      claimed: jobs.length,
      completed: count('completed'),
      requeued: count('requeued'),
      failed: count('failed'),
      jobs,
    });
  } catch (error) {
    const sqlstate = error instanceof RpcError ? error.sqlstate : NON_DB_ERROR;
    console.error('group-eval: drain failed', sqlstate);
    return json(500, { error: 'INTERNAL', sqlstate });
  }
};

Deno.serve(handleRequest);
