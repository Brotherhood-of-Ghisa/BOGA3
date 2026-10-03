/**
 * Guard: each training-metric rule lives in one place
 * (`docs/specs/tech/training-metrics-contract.md`).
 *
 * - The counted-set rule: only `set-semantics.ts` compares a set type with
 *   `'warm_up'`. Everything else asks `isWorkingSet` (or, where performance is
 *   already settled, `isWorkingSetType`).
 * - `isWorkingSetType` alone is for stored flags and projections of performed
 *   sets; every other caller uses `isWorkingSet`, which also checks the set
 *   was performed.
 * - The Wathan 1RM constants appear only in `exercise-calculations/index.ts`.
 * - A figure's display precision lives in `format.ts`: `toFixed` outside it,
 *   bar the listed non-figure uses, is a second format.
 *
 * It scans the app (`src`, `app`, `components`) and the TS that imports the
 * kernel on the server (`supabase/functions`, `services/boga-mcp/src`).
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..', '..');
const SCAN_ROOTS = [
  path.join(MOBILE_ROOT, 'src'),
  path.join(MOBILE_ROOT, 'app'),
  path.join(MOBILE_ROOT, 'components'),
  path.join(REPO_ROOT, 'supabase', 'functions'),
  path.join(REPO_ROOT, 'services', 'boga-mcp', 'src'),
];

const listSourceFiles = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
};

const relative = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');
const files = SCAN_ROOTS.flatMap(listSourceFiles).map((file) => ({
  path: relative(file),
  source: fs.readFileSync(file, 'utf8'),
}));

// Every allowed file must still match, so a stale exemption fails too.
const offenders = (pattern: RegExp, allowed: readonly string[]) => [
  ...files.filter((file) => pattern.test(file.source) && !allowed.includes(file.path)).map((file) => file.path),
  ...allowed.filter((path) => !files.some((file) => file.path === path && pattern.test(file.source)))
    .map((path) => `stale exemption: ${path}`),
];

describe('training-metric rules have one implementation', () => {
  it('scans the sources', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('compares a set type with warm_up only in the counted-set rule and the effort labels', () => {
    const comparison = /[!=]==?\s*['"]warm_up['"]|['"]warm_up['"]\s*[!=]==?/;
    expect(offenders(comparison, [
      'apps/mobile/src/exercise-calculations/set-semantics.ts',
      // Effort labels and the picker cycle, not a statistic.
      'apps/mobile/src/data/set-types.ts',
    ])).toEqual([]);
  });

  it('reads the effort half alone only where performance is already settled', () => {
    expect(offenders(/\bisWorkingSetType\(/, [
      'apps/mobile/src/exercise-calculations/set-semantics.ts',
      // The group evaluator stores the effort half as `working` on each fact.
      'apps/mobile/src/groups/set-facts.ts',
      'apps/mobile/src/groups/metric-evaluation.ts',
      // Performed sets only (`selectGroupPerformedExercises`).
      'apps/mobile/src/groups/session-metrics.ts',
    ])).toEqual([]);
  });

  it('formats training figures only in format.ts', () => {
    expect(offenders(/\.toFixed\(/, [
      'apps/mobile/src/exercise-calculations/format.ts',
      // Not training figures: a percentage, a body weight, chart coordinates
      // and set counts.
      'apps/mobile/src/groups/link-view-model.ts',
      'apps/mobile/components/bodyweight/body-weight-screen.tsx',
      'apps/mobile/components/today/progress-format.ts',
      'apps/mobile/app/(tabs)/stats-history.tsx',
    ])).toEqual([]);
  });

  it('keeps the Wathan constants in the one 1RM estimate', () => {
    expect(offenders(/\b48\.8\b|\b53\.8\b/, [
      'apps/mobile/src/exercise-calculations/index.ts',
    ])).toEqual([]);
  });
});
