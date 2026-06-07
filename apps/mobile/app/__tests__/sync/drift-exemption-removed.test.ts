/**
 * Outcome: stale drift-checker exemptions that would mask a real schema
 * regression are gone from the schema-extras file.
 *
 * Two exemptions were waivers granted only while a column had no real
 * counterpart on the other side of the wire:
 *
 *   - a server-only exemption that existed while the client schemas lacked the
 *     soft-delete column; and
 *   - an untyped-text-reference exemption for the mapping table's muscle-group
 *     foreign-key column, granted while the muscle-group taxonomy was a
 *     client-only table with no typed server column to point at.
 *
 * Both are now backed by real typed columns, so leaving the waivers in place
 * would silence a future legitimate-column regression — their removal is itself
 * part of the contract.
 *
 * This is a pure file read with no external dependency, so it stays in the fast
 * test lane as an infra-free regression guard. The companion assertion that the
 * full drift checker exits 0 under `--strict` needs a local Postgres stack and
 * lives in the dedicated infra lane (see `drift-check.test.ts`).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const SYNC_EXTRAS_PATH = join(MOBILE_ROOT, 'src', 'data', 'schema', 'sync-extras.json');

interface SyncExtras {
  exemptions?: {
    server_only_columns?: unknown;
    untyped_text_references?: { entity: string; column: string }[];
  };
}

function loadExtras(): SyncExtras {
  return JSON.parse(readFileSync(SYNC_EXTRAS_PATH, 'utf8')) as SyncExtras;
}

describe('schema drift exemptions', () => {
  it('no longer carries the server-only exemption that masked the soft-delete column', () => {
    const extras = loadExtras();
    // The exemption key must be absent entirely, not merely emptied — an empty
    // array would still be a standing waiver hook for the same masking.
    expect(extras.exemptions?.server_only_columns).toBeUndefined();
  });

  it('no longer carries the untyped-text waiver for the mapping muscle-group FK column', () => {
    const extras = loadExtras();
    const refs = extras.exemptions?.untyped_text_references ?? [];
    // The mapping table's muscle-group FK column must NOT be waived anymore: the
    // muscle-group taxonomy is now a real typed entity table, so the checker has
    // to enforce the typed-column rule on this FK like any other column.
    const waived = refs.some(
      (r) => r.entity === 'exercise_muscle_mappings' && r.column === 'muscleGroupId',
    );
    expect(waived).toBe(false);
  });

  it('drops the untyped-text-references key entirely once its last entry is gone', () => {
    const extras = loadExtras();
    // The waiver list was a single-entry list; with that entry removed the key
    // is dropped rather than left as an empty standing hook for re-masking.
    expect(extras.exemptions?.untyped_text_references).toBeUndefined();
  });
});
