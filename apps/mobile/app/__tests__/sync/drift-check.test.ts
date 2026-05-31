/**
 * Outcome: the client Drizzle schemas carry the two local-only sync columns
 * and the soft-delete column on every entity that the server expects, and the
 * schema-drift checker confirms client and server schemas agree.
 *
 * This shells out to `check:sync-drift --strict` and asserts it exits 0. The
 * checker compares every client Drizzle entity schema against the server's
 * column set; exit 0 means the two-column additions and the added soft-delete
 * columns line up with the server with no drift.
 *
 * The checker drives a database reset to materialize the server schema, so it
 * needs a local Postgres/Supabase stack — it is therefore an INFRA-DEPENDENT
 * test, excluded from the fast lane and run only via the dedicated infra
 * script. The infra-free half of the original drift coverage (the server-only
 * exemption is gone from the schema-extras file) lives in
 * `drift-exemption-removed.test.ts`, which stays in the fast lane.
 *
 * The drift run is shelled out; it parses the full schema set and talks to the
 * database, so it gets a generous timeout (well under the per-test ceiling but
 * comfortably above the few seconds it actually takes once the stack is up).
 */

import { execFileSync } from 'child_process';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');

describe('schema drift checker', () => {
  it('exits 0 against the as-built client schemas under --strict', () => {
    let exitCode = 0;
    try {
      execFileSync('npm', ['run', 'check:sync-drift', '--', '--strict'], {
        cwd: MOBILE_ROOT,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 120_000,
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      exitCode = typeof status === 'number' ? status : 1;
      // Surface the checker's own output so a real drift is diagnosable from
      // the test log rather than just a bare non-zero exit.
      const stdout = (error as { stdout?: string }).stdout ?? '';
      const stderr = (error as { stderr?: string }).stderr ?? '';
      console.error(`check:sync-drift failed (exit ${exitCode}):\n${stdout}\n${stderr}`);
    }
    expect(exitCode).toBe(0);
  }, 130_000);
});
