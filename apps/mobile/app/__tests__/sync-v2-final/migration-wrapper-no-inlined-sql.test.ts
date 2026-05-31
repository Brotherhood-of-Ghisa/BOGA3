/**
 * Outcome: the runtime migration bundle has a single source of truth — the
 * wrapper re-exports the generated migration bundle and inlines no SQL DDL of
 * its own.
 *
 * The schema-drift checker compares the client Drizzle schemas against the
 * server; it does NOT compare the runtime migration wrapper against the
 * generated `.sql` files. So a hand-copied `CREATE TABLE` in the wrapper would
 * drift silently from the generated SQL with nothing to catch it. Pinning the
 * wrapper to a thin re-export of the generated bundle keeps the SQL the app
 * ships and the SQL the generator produces one and the same.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_INDEX_PATH = join(MOBILE_ROOT, 'src', 'data', 'migrations', 'index.ts');

describe('the runtime migration wrapper carries no inlined SQL drift', () => {
  const source = readFileSync(MIGRATIONS_INDEX_PATH, 'utf8');

  it('imports the generated migration bundle', () => {
    expect(/from\s+['"][^'"]*migrations\.generated['"]/.test(source)).toBe(true);
  });

  it('contains no inlined DDL tokens', () => {
    // A hand-copied schema would carry DDL keywords; the wrapper must not.
    for (const ddlToken of ['CREATE TABLE', 'create table', 'ALTER TABLE', 'alter table']) {
      expect(source.includes(ddlToken)).toBe(false);
    }
  });
});
