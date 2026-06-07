/**
 * Outcome: the client Drizzle schemas carry the two local-only sync columns
 * and the soft-delete column on every entity that the server expects, and the
 * schema-drift checker confirms client and server schemas agree.
 *
 * This shells out to `check:sync-drift --strict --skip-reset` and asserts it
 * exits 0. The checker compares every client Drizzle entity schema against the
 * server's column set; exit 0 means the two-column additions and the added
 * soft-delete columns line up with the server with no drift.
 *
 * It also asserts the checker introspected the full set of nine owner-scoped
 * entity tables — the muscle-group taxonomy is now a real per-user entity table
 * derived from the live schema alongside the original eight. Exit 0 with that
 * table present transitively proves the muscle-group FK column has a typed
 * server counterpart and its parent table sits at a valid topological layer
 * (the checker fails on an untyped FK column or a same-layer/inverted FK edge).
 *
 * `--skip-reset` is load-bearing here: the dedicated infra script
 * (`test:sync:infra`) runs `ensure-local-runtime-baseline.sh` first, whose
 * `apply_pending_local_migrations` (`db push --local --include-all`) has already
 * materialized the server schema on the shared stack. Without `--skip-reset` the
 * checker would shell a *redundant* `supabase db reset` mid-lane, dropping
 * `auth.users` and wiping the GoTrue `user_a` fixture the sibling sign-in suites
 * depend on. With `--skip-reset` this becomes a pure read-only introspection +
 * diff against the already-migrated baseline: it cannot wipe the fixture or race
 * the round-trip, so the lane is order-independent. (Standalone / `quality-slow
 * backend` runs of the checker still reset by default to materialize the schema
 * themselves; only this in-lane invocation skips it.) It still needs a local
 * Postgres/Supabase stack to introspect — it is therefore an INFRA-DEPENDENT
 * test, excluded from the fast lane and run only via the dedicated infra
 * script. The infra-free half of the original drift coverage (the stale
 * exemptions are gone from the schema-extras file) lives in
 * `drift-exemption-removed.test.ts`, which stays in the fast lane.
 *
 * The drift run is shelled out; it parses the full schema set and talks to the
 * database, so it gets a generous timeout (well under the per-test ceiling but
 * comfortably above the few seconds it actually takes once the stack is up).
 */

import { spawnSync } from 'child_process';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');

describe('schema drift checker', () => {
  it('exits 0 against the as-built client schemas under --strict and covers all nine entities', () => {
    const result = spawnSync(
      'npm',
      ['run', 'check:sync-drift', '--', '--strict', '--skip-reset'],
      {
        cwd: MOBILE_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      },
    );

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const exitCode = typeof result.status === 'number' ? result.status : 1;

    if (exitCode !== 0) {
      // Surface the checker's own output so a real drift is diagnosable from
      // the test log rather than just a bare non-zero exit.
      console.error(`check:sync-drift failed (exit ${exitCode}):\n${stdout}\n${stderr}`);
    }
    expect(exitCode).toBe(0);

    // The checker logs the live entity-table set it introspected. There are nine
    // owner-scoped entity tables, including the muscle-group taxonomy, which is
    // now a real per-user entity rather than a client-only table.
    const combined = `${stdout}\n${stderr}`;
    const introspectMatch = combined.match(/introspecting (\d+) entity table\(s\): (.+)/);
    expect(introspectMatch).not.toBeNull();
    expect(Number(introspectMatch?.[1])).toBe(9);
    expect(introspectMatch?.[2]).toContain('muscle_groups');
  }, 130_000);
});
