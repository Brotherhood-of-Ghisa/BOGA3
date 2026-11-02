import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findListPatternViolations } from '../scripts/list-pattern-guardrail';

let rootDir: string;
beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-pattern-')); });
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));
const file = 'components/groups/group-home-board.tsx';
function write(name: string, source: string) {
  const target = path.join(rootDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
}

it('accepts compact composition and feature-owned column widths', () => {
  write(file, '<ListCard header={<ListCardHeader label="Top brothers"/>}><ListRow density="compact"><Text style={[uiText.bodyStrong, {width: 76}]}>You</Text></ListRow></ListCard>');
  expect(findListPatternViolations({ rootDir })).toEqual([]);
});
it('rejects style overrides and old row/type choices in adopted boards', () => {
  write(file, '<ListCard style={local}><ListRow density="list" labelStyle={local}><Text style={uiText.option}>Name</Text></ListRow></ListCard>');
  expect(findListPatternViolations({ rootDir }).map(item => item.rule)).toEqual([
    'list style override', 'noncompact adopted row', 'list style override', 'list text role',
  ]);
});
it.each(['group-home-board.styles.ts', 'group-home-board-styles.ts'])('checks the adopted %s companion', name => {
  write(file, '<ListCard/>');
  write(`components/groups/${name}`, 'const styles = {name: {fontSize: size, lineHeight: height}};');
  expect(findListPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['local typography assembly', 'local typography assembly']);
});
it('requires the shared pattern without expanding the claim to untouched tables', () => {
  write(file, '<View/>');
  write('components/stats/stats-table.tsx', 'const style = {fontSize: size};');
  expect(findListPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['missing ListCard']);
});
it('rejects padding/minimum-height assembly around compact controls and a forgotten density', () => {
  write(file, '<ListCard><ListRow/><View style={{paddingVertical: space, minHeight: target}}/></ListCard>');
  expect(findListPatternViolations({ rootDir }).map(item => item.rule)).toEqual([
    'noncompact adopted row', 'list row geometry override', 'list row geometry override',
  ]);
});
