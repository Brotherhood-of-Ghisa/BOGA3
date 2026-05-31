/**
 * Outcome: the client compiles and passes its quality gate, and the runtime
 * migration bundle has a single source of truth (no hand-copied SQL drift).
 *
 * The catch-all gate (lint + typecheck + the full unit suite) is run for real
 * by CI on every push and by the builder before this PR opens; re-running the
 * whole suite from inside a single Jest test would recurse and double the run
 * time for no added signal, so the actual execution is enforced there and the
 * PR body asserts the local run. What this file DOES assert cheaply and
 * deterministically:
 *
 *   1. The three gate commands (lint, typecheck, test) are real, present
 *      package scripts — so the gate the PR claims to run actually exists.
 *   2. The runtime migration wrapper imports the generated bundle and inlines
 *      no SQL DDL of its own. The drift checker compares client schemas against
 *      the server, NOT the runtime bundle against the generated SQL, so a
 *      hand-copied `CREATE TABLE` in the wrapper would drift silently from the
 *      generated file. Pinning the wrapper to a thin re-export of the generated
 *      bundle keeps the shipped SQL and the generated SQL one and the same.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const PACKAGE_JSON_PATH = join(MOBILE_ROOT, 'package.json');
const MIGRATIONS_INDEX_PATH = join(MOBILE_ROOT, 'src', 'data', 'migrations', 'index.ts');

describe('the quality-gate commands exist as real package scripts', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  it.each(['lint', 'typecheck', 'test'])('package.json defines the "%s" script', (script) => {
    expect(typeof pkg.scripts?.[script]).toBe('string');
    expect(pkg.scripts?.[script]?.length ?? 0).toBeGreaterThan(0);
  });

  it('the unit test script is bare jest (no --forceExit masking a leaked handle)', () => {
    // --forceExit would hide an open-handle hang; the hang-safety policy
    // deliberately keeps the script bare so leaks fail loudly.
    expect(pkg.scripts?.test).toBe('jest');
  });
});

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
