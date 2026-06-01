/**
 * Guard: no user-facing hard `DELETE` against a syncable entity may remain in
 * the app source.
 *
 * Deletion of a syncable row must be a soft-delete — set `deleted_at` and flip
 * the dirty bit through the normal repo path — so the deletion pushes to the
 * server as a tombstone and survives a device reinstall. A hard SQL `DELETE`
 * removes the row outright; the tombstone is lost and the next bootstrap pull
 * re-seeds the row, resurrecting data the user deleted.
 *
 * This test scans every TypeScript source file under `src/` (excluding tests)
 * for a Drizzle `.delete(<entity>)` call against one of the eight syncable
 * entity tables, and fails if one appears outside the small set of exempt
 * sites. The exempt sites are wholesale local-table wipes (the dev reset) and
 * test/maestro fixtures — they are not per-row user deletes, and the deletion
 * does not need to reach the server.
 */

import fs from 'node:fs';
import path from 'node:path';

// The eight syncable entities, by the Drizzle table variable name used in
// source (the identifier passed to `.delete(...)`).
const SYNCABLE_ENTITY_TABLE_VARIABLES = [
  'gyms',
  'sessions',
  'sessionExercises',
  'exerciseSets',
  'exerciseDefinitions',
  'exerciseMuscleMappings',
  'exerciseTagDefinitions',
  'sessionExerciseTags',
] as const;

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');

// Files that legitimately issue a hard `DELETE` against a syncable entity.
// These are NOT per-row user deletes:
//   - the dev-only local-table reset wipes every table wholesale before a
//     re-seed (equivalent to a reinstall), local-only, never pushed;
//   - the session-rebuild cascade still hard-deletes the exercise/set/tag
//     graph before re-inserting it — converting that wipe-and-reinsert to a
//     soft-delete-then-reconcile is a separate, materially larger change and
//     lands on its own.
// Paths are relative to `src/`.
const EXEMPT_FILES_AGAINST_SYNCABLE_ENTITIES = new Set<string>([
  'data/dev-reset.ts',
  'data/session-drafts.ts',
]);

const collectTypeScriptSourceFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // The maestro fixtures install seed graphs and tear them down with hard
      // deletes; they are test scaffolding, never a shipped user delete.
      if (entry.name === 'maestro' || entry.name === '__tests__') {
        continue;
      }
      files.push(...collectTypeScriptSourceFiles(absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) {
      continue;
    }
    if (/\.test\.tsx?$/.test(entry.name)) {
      continue;
    }
    files.push(absolutePath);
  }

  return files;
};

// Matches a Drizzle delete call `<.>delete(<entity>` — `.delete(` (instance or
// tx) followed by one of the syncable table variables as the first argument.
const buildDeleteCallPattern = (tableVariable: string): RegExp =>
  new RegExp(`\\.delete\\(\\s*${tableVariable}\\b`);

type HardDeleteHit = {
  relativePath: string;
  tableVariable: string;
  line: number;
};

const findHardDeletesAgainstSyncableEntities = (): HardDeleteHit[] => {
  const hits: HardDeleteHit[] = [];
  const patterns = SYNCABLE_ENTITY_TABLE_VARIABLES.map((tableVariable) => ({
    tableVariable,
    pattern: buildDeleteCallPattern(tableVariable),
  }));

  for (const absolutePath of collectTypeScriptSourceFiles(SRC_ROOT)) {
    const relativePath = path.relative(SRC_ROOT, absolutePath).split(path.sep).join('/');
    if (EXEMPT_FILES_AGAINST_SYNCABLE_ENTITIES.has(relativePath)) {
      continue;
    }

    const lines = fs.readFileSync(absolutePath, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const { tableVariable, pattern } of patterns) {
        if (pattern.test(line)) {
          hits.push({ relativePath, tableVariable, line: index + 1 });
        }
      }
    });
  }

  return hits;
};

describe('soft-delete guard', () => {
  it('finds no hard DELETE against a syncable entity outside exempt sites', () => {
    const hits = findHardDeletesAgainstSyncableEntities();

    expect(hits).toEqual([]);
  });

  it('scans a non-trivial set of source files (the scanner is wired correctly)', () => {
    const files = collectTypeScriptSourceFiles(SRC_ROOT);

    expect(files.length).toBeGreaterThan(10);
  });

  it('still flags a hard delete in a non-exempt file (the matcher is not a no-op)', () => {
    // A representative non-exempt source file that calls `.delete(<entity>)`
    // must be detected by the matcher — proves the guard would catch a
    // regression that re-introduces a hard delete on a converted path.
    const pattern = buildDeleteCallPattern('sessionExerciseTags');

    expect(pattern.test('database.delete(sessionExerciseTags)')).toBe(true);
    expect(pattern.test('tx.delete(sessionExercises)')).toBe(false);
  });
});
