/**
 * Outcome: the drift checker's column rules flag a client column with no typed
 * server counterpart (printing the `alter table … add column` fix template), a
 * type mismatch, and a server-only column, and honour every exemption.
 *
 * Infra-free: these are the pure rules the checker applies per entity. The
 * checker's CLI wiring (a real drifted schema exits non-zero under --strict)
 * stays in the backend's synthetic-drift body; its positive run over the
 * as-built tree is `drift-check.test.ts`'s and the `sync-drift` lane's.
 */

import {
  diffEntityColumns, isTypeCompatible, wrapColumns, type ColumnExemptions, type ServerColumn,
} from '../../scripts/sync-drift-columns';

const noExemptions: ColumnExemptions = { local_only_columns: [] };
const envelope: ServerColumn[] = [
  { column_name: 'owner_user_id', udt_name: 'uuid' },
  { column_name: 'client_updated_at_ms', udt_name: 'int8' },
  { column_name: 'server_received_at', udt_name: 'timestamptz' },
];
const serverSets: ServerColumn[] = [
  { column_name: 'id', udt_name: 'text' },
  { column_name: 'reps_value', udt_name: 'text' },
  { column_name: 'created_at', udt_name: 'int8' },
  ...envelope,
];
const clientSets = [
  { name: 'id', type: 'text' },
  { name: 'reps_value', type: 'text' },
  { name: 'created_at', type: 'integer' },
];

describe('sync drift column rules', () => {
  it('finds nothing when every client column has a typed counterpart and the server adds only the envelope', () => {
    expect(diffEntityColumns('exercise_sets', clientSets, serverSets, noExemptions)).toEqual([]);
  });

  it('flags a client-only column with the fix template naming the table, the column and its server type', () => {
    const findings = diffEntityColumns(
      'exercise_sets', [...clientSets, { name: 'notes', type: 'text' }], serverSets, noExemptions,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('missing_server_column');
    expect(findings[0].message).toContain('✗ exercise_sets: client column "notes" (text) has no server counterpart.');
    expect(findings[0].message).toContain('    alter table app_public.exercise_sets\n      add column notes text;');
    // It lists what the server does have, envelope included, so the gap is visible.
    expect(findings[0].message).toContain(
      '    id, reps_value, created_at, owner_user_id, client_updated_at_ms,\n    server_received_at\n',
    );
  });

  it.each([
    ['integer', 'bigint'],
    ['real', 'double precision'],
    ['text', 'text'],
    ['blob', 'text'],
  ])('maps a %s client column to server type %s', (sqliteType, pgType) => {
    const [finding] = diffEntityColumns('gyms', [{ name: 'extra_value', type: sqliteType }], [], noExemptions);

    expect(finding.message).toContain(`add column extra_value ${pgType};`);
  });

  it('skips local-only columns, and untyped-text references only on their own entity', () => {
    const client = [{ name: 'local_dirty', type: 'integer' }, { name: 'gym_ref', type: 'text' }];
    const exemptions: ColumnExemptions = {
      local_only_columns: ['local_dirty'],
      untyped_text_references: [{ entity: 'sessions', column: 'gymRef' }],
    };

    expect(diffEntityColumns('sessions', client, [], exemptions)).toEqual([]);
    expect(diffEntityColumns('gyms', client, [], exemptions).map((f) => f.message)).toEqual([
      expect.stringContaining('gyms: client column "gym_ref"'),
    ]);
  });

  it('reports a type mismatch as an error, not a missing column', () => {
    const findings = diffEntityColumns(
      'exercise_sets', [{ name: 'reps_value', type: 'integer' }], [{ column_name: 'reps_value', udt_name: 'text' }],
      noExemptions,
    );

    expect(findings).toEqual([{
      kind: 'type_mismatch',
      message: expect.stringContaining('exercise_sets.reps_value: type mismatch — client integer vs server text (udt).'),
    }]);
  });

  it('warns on a server column the client lacks, except the envelope and exempted columns', () => {
    const server: ServerColumn[] = [
      ...serverSets,
      { column_name: 'legacy_note', udt_name: 'text' },
      { column_name: 'tolerated', udt_name: 'text' },
    ];
    const findings = diffEntityColumns('exercise_sets', clientSets, server, {
      local_only_columns: [], server_only_columns: [{ column: 'tolerated' }],
    });

    expect(findings).toEqual([{
      kind: 'server_only_column',
      message: expect.stringContaining('exercise_sets.legacy_note: server has a typed column with no client counterpart.'),
    }]);
  });

  it('orders client-column findings before server-only warnings', () => {
    const findings = diffEntityColumns(
      'gyms', [{ name: 'notes', type: 'text' }], [{ column_name: 'legacy', udt_name: 'text' }], noExemptions,
    );

    expect(findings.map((f) => f.kind)).toEqual(['missing_server_column', 'server_only_column']);
  });

  it('accepts only the narrow type-compat map', () => {
    expect(isTypeCompatible('TEXT', 'text', 'gyms', 'name')).toBe(true);
    expect(isTypeCompatible('integer', 'int4', 'gyms', 'n')).toBe(true);
    expect(isTypeCompatible('integer', 'int8', 'gyms', 'n')).toBe(true);
    expect(isTypeCompatible('real', 'float8', 'gyms', 'n')).toBe(true);
    expect(isTypeCompatible('real', 'numeric', 'gyms', 'n')).toBe(true);
    expect(isTypeCompatible('integer', 'bool', 'user_settings', 'bodyweight_calculations_enabled')).toBe(true);
    expect(isTypeCompatible('integer', 'bool', 'user_settings', 'other_flag')).toBe(false);
    expect(isTypeCompatible('integer', 'bool', 'gyms', 'bodyweight_calculations_enabled')).toBe(false);
    expect(isTypeCompatible('text', 'uuid', 'gyms', 'id')).toBe(false);
    expect(isTypeCompatible('real', 'int8', 'gyms', 'n')).toBe(false);
  });

  it('wraps the server column list at the width, keeping a trailing comma on every broken line', () => {
    expect(wrapColumns(['aaaa', 'bbbb', 'cccc'], 10)).toEqual(['aaaa, bbbb,', 'cccc']);
    // A single column longer than the width still gets its own line.
    expect(wrapColumns(['a_very_long_column_name', 'b'], 10)).toEqual(['a_very_long_column_name,', 'b']);
    expect(wrapColumns([], 10)).toEqual([]);
  });
});
