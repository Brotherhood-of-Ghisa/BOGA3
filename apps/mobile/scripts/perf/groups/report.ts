// The harness report: headline metrics per scenario, the slope of each when
// history (H) or members (M) doubles, and report-only scaling assertions.
// Pure: the runners hand it measured results, it computes and formats.

import { isAppTable, rowsWritten, scans, sumCounters, type Counters } from './counters.ts';

export type StepMetrics = {
  pages: number;
  pagesRead: number;
  rowsWritten: number;
  appRowsWritten: number;
  walBytes: number;
  tempBytes: number;
  writeTransactions: number;
  seqScans: number;
  seqTuplesRead: number;
  idxScans: number;
  edgeRuns: number;
  claimedJobs: number;
  evaluations: number;
  rejectedPublishes: number;
  graphBytes: number;
  setsScored: number;
  /** Measured calls that failed; 57014 is the statement timeout. */
  failedCalls: number;
  elapsedMs: number;
};

export type MeasuredStep = {
  total: Counters;
  calls: { error?: string | null }[];
  edgeRuns: { groupEval: number; notificationWorker: number };
  groupEval: { claimed: number; graphBytes: number; setsScored: number };
  evaluations: number;
  rejectedPublishes: number;
};

export const stepMetrics = (step: MeasuredStep): StepMetrics => {
  const s = scans(step.total);
  return {
    pages: step.total.pages,
    pagesRead: step.total.pagesRead,
    rowsWritten: rowsWritten(step.total),
    appRowsWritten: rowsWritten(step.total, isAppTable),
    walBytes: step.total.walBytes,
    tempBytes: step.total.tempBytes,
    writeTransactions: step.total.writeTransactions,
    seqScans: s.seq,
    seqTuplesRead: s.seqTupRead,
    idxScans: s.idx,
    edgeRuns: step.edgeRuns.groupEval + step.edgeRuns.notificationWorker,
    claimedJobs: step.groupEval.claimed,
    evaluations: step.evaluations,
    rejectedPublishes: step.rejectedPublishes,
    graphBytes: step.groupEval.graphBytes,
    setsScored: step.groupEval.setsScored,
    failedCalls: step.calls.filter((call) => call.error).length,
    elapsedMs: step.total.elapsedMs,
  };
};

/** Scales every additive metric (an idle tick → an idle hour). */
export const scaleMetrics = (metrics: StepMetrics, factor: number): StepMetrics =>
  Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value * factor])) as StepMetrics;

export const addMetrics = (a: StepMetrics, b: StepMetrics): StepMetrics =>
  Object.fromEntries(Object.keys(a).map((key) => [key, a[key as keyof StepMetrics] + b[key as keyof StepMetrics]])) as StepMetrics;

export const combineSteps = (steps: readonly MeasuredStep[]): MeasuredStep => ({
  total: sumCounters(steps.map((step) => step.total)),
  calls: steps.flatMap((step) => step.calls),
  edgeRuns: {
    groupEval: steps.reduce((sum, step) => sum + step.edgeRuns.groupEval, 0),
    notificationWorker: steps.reduce((sum, step) => sum + step.edgeRuns.notificationWorker, 0),
  },
  groupEval: {
    claimed: steps.reduce((sum, step) => sum + step.groupEval.claimed, 0),
    graphBytes: steps.reduce((sum, step) => sum + step.groupEval.graphBytes, 0),
    setsScored: steps.reduce((sum, step) => sum + step.groupEval.setsScored, 0),
  },
  evaluations: steps.reduce((sum, step) => sum + step.evaluations, 0),
  rejectedPublishes: steps.reduce((sum, step) => sum + step.rejectedPublishes, 0),
});

/**
 * The ratio a metric changes by per doubling of x, between two points:
 * (v2/v1)^(1/log2(x2/x1)). 1.0 is flat, 2.0 is linear. Null when either value
 * is zero or missing: there is no slope through zero.
 */
export const perDoubling = (x1: number, v1: number, x2: number, v2: number): number | null => {
  if (!(x1 > 0 && x2 > x1) || !(v1 > 0) || !(v2 > 0)) return null;
  return (v2 / v1) ** (1 / Math.log2(x2 / x1));
};

export type ScenarioSummary = {
  name: string;
  members: number;
  historyDays: number;
  sets: number;
  perSet: StepMetrics | null;
  perSetUnlinked: StepMetrics | null;
  idleHour: StepMetrics | null;
  /** Why a scenario has no numbers: a measured call failed, or its budget ran out. */
  incomplete: string | null;
};

export type Slope = {
  sweep: 'history' | 'members';
  from: string;
  to: string;
  perSetPages: number | null;
  perSetWal: number | null;
  perSetRows: number | null;
  graphBytes: number | null;
  idlePages: number | null;
};

const sweepSlopes = (sweep: Slope['sweep'], points: readonly ScenarioSummary[], x: (s: ScenarioSummary) => number): Slope[] => {
  const sorted = [...points].sort((a, b) => x(a) - x(b));
  const slopes: Slope[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const [a, b] = [sorted[i - 1], sorted[i]];
    const slope = (pick: (s: ScenarioSummary) => number | undefined) => {
      const [va, vb] = [pick(a), pick(b)];
      return va === undefined || vb === undefined ? null : perDoubling(x(a), va, x(b), vb);
    };
    slopes.push({
      sweep, from: a.name, to: b.name,
      perSetPages: slope((s) => s.perSet?.pages),
      perSetWal: slope((s) => s.perSet?.walBytes),
      perSetRows: slope((s) => s.perSet?.rowsWritten),
      graphBytes: slope((s) => s.perSet?.graphBytes),
      idlePages: slope((s) => s.idleHour?.pages),
    });
  }
  return slopes;
};

export type SweepPlan = { history: { members: number; days: number[] }; members: { days: number; members: number[] } };

/** Slopes of the history sweep (members fixed) and the members sweep (history fixed). */
export const computeSlopes = (scenarios: readonly ScenarioSummary[], plan: SweepPlan): Slope[] => [
  ...sweepSlopes('history', scenarios.filter((s) => s.members === plan.history.members && plan.history.days.includes(s.historyDays)), (s) => s.historyDays),
  ...sweepSlopes('members', scenarios.filter((s) => s.historyDays === plan.members.days && plan.members.members.includes(s.members)), (s) => s.members),
];

export type Assertion = { id: string; description: string; observed: string; pass: boolean | null };

const worst = (values: (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
};

const ratioAssertion = (id: string, description: string, values: (number | null)[], limit: number): Assertion => {
  const max = worst(values);
  return { id, description, observed: max === null ? 'no data' : `worst ${max.toFixed(2)}× per doubling`, pass: max === null ? null : max < limit };
};

export const THRESHOLDS = {
  historyPagesPerDoubling: 1.1,
  historyWalPerDoubling: 1.1,
  membersPagesPerDoubling: 1.25,
  evaluationsPerSet: 1,
  idleAppRowsPerHour: 0,
  idlePagesPerHour: 1000,
} as const;

/** Tier 1 scaling assertions. Report-only: a failure is printed, never an exit code, unless --strict. */
export const tier1Assertions = (scenarios: readonly ScenarioSummary[], slopes: readonly Slope[]): Assertion[] => {
  const history = slopes.filter((s) => s.sweep === 'history');
  const members = slopes.filter((s) => s.sweep === 'members');
  const measured = scenarios.filter((s) => s.perSet !== null);
  const idle = scenarios.filter((s) => s.idleHour !== null);
  const maxOf = (values: number[]) => (values.length === 0 ? null : Math.max(...values));
  const evals = maxOf(measured.map((s) => s.perSet!.evaluations));
  const idleRows = maxOf(idle.map((s) => s.idleHour!.appRowsWritten));
  const idlePages = maxOf(idle.map((s) => s.idleHour!.pages));
  const incomplete = scenarios.filter((s) => s.incomplete !== null);
  return [
    ratioAssertion('history-pages', `doubling H changes per-set pages by < ${Math.round((THRESHOLDS.historyPagesPerDoubling - 1) * 100)}%`,
      history.map((s) => s.perSetPages), THRESHOLDS.historyPagesPerDoubling),
    ratioAssertion('history-wal', `doubling H changes per-set WAL by < ${Math.round((THRESHOLDS.historyWalPerDoubling - 1) * 100)}%`,
      history.map((s) => s.perSetWal), THRESHOLDS.historyWalPerDoubling),
    ratioAssertion('members-pages', `doubling M changes per-set pages by < ${Math.round((THRESHOLDS.membersPagesPerDoubling - 1) * 100)}%`,
      members.map((s) => s.perSetPages), THRESHOLDS.membersPagesPerDoubling),
    { id: 'evaluations-per-set', description: `≤ ${THRESHOLDS.evaluationsPerSet} comparison evaluation per logged set`,
      observed: evals === null ? 'no data' : `max ${evals}`, pass: evals === null ? null : evals <= THRESHOLDS.evaluationsPerSet },
    { id: 'idle-app-rows', description: 'an idle hour writes 0 app rows (app_public, public)',
      observed: idleRows === null ? 'no data' : `max ${Math.round(idleRows)} rows/h`, pass: idleRows === null ? null : idleRows <= THRESHOLDS.idleAppRowsPerHour },
    { id: 'idle-pages', description: `an idle hour touches < ${THRESHOLDS.idlePagesPerHour} pages`,
      observed: idlePages === null ? 'no data' : `max ${Math.round(idlePages)} pages/h`, pass: idlePages === null ? null : idlePages < THRESHOLDS.idlePagesPerHour },
    { id: 'scenarios-complete', description: 'every scenario completes within the hosted statement timeout and its budget',
      observed: incomplete.length === 0 ? 'all complete' : incomplete.map((s) => `${s.name}: ${s.incomplete}`).join('; '),
      pass: incomplete.length === 0 },
  ];
};

const fmt = (value: number | null | undefined, digits = 0): string => {
  if (value === null || value === undefined) return '—';
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}G`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(digits);
};
const ratio = (value: number | null): string => (value === null ? '—' : `${value.toFixed(2)}×`);

export const assertionLines = (assertions: readonly Assertion[]): string[] =>
  assertions.map((a) => `${a.pass === null ? 'SKIP' : a.pass ? 'PASS' : 'WARN'} ${a.id}: ${a.description} — ${a.observed}`);

/** The human summary: one row per scenario, one per slope, then the assertions. */
export const tier1Markdown = (scenarios: readonly ScenarioSummary[], slopes: readonly Slope[], assertions: readonly Assertion[]): string => {
  const lines = [
    '### Tier 1 — work per logged set and per idle hour',
    '',
    '| Scenario | M | H (days) | Sets | Pages/set | WAL/set | Rows/set | Temp/set | Seq scans/set | Evals/set | Edge runs/set | Graph bytes/set | Unlinked set pages | Idle pages/h | Idle app rows/h | Idle WAL/h | Idle Edge runs/h |',
    '| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
    ...scenarios.map((s) => `| ${s.name}${s.incomplete ? ` (${s.incomplete})` : ''} | ${s.members} | ${s.historyDays} | ${fmt(s.sets)} | ${fmt(s.perSet?.pages)} | ${fmt(s.perSet?.walBytes)} | ${fmt(s.perSet?.rowsWritten)} | ${fmt(s.perSet?.tempBytes)} | ${fmt(s.perSet?.seqScans)} | ${fmt(s.perSet?.evaluations)} | ${fmt(s.perSet?.edgeRuns)} | ${fmt(s.perSet?.graphBytes)} | ${fmt(s.perSetUnlinked?.pages)} | ${fmt(s.idleHour?.pages)} | ${fmt(s.idleHour?.appRowsWritten)} | ${fmt(s.idleHour?.walBytes)} | ${fmt(s.idleHour?.edgeRuns)} |`),
    '',
    'Slope = ratio per doubling, (v2/v1)^(1/log2(x2/x1)): 1.00× flat, 2.00× linear.',
    '',
    '| Sweep | From → to | Pages/set | WAL/set | Rows/set | Graph bytes | Idle pages/h |',
    '| --- | --- | --: | --: | --: | --: | --: |',
    ...slopes.map((s) => `| ${s.sweep} | ${s.from} → ${s.to} | ${ratio(s.perSetPages)} | ${ratio(s.perSetWal)} | ${ratio(s.perSetRows)} | ${ratio(s.graphBytes)} | ${ratio(s.idlePages)} |`),
    '',
    ...assertionLines(assertions).map((line) => `- ${line}`),
  ];
  return `${lines.join('\n')}\n`;
};

// ---------------------------------------------------------------------------
// Tier 1 scenario → summary, with idle ticks scaled by each cron job's rate.

/** Which measured idle step stands for each pg_cron job, by the function its command calls. */
export const IDLE_STEPS: Record<string, string> = {
  group_eval_sweep: 'idle_group_eval_sweep',
  notification_sweep: 'idle_notification_sweep',
};

export type CronJob = { jobname: string; command: string; schedule: string };

export type Tier1ScenarioInput = {
  name: string;
  members: number;
  historyDays: number;
  fixture: { sets: number };
  steps: Record<string, MeasuredStep>;
  incomplete: string | null;
};

export const summarizeTier1 = (
  scenario: Tier1ScenarioInput, jobs: readonly CronJob[], perHour: (schedule: string) => number,
): { summary: ScenarioSummary; unmeasuredJobs: string[] } => {
  const unmeasuredJobs: string[] = [];
  let idleHour: StepMetrics | null = null;
  for (const job of jobs) {
    const fn = Object.keys(IDLE_STEPS).find((name) => job.command.includes(name));
    const step = fn ? scenario.steps[IDLE_STEPS[fn]] : undefined;
    if (!step) {
      unmeasuredJobs.push(job.jobname);
      continue;
    }
    const hour = scaleMetrics(stepMetrics(step), perHour(job.schedule));
    idleHour = idleHour ? addMetrics(idleHour, hour) : hour;
  }
  const metric = (label: string) => (scenario.steps[label] ? stepMetrics(scenario.steps[label]) : null);
  return {
    summary: {
      name: scenario.name, members: scenario.members, historyDays: scenario.historyDays, sets: scenario.fixture.sets,
      perSet: metric('logged_set'), perSetUnlinked: metric('logged_set_unlinked'), idleHour, incomplete: scenario.incomplete,
    },
    unmeasuredJobs,
  };
};

// ---------------------------------------------------------------------------
// Tier 2: per concurrency level, per logged set; the real idle hour.

export type Tier2LevelInput = {
  loggers: number;
  setsPushed: number;
  pushFailures: number;
  counters: {
    statements: { pages: number; tempBytes: number; walBytes: number };
    byFunction: Record<string, { calls: number }>;
    appRowsWritten: number;
    walBytes: number;
    deadlocks: number;
    edgeResponses: { groupEval: { requeued: number; failed: number }; timedOut: number; failed: number };
  };
  latencyMs: { p50: number | null; p95: number | null; max: number | null; unpublished: number };
  lockWaits: { waitingSamples: number; maxWaiting: number };
};

export type Tier2LevelSummary = {
  loggers: number;
  sets: number;
  pushFailures: number;
  pagesPerSet: number | null;
  walPerSet: number | null;
  appRowsPerSet: number | null;
  tempPerSet: number | null;
  evaluationsPerSet: number | null;
  edgeRunsPerSet: number | null;
  wastedEvaluations: number;
  edgeTimeouts: number;
  latencyMs: Tier2LevelInput['latencyMs'];
  lockWaitSamples: number;
  maxLockWaiters: number;
  deadlocks: number;
};

const calls = (level: Tier2LevelInput, fn: string) => level.counters.byFunction[fn]?.calls ?? 0;

export const summarizeLevel = (level: Tier2LevelInput): Tier2LevelSummary => {
  const per = (value: number) => (level.setsPushed > 0 ? value / level.setsPushed : null);
  const edgeRuns = calls(level, 'group_eval_requeue_rules') + calls(level, 'notification_workout_prepare');
  return {
    loggers: level.loggers,
    sets: level.setsPushed,
    pushFailures: level.pushFailures,
    pagesPerSet: per(level.counters.statements.pages),
    walPerSet: per(level.counters.walBytes),
    appRowsPerSet: per(level.counters.appRowsWritten),
    tempPerSet: per(level.counters.statements.tempBytes),
    evaluationsPerSet: per(calls(level, 'group_metric_eval_publish')),
    edgeRunsPerSet: per(edgeRuns),
    wastedEvaluations: level.counters.edgeResponses.groupEval.requeued + level.counters.edgeResponses.groupEval.failed,
    edgeTimeouts: level.counters.edgeResponses.timedOut,
    latencyMs: level.latencyMs,
    lockWaitSamples: level.lockWaits.waitingSamples,
    maxLockWaiters: level.lockWaits.maxWaiting,
    deadlocks: level.counters.deadlocks,
  };
};

export type IdleHourInput = {
  perHour: {
    statements: { pages: number };
    byFunction: Record<string, { calls: number }>;
    appRowsWritten: number;
    platformRowsWritten: number;
    walBytes: number;
  };
  forcedArchivesPerHour: number;
};

export const idleEdgeRuns = (idle: IdleHourInput): number =>
  (idle.perHour.byFunction.group_eval_requeue_rules?.calls ?? 0) + (idle.perHour.byFunction.notification_workout_prepare?.calls ?? 0);

export const tier2Assertions = (levels: readonly Tier2LevelSummary[], idle: IdleHourInput | null): Assertion[] => {
  const wasted = levels.reduce((sum, level) => sum + level.wastedEvaluations, 0);
  const waits = levels.reduce((sum, level) => sum + level.lockWaitSamples, 0);
  const p95 = levels.map((level) => level.latencyMs.p95).filter((value): value is number => value !== null);
  const worstP95 = p95.length === 0 ? null : Math.max(...p95);
  const unpublished = levels.reduce((sum, level) => sum + level.latencyMs.unpublished, 0);
  return [
    { id: 'load-wasted-evaluations', description: '0 requeued or failed evaluations under load',
      observed: `${wasted}`, pass: levels.length === 0 ? null : wasted === 0 },
    { id: 'load-lock-waits', description: '0 lock waits under load', observed: `${waits} waiting samples`, pass: levels.length === 0 ? null : waits === 0 },
    { id: 'load-latency', description: 'p95 enqueue → published < 10 s, every set published',
      observed: worstP95 === null ? 'no data' : `worst p95 ${Math.round(worstP95)} ms, ${unpublished} unpublished`,
      pass: worstP95 === null ? null : worstP95 < 10000 && unpublished === 0 },
    { id: 'idle-real-app-rows', description: 'a real idle hour writes 0 app rows (app_public, public)',
      observed: idle ? `${Math.round(idle.perHour.appRowsWritten)} rows/h` : 'no data', pass: idle ? idle.perHour.appRowsWritten === 0 : null },
    { id: 'idle-real-pages', description: `a real idle hour touches < ${THRESHOLDS.idlePagesPerHour} pages`,
      observed: idle ? `${Math.round(idle.perHour.statements.pages)} pages/h` : 'no data',
      pass: idle ? idle.perHour.statements.pages < THRESHOLDS.idlePagesPerHour : null },
  ];
};

export const tier2Markdown = (fixture: { members: number; historyDays: number; sets: number }, levels: readonly Tier2LevelSummary[],
  idle: IdleHourInput | null, assertions: readonly Assertion[]): string => {
  const ms = (value: number | null) => (value === null ? '—' : `${Math.round(value)}`);
  const lines = [
    `### Tier 2 — load run (M=${fixture.members}, H=${fixture.historyDays} days, ${fixture.sets} sets)`,
    '',
    '| Loggers | Sets | Pages/set | WAL/set | App rows/set | Temp/set | Evals/set | Edge runs/set | Wasted evals | Edge timeouts | Latency p50/p95/max (ms) | Unpublished | Lock-wait samples | Deadlocks |',
    '| --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- | --: | --: | --: |',
    ...levels.map((l) => `| ${l.loggers} | ${l.sets}${l.pushFailures ? ` (${l.pushFailures} failed)` : ''} | ${fmt(l.pagesPerSet)} | ${fmt(l.walPerSet)} | ${fmt(l.appRowsPerSet, 1)} | ${fmt(l.tempPerSet)} | ${fmt(l.evaluationsPerSet, 2)} | ${fmt(l.edgeRunsPerSet, 2)} | ${l.wastedEvaluations} | ${l.edgeTimeouts} | ${ms(l.latencyMs.p50)}/${ms(l.latencyMs.p95)}/${ms(l.latencyMs.max)} | ${l.latencyMs.unpublished} | ${l.lockWaitSamples} | ${l.deadlocks} |`),
    '',
  ];
  if (idle) {
    lines.push('| Real idle hour | Pages | App rows | Platform rows | WAL bytes | Edge runs | Forced 16 MB archives (archive_timeout=2min) |',
      '| --- | --: | --: | --: | --: | --: | --: |',
      `| projected | ${fmt(idle.perHour.statements.pages)} | ${fmt(idle.perHour.appRowsWritten)} | ${fmt(idle.perHour.platformRowsWritten)} | ${fmt(idle.perHour.walBytes)} | ${fmt(idleEdgeRuns(idle))} | ${idle.forcedArchivesPerHour} |`, '');
  }
  lines.push(...assertionLines(assertions).map((line) => `- ${line}`));
  return `${lines.join('\n')}\n`;
};
