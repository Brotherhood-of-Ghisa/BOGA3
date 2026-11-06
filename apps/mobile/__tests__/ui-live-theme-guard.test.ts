import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

import ALLOWLIST from './ui-live-theme-guard.allowlist.json';

// A saved appearance repaints every mounted screen (`components/ui/theme-context.tsx`),
// so nothing may read the colour roles or the mode from the launch-time
// constants `uiRoles` / `uiMode` (`components/ui/tokens.ts`): a module that
// does stays in the launch theme. Read them through `useUiRoles()`,
// `useUiMode()` or a `makeStyles` sheet; a helper that builds colours takes
// `roles` as an argument.
//
// The allowlist holds the files that still read the constants. It only
// shrinks: a migrated file leaves it, and the guard fails until it does.

const MOBILE_ROOT = join(__dirname, '..');
const SCANNED = ['app', 'components', 'src'];
const CONSTANTS = new Set(['uiRoles', 'uiMode']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Each line that names a launch constant in code (an import, a read, a
// re-export); comments and strings do not count.
function constantReads(path: string, source: string): number[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && CONSTANTS.has(node.text)) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

const readers = (): string[] =>
  SCANNED.flatMap((directory) => sourceFiles(join(MOBILE_ROOT, directory)))
    .map((path) => relative(MOBILE_ROOT, path).split('\\').join('/'))
    .filter((path) => constantReads(path, readFileSync(join(MOBILE_ROOT, path), 'utf8')).length > 0)
    .sort();

describe('no read of the launch-time theme constants', () => {
  const allowed = new Set<string>(ALLOWLIST);

  it('outside the files still to migrate', () => {
    expect(readers().filter((path) => !allowed.has(path))).toEqual([]);
  });

  it('keeps the allowlist to files that still read them', () => {
    const stillReading = new Set(readers());
    expect(ALLOWLIST.filter((path) => !stillReading.has(path))).toEqual([]);
    expect(ALLOWLIST).toEqual([...allowed].sort());
  });

  it.each([
    ['a module-scope stylesheet', "const styles = StyleSheet.create({ card: { backgroundColor: uiRoles.surface } });"],
    ['a module constant', 'const LAP_FILLS = [uiRoles.viz2, uiRoles.viz3] as const;'],
    ['a read in render', 'function Row() { return <Icon color={uiRoles.inkMuted} name="x" />; }'],
    ['the mode', '<DateTimePicker themeVariant={uiMode} value={date} />'],
    ['an import', "import { uiRoles } from '@/components/ui/tokens';"],
    ['a renamed import', "import { uiRoles as roles } from '@/components/ui/tokens';"],
    ['a namespace read', 'const ink = tokens.uiRoles.ink;'],
    ['a re-export', "export { uiMode } from '@/components/ui/tokens';"],
  ])('rejects %s', (_name, source) => {
    expect(constantReads('components/example.tsx', source)).not.toEqual([]);
  });

  it.each([
    ['a makeStyles sheet', 'const useStyles = makeStyles((roles) => ({ card: { backgroundColor: roles.surface } }));'],
    ['a hook read', 'function Row() { const roles = useUiRoles(); return <Icon role="inkMuted" name="x" />; }'],
    ['a function of the roles', 'export const heatRamp = (roles: UiRoles) => [roles.viz0, roles.viz1] as const;'],
    ['the name in a comment', '// Was `uiRoles.ink` before the theme went live.'],
    ['the name in a string', "const note = 'uiMode';"],
    ['a role token type', "import { type UiRoleToken } from '@/components/ui/tokens';"],
  ])('allows %s', (_name, source) => {
    expect(constantReads('components/example.tsx', source)).toEqual([]);
  });
});
