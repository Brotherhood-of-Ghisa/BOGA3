import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

import { SETTINGS_SUB_PAGES } from '@/src/navigation/routes';

/**
 * Settings speaks one language (`docs/specs/ui/ux-rules.md`, "Settings pages"),
 * checked over the source of every Settings page: each route `app/settings*.tsx`
 * and Theme colour (`app/theme-colour.tsx`), plus every component they import,
 * transitively. The walk stops at the primitives (`components/ui/`) and the tab
 * chrome (`components/navigation/`), which are not Settings content. Settings
 * links to the Bodyweight log (`/body-weight`) but imports nothing of it: a log
 * of readings follows "Lists and rows", not this rule.
 *
 * A Settings file draws only the row vocabulary, `Notice`, `StatePanel` and the
 * screen scroll; a button is a primary (at most one per page) or a text button
 * as a `Notice`'s action; a `danger` row is confirmed in a native `Alert`.
 */

const MOBILE_ROOT = join(__dirname, '..');

const SETTINGS_ROOTS = [
  ...readdirSync(join(MOBILE_ROOT, 'app')).filter((name) => /^settings.*\.tsx$/.test(name)).map((name) => `app/${name}`),
  'app/theme-colour.tsx',
];
const NOT_SETTINGS_CONTENT = /^components\/(ui|navigation)\//;

// What a Settings file may draw from `@/components/ui`.
const VOCABULARY = new Set([
  'FormSection', 'FormError', 'SwitchRow', 'SegmentRow', 'RadioRow', 'CheckRow', 'InputRow', 'FormField',
  'ValueRow', 'ChoiceRow', 'ActionRow', 'ActionButton', 'Notice', 'StatePanel', 'Screen', 'ScreenScroll', 'FigureText',
]);
// Controls and tap targets that would make a row or a destination by hand.
const RAW_REACT_NATIVE = new Set([
  'Switch', 'TextInput', 'Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Modal',
]);

type Finding = { file: string; rule: string; detail: string };
type Parsed = { file: string; source: ts.SourceFile };

const parse = (file: string, text = readFileSync(join(MOBILE_ROOT, file), 'utf8')): Parsed =>
  ({ file, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) });

const resolveModule = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith('@/') ? specifier.slice(2)
    : specifier.startsWith('.') ? relative(MOBILE_ROOT, join(MOBILE_ROOT, dirname(from), specifier)) : null;
  if (base === null) return null;
  return ['.tsx', '.ts', '/index.tsx', '/index.ts'].map((ext) => base + ext)
    .find((candidate) => existsSync(join(MOBILE_ROOT, candidate))) ?? null;
};

const importDeclarations = ({ source }: Parsed) => source.statements.filter(ts.isImportDeclaration);
const moduleOf = (declaration: ts.ImportDeclaration) => (declaration.moduleSpecifier as ts.StringLiteral).text;

const componentImports = (parsed: Parsed): string[] =>
  importDeclarations(parsed)
    .map((declaration) => resolveModule(parsed.file, moduleOf(declaration)))
    .filter((file): file is string => file !== null && file.startsWith('components/') && !NOT_SETTINGS_CONTENT.test(file));

/** The files of one Settings page: its route and every component it imports, transitively. */
const pageFiles = (root: string): string[] => {
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...componentImports(parse(file)));
  }
  return [...seen].sort();
};

/** Each name a file imports, mapped to the module it came from. */
const importedFrom = (parsed: Parsed): Map<string, string> => {
  const names = new Map<string, string>();
  importDeclarations(parsed).forEach((declaration) => {
    const bindings = declaration.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach((element) => names.set(element.name.text, moduleOf(declaration)));
  });
  return names;
};

const jsxElements = ({ source }: Parsed): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] => {
  const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const tagName = (element: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => element.tagName.getText();
const attribute = (element: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) =>
  element.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && property.name.getText() === name);
const literalValue = (attr: ts.JsxAttribute | undefined): string | null =>
  attr?.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : null;

/** A text button stands only as the `action` of a `Notice`: `<Notice action={<ActionButton … />} />`. */
const isNoticeAction = (element: ts.JsxSelfClosingElement | ts.JsxOpeningElement) => {
  const node = ts.isJsxOpeningElement(element) ? element.parent : element;
  const expression = node.parent;
  const attr = expression && ts.isJsxExpression(expression) ? expression.parent : undefined;
  return Boolean(attr && ts.isJsxAttribute(attr) && attr.name.getText() === 'action'
    && tagName(attr.parent.parent as ts.JsxSelfClosingElement) === 'Notice');
};

const buttonFindings = (element: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string[] => {
  const variant = literalValue(attribute(element, 'variant'));
  if (variant === 'primary') return [];
  if (variant === 'text') return isNoticeAction(element) ? [] : ['a text button outside a Notice action'];
  return [`an ActionButton of variant ${variant ?? attribute(element, 'variant')?.initializer?.getText() ?? 'none'}`];
};

const elementFindings = (element: ts.JsxOpeningElement | ts.JsxSelfClosingElement, imports: Map<string, string>): [string, string][] => {
  const name = tagName(element);
  const from = imports.get(name);
  const findings: [string, string][] = [];
  if (from?.startsWith('@/components/ui') && !VOCABULARY.has(name)) findings.push(['vocabulary', `<${name}> is not Settings vocabulary`]);
  if (name === 'ActionButton') buttonFindings(element).forEach((detail) => findings.push(['buttons', detail]));
  if (name === 'StatePanel' && attribute(element, 'action')) findings.push(['buttons', 'a StatePanel action (an outline button)']);
  return findings;
};

/** Every way one Settings file breaks the rule. */
const settingsFindings = (file: string, text?: string): Finding[] => {
  const parsed = parse(file, text);
  const imports = importedFrom(parsed);
  const body = parsed.source.getFullText();
  const findings: Finding[] = [];
  const add = (rule: string, detail: string) => findings.push({ file, rule, detail });
  imports.forEach((from, name) => {
    if (from === 'react-native' && RAW_REACT_NATIVE.has(name)) add('raw control', `${name} from react-native`);
  });
  if (/\bSettingsCard\b/.test(body)) add('vocabulary', 'SettingsCard');
  jsxElements(parsed).forEach((element) => elementFindings(element, imports).forEach(([rule, detail]) => add(rule, detail)));
  const dangerRows = jsxElements(parsed).filter((element) => tagName(element) === 'ActionRow' && /['"]danger['"]/.test(attribute(element, 'kind')?.getText() ?? ''));
  if (dangerRows.length > 0 && !/\bAlert\.alert\(/.test(body)) add('danger', 'a danger row with no Alert to confirm it');
  return findings;
};

const primaries = (file: string, text?: string) =>
  jsxElements(parse(file, text)).filter((element) => tagName(element) === 'ActionButton' && literalValue(attribute(element, 'variant')) === 'primary').length;

const settingsFiles = () => [...new Set(SETTINGS_ROOTS.flatMap(pageFiles))].sort();

describe('every Settings page speaks the Settings language', () => {
  it('walks every Settings route and the components of every page', () => {
    const files = settingsFiles();
    const expected = [
      'app/settings.tsx', 'app/theme-colour.tsx',
      ...Object.values(SETTINGS_SUB_PAGES).map((route) => `app${route}.tsx`),
      ...readdirSync(join(MOBILE_ROOT, 'components/settings')).map((name) => `components/settings/${name}`),
      'components/appearance/appearance-settings.tsx', 'components/appearance/theme-colour-screen.tsx',
      'components/notifications/notification-settings-screen.tsx', 'components/notifications/settings-row.tsx',
      'components/preferences/effort-settings.tsx', 'components/preferences/muscle-settings.tsx',
      'components/preferences/progress-settings.tsx', 'components/preferences/rest-timer-settings.tsx',
      'components/sync-status/sync-status-panel.tsx', 'components/sync-status/exercise-merge-review.tsx',
    ];
    expect(files).toEqual(expect.arrayContaining(expected));
    expect(files.filter((file) => NOT_SETTINGS_CONTENT.test(file) || file.startsWith('components/bodyweight/body-weight-screen'))).toEqual([]);
  });

  it('draws nothing but the row vocabulary, a primary and Notice text buttons, with danger rows confirmed', () => {
    expect(settingsFiles().flatMap((file) => settingsFindings(file))).toEqual([]);
  });

  it('has at most one primary on any page', () => {
    const overOne = SETTINGS_ROOTS.map((root) => ({ root, count: pageFiles(root).reduce((sum, file) => sum + primaries(file), 0) }))
      .filter(({ count }) => count > 1);
    expect(overOne).toEqual([]);
  });

  it('pushes every Settings route as a page titled in the root stack, and each is a Settings sub page', () => {
    const stack = readFileSync(join(MOBILE_ROOT, 'components/navigation/root-stack.tsx'), 'utf8');
    const routes = SETTINGS_ROOTS.filter((root) => root !== 'app/settings.tsx' && root !== 'app/theme-colour.tsx')
      .map((root) => root.replace(/^app/, '').replace(/\.tsx$/, ''));
    expect(routes.sort()).toEqual(Object.values(SETTINGS_SUB_PAGES).sort());
    [...routes, '/theme-colour'].forEach((route) =>
      expect(stack).toMatch(new RegExp(`name="${route.slice(1)}" options=\\{\\{ title: '[^']+' \\}\\}`)));
  });
});

describe('the Settings language check', () => {
  const findingsIn = (text: string) => settingsFindings('components/settings/example.tsx', text).map(({ rule, detail }) => `${rule}: ${detail}`);
  const header = "import { ActionButton, ActionRow, Card, Notice, PageSheet, StatePanel } from '@/components/ui';\n";

  it('passes the vocabulary: a primary, a Notice Retry and a confirmed danger row', () => {
    expect(findingsIn(`${header}import { Alert } from 'react-native';
      const a = <ActionButton label="Add" variant="primary" onPress={add} />;
      const b = <Notice message="Failed" action={<ActionButton label="Retry" variant="text" onPress={retry} />} />;
      const c = <ActionRow kind="danger" label="Wipe" onPress={() => Alert.alert('Wipe?', '', [])} />;`)).toEqual([]);
  });

  it('finds outline and link buttons, and a variant it cannot read', () => {
    expect(findingsIn(`${header}
      const a = <ActionButton label="Save" variant="outline" onPress={save} />;
      const b = <ActionButton label="All" variant="link" onPress={open} />;
      const c = <ActionButton label="Go" variant={kind} onPress={go} />;`)).toEqual([
      'buttons: an ActionButton of variant outline',
      'buttons: an ActionButton of variant link',
      'buttons: an ActionButton of variant {kind}',
    ]);
  });

  it('finds a text button outside a Notice, and a StatePanel action', () => {
    expect(findingsIn(`${header}
      const a = <ActionButton label="Cancel" variant="text" onPress={cancel} />;
      const b = <StatePanel kind="error" action={{ label: 'Retry', onPress: retry }} />;`)).toEqual([
      'buttons: a text button outside a Notice action',
      'buttons: a StatePanel action (an outline button)',
    ]);
  });

  it('finds a raw Switch, TextInput or tap target, a sheet, a hand-made card and SettingsCard', () => {
    expect(findingsIn(`${header}import { Pressable, Switch, TextInput } from 'react-native';
      const a = <PageSheet visible title="Review" />;
      const b = <Card><SettingsCard /></Card>;`)).toEqual([
      'raw control: Pressable from react-native',
      'raw control: Switch from react-native',
      'raw control: TextInput from react-native',
      'vocabulary: SettingsCard',
      'vocabulary: <PageSheet> is not Settings vocabulary',
      'vocabulary: <Card> is not Settings vocabulary',
    ]);
  });

  it('finds a danger row with no Alert', () => {
    expect(findingsIn(`${header}const a = <ActionRow kind="danger" label="Wipe" onPress={wipe} />;`))
      .toEqual(['danger: a danger row with no Alert to confirm it']);
  });

  it('counts primaries', () => {
    expect(primaries('components/settings/example.tsx', `${header}
      const a = <><ActionButton label="Add" variant="primary" onPress={add} /><ActionButton label="Save" variant="primary" onPress={save} /></>;`)).toBe(2);
  });
});
