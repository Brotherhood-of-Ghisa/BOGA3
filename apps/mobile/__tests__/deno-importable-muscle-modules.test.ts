/**
 * Guard: the muscle calculation modules the agent API runs in a Supabase edge
 * function (Deno) resolve without Metro's `@/` alias or extensionless imports.
 *
 * It walks the static imports from the entry modules and requires every module
 * it reaches to import only by relative `.ts` path, so nothing server-side is
 * pulled in through the app's resolver, a database client or React Native.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');

const ENTRY_MODULES = [
  'src/data/muscle-analytics.ts',
  'src/data/muscle-daily-sets.ts',
  'src/data/muscle-report-presets.ts',
  'src/data/muscle-report-setup.ts',
  'src/today-plan/calculations.ts',
  // The coach's training status reaches the synced target preferences too.
  '../../supabase/functions/agent-api/training-status.ts',
];

const IMPORT_SPECIFIER = /(?:^|[\s;])(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const specifiersOf = (source: string): string[] =>
  [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? match[2] ?? match[3]);

type Violation = { file: string; specifier: string; reason: string };

const walkClosure = (entries: readonly string[]) => {
  const visited = new Set<string>();
  const violations: Violation[] = [];
  const queue = entries.map((entry) => path.join(MOBILE_ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const relativeFile = path.relative(MOBILE_ROOT, file);
    for (const specifier of specifiersOf(fs.readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        violations.push({ file: relativeFile, specifier, reason: 'not a relative path' });
      } else if (!specifier.endsWith('.ts')) {
        violations.push({ file: relativeFile, specifier, reason: 'relative import without a .ts extension' });
      } else {
        queue.push(path.resolve(path.dirname(file), specifier));
      }
    }
  }
  return { visited: [...visited].map((file) => path.relative(MOBILE_ROOT, file)).sort(), violations };
};

describe('Deno-importable muscle modules', () => {
  it('imports only by relative .ts path throughout the closure of the entry modules', () => {
    const { violations } = walkClosure(ENTRY_MODULES);
    expect(violations).toEqual([]);
  });

  it('reaches the shared calculation kernel and stays off the database layer', () => {
    const { visited } = walkClosure(ENTRY_MODULES);
    expect(visited).toEqual(expect.arrayContaining([
      'src/bodyweight/as-of.ts',
      'src/exercise-calculations/analytics.ts',
      'src/utils/calendar-weeks.ts',
      'src/utils/local-calendar.ts',
      'src/preferences/synced.ts',
    ]));
    expect(visited).not.toContain('src/data/muscle-report-settings.ts');
    expect(visited.filter((file) => /bootstrap|schema|write-nudge/.test(file))).toEqual([]);
  });

  it('flags an alias, an extensionless relative import and a bare package', () => {
    const specifiers = specifiersOf([
      "import { a } from '@/src/x';",
      "import type { B } from './b';",
      "export { c } from '../c.ts';",
      "import 'side-effect';",
      "const d = await import('./d');",
    ].join('\n'));
    expect(specifiers).toEqual(['@/src/x', './b', '../c.ts', 'side-effect', './d']);
  });
});
