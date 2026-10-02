/**
 * Jest's SQLite must track the device's (docs/specs/06-testing-strategy.md,
 * "In-memory SQLite unit tests"): the in-memory fixture runs on the SQLite that
 * `better-sqlite3` bundles, the app on the one `expo-sqlite` vendors into the
 * iOS build. A different minor version can accept SQL the device rejects (or
 * the reverse), so the two must share major.minor.
 *
 * When this fails after an Expo SDK or `better-sqlite3` upgrade, pin
 * `better-sqlite3` (exact version, devDependencies) to a release whose bundled
 * SQLite (`deps/download.sh`, `VERSION=`) matches the vendored header below.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

const mobileRoot = path.resolve(__dirname, '..');

const majorMinor = (version: string) => version.split('.').slice(0, 2).join('.');

// expo-sqlite's podspec vendors `sqlcipher` when the app enables SQLCipher
// (the `useSQLCipher` config-plugin option), `sqlite3` otherwise.
const deviceSqliteVersion = (): string => {
  const appConfig = readFileSync(path.join(mobileRoot, 'app.config.ts'), 'utf8');
  const vendor = /useSQLCipher\s*:\s*true/.test(appConfig) ? 'sqlcipher' : 'sqlite3';
  const header = readFileSync(
    path.join(mobileRoot, 'node_modules/expo-sqlite/vendor', vendor, 'sqlite3.h'),
    'utf8'
  );
  const match = header.match(/#define SQLITE_VERSION\s+"([\d.]+)"/);
  if (!match) {
    throw new Error(`No SQLITE_VERSION in expo-sqlite/vendor/${vendor}/sqlite3.h`);
  }
  return match[1];
};

const jestSqliteVersion = (): string => {
  const client = new Database(':memory:');
  try {
    return (client.prepare('select sqlite_version() as version').get() as { version: string })
      .version;
  } finally {
    client.close();
  }
};

it("runs Jest on the device's SQLite major.minor", () => {
  const device = deviceSqliteVersion();
  const bundled = jestSqliteVersion();

  // Both full versions show in the failure diff; only major.minor must agree.
  expect({ majorMinor: majorMinor(bundled), jest: bundled, device }).toEqual({
    majorMinor: majorMinor(device),
    jest: bundled,
    device,
  });
});
