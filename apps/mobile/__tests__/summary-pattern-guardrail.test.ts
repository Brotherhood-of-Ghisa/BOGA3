import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSummaryPatternViolations } from '../scripts/summary-pattern-guardrail';

let rootDir: string;
const file = 'components/groups/group-glance-page.tsx';
beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-pattern-')); });
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));
const write = (target: string, source: string) => {
  fs.mkdirSync(path.dirname(path.join(rootDir, target)), { recursive: true });
  fs.writeFileSync(path.join(rootDir, target), source);
};

it('rejects the old locally assembled headline card', () => {
  write(file, 'const Tile = () => <Card><CardTitle title="Group stats"/><GroupWeekTotalsFigures/></Card>;');
  expect(findSummaryPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['missing SummaryTile']);
});
it.each(['style={custom}', '{...props}', 'contentContainerStyle={custom}'])('rejects a consumer override: %s', attr => {
  write(file, `const Tile = () => <SummaryTile ${attr} title="Group stats" metrics={<GroupWeekTotalsFigures/>}/>;`);
  expect(findSummaryPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['summary style override']);
});
it.each(['.styles.ts', '-styles.ts'])('rejects local typography in a %s companion', suffix => {
  write(file, 'const Tile = () => <SummaryTile title="Group stats" metrics={<GroupWeekTotalsFigures/>}/>;');
  write(`components/groups/group-week-totals${suffix}`, 'const style = { fontWeight: weight, lineHeight: height };');
  expect(findSummaryPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['local summary typography', 'local summary typography']);
});
it('allows content and current metric primitives without governing untouched cards', () => {
  write(file, 'const Tile = () => <><SummaryTile title="Group stats" metrics={<GroupWeekTotalsFigures current={current} previous={previous} offset={0}/>}/><Card style={chart}/></>;');
  expect(findSummaryPatternViolations({ rootDir })).toEqual([]);
});

it('rejects a styled wrapper around the selected reference metrics', () => {
  write(file, 'const Tile = () => <SummaryTile title="Group stats" metrics={<View style={{ padding: uiSpace.xl }}><GroupWeekTotalsFigures/></View>}/>;');
  expect(findSummaryPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['summary metric composition']);
});
it('rejects metric-group padding and a styled wrapper even when it uses tokens', () => {
  write('components/groups/group-week-totals.tsx', 'const Figures = () => <View style={{padding: uiSpace.xl}}><WeekFigure/></View>;');
  expect(findSummaryPatternViolations({ rootDir }).map(item => item.rule)).toEqual(['local summary geometry', 'local summary geometry']);
});
it('accepts the unchanged shared WeekFigure group geometry', () => {
  write('components/groups/group-week-totals.tsx', 'const Figures = () => <View style={weekFigureStyles.figures}><WeekFigure/></View>;');
  expect(findSummaryPatternViolations({ rootDir })).toEqual([]);
});
