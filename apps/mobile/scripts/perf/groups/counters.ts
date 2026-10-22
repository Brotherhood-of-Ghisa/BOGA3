// Portable work counters for the groups performance harness: buffer pages,
// rows, WAL, temp and scans mean the same thing on this Mac as on hosted
// Supabase. Wall-clock is carried along and never asserted.

export const PAGE_BYTES = 8192;

export type TableCounters = {
  ins: number;
  upd: number;
  del: number;
  seqScan: number;
  idxScan: number;
  seqTupRead: number;
};

export type Counters = {
  calls: number;
  /** Shared buffer pages touched: hit + read. The portable cost measure. */
  pages: number;
  pagesRead: number;
  pagesDirtied: number;
  tempBytes: number;
  walBytes: number;
  walRecords: number;
  /** Calls that wrote WAL: each is one write transaction in production. */
  writeTransactions: number;
  elapsedMs: number;
  tables: Record<string, TableCounters>;
};

export const emptyCounters = (): Counters => ({
  calls: 0,
  pages: 0,
  pagesRead: 0,
  pagesDirtied: 0,
  tempBytes: 0,
  walBytes: 0,
  walRecords: 0,
  writeTransactions: 0,
  elapsedMs: 0,
  tables: {},
});

const emptyTable = (): TableCounters => ({ ins: 0, upd: 0, del: 0, seqScan: 0, idxScan: 0, seqTupRead: 0 });

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

type PlanBuffers = Record<string, unknown>;

const blocks = (node: PlanBuffers | undefined, key: string): number => num(node?.[key]);

/**
 * Counters of one statement from `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT
 * JSON)`. The top plan node's buffers include everything its functions and
 * their triggers executed; planning buffers are added on top.
 */
export const countersFromExplain = (explain: unknown): Counters => {
  const root = (Array.isArray(explain) ? explain[0] : explain) as
    | { Plan?: PlanBuffers; Planning?: PlanBuffers; 'Execution Time'?: number; 'Planning Time'?: number }
    | undefined;
  if (!root?.Plan) throw new Error('EXPLAIN output has no plan');
  const plan = root.Plan;
  const planning = root.Planning;
  const pageKeys = ['Shared Hit Blocks', 'Shared Read Blocks'];
  const pages = pageKeys.reduce((sum, key) => sum + blocks(plan, key) + blocks(planning, key), 0);
  const tempBlocks = blocks(plan, 'Temp Written Blocks') + blocks(plan, 'Temp Read Blocks');
  const walBytes = blocks(plan, 'WAL Bytes');
  return {
    ...emptyCounters(),
    calls: 1,
    pages,
    pagesRead: blocks(plan, 'Shared Read Blocks') + blocks(planning, 'Shared Read Blocks'),
    pagesDirtied: blocks(plan, 'Shared Dirtied Blocks') + blocks(planning, 'Shared Dirtied Blocks'),
    tempBytes: tempBlocks * PAGE_BYTES,
    walBytes,
    walRecords: blocks(plan, 'WAL Records'),
    writeTransactions: walBytes > 0 ? 1 : 0,
    elapsedMs: num(root['Execution Time']) + num(root['Planning Time']),
  };
};

export type TableSnapshot = Record<string, TableCounters>;

/** Per-table deltas between two `pg_stat_xact_user_tables` snapshots; unchanged tables are dropped. */
export const diffTables = (before: TableSnapshot, after: TableSnapshot): Record<string, TableCounters> => {
  const out: Record<string, TableCounters> = {};
  for (const [table, end] of Object.entries(after)) {
    const start = before[table] ?? emptyTable();
    const delta: TableCounters = {
      ins: end.ins - start.ins,
      upd: end.upd - start.upd,
      del: end.del - start.del,
      seqScan: end.seqScan - start.seqScan,
      idxScan: end.idxScan - start.idxScan,
      seqTupRead: end.seqTupRead - start.seqTupRead,
    };
    if (Object.values(delta).some((value) => value !== 0)) out[table] = delta;
  }
  return out;
};

export const addCounters = (a: Counters, b: Counters): Counters => {
  const tables: Record<string, TableCounters> = { ...a.tables };
  for (const [table, delta] of Object.entries(b.tables)) {
    const base = tables[table] ?? emptyTable();
    tables[table] = {
      ins: base.ins + delta.ins,
      upd: base.upd + delta.upd,
      del: base.del + delta.del,
      seqScan: base.seqScan + delta.seqScan,
      idxScan: base.idxScan + delta.idxScan,
      seqTupRead: base.seqTupRead + delta.seqTupRead,
    };
  }
  return {
    calls: a.calls + b.calls,
    pages: a.pages + b.pages,
    pagesRead: a.pagesRead + b.pagesRead,
    pagesDirtied: a.pagesDirtied + b.pagesDirtied,
    tempBytes: a.tempBytes + b.tempBytes,
    walBytes: a.walBytes + b.walBytes,
    walRecords: a.walRecords + b.walRecords,
    writeTransactions: a.writeTransactions + b.writeTransactions,
    elapsedMs: a.elapsedMs + b.elapsedMs,
    tables,
  };
};

export const sumCounters = (items: readonly Counters[]): Counters => items.reduce(addCounters, emptyCounters());

/** Rows written (inserted + updated + deleted), optionally only in tables whose name passes `include`. */
export const rowsWritten = (counters: Counters, include: (table: string) => boolean = () => true): number =>
  Object.entries(counters.tables)
    .filter(([table]) => include(table))
    .reduce((sum, [, t]) => sum + t.ins + t.upd + t.del, 0);

export const scans = (counters: Counters): { seq: number; idx: number; seqTupRead: number } =>
  Object.values(counters.tables).reduce(
    (sum, t) => ({ seq: sum.seq + t.seqScan, idx: sum.idx + t.idxScan, seqTupRead: sum.seqTupRead + t.seqTupRead }),
    { seq: 0, idx: 0, seqTupRead: 0 },
  );

/** Application rows: everything but the platform's own bookkeeping schemas. */
export const isAppTable = (table: string): boolean => /^(app_public|public)\./.test(table);
