/**
 * Outcome: the client Drizzle schemas carry the two local-only sync columns
 * and the soft-delete column on every entity that the server expects, and the
 * schema-drift checker confirms client and server schemas agree.
 *
 * Two assertions:
 *
 *   1. Running `check:sync-drift --strict` against the working tree exits 0.
 *      The checker compares every client Drizzle entity schema against the
 *      server's column set; exit 0 means the two-column additions and the
 *      added soft-delete columns line up with the server with no drift.
 *   2. The drift checker's server-only exemption for the soft-delete column is
 *      gone from the exemptions file. That exemption existed only while the
 *      client schemas lacked the column; now that the client declares it,
 *      leaving the exemption in place would mask a future legitimate-column
 *      regression — so its removal is itself part of the contract.
 *
 * The drift run is shelled out; it parses the full schema set and talks to a
 * bundled SQLite, so it gets a generous timeout (well under the per-test
 * ceiling but comfortably above the few seconds it actually takes).
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const SYNC_EXTRAS_PATH = join(MOBILE_ROOT, 'src', 'data', 'schema', 'sync-extras.json');

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

  it('no longer carries the server-only exemption that masked the soft-delete column', () => {
    const extras = JSON.parse(readFileSync(SYNC_EXTRAS_PATH, 'utf8')) as {
      exemptions?: { server_only_columns?: unknown };
    };
    // The exemption key must be absent entirely, not merely emptied — an empty
    // array would still be a standing waiver hook for the same masking.
    expect(extras.exemptions?.server_only_columns).toBeUndefined();
  });
});
