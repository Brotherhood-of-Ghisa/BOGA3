// Tier 1: deterministic SQL-level counters per scenario, inside one
// transaction that is rolled back. The fixture is drained to steady state by
// the real worker sequence, then each step is measured: the sync_push or
// cron command that starts it, plus every Edge run its pg_net kicks would
// start (group-eval, notification-worker) and every kick those cause.

import { Client } from 'pg';

import { handleNotificationRequest } from '../../../../../supabase/functions/notification-worker/handler.ts';
import { sumCounters, type Counters } from './counters.ts';
import { definitionId, fixtureStatements, FIXTURE_COUNTS_SQL, type FixtureSpec } from './fixture.ts';
import { runGroupEval, type DrainSummary, type Rpc, type RpcFailure } from './group-eval-mirror.ts';
import { Tier1Session, type CallRecord, type Caller } from './session.ts';

export const GROUP_EVAL_KICK_URL = 'http://kong:8000/functions/v1/group-eval';
export const NOTIFICATION_WORKER_URL = 'http://kong:8000/functions/v1/notification-worker';
const NOTIFICATION_KEY = 'groups-perf-worker-key';
/** A step's kicks are drained until none are left; more than this is a runaway loop, reported, not hidden. */
const MAX_CASCADE_RUNS = 25;
const MAX_STEADY_STATE_RUNS = 2000;

export type StepResult = {
  label: string;
  total: Counters;
  calls: CallRecord[];
  edgeRuns: { groupEval: number; notificationWorker: number };
  groupEval: Omit<DrainSummary, 'failures'>;
  /** Comparison publications attempted (prepare → publish), and those that wrote nothing. */
  evaluations: number;
  rejectedPublishes: number;
  notificationOutcomes: Record<string, number>;
  failures: string[];
  cascadeCapped: boolean;
};

export type Tier1Scenario = {
  name: string;
  members: number;
  historyDays: number;
  fixture: { members: number; sessions: number; sets: number };
  steadyState: { groupEvalRuns: number; leftoverJobs: number; failures: string[] };
  steps: Record<string, StepResult>;
  incomplete: string | null;
  setupMs: number;
};

type NewKick = { id: number; url: string };

const mergeSummary = (into: Omit<DrainSummary, 'failures'>, from: DrainSummary): void => {
  into.claimed += from.claimed;
  into.metricClaimed += from.metricClaimed;
  into.completed += from.completed;
  into.requeued += from.requeued;
  into.failed += from.failed;
  into.graphBytes += from.graphBytes;
  into.setsScored += from.setsScored;
};

class Tier1Run {
  private lastKickId = 0;

  constructor(private readonly session: Tier1Session) {}

  rpc(caller: Caller, measured: boolean): Rpc {
    return <T>(name: string, args: Record<string, unknown> = {}) => this.session.call<T>(caller, name, args, measured);
  }

  async markKicks(): Promise<void> {
    const [row] = await this.session.exec<{ id: string | null }>('select max(id) as id from net.http_request_queue');
    this.lastKickId = Number(row.id ?? 0);
  }

  private async newKicks(): Promise<NewKick[]> {
    const rows = await this.session.exec<{ id: string; url: string }>(
      'select id, url from net.http_request_queue where id > $1 order by id', [this.lastKickId]);
    if (rows.length > 0) this.lastKickId = Number(rows[rows.length - 1].id);
    return rows.map((row) => ({ id: Number(row.id), url: row.url }));
  }

  /** Run `start`, then one Edge invocation per pg_net kick, in order, until no kick is left. */
  async step(label: string, measured: boolean, start: () => Promise<unknown>): Promise<StepResult> {
    this.session.take();
    const result: StepResult = {
      label, total: sumCounters([]), calls: [], edgeRuns: { groupEval: 0, notificationWorker: 0 },
      groupEval: { claimed: 0, metricClaimed: 0, completed: 0, requeued: 0, failed: 0, graphBytes: 0, setsScored: 0 },
      evaluations: 0, rejectedPublishes: 0, notificationOutcomes: {}, failures: [], cascadeCapped: false,
    };
    await start();
    const service = this.rpc({ role: 'service_role' }, measured);
    for (let runs = 0; ; runs += 1) {
      const kicks = await this.newKicks();
      if (kicks.length === 0) break;
      if (runs >= MAX_CASCADE_RUNS) {
        result.cascadeCapped = true;
        break;
      }
      for (const kick of kicks) {
        if (kick.url === GROUP_EVAL_KICK_URL) {
          result.edgeRuns.groupEval += 1;
          const summary = await runGroupEval(service);
          mergeSummary(result.groupEval, summary);
          result.failures.push(...summary.failures);
        } else if (kick.url === NOTIFICATION_WORKER_URL) {
          result.edgeRuns.notificationWorker += 1;
          const response = await handleNotificationRequest(
            new Request(NOTIFICATION_WORKER_URL, { method: 'POST', headers: { apikey: NOTIFICATION_KEY } }),
            { serviceKeys: [NOTIFICATION_KEY], rpc: service as never });
          const body = (await response.json()) as { outcomes?: Record<string, number> };
          for (const [outcome, count] of Object.entries(body.outcomes ?? {})) {
            result.notificationOutcomes[outcome] = (result.notificationOutcomes[outcome] ?? 0) + count;
          }
        } else {
          result.failures.push(`unexpected kick url ${kick.url}`);
        }
      }
    }
    const records: CallRecord[] = this.session.take();
    result.calls = records;
    result.total = sumCounters(records.map((record) => record.counters));
    result.evaluations = records.filter((record) => record.fn === 'group_metric_eval_publish').length;
    result.rejectedPublishes = result.groupEval.requeued + result.groupEval.failed;
    return result;
  }
}

/** sync_push envelopes in the wire shape the app sends (supabase/tests/lib/groups-fixtures.sh). */
export const pushEntities = {
  session: (id: string, startedAt: number, clock: number) => ({
    type: 'sessions', id, client_updated_at_ms: clock,
    fields: { gym_id: null, status: 'active', started_at: startedAt, completed_at: null, duration_sec: null,
      created_at: startedAt, updated_at: clock, deleted_at: null },
  }),
  block: (id: string, sessionId: string, ex: number, order: number, name: string, clock: number) => ({
    type: 'session_exercises', id, client_updated_at_ms: clock,
    fields: { session_id: sessionId, exercise_definition_id: definitionId(ex), order_index: order, name,
      machine_name: null, created_at: clock, updated_at: clock, deleted_at: null },
  }),
  set: (id: string, blockId: string, order: number, weight: string, reps: string, clock: number) => ({
    type: 'exercise_sets', id, client_updated_at_ms: clock,
    fields: { session_exercise_id: blockId, order_index: order, weight_value: weight, reps_value: reps,
      set_type: order === 0 ? 'warm_up' : 'rir_2', planned_weight_value: null, planned_reps_value: null,
      planned_set_type: null, performance_status: null, created_at: clock, updated_at: clock, deleted_at: null },
  }),
};

const steadyState = async (run: Tier1Run, session: Tier1Session): Promise<Tier1Scenario['steadyState']> => {
  const failures: string[] = [];
  let groupEvalRuns = 0;
  // After one publication outruns the statement timeout the scenario is
  // unreachable; later comparisons fail at once instead of each waiting it out.
  const inner = run.rpc({ role: 'service_role' }, false);
  let timedOut = false;
  const service: Rpc = async <T>(name: string, args: Record<string, unknown>) => {
    if (timedOut && (name === 'group_metric_eval_prepare' || name === 'group_metric_eval_publish')) {
      throw Object.assign(new Error('skipped: an earlier call exceeded the statement timeout'), { sqlstate: '57014' });
    }
    try {
      return await inner<T>(name, args);
    } catch (error) {
      if ((error as RpcFailure).sqlstate === '57014') timedOut = true;
      throw error;
    }
  };
  for (; groupEvalRuns < MAX_STEADY_STATE_RUNS; groupEvalRuns += 1) {
    const summary = await runGroupEval(service);
    failures.push(...summary.failures);
    if (summary.claimed === 0) break;
  }
  await handleNotificationRequest(
    new Request(NOTIFICATION_WORKER_URL, { method: 'POST', headers: { apikey: NOTIFICATION_KEY } }),
    { serviceKeys: [NOTIFICATION_KEY], rpc: service as never });
  const [left] = await session.exec<{ n: number }>(
    `select ((select count(*) from app_public.group_eval_queue) + (select count(*) from app_public.group_metric_eval_queue))::int as n`);
  return { groupEvalRuns, leftoverJobs: left.n, failures };
};

export type Tier1Options = {
  dbUrl: string;
  adminDbUrl: string;
  /** Every statement's ceiling; hosted ran a 2-minute statement timeout. */
  statementTimeoutMs: number;
  log: (line: string) => void;
};

const vacuum = async (adminDbUrl: string): Promise<void> => {
  // The warning in group-metric-publish-benchmark.sql: rolled-back runs leave
  // dead rows and stale statistics behind, so each scenario starts clean.
  const admin = new Client({ connectionString: adminDbUrl });
  await admin.connect();
  try {
    await admin.query("set statement_timeout = '600s'");
    await admin.query('vacuum (analyze)');
  } finally {
    await admin.end();
  }
};

/** Why a scenario has no numbers, or null: a failed steady state, or a measured call that failed. */
export const scenarioIncomplete = (steady: Tier1Scenario['steadyState'], steps: Record<string, StepResult>): string | null => {
  const timeout = (failures: string[]) => failures.some((failure) => failure.includes('statement timeout'));
  if (steady.failures.length > 0 || steady.leftoverJobs > 0) {
    return timeout(steady.failures) ? 'steady state unreachable: a publication exceeded the statement timeout'
      : `steady state unreachable: ${steady.failures.length} failed jobs, ${steady.leftoverJobs} left`;
  }
  const failed = Object.values(steps).flatMap((step) => step.calls.filter((call) => call.error).map((call) => `${step.label}:${call.fn}:${call.error}`));
  if (failed.length > 0) return `failed calls: ${failed.join(', ')}`;
  const capped = Object.values(steps).filter((step) => step.cascadeCapped).map((step) => step.label);
  return capped.length > 0 ? `kick cascade did not settle: ${capped.join(', ')}` : null;
};

export const runTier1Scenario = async (
  name: string, spec: FixtureSpec, options: Tier1Options,
): Promise<Tier1Scenario> => {
  const startedAt = Date.now();
  await vacuum(options.adminDbUrl);
  const client = new Client({ connectionString: options.dbUrl });
  await client.connect();
  const session = new Tier1Session(client, options.statementTimeoutMs);
  try {
    await session.begin();
    // Hosted configuration, inside the rolled-back transaction: both kick
    // URLs set, and a notification cutover a week old so recent sessions are
    // post-cutover workouts. No kick is ever sent: pg_net sends after commit.
    await session.exec(`select app_public.group_eval_set_url($1)`, [GROUP_EVAL_KICK_URL]);
    await session.exec(`select vault.create_secret($1,'notification_worker_url'), vault.create_secret($2,'notification_worker_key')`,
      [NOTIFICATION_WORKER_URL, NOTIFICATION_KEY]);
    await session.exec(`update app_public.notification_workout_epoch set started_at = now() - interval '7 days'`);
    for (const statement of fixtureStatements(spec)) await session.exec(statement);
    const [counts] = await session.exec<Tier1Scenario['fixture']>(FIXTURE_COUNTS_SQL);
    const run = new Tier1Run(session);
    const steady = await steadyState(run, session);
    options.log(`[${name}] steady state after ${Math.round((Date.now() - startedAt) / 1000)} s: ${counts.sets} sets, `
      + `${steady.groupEvalRuns} group-eval runs, ${steady.leftoverJobs} jobs left, ${steady.failures.length} failures`);
    const base = { name, members: spec.members, historyDays: spec.historyDays, fixture: counts, steadyState: steady };
    if (scenarioIncomplete(steady, {}) !== null) {
      return { ...base, steps: {}, incomplete: scenarioIncomplete(steady, {}), setupMs: Date.now() - startedAt };
    }
    const tables = await session.exec<{ t: string }>(
      `select quote_ident(schemaname)||'.'||quote_ident(tablename) as t from pg_tables where schemaname in ('app_public','public')`);
    await session.exec(`analyze ${tables.map((row) => row.t).join(', ')}`);
    await run.markKicks();

    const steps: Record<string, StepResult> = {};
    const record = async (label: string, start: () => Promise<unknown>, measured = true) => {
      const result = await run.step(label, measured, start);
      if (measured) steps[label] = result;
    };
    const cron = run.rpc({ role: 'postgres' }, true);
    await record('idle_group_eval_sweep', () => cron('group_eval_sweep', {}));
    await record('idle_notification_sweep', () => cron('notification_sweep', {}));

    const [member] = await session.exec<{ uid: string; now_ms: string }>(
      'select m.uid, f.now_ms from perf_members m, perf_fx f where m.idx = 1');
    const lifter = run.rpc({ role: 'authenticated', userId: member.uid }, true);
    const quiet = run.rpc({ role: 'authenticated', userId: member.uid }, false);
    let clock = Number(member.now_ms);
    const push = (rpc: Rpc, entities: unknown[]) => rpc('sync_push', { entities });
    // A workout ten minutes old: its session and first (warm-up) set, then a
    // working set on the same linked exercise, then a set on an unlinked one.
    await record('workout_start', () => push(lifter, [
      pushEntities.session('perf-live', clock - 600000, (clock += 1)),
      pushEntities.block('perf-live-b0', 'perf-live', 0, 0, 'Bench press', (clock += 1)),
      pushEntities.set('perf-live-b0-x0', 'perf-live-b0', 0, '50', '8', (clock += 1)),
    ]));
    await record('logged_set', () => push(lifter, [pushEntities.set('perf-live-b0-x1', 'perf-live-b0', 1, '82.5', '5', (clock += 1))]));
    await record('unlinked_block', () => push(quiet, [pushEntities.block('perf-live-b1', 'perf-live', 6, 1, 'Biceps curl', (clock += 1))]), false);
    await record('logged_set_unlinked', () => push(lifter, [
      pushEntities.set('perf-live-b1-x1', 'perf-live-b1', 1, '15', '10', (clock += 1)),
    ]));
    return { ...base, steps, incomplete: scenarioIncomplete(steady, steps), setupMs: Date.now() - startedAt };
  } finally {
    await session.rollback().catch(() => undefined);
    await client.end();
  }
};
