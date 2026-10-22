// One Postgres connection holding the Tier 1 transaction. Every RPC runs the
// way PostgREST would run it (its role, claims and headers), inside a
// savepoint standing for its own production transaction: a failure rolls
// back that call only, per-transaction kick flags are cleared, and deferred
// constraints are fired before the call is counted. A measured call wraps
// the RPC in EXPLAIN (ANALYZE, BUFFERS, WAL) and diffs pg_stat_xact_user_tables
// around it, so every page, row and WAL byte it and its triggers cost is
// attributed to it.

import type { Client } from 'pg';

import {
  countersFromExplain,
  diffTables,
  emptyCounters,
  type Counters,
  type TableSnapshot,
} from './counters.ts';
import type { RpcFailure } from './group-eval-mirror.ts';

export type Caller =
  | { role: 'service_role' }
  | { role: 'postgres' }
  | { role: 'authenticated'; userId: string };

/** One measured RPC; `error` is its SQLSTATE when it failed (57014: the call budget). */
export type CallRecord = { fn: string; counters: Counters; error: string | null };

const NULL_RESULT = '<<perf:null>>';
const IDENT = /^[a-z_][a-z0-9_]*$/;

const SYNC_HEADERS = JSON.stringify({ 'x-boga-sync-protocol': '4', 'x-boga-group-contract': '4' });

const TABLE_SNAPSHOT_SQL = `select schemaname||'.'||relname as t, n_tup_ins::bigint as ins, n_tup_upd::bigint as upd,
  n_tup_del::bigint as del, coalesce(seq_scan,0)::bigint as seq, coalesce(idx_scan,0)::bigint as idx,
  coalesce(seq_tup_read,0)::bigint as seq_read
  from pg_stat_xact_user_tables where schemaname !~ '^pg_(temp|toast_temp)'`;

// Fires every pending deferred constraint, as COMMIT would, then puts the
// initially-deferred ones back so the next call defers as production does.
const flushFunctionSql = (deferred: string | null) => `create or replace function pg_temp.perf_flush() returns int
language plpgsql as $$
begin
  set constraints all immediate;
  ${deferred ? `set constraints ${deferred} deferred;` : ''}
  return 1;
end $$`;

const DEFERRED_CONSTRAINTS_SQL = `select string_agg(quote_ident(n.nspname)||'.'||quote_ident(c.conname), ',') as list
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.condeferred`;

const toParam = (value: unknown): unknown =>
  value === null || value === undefined ? null : typeof value === 'object' ? JSON.stringify(value) : value;

/** `app_public.fn(p_a => $1, …)` with its parameter values. */
export const rpcCall = (fn: string, args: Record<string, unknown>): { sql: string; params: unknown[] } => {
  if (!IDENT.test(fn)) throw new Error(`invalid function name: ${fn}`);
  const names = Object.keys(args);
  for (const name of names) if (!IDENT.test(name)) throw new Error(`invalid argument name: ${name}`);
  const sql = `app_public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(', ')})`;
  return { sql, params: names.map((name) => toParam(args[name])) };
};

const parseResult = (text: string): unknown => {
  if (text === NULL_RESULT) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export class Tier1Session {
  readonly records: CallRecord[] = [];
  private savepoints = 0;

  /**
   * `callBudgetMs` bounds every RPC: a harness budget that keeps a run finite,
   * not a hosted limit (wall-clock is machine-specific). Setup statements are
   * unbounded.
   */
  constructor(private readonly client: Client, private readonly callBudgetMs: number) {}

  async begin(): Promise<void> {
    await this.client.query('begin');
    await this.client.query('set local statement_timeout = 0');
    const deferred = await this.client.query(DEFERRED_CONSTRAINTS_SQL);
    await this.client.query(flushFunctionSql(deferred.rows[0].list as string | null));
  }

  async rollback(): Promise<void> {
    await this.client.query('rollback');
  }

  /** A plain statement outside any measurement (fixture, setup). */
  async exec<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  /** Drains records collected since the last take (one step's calls). */
  take(): CallRecord[] {
    return this.records.splice(0, this.records.length);
  }

  async call<T>(caller: Caller, fn: string, args: Record<string, unknown>, measured: boolean): Promise<T> {
    const { sql, params } = rpcCall(fn, args);
    const savepoint = `perf_call_${(this.savepoints += 1)}`;
    await this.client.query(`savepoint ${savepoint}`);
    try {
      await this.enter(caller);
      await this.client.query(`set local statement_timeout = '${this.callBudgetMs}ms'`);
      let counters = emptyCounters();
      let before: TableSnapshot = {};
      if (measured) {
        before = await this.tables();
        const explain = await this.client.query(
          `explain (analyze, buffers, wal, timing off, format json)
           select set_config('perf.result', coalesce((${sql})::text, '${NULL_RESULT}'), true)`,
          params,
        );
        counters = countersFromExplain(explain.rows[0]['QUERY PLAN']);
      } else {
        await this.client.query(`select set_config('perf.result', coalesce((${sql})::text, '${NULL_RESULT}'), true)`, params);
      }
      if (measured) counters.tables = diffTables(before, await this.tables());
      await this.client.query('reset role');
      // Deferred constraint checks (a few index probes per pushed row) run
      // here, unmeasured: their cost does not depend on history or group size.
      await this.client.query('select pg_temp.perf_flush()');
      await this.client.query('set local statement_timeout = 0');
      if (measured) this.records.push({ fn, counters, error: null });
      const result = await this.client.query("select current_setting('perf.result') as r");
      await this.client.query(`release savepoint ${savepoint}`);
      return parseResult(result.rows[0].r as string) as T;
    } catch (error) {
      await this.client.query(`rollback to savepoint ${savepoint}`);
      await this.client.query('reset role');
      await this.client.query('set local statement_timeout = 0');
      const sqlstate = (error as { code?: string }).code ?? null;
      if (measured) this.records.push({ fn, counters: emptyCounters(), error: sqlstate ?? 'ERROR' });
      const failure = new Error(`${fn}: ${(error as Error).message}`) as RpcFailure;
      failure.sqlstate = sqlstate ?? undefined;
      throw failure;
    }
  }

  private async enter(caller: Caller): Promise<void> {
    const claims = caller.role === 'authenticated'
      ? JSON.stringify({ sub: caller.userId, role: 'authenticated', aud: 'authenticated' })
      : caller.role === 'service_role' ? JSON.stringify({ role: 'service_role' }) : '';
    await this.client.query(
      `select set_config('app.group_eval_kicked','',true), set_config('boga.notification_kicked','',true),
         set_config('request.jwt.claims',$1,true), set_config('request.jwt.claim.sub',$2,true),
         set_config('request.headers',$3,true)`,
      [claims, caller.role === 'authenticated' ? caller.userId : '', caller.role === 'authenticated' ? SYNC_HEADERS : '{}'],
    );
    if (caller.role !== 'postgres') await this.client.query(`set role ${caller.role}`);
  }

  private async tables(): Promise<TableSnapshot> {
    const { rows } = await this.client.query(TABLE_SNAPSHOT_SQL);
    const snapshot: TableSnapshot = {};
    for (const row of rows) {
      snapshot[row.t as string] = {
        ins: Number(row.ins), upd: Number(row.upd), del: Number(row.del),
        seqScan: Number(row.seq), idxScan: Number(row.idx), seqTupRead: Number(row.seq_read),
      };
    }
    return snapshot;
  }
}
