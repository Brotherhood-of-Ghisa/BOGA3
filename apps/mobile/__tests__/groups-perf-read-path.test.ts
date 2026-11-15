/** @jest-environment ./jest.node-environment.js */
// The groups performance harness's strict read-path set: its budget checks,
// that each group read, evaluator write and notification RPC it budgets has a
// scenario and a budget, and the parity helper that proves a rewritten RPC
// returns the same JSON. Pure; the live lane is groups-perf.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  compareParity,
  definitionFromMigration,
  definitionPath,
  helperParityStatements,
  jsonDifference,
  legacyDefinition,
  migrationDefinition,
  missingOutcomes,
  parityInstallStatements,
  PARITY_MAX_PAGES,
  parityPassed,
  plantDifference,
  streamWalk,
  type ParityCase,
} from '../scripts/perf/groups/parity';
import {
  notificationParityCases,
  NOTIFICATION_STATE_SQL,
  SCENARIOS,
  scenarioStatements,
  type NotificationFixture,
} from '../scripts/perf/groups/notification-parity';
import {
  cowResultsWalk,
  HELPER_PARITY_CASES,
  PARITY_CASES,
  PARITY_DAYS,
  PARITY_PLANT_STATEMENTS,
  plantedAll,
  pointCost,
  READ_PATH_DAYS,
  READ_PATH_RPCS,
  readPathBudgets,
  summarizeReadPath,
  warmUp,
  type ReadPathContext,
  type ReadPathPoint,
} from '../scripts/perf/groups/read-path';
import {
  baselineEntries,
  checkBudget,
  checkBudgets,
  historySlope,
  PAGE_CEILING,
  readPathMarkdown,
  suggestBudget,
  type BudgetEntry,
  type PointCost,
} from '../scripts/perf/groups/read-path-budgets';
import { emptyCounters } from '../scripts/perf/groups/counters';

const cost = (historyDays: number, pages: number, extra: Partial<PointCost> = {}): PointCost => ({
  historyDays, calls: 1, pages, tempBytes: 0, seqScans: 0, error: null, ...extra,
});
const levels = (checks: { level: string }[]) => checks.map((check) => check.level);

describe('budget checks', () => {
  const budgeted: BudgetEntry = { kind: 'budgeted', pages: 1000, scoped: true };
  const baseline: BudgetEntry = { kind: 'baseline', pages: 90000, scoped: true };

  test('a call within its budget at every point passes', () => {
    expect(levels(checkBudget('f', budgeted, [cost(90, 800), cost(180, 900)]))).toEqual(['pass']);
  });

  test('a call over its budget fails, whatever its kind', () => {
    expect(checkBudget('f', budgeted, [cost(90, 900), cost(180, 1001)])).toEqual([
      { fn: 'f', level: 'fail', message: 'H=180: 1001 pages per call, over its budget of 1000' }]);
    expect(levels(checkBudget('f', baseline, [cost(90, 80000), cost(180, 90001)]))).toContain('fail');
  });

  test('a budgeted scoped RPC growing over 1.2x per doubling of history fails', () => {
    const checks = checkBudget('f', budgeted, [cost(90, 500), cost(180, 650)]);
    expect(checks).toEqual([{ fn: 'f', level: 'fail', message: 'grows 1.30× per doubling of history, over 1.2×' }]);
    expect(levels(checkBudget('f', budgeted, [cost(90, 500), cost(180, 600)]))).toEqual(['pass']);
  });

  test('a slope is not asserted while every point stays within 100 pages, where noise moves it', () => {
    expect(levels(checkBudget('f', budgeted, [cost(90, 9), cost(180, 11)]))).toEqual(['pass']);
    expect(levels(checkBudget('f', budgeted, [cost(90, 60), cost(180, 101)]))).toEqual(['fail']);
  });

  test('a baseline slope only warns, and an unscoped slope is not checked', () => {
    expect(checkBudget('f', baseline, [cost(90, 30000), cost(180, 80000)])).toEqual([
      { fn: 'f', level: 'warn', message: 'grows 2.67× per doubling of history (baseline: reported, not asserted)' }]);
    expect(levels(checkBudget('f', { ...budgeted, scoped: false }, [cost(90, 300), cost(180, 900)]))).toEqual(['pass']);
  });

  test('a budgeted entry over the ceiling fails without a justification and passes with one', () => {
    const over: BudgetEntry = { kind: 'budgeted', pages: PAGE_CEILING + 1, scoped: false };
    expect(checkBudget('f', over, [cost(180, 10)])).toEqual([
      { fn: 'f', level: 'fail', message: 'budget 5001 pages is over the 5000-page ceiling without a justification' }]);
    expect(levels(checkBudget('f', { ...over, justification: '  ' }, [cost(180, 10)]))).toEqual(['fail']);
    expect(levels(checkBudget('f', { ...over, justification: 'a background job, never on a screen' }, [cost(180, 10)]))).toEqual(['pass']);
    expect(levels(checkBudget('f', { ...baseline, pages: PAGE_CEILING * 20 }, [cost(180, 10)]))).toEqual(['pass']);
  });

  test('a failed, missing or unbudgeted measurement fails', () => {
    expect(checkBudget('f', budgeted, [cost(90, 0, { error: '57014' })])).toEqual([{ fn: 'f', level: 'fail', message: 'H=90: 57014' }]);
    expect(checkBudget('f', budgeted, [cost(90, 0, { calls: 0 })])).toEqual([{ fn: 'f', level: 'fail', message: 'H=90: no call measured' }]);
    expect(levels(checkBudget('f', budgeted, []))).toEqual(['fail']);
    expect(checkBudget('f', undefined, [cost(90, 1)])).toEqual([{ fn: 'f', level: 'fail', message: 'measured but has no budget entry' }]);
    expect(checkBudgets({ f: budgeted, g: budgeted }, { f: [cost(90, 1)] })).toContainEqual(
      { fn: 'g', level: 'fail', message: 'has a budget but no scenario' });
  });

  test('the slope runs from the smallest to the largest usable point', () => {
    expect(historySlope([cost(180, 400), cost(90, 100)])).toBeCloseTo(4, 9);
    expect(historySlope([cost(90, 100), cost(180, 0, { error: 'x' })])).toBeNull();
    expect(historySlope([cost(90, 100)])).toBeNull();
  });

  test('a suggested budget adds ~25%, rounds up to two significant figures and leaves a small cost 10 pages', () => {
    expect(suggestBudget(0)).toBe(10);
    expect(suggestBudget(8)).toBe(20);
    expect(suggestBudget(17)).toBe(30);
    expect(suggestBudget(282)).toBe(360);
    expect(suggestBudget(146618)).toBe(190000);
    expect(suggestBudget(3654108)).toBe(4600000);
    expect(suggestBudget(3200)).toBe(4000);
  });

  test('the table lists every RPC with its verdict and names the entries still baseline', () => {
    const budgets = { a: budgeted, b: baseline };
    const measured = { a: [cost(90, 100), cost(180, 100)], b: [cost(90, 1), cost(180, 0, { error: '57014' })] };
    const markdown = readPathMarkdown(budgets, measured, [90, 180], checkBudgets(budgets, measured));
    expect(markdown).toContain('| a | budgeted, scoped | 1000 | 100 | 0 | 0 | 100 | 0 | 0 | 1.00× | PASS |');
    expect(markdown).toContain('| b | baseline, scoped | 90.0k | 1 | 0 | 0 | error 57014 | — | — | — | FAIL |');
    expect(markdown).toContain('Still `baseline` (later work converts them to `budgeted`): b.');
    expect(baselineEntries(budgets)).toEqual(['b']);
  });
});

describe('the group read, evaluator write and notification RPCs the lane budgets are each measured', () => {
  /** The group read RPCs, the evaluator's write RPCs and the notification RPCs whose cost the lane holds. */
  const SURFACE_RPCS = [
    'group_competition_stream_v5', 'group_competition_stream_v4', 'group_competition_stream_v3', 'group_competition_stream_v2',
    'group_competition_period_totals', 'group_competition_week_summary', 'group_competition_podiums', 'group_competition_board',
    'group_competition_records_history', 'group_competition_session_detail', 'group_competition_session_records',
    'group_cow_summary', 'group_cow_previous_summary', 'group_cow_calendar_get',
    'group_list_mine', 'group_get', 'group_competition_exercise_list',
    'group_metric_eval_publish', 'group_metric_eval_prepare', 'group_eval_complete',
    'notification_workout_enqueue', 'notification_workout_prepare', 'notification_begin_send', 'notification_confirm_completion',
  ];

  test('each has exactly one scenario and a budget entry, and nothing else is measured', () => {
    expect(READ_PATH_RPCS.map((rpc) => rpc.fn).sort()).toEqual([...SURFACE_RPCS].sort());
    expect(Object.keys(readPathBudgets()).sort()).toEqual([...SURFACE_RPCS].sort());
  });

  test('every member call has arguments, and every cascade RPC is one its worker calls', () => {
    const workers = ['../scripts/perf/groups/group-eval-mirror.ts', '../../../supabase/functions/notification-worker/handler.ts']
      .map((file) => readFileSync(path.resolve(__dirname, file), 'utf8')).join('\n');
    for (const rpc of READ_PATH_RPCS) {
      if (rpc.via === 'member') expect(rpc.args).toBeDefined();
      else expect(workers).toContain(`'${rpc.fn}'`);
    }
  });

  test('every budget is a positive page count, and a budgeted entry over the ceiling says why', () => {
    for (const rpc of READ_PATH_RPCS) {
      expect(rpc.budget.pages).toBeGreaterThan(0);
      if (rpc.budget.kind === 'budgeted' && rpc.budget.pages > PAGE_CEILING) expect(rpc.budget.justification?.trim()).toBeTruthy();
    }
  });

  test('the set measures two history points, smallest first', () => {
    expect(READ_PATH_DAYS).toEqual([90, 180]);
  });
});

describe('warm reads', () => {
  test('each read is called once, unmeasured, inside a savepoint that is rolled back, before any is measured', async () => {
    const log: string[] = [];
    const session = {
      exec: async (sql: string) => { log.push(sql); return []; },
      call: async (_caller: unknown, fn: string, _args: Record<string, unknown>, measured: boolean) => {
        log.push(`${fn}:${measured ? 'measured' : 'unmeasured'}`);
        if (fn === 'b') throw new Error('refused');
        return null;
      },
    } as unknown as Parameters<typeof warmUp>[0];
    const reads = ['a', 'b'].map((fn) => ({ fn, via: 'member' as const, args: () => ({}),
      budget: { kind: 'budgeted' as const, pages: 10, scoped: true } }));
    await warmUp(session, { role: 'authenticated', userId: 'u', sessionId: 's' }, reads, {} as ReadPathContext);
    expect(log).toEqual(['savepoint perf_warm_up', 'a:unmeasured', 'b:unmeasured',
      'rollback to savepoint perf_warm_up', 'release savepoint perf_warm_up']);
  });
});

describe('read-path results', () => {
  const point = (historyDays: number, extra: Partial<ReadPathPoint> = {}): ReadPathPoint => ({
    name: `p${historyDays}`, members: 5, historyDays, fixture: { members: 5, sessions: 1, sets: 1 }, plants: {}, calls: {},
    errors: {}, cascade: null, walPerLoggedSet: 1, parity: [], incomplete: null, setupMs: 0, ...extra,
  });
  const record = (pages: number, error: string | null = null) => ({ fn: 'f', counters: { ...emptyCounters(), calls: 1, pages }, error });

  test('an RPC costs its costliest call; a failed or missing call has no cost', () => {
    expect(pointCost(90, [record(10), record(30), record(20)])).toMatchObject({ calls: 3, pages: 30, error: null });
    expect(pointCost(90, [record(10), record(0, '57014')])).toMatchObject({ pages: 0, error: '57014' });
    expect(pointCost(90, undefined)).toMatchObject({ calls: 0, error: 'not called' });
  });

  test('an incomplete point, a failed parity case or no parity at all fails the set', () => {
    const rpcs = [{ fn: 'f', via: 'member' as const, args: () => ({}), budget: { kind: 'baseline' as const, pages: 100, scoped: true } }];
    const passing = { fn: 'f', compared: 2, differences: [], plantDetected: true, error: null };
    const ok = summarizeReadPath([point(90, { calls: { f: [record(50)] }, parity: [passing] }), point(180, { calls: { f: [record(60)] } })], rpcs);
    expect(ok.failures).toEqual([]);
    expect(ok.markdown).toContain('PASS parity f: 2 calls compared, 0 differences, planted difference detected');
    const broken = summarizeReadPath([
      point(90, { calls: { f: [record(50)] }, parity: [{ ...passing, differences: ['viewer v, arguments #0: $.a: 1 ≠ 2'] }] }),
      point(180, { incomplete: 'planted cases missing: voided_record' }),
    ], rpcs);
    expect(broken.failures).toEqual([
      'p180: planted cases missing: voided_record',
      'f: H=180: incomplete: planted cases missing: voided_record',
      'parity f: viewer v, arguments #0: $.a: 1 ≠ 2',
    ]);
    expect(summarizeReadPath([point(90, { calls: { f: [record(50)] } })], rpcs).failures).toEqual(['parity: no case ran']);
  });

  test('a parity case whose calls never returned a required outcome fails, and the table shows the outcomes it saw', () => {
    const rpcs = [{ fn: 'f', via: 'member' as const, args: () => ({}), budget: { kind: 'baseline' as const, pages: 100, scoped: true } }];
    const blind = { fn: 'f', compared: 3, differences: [], plantDetected: null, error: null, observed: { true: 3 }, missing: ['false'] };
    const result = summarizeReadPath([point(90, { calls: { f: [record(50)] }, parity: [blind] }), point(180, { calls: { f: [record(60)] } })], rpcs);
    expect(result.failures).toEqual(['parity f: no call returned false']);
    expect(result.markdown).toContain('FAIL parity f: 3 calls compared, 0 differences, no plant, outcomes {"true":3}');
  });
});

describe('parity helper', () => {
  const SQL = `-- earlier
create function app_public.f(p_a int) returns jsonb language sql as $$ select jsonb_build_object('a', p_a) $$;
create or replace function app_public.f(p_a int) returns jsonb
language plpgsql set search_path=app_public,pg_temp as $body$
begin
  return jsonb_build_object('a', app_public.helper(p_a), 'b', helper(1), 'c', ';');
end $body$;
revoke all on function app_public.f(int) from public;`;

  test('the last definition is extracted through its closing statement, whatever its dollar tag', () => {
    const definition = definitionFromMigration(SQL, 'f');
    expect(definition.startsWith('create or replace function app_public.f(p_a int)')).toBe(true);
    expect(definition.endsWith('end $body$;')).toBe(true);
    expect(definitionFromMigration(SQL.split('\n').slice(0, 2).join('\n'), 'f')).toBe(
      "create function app_public.f(p_a int) returns jsonb language sql as $$ select jsonb_build_object('a', p_a) $$;");
    expect(() => definitionFromMigration(SQL, 'g')).toThrow('no definition of app_public.g');
    expect(definitionFromMigration("create function app_public.f() returns int as $$ select 1 $$ language sql stable;\nrevoke all on function app_public.f() from public;", 'f'))
      .toBe('create function app_public.f() returns int as $$ select 1 $$ language sql stable;');
    expect(() => definitionFromMigration(SQL, 'f(); drop')).toThrow('invalid function name');
  });

  test('a saved pg_get_functiondef text, with no closing semicolon, installs; a following statement is never taken', () => {
    const saved = `CREATE OR REPLACE FUNCTION app_public.f(p_a integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'app_public', 'pg_temp'
AS $function$
begin return jsonb_build_object('a', p_a); end $function$
`;
    const definition = definitionFromMigration(saved, 'f');
    expect(definition.endsWith('end $function$;')).toBe(true);
    expect(legacyDefinition(definition, 'f', 'f__legacy').startsWith('create function pg_temp.f__legacy(p_a integer)')).toBe(true);
    expect(definitionFromMigration(`${saved}\ngrant execute on function app_public.f(integer) to authenticated;`, 'f'))
      .toBe(definition);
    expect(() => definitionFromMigration("create function app_public.f() returns int as $$ select 1 $$ language sql set search_path = '';", 'f'))
      .toThrow('not a plain clause');
    // Long word runs after the body are read in linear time, never by backtracking.
    const words = ' language plpgsql stable security definer set search_path = public;';
    const started = Date.now();
    expect(() => definitionFromMigration(`create function app_public.f() returns int as $$ select 1 $$${words.repeat(20)}`, 'f'))
      .toThrow('not a plain clause');
    expect(definitionFromMigration(`create function app_public.f() returns int as $$ select 1 $$\n${'CREATE OR REPLACE FUNCTION app_public.group_cow_redacts_exercise('.repeat(20)}`, 'f'))
      .toBe('create function app_public.f() returns int as $$ select 1 $$;');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('the legacy copy is renamed into pg_temp and can call old helpers', () => {
    const legacy = legacyDefinition(definitionFromMigration(SQL, 'f'), 'f', 'f__legacy', { helper: 'helper__legacy' });
    expect(legacy.startsWith('create function pg_temp.f__legacy(p_a int)')).toBe(true);
    expect(legacy).toContain("'a', pg_temp.helper__legacy(p_a), 'b', pg_temp.helper__legacy(1)");
    expect(() => legacyDefinition('select 1', 'f', 'f__legacy')).toThrow('not a definition');
  });

  test('a plant replaces exactly one occurrence', () => {
    expect(plantDifference("'a', 1", "'a'", "'z'")).toBe("'z', 1");
    expect(() => plantDifference("'a', 'a'", "'a'", "'z'")).toThrow('exactly once');
    expect(() => plantDifference("'a'", "'b'", "'z'")).toThrow('exactly once');
  });

  test('a one-field JSON difference is found by path; identical JSON, in any key order, is equal', () => {
    const value = { members: [{ rank: 1, member: { user_id: 'u' }, working_sets: 4 }], group_id: 'g' };
    expect(jsonDifference(value, JSON.parse(JSON.stringify(value)))).toBeNull();
    expect(jsonDifference({ b: 1, a: [1, 2] }, { a: [1, 2], b: 1 })).toBeNull();
    expect(jsonDifference(value, { ...value, members: [{ ...value.members[0], rank: 2 }] })).toBe('$.members[0].rank: 1 ≠ 2');
    expect(jsonDifference({ a: 1 }, { a: 1, b: null })).toBe('$.b: missing ≠ present');
    expect(jsonDifference([1, 2], [2, 1])).toBe('$[0]: 1 ≠ 2');
    expect(jsonDifference([1], [1, 2])).toBe('$: 1 items ≠ 2 items');
    expect(jsonDifference({ a: 1 }, { a: '1' })).toBe('$.a: number ≠ string');
    expect(jsonDifference(null, {})).toBe('$: null ≠ object');
  });

  type Context = { args: Record<string, unknown>[] };
  const item: ParityCase<Context> = { fn: 'f', migration: 'm', argumentSets: (context) => context.args, plant: { from: 'a', to: 'b' } };
  const installed = { legacy: 'f__legacy', planted: 'f__planted' };

  test('identical definitions pass for every viewer and argument set, and the plant is detected', async () => {
    const calls: string[] = [];
    const outcome = await compareParity(item, { args: [{ p: 1 }, { p: 2 }] }, ['v1', 'v2'], async (viewer, fn, args) => {
      calls.push(`${viewer}:${fn}:${String(args.p)}`);
      return { p: args.p, planted: fn.endsWith('__planted') };
    }, installed);
    expect(outcome).toEqual({ fn: 'f', compared: 4, differences: [], plantDetected: true, error: null });
    expect(parityPassed(outcome)).toBe(true);
    expect(calls).toContain('v2:pg_temp.f__legacy:2');
  });

  test('a one-field difference in the old definition is reported, and an undetected plant fails', async () => {
    const outcome = await compareParity(item, { args: [{ p: 1 }] }, ['v1'], async (_viewer, fn) =>
      ({ value: fn === 'pg_temp.f__legacy' ? 1 : 2 }), installed);
    expect(outcome.differences).toEqual(['viewer v1, arguments #0: $.value: 1 ≠ 2']);
    expect(parityPassed(outcome)).toBe(false);
    const blind = await compareParity(item, { args: [{ p: 1 }] }, ['v1'], async () => ({ same: true }), installed);
    expect(blind).toMatchObject({ differences: [], plantDetected: false });
    expect(parityPassed(blind)).toBe(false);
    expect(parityPassed({ ...blind, plantDetected: null, compared: 0 })).toBe(false);
  });

  test('every registered case installs from its migration: renamed into pg_temp, its plant matching once', () => {
    expect(PARITY_CASES.length).toBeGreaterThan(0);
    for (const parityCase of PARITY_CASES) {
      const { legacy, planted, sql } = parityInstallStatements(parityCase);
      expect(Boolean(sql.at(-2)?.startsWith(`create or replace function pg_temp.${legacy}(`))).toBe(parityCase.plant !== undefined);
      expect(sql.at(-1)?.startsWith(`create or replace function pg_temp.${planted ?? legacy}(`)).toBe(true);
      expect(sql.at(-1)).not.toContain(`app_public.${parityCase.fn}(`);
    }
    expect(migrationDefinition('20261008120000_group_competition_v4_only.sql', 'group_competition_week_summary'))
      .toMatch(/^create or replace function app_public\.group_competition_week_summary\(/);
    expect(() => migrationDefinition('../secrets.sql', 'f')).toThrow('invalid definition source');
  });

  test('a paged case walks each definition by its own cursor to the end, and a moved page boundary is a difference', async () => {
    const paged: ParityCase<Context> = { fn: 'f', migration: 'm', argumentSets: (context) => context.args, walk: streamWalk };
    // Three items, two per page.
    const items = ['a', 'b', 'c'];
    const page = (args: Record<string, unknown>) => {
      const start = args.p_before === null ? 0 : Number(args.p_before);
      const more = start + 2 < items.length;
      return { items: items.slice(start, start + 2), has_more: more, next_cursor: more ? String(start + 2) : null };
    };
    const calls: string[] = [];
    const outcome = await compareParity(paged, { args: [{ p_before: null }] }, ['v1'], async (_viewer, fn, args) => {
      calls.push(`${fn}:${String(args.p_before)}`);
      return page(args);
    }, { legacy: 'f__legacy', planted: null });
    expect(calls).toEqual(['f:null', 'pg_temp.f__legacy:null', 'f:2', 'pg_temp.f__legacy:2']);
    expect(outcome).toMatchObject({ compared: 2, differences: [] });
    // The old definition's pages differ; only the owner is compared.
    const moved = await compareParity({ ...paged, calls: () => [{ viewer: 'owner', args: { p_before: null } }] }, { args: [] }, ['v1', 'v2'],
      async (_viewer, fn, args) => (fn === 'f' ? page(args) : { ...page(args), items: ['x'] }), { legacy: 'f__legacy', planted: null });
    expect(moved.differences).toEqual([
      'viewer owner, arguments #0, page 0: $.items: 1 items ≠ 2 items',
      'viewer owner, arguments #0, page 1: $.items[0]: "x" ≠ "c"',
    ]);
  });

  test('a cursor that never ends is reported, and an ignored clock key is not compared', async () => {
    const endless: ParityCase<Context> = { fn: 'f', migration: 'm', argumentSets: (context) => context.args, walk: streamWalk };
    const outcome = await compareParity(endless, { args: [{ p_before: null }] }, ['v1'],
      async () => ({ has_more: true, next_cursor: 'again' }), { legacy: 'f__legacy', planted: null });
    expect(outcome.compared).toBe(PARITY_MAX_PAGES);
    expect(outcome.differences).toEqual([`viewer v1, arguments #0, page ${PARITY_MAX_PAGES - 1}: still paging after ${PARITY_MAX_PAGES} pages`]);
    const clocked: ParityCase<Context> = { fn: 'f', migration: 'm', argumentSets: (context) => context.args, ignoreKeys: ['observed_at_us'] };
    const read = await compareParity(clocked, { args: [{}] }, ['v1'], async (_viewer, fn) =>
      ({ observed_at_us: fn.length, value: 1 }), { legacy: 'f__legacy', planted: null });
    expect(read.differences).toEqual([]);
    expect(streamWalk({ p_limit: 1 }, { has_more: true, next_cursor: 'c' })).toEqual({ p_limit: 1, p_before: 'c' });
    expect(streamWalk({ p_limit: 1 }, { has_more: false, next_cursor: null })).toBeNull();
    expect(streamWalk({ p_limit: 1 }, null)).toBeNull();
  });

  test('every stream version walks every page against its old chain; the old SQL helpers install callees first', () => {
    const streams = PARITY_CASES.filter((item) => item.fn.startsWith('group_competition_stream'));
    expect(streams.map((item) => item.fn).sort()).toEqual([
      'group_competition_stream', 'group_competition_stream_v2', 'group_competition_stream_v3', 'group_competition_stream_v4',
      'group_competition_stream_v5', 'group_competition_stream_v5']);
    const context = { groupId: 'g', viewer: 'owner', members: ['owner', 'm2'] } as unknown as ReadPathContext;
    for (const item of streams) expect(item.walk).toBe(streamWalk);
    const limits = streams.flatMap((item) => [
      ...(item.argumentSets?.(context) ?? []).map((args) => `${item.fn}:${String(args.p_group_id)}:${String(args.p_limit)}:all`),
      ...(item.calls?.(context) ?? []).map((call) => `${item.fn}:${String(call.args.p_group_id)}:${String(call.args.p_limit)}:${call.viewer}`),
    ]);
    expect(limits.sort()).toEqual([
      'group_competition_stream:g:50:all',
      'group_competition_stream_v2:g:50:all', 'group_competition_stream_v2:null:50:all',
      'group_competition_stream_v3:g:50:all', 'group_competition_stream_v4:g:20:all', 'group_competition_stream_v4:g:50:all',
      'group_competition_stream_v4:g:5:all',
      'group_competition_stream_v5:g:1:owner', 'group_competition_stream_v5:g:20:all', 'group_competition_stream_v5:g:50:all',
      'group_competition_stream_v5:null:50:all']);
    expect(cowResultsWalk({ p_limit: 1 }, { rankings: [{ next_cursor: 'n' }] })).toEqual({ p_limit: 1, p_before: 'n' });
    expect(cowResultsWalk({ p_limit: 1 }, { rankings: [{ next_cursor: null }] })).toBeNull();
    expect(PARITY_CASES.find((item) => item.fn === 'group_cow_results')?.walk).toBe(cowResultsWalk);
    for (const item of PARITY_CASES) {
      const helpers = Object.keys(item.helpers ?? {});
      const { sql } = parityInstallStatements(item);
      helpers.forEach((helper, index) => {
        const later = helpers.slice(index + 1);
        if (!/\blanguage sql\b/i.test(sql[index])) return;
        for (const callee of later) expect(sql[index]).not.toContain(`pg_temp.${callee}__legacy(`);
      });
      for (const helper of helpers) expect(sql.at(-1)).not.toContain(`app_public.${helper}(`);
    }
  });

  test('a definition source is a migration, or a saved definition named after one under parity-definitions', () => {
    expect(definitionPath('20261008120000_group_competition_v4_only.sql'))
      .toBe(path.resolve(__dirname, '../../../supabase/migrations/20261008120000_group_competition_v4_only.sql'));
    expect(definitionPath('parity-definitions/20261008120000_group_competition_v4_only.sql'))
      .toBe(path.resolve(__dirname, '../scripts/perf/groups/parity-definitions/20261008120000_group_competition_v4_only.sql'));
    for (const source of ['parity-definitions/../x.sql', 'other/20261008120000_a.sql', '20261008120000_a.sql.bak', 'x.sql']) {
      expect(() => definitionPath(source)).toThrow('invalid definition source');
    }
  });
});

describe('helper parity', () => {
  test('an old helper several cases share is installed with or replace, and an old body calls it in pg_temp', () => {
    const shared = PARITY_CASES.filter((item) => item.helpers?.group_week_session_counts);
    expect(shared.map((item) => item.fn).sort()).toEqual(['group_competition_period_totals', 'group_competition_week_summary']);
    for (const item of shared) {
      const { legacy, sql } = parityInstallStatements(item);
      expect(sql[0].startsWith('create or replace function pg_temp.group_week_session_counts__legacy(')).toBe(true);
      const body = sql.find((statement) => statement.startsWith(`create or replace function pg_temp.${legacy}(`))!;
      expect(body).toContain('pg_temp.group_week_session_counts__legacy(');
      expect(body).not.toContain('app_public.group_week_session_counts(');
    }
  });

  test('an old-against-new case installs the old helpers and compares the pg_temp copy with the live function', () => {
    const { sql, compare } = helperParityStatements({
      name: 'outer', fn: 'group_competition_redacts_exercise', migration: 'parity-definitions/20261030064514_group_cow_readers.sql',
      helpers: { group_cow_redacts_exercise: '20261030064514_group_cow_readers.sql' },
      argumentsSql: 'select 1 as a1', call: '{fn}(a1)',
    });
    expect(sql).toHaveLength(2);
    expect(sql[0].startsWith('create or replace function pg_temp.group_cow_redacts_exercise__legacy(')).toBe(true);
    expect(sql[1].startsWith('create or replace function pg_temp.group_competition_redacts_exercise__legacy(')).toBe(true);
    expect(sql[1]).toContain('pg_temp.group_cow_redacts_exercise__legacy(p_groups,p_member,p_definition)');
    expect(compare).toContain('select (pg_temp.group_competition_redacts_exercise__legacy(a1)) as expected, '
      + '(app_public.group_competition_redacts_exercise(a1)) as actual');
    expect(compare).toContain('from (select 1 as a1) a');
  });

  test('the old copy may be installed again, and a bad function name is refused', () => {
    const item = HELPER_PARITY_CASES.find((entry) => 'fn' in entry && entry.fn === 'group_cow_redacts_exercise')!;
    const { sql } = helperParityStatements(item);
    expect(sql.at(-1)?.startsWith('create or replace function pg_temp.group_cow_redacts_exercise__legacy(')).toBe(true);
    expect(() => helperParityStatements({ name: 'x', fn: 'f(); drop', migration: 'm', argumentsSql: 'select 1', call: '{fn}()' }))
      .toThrow('invalid function name');
  });

  test('a check compares its two expressions and installs nothing', () => {
    const { sql, compare } = helperParityStatements({ name: 'check', argumentsSql: 'select 1 as a1', expected: 'a1', actual: 'a1 + 0' });
    expect(sql).toEqual([]);
    expect(compare).toContain('select (a1) as expected, (a1 + 0) as actual');
    expect(compare).toContain('count(distinct x.expected::text)::integer as answers');
    const redaction = HELPER_PARITY_CASES.filter((item) => item.name.includes('redact'));
    expect(redaction.map((item) => item.minAnswers)).toEqual([2, 2, 2, 2, 2]);
  });

  test('the redaction helpers, their cache and the session counts are each compared, every registered case installing', () => {
    expect(HELPER_PARITY_CASES.map((item) => item.name).sort()).toEqual([
      'group_competition_event_json', 'group_competition_event_json (cache)', 'group_competition_redaction_lookup (cache)',
      'group_competition_redactions',
      'group_competition_redacts_exercise', 'group_competition_session_card', 'group_competition_session_card (cache)',
      'group_competition_stream_record', 'group_competition_stream_record (cache)', 'group_competition_stream_withdrawn (cache)',
      'group_cow_redacts_exercise', 'group_cow_result_rows (cache)', 'group_cow_stream_item (cache)', 'group_week_session_counts',
      'notification_ranks_from_graph', 'notification_redaction_map']);
    for (const item of HELPER_PARITY_CASES) {
      const { sql, compare } = helperParityStatements(item);
      if ('fn' in item) expect(sql.at(-1)).toContain(`pg_temp.${item.fn}__legacy(`);
      expect(compare).toContain(item.argumentsSql);
    }
    const cache = HELPER_PARITY_CASES.find((item) => item.name === 'group_competition_redactions')!;
    expect(cache.argumentsSql).toContain('app_public.group_competition_redactions(');
  });

  test('every planted stale fact is edited under its owner\'s claims and must edit exactly one row; the claims are cleared after', () => {
    const statements = PARITY_PLANT_STATEMENTS();
    const edits = statements.filter((statement) => /\bupdate app_public\./.test(statement));
    expect(edits).toHaveLength(4);
    for (const edit of edits) {
      const before = statements[statements.indexOf(edit) - 1];
      expect(before).toContain("set_config('request.jwt.claims'");
      expect(edit).toMatch(/returning 1\)\s*select count\(\*\)=1 as planted from edited$/);
    }
    expect(statements.at(-1)).toContain("set_config('request.jwt.claims','',true)");
    const plants = statements.filter((statement) => !statement.startsWith('select set_config'));
    expect(plants).toHaveLength(6);
    for (const plant of plants) expect(plant).toMatch(/select count\(\*\)=[12] as planted from edited$/);
    expect(plantedAll([{ planted: true }])).toBe(true);
    expect(plantedAll([{ planted: false }])).toBe(false);
    expect(plantedAll([{ set_config: '' }])).toBe(true);
  });

  test('the period totals cases send only windows the RPC accepts, months back over the parity history', () => {
    const day = 86400000;
    const now = 1_800_000_000_000;
    const weeks = Array.from({ length: 6 }, (_, index) => ({ start_ms: now - (6 - index) * 7 * day, end_ms: now - (5 - index) * 7 * day }));
    const context = { groupId: 'g', weeks } as unknown as ReadPathContext;
    const sets = PARITY_CASES.find((item) => item.fn === 'group_competition_period_totals')!.argumentSets!(context);
    expect(sets).toHaveLength(weeks.length + 2);
    for (const { p_windows: windows } of sets as { p_windows: { start_ms: number; end_ms: number }[] }[]) {
      expect(windows.length).toBeGreaterThanOrEqual(1);
      expect(windows.length).toBeLessThanOrEqual(12);
      for (const window of windows) {
        expect(window.start_ms).toBeGreaterThanOrEqual(0);
        expect(window.end_ms).toBeGreaterThan(window.start_ms);
        expect(window.end_ms - window.start_ms).toBeLessThanOrEqual(32 * day);
      }
    }
    const months = (sets.at(-1) as { p_windows: { start_ms: number }[] }).p_windows;
    expect(Math.min(...months.map((window) => window.start_ms))).toBeLessThanOrEqual(now - PARITY_DAYS * day);
  });
});

describe('board, podiums, history and session parity cases', () => {
  const context = {
    groupId: 'g', exercises: ['x1', 'x2'], sessions: [{ member: 'm1', sessionId: 's1' }, { member: 'm2', sessionId: 's2' }],
  } as unknown as ReadPathContext;
  const caseFor = (fn: string) => PARITY_CASES.find((item) => item.fn === fn)!;

  test('each installs every old helper before the statement that calls it', () => {
    for (const fn of ['group_competition_podiums', 'group_competition_records_history', 'group_competition_session_detail',
      'group_competition_session_records']) {
      const { sql } = parityInstallStatements(caseFor(fn));
      const defined = new Set<string>();
      for (const statement of sql) {
        for (const [, called] of statement.matchAll(/pg_temp\.([a-z0-9_]+__legacy)\(/g)) {
          if (!statement.startsWith(`create or replace function pg_temp.${called}(`) && !statement.startsWith(`create function pg_temp.${called}(`)) {
            expect(defined.has(called)).toBe(true);
          }
        }
        const created = /create (?:or replace )?function pg_temp\.([a-z0-9_]+)\(/.exec(statement);
        if (created) defined.add(created[1]);
      }
    }
  });

  test('the board and history arguments cover every exercise, metric, scope and a short page', () => {
    for (const fn of ['group_competition_board', 'group_competition_records_history']) {
      const sets = caseFor(fn).argumentSets!(context) as { p_group_exercise_id: string; p_metric: string; p_certified: boolean; p_limit: number }[];
      expect(sets).toHaveLength(2 * 2 * 2 * 2);
      expect(new Set(sets.map((set) => set.p_group_exercise_id))).toEqual(new Set(context.exercises));
      expect(new Set(sets.map((set) => set.p_metric))).toEqual(new Set(['e1rm', 'volume']));
      expect(new Set(sets.map((set) => set.p_certified))).toEqual(new Set([true, false]));
      expect(sets.some((set) => set.p_limit <= 3)).toBe(true);
    }
  });

  test('the podium arguments cover both scopes and the session arguments every opened session', () => {
    expect(caseFor('group_competition_podiums').argumentSets!(context)).toEqual([
      { p_group_id: 'g', p_certified: true }, { p_group_id: 'g', p_certified: false }]);
    for (const fn of ['group_competition_session_detail', 'group_competition_session_records']) {
      expect(caseFor(fn).argumentSets!(context)).toEqual([
        { p_group_id: 'g', p_member_user_id: 'm1', p_session_id: 's1' }, { p_group_id: 'g', p_member_user_id: 'm2', p_session_id: 's2' }]);
    }
  });
});

describe('parity of calls that write, and of outcomes', () => {
  type Context = { args: Record<string, unknown>[] };
  const installed = { legacy: 'f__legacy', planted: null };

  test('exact calls replace the viewer × argument-set grid, and each live outcome is named', async () => {
    const item: ParityCase<Context> = {
      fn: 'f', migration: 'm',
      calls: () => [{ viewer: 'v1', args: { p: 1 } }, { viewer: 'v2', args: { p: 2 } }],
      observe: (live) => String((live as { ok: boolean }).ok), requires: ['true', 'false'],
    };
    const seen: string[] = [];
    const outcome = await compareParity(item, { args: [{ p: 9 }] }, ['ignored'], async (viewer, _fn, args) => {
      seen.push(viewer);
      return { ok: args.p === 1 };
    }, installed);
    expect(seen).toEqual(['v1', 'v1', 'v2', 'v2']);
    expect(outcome).toMatchObject({ compared: 2, observed: { true: 1, false: 1 }, missing: [], differences: [] });
    expect(parityPassed(outcome)).toBe(true);
  });

  test('a case whose live calls never returned a required outcome does not pass, whatever it compared', async () => {
    const item: ParityCase<Context> = {
      fn: 'f', migration: 'm', calls: () => [{ viewer: 'v', args: {} }],
      observe: () => 'refused', requires: ['refused', 'payload'],
    };
    const outcome = await compareParity(item, { args: [] }, [], async () => null, installed);
    expect(outcome.missing).toEqual(['payload']);
    expect(parityPassed(outcome)).toBe(false);
    expect(missingOutcomes(undefined, undefined)).toEqual([]);
    expect(missingOutcomes(['a', 'b'], { a: 2 })).toEqual(['b']);
  });
});

describe('notification parity cases', () => {
  const cases = notificationParityCases<{ notification: NotificationFixture | null }>();
  const named = (fn: string) => cases.find((item) => item.fn === fn)!;
  const fixture: NotificationFixture = {
    groupId: 'g1',
    workouts: [
      { member: 'm1', session: 's1', generation: 3, eligible: true, contributions: [], auth: 'a1', manifest: ['e1', 'e2'] },
      { member: 'm2', session: 's2', generation: 1, eligible: false, contributions: [], auth: 'a2', manifest: [] },
    ],
    sessions: [{ member: 'm1', session: 's1' }, { member: 'm3', session: 's3' }],
    deliveries: [{ id: 7, generation: 3, claim: 'c7' }],
    peerSet: { member: 'm4', set: "o'set" },
    ownSet: { member: 'm1', set: 'x0' },
  };
  const context = { notification: fixture };

  test('they cover the four RPCs and the two helpers they share, each from its saved pre-migration definition', () => {
    expect(cases.map((item) => item.fn)).toEqual([
      'notification_workout_ready', 'notification_context_digest', 'notification_workout_enqueue',
      'notification_workout_prepare', 'notification_begin_send', 'notification_confirm_completion']);
    for (const item of cases) {
      expect(item.migration.startsWith('parity-definitions/')).toBe(true);
      expect(migrationDefinition(item.migration, item.fn)).toContain(`app_public.${item.fn}(`);
    }
    expect(PARITY_CASES.map((item) => item.fn)).toEqual(expect.arrayContaining(cases.map((item) => item.fn)));
  });

  test('every old RPC calls the old helpers, never the new ones', () => {
    for (const fn of ['notification_workout_enqueue', 'notification_workout_prepare', 'notification_begin_send']) {
      const old = parityInstallStatements(named(fn)).sql.at(-1)!;
      expect(old).toContain('pg_temp.notification_workout_ready__legacy(');
      expect(old).not.toMatch(/app_public\.notification_workout_ready\(/);
    }
    const confirm = parityInstallStatements(named('notification_confirm_completion')).sql.at(-1)!;
    expect(confirm).toContain('pg_temp.notification_context_digest__legacy(');
    expect(confirm).not.toMatch(/app_public\.notification_context_digest\(/);
    const ready = parityInstallStatements(named('notification_workout_ready')).sql;
    expect(ready).toHaveLength(2);
    expect(ready[1]).toContain('pg_temp.notification_context_digest__legacy(');
    expect(parityInstallStatements(named('notification_context_digest')).sql).toHaveLength(1);
  });

  test('a helper several cases share installs the same text each time, so the runner can install it once', () => {
    const texts = cases.flatMap((item) => parityInstallStatements(item).sql).map((sql) => sql.replace(/^create function pg_temp\./, 'create or replace function pg_temp.')).filter((sql) => /function pg_temp\.notification_context_digest__legacy\(/.test(sql));
    expect(texts.length).toBeGreaterThan(1);
    expect(new Set(texts).size).toBe(1);
  });

  test('every RPC that writes compares what it changed, under a role its worker uses', () => {
    for (const fn of ['notification_workout_enqueue', 'notification_workout_prepare', 'notification_begin_send', 'notification_confirm_completion']) {
      expect(named(fn).state).toBe(NOTIFICATION_STATE_SQL);
    }
    expect(named('notification_workout_ready').state).toBeUndefined();
    expect(named('notification_workout_prepare').caller!('m1', context)).toEqual({ role: 'service_role' });
    expect(named('notification_workout_ready').caller!('m1', context)).toEqual({ role: 'postgres' });
    expect(named('notification_confirm_completion').caller!('m1', context)).toEqual({ role: 'authenticated', userId: 'm1', sessionId: 'a1' });
    expect(NOTIFICATION_STATE_SQL).toContain("-array['id','intent_id','lease_until'");
  });

  test('calls come from the fixture: every workout, the stale and invalid variants, every delivery', () => {
    expect(named('notification_workout_ready').calls!(context)).toHaveLength(2);
    expect(named('notification_context_digest').calls!(context).map((call) => call.args.p_session)).toEqual(['s1', 's2', 's3']);
    const enqueues = named('notification_workout_enqueue').calls!(context);
    expect(enqueues.map((call) => [call.args.p_generation, JSON.stringify(call.args.p_contributions)])).toEqual([
      [3, '[]'], [3, '[{"group_id":"g1","best_count":1,"rank_count":2}]'], [4, '[{"group_id":"g1","best_count":1,"rank_count":2}]'], [3, '[{}]']]);
    expect(named('notification_workout_prepare').calls!(context).map((call) => call.args.p_limit)).toEqual([20, 1, 0]);
    const sends = named('notification_begin_send').calls!(context);
    expect(sends.map((call) => call.args.p_claim_id)).toEqual(['c7', '00000000-0000-4000-8000-0000000000ff']);
    const confirmations = named('notification_confirm_completion').calls!(context);
    expect(confirmations.map((call) => (call.args.p_entities as unknown[]).length)).toEqual([2, 1, 2]);
    expect(confirmations.at(-1)!.args.p_session_id).toBe('s1-unknown');
    expect(() => named('notification_workout_ready').calls!({ notification: null })).toThrow('notification fixture was not read');
  });

  test('a case names what its live call returned, so one that always fails the same way cannot pass', () => {
    const observe = (fn: string, live: unknown) => named(fn).observe!(live);
    expect(observe('notification_workout_ready', { result: true })).toBe('true');
    expect(observe('notification_workout_enqueue', { error: '42 VALIDATION' })).toBe('error 42 VALIDATION');
    expect(observe('notification_workout_prepare', { result: { jobs: [{}] } })).toBe('jobs>0');
    expect(observe('notification_workout_prepare', { result: { jobs: [] } })).toBe('jobs=0');
    expect(observe('notification_begin_send', { result: null })).toBe('refused');
    expect(observe('notification_begin_send', { result: { token: 't' } })).toBe('payload');
    expect(observe('notification_confirm_completion', { result: { confirmed: true } })).toBe('confirmed=true');
    expect(observe('notification_confirm_completion', { result: { confirmed: false } })).toBe('confirmed=false');
    for (const item of cases.filter((candidate) => candidate.requires)) expect(item.requires!.length).toBeGreaterThan(1);
  });

  test('each scenario changes one fact of the fixture; base changes none, and ids are quoted', () => {
    expect(SCENARIOS[0]).toBe('base');
    expect(scenarioStatements('base', fixture)).toEqual([]);
    for (const scenario of SCENARIOS.slice(1)) expect(scenarioStatements(scenario, fixture).length).toBeGreaterThan(0);
    const edit = scenarioStatements('peer-set-edited', fixture);
    expect(edit).toHaveLength(3);
    expect(edit[1]).toContain("es.id='o''set'");
    expect(scenarioStatements('own-set-edited', fixture)[1]).toContain("owner_user_id='m1'");
    expect(scenarioStatements('final-ranks-stale', fixture)).toEqual(["update app_public.notification_workout_targets set final_ranks='[]'::jsonb"]);
    expect(scenarioStatements('unenqueued', fixture)[0]).toContain('enqueued_generation=0');
    for (const item of cases) for (const scenario of item.scenarios ?? []) expect(SCENARIOS).toContain(scenario);
  });
});
