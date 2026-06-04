/**
 * Launch outcome — every previous-generation sync CODE PATH is gone, not
 * coexisting with the current design.
 *
 * The launch contract enumerates the old client sync stack by the concrete
 * shapes that defined it: the engine and outbox source files, the per-entity
 * event TYPES the outbox enqueued, the per-device SEQUENCE COUNTERS that ordered
 * those events, and the BATCH ENVELOPE the ingest request wrapped them in. The
 * current design replaces all of it with a direct push/pull cycle, so none of
 * those shapes may survive anywhere the production app is bundled from.
 *
 * This guard asserts that, source-level and infra-free, two ways:
 *
 *   1. The engine and outbox source files no longer exist.
 *   2. None of the event-type / sequence-counter / batch-envelope identifiers
 *      that defined the old request shape appears in any bundled source file.
 *
 * The four retired SERVER objects named by the same outcome
 * (`sync_apply_projection_event`, `sync_events_ingest`,
 * `sync_device_ingest_state`, `sync_ingested_events`) cannot be checked from a
 * pure unit test — they live in Postgres, not the app bundle. Their absence is
 * asserted behaviourally against the real endpoint by the infra-lane suite at
 * `app/__tests__/sync/no-v1-server-objects.test.ts`; the names are pinned here as
 * a literal contract so the two halves of the outcome stay enumerated together
 * and a reviewer can cross-check coverage. (The current scheduler reuses the old
 * `scheduler.ts` path but is a wholly new four-state machine — its content is
 * asserted elsewhere — so this guard never claims that path is absent.)
 *
 * The identifiers below are real code tokens from the deleted stack, so grepping
 * the bundled source for them is the correct check. The test tree itself is
 * excluded from the scan, since these very assertions name the tokens as string
 * literals.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const MOBILE_ROOT = join(__dirname, '..', '..');
const SYNC_DIR = join(MOBILE_ROOT, 'src', 'sync');
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

describe('the previous-generation sync code-path source files are gone', () => {
  // The two files the outcome names by path: the event engine and its outbox.
  const deletedFiles = ['engine.ts', 'outbox.ts'];

  it.each(deletedFiles)('does not ship src/sync/%s', (file) => {
    expect(existsSync(join(SYNC_DIR, file))).toBe(false);
  });
});

describe('no v1 event-type / sequence-counter / batch-envelope token survives in bundled source', () => {
  // The concrete identifiers the old request shape was built from:
  //   - event types: the per-entity event-envelope type and its ingest wrapper;
  //   - sequence counters: the per-device monotonic ordering field;
  //   - batch envelopes: the batch id and the enqueue API that grouped events.
  const forbiddenTokens = [
    // event types
    'SyncEventEnvelope',
    'SyncIngestRequest',
    'event_id',
    // sequence counters
    'sequence_in_device',
    'sequenceInDevice',
    // batch envelopes
    'batch_id',
    'batchId',
    'enqueueSyncEvent',
    'flushSyncOutbox',
  ];

  const allSources = SCANNED_ROOTS.flatMap(collectSourceFiles);

  it('scans a non-trivial number of source files', () => {
    // Guards against the walk silently scanning nothing (a moved root would
    // otherwise let every assertion below pass vacuously).
    expect(allSources.length).toBeGreaterThan(50);
  });

  it.each(forbiddenTokens)('no bundled source file references %s', (token) => {
    const offenders = allSources.filter((file) => readFileSync(file, 'utf8').includes(token));
    expect(offenders).toEqual([]);
  });
});

describe('the retired v1 server objects are enumerated for the infra-lane check', () => {
  // The four server objects the outcome names. They cannot be probed from a unit
  // test (they live in Postgres); the infra-lane suite asserts their absence
  // against the real endpoint. Pinning the list here keeps both halves of the
  // outcome enumerated together and fails loudly if the contract list drifts.
  const RETIRED_V1_SERVER_OBJECTS = [
    'sync_apply_projection_event',
    'sync_events_ingest',
    'sync_device_ingest_state',
    'sync_ingested_events',
  ];

  it('names exactly the four retired server objects', () => {
    expect(RETIRED_V1_SERVER_OBJECTS).toEqual([
      'sync_apply_projection_event',
      'sync_events_ingest',
      'sync_device_ingest_state',
      'sync_ingested_events',
    ]);
  });
});
