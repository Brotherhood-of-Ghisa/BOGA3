import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCompactPatternViolations } from '../scripts/compact-pattern-guardrail';

let rootDir: string;
beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-pattern-')); });
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));
const write = (file: string, source: string) => {
  const target = path.join(rootDir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
};
const file = 'components/groups/cow-preview.tsx';

it('rejects the old CoW title role arrangement instead of merely checking raw token literals', () => {
  write(file, 'export const Heading = () => <Text style={uiText.title}>CoW</Text>;');
  expect(findCompactPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['compact title role', 'missing CompactHeader']);
});
it('accepts shared headers, semantic word/figure roles and unrelated foundation definitions', () => {
  write(file, 'export const Heading = () => <><CompactHeader label="CoW"/><Text style={uiText.bodyStrong}>Pull-up</Text></>;');
  write('components/ui/compact-card.tsx', 'const style = {fontSize: size, fontWeight: weight};');
  expect(findCompactPatternViolations({ rootDir })).toEqual([]);
});
it.each(['cow-preview.styles.ts', 'cow-preview-styles.ts'])('rejects typography assembly in the adopted %s style companion', name => {
  write(file, 'export const Heading = () => <CompactHeader label="CoW"/>;');
  write(`components/groups/${name}`, 'export const style = {fontFamily: family, lineHeight: height};');
  expect(findCompactPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['local typography assembly', 'local typography assembly']);
});
it('rejects a compact style override regardless of arrow functions or multiline attributes', () => {
  write(file, 'export const Heading = () => <><CompactHeader label="CoW"/><CompactCard onPress={() => open()}\nstyle={local}><Text>Facts</Text></CompactCard></>;');
  expect(findCompactPatternViolations({ rootDir })).toEqual([{ file, line: 1, rule: 'compact style override' }]);
});
