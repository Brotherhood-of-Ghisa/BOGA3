#!/usr/bin/env tsx
/**
 * check-sync-schema-drift — Sync v2 client/server schema drift checker.
 *
 * Spec: docs/specs/tech/sync-v2-server-contract.md §A.7 (especially §A.7.3
 * algorithm and §A.7.7 topological FK assertion). This script implements that
 * drift-control contract.
 *
 * High-level steps:
 *   1. Reset the local Supabase Postgres (apply every migration from scratch).
 *   2. drizzle-kit export → in-memory better-sqlite3 → introspect via PRAGMAs.
 *   3. Introspect Postgres via information_schema / pg_indexes / pg_policies /
 *      pg_proc / pg_trigger.
 *   4. Per entity (derived: every app_public table with `owner_user_id`):
 *      walk client→server and server→client; run §7.3 step 4f sanity checks
 *      (universal index, two triggers, four RLS policies w/ body hashes,
 *      no CHECK, no `extras`, no `deleted` boolean).
 *   5. Run the §7.7 topo-order assertion against TOPO_LAYERS.
 *
 * Exit codes (§7.4):
 *   0 — no drift, no warnings.
 *   1 — drift / §1 ground-rule regression.
 *   2 — server has columns absent on the client (warn-only; FAIL under --strict).
 *
 * Flags:
 *   --strict          → promote exit 2 to 1 (slow-gate posture).
 *   --skip-reset      → skip `supabase db reset --local --yes`. Use only when
 *                       the developer has already applied migrations on the
 *                       running stack; CI invocation never passes this.
 *   --write-fixtures  → recompute the hashes in
 *                       check-sync-schema-drift.fixtures.json and write them
 *                       to disk. Intended for intentional trigger/policy
 *                       changes; the human commits the resulting diff.
 *   --help            → print this.
 *
 * Args after `--` are forwarded from `npm run check:sync-drift -- …`.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { Client as PgClient } from 'pg';

import { TOPO_LAYERS } from '../src/sync/topo-order.js';

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(MOBILE_DIR, '..', '..');
const SYNC_EXTRAS_PATH = join(MOBILE_DIR, 'src', 'data', 'schema', 'sync-extras.json');
const FIXTURES_PATH = join(__dirname, 'check-sync-schema-drift.fixtures.json');
const DRIZZLE_CONFIG_PATH = join(MOBILE_DIR, 'drizzle.config.ts');
const RESET_SCRIPT = join(REPO_ROOT, 'supabase', 'scripts', 'reset-local.sh');

// -----------------------------------------------------------------------------
// CLI parsing
// -----------------------------------------------------------------------------

interface Flags {
  strict: boolean;
  skipReset: boolean;
  writeFixtures: boolean;
  help: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = { strict: false, skipReset: false, writeFixtures: false, help: false };
  for (const arg of argv) {
    switch (arg) {
      case '--strict':
        flags.strict = true;
        break;
      case '--skip-reset':
        flags.skipReset = true;
        break;
      case '--write-fixtures':
        flags.writeFixtures = true;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`[sync-drift] unknown flag: ${arg}`);
          process.exit(2);
        }
    }
  }
  return flags;
}

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------

const log = (...args: unknown[]) => console.error('[sync-drift]', ...args);
const fail = (...args: unknown[]) => console.error('[sync-drift] FAIL:', ...args);
const warn = (...args: unknown[]) => console.error('[sync-drift] warn:', ...args);

// -----------------------------------------------------------------------------
// Shell helpers
// -----------------------------------------------------------------------------

function runShell(cmd: string, args: readonly string[], cwd = REPO_ROOT): { stdout: string; status: number } {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: false });
  if (r.error) {
    throw new Error(`spawn failed: ${cmd} ${args.join(' ')}: ${r.error.message}`);
  }
  if (r.stderr && r.stderr.trim()) {
    // Surface stderr to the operator; many supabase CLI lines are progress.
    process.stderr.write(r.stderr);
  }
  return { stdout: r.stdout ?? '', status: r.status ?? 0 };
}

// -----------------------------------------------------------------------------
// Supabase stack helpers
// -----------------------------------------------------------------------------

interface SupabaseStatusEnv {
  DB_URL: string;
  SERVICE_ROLE_KEY?: string;
}

function loadSupabaseStatusEnv(): SupabaseStatusEnv {
  // Env override: if the caller has already exported DB_URL (CI, test
  // harnesses, or a developer pointing at a non-default stack), skip the
  // `supabase status` invocation. The `npm run check:sync-drift -- --strict`
  // slow-gate invocation does not set this, so the default path remains
  // "read from `supabase status -o env`".
  if (process.env.DB_URL) {
    return {
      DB_URL: process.env.DB_URL,
      SERVICE_ROLE_KEY: process.env.SERVICE_ROLE_KEY,
    };
  }
  const r = spawnSync('bash', ['-c', 'source supabase/scripts/_common.sh && load_supabase_status_env && env'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`failed to load supabase status env (rc=${r.status}): ${r.stderr}`);
  }
  const env: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  if (!env.DB_URL) {
    throw new Error('DB_URL not present after `supabase status -o env`; is the local stack running?');
  }
  return { DB_URL: env.DB_URL, SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY };
}

function resetLocalDb(): void {
  log('resetting local Supabase database (supabase/scripts/reset-local.sh)');
  if (!existsSync(RESET_SCRIPT)) {
    throw new Error(`reset script missing: ${RESET_SCRIPT}`);
  }
  const r = spawnSync('bash', [RESET_SCRIPT], { cwd: REPO_ROOT, stdio: 'inherit' });
  if ((r.status ?? 1) !== 0) {
    throw new Error(`supabase db reset failed (rc=${r.status})`);
  }
}

// -----------------------------------------------------------------------------
// Drizzle export → in-memory SQLite materialisation
// -----------------------------------------------------------------------------

function materialiseClientSqlite(): Database.Database {
  log('drizzle-kit export → in-memory better-sqlite3');
  const r = spawnSync('npx', ['drizzle-kit', 'export', `--config=${DRIZZLE_CONFIG_PATH}`], {
    cwd: MOBILE_DIR,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  if ((r.status ?? 1) !== 0) {
    throw new Error(
      `drizzle-kit export failed (rc=${r.status}):\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`
    );
  }
  const ddl = r.stdout;
  if (!ddl.includes('CREATE TABLE')) {
    throw new Error(`drizzle-kit export produced no DDL; got: ${ddl.slice(0, 400)}`);
  }
  const db = new Database(':memory:');
  // SQLite refuses FK declarations on tables that don't exist yet unless
  // foreign-key enforcement is OFF during DDL replay (drizzle-kit emits in
  // arbitrary order). Mirrors what `drizzle-kit push` does internally.
  db.pragma('foreign_keys = OFF');
  db.exec(ddl);
  return db;
}

// -----------------------------------------------------------------------------
// Introspection types
// -----------------------------------------------------------------------------

interface PgColumn {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
}

interface PgIndex {
  indexname: string;
  indexdef: string;
}

interface PgPolicy {
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

interface SqliteColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface SqliteIndex {
  name: string;
  unique: number;
  columns: string[];
}

interface SqliteForeignKey {
  table: string;
  from: string;
  to: string;
}

// -----------------------------------------------------------------------------
// Postgres introspection
// -----------------------------------------------------------------------------

async function listEntityTables(pg: PgClient): Promise<string[]> {
  // §7.7: derive ENTITY_TABLES from the live schema.
  const r = await pg.query<{ table_name: string }>(`
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'app_public'
       and c.column_name = 'owner_user_id'
     order by c.table_name
  `);
  return r.rows.map((row) => row.table_name);
}

async function pgColumns(pg: PgClient, table: string): Promise<PgColumn[]> {
  const r = await pg.query<PgColumn>(
    `
    select column_name, data_type, udt_name, is_nullable
      from information_schema.columns
     where table_schema = 'app_public'
       and table_name = $1
     order by ordinal_position
    `,
    [table]
  );
  return r.rows;
}

async function pgIndexes(pg: PgClient, table: string): Promise<PgIndex[]> {
  const r = await pg.query<PgIndex>(
    `
    select indexname, indexdef
      from pg_indexes
     where schemaname = 'app_public'
       and tablename = $1
     order by indexname
    `,
    [table]
  );
  return r.rows;
}

async function pgTriggerNames(pg: PgClient, table: string): Promise<string[]> {
  const r = await pg.query<{ tgname: string }>(
    `
    select t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = $1
       and not t.tgisinternal
    `,
    [table]
  );
  return r.rows.map((row) => row.tgname);
}

async function pgPolicies(pg: PgClient, table: string): Promise<PgPolicy[]> {
  const r = await pg.query<PgPolicy>(
    `
    select policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'app_public'
       and tablename = $1
    `,
    [table]
  );
  return r.rows;
}

async function pgRlsEnabled(pg: PgClient, table: string): Promise<boolean> {
  const r = await pg.query<{ relrowsecurity: boolean }>(
    `
    select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = $1
    `,
    [table]
  );
  return r.rows[0]?.relrowsecurity ?? false;
}

async function pgCheckConstraintCount(pg: PgClient, table: string): Promise<number> {
  const r = await pg.query<{ count: string }>(
    `
    select count(*) as count
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app_public'
       and c.relname = $1
       and con.contype = 'c'
    `,
    [table]
  );
  return Number(r.rows[0]?.count ?? '0');
}

interface FkEdge {
  childTable: string;
  parentTable: string;
}

async function pgForeignKeyEdges(pg: PgClient, entities: string[]): Promise<FkEdge[]> {
  if (entities.length === 0) return [];
  const r = await pg.query<{ child: string; parent: string }>(
    `
    select c.relname as child, pc.relname as parent
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_class pc on pc.oid = con.confrelid
      join pg_namespace pn on pn.oid = pc.relnamespace
     where con.contype = 'f'
       and n.nspname = 'app_public'
       and pn.nspname = 'app_public'
       and c.relname = ANY($1::text[])
    `,
    [entities]
  );
  return r.rows.map((row) => ({ childTable: row.child, parentTable: row.parent }));
}

async function pgImmutableTriggerBody(pg: PgClient): Promise<string> {
  const r = await pg.query<{ prosrc: string }>(`
    select p.prosrc
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_public'
       and p.proname = 'enforce_owner_user_id_immutable'
  `);
  if (r.rows.length === 0) {
    throw new Error('app_public.enforce_owner_user_id_immutable function not found');
  }
  return r.rows[0].prosrc;
}

// -----------------------------------------------------------------------------
// SQLite introspection
// -----------------------------------------------------------------------------

function sqliteTables(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`select name from sqlite_master where type='table' and name not like 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function sqliteColumns(db: Database.Database, table: string): SqliteColumn[] {
  // PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
  return db.pragma(`table_info(${quoteIdent(table)})`) as SqliteColumn[];
}

function sqliteIndexList(db: Database.Database, table: string): SqliteIndex[] {
  const indices = db.pragma(`index_list(${quoteIdent(table)})`) as Array<{
    seq: number;
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>;
  return indices.map((ix) => {
    const cols = db.pragma(`index_info(${quoteIdent(ix.name)})`) as Array<{
      seqno: number;
      cid: number;
      name: string;
    }>;
    return { name: ix.name, unique: ix.unique, columns: cols.map((c) => c.name) };
  });
}

function sqliteForeignKeyList(db: Database.Database, table: string): SqliteForeignKey[] {
  return db.pragma(`foreign_key_list(${quoteIdent(table)})`) as SqliteForeignKey[];
}

function quoteIdent(name: string): string {
  // SQLite PRAGMA arg quoting — wrap in single quotes and double any embedded.
  return `'${name.replace(/'/g, "''")}'`;
}

// -----------------------------------------------------------------------------
// Type-compat map (§7.3)
// -----------------------------------------------------------------------------

/**
 * sqliteType is what `pragma table_info.type` reports for a Drizzle column
 * (`text`, `integer`, `real`). udtName is what `information_schema.udt_name`
 * reports for the server column (`text`, `int4`, `int8`, `float8`, `numeric`,
 * `bool`, `uuid`, `timestamp`, `timestamptz`).
 *
 * Returns true if the pair is acceptable per the §A.7.3 narrow map
 * (docs/specs/tech/sync-v2-server-contract.md). The timestamp_ms discriminator
 * on the client is reflected as `integer` by the SQLite catalog; bigint on the
 * server is `int8`. The narrow map accepts client `integer` against either
 * `int4` or `int8` (which is exactly the §A.7.3 row). Default-expression
 * equality is NOT compared.
 */
function isTypeCompatible(sqliteType: string, udtName: string): boolean {
  const c = sqliteType.toLowerCase();
  const s = udtName.toLowerCase();
  if (c === 'text' && s === 'text') return true;
  if (c === 'integer' && (s === 'int4' || s === 'int8')) return true;
  if (c === 'real' && (s === 'float8' || s === 'numeric')) return true;
  return false;
}

// -----------------------------------------------------------------------------
// Name mapping
// -----------------------------------------------------------------------------

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// The wire-envelope columns (universal server-side, never declared on the
// client Drizzle side) — per docs/specs/tech/sync-v2-server-contract.md §A.2.
const WIRE_ENVELOPE_COLUMNS = new Set([
  'owner_user_id',
  'client_updated_at_ms',
  'server_received_at',
]);

// -----------------------------------------------------------------------------
// Hash / fixture handling
// -----------------------------------------------------------------------------

/**
 * Normalisation rule (§7.3 step 4f): "whitespace collapsed, comments stripped".
 *   - Strip SQL line comments (`-- …` to end-of-line).
 *   - Strip SQL block comments (`/* … *\/`).
 *   - Collapse runs of whitespace to a single space.
 *   - Trim leading/trailing whitespace.
 *   - Lowercase (Postgres normalises identifiers in policy quals to lower).
 */
function normalise(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

interface PolicyFixture {
  qual: string | null;
  with_check: string | null;
}

interface FixtureFile {
  $description: string;
  enforce_owner_user_id_immutable_sha256: string;
  policies_sha256: Record<string, Record<string, PolicyFixture>>;
}

function loadFixture(): FixtureFile {
  if (!existsSync(FIXTURES_PATH)) {
    throw new Error(
      `fixture file missing: ${FIXTURES_PATH}\n` +
        `Run with --write-fixtures to seed it from the current as-built schema.`
    );
  }
  return JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as FixtureFile;
}

// -----------------------------------------------------------------------------
// Reporting
// -----------------------------------------------------------------------------

interface Findings {
  errors: string[];
  warnings: string[];
}

function addError(f: Findings, msg: string): void {
  f.errors.push(msg);
  fail(msg);
}

function addWarning(f: Findings, msg: string): void {
  f.warnings.push(msg);
  warn(msg);
}

// Pretty fix-template for a missing server counterpart (§7.4 verbatim shape).
function formatMissingServerCounterpart(
  entity: string,
  column: string,
  sqliteType: string,
  serverColumnsInOrder: string[]
): string {
  const colList = wrapColumns(serverColumnsInOrder, 78);
  const pgType = sqliteTypeToProbablePgType(sqliteType);
  return [
    `✗ ${entity}: client column "${column}" (${sqliteType}) has no server counterpart.`,
    ``,
    `  The local Postgres applied every migration and ended up with these columns`,
    `  on app_public.${entity}:`,
    ...colList.map((l) => `    ${l}`),
    ``,
    `  To fix, add a server migration under supabase/migrations/ that promotes the`,
    `  column to typed, then deploy it:`,
    ``,
    `    alter table app_public.${entity}`,
    `      add column ${column} ${pgType};`,
    ``,
    `  Server-first deploy is unconditional (per docs/specs/tech/sync-v2-server-contract.md §A.3 and §A.9). Once`,
    `  deployed, re-run \`npm run check:sync-drift\` — the local DB reset will pick`,
    `  up the new migration and the check will pass.`,
  ].join('\n');
}

function sqliteTypeToProbablePgType(sqliteType: string): string {
  switch (sqliteType.toLowerCase()) {
    case 'text':
      return 'text';
    case 'integer':
      return 'bigint';
    case 'real':
      return 'double precision';
    default:
      return 'text';
  }
}

function wrapColumns(cols: string[], width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const col of cols) {
    const candidate = current ? `${current}, ${col}` : col;
    if (candidate.length > width && current) {
      lines.push(`${current},`);
      current = col;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(__filename === '' ? '' : ''); // keep tsc happy
    console.log(readFileSync(__filename, 'utf8').split('\n').slice(0, 36).join('\n'));
    return 0;
  }

  if (!flags.skipReset) {
    resetLocalDb();
  } else {
    log('--skip-reset: not running supabase db reset');
  }

  const status = loadSupabaseStatusEnv();
  const pg = new PgClient({ connectionString: status.DB_URL });
  await pg.connect();

  let exitCode = 0;
  try {
    const findings: Findings = { errors: [], warnings: [] };
    const sqliteDb = materialiseClientSqlite();
    const extras = JSON.parse(readFileSync(SYNC_EXTRAS_PATH, 'utf8')) as {
      exemptions: {
        local_only_columns: string[];
        // Server-side columns we tolerate as having no client counterpart
        // (typically because plan-2 hasn't shipped the matching client column
        // yet — see sync-extras.json rationale per entry).
        server_only_columns?: { column: string; rationale?: string }[];
        untyped_text_references: { entity: string; column: string }[];
      };
    };

    const entities = await listEntityTables(pg);
    if (entities.length === 0) {
      addError(findings, 'no entity tables with owner_user_id found in app_public; expected 8+ per docs/specs/tech/sync-v2-server-contract.md §A.2');
    }

    log(`introspecting ${entities.length} entity table(s): ${entities.join(', ')}`);

    const fixtureFile: FixtureFile = flags.writeFixtures
      ? {
          $description:
            'SHA-256 hashes (whitespace-collapsed, comments-stripped, lowercased) of the v2 owner_user_id-immutable trigger body and per-entity RLS policy expressions. Regenerate via `npm run check:sync-drift -- --write-fixtures` when policy/trigger text intentionally changes.',
          enforce_owner_user_id_immutable_sha256: '',
          policies_sha256: {},
        }
      : loadFixture();

    // ---- Trigger body hash ------------------------------------------------
    const immutableBody = await pgImmutableTriggerBody(pg);
    const immutableHash = sha256(normalise(immutableBody));
    if (flags.writeFixtures) {
      fixtureFile.enforce_owner_user_id_immutable_sha256 = immutableHash;
    } else if (fixtureFile.enforce_owner_user_id_immutable_sha256 !== immutableHash) {
      addError(
        findings,
        `enforce_owner_user_id_immutable body hash drifted.\n` +
          `  expected: ${fixtureFile.enforce_owner_user_id_immutable_sha256}\n` +
          `  actual:   ${immutableHash}\n` +
          `  If this change is intentional, re-run with --write-fixtures and commit the diff.\n` +
          `  Otherwise, restore the canonical body from docs/specs/tech/sync-v2-server-contract.md §A.6.3.`
      );
    }

    // ---- Per-entity walk --------------------------------------------------
    const clientTables = sqliteTables(sqliteDb);
    for (const entity of entities) {
      await checkEntity({
        entity,
        pg,
        sqliteDb,
        clientTables,
        extras,
        fixtureFile,
        flags,
        findings,
      });
    }

    // ---- §7.7 topological FK assertion ------------------------------------
    await assertTopoOrder({ pg, entities, findings });

    // ---- Write fixtures if requested --------------------------------------
    if (flags.writeFixtures) {
      writeFileSync(FIXTURES_PATH, JSON.stringify(fixtureFile, null, 2) + '\n', 'utf8');
      log(`wrote fixtures to ${FIXTURES_PATH}`);
    }

    // ---- Resolve exit code ------------------------------------------------
    if (findings.errors.length > 0) {
      exitCode = 1;
    } else if (findings.warnings.length > 0) {
      // Per §7.4: exit 2 is the "server-only column" warn lane; under --strict
      // it becomes 1. Other warnings are surfaced but don't change the code.
      exitCode = flags.strict ? 1 : 2;
    } else {
      exitCode = 0;
    }

    log(
      `done — errors=${findings.errors.length} warnings=${findings.warnings.length} exit=${exitCode}`
    );
  } finally {
    await pg.end();
  }

  return exitCode;
}

// -----------------------------------------------------------------------------
// Per-entity walk
// -----------------------------------------------------------------------------

interface EntityContext {
  entity: string;
  pg: PgClient;
  sqliteDb: Database.Database;
  clientTables: Set<string>;
  extras: {
    exemptions: {
      local_only_columns: string[];
      server_only_columns?: { column: string; rationale?: string }[];
      untyped_text_references: { entity: string; column: string }[];
    };
  };
  fixtureFile: FixtureFile;
  flags: Flags;
  findings: Findings;
}

async function checkEntity(ctx: EntityContext): Promise<void> {
  const {
    entity,
    pg,
    sqliteDb,
    clientTables,
    extras,
    fixtureFile,
    flags,
    findings,
  } = ctx;

  const pgCols = await pgColumns(pg, entity);
  const pgIdx = await pgIndexes(pg, entity);
  const pgTrigs = await pgTriggerNames(pg, entity);
  const pgPols = await pgPolicies(pg, entity);
  const rlsEnabled = await pgRlsEnabled(pg, entity);
  const checkCount = await pgCheckConstraintCount(pg, entity);

  const pgColByName = new Map(pgCols.map((c) => [c.column_name, c]));
  const pgColumnsInOrder = pgCols.map((c) => c.column_name);

  // ---- 4f sanity: §1 ground-rule regressions ------------------------------
  if (checkCount > 0) {
    addError(
      findings,
      `${entity}: ${checkCount} CHECK constraint(s) present; expected zero per docs/specs/tech/sync-v2-server-contract.md §A.1 ("no server validation")`
    );
  }
  if (pgColByName.has('extras')) {
    addError(
      findings,
      `${entity}: server has an "extras" column; v2 forbids extras-blob columns per docs/specs/tech/sync-v2-server-contract.md §A.1`
    );
  }
  if (pgColByName.has('deleted')) {
    addError(
      findings,
      `${entity}: server has a "deleted" boolean column; v2 uses only deleted_at (docs/specs/tech/sync-v2-server-contract.md §A.1)`
    );
  }

  // ---- 4f sanity: universal index, two structural triggers ---------------
  const universalIdx = `${entity}_owner_received_idx`;
  if (!pgIdx.some((ix) => ix.indexname === universalIdx)) {
    addError(findings, `${entity}: missing universal index ${universalIdx} (docs/specs/tech/sync-v2-server-contract.md §A.2)`);
  }
  const expectedTouch = `${entity}_touch_server_received_at`;
  const expectedImmut = `${entity}_owner_user_id_immutable`;
  if (!pgTrigs.includes(expectedTouch)) {
    addError(findings, `${entity}: missing trigger ${expectedTouch} (docs/specs/tech/sync-v2-server-contract.md §A.2)`);
  }
  if (!pgTrigs.includes(expectedImmut)) {
    addError(findings, `${entity}: missing trigger ${expectedImmut} (docs/specs/tech/sync-v2-server-contract.md §A.6.3)`);
  }

  // ---- 4f sanity: RLS enabled with 4 owner policies and matching bodies --
  if (!rlsEnabled) {
    addError(findings, `${entity}: RLS not enabled (docs/specs/tech/sync-v2-server-contract.md §A.6.1)`);
  }
  const polByName = new Map(pgPols.map((p) => [p.policyname, p]));
  const expectedPolicies = [
    { suffix: 'owner_select', cmd: 'SELECT', hasQual: true, hasWithCheck: false },
    { suffix: 'owner_insert', cmd: 'INSERT', hasQual: false, hasWithCheck: true },
    { suffix: 'owner_update', cmd: 'UPDATE', hasQual: true, hasWithCheck: true },
    { suffix: 'owner_delete', cmd: 'DELETE', hasQual: true, hasWithCheck: false },
  ];

  const policyFixtures: Record<string, PolicyFixture> = {};
  for (const spec of expectedPolicies) {
    const name = `${entity}_${spec.suffix}`;
    const pol = polByName.get(name);
    if (!pol) {
      addError(findings, `${entity}: missing RLS policy ${name} (docs/specs/tech/sync-v2-server-contract.md §A.6.1)`);
      continue;
    }
    const qualHash = pol.qual ? sha256(normalise(pol.qual)) : null;
    const withCheckHash = pol.with_check ? sha256(normalise(pol.with_check)) : null;
    policyFixtures[spec.suffix] = { qual: qualHash, with_check: withCheckHash };
    if (!flags.writeFixtures) {
      const fixturePerEntity = fixtureFile.policies_sha256[entity];
      if (!fixturePerEntity) {
        addError(
          findings,
          `${entity}: no policy fixtures recorded for this entity.\n` +
            `  Run with --write-fixtures to seed.`
        );
        continue;
      }
      const expected = fixturePerEntity[spec.suffix];
      if (!expected) {
        addError(findings, `${entity}.${spec.suffix}: no fixture entry; run --write-fixtures`);
        continue;
      }
      if (expected.qual !== qualHash) {
        addError(
          findings,
          `${name}: policy USING-expression hash drifted.\n` +
            `  expected: ${expected.qual}\n` +
            `  actual:   ${qualHash}\n` +
            `  Canonical body per docs/specs/tech/sync-v2-server-contract.md §A.6.1 is \`owner_user_id = auth.uid()\`.\n` +
            `  If intentional, --write-fixtures.`
        );
      }
      if (expected.with_check !== withCheckHash) {
        addError(
          findings,
          `${name}: policy WITH-CHECK expression hash drifted.\n` +
            `  expected: ${expected.with_check}\n` +
            `  actual:   ${withCheckHash}\n` +
            `  Canonical body per docs/specs/tech/sync-v2-server-contract.md §A.6.1 is \`owner_user_id = auth.uid()\`.\n` +
            `  If intentional, --write-fixtures.`
        );
      }
    }
  }
  if (flags.writeFixtures) {
    fixtureFile.policies_sha256[entity] = policyFixtures;
  }

  // ---- Client-side introspection ----------------------------------------
  if (!clientTables.has(entity)) {
    addError(
      findings,
      `${entity}: no matching SQLite table in the client schema. Either add the Drizzle file or drop the server table.`
    );
    return;
  }
  const sqliteCols = sqliteColumns(sqliteDb, entity);

  // ---- 4d: client column has typed server counterpart -------------------
  const exempt = new Set(extras.exemptions.local_only_columns);
  const untypedTextRefs = new Set(
    extras.exemptions.untyped_text_references
      .filter((r) => r.entity === entity)
      .map((r) => camelToSnake(r.column))
  );

  for (const col of sqliteCols) {
    const wireName = col.name; // drizzle-kit export already uses snake_case wire names
    if (exempt.has(wireName)) continue;
    const pgCol = pgColByName.get(wireName);
    if (pgCol) {
      if (!isTypeCompatible(col.type, pgCol.udt_name)) {
        addError(
          findings,
          `${entity}.${wireName}: type mismatch — client ${col.type} vs server ${pgCol.udt_name} (udt). ` +
            `Type-compat map: text↔text, integer↔int4|int8, real↔float8|numeric (docs/specs/tech/sync-v2-server-contract.md §A.7.3).`
        );
      }
      continue;
    }
    if (untypedTextRefs.has(wireName)) continue;
    // Missing — emit a §7.4-shaped failure.
    const msg = formatMissingServerCounterpart(entity, wireName, col.type, pgColumnsInOrder);
    findings.errors.push(msg);
    console.error(msg);
  }

  // ---- 4e: server column has a client counterpart (warn-only) -----------
  const clientWireNames = new Set(sqliteCols.map((c) => c.name));
  const serverOnlyExempt = new Set(
    (extras.exemptions.server_only_columns ?? []).map((r) => r.column)
  );
  for (const pgCol of pgCols) {
    if (WIRE_ENVELOPE_COLUMNS.has(pgCol.column_name)) continue;
    if (clientWireNames.has(pgCol.column_name)) continue;
    if (serverOnlyExempt.has(pgCol.column_name)) continue;
    addWarning(
      findings,
      `${entity}.${pgCol.column_name}: server has a typed column with no client counterpart. ` +
        `Either the client schema is behind a deployed migration, or this column is a stale server-side column ` +
        `that should be dropped. (Exits 2 by default; FAIL under --strict.)`
    );
  }
}

// -----------------------------------------------------------------------------
// §7.7 topological FK order assertion
// -----------------------------------------------------------------------------

async function assertTopoOrder(args: {
  pg: PgClient;
  entities: string[];
  findings: Findings;
}): Promise<void> {
  const { pg, entities, findings } = args;
  const layerOf = new Map<string, number>();
  for (let i = 0; i < TOPO_LAYERS.length; i++) {
    for (const name of TOPO_LAYERS[i]) {
      if (layerOf.has(name)) {
        addError(findings, `topo-order: ${name} appears in multiple layers`);
      }
      layerOf.set(name, i);
    }
  }
  const entitySet = new Set(entities);
  const topoSet = new Set(layerOf.keys());
  for (const e of entitySet) {
    if (!topoSet.has(e)) {
      addError(
        findings,
        `topo-order: entity ${e} (live in app_public) missing from TOPO_LAYERS — add it to ` +
          `apps/mobile/src/sync/topo-order.ts.`
      );
    }
  }
  for (const t of topoSet) {
    if (!entitySet.has(t)) {
      addError(
        findings,
        `topo-order: TOPO_LAYERS lists ${t}, but no live app_public.${t} entity table found — ` +
          `remove from topo-order.ts or add the migration.`
      );
    }
  }

  const edges = await pgForeignKeyEdges(pg, entities);
  for (const edge of edges) {
    const childLayer = layerOf.get(edge.childTable);
    const parentLayer = layerOf.get(edge.parentTable);
    if (childLayer === undefined || parentLayer === undefined) continue;
    if (edge.childTable === edge.parentTable) continue; // self-edge allowed
    if (parentLayer >= childLayer) {
      addError(
        findings,
        `topo-order: same-layer (or inverted) FK detected.\n` +
          `  ${edge.childTable} → ${edge.parentTable}, but child is in Layer ${childLayer} and parent in Layer ${parentLayer}.\n` +
          `  Move ${edge.childTable} to a later layer in apps/mobile/src/sync/topo-order.ts.`
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Entrypoint
// -----------------------------------------------------------------------------

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[sync-drift] fatal:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
