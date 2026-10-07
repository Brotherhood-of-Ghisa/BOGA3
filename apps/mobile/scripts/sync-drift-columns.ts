/**
 * The column half of the sync schema-drift checker (check-sync-schema-drift.ts),
 * kept free of I/O so its rules are unit-tested in Jest: given one entity's
 * client SQLite columns and its server columns, report each client column with
 * no typed server counterpart (with the fix template), each type mismatch, and
 * each server column with no client counterpart.
 */

export interface ClientColumn {
  name: string;
  type: string;
}

export interface ServerColumn {
  column_name: string;
  udt_name: string;
}

export interface ColumnExemptions {
  local_only_columns: string[];
  // Server-side columns tolerated with no client counterpart.
  server_only_columns?: { column: string; rationale?: string }[];
  // Client columns whose server counterpart is intentionally untyped text.
  untyped_text_references?: { entity: string; column: string }[];
}

export type ColumnFinding =
  // Errors. A missing counterpart's message is the multi-line fix template.
  | { kind: 'type_mismatch'; message: string }
  | { kind: 'missing_server_column'; message: string }
  // Warning: exits 2 by default, FAIL under --strict.
  | { kind: 'server_only_column'; message: string };

// The wire-envelope columns (universal server-side, never declared on the
// client Drizzle side) — per docs/specs/tech/sync-v2-server-contract.md
// ("Universal columns, index and triggers").
export const WIRE_ENVELOPE_COLUMNS: ReadonlySet<string> = new Set([
  'owner_user_id',
  'client_updated_at_ms',
  'server_received_at',
]);

/**
 * sqliteType is what `pragma table_info.type` reports for a Drizzle column
 * (`text`, `integer`, `real`). udtName is what `information_schema.udt_name`
 * reports for the server column (`text`, `int4`, `int8`, `float8`, `numeric`,
 * `bool`, `uuid`, `timestamp`, `timestamptz`).
 *
 * Returns true if the pair is acceptable per this narrow map. The
 * timestamp_ms discriminator on the client is reflected as `integer` by the SQLite catalog; bigint on the
 * server is `int8`. The narrow map accepts client `integer` against either
 * `int4` or `int8`, plus the one synced SQLite boolean stored as integer.
 * Default-expression equality is NOT compared.
 */
export function isTypeCompatible(sqliteType: string, udtName: string, entity: string, wireName: string): boolean {
  const c = sqliteType.toLowerCase();
  const s = udtName.toLowerCase();
  if (c === 'text' && s === 'text') return true;
  if (c === 'integer' && (s === 'int4' || s === 'int8')) return true;
  if (c === 'integer' && s === 'bool' && entity === 'user_settings'
    && wireName === 'bodyweight_calculations_enabled') return true;
  if (c === 'real' && (s === 'float8' || s === 'numeric')) return true;
  return false;
}

export function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Every column finding for one entity: client columns first (4d), then server-only columns (4e). */
export function diffEntityColumns(
  entity: string,
  clientColumns: readonly ClientColumn[],
  serverColumns: readonly ServerColumn[],
  exemptions: ColumnExemptions,
): ColumnFinding[] {
  const findings: ColumnFinding[] = [];
  const serverByName = new Map(serverColumns.map((c) => [c.column_name, c]));
  const serverColumnsInOrder = serverColumns.map((c) => c.column_name);

  // ---- 4d: client column has typed server counterpart -------------------
  const exempt = new Set(exemptions.local_only_columns);
  const untypedTextRefs = new Set(
    (exemptions.untyped_text_references ?? [])
      .filter((r) => r.entity === entity)
      .map((r) => camelToSnake(r.column))
  );
  for (const col of clientColumns) {
    const wireName = col.name; // drizzle-kit export already uses snake_case wire names
    if (exempt.has(wireName)) continue;
    const serverCol = serverByName.get(wireName);
    if (serverCol) {
      if (!isTypeCompatible(col.type, serverCol.udt_name, entity, wireName)) {
        findings.push({
          kind: 'type_mismatch',
          message:
            `${entity}.${wireName}: type mismatch — client ${col.type} vs server ${serverCol.udt_name} (udt). ` +
            `Type-compat map: text↔text, integer↔int4|int8, real↔float8|numeric; user_settings.bodyweight_calculations_enabled integer↔bool (see isTypeCompatible).`,
        });
      }
      continue;
    }
    if (untypedTextRefs.has(wireName)) continue;
    findings.push({
      kind: 'missing_server_column',
      message: formatMissingServerCounterpart(entity, wireName, col.type, serverColumnsInOrder),
    });
  }

  // ---- 4e: server column has a client counterpart (warn-only) -----------
  const clientWireNames = new Set(clientColumns.map((c) => c.name));
  const serverOnlyExempt = new Set((exemptions.server_only_columns ?? []).map((r) => r.column));
  for (const serverCol of serverColumns) {
    if (WIRE_ENVELOPE_COLUMNS.has(serverCol.column_name)) continue;
    if (clientWireNames.has(serverCol.column_name)) continue;
    if (serverOnlyExempt.has(serverCol.column_name)) continue;
    findings.push({
      kind: 'server_only_column',
      message:
        `${entity}.${serverCol.column_name}: server has a typed column with no client counterpart. ` +
        `Either the client schema is behind a deployed migration, or this column is a stale server-side column ` +
        `that should be dropped. (Exits 2 by default; FAIL under --strict.)`,
    });
  }
  return findings;
}

// Pretty fix-template for a missing server counterpart.
export function formatMissingServerCounterpart(
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
    `  Server-first deploy is unconditional (per docs/specs/05-data-model.md, "Client schema drift rule"). Once`,
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

export function wrapColumns(cols: string[], width: number): string[] {
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
