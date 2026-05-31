/**
 * Outcome: the drift checker's server-only exemption for the soft-delete column
 * is gone from the schema-extras file. That exemption existed only while the
 * client schemas lacked the column; now that the client declares it, leaving
 * the exemption in place would mask a future legitimate-column regression — so
 * its removal is itself part of the contract.
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

describe('schema drift exemptions', () => {
  it('no longer carries the server-only exemption that masked the soft-delete column', () => {
    const extras = JSON.parse(readFileSync(SYNC_EXTRAS_PATH, 'utf8')) as {
      exemptions?: { server_only_columns?: unknown };
    };
    // The exemption key must be absent entirely, not merely emptied — an empty
    // array would still be a standing waiver hook for the same masking.
    expect(extras.exemptions?.server_only_columns).toBeUndefined();
  });
});
