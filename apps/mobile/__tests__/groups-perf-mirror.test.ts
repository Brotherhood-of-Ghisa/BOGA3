/** @jest-environment node */
// The harness runs the group-eval drain through its own mirror
// (scripts/perf/groups/group-eval-mirror.ts) because the Edge module serves on
// import. These tests fail when the two drift apart, and pin the mirror's
// own sequence, outcomes and failure recording.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CLAIM_LIMIT,
  MAX_CLAIM_ROUNDS,
  RULES_REQUEUE_LIMIT,
  runGroupEval,
  type Rpc,
  type RpcFailure,
} from '../scripts/perf/groups/group-eval-mirror';
import { GROUP_EVAL_RULES_VERSION } from '../src/groups/set-facts';

const edgeSource = readFileSync(path.join(__dirname, '../../../supabase/functions/group-eval/index.ts'), 'utf8');
const mirrorSource = readFileSync(path.join(__dirname, '../scripts/perf/groups/group-eval-mirror.ts'), 'utf8');

const names = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map((match) => match[1]);

test('the mirror calls the Edge drain RPCs in the same source order', () => {
  // Authorization and the sweep's work record are not drain work.
  const edge = names(edgeSource, /db,\s*'([a-z_]+)'/g)
    .filter((name) => name !== 'group_eval_check_secret' && name !== 'sweep_record_work');
  const mirror = names(mirrorSource, /rpc(?:<[^(]*>)?\(\s*'([a-z_]+)'/g);
  expect(edge.length).toBeGreaterThan(5);
  expect(mirror).toEqual(edge);
});

test.each([
  ['CLAIM_LIMIT', CLAIM_LIMIT],
  ['MAX_CLAIM_ROUNDS', MAX_CLAIM_ROUNDS],
  ['RULES_REQUEUE_LIMIT', RULES_REQUEUE_LIMIT],
])('the mirror uses the Edge drain %s', (name, value) => {
  expect(edgeSource).toContain(`const ${name} = ${value};`);
});

type Call = { name: string; args: Record<string, unknown> };

const fakeRpc = (responses: Record<string, unknown[]>, calls: Call[]): Rpc => (async (name: string, args: Record<string, unknown>) => {
  calls.push({ name, args });
  const queue = responses[name];
  const next = queue && queue.length > 0 ? queue.shift() : undefined;
  if (next instanceof Error) throw next;
  return (next ?? { jobs: [] }) as never;
}) as Rpc;

const sessionRows = { session_id: 's1', started_at_ms: null, sets: [] };

test('one drain runs session jobs, then comparison jobs, and counts what each evaluation scored', async () => {
  const calls: Call[] = [];
  const graph = { sets: [{}, {}, {}], members: [], rules: {} };
  const rpc = fakeRpc({
    group_eval_claim: [{ jobs: [{ job_id: 1, kind: 'session', member_user_id: 'u1', session_id: 's1', generation: 3 }] }],
    group_eval_session_rows: [sessionRows],
    group_eval_complete: [{ completed: true }],
    group_metric_eval_claim: [{ jobs: [{ job_id: 9, generation: 2, claim_id: 'c' }] }],
    group_metric_eval_prepare: [{ prepared: true, frozen: true, graph }],
    group_metric_eval_publish: [{ completed: false }],
  }, calls);

  const summary = await runGroupEval(rpc);

  expect(calls.map((call) => call.name)).toEqual([
    'group_eval_requeue_rules', 'group_eval_claim', 'group_eval_session_rows', 'group_eval_complete', 'group_eval_claim',
    'group_metric_eval_claim', 'group_metric_eval_prepare', 'group_metric_eval_publish', 'group_metric_eval_claim',
  ]);
  expect(calls[3].args).toEqual({ p_job_id: 1, p_generation: 3, p_facts: [] });
  expect(calls[0].args).toEqual({ p_rules_version: GROUP_EVAL_RULES_VERSION, p_limit: RULES_REQUEUE_LIMIT });
  expect(calls[7].args).toEqual({ p_job_id: 9, p_generation: 2, p_claim_id: 'c', p_evaluation: null });
  expect(summary).toMatchObject({ claimed: 2, metricClaimed: 1, completed: 1, requeued: 1, failed: 0, metricRequeued: 1, setsScored: 3 });
  expect(summary.graphBytes).toBe(Buffer.byteLength(JSON.stringify(graph)));
});

test('a failed job is recorded with its SQLSTATE, or EVALX when it has none', async () => {
  const calls: Call[] = [];
  const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { sqlstate: '57014' }) as RpcFailure;
  const rpc = fakeRpc({
    group_eval_claim: [{ jobs: [{ job_id: 1, kind: 'target', member_user_id: 'u1', session_id: null, generation: 1 }] }],
    group_eval_complete: [new Error('no sqlstate')],
    group_metric_eval_claim: [{ jobs: [{ job_id: 9, generation: 2, claim_id: 'c' }] }],
    group_metric_eval_prepare: [timeout],
  }, calls);

  const summary = await runGroupEval(rpc);

  expect(calls.find((call) => call.name === 'group_eval_fail')?.args).toEqual({ p_job_id: 1, p_sqlstate: 'EVALX' });
  expect(calls.find((call) => call.name === 'group_metric_eval_fail')?.args)
    .toEqual({ p_job_id: 9, p_generation: 2, p_claim_id: 'c', p_sqlstate: '57014' });
  expect(summary).toMatchObject({ failed: 2, metricFailed: 1, metricRequeued: 0 });
  expect(summary.failures).toEqual([
    'group_eval job 1: no sqlstate',
    'metric job 9: canceling statement due to statement timeout',
  ]);
});

test('an unprepared comparison is requeued without publishing; a missing graph fails it', async () => {
  const calls: Call[] = [];
  const rpc = fakeRpc({
    group_metric_eval_claim: [{ jobs: [{ job_id: 1, generation: 1, claim_id: 'a' }, { job_id: 2, generation: 1, claim_id: 'b' }] }],
    group_metric_eval_prepare: [{ prepared: false }, { prepared: true, frozen: false }],
  }, calls);

  const summary = await runGroupEval(rpc);

  expect(calls.some((call) => call.name === 'group_metric_eval_publish')).toBe(false);
  expect(summary).toMatchObject({ requeued: 1, failed: 1 });
  expect(summary.failures).toEqual(['metric job 2: Missing comparison source graph']);
});

test('a drain stops after its claim-round limit', async () => {
  const calls: Call[] = [];
  const rpc = (async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'group_eval_claim') return { jobs: [{ job_id: 1, kind: 'target', member_user_id: 'u', session_id: null, generation: 1 }] };
    if (name === 'group_eval_complete') return { completed: true };
    return { jobs: [] };
  }) as Rpc;

  const summary = await runGroupEval(rpc);

  expect(calls.filter((call) => call.name === 'group_eval_claim')).toHaveLength(MAX_CLAIM_ROUNDS);
  expect(summary.claimed).toBe(MAX_CLAIM_ROUNDS);
});

test('a failure that cannot be recorded is reported and the drain goes on, as the Edge drain logs it', async () => {
  const calls: Call[] = [];
  const rpc = fakeRpc({
    group_eval_claim: [{ jobs: [{ job_id: 1, kind: 'target', member_user_id: 'u1', session_id: null, generation: 1 }] }],
    group_eval_complete: [new Error('boom')],
    group_eval_fail: [new Error('fenced')],
    group_metric_eval_claim: [{ jobs: [{ job_id: 9, generation: 2, claim_id: 'c' }] }],
    group_metric_eval_prepare: [new Error('late')],
    group_metric_eval_fail: [new Error('gone')],
  }, calls);

  const summary = await runGroupEval(rpc);

  expect(summary.failures).toEqual([
    'group_eval job 1: boom', 'group_eval_fail job 1: fenced', 'metric job 9: late', 'group_metric_eval_fail job 9: gone',
  ]);
  expect(calls.filter((call) => call.name === 'group_metric_eval_claim')).toHaveLength(2);
});
