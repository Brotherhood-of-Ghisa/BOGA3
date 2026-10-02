/**
 * The headless typed-routes generator (`scripts/generate-router-types.js`,
 * run before every `typecheck`) declares the real routes and none of the Jest
 * files under `app/__tests__`. Each test file declared as a route widens the
 * `Href` union until `tsc` fails with TS2590.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');

it('declares app routes and leaves the Jest files out', () => {
  execFileSync(process.execPath, [resolve(projectRoot, 'scripts/generate-router-types.js')], {
    cwd: projectRoot,
    stdio: 'pipe',
  });
  const declaration = readFileSync(resolve(projectRoot, '.expo/types/router.d.ts'), 'utf8');

  expect(declaration).toContain('/completed-session/[sessionId]');
  expect(declaration).toContain('/exercise-history');
  expect(declaration).not.toContain('__tests__');
});
