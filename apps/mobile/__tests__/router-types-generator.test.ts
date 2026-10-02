/**
 * Expo Router declares every `.ts`/`.tsx` file under `app/` as a typed route, in
 * both `expo start` and the headless generator (`scripts/generate-router-types.js`,
 * run before every `typecheck`). Each test file declared as a route widens the
 * `Href` union until `tsc` fails with TS2590, so Jest files live in `__tests__/`
 * at the project root, never under `app/`.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const projectRoot = resolve(__dirname, '..');
const appRoot = join(projectRoot, 'app');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

it('keeps every test file and test helper out of the route tree', () => {
  const testFiles = filesUnder(appRoot)
    .map((file) => relative(projectRoot, file))
    .filter((file) => /(^|\/)__tests__\//.test(file) || /\.(test|spec)\.[tj]sx?$/.test(file));

  expect(testFiles).toEqual([]);
});

it('declares app routes and no test file', () => {
  execFileSync(process.execPath, [resolve(projectRoot, 'scripts/generate-router-types.js')], {
    cwd: projectRoot,
    stdio: 'pipe',
  });
  const declaration = readFileSync(resolve(projectRoot, '.expo/types/router.d.ts'), 'utf8');

  expect(declaration).toContain('/completed-session/[sessionId]');
  expect(declaration).toContain('/exercise-history');
  expect(declaration).not.toContain('__tests__');
  expect(declaration).not.toMatch(/\.test\b/);
});
