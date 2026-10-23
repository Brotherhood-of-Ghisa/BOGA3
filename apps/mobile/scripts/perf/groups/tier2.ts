// Tier 2: the load run on the slot's real stack. A committed fixture is
// drained to steady state by the real group-eval Edge function; then C
// loggers each push a set about every 90 s through the real sync_push RPC,
// so the real pg_net kick → group-eval → publish → notification-worker path
// runs. Last, both pg_cron sweeps run on a 10-second schedule for a few ticks
// to measure idle cost with cron's own bookkeeping. Counters come from
// pg_stat_statements (top-level statements, the harness's own tagged and
// excluded), pg_stat_user_tables, the WAL position (also sampled per idle
// tick) and pg_stat_activity samples. Everything the run changes is restored and its data deleted.

import crypto from 'node:crypto';

import { Client } from 'pg';

import { cronMinutes, runsPerHour } from './cron.ts';
import { fixtureStatements, type FixtureSpec } from './fixture.ts';
import { NOTIFICATION_WORKER_URL, pushEntities } from './tier1.ts';

const TAG = '/* groups-perf */';
const DRAIN_TIMEOUT_MS = 300000;
const STATS_FLUSH_MS = 11000;
const LINKED_EXERCISES = [
  { ex: 0, name: 'Bench press', weight: (k: number) => (k === 0 ? '50' : '82.5'), reps: '5' },
  { ex: 1, name: 'Back squat', weight: (k: number) => (k === 0 ? '60' : '110'), reps: '5' },
  { ex: 5, name: 'Pull-up', weight: (k: number) => (k === 0 ? '0' : '5'), reps: '8' },
] as const;

export type Tier2Options = {
  dbUrl: string;
  adminDbUrl: string;
  apiUrl: string;
  anonKey: string;
  jwtSecret: string;
  serviceRoleKey: string;
  fixture: Omit<FixtureSpec, 'tag'>;
  levels: number[];
  cadenceMs: number;
  windowMs: number;
  settleMs: number;
  idleTicks: number;
  log: (line: string) => void;
};

export type StatementTotals = { calls: number; pages: number; tempBytes: number; walBytes: number; execMs: number };

export type WindowCounters = {
  durationMs: number;
  statements: StatementTotals;
  /** Top-level statements by the app_public function they call ('other' for none). */
  byFunction: Record<string, StatementTotals>;
  appRowsWritten: number;
  /** Rows written per app table, for the tables that wrote any. */
  appTables: Record<string, number>;
  platformRowsWritten: number;
  walBytes: number;
  deadlocks: number;
  edgeResponses: { groupEval: GroupEvalOutcomes; notificationWorker: number; timedOut: number; failed: number };
  cronRuns: Record<string, number>;
};

type GroupEvalOutcomes = { responses: number; claimed: number; metricClaimed: number; completed: number; requeued: number; failed: number };

export type LevelResult = {
  loggers: number;
  setsPushed: number;
  pushFailures: number;
  counters: WindowCounters;
  latencyMs: { p50: number | null; p95: number | null; max: number | null; unpublished: number };
  lockWaits: { samples: number; waitingSamples: number; maxWaiting: number };
  retries: { jobsWithAttempts: number; lastSqlstates: string[] };
};

export type IdleResult = { ticks: Record<string, number>; schedules: Record<string, string>; perHour: WindowCounters; forcedArchivesPerHour: number };

export type Tier2Result = {
  fixture: { members: number; historyDays: number; sets: number };
  setupMs: number;
  levels: LevelResult[];
  idle: IdleResult | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An HS256 app token for a fixture member, as Supabase Auth would sign it. */
export const mintToken = (userId: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string => {
  const unsigned = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({
    sub: userId, role: 'authenticated', aud: 'authenticated', iat: nowSec, exp: nowSec + 3600, aal: 'aal1',
  })}`;
  return `${unsigned}.${crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
};

/** The app_public function a top-level statement calls: PostgREST quotes it, cron does not. */
export const statementFunction = (query: string): string => {
  const match = /"?app_public"?\."?([a-z_][a-z0-9_]*)"?\s*\(/i.exec(query);
  return match ? match[1] : 'other';
};

export const percentile = (values: readonly number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

/** Distinct 2-minute windows in an hour holding a WAL-writing tick: the forced archives archive_timeout=2min costs. */
export const forcedArchivesPerHour = (minutesWithWal: readonly number[]): number =>
  new Set(minutesWithWal.map((minute) => Math.floor(minute / 2))).size;

/** One poll of the idle window: cron runs finished so far, and WAL bytes written since the window began. */
export type TickSample = { runs: number; walBytes: number };

/**
 * The forced archives of an hour whose ticks fire in `minutes`: its 2-minute
 * windows holding a tick, times the share of polls that saw a tick finish and
 * the WAL position advance. A run that wrote nothing forces no archive.
 */
export const projectedForcedArchives = (samples: readonly TickSample[], minutes: readonly number[]): number => {
  let ticked = 0;
  let wrote = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].runs === samples[i - 1].runs) continue;
    ticked += 1;
    if (samples[i].walBytes > samples[i - 1].walBytes) wrote += 1;
  }
  return ticked === 0 ? 0 : Math.round((forcedArchivesPerHour(minutes) * wrote) / ticked);
};

type Snapshot = {
  at: number;
  statements: Map<string, StatementTotals & { query: string }>;
  tables: Map<string, number>;
  lsn: string;
  deadlocks: number;
  responseId: number;
  cronRunId: number;
};

const snapshot = async (admin: Client): Promise<Snapshot> => {
  const statements = new Map<string, StatementTotals & { query: string }>();
  const ss = await admin.query(`${TAG} select userid::text||':'||dbid::text||':'||queryid::text as k, query, calls::float8,
    (shared_blks_hit+shared_blks_read)::float8 as pages, ((temp_blks_read+temp_blks_written)*8192)::float8 as temp,
    wal_bytes::float8 as wal, total_exec_time::float8 as ms from pg_stat_statements(true)`);
  for (const row of ss.rows) {
    statements.set(row.k, { query: row.query, calls: row.calls, pages: row.pages, tempBytes: row.temp, walBytes: row.wal, execMs: row.ms });
  }
  const tables = new Map<string, number>();
  const ts = await admin.query(`${TAG} select schemaname||'.'||relname as t, (n_tup_ins+n_tup_upd+n_tup_del)::float8 as w from pg_stat_user_tables`);
  for (const row of ts.rows) tables.set(row.t, row.w);
  const [state] = (await admin.query(`${TAG} select pg_current_wal_lsn()::text as lsn,
    (select deadlocks from pg_stat_database where datname = current_database())::float8 as deadlocks,
    (select coalesce(max(id),0) from net._http_response)::float8 as response_id,
    (select coalesce(max(runid),0) from cron.job_run_details)::float8 as cron_run_id`)).rows;
  return { at: Date.now(), statements, tables, lsn: state.lsn, deadlocks: state.deadlocks, responseId: state.response_id, cronRunId: state.cron_run_id };
};

const addTotals = (a: StatementTotals, b: StatementTotals): StatementTotals => ({
  calls: a.calls + b.calls, pages: a.pages + b.pages, tempBytes: a.tempBytes + b.tempBytes, walBytes: a.walBytes + b.walBytes, execMs: a.execMs + b.execMs,
});
const zero = (): StatementTotals => ({ calls: 0, pages: 0, tempBytes: 0, walBytes: 0, execMs: 0 });

const windowCounters = async (admin: Client, before: Snapshot, after: Snapshot): Promise<WindowCounters> => {
  let statements = zero();
  let harnessWal = 0;
  const byFunction: Record<string, StatementTotals> = {};
  for (const [key, end] of after.statements) {
    const start = before.statements.get(key) ?? { ...zero(), query: end.query };
    const delta = { calls: end.calls - start.calls, pages: end.pages - start.pages, tempBytes: end.tempBytes - start.tempBytes,
      walBytes: end.walBytes - start.walBytes, execMs: end.execMs - start.execMs };
    if (delta.calls <= 0) continue;
    // The harness's own statements (snapshots, cron.alter_job) are not the stack's work.
    if (end.query.includes(TAG)) {
      harnessWal += delta.walBytes;
      continue;
    }
    statements = addTotals(statements, delta);
    const fn = statementFunction(end.query);
    byFunction[fn] = addTotals(byFunction[fn] ?? zero(), delta);
  }
  let appRowsWritten = 0;
  let platformRowsWritten = 0;
  const appTables: Record<string, number> = {};
  for (const [table, end] of after.tables) {
    const delta = end - (before.tables.get(table) ?? 0);
    if (table === 'cron.job') continue; // only the harness's schedule changes write it
    if (!/^(app_public|public)\./.test(table)) {
      platformRowsWritten += delta;
    } else if (delta !== 0) {
      appRowsWritten += delta;
      appTables[table] = delta;
    }
  }
  const [wal] = (await admin.query(`${TAG} select pg_wal_lsn_diff($1::pg_lsn,$2::pg_lsn)::float8 as bytes`, [after.lsn, before.lsn])).rows;
  const responses = (await admin.query(`${TAG} select status_code, timed_out, error_msg, content from net._http_response
    where id > $1 and id <= $2`, [before.responseId, after.responseId])).rows;
  const groupEval: GroupEvalOutcomes = { responses: 0, claimed: 0, metricClaimed: 0, completed: 0, requeued: 0, failed: 0 };
  let notificationWorker = 0;
  let timedOut = 0;
  let failed = 0;
  for (const response of responses) {
    if (response.timed_out) { timedOut += 1; continue; }
    if (response.status_code !== 200) { failed += 1; continue; }
    const body = JSON.parse(response.content ?? '{}') as Partial<GroupEvalOutcomes> & { rules_version?: number; metric_claimed?: number; outcomes?: unknown };
    if (body.rules_version !== undefined) {
      groupEval.responses += 1;
      groupEval.claimed += body.claimed ?? 0;
      groupEval.metricClaimed += body.metric_claimed ?? 0;
      groupEval.completed += body.completed ?? 0;
      groupEval.requeued += body.requeued ?? 0;
      groupEval.failed += body.failed ?? 0;
    } else if (body.outcomes !== undefined) {
      notificationWorker += 1;
    }
  }
  const cron = (await admin.query(`${TAG} select j.jobname, count(*)::int as n from cron.job_run_details d join cron.job j using (jobid)
    where d.runid > $1 and d.runid <= $2 group by 1`, [before.cronRunId, after.cronRunId])).rows;
  return {
    durationMs: after.at - before.at, statements, byFunction, appRowsWritten, appTables, platformRowsWritten, walBytes: Math.max(0, wal.bytes - harnessWal),
    deadlocks: after.deadlocks - before.deadlocks,
    edgeResponses: { groupEval, notificationWorker, timedOut, failed },
    cronRuns: Object.fromEntries(cron.map((row) => [row.jobname as string, row.n as number])),
  };
};

export const scaleWindow = (counters: WindowCounters, factor: number): WindowCounters => {
  const scale = (t: StatementTotals): StatementTotals => ({ calls: t.calls * factor, pages: t.pages * factor,
    tempBytes: t.tempBytes * factor, walBytes: t.walBytes * factor, execMs: t.execMs * factor });
  const g = counters.edgeResponses.groupEval;
  return {
    durationMs: counters.durationMs * factor,
    statements: scale(counters.statements),
    byFunction: Object.fromEntries(Object.entries(counters.byFunction).map(([fn, t]) => [fn, scale(t)])),
    appRowsWritten: counters.appRowsWritten * factor,
    appTables: Object.fromEntries(Object.entries(counters.appTables).map(([table, n]) => [table, n * factor])),
    platformRowsWritten: counters.platformRowsWritten * factor,
    walBytes: counters.walBytes * factor,
    deadlocks: counters.deadlocks * factor,
    edgeResponses: {
      groupEval: { responses: g.responses * factor, claimed: g.claimed * factor, metricClaimed: g.metricClaimed * factor,
        completed: g.completed * factor, requeued: g.requeued * factor, failed: g.failed * factor },
      notificationWorker: counters.edgeResponses.notificationWorker * factor,
      timedOut: counters.edgeResponses.timedOut * factor,
      failed: counters.edgeResponses.failed * factor,
    },
    cronRuns: Object.fromEntries(Object.entries(counters.cronRuns).map(([job, n]) => [job, n * factor])),
  };
};

class LockSampler {
  samples = 0;
  waitingSamples = 0;
  maxWaiting = 0;
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(private readonly client: Client) {}

  start(): void {
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const [row] = (await this.client.query(`${TAG} select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`)).rows;
        this.samples += 1;
        if (row.n > 0) this.waitingSamples += 1;
        this.maxWaiting = Math.max(this.maxWaiting, row.n);
        await sleep(250);
      }
    })();
  }

  async stop(): Promise<LevelResult['lockWaits']> {
    this.running = false;
    await this.loop;
    return { samples: this.samples, waitingSamples: this.waitingSamples, maxWaiting: this.maxWaiting };
  }
}

type Fixture = { groupId: string; members: { idx: number; uid: string }[]; groupExercises: Map<number, string>; sets: number };

export class Tier2Run {
  private readonly admin: Client;
  private readonly app: Client;
  private readonly sampler: Client;
  private restore: (() => Promise<void>)[] = [];
  private fixture: Fixture | null = null;
  private closed = false;

  constructor(private readonly options: Tier2Options) {
    this.admin = new Client({ connectionString: options.adminDbUrl });
    this.app = new Client({ connectionString: options.dbUrl });
    this.sampler = new Client({ connectionString: options.adminDbUrl });
  }

  async run(): Promise<Tier2Result> {
    const startedAt = Date.now();
    await Promise.all([this.admin.connect(), this.app.connect(), this.sampler.connect()]);
    try {
      const phase = (name: string, since: number) => this.options.log(`[load] ${name} after ${Math.round((Date.now() - since) / 1000)} s`);
      await this.configure();
      this.fixture = await this.loadFixture();
      phase(`fixture of ${this.fixture.sets} sets loaded`, startedAt);
      const drainStarted = Date.now();
      await this.drain();
      phase('Edge drain to steady state', drainStarted);
      await this.admin.query(`${TAG} vacuum (analyze)`);
      const setupMs = Date.now() - startedAt;
      phase('setup', startedAt);
      const levels: LevelResult[] = [];
      for (const loggers of this.options.levels) levels.push(await this.level(loggers));
      const idle = this.options.idleTicks > 0 ? await this.idle() : null;
      return { fixture: { ...this.options.fixture, sets: this.fixture.sets }, setupMs, levels, idle };
    } finally {
      await this.cleanup();
    }
  }

  /** Hosted configuration for the run; each change registers its undo first. */
  private async configure(): Promise<void> {
    const jobs = (await this.admin.query(`${TAG} select jobid, schedule from cron.job`)).rows;
    this.restore.push(async () => {
      for (const job of jobs) await this.admin.query(`${TAG} select cron.alter_job($1, schedule => $2)`, [job.jobid, job.schedule]);
    });
    const [epoch] = (await this.admin.query(`${TAG} select started_at::text as started_at from app_public.notification_workout_epoch`)).rows;
    this.restore.push(async () => {
      await this.admin.query(`${TAG} update app_public.notification_workout_epoch set started_at = $1::timestamptz`, [epoch.started_at]);
    });
    const existing = (await this.admin.query(`${TAG} select name from vault.secrets
      where name in ('notification_worker_url','notification_worker_key')`)).rows;
    if (existing.length > 0) throw new Error('notification worker Vault secrets already exist on this stack; refusing to overwrite them');
    this.restore.push(async () => {
      await this.admin.query(`${TAG} delete from vault.secrets where name in ('notification_worker_url','notification_worker_key')`);
    });
    await this.admin.query(`${TAG} select vault.create_secret($1,'notification_worker_url'), vault.create_secret($2,'notification_worker_key')`,
      [NOTIFICATION_WORKER_URL, this.options.serviceRoleKey]);
    await this.admin.query(`${TAG} update app_public.notification_workout_epoch set started_at = now() - interval '7 days'`);
  }

  private async loadFixture(): Promise<Fixture> {
    const tag = `load${crypto.randomBytes(3).toString('hex')}`;
    await this.app.query('begin');
    let fx: { group_id: string };
    let members: Fixture['members'];
    try {
      for (const statement of fixtureStatements({ ...this.options.fixture, tag })) await this.app.query(statement);
      [fx] = (await this.app.query('select group_id::text from perf_fx')).rows;
      members = (await this.app.query('select idx, uid::text from perf_members order by idx')).rows as Fixture['members'];
      // Registered before the commit, so no interruption can leave committed rows behind.
      this.restore.push(() => this.deleteFixture(fx.group_id, members.map((m) => m.uid)));
      await this.app.query('commit');
    } catch (error) {
      await this.app.query('rollback');
      throw error;
    }
    const exercises = (await this.app.query('select ex, id::text from perf_group_exercises')).rows;
    const [counts] = (await this.app.query(`select count(*)::int as n from app_public.exercise_sets es join perf_members m on m.uid = es.owner_user_id`)).rows;
    return { groupId: fx.group_id, members, groupExercises: new Map(exercises.map((row) => [row.ex as number, row.id as string])), sets: counts.n };
  }

  private async deleteFixture(groupId: string, uids: string[]): Promise<void> {
    await this.admin.query(`${TAG} delete from app_public.groups where id = $1`, [groupId]);
    await this.admin.query(`${TAG} delete from auth.users where id = any($1::uuid[])`, [uids]);
    const [left] = (await this.admin.query(`${TAG} select (select count(*) from app_public.exercise_sets where owner_user_id = any($1::uuid[]))
      + (select count(*) from app_public.group_session_shares where group_id = $2) as n`, [uids, groupId])).rows;
    if (Number(left.n) !== 0) throw new Error(`fixture cleanup left ${left.n} rows`);
  }

  private async edge(path: string, headers: Record<string, string>): Promise<Response> {
    return fetch(`${this.options.apiUrl}/functions/v1/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}', signal: AbortSignal.timeout(600000),
    });
  }

  /** Steady state through the real Edge function, as the groups-leaderboards lane drains it. */
  private async drain(): Promise<void> {
    const [secret] = (await this.admin.query(`${TAG} select app_public.group_eval_config('group_eval_secret') as s`)).rows;
    // The fixture's own commit kicks group-eval too: while that run holds the
    // jobs, a drain claims nothing, so wait for it rather than spin.
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    for (;;) {
      const response = await this.edge('group-eval', { 'x-group-eval-secret': secret.s });
      if (!response.ok) throw new Error(`group-eval drain failed: HTTP ${response.status}`);
      const body = (await response.json()) as { claimed: number; failed: number };
      if (body.failed > 0) throw new Error(`group-eval drain: ${body.failed} jobs failed`);
      if (body.claimed > 0) continue;
      const pending = await this.pendingJobs();
      if (pending === 0) break;
      if (Date.now() > deadline) throw new Error(`group-eval drain left ${pending} jobs or kicks after ${DRAIN_TIMEOUT_MS / 1000} s`);
      await sleep(1000);
    }
    const worker = await this.edge('notification-worker', { apikey: this.options.serviceRoleKey });
    if (!worker.ok) throw new Error(`notification-worker failed: HTTP ${worker.status}`);
    await this.quiesce();
  }

  private async pendingJobs(): Promise<number> {
    const [row] = (await this.admin.query(`${TAG} select ((select count(*) from app_public.group_eval_queue)
      + (select count(*) from app_public.group_metric_eval_queue) + (select count(*) from net.http_request_queue))::int as n`)).rows;
    return row.n;
  }

  /**
   * Until no queued job, no unsent kick and no running app statement is left.
   * A stack that does not settle fails the run: measuring on it would charge
   * one window's work to the next.
   */
  private async quiesce(): Promise<void> {
    const deadline = Date.now() + this.options.settleMs;
    while (Date.now() < deadline) {
      const [active] = (await this.admin.query(`${TAG} select count(*)::int as n from pg_stat_activity
        where datname = current_database() and state = 'active' and query ilike '%app_public%' and query not like '%groups-perf%'`)).rows;
      if ((await this.pendingJobs()) === 0 && active.n === 0) {
        // An idle backend flushes its table counters up to 10 s late
        // (PGSTAT_IDLE_INTERVAL); without the wait they land in the next window.
        await sleep(STATS_FLUSH_MS);
        return;
      }
      await sleep(500);
    }
    throw new Error(`stack did not settle within ${this.options.settleMs / 1000} s: ${await this.pendingJobs()} jobs or kicks pending`);
  }

  private async push(token: string, entities: unknown[]): Promise<boolean> {
    const response = await fetch(`${this.options.apiUrl}/rest/v1/rpc/sync_push`, {
      method: 'POST',
      headers: { apikey: this.options.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'Content-Profile': 'app_public', 'x-boga-sync-protocol': '4' },
      body: JSON.stringify({ entities }),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return response.ok && body?.ok === true;
  }

  private async level(loggers: number): Promise<LevelResult> {
    const fixture = this.fixture!;
    if (loggers > fixture.members.length) throw new Error(`${loggers} loggers need as many fixture members`);
    await this.quiesce();
    const before = await snapshot(this.admin);
    const sampler = new LockSampler(this.sampler);
    sampler.start();
    const pushed: { uid: string; setId: string; groupExerciseId: string }[] = [];
    let failures = 0;
    const { cadenceMs, windowMs } = this.options;
    await Promise.all(fixture.members.slice(0, loggers).map(async (member, i) => {
      const token = mintToken(member.uid, this.options.jwtSecret);
      const exercise = LINKED_EXERCISES[i % LINKED_EXERCISES.length];
      const sessionId = `perf-load-c${loggers}`;
      const blockId = `${sessionId}-b0`;
      let clock = Date.now();
      await sleep(Math.round((i * cadenceMs) / loggers));
      for (let k = 0; Date.now() - before.at < windowMs; k += 1) {
        const set = pushEntities.set(`${blockId}-x${k}`, blockId, k, exercise.weight(k), exercise.reps, (clock += 1));
        const entities = k === 0
          ? [pushEntities.session(sessionId, clock - 300000, (clock += 1)), pushEntities.block(blockId, sessionId, exercise.ex, 0, exercise.name, (clock += 1)), set]
          : [set];
        if (await this.push(token, entities)) pushed.push({ uid: member.uid, setId: set.id, groupExerciseId: fixture.groupExercises.get(exercise.ex)! });
        else failures += 1;
        const next = before.at + Math.round((i * cadenceMs) / loggers) + (k + 1) * cadenceMs;
        if (next - before.at >= windowMs) break;
        await sleep(Math.max(0, next - Date.now()));
      }
    }));
    await this.quiesce();
    const lockWaits = await sampler.stop();
    const after = await snapshot(this.admin);
    const counters = await windowCounters(this.admin, before, after);
    const latencies = (await this.admin.query(`${TAG} select p.set_id,
      extract(epoch from (min(sc.evaluated_at) - es.server_received_at))*1000 as ms
      from jsonb_to_recordset($1::jsonb) as p(uid uuid, set_id text, group_exercise_id uuid)
      join app_public.exercise_sets es on es.owner_user_id = p.uid and es.id = p.set_id
      left join app_public.group_metric_set_scores sc on sc.member_user_id = p.uid and sc.set_id = p.set_id
        and sc.group_exercise_id = p.group_exercise_id
      group by p.set_id, es.server_received_at`,
    [JSON.stringify(pushed.map((p) => ({ uid: p.uid, set_id: p.setId, group_exercise_id: p.groupExerciseId })))])).rows;
    const published = latencies.filter((row) => row.ms !== null).map((row) => Number(row.ms));
    const retries = (await this.admin.query(`${TAG} select count(*)::int as n, coalesce(array_agg(distinct last_sqlstate)
      filter (where last_sqlstate is not null), '{}') as states from app_public.group_metric_eval_queue where attempts > 0`)).rows[0];
    this.options.log(`[load] C=${loggers}: ${pushed.length} sets, ${counters.statements.pages} pages, p95 latency ${percentile(published, 95)} ms`);
    return {
      loggers, setsPushed: pushed.length, pushFailures: failures, counters,
      latencyMs: { p50: percentile(published, 50), p95: percentile(published, 95), max: percentile(published, 100), unpublished: latencies.length - published.length },
      lockWaits, retries: { jobsWithAttempts: retries.n, lastSqlstates: retries.states },
    };
  }

  /** Both sweeps on a 10-second schedule for `idleTicks` ticks each, scaled to their real schedules' runs per hour. */
  private async idle(): Promise<IdleResult> {
    await this.quiesce();
    const jobs = (await this.admin.query(`${TAG} select jobid, jobname, schedule from cron.job order by jobid`)).rows as
      { jobid: number; jobname: string; schedule: string }[];
    const rates = jobs.map((job) => runsPerHour(job.schedule));
    if (new Set(rates).size > 1) throw new Error(`cron jobs run at different rates (${rates.join(', ')}); measure them one at a time`);
    const before = await snapshot(this.admin);
    for (const job of jobs) await this.admin.query(`${TAG} select cron.alter_job($1, schedule => '10 seconds')`, [job.jobid]);
    const samples: TickSample[] = [];
    const sample = async () => {
      const [row] = (await this.admin.query(`${TAG} select count(*) filter (where status in ('succeeded','failed'))::int as runs,
        pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::float8 as wal from cron.job_run_details where runid > $2`,
      [before.lsn, before.cronRunId])).rows;
      samples.push({ runs: row.runs, walBytes: row.wal });
    };
    await sample();
    const deadline = Date.now() + this.options.idleTicks * 10000 + 60000;
    let ticks: Record<string, number> = {};
    while (Date.now() < deadline) {
      await sleep(2000);
      await sample();
      const rows = (await this.admin.query(`${TAG} select j.jobname, count(*)::int as n from cron.job_run_details d join cron.job j using (jobid)
        where d.runid > $1 group by 1`, [before.cronRunId])).rows;
      ticks = Object.fromEntries(rows.map((row) => [row.jobname as string, row.n as number]));
      if (jobs.every((job) => (ticks[job.jobname] ?? 0) >= this.options.idleTicks)) break;
    }
    for (const job of jobs) await this.admin.query(`${TAG} select cron.alter_job($1, schedule => $2)`, [job.jobid, job.schedule]);
    await this.quiesce();
    const after = await snapshot(this.admin);
    const counters = await windowCounters(this.admin, before, after);
    const meanTicks = jobs.reduce((sum, job) => sum + (counters.cronRuns[job.jobname] ?? 0), 0) / Math.max(1, jobs.length);
    if (meanTicks === 0) throw new Error('no cron tick ran during the idle window');
    const perHour = scaleWindow(counters, rates[0] / meanTicks);
    return {
      ticks: counters.cronRuns, schedules: Object.fromEntries(jobs.map((job) => [job.jobname, job.schedule])), perHour,
      forcedArchivesPerHour: projectedForcedArchives(samples, jobs.flatMap((job) => cronMinutes(job.schedule))),
    };
  }

  /** Undo every change, newest first; idempotent, so a signal handler may call it while the run unwinds. */
  async cleanup(): Promise<void> {
    const undos = this.restore.splice(0).reverse();
    if (undos.length === 0 && this.closed) return;
    const errors: string[] = [];
    for (const undo of undos) {
      try {
        await undo();
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    if (!this.closed) {
      this.closed = true;
      await Promise.all([this.admin.end(), this.app.end(), this.sampler.end()]);
    }
    if (errors.length > 0) throw new Error(`load run cleanup failed: ${errors.join('; ')}`);
  }
}
