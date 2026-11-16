// Parity: a rewritten RPC must return the same JSON as the definition it
// replaces. The old definition is copied verbatim from the migration that
// created it and installed as a pg_temp function for this session only, so
// old and new run side by side on the same fixture, as the same caller, inside
// the rolled-back transaction. Pure helpers here; the read-path set runs the
// registered cases (`PARITY_CASES` in read-path.ts).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Caller } from './session.ts';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../supabase/migrations');
/**
 * Saved live definitions, never applied: a definition a later migration
 * patched in place (pg_get_functiondef + replace) has no verbatim copy in any
 * one migration, so its text is saved here, named after that migration.
 */
export const PARITY_DEFINITIONS_DIR = path.resolve(__dirname, 'parity-definitions');

const SOURCE = /^(parity-definitions\/)?([0-9]{14}_[a-z0-9_]+\.sql)$/;

/** Where a definition source lives: a migration file name, or `parity-definitions/<migration>.sql`. */
export const definitionPath = (source: string): string => {
  const match = SOURCE.exec(source);
  if (!match) throw new Error(`invalid definition source: ${source}`);
  return path.join(match[1] ? PARITY_DEFINITIONS_DIR : MIGRATIONS_DIR, match[2]);
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

const header = (fn: string) => new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+app_public\\.${fn}\\s*\\(`, 'gi');

/**
 * The last `create [or replace] function app_public.<fn>(…)` statement in a
 * migration's SQL (or a saved pg_get_functiondef text), through the `;` that
 * ends it. The body's dollar quote is the first `$tag$` after `as`; nothing
 * inside it is parsed.
 */
export const definitionFromMigration = (sql: string, fn: string): string => {
  if (!IDENT.test(fn)) throw new Error(`invalid function name: ${fn}`);
  const starts = [...sql.matchAll(header(fn))].map((match) => match.index);
  if (starts.length === 0) throw new Error(`no definition of app_public.${fn} in the migration`);
  const start = starts[starts.length - 1];
  const body = /\bas\s+(\$[A-Za-z_]*\$)/gi;
  body.lastIndex = start;
  const open = body.exec(sql);
  if (!open) throw new Error(`app_public.${fn} has no dollar-quoted body`);
  const tag = open[1];
  const close = sql.indexOf(tag, open.index + open[0].length);
  if (close < 0) throw new Error(`app_public.${fn}'s body is not closed`);
  const after = close + tag.length;
  // Trailing clauses (`$$ language sql;`) end at their `;`; pg_get_functiondef
  // text ends at the tag, and the next statement is never swallowed. Anything
  // else after the body is refused rather than dropped.
  const rest = sql.slice(after);
  // Each word ends in whitespace (or is the last), so there is one way to split them: linear time.
  const trailer = /^\s*((?:[a-z_]+\s+)*[a-z_]*)\s*;/i.exec(rest);
  const statement = /\b(create|grant|revoke|alter|comment|drop|select|insert|update|delete|do|begin|commit)\b/i;
  if (trailer && !statement.test(trailer[1])) return sql.slice(start, after + trailer[0].length);
  if (/^\s*$/.test(rest) || statement.test(/^\s*([a-z_]+)/i.exec(rest)?.[1] ?? '')) return `${sql.slice(start, after)};`;
  throw new Error(`app_public.${fn}'s definition has text after its body that is not a plain clause`);
};

/** Reads a definition source (see `definitionPath`) and returns `fn`'s last definition in it. */
export const migrationDefinition = (source: string, fn: string): string =>
  definitionFromMigration(readFileSync(definitionPath(source), 'utf8'), fn);

/**
 * The definition renamed to `pg_temp.<alias>`, everything else unchanged.
 * Its body still calls the live helpers; a rewrite that also changes a helper
 * installs that helper's old definition too and passes it in `helpers`, so
 * the old body calls the old helper.
 */
export const legacyDefinition = (definition: string, fn: string, alias: string, helpers: Record<string, string> = {}): string => {
  for (const name of [fn, alias, ...Object.keys(helpers), ...Object.values(helpers)]) {
    if (!IDENT.test(name)) throw new Error(`invalid function name: ${name}`);
  }
  const renamed = definition.replace(header(fn), `create function pg_temp.${alias}(`);
  if (renamed === definition) throw new Error(`not a definition of app_public.${fn}`);
  return Object.entries(helpers).reduce(
    (sql, [helper, helperAlias]) => sql.replace(new RegExp(`\\b(?:app_public\\.)?${helper}\\s*\\(`, 'g'), `pg_temp.${helperAlias}(`),
    renamed,
  );
};

/** Replaces exactly one occurrence of `from` with `to`: a planted difference for the helper's self-check. */
export const plantDifference = (definition: string, from: string, to: string): string => {
  const first = definition.indexOf(from);
  if (first < 0 || definition.indexOf(from, first + 1) >= 0) throw new Error(`the plant must match exactly once: ${from}`);
  return definition.slice(0, first) + to + definition.slice(first + from.length);
};

const kind = (value: unknown): string => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/**
 * The first place two JSON values differ, as a path (`$.members[2].rank:
 * 3 ≠ 4`), or null when they are equal. Object key order does not matter
 * (the values come from jsonb); array order does.
 */
export const jsonDifference = (a: unknown, b: unknown, at = '$'): string | null => {
  if (kind(a) !== kind(b)) return `${at}: ${kind(a)} ≠ ${kind(b)}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: ${a.length} items ≠ ${b.length} items`;
    for (let index = 0; index < a.length; index += 1) {
      const found = jsonDifference(a[index], b[index], `${at}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (kind(a) === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left)) return `${at}.${key}: missing ≠ present`;
      if (!(key in right)) return `${at}.${key}: present ≠ missing`;
      const found = jsonDifference(left[key], right[key], `${at}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
};

/** One RPC's parity case: the definition it replaces, and the calls to compare. */
export type ParityCase<Context> = {
  fn: string;
  /**
   * Where the definition being replaced is, copied verbatim: the migration
   * that created it, or `parity-definitions/<migration>.sql` when a later
   * migration patched it in place.
   */
  migration: string;
  /** Old helper definitions the old body must call: helper name → definition source. */
  helpers?: Record<string, string>;
  /** Every argument set to compare, each called by every viewer the fixture holds. */
  argumentSets?: (context: Context) => Record<string, unknown>[];
  /** The exact calls to compare, when not every viewer should call every argument set. */
  calls?: (context: Context) => { viewer: string; args: Record<string, unknown> }[];
  /** Who calls it: the viewer as the app does (default), or a worker's role. */
  caller?: (viewer: string, context: Context) => Caller;
  /**
   * For an RPC that writes: SQL returning the rows it may change as one JSON
   * value. Each call then runs in its own savepoint, the rows are read after
   * it and the savepoint is rolled back, so old and new start from the same
   * state and their writes are compared as well as their results.
   */
  state?: string;
  /** The scenarios (named changes to the fixture) the case runs under; `['base']` when absent. */
  scenarios?: string[];
  /**
   * Names what a live call returned (`true`, `refused`…). A case that
   * `requires` outcomes fails unless each was seen at least once, so a case
   * whose calls all fail the same way cannot pass for lack of a difference.
   */
  observe?: (live: unknown) => string;
  requires?: string[];
  /** The helper's self-check: one text replacement that must change the JSON. */
  plant?: { from: string; to: string };
  /**
   * A paged RPC: the arguments of the next page after `result`, or null at
   * the end. Each definition follows its own cursor to the last page, so a
   * page boundary that moved is a difference.
   */
  walk?: (args: Record<string, unknown>, result: unknown) => Record<string, unknown> | null;
  /** Top-level keys left out of the comparison: a clock reading each call takes anew. */
  ignoreKeys?: readonly string[];
};

/** A walk longer than this is a cursor that never ends. */
export const PARITY_MAX_PAGES = 2000;

const withoutKeys = (value: unknown, keys: readonly string[] | undefined): unknown => {
  if (!keys?.length || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !keys.includes(key)));
};

export type ParityOutcome = {
  fn: string;
  compared: number;
  differences: string[];
  /** Whether the planted definition was told apart; null without a plant. */
  plantDetected: boolean | null;
  error: string | null;
  /** How many live calls returned each named outcome (`observe`). */
  observed?: Record<string, number>;
  /** Required outcomes (`requires`) no live call returned. */
  missing?: string[];
};

/** The required outcomes not yet observed. */
export const missingOutcomes = (required: readonly string[] | undefined, observed: Record<string, number> | undefined): string[] =>
  (required ?? []).filter((label) => !observed?.[label]);

/** A case passes when every call matched and its plant, if any, was detected. */
export const parityPassed = (outcome: ParityOutcome): boolean =>
  outcome.error === null && outcome.compared > 0 && outcome.differences.length === 0 && outcome.plantDetected !== false
  && (outcome.missing ?? []).length === 0;

/** `or replace`: cases that share an old helper each install it. */
const orReplace = (definition: string): string => definition.replace(/^create function pg_temp\./, 'create or replace function pg_temp.');

const helperInstalls = (helpers: Record<string, string> = {}): { aliases: Record<string, string>; sql: string[] } => {
  const aliases = Object.fromEntries(Object.keys(helpers).map((helper) => [helper, `${helper}__legacy`]));
  const sql = Object.entries(helpers).map(([helper, migration]) =>
    orReplace(legacyDefinition(migrationDefinition(migration, helper), helper, aliases[helper], aliases)));
  return { aliases, sql };
};

/**
 * Helpers two cases name from different migrations. A helper's old definition
 * is installed under one alias (`<helper>__legacy`) for every case on the
 * connection, so the later install would silently replace the earlier one.
 */
export const helperConflicts = <Context>(cases: readonly ParityCase<Context>[]): string[] => {
  const seen = new Map<string, { migration: string; fn: string }>();
  const conflicts: string[] = [];
  for (const item of cases) {
    for (const [helper, migration] of Object.entries(item.helpers ?? {})) {
      const first = seen.get(helper);
      if (!first) seen.set(helper, { migration, fn: item.fn });
      else if (first.migration !== migration) {
        conflicts.push(`${helper}: ${first.fn} installs ${first.migration}, ${item.fn} installs ${migration}`);
      }
    }
  }
  return conflicts;
};

/** The statements that install a case's old definitions in pg_temp: helpers first, then the function, then its plant. */
export const parityInstallStatements = <Context>(item: ParityCase<Context>): { legacy: string; planted: string | null; sql: string[] } => {
  const { aliases: helperAliases, sql } = helperInstalls(item.helpers);
  const definition = migrationDefinition(item.migration, item.fn);
  const legacy = `${item.fn}__legacy`;
  // `or replace`: two cases may compare one RPC (different calls).
  sql.push(orReplace(legacyDefinition(definition, item.fn, legacy, helperAliases)));
  let planted: string | null = null;
  if (item.plant) {
    planted = `${item.fn}__planted`;
    sql.push(orReplace(legacyDefinition(plantDifference(definition, item.plant.from, item.plant.to), item.fn, planted, helperAliases)));
  }
  return { legacy, planted, sql };
};

export type ParityCall = (viewer: string, fn: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Calls the live RPC and its old definition for every viewer × argument set
 * and records every difference; then, if the case plants one, checks that the
 * planted definition differs from the live one somewhere.
 */
export const compareParity = async <Context>(
  item: ParityCase<Context>, context: Context, viewers: readonly string[], call: ParityCall,
  installed: { legacy: string; planted: string | null },
): Promise<ParityOutcome> => {
  const outcome: ParityOutcome = { fn: item.fn, compared: 0, differences: [], plantDetected: item.plant ? false : null, error: null };
  const sets = item.argumentSets?.(context) ?? [];
  const pairs = item.calls?.(context) ?? viewers.flatMap((viewer) => sets.map((args) => ({ viewer, args })));
  for (const [index, { viewer, args }] of pairs.entries()) {
    let [liveArgs, oldArgs] = [args, args];
    for (let page = 0; ; page += 1) {
      const live = await call(viewer, item.fn, liveArgs);
      if (item.observe) {
        const label = item.observe(live);
        outcome.observed = { ...outcome.observed, [label]: (outcome.observed?.[label] ?? 0) + 1 };
      }
      const old = await call(viewer, `pg_temp.${installed.legacy}`, oldArgs);
      outcome.compared += 1;
      const found = jsonDifference(withoutKeys(old, item.ignoreKeys), withoutKeys(live, item.ignoreKeys));
      const at = `viewer ${viewer}, arguments #${index}${item.walk ? `, page ${page}` : ''}`;
      if (found) outcome.differences.push(`${at}: ${found}`);
      if (page === 0 && installed.planted && !outcome.plantDetected) {
        outcome.plantDetected = jsonDifference(await call(viewer, `pg_temp.${installed.planted}`, args), live) !== null;
      }
      // A page that says one has more and the other not is already a difference.
      const [nextLive, nextOld] = item.walk ? [item.walk(liveArgs, live), item.walk(oldArgs, old)] : [null, null];
      if (!nextLive || !nextOld) break;
      if (page + 1 >= PARITY_MAX_PAGES) {
        outcome.differences.push(`${at}: still paging after ${PARITY_MAX_PAGES} pages`);
        break;
      }
      [liveArgs, oldArgs] = [nextLive, nextOld];
    }
  }
  if (item.requires) outcome.missing = missingOutcomes(item.requires, outcome.observed);
  return outcome;
};

/** The next page of a stream read: its `next_cursor` as `p_before` while `has_more`. */
export const streamWalk = (args: Record<string, unknown>, result: unknown): Record<string, unknown> | null => {
  const page = result as { has_more?: unknown; next_cursor?: unknown } | null;
  return page?.has_more === true && typeof page.next_cursor === 'string' ? { ...args, p_before: page.next_cursor } : null;
};

/**
 * A helper's parity: an internal function readers call (not an RPC), its old
 * and new answers compared in SQL, as the table owner, for every argument
 * row the fixture holds. `check` cases compare two expressions that need no
 * old definition (a cache against the live function it caches).
 */
export type HelperParityCase = {
  /** The case's name in the report. */
  name: string;
  /** A query over the fixture whose columns a1…aN are one call's arguments. */
  argumentsSql: string;
  /** At least this many distinct expected answers, so the case cannot pass on one answer alone. */
  minAnswers?: number;
} & (
  | {
    /** The helper, with its old definition installed as pg_temp.<fn>__legacy. */
    fn: string;
    migration: string;
    helpers?: Record<string, string>;
    /** One call as a comparable value; `{fn}` stands for the function, e.g. `{fn}(array[a1],a2,a3)`. */
    call: string;
  }
  | {
    /** The expected and actual values of one argument row, over a1…aN. */
    expected: string;
    actual: string;
  }
);

/**
 * The statements that install a helper case's old definitions (none for a
 * `check`), and the query that compares it: one row of the number of
 * argument rows compared, of distinct expected answers, and up to five rows
 * that differ, as text.
 */
export const helperParityStatements = (item: HelperParityCase): { sql: string[]; compare: string } => {
  let sql: string[] = [];
  let expected: string;
  let actual: string;
  if ('fn' in item) {
    if (!IDENT.test(item.fn)) throw new Error(`invalid function name: ${item.fn}`);
    const installs = helperInstalls(item.helpers);
    const legacy = `${item.fn}__legacy`;
    sql = [...installs.sql, orReplace(legacyDefinition(migrationDefinition(item.migration, item.fn), item.fn, legacy, installs.aliases))];
    expected = item.call.replaceAll('{fn}', `pg_temp.${legacy}`);
    actual = item.call.replaceAll('{fn}', `app_public.${item.fn}`);
  } else {
    ({ expected, actual } = item);
  }
  const compare = `select count(*)::integer as compared, count(distinct x.expected::text)::integer as answers,
    coalesce((array_agg(row(a.*)::text||': '||coalesce(x.expected::text,'null')||' ≠ '||coalesce(x.actual::text,'null'))
      filter (where x.expected is distinct from x.actual))[1:5],'{}') as differences
    from (${item.argumentsSql}) a cross join lateral (select (${expected}) as expected, (${actual}) as actual) x`;
  return { sql, compare };
};
