/** @jest-environment ./jest.node-environment.js */
// The groups performance harness's publish parity: every comparison
// publication runs the old and new definitions from the same state, and their
// results, row writes and published rows must match. Pure, over a fake
// session; the live check runs in lane groups-perf.
import type { Rpc } from '../scripts/perf/groups/group-eval-mirror';
import {
  canonicalSnapshot,
  PUBLISH_PARITY_CASE,
  PUBLISH_SNAPSHOT_SQL,
  PublishParity,
  publishRunDifference,
  TABLE_WRITES_SQL,
  writesBetween,
  type PublishRun,
} from '../scripts/perf/groups/publish-parity';
import { parityPassed } from '../scripts/perf/groups/parity';

describe('publish parity helpers', () => {
  test('a run’s writes are the per-table difference, and untouched tables are left out', () => {
    expect(writesBetween({ 'app_public.a': [1, 2, 3], 'app_public.b': [5, 0, 0] },
      { 'app_public.a': [4, 2, 3], 'app_public.b': [5, 0, 0], 'app_public.c': [0, 1, 0] }))
      .toEqual({ 'app_public.a': [3, 0, 0], 'app_public.c': [0, 1, 0] });
  });

  test('event ids anywhere in a snapshot compare by stream position, and the id map is dropped', () => {
    const snapshot = {
      event_ids: { '00000000-0000-4000-8000-000000000001': 1, '00000000-0000-4000-8000-000000000002': 2 },
      events: [{ position: 2, related: 1, payload: { voided: '00000000-0000-4000-8000-000000000001',
        nested: ['00000000-0000-4000-8000-000000000002', 'other'] } }],
    };
    expect(canonicalSnapshot(snapshot)).toEqual({
      events: [{ position: 2, related: 1, payload: { voided: '#event:1', nested: ['#event:2', 'other'] } }],
    });
    // Two runs that wrote the same events under different ids are equal.
    const [x, y] = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
    expect(canonicalSnapshot({ event_ids: { [x]: 1 }, a: [x] })).toEqual(canonicalSnapshot({ event_ids: { [y]: 1 }, a: [y] }));
  });

  test('ids embedded in strings become positions, and best evidence, ordered by such a string, compares as a set', () => {
    const [x, y, z] = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c'];
    const old = { event_ids: { [x]: 1, [y]: 2 }, targets: [{ best_evidence: [{ identity: `${x}:f1` }, { identity: `${y}:f2` }], other: [`${z}:k`] }] };
    const live = { event_ids: { [y]: 1, [x]: 2 }, targets: [{ best_evidence: [{ identity: `${x}:f2` }, { identity: `${y}:f1` }], other: [`${z}:k`] }] };
    expect(canonicalSnapshot(old)).toEqual({ targets: [{ best_evidence: [{ identity: '#event:1:f1' }, { identity: '#event:2:f2' }], other: [`${z}:k`] }] });
    expect(canonicalSnapshot(live)).toEqual(canonicalSnapshot(old));
  });

  test('two runs differ by error, then result, then writes, then state', () => {
    const run = (extra: Partial<PublishRun> = {}): PublishRun => ({ result: { completed: true }, error: null, state: { s: 1 }, writes: {}, ...extra });
    expect(publishRunDifference(run(), run())).toBeNull();
    expect(publishRunDifference(run(), run({ error: 'P0001 moved' }))).toBe('error: none ≠ P0001 moved');
    expect(publishRunDifference(run(), run({ result: { completed: false } }))).toBe('result.completed: true ≠ false');
    expect(publishRunDifference(run(), run({ writes: { 'app_public.t': [1, 0, 0] } }))).toBe('writes.app_public.t: missing ≠ present');
    expect(publishRunDifference(run(), run({ state: { s: 2 } }))).toBe('state.s: 1 ≠ 2');
  });

  test('the publisher’s case installs its old helpers first, renamed into pg_temp, and its plant matches once', () => {
    const parity = new PublishParity({ exec: async () => [] });
    const sql = parity.installStatements();
    expect(sql.map((statement) => /create (?:or replace )?function pg_temp\.([a-z_]+)\(/.exec(statement)?.[1])).toEqual([
      'group_metric_eval_source_graph__legacy',
      'group_metric_eval_publish_without_notifications__legacy',
      'group_metric_eval_publish__legacy',
      'group_metric_eval_publish__planted',
    ]);
    for (const statement of sql) {
      expect(statement).not.toMatch(/\b(app_public\.)?group_metric_eval_source_graph\(/);
      expect(statement).not.toMatch(/\b(app_public\.)?group_metric_eval_publish_without_notifications\(/);
    }
    expect(sql[3]).toContain(PUBLISH_PARITY_CASE.plant!.to);
    expect(sql[2]).not.toContain(PUBLISH_PARITY_CASE.plant!.to);
  });

  test('the plant changes a stored row, not the result, so only the database comparison can catch it', () => {
    const { from, to } = PUBLISH_PARITY_CASE.plant!;
    expect(from).toMatch(/^update notification_comparison_publications set /);
    expect(`${from} ${to}`).not.toMatch(/\breturn\b/);
    const sql = new PublishParity({ exec: async () => [] }).installStatements();
    const returns = (statement: string) => statement.match(/^\s*return .*$/gm);
    expect(returns(sql[3])).toEqual(returns(sql[2]));
  });
});

/**
 * A session whose state is a counter of rows each publication wrote: a fake
 * savepoint stack restores it, so each run starts from the same state.
 */
const fakeSession = () => {
  const log: string[] = [];
  let state = { rows: 0, digest: 'd' };
  const saved: Record<string, typeof state> = {};
  let writes = 0;
  const exec = async <T>(sql: string): Promise<T[]> => {
    const savepoint = /^(savepoint|rollback to savepoint|release savepoint) (\w+)$/.exec(sql);
    if (savepoint) {
      log.push(savepoint[1]);
      if (savepoint[1] === 'savepoint') saved[savepoint[2]] = { ...state };
      if (savepoint[1] === 'rollback to savepoint') state = { ...saved[savepoint[2]] };
      return [];
    }
    if (sql === TABLE_WRITES_SQL) return [{ writes: { 'app_public.group_metric_set_scores': [writes, 0, 0] } }] as T[];
    if (sql === PUBLISH_SNAPSHOT_SQL) return [{ snapshot: { event_ids: {}, ...state } }] as T[];
    throw new Error(`unexpected statement: ${sql}`);
  };
  const publisher = (name: string, rows: number, digest = 'd') => {
    log.push(name);
    state = { rows: state.rows + rows, digest };
    writes += rows;
    return { completed: true, scores: rows };
  };
  return { exec, log, publisher };
};

describe('PublishParity.wrap', () => {
  const args = { p_job_id: 7, p_generation: 1, p_claim_id: 'c', p_evaluation: {} };

  test('other calls pass straight through', async () => {
    const session = fakeSession();
    const rpc = jest.fn(async () => 'other') as unknown as Rpc;
    const parity = new PublishParity(session);
    await expect(parity.wrap(rpc, rpc)('group_metric_eval_prepare', args)).resolves.toBe('other');
    expect(session.log).toEqual([]);
    expect(parity.outcome.compared).toBe(0);
  });

  test('old, planted and live each run from the same state; equal runs pass once the plant is told apart', async () => {
    const session = fakeSession();
    const live = (async (name: string) => session.publisher(name, 2)) as Rpc;
    const unmeasured = (async (name: string) => session.publisher(name, 2, name.endsWith('__planted') ? 'planted' : 'd')) as Rpc;
    const parity = new PublishParity(session);
    const wrapped = parity.wrap(live, unmeasured);
    await expect(wrapped('group_metric_eval_publish', args)).resolves.toEqual({ completed: true, scores: 2 });
    expect(session.log).toEqual(['savepoint', 'pg_temp.group_metric_eval_publish__legacy', 'rollback to savepoint',
      'pg_temp.group_metric_eval_publish__planted', 'rollback to savepoint', 'group_metric_eval_publish', 'release savepoint']);
    // The plant was told apart, so the next call runs old and live only.
    await wrapped('group_metric_eval_publish', args);
    expect(session.log.slice(7)).toEqual(['savepoint', 'pg_temp.group_metric_eval_publish__legacy', 'rollback to savepoint',
      'group_metric_eval_publish', 'release savepoint']);
    expect(parity.outcome).toEqual({ fn: 'group_metric_eval_publish', compared: 2, differences: [], plantDetected: true, error: null });
    expect(parityPassed(parity.outcome)).toBe(true);
  });

  test('a live run that writes differently, or fails where the old one did not, is a difference; its failure reaches the caller', async () => {
    const session = fakeSession();
    const unmeasured = (async (name: string) => session.publisher(name, 2)) as Rpc;
    let calls = 0;
    const live = (async (name: string) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error(`${name}: notification capture source moved`), { sqlstate: 'P0001' });
      return session.publisher(name, 3);
    }) as Rpc;
    const parity = new PublishParity(session);
    const wrapped = parity.wrap(live, unmeasured);
    await wrapped('group_metric_eval_publish', args);
    await expect(wrapped('group_metric_eval_publish', args)).rejects.toThrow('notification capture source moved');
    expect(parity.outcome.differences).toEqual([
      'call #1 (job 7): result.scores: 2 ≠ 3',
      'call #2 (job 7): error: none ≠ P0001 notification capture source moved',
    ]);
    expect(parity.outcome.plantDetected).toBe(false);
    expect(parityPassed(parity.outcome)).toBe(false);
  });
});
