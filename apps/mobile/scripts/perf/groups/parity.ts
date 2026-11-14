// Parity: a rewritten RPC must return the same JSON as the definition it
// replaces. The old definition is copied verbatim from the migration that
// created it and installed as a pg_temp function for this session only, so
// old and new run side by side on the same fixture, as the same caller, inside
// the rolled-back transaction. Pure helpers here; the read-path set runs the
// registered cases (`PARITY_CASES` in read-path.ts).

import { readFileSync } from 'node:fs';
import path from 'node:path';

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
  argumentSets: (context: Context) => Record<string, unknown>[];
  /** The helper's self-check: one text replacement that must change the JSON. */
  plant?: { from: string; to: string };
};

export type ParityOutcome = {
  fn: string;
  compared: number;
  differences: string[];
  /** Whether the planted definition was told apart; null without a plant. */
  plantDetected: boolean | null;
  error: string | null;
};

/** A case passes when every call matched and its plant, if any, was detected. */
export const parityPassed = (outcome: ParityOutcome): boolean =>
  outcome.error === null && outcome.compared > 0 && outcome.differences.length === 0 && outcome.plantDetected !== false;

/** The statements that install a case's old definitions in pg_temp: helpers first, then the function, then its plant. */
export const parityInstallStatements = <Context>(item: ParityCase<Context>): { legacy: string; planted: string | null; sql: string[] } => {
  const helperAliases = Object.fromEntries(Object.keys(item.helpers ?? {}).map((helper) => [helper, `${helper}__legacy`]));
  const sql = Object.entries(item.helpers ?? {}).map(([helper, migration]) =>
    legacyDefinition(migrationDefinition(migration, helper), helper, helperAliases[helper], helperAliases));
  const definition = migrationDefinition(item.migration, item.fn);
  const legacy = `${item.fn}__legacy`;
  sql.push(legacyDefinition(definition, item.fn, legacy, helperAliases));
  let planted: string | null = null;
  if (item.plant) {
    planted = `${item.fn}__planted`;
    sql.push(legacyDefinition(plantDifference(definition, item.plant.from, item.plant.to), item.fn, planted, helperAliases));
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
  const sets = item.argumentSets(context);
  for (const viewer of viewers) {
    for (const [index, args] of sets.entries()) {
      const live = await call(viewer, item.fn, args);
      const old = await call(viewer, `pg_temp.${installed.legacy}`, args);
      outcome.compared += 1;
      const found = jsonDifference(old, live);
      if (found) outcome.differences.push(`viewer ${viewer}, arguments #${index}: ${found}`);
      if (installed.planted && !outcome.plantDetected) {
        outcome.plantDetected = jsonDifference(await call(viewer, `pg_temp.${installed.planted}`, args), live) !== null;
      }
    }
  }
  return outcome;
};
