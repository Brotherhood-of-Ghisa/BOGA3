import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Expo Router appends any root route the layout does not declare after the
// declared ones, outside every `Stack.Protected` group, so a new route file left
// out of `RootStack` would be reachable signed out and before the first sync.

const APP_DIR = join(__dirname, '..', 'app');
const ROOT_STACK_SOURCE = readFileSync(
  join(__dirname, '..', 'components', 'navigation', 'root-stack.tsx'),
  'utf8',
);

const routeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') return [];
      // A route group is one screen of the root stack (`(tabs)`), with its own layout.
      if (/^\(.+\)$/.test(entry)) return [entry];
      return routeFiles(path);
    }
    if (!/\.tsx?$/.test(entry) || entry.startsWith('_') || entry.startsWith('+')) return [];
    return [relative(APP_DIR, path).replace(/\.tsx?$/, '')];
  });

const declaredNames = [...ROOT_STACK_SOURCE.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);

describe('RootStack route declarations', () => {
  it('declares every root route file, so none escapes the access groups', () => {
    expect(routeFiles(APP_DIR).filter((route) => !declaredNames.includes(route))).toEqual([]);
  });

  it('declares only routes that exist, each once', () => {
    const files = routeFiles(APP_DIR);
    expect(declaredNames.filter((name) => !files.includes(name))).toEqual([]);
    expect(new Set(declaredNames).size).toBe(declaredNames.length);
  });
});
