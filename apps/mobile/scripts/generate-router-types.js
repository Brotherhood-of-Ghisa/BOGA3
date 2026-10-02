#!/usr/bin/env node

/**
 * Why this exists:
 * - Expo Router typed route declarations in `.expo/types/router.d.ts` are generated when the
 *   Expo dev server starts.
 * - Our local `typecheck` / `quality-fast` flow can run in a headless shell without `npx expo start`.
 * - When route types are stale, `tsc` fails with false-positive navigation path type errors.
 *
 * Important caveat:
 * - This script uses `expo-router/build/*` internals (not a documented public CLI/API for typegen).
 * - It is a pragmatic reliability fix for headless checks and may need updates when Expo Router changes.
 */
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const appRoot = path.join(projectRoot, 'app');
  const outputDir = path.join(projectRoot, '.expo', 'types');
  const outputFile = path.join(outputDir, 'router.d.ts');

  const requireContextPonyfill = require('expo-router/build/testing-library/require-context-ponyfill').default;
  const { EXPO_ROUTER_CTX_IGNORE } = require('expo-router/_ctx-shared');
  // Since SDK 57 the generator lives in `@expo/router-server`, a dependency of `@expo/cli`
  // (itself nested under `expo`), so resolve it the way the CLI does.
  const expoCliDir = path.dirname(
    require.resolve('@expo/cli/package.json', { paths: [path.dirname(require.resolve('expo/package.json'))] }),
  );
  const { getTypedRoutesDeclarationFile } = require(
    require.resolve('@expo/router-server/build/typed-routes/generate', { paths: [expoCliDir] }),
  );

  // Jest files under `app/__tests__` are not routes. Left in, each one widens the
  // `Href` union until `tsc` fails with TS2590 ("union type too complex").
  const routeFiles = new RegExp(`^(?!\\./__tests__/)${EXPO_ROUTER_CTX_IGNORE.source.slice(1)}`, EXPO_ROUTER_CTX_IGNORE.flags);
  const ctx = requireContextPonyfill(appRoot, true, routeFiles);
  const declaration = getTypedRoutesDeclarationFile(ctx, {});

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, declaration);

  console.log(`[router-types] wrote ${path.relative(projectRoot, outputFile)}`);
}

main();
