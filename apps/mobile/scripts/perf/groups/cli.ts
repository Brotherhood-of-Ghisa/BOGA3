// Groups performance harness entrypoint (lanes groups-perf, groups-perf-load).
//
//   tsx scripts/perf/groups/cli.ts tier1 [--matrix default|full] [--strict]
//   tsx scripts/perf/groups/cli.ts load [--strict]
//
// Writes artifacts/perf/groups/<run>/report.json and summary.md under
// apps/mobile and prints the summary. Assertions are report-only: --strict
// turns a WARN into exit 1. Reads DB_URL, API_URL, ANON_KEY, JWT_SECRET and
// SERVICE_ROLE_KEY from the slot's `supabase status` (the lane body exports
// them). Load-run knobs: GROUPS_PERF_LEVELS (1,5,10), GROUPS_PERF_WINDOW_S,
// GROUPS_PERF_CADENCE_S, GROUPS_PERF_IDLE_TICKS.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { runsPerHour } from './cron.ts';
import {
  computeSlopes,
  summarizeLevel,
  summarizeTier1,
  tier1Assertions,
  tier1Markdown,
  tier2Assertions,
  tier2Markdown,
  type Assertion,
  type CronJob,
  type ScenarioSummary,
  type SweepPlan,
} from './report.ts';
import { runTier1Scenario, type Tier1Scenario } from './tier1.ts';
import { Tier2Run } from './tier2.ts';

/** Doubling series small enough to finish inside one gate run on today's code. */
export const DEFAULT_PLAN: SweepPlan = {
  history: { members: 4, days: [14, 28, 56, 112] },
  members: { days: 28, members: [2, 4, 8, 16] },
};
/** The production-scale matrix; a sweep stops at its first point that cannot finish. */
export const FULL_PLAN: SweepPlan = {
  history: { members: 10, days: [91, 365, 730, 1460] },
  members: { days: 730, members: [2, 5, 10, 20] },
};
const HOSTED_STATEMENT_TIMEOUT_MS = 120000;

const STACK_ENV = {
  DB_URL: process.env.DB_URL,
  API_URL: process.env.API_URL,
  ANON_KEY: process.env.ANON_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  SERVICE_ROLE_KEY: process.env.SERVICE_ROLE_KEY,
};

const env = (name: keyof typeof STACK_ENV): string => {
  const value = STACK_ENV[name];
  if (!value) throw new Error(`${name} is not set; run through ./boga test groups-perf (or groups-perf-load)`);
  return value;
};

const adminUrl = (dbUrl: string): string => {
  const url = new URL(dbUrl);
  url.username = 'supabase_admin';
  return url.toString();
};

const numberList = (value: string | undefined, fallback: number[]): number[] =>
  value ? value.split(',').map((item) => Number(item.trim())) : fallback;

const gitRef = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const writeReport = (tier: string, report: object, summary: string): string => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(__dirname, '../../../artifacts/perf/groups', `${stamp}-${tier}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(dir, 'summary.md'), summary);
  return dir;
};

const scenarioName = (members: number, days: number) => `m${members}-h${days}d`;

/** Every point of both sweeps, the shared one once; after a point fails, the rest of its sweep is skipped. */
const runPlan = async (plan: SweepPlan, run: (members: number, days: number) => Promise<Tier1Scenario>) => {
  const results = new Map<string, Tier1Scenario | ScenarioSummary>();
  const sweeps: [number, number][][] = [
    plan.history.days.map((days) => [plan.history.members, days]),
    plan.members.members.map((members) => [members, plan.members.days]),
  ];
  for (const points of sweeps) {
    let blocked: string | null = null;
    for (const [members, days] of points) {
      const name = scenarioName(members, days);
      const known = results.get(name);
      if (known) {
        if (known.incomplete) blocked = name;
        continue;
      }
      if (blocked) {
        results.set(name, { name, members, historyDays: days, sets: 0, perSet: null, perSetUnlinked: null, idleHour: null,
          incomplete: `skipped: ${blocked} did not complete` });
        continue;
      }
      const result = await run(members, days);
      results.set(name, result);
      if (result.incomplete) blocked = name;
    }
  }
  return [...results.values()];
};

const isScenario = (value: Tier1Scenario | ScenarioSummary): value is Tier1Scenario => 'steps' in value;

const tier1 = async (args: string[], log: (line: string) => void) => {
  const matrix = args.includes('--matrix') ? args[args.indexOf('--matrix') + 1] : 'default';
  if (matrix !== 'default' && matrix !== 'full') throw new Error(`unknown matrix ${matrix}`);
  const plan = matrix === 'full' ? FULL_PLAN : DEFAULT_PLAN;
  const dbUrl = env('DB_URL');
  const options = { dbUrl, adminDbUrl: adminUrl(dbUrl), statementTimeoutMs: HOSTED_STATEMENT_TIMEOUT_MS, log };
  const raw = await runPlan(plan, (members, days) =>
    runTier1Scenario(scenarioName(members, days), { members, historyDays: days, tag: `t${members}x${days}` }, options));
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const jobs = (await client.query('select jobname, command, schedule from cron.job order by jobid')).rows as CronJob[];
  await client.end();
  const unmeasured = new Set<string>();
  const summaries = raw.map((item) => {
    if (!isScenario(item)) return item;
    const { summary, unmeasuredJobs } = summarizeTier1(
      { ...item, steps: item.incomplete ? {} : item.steps }, jobs, runsPerHour);
    unmeasuredJobs.forEach((job) => unmeasured.add(job));
    return summary;
  });
  const slopes = computeSlopes(summaries, plan);
  const assertions: Assertion[] = tier1Assertions(summaries, slopes);
  if (unmeasured.size > 0) {
    assertions.push({ id: 'cron-jobs-measured', description: 'every pg_cron job has a measured idle step',
      observed: `unmeasured: ${[...unmeasured].join(', ')}`, pass: false });
  }
  const summary = `## Groups performance — Tier 1 (${matrix} matrix, ${gitRef()})\n\n${tier1Markdown(summaries, slopes, assertions)}`;
  const dir = writeReport(`tier1-${matrix}`, { tier: 1, matrix, gitRef: gitRef(), generatedAt: new Date().toISOString(),
    plan, cronJobs: jobs, statementTimeoutMs: HOSTED_STATEMENT_TIMEOUT_MS, summaries, slopes, assertions, scenarios: raw }, summary);
  return { summary, dir, assertions };
};

const load = async (log: (line: string) => void) => {
  const dbUrl = env('DB_URL');
  const fixture = { members: 10, historyDays: 28 };
  const result = await new Tier2Run({
    dbUrl, adminDbUrl: adminUrl(dbUrl), apiUrl: env('API_URL'), anonKey: env('ANON_KEY'), jwtSecret: env('JWT_SECRET'),
    serviceRoleKey: env('SERVICE_ROLE_KEY'), fixture,
    levels: numberList(process.env.GROUPS_PERF_LEVELS, [1, 5, 10]),
    cadenceMs: Number(process.env.GROUPS_PERF_CADENCE_S ?? 90) * 1000,
    windowMs: Number(process.env.GROUPS_PERF_WINDOW_S ?? 120) * 1000,
    settleMs: 120000,
    idleTicks: Number(process.env.GROUPS_PERF_IDLE_TICKS ?? 6),
    log,
  }).run();
  const levels = result.levels.map(summarizeLevel);
  const assertions = tier2Assertions(levels, result.idle);
  const summary = `## Groups performance — Tier 2 load run (${gitRef()})\n\n${tier2Markdown(result.fixture, levels, result.idle, assertions)}`;
  const dir = writeReport('load', { tier: 2, gitRef: gitRef(), generatedAt: new Date().toISOString(), levels, result, assertions }, summary);
  return { summary, dir, assertions };
};

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  const log = (line: string) => console.log(line);
  const outcome = command === 'tier1' ? await tier1(args, log) : command === 'load' ? await load(log) : null;
  if (!outcome) throw new Error('usage: cli.ts tier1 [--matrix default|full] [--strict] | load [--strict]');
  console.log(`\n${outcome.summary}`);
  console.log(`[groups-perf] report: ${path.join(outcome.dir, 'report.json')}`);
  const warned = outcome.assertions.filter((assertion) => assertion.pass === false).length;
  if (warned > 0 && args.includes('--strict')) {
    console.error(`[groups-perf] ${warned} scaling assertions failed (--strict)`);
    process.exit(1);
  }
  console.log(`[groups-perf] ${warned} scaling assertions warned (report-only)`);
};

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[groups-perf] FAIL: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
}
