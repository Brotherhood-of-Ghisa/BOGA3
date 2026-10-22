/** @jest-environment node */
// The groups performance harness's helpers: cron rates, the fixture's SQL
// and its guards, the RPC statement builder, the scenario completeness rule
// and the load run's pure pieces. The live lanes are groups-perf and
// groups-perf-load.
import crypto from 'node:crypto';

import { cronMinutes, runsPerHour } from '../scripts/perf/groups/cron';
import { FIXTURE_EXERCISES, FIXTURE_SPLITS, fixtureStatements, validateFixtureSpec } from '../scripts/perf/groups/fixture';
import { rpcCall } from '../scripts/perf/groups/session';
import { pushEntities, scenarioIncomplete, type StepResult } from '../scripts/perf/groups/tier1';
import { forcedArchivesPerHour, mintToken, percentile, scaleWindow, statementFunction, type WindowCounters } from '../scripts/perf/groups/tier2';

describe('cron rates', () => {
  test.each([
    ['*/5 * * * *', 12],
    ['0 * * * *', 1],
    ['0,30 * * * *', 2],
    ['10-19 * * * *', 10],
    ['0 3 * * *', 1 / 24],
    ['0 3 * * 1', 1 / 168],
    ['0 3 * * 0,7', 1 / 168],
    ['30 seconds', 120],
    ['10 seconds', 360],
  ])('%s runs %d times an hour', (schedule, expected) => {
    expect(runsPerHour(schedule)).toBeCloseTo(expected, 9);
  });

  test.each(['0 0 1 * *', '* * * 1 *', 'every minute', '*/0 * * * *'])('%s is not modelled and throws', (schedule) => {
    expect(() => runsPerHour(schedule)).toThrow();
  });

  test('cronMinutes lists the minutes past the hour a schedule fires in', () => {
    expect(cronMinutes('*/20 * * * *')).toEqual([0, 20, 40]);
    expect(cronMinutes('5 * * * *')).toEqual([5]);
    expect(cronMinutes('10 seconds')).toHaveLength(60);
  });

  test('forced archives count the distinct 2-minute windows holding a WAL write', () => {
    expect(forcedArchivesPerHour(cronMinutes('*/5 * * * *'))).toBe(12);
    expect(forcedArchivesPerHour([0, 1, 2, 3])).toBe(2);
    expect(forcedArchivesPerHour([])).toBe(0);
  });
});

describe('fixture', () => {
  test('three exercises are linked, one of them bodyweight-aware, and every split has five blocks of known exercises', () => {
    expect(FIXTURE_EXERCISES.filter((e) => e.linked).map((e) => e.name)).toEqual(['Bench press', 'Back squat', 'Pull-up']);
    expect(FIXTURE_EXERCISES.filter((e) => e.bodyweight > 0).map((e) => e.name)).toEqual(['Pull-up']);
    for (const split of [0, 1, 2]) {
      const blocks = FIXTURE_SPLITS.filter(([s]) => s === split);
      expect(blocks.map(([, block]) => block)).toEqual([0, 1, 2, 3, 4]);
      for (const [, , ex] of blocks) expect(FIXTURE_EXERCISES.some((e) => e.ex === ex)).toBe(true);
    }
  });

  test('statements carry the spec: members, every-other-day sessions over H days, membership before the history', () => {
    const sql = fixtureStatements({ members: 7, historyDays: 56, tag: 'abc1' }).join(';\n');
    expect(sql).toContain('generate_series(1,7)');
    expect(sql).toContain('generate_series(0,55) d where (d+m.idx)%2=0');
    expect(sql).toContain("interval '86 days'");
    expect(sql).toContain("'abc1'::text as tag");
    expect(sql).toContain('generate_series(0,8) w');
    expect(sql).toContain('generate_series(0,2+(s.n+p.block+s.idx)%3) k');
  });

  test.each([
    [{ members: 0, historyDays: 28, tag: 'a' }, 'members'],
    [{ members: 101, historyDays: 28, tag: 'a' }, 'members'],
    [{ members: 2.5, historyDays: 28, tag: 'a' }, 'members'],
    [{ members: 2, historyDays: 6, tag: 'a' }, 'history'],
    [{ members: 2, historyDays: 28, tag: "x'; drop table" }, 'tag'],
    [{ members: 2, historyDays: 28, tag: '' }, 'tag'],
  ])('an invalid spec is rejected before any SQL is built: %o', (spec, field) => {
    expect(() => validateFixtureSpec(spec)).toThrow(field);
    expect(() => fixtureStatements(spec)).toThrow(field);
  });
});

describe('rpcCall', () => {
  test('names every argument and serializes objects as JSON', () => {
    expect(rpcCall('sync_push', { entities: [{ id: 'a' }] })).toEqual({
      sql: 'app_public.sync_push(entities => $1)', params: ['[{"id":"a"}]'],
    });
    expect(rpcCall('group_eval_complete', { p_job_id: 1, p_generation: 2, p_facts: null })).toEqual({
      sql: 'app_public.group_eval_complete(p_job_id => $1, p_generation => $2, p_facts => $3)', params: [1, 2, null],
    });
    expect(rpcCall('group_eval_sweep', {}).sql).toBe('app_public.group_eval_sweep()');
  });

  test.each([['bad;name', {}], ['ok', { 'p_x); drop': 1 }], ['Upper', {}]])('rejects identifier %s', (fn, args) => {
    expect(() => rpcCall(fn, args)).toThrow('invalid');
  });
});

test('push entities have the wire shape sync_push takes', () => {
  expect(pushEntities.session('s', 10, 11)).toEqual({ type: 'sessions', id: 's', client_updated_at_ms: 11,
    fields: { gym_id: null, status: 'active', started_at: 10, completed_at: null, duration_sec: null, created_at: 10, updated_at: 11, deleted_at: null } });
  expect(pushEntities.block('b', 's', 5, 2, 'Pull-up', 12).fields).toMatchObject({ session_id: 's', exercise_definition_id: 'perf-def-5', order_index: 2 });
  expect(pushEntities.set('x', 'b', 0, '50', '8', 13).fields).toMatchObject({ set_type: 'warm_up', weight_value: '50', performance_status: null });
  expect(pushEntities.set('x', 'b', 1, '80', '5', 13).fields.set_type).toBe('rir_2');
});

describe('scenarioIncomplete', () => {
  const ok = { groupEvalRuns: 2, leftoverJobs: 0, failures: [] };
  const step = (label: string, extra: Partial<StepResult> = {}) => ({
    label, calls: [{ fn: 'sync_push', error: null }], cascadeCapped: false, ...extra,
  }) as unknown as StepResult;

  test('a clean steady state and clean steps are complete', () => {
    expect(scenarioIncomplete(ok, { a: step('a') })).toBeNull();
  });

  test('a statement timeout, failed or leftover jobs, a failed call or a runaway cascade each make it incomplete', () => {
    expect(scenarioIncomplete({ ...ok, failures: ['metric job 1: canceling statement due to statement timeout'] }, {}))
      .toBe('steady state unreachable: a publication exceeded the statement timeout');
    expect(scenarioIncomplete({ ...ok, leftoverJobs: 3 }, {})).toBe('steady state unreachable: 0 failed jobs, 3 left');
    expect(scenarioIncomplete(ok, { a: step('logged_set', { calls: [{ fn: 'group_metric_eval_publish', error: '57014' }] } as never) }))
      .toBe('failed calls: logged_set:group_metric_eval_publish:57014');
    expect(scenarioIncomplete(ok, { a: step('logged_set', { cascadeCapped: true }) })).toBe('kick cascade did not settle: logged_set');
  });
});

describe('load run helpers', () => {
  test('mintToken signs an authenticated app token with the stack secret', () => {
    const token = mintToken('11111111-1111-1111-1111-111111111111', 'secret', 1000);
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
      sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated', aud: 'authenticated', iat: 1000, exp: 4600,
    });
    expect(signature).toBe(crypto.createHmac('sha256', 'secret').update(`${header}.${payload}`).digest('base64url'));
  });

  test.each([
    ['WITH pgrst_source AS (SELECT "app_public"."group_metric_eval_publish"("p_job_id" := $1) )', 'group_metric_eval_publish'],
    ['select app_public.group_eval_sweep()', 'group_eval_sweep'],
    ['SELECT name FROM vault.secrets', 'other'],
  ])('statementFunction(%s) is %s', (query, expected) => {
    expect(statementFunction(query)).toBe(expected);
  });

  test('percentile is nearest-rank over the sorted values', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });

  test('scaleWindow multiplies every counter', () => {
    const window: WindowCounters = {
      durationMs: 10, statements: { calls: 1, pages: 2, tempBytes: 3, walBytes: 4, execMs: 5 },
      byFunction: { f: { calls: 1, pages: 2, tempBytes: 3, walBytes: 4, execMs: 5 } },
      appRowsWritten: 6, appTables: { 'app_public.a': 6 }, platformRowsWritten: 7, walBytes: 8, deadlocks: 0,
      edgeResponses: { groupEval: { responses: 1, claimed: 2, metricClaimed: 1, completed: 1, requeued: 0, failed: 0 },
        notificationWorker: 1, timedOut: 0, failed: 0 },
      cronRuns: { sweep: 6 },
    };
    const hour = scaleWindow(window, 2);
    expect(hour).toMatchObject({ durationMs: 20, appRowsWritten: 12, appTables: { 'app_public.a': 12 }, walBytes: 16, cronRuns: { sweep: 12 } });
    expect(hour.statements.pages).toBe(4);
    expect(hour.byFunction.f.calls).toBe(2);
    expect(hour.edgeResponses.groupEval.claimed).toBe(4);
  });
});

describe('runPlan', () => {
  const { runPlan } = jest.requireActual('../scripts/perf/groups/cli') as typeof import('../scripts/perf/groups/cli');
  const plan = { history: { members: 4, days: [14, 28, 56] }, members: { days: 28, members: [2, 4, 8, 16] } };

  test('runs every point once, the shared one included', async () => {
    const ran: string[] = [];
    const results = await runPlan(plan, async (members, days) => {
      ran.push(`${members}x${days}`);
      return { name: `m${members}-h${days}d`, incomplete: null } as never;
    });
    expect(ran).toEqual(['4x14', '4x28', '4x56', '2x28', '8x28', '16x28']);
    expect(results).toHaveLength(6);
  });

  test('after a point fails, the larger points of its sweep are skipped, naming the point that failed', async () => {
    const ran: string[] = [];
    const results = await runPlan(plan, async (members, days) => {
      ran.push(`${members}x${days}`);
      return { name: `m${members}-h${days}d`, incomplete: members === 2 || days === 28 ? 'unreachable' : null } as never;
    });
    expect(ran).toEqual(['4x14', '4x28', '2x28']);
    const reasons = Object.fromEntries(results.map((r) => [r.name, r.incomplete]));
    expect(reasons).toMatchObject({
      'm4-h56d': 'skipped: m4-h28d did not complete',
      'm8-h28d': 'skipped: m2-h28d did not complete',
      'm16-h28d': 'skipped: m2-h28d did not complete',
    });
  });
});
