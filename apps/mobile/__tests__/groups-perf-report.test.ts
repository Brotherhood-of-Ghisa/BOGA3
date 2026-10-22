/** @jest-environment node */
// The groups performance harness's counters and report: EXPLAIN parsing,
// table deltas, slopes per doubling, the report-only assertions and the
// summary tables. Pure; the live lanes are groups-perf and groups-perf-load.
import {
  addCounters,
  countersFromExplain,
  diffTables,
  emptyCounters,
  isAppTable,
  rowsWritten,
  scans,
  type Counters,
} from '../scripts/perf/groups/counters';
import {
  combineSteps,
  computeSlopes,
  perDoubling,
  scaleMetrics,
  stepMetrics,
  summarizeLevel,
  summarizeTier1,
  tier1Assertions,
  tier1Markdown,
  tier2Assertions,
  tier2Markdown,
  type MeasuredStep,
  type ScenarioSummary,
  type StepMetrics,
  type Tier2LevelInput,
} from '../scripts/perf/groups/report';

const explain = (plan: Record<string, number>, planning: Record<string, number> = {}) => [
  { Plan: { 'Node Type': 'Result', ...plan }, Planning: planning, 'Planning Time': 0.5, 'Execution Time': 10 },
];

describe('countersFromExplain', () => {
  test('counts hit + read pages of the plan and its planning, temp in bytes, and one write transaction when WAL was written', () => {
    const counters = countersFromExplain(explain(
      { 'Shared Hit Blocks': 100, 'Shared Read Blocks': 5, 'Shared Dirtied Blocks': 3, 'Temp Written Blocks': 2,
        'Temp Read Blocks': 2, 'WAL Records': 4, 'WAL Bytes': 900 },
      { 'Shared Hit Blocks': 7, 'Shared Read Blocks': 1 },
    ));
    expect(counters).toMatchObject({ calls: 1, pages: 113, pagesRead: 6, pagesDirtied: 3, tempBytes: 4 * 8192,
      walBytes: 900, walRecords: 4, writeTransactions: 1, elapsedMs: 10.5 });
  });

  test('a read-only statement is no write transaction; missing counters are zero', () => {
    expect(countersFromExplain(explain({}))).toMatchObject({ pages: 0, walBytes: 0, writeTransactions: 0, tempBytes: 0 });
  });

  test('output without a plan is an error, not zero work', () => {
    expect(() => countersFromExplain([{}])).toThrow('EXPLAIN output has no plan');
  });
});

describe('table counters', () => {
  const t = (ins: number, upd = 0, del = 0, seqScan = 0, idxScan = 0, seqTupRead = 0) => ({ ins, upd, del, seqScan, idxScan, seqTupRead });

  test('diffTables keeps only the tables a call changed, including ones new since the first snapshot', () => {
    expect(diffTables(
      { 'app_public.sessions': t(1, 1), 'cron.job_run_details': t(5) },
      { 'app_public.sessions': t(2, 1, 0, 1), 'cron.job_run_details': t(5), 'net.http_request_queue': t(1) },
    )).toEqual({ 'app_public.sessions': t(1, 0, 0, 1), 'net.http_request_queue': t(1) });
  });

  test('rows written, app rows and scans sum across tables', () => {
    const counters: Counters = { ...emptyCounters(), tables: {
      'app_public.sessions': t(1, 2, 3, 4, 5, 6), 'public.app_logs': t(1), 'net.http_request_queue': t(1, 0, 0, 1),
    } };
    expect(rowsWritten(counters)).toBe(8);
    expect(rowsWritten(counters, isAppTable)).toBe(7);
    expect(scans(counters)).toEqual({ seq: 5, idx: 5, seqTupRead: 6 });
  });

  test('addCounters sums every field and merges tables', () => {
    const a: Counters = { ...emptyCounters(), calls: 1, pages: 10, walBytes: 5, writeTransactions: 1, tables: { 'app_public.a': t(1) } };
    const b: Counters = { ...emptyCounters(), calls: 2, pages: 1, tempBytes: 8, tables: { 'app_public.a': t(2), 'app_public.b': t(0, 1) } };
    expect(addCounters(a, b)).toMatchObject({ calls: 3, pages: 11, walBytes: 5, tempBytes: 8, writeTransactions: 1,
      tables: { 'app_public.a': t(3), 'app_public.b': t(0, 1) } });
  });
});

const step = (pages: number, extra: Partial<MeasuredStep> = {}): MeasuredStep => ({
  total: { ...emptyCounters(), calls: 2, pages, walBytes: pages / 10, tables: { 'app_public.group_metric_set_scores': {
    ins: 2, upd: 0, del: 0, seqScan: 1, idxScan: 3, seqTupRead: 9 }, 'net.http_request_queue': { ins: 1, upd: 0, del: 0, seqScan: 0, idxScan: 0, seqTupRead: 0 } } },
  calls: [{ error: null }, { error: null }],
  edgeRuns: { groupEval: 1, notificationWorker: 2 },
  groupEval: { claimed: 2, graphBytes: 500, setsScored: 40 },
  evaluations: 1,
  rejectedPublishes: 0,
  ...extra,
});

test('stepMetrics flattens one step; combineSteps adds steps; scaleMetrics multiplies every metric', () => {
  const metrics = stepMetrics(step(1000, { calls: [{ error: '57014' }, { error: null, counters: { elapsedMs: 8001 } }, { counters: { elapsedMs: 8000 } }] }));
  expect(metrics).toMatchObject({ pages: 1000, walBytes: 100, rowsWritten: 3, appRowsWritten: 2, seqScans: 1, idxScans: 3,
    edgeRuns: 3, claimedJobs: 2, evaluations: 1, graphBytes: 500, setsScored: 40, failedCalls: 1, callsOver8s: 1 });
  expect(stepMetrics(combineSteps([step(1), step(2)]))).toMatchObject({ pages: 3, edgeRuns: 6, evaluations: 2, graphBytes: 1000 });
  expect(scaleMetrics(metrics, 12)).toMatchObject({ pages: 12000, appRowsWritten: 24, edgeRuns: 36 });
});

describe('perDoubling', () => {
  test.each([
    [1, 100, 2, 200, 2],
    [1, 100, 2, 100, 1],
    [1, 100, 4, 400, 2],
    [2, 100, 5, 100, 1],
  ])('x %d→%d, value %d→%d is %d× per doubling', (x1, v1, x2, v2, expected) => {
    expect(perDoubling(x1, v1, x2, v2)).toBeCloseTo(expected, 6);
  });

  test('no slope through zero or a non-increasing x', () => {
    expect(perDoubling(1, 0, 2, 5)).toBeNull();
    expect(perDoubling(1, 5, 2, 0)).toBeNull();
    expect(perDoubling(2, 5, 2, 5)).toBeNull();
  });
});

const metrics = (pages: number, extra: Partial<StepMetrics> = {}): StepMetrics => ({
  ...stepMetrics(step(pages)), ...extra,
});

const scenario = (members: number, historyDays: number, pages: number | null, idlePages = 100, incomplete: string | null = null): ScenarioSummary => ({
  name: `m${members}-h${historyDays}d`, members, historyDays, sets: members * historyDays,
  perSet: pages === null ? null : metrics(pages), perSetUnlinked: pages === null ? null : metrics(10),
  idleHour: pages === null ? null : metrics(idlePages, { appRowsWritten: 0 }), incomplete,
});

const plan = { history: { members: 4, days: [14, 28, 56] }, members: { days: 28, members: [2, 4] } };

test('slopes follow each sweep in ascending order, holding the other variable', () => {
  const scenarios = [scenario(4, 56, 4000), scenario(4, 14, 1000), scenario(4, 28, 2000), scenario(2, 28, 2000), scenario(9, 9, 1)];
  const slopes = computeSlopes(scenarios, plan);
  expect(slopes.map((s) => [s.sweep, s.from, s.to, s.perSetPages])).toEqual([
    ['history', 'm4-h14d', 'm4-h28d', 2],
    ['history', 'm4-h28d', 'm4-h56d', 2],
    ['members', 'm2-h28d', 'm4-h28d', 1],
  ]);
});

test('assertions warn on growth, pass when flat, and skip what was not measured', () => {
  const flat = [scenario(4, 14, 1000), scenario(4, 28, 1050), scenario(4, 56, 1100), scenario(2, 28, 1000)];
  const passing = tier1Assertions(flat, computeSlopes(flat, plan));
  expect(passing.filter((a) => a.pass !== true).map((a) => a.id)).toEqual([]);

  const growing = [scenario(4, 14, 1000), scenario(4, 28, 3000, 5000), scenario(4, 56, null, 100, 'steady state unreachable'), scenario(2, 28, 1000)];
  growing[1].idleHour!.appRowsWritten = 48;
  growing[1].perSet!.evaluations = 2;
  const failing = Object.fromEntries(tier1Assertions(growing, computeSlopes(growing, plan)).map((a) => [a.id, a]));
  expect(failing['history-pages']).toMatchObject({ pass: false, observed: 'worst 3.00× per doubling' });
  expect(failing['members-pages'].pass).toBe(false);
  expect(failing['evaluations-per-set']).toMatchObject({ pass: false, observed: 'max 2' });
  expect(failing['idle-app-rows']).toMatchObject({ pass: false, observed: 'max 48 rows/h' });
  expect(failing['idle-pages'].pass).toBe(false);
  expect(failing['scenarios-complete']).toMatchObject({ pass: false, observed: 'm4-h56d: steady state unreachable' });

  const empty = Object.fromEntries(tier1Assertions([], []).map((a) => [a.id, a.pass]));
  expect(empty).toMatchObject({ 'history-pages': null, 'evaluations-per-set': null, 'idle-pages': null, 'scenarios-complete': true });
});

test('the Tier 1 summary has a row per scenario and per slope, then the assertions', () => {
  const scenarios = [scenario(4, 14, 1000), scenario(4, 28, 2_500_000), scenario(2, 28, null, 0, 'skipped: m4-h28d did not complete')];
  const slopes = computeSlopes(scenarios, plan);
  const markdown = tier1Markdown(scenarios, slopes, tier1Assertions(scenarios, slopes));
  expect(markdown).toContain('| m4-h14d | 4 | 14 | 56 | 1000 |');
  expect(markdown).toContain('| m4-h28d | 4 | 28 | 112 | 2.50M |');
  expect(markdown).toContain('| m2-h28d (skipped: m4-h28d did not complete) | 2 | 28 | 56 | — |');
  expect(markdown).toContain('| history | m4-h14d → m4-h28d | 2500.00× |');
  expect(markdown).toContain('- WARN history-pages:');
});

describe('summarizeTier1', () => {
  const input = {
    name: 'm4-h28d', members: 4, historyDays: 28, fixture: { sets: 1119 }, incomplete: null,
    steps: { logged_set: step(5000), logged_set_unlinked: step(50), idle_group_eval_sweep: step(10), idle_notification_sweep: step(20) },
  };

  test('scales each cron job\'s idle step by its own runs per hour', () => {
    const { summary, unmeasuredJobs } = summarizeTier1(input, [
      { jobname: 'group-eval-sweep', command: 'select app_public.group_eval_sweep()', schedule: '*/5 * * * *' },
      { jobname: 'notification-delivery-sweep', command: 'select app_public.notification_sweep()', schedule: '0 * * * *' },
    ], (schedule) => (schedule === '0 * * * *' ? 1 : 12));
    expect(unmeasuredJobs).toEqual([]);
    expect(summary.perSet?.pages).toBe(5000);
    expect(summary.perSetUnlinked?.pages).toBe(50);
    expect(summary.idleHour?.pages).toBe(10 * 12 + 20);
  });

  test('a job with no idle step is reported, and an incomplete scenario has no numbers', () => {
    const { summary, unmeasuredJobs } = summarizeTier1({ ...input, steps: {}, incomplete: 'steady state unreachable' },
      [{ jobname: 'prune', command: 'select app_public.prune()', schedule: '0 * * * *' }], () => 1);
    expect(unmeasuredJobs).toEqual(['prune']);
    expect(summary).toMatchObject({ perSet: null, idleHour: null, incomplete: 'steady state unreachable' });
  });
});

describe('Tier 2 summary', () => {
  const level = (loggers: number, sets: number, extra: Partial<Tier2LevelInput> = {}): Tier2LevelInput => ({
    loggers, setsPushed: sets, pushFailures: 0,
    counters: {
      statements: { pages: 1000 * sets, tempBytes: 0, walBytes: 10 * sets },
      byFunction: { group_metric_eval_publish: { calls: sets }, group_eval_requeue_rules: { calls: sets }, notification_workout_prepare: { calls: 2 * sets } },
      appRowsWritten: 30 * sets, walBytes: 100 * sets, deadlocks: 0,
      edgeResponses: { groupEval: { requeued: 0, failed: 0 }, timedOut: 0, failed: 0 },
    },
    latencyMs: { p50: 300, p95: 500, max: 600, unpublished: 0 },
    lockWaits: { waitingSamples: 0, maxWaiting: 0 },
    ...extra,
  });
  const idle = { perHour: { statements: { pages: 50000 }, byFunction: { notification_workout_prepare: { calls: 12 } },
    appRowsWritten: 1750, platformRowsWritten: 44, walBytes: 1_900_000 }, forcedArchivesPerHour: 12 };

  test('per-set figures divide the window by the sets pushed', () => {
    expect(summarizeLevel(level(5, 4))).toMatchObject({ pagesPerSet: 1000, walPerSet: 100, appRowsPerSet: 30,
      evaluationsPerSet: 1, edgeRunsPerSet: 3, wastedEvaluations: 0 });
    expect(summarizeLevel(level(1, 0)).pagesPerSet).toBeNull();
  });

  test('assertions catch wasted evaluations, lock waits, slow or missing publication and idle writes', () => {
    const bad = summarizeLevel(level(10, 5, {
      counters: { ...level(10, 5).counters, edgeResponses: { groupEval: { requeued: 2, failed: 1 }, timedOut: 1, failed: 0 } },
      latencyMs: { p50: 9000, p95: 12000, max: 15000, unpublished: 1 }, lockWaits: { waitingSamples: 3, maxWaiting: 2 },
    }));
    const results = Object.fromEntries(tier2Assertions([summarizeLevel(level(1, 2)), bad], idle).map((a) => [a.id, a]));
    expect(results['load-wasted-evaluations']).toMatchObject({ pass: false, observed: '3' });
    expect(results['load-lock-waits'].pass).toBe(false);
    expect(results['load-latency']).toMatchObject({ pass: false, observed: 'worst p95 12000 ms, 1 unpublished' });
    expect(results['idle-real-app-rows']).toMatchObject({ pass: false, observed: '1750 rows/h' });
    expect(tier2Assertions([], null).every((a) => a.pass === null)).toBe(true);
  });

  test('the Tier 2 summary has a row per level and the projected idle hour', () => {
    const levels = [summarizeLevel(level(1, 2))];
    const markdown = tier2Markdown({ members: 10, historyDays: 28, sets: 2799 }, levels, idle, tier2Assertions(levels, idle));
    expect(markdown).toContain('M=10, H=28 days, 2799 sets');
    expect(markdown).toContain('| 1 | 2 | 1000 | 100 | 30.0 | 0 | 1.00 | 3.00 | 0 | 0 | 300/500/600 | 0 | 0 | 0 |');
    expect(markdown).toContain('| projected | 50.0k | 1750 | 44 | 1.90M | 12 | 12 |');
    expect(tier2Markdown({ members: 1, historyDays: 7, sets: 1 }, [], null, [])).not.toContain('Real idle hour');
  });
});
