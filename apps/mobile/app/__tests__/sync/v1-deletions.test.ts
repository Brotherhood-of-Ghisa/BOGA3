/**
 * Outcome: the old sync stack is gone.
 *
 * The previous-generation client sync engine lived under
 * `apps/mobile/src/sync/` as a set of source files (engine, outbox, bootstrap,
 * runtime, profile-status, types) and exported a family of call-site symbols
 * (an event-enqueue API, an outbox flush, network/transport-state setters,
 * backoff constants, a path-derived cadence helper). The current sync design
 * deletes that stack wholesale and rebuilds from a clean slate.
 *
 * This file asserts that reality two ways:
 *
 *   1. The deleted source files no longer exist. `scheduler.ts` is the one
 *      exception: a NEW scheduler ships under the same path, so instead of
 *      asserting absence we read its contents and assert it is the new
 *      four-state machine (it names the four states and uses NetInfo as the
 *      reachability authority) rather than the old engine.
 *   2. None of the old call-site symbols appears anywhere under
 *      `apps/mobile/src/` or `apps/mobile/app/` — a regression that
 *      re-introduced any of them (a stray import, a copy-pasted helper) would
 *      light up here.
 *
 * The symbols below are real code identifiers from the deleted engine, not
 * documentation references, so grepping for them is the correct check.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..', '..');
const SYNC_DIR = join(MOBILE_ROOT, 'src', 'sync');

// The roots the production app is bundled from. The test tree itself is
// excluded — these very assertions name the deleted symbols as string literals.
const SCANNED_ROOTS = [join(MOBILE_ROOT, 'src'), join(MOBILE_ROOT, 'app')];
const TEST_DIR_NAME = '__tests__';

/** Recursively lists every .ts/.tsx file under a root, skipping the test tree. */
const collectSourceFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === TEST_DIR_NAME || entry === 'node_modules') {
        continue;
      }
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
};

describe('the previous-generation sync source files are gone', () => {
  // These files were the body of the old engine and were deleted outright.
  const deletedFiles = [
    'engine.ts',
    'outbox.ts',
    'bootstrap.ts',
    'runtime.ts',
    'profile-status.ts',
    'types.ts',
  ];

  it.each(deletedFiles)('does not ship src/sync/%s', (file) => {
    expect(existsSync(join(SYNC_DIR, file))).toBe(false);
  });

  it('ships a NEW scheduler.ts that is the four-state machine, not the old engine', () => {
    const schedulerPath = join(SYNC_DIR, 'scheduler.ts');
    expect(existsSync(schedulerPath)).toBe(true);

    const source = readFileSync(schedulerPath, 'utf8');
    // The new scheduler names its four states and uses NetInfo as the
    // reachability authority — markers that are absent from the deleted engine.
    expect(source).toContain('four-state machine');
    expect(source).toContain('NetInfo');
    for (const stateName of ['OFFLINE', 'LONG_TIMEOUT', 'SHORT_TIMEOUT', 'RUNNING']) {
      expect(source).toContain(stateName);
    }
  });
});

describe('no old sync call-site symbol survives anywhere in the app source', () => {
  // Real exported identifiers from the deleted engine. Any survivor is a
  // dangling reference to code that no longer exists.
  const forbiddenSymbols = [
    'enqueueSyncEvent',
    'enqueueSyncEvents',
    'enqueueSyncEventsTx',
    'flushSyncOutbox',
    'startDefaultSyncScheduler',
    'setDefaultSyncCadenceContextFromPathname',
    'setSyncNetworkOnline',
    'recordSyncTransportFailure',
    'SYNC_BACKOFF_INITIAL_DELAY_MS',
    'SYNC_SESSION_RECORDER_CADENCE_MS',
    'syncCadenceContextFromPathname',
    'SyncEventEnvelope',
    'SyncIngestRequest',
  ];

  const allSources = SCANNED_ROOTS.flatMap(collectSourceFiles);

  it('scans a non-trivial number of source files', () => {
    // Guards against the walk silently scanning nothing (e.g. a moved root):
    // a zero-hit pass would otherwise pass vacuously.
    expect(allSources.length).toBeGreaterThan(50);
  });

  it.each(forbiddenSymbols)('no source file references %s', (symbol) => {
    const offenders = allSources.filter((file) => readFileSync(file, 'utf8').includes(symbol));
    expect(offenders).toEqual([]);
  });
});
