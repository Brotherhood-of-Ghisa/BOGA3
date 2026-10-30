// The group-eval drain (supabase/functions/group-eval/index.ts) over an
// injected RPC, so the harness can run the worker's exact RPC sequence inside
// one rolled-back transaction with the app's own TS set rules and scoring.
// That Edge module calls Deno.serve on import, so it cannot be loaded here;
// __tests__/groups-perf-mirror.test.ts fails when the two RPC sequences
// or the claim limits drift apart.

import {
  GROUP_EVAL_RULES_VERSION,
  normalizeGroupSetFacts,
  type GroupEvalSessionRows,
  type GroupSetFact,
} from '../../../src/groups/set-facts.ts';
import {
  evaluateCompetitionGraph,
  type CompetitionEvaluationGraph,
} from '../../../src/groups/competition-evaluation.ts';
import { evaluateCoWGraph, type CoWEvaluationGraph } from '../../../src/groups/cow-evaluation.ts';

export const CLAIM_LIMIT = 20;
export const MAX_CLAIM_ROUNDS = 10;
export const RULES_REQUEUE_LIMIT = 50;

export type Rpc = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

type Job = { job_id: number; kind: 'session' | 'target'; member_user_id: string; session_id: string | null; generation: number };
type MetricJob = { job_id: number; generation: number; claim_id: string };
type CoWJob = { cow_id: string; generation: number; claim_id: string };

export type DrainSummary = {
  claimed: number;
  metricClaimed: number;
  completed: number;
  requeued: number;
  failed: number;
  /** Comparison publications that wrote nothing: requeued (stale claim or graph) or failed. */
  metricRequeued: number;
  metricFailed: number;
  /** Bytes of every source graph `group_metric_eval_prepare` returned. */
  graphBytes: number;
  /** Sets in those graphs: every set each evaluation scored. */
  setsScored: number;
  failures: string[];
};

const emptySummary = (): DrainSummary => ({
  claimed: 0, metricClaimed: 0, completed: 0, requeued: 0, failed: 0, metricRequeued: 0, metricFailed: 0,
  graphBytes: 0, setsScored: 0, failures: [],
});

/** The DB error class of a failed RPC, for `group_eval_fail`; the Edge function records the same. */
export type RpcFailure = Error & { sqlstate?: string };
const sqlstateOf = (error: unknown): string => {
  const code = (error as RpcFailure | undefined)?.sqlstate;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'EVALX';
};

const processJob = async (rpc: Rpc, job: Job, summary: DrainSummary): Promise<void> => {
  try {
    let facts: GroupSetFact[] | null = null;
    if (job.kind === 'session') {
      const rows = await rpc<GroupEvalSessionRows>('group_eval_session_rows', {
        p_member_user_id: job.member_user_id,
        p_session_id: job.session_id,
      });
      facts = normalizeGroupSetFacts(rows);
    }
    const done = await rpc<{ completed: boolean }>('group_eval_complete', {
      p_job_id: job.job_id, p_generation: job.generation, p_facts: facts,
    });
    if (done.completed) summary.completed += 1;
    else summary.requeued += 1;
  } catch (error) {
    summary.failed += 1;
    summary.failures.push(`group_eval job ${job.job_id}: ${(error as Error).message}`);
    try {
      await rpc('group_eval_fail', { p_job_id: job.job_id, p_sqlstate: sqlstateOf(error) });
    } catch (failError) {
      // As the Edge drain does: the lease expires and a later drain retries.
      summary.failures.push(`group_eval_fail job ${job.job_id}: ${(failError as Error).message}`);
    }
  }
};

const processMetricJob = async (rpc: Rpc, job: MetricJob, summary: DrainSummary): Promise<void> => {
  const claim = { p_job_id: job.job_id, p_generation: job.generation, p_claim_id: job.claim_id };
  try {
    const prepared = await rpc<{ prepared: boolean; frozen?: boolean; graph?: CompetitionEvaluationGraph }>(
      'group_metric_eval_prepare', claim);
    if (!prepared.prepared) {
      summary.requeued += 1;
      summary.metricRequeued += 1;
      return;
    }
    if (!prepared.frozen && !prepared.graph) throw new Error('Missing comparison source graph');
    if (prepared.graph) {
      summary.graphBytes += Buffer.byteLength(JSON.stringify(prepared.graph));
      summary.setsScored += prepared.graph.sets.length;
    }
    const evaluation = prepared.frozen ? null : evaluateCompetitionGraph(prepared.graph!);
    const done = await rpc<{ completed: boolean }>('group_metric_eval_publish', { ...claim, p_evaluation: evaluation });
    if (done.completed) {
      summary.completed += 1;
    } else {
      summary.requeued += 1;
      summary.metricRequeued += 1;
    }
  } catch (error) {
    summary.failed += 1;
    summary.metricFailed += 1;
    summary.failures.push(`metric job ${job.job_id}: ${(error as Error).message}`);
    try {
      await rpc('group_metric_eval_fail', { ...claim, p_sqlstate: sqlstateOf(error) });
    } catch (failError) {
      summary.failures.push(`group_metric_eval_fail job ${job.job_id}: ${(failError as Error).message}`);
    }
  }
};

const processCoWJob = async (rpc: Rpc, job: CoWJob, summary: DrainSummary): Promise<void> => {
  const claim = { p_cow_id: job.cow_id, p_generation: job.generation, p_claim_id: job.claim_id };
  try {
    const prepared = await rpc<{ prepared: boolean; graph?: CoWEvaluationGraph }>('group_cow_eval_prepare', claim);
    if (!prepared.prepared) { summary.requeued += 1; return; }
    if (!prepared.graph) throw new Error('Missing CoW source graph');
    summary.graphBytes += Buffer.byteLength(JSON.stringify(prepared.graph));
    summary.setsScored += prepared.graph.sources.length;
    const done = await rpc<{ completed: boolean }>('group_cow_eval_publish', { ...claim,
      p_before_us: prepared.graph.window.readBeforeUs, p_source_token: prepared.graph.sourceToken,
      p_result: evaluateCoWGraph(prepared.graph) });
    if (done.completed) summary.completed += 1;
    else summary.requeued += 1;
  } catch (error) {
    summary.failed += 1;
    summary.failures.push(`CoW ${job.cow_id}: ${(error as Error).message}`);
    try { await rpc('group_cow_eval_fail', { ...claim, p_sqlstate: sqlstateOf(error) }); }
    catch (failError) { summary.failures.push(`group_cow_eval_fail ${job.cow_id}: ${(failError as Error).message}`); }
  }
};

/** One group-eval invocation: rules requeue, session/target jobs, then comparison jobs. */
export const runGroupEval = async (rpc: Rpc): Promise<DrainSummary> => {
  const summary = emptySummary();
  await rpc<number>('group_eval_requeue_rules', { p_rules_version: GROUP_EVAL_RULES_VERSION, p_limit: RULES_REQUEUE_LIMIT });
  for (let round = 0; round < MAX_CLAIM_ROUNDS; round += 1) {
    const { jobs } = await rpc<{ jobs: Job[] }>('group_eval_claim', { p_limit: CLAIM_LIMIT });
    if (jobs.length === 0) break;
    summary.claimed += jobs.length;
    for (const job of jobs) await processJob(rpc, job, summary);
  }
  for (let round = 0; round < MAX_CLAIM_ROUNDS; round += 1) {
    const { jobs } = await rpc<{ jobs: MetricJob[] }>('group_metric_eval_claim', { p_limit: CLAIM_LIMIT });
    if (jobs.length === 0) break;
    summary.metricClaimed += jobs.length;
    summary.claimed += jobs.length;
    for (const job of jobs) await processMetricJob(rpc, job, summary);
  }
  for (let round = 0; round < MAX_CLAIM_ROUNDS; round += 1) {
    const { jobs } = await rpc<{ jobs: CoWJob[] }>('group_cow_eval_claim', { p_limit: CLAIM_LIMIT });
    if (jobs.length === 0) break;
    summary.claimed += jobs.length;
    for (const job of jobs) await processCoWJob(rpc, job, summary);
  }
  return summary;
};
