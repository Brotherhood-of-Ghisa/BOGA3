import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCompactPatternViolations, COMPACT_PATTERN_FILES } from '../scripts/compact-pattern-guardrail';
import { findListPatternViolations, LIST_PATTERN_FILES } from '../scripts/list-pattern-guardrail';
import { findTablePatternViolations, TABLE_PATTERN_FILES } from '../scripts/table-pattern-guardrail';
import { findSummaryPatternViolations, SUMMARY_PATTERN_FILES } from '../scripts/summary-pattern-guardrail';
import { runUiGuardrailCheck } from '../scripts/check-ui-guardrails';

let rootDir: string;
beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pattern-adoption-')); });
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));
function write(file: string, source: string) {
  const target = path.join(rootDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}
const families = [
  { file: COMPACT_PATTERN_FILES[0], check: findCompactPatternViolations, safe: '<CompactCard><CompactHeader label="Training"/></CompactCard>', pattern: 'CompactCard', attrs: '' },
  { file: LIST_PATTERN_FILES[0], check: findListPatternViolations, safe: '<ListCard><ListRow density="compact"/></ListCard>', pattern: 'ListCard', attrs: '' },
  { file: TABLE_PATTERN_FILES[0], check: findTablePatternViolations, safe: '<StatsTable><StatsTableRow/></StatsTable>', pattern: 'StatsTable', attrs: '' },
  { file: SUMMARY_PATTERN_FILES[0], check: findSummaryPatternViolations, safe: '<SummaryTile metrics={<GroupWeekTotalsFigures/>}/>', pattern: 'SummaryTile', attrs: 'metrics={<GroupWeekTotalsFigures/>}' },
];

it.each(families)('rejects hidden style/casing/type overrides in $pattern and follows imported styles', ({ file, check, safe }) => {
  write(file, `import { boardStyles as appearance } from './board-appearance'; const Preview = () => ${safe};`);
  write(path.posix.join(path.posix.dirname(file), 'board-appearance.ts'), `export const style = { ['fontSize']: size };`);
  expect(check({ rootDir })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: expect.stringMatching(/typography/) })]));
  write(path.posix.join(path.posix.dirname(file), 'board-appearance.ts'), 'export const boardStyles = { textTransform: "uppercase" };');
  expect(check({ rootDir })).toEqual(expect.arrayContaining([expect.objectContaining({ rule: expect.stringMatching(/typography/) })]));
  write(path.posix.join(path.posix.dirname(file), 'board-appearance.ts'), 'export const boardStyles = { textAlign: "right", width: 76 };');
  expect(check({ rootDir })).toEqual([]);
  write(file, `const Preview = () => ${safe}; const label = title.toUpperCase();`);
  expect(check({ rootDir }).map(item => item.rule)).toContain('local casing assembly');
});

it.each(families)('checks both TS and TSX style companions for $pattern', ({ file, check, safe }) => {
  write(file, `const Preview = () => ${safe};`);
  write(file.replace('.tsx', '.styles.tsx'), 'export const local = { ["lineHeight"]: height };');
  expect(check({ rootDir }).map(item => item.rule)).toEqual([expect.stringMatching(/typography/)]);
});

it.each(families)('rejects aliased $pattern style props and spread props', ({ file, check, pattern, attrs }) => {
  for (const prop of ['style={custom}', 'contentStyle={custom}', '{...props}']) {
    write(file, `import { ${pattern} as Chosen } from '@/components/ui'; const Preview = () => <><CompactHeader label="Ready"/><Chosen ${attrs} ${prop}/></>;`);
    expect(check({ rootDir }).map(item => item.rule)).toContainEqual(expect.stringMatching(/style override/));
  }
});

it.each(["'compact'", '"compact"', "{'compact'}", '{"compact"}'])('accepts the literal compact density %s', density => {
  write(LIST_PATTERN_FILES[0], `<ListCard><ListRow density=${density}/></ListCard>`);
  expect(findListPatternViolations({ rootDir })).toEqual([]);
});

it('rejects the old CoW role even through an imported alias and computed access', () => {
  write(COMPACT_PATTERN_FILES[2], `import { uiText as text } from '@/components/ui'; const Heading = () => <><CompactHeader label="CoW"/><Text style={text['title']}/></>;`);
  expect(findCompactPatternViolations({ rootDir }).map(item => item.rule)).toContain('compact title role');
});

it.each([findListPatternViolations, findTablePatternViolations])('rejects computed spacing assembly in imported TS style exports', check => {
  const index = check === findListPatternViolations ? 1 : 2;
  const { file, safe } = families[index];
  write(file, `import { rowStyles } from './row-layout'; const Preview = () => ${safe};`);
  write(path.posix.join(path.posix.dirname(file), 'row-layout.ts'), `export const rowStyles = { ['paddingVertical']: uiSpace.lg };`);
  expect(check({ rootDir }).map(item => item.rule)).toEqual([expect.stringMatching(/geometry override/)]);
});

it('permits legitimate foundation definitions and untouched consumers, while the existing gate rejects an adopted violation', () => {
  write('components/ui/compact-card.tsx', 'const style = {fontSize: size, paddingVertical: inset};');
  write('components/stats/stats-table.tsx', 'const style = {lineHeight: height, minHeight: target};');
  write('components/groups/untouched.tsx', 'const style = {fontFamily: family};');
  const output: string[] = [];
  expect(runUiGuardrailCheck({ rootDir, selectionContext: { files: [] }, stdout: { write: (text: string) => output.push(text) } }).ok).toBe(true);
  write(COMPACT_PATTERN_FILES[2], '<CompactHeader style={custom} label="CoW"/>');
  expect(runUiGuardrailCheck({ rootDir, selectionContext: { files: [] }, stdout: { write: (text: string) => output.push(text) } }).ok).toBe(false);
  expect(output.join('')).toContain('compact style override');
});

it('keeps every declared adopted production presenter present and clean', () => {
  const productionRoot = path.resolve(__dirname, '..');
  for (const file of [...COMPACT_PATTERN_FILES, ...LIST_PATTERN_FILES, ...TABLE_PATTERN_FILES, ...SUMMARY_PATTERN_FILES]) {
    expect(fs.existsSync(path.join(productionRoot, file))).toBe(true);
  }
  for (const { check } of families) expect(check({ rootDir: productionRoot })).toEqual([]);
});


it('follows re-exported style modules without scanning imported foundation roles', () => {
  write(LIST_PATTERN_FILES[0], `import { rowStyles } from './layout'; const Preview = () => <ListCard/>;`);
  write('components/groups/layout.ts', `export { rowStyles } from './row-values.ts';`);
  write('components/groups/row-values.ts', `import { uiText } from '@/components/ui'; export const rowStyles = {paddingVertical: uiSpace.lg};`);
  expect(findListPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['list row geometry override']);
});


it.each(['UI.uiText.title', "UI['uiText']['title']"])('rejects namespace access to the old CoW role: %s', role => {
  write(COMPACT_PATTERN_FILES[2], `import * as UI from '@/components/ui'; const Heading = () => <><UI.CompactHeader/><Text style={${role}}/></>;`);
  expect(findCompactPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['compact title role']);
});

it.each([findListPatternViolations, findTablePatternViolations])('rejects shorthand row insets but keeps horizontal column layout', check => {
  const { file, safe } = families[check === findListPatternViolations ? 1 : 2];
  write(file, `const Preview = () => ${safe}; const local = {padding: uiSpace.xl, paddingBlock: uiSpace.xl};`);
  expect(check({ rootDir }).map(item => item.rule)).toEqual([expect.stringMatching(/geometry override/), expect.stringMatching(/geometry override/)]);
  write(file, `const Preview = () => ${safe}; const local = {paddingHorizontal: uiSpace.md, width: columnWidth};`);
  expect(check({ rootDir })).toEqual([]);
});

it('accepts aliases of the actual metric foundation but rejects a local namesake and its imported geometry', () => {
  const file = SUMMARY_PATTERN_FILES[1];
  write(file, `import { weekFigureStyles as shared } from '@/components/today/week-figures'; const Figures = () => <View style={shared.figures}><WeekFigure/></View>;`);
  expect(findSummaryPatternViolations({ rootDir })).toEqual([]);
  write(file, `import { weekFigureStyles } from './metric-layout'; const Figures = () => <View style={weekFigureStyles.figures}><WeekFigure/></View>;`);
  write('components/groups/metric-layout.ts', 'export const weekFigureStyles = {figures: {padding: uiSpace.xl}};');
  expect(findSummaryPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['local summary geometry', 'local summary geometry']);
});


it('follows wildcard barrels of imported style modules and permits safe column styles', () => {
  write(LIST_PATTERN_FILES[0], `import { rowStyles } from './layout'; const Preview = () => <ListCard/>;`);
  write('components/groups/layout.ts', `export * from './row-values';`);
  write('components/groups/row-values.ts', 'export const rowStyles = {paddingVertical: uiSpace.xl};');
  expect(findListPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['list row geometry override']);
  write('components/groups/row-values.ts', 'export const rowStyles = {width: 76, textAlign: "right"};');
  expect(findListPatternViolations({ rootDir })).toEqual([]);
});
