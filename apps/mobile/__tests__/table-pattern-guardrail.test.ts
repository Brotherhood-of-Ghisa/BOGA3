import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTablePatternViolations } from '../scripts/table-pattern-guardrail';

let rootDir: string;
beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-pattern-')); });
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));
const file = 'components/stats/progress-tables.tsx';
function write(name: string, source: string) {
  const target = path.join(rootDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
}
const rules = () => findTablePatternViolations({ rootDir }).map((v: { rule: string }) => v.rule);

it('accepts the shared production rows with feature-owned columns, nesting and metadata', () => {
  write(file, '<StatsTable><StatsTableRow meta={<Values/>}><StatsTableName name="Lats"/><Text style={uiText.meta}>Primary</Text></StatsTableRow></StatsTable>');
  expect(rules()).toEqual([]);
});
it('rejects local density/type overrides and bypassing the shared row', () => {
  write(file, '<StatsTable style={local}><StatsTableRow density="list" nameStyle={local}/><ListRow/><Text style={uiText.bodyStrong}/><View style={{minHeight: target}}/></StatsTable>');
  expect(rules()).toEqual(['table style override', 'table style override', 'table style override', 'use StatsTableRow', 'use table text presentation', 'table row geometry override']);
});
it.each(['progress-tables.styles.ts', 'progress-tables-styles.ts'])('checks the adopted %s style companion', name => {
  write('components/stats/' + name, 'const styles = { row: {fontSize: size, paddingVertical: inset} };');
  expect(rules()).toEqual(['local typography assembly', 'table row geometry override']);
});
it('requires the table family without claiming untouched Exercise tables', () => {
  write(file, '<View/>');
  write('app/(tabs)/progress.tsx', '<ListRow density="list"/>');
  expect(rules()).toEqual(['missing StatsTable']);
});
