/**
 * Progress's tables, muscle views, filters and week list on the shared text
 * roles (`design-language.md` §3, "Text roles"): row names are `bodyStrong`,
 * headings `title`, headers and controls `label`; figures take `figure`, and a
 * word never takes Plex Mono, only the digits inside it do (`FigureText`).
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { ComparisonValues } from '@/components/stats/comparison-columns';
import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import { ProgressFilters } from '@/components/stats/progress-filters';
import { ProgressMuscleView } from '@/components/stats/progress-muscle-view';
import { ProgressTables } from '@/components/stats/progress-tables';
import { statsTableColumnWidth } from '@/components/stats/stats-table';
import { WeekSetList } from '@/components/stats/week-set-list';
import { uiText } from '@/components/ui/text-roles';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ProgressMuscleComparison } from '@/src/data';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;

const BODY_STRONG = { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const BODY = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base };
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' };
const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg };
const FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };

const figures = (workingSetCount: number) => ({ workingSetCount, totalVolume: workingSetCount * 500, volumeSetCount: workingSetCount });
const muscle = (muscleGroupId: string, displayName: string, now: number, before: number): ProgressMuscleComparison => ({
  muscleGroupId, displayName, familyName: 'Back', sortOrder: 0,
  current: figures(now), previous: figures(before), workingSetChange: now - before,
  volumeChange: { kind: 'percent', percent: 0 },
  exercises: [{ exerciseDefinitionId: 'pulldown', displayName: 'Lat Pulldown', role: 'primary',
    current: figures(now), previous: figures(before), workingSetChange: now - before,
    volumeChange: { kind: 'percent', percent: 0 } }],
} as ProgressMuscleComparison);

const lats = muscle('back_lats', 'Lats', 3, 1);
const tableProps = { muscles: [lats, { ...muscle('back_upper', 'Upper back', 2, 0), sortOrder: 1 }], metric: 'workingSetCount' as const,
  selectedId: 'back_lats', grouped: true, onSelect: jest.fn(), onMuscleHistory: jest.fn(), onExerciseHistory: jest.fn() };

describe('Progress tables', () => {
  it('names muscle and exercise rows in bodyStrong, not Archivo, and their role in meta', () => {
    render(<ProgressTables {...tableProps} />);
    expect(style(within(screen.getByTestId('stats-muscle-history-back_lats')).getByText('Lats'))).toMatchObject(BODY_STRONG);
    expect(style(screen.getByText('Lat Pulldown'))).toMatchObject(BODY_STRONG);
    expect(style(screen.getByText('Primary'))).toMatchObject(META);
  });

  it('heads its family and columns with the micro-label, the sorted column in ink', () => {
    render(<ProgressTables {...tableProps} sortMode="now-desc" />);
    expect(style(screen.getByTestId('stats-family-header-back'))).toMatchObject({ ...LABEL, color: uiRoles.inkMuted });
    expect(style(within(screen.getByTestId('stats-muscle-sort-now')).getByText(/Now\s+\(Prev\)/))).toMatchObject({ ...LABEL, color: uiRoles.ink });
    expect(style(within(screen.getByTestId('stats-muscle-sort-muscle')).getByText('Muscle'))).toMatchObject({ ...LABEL, color: uiRoles.inkMuted });
  });

  it('draws figure cells in the figure role, the previous period muted', () => {
    render(<ProgressTables {...tableProps} />);
    expect(style(screen.getByTestId('stats-muscle-row-back_lats-periods'))).toMatchObject({ ...FIGURE, color: uiRoles.ink, textAlign: 'right' });
    expect(style(within(screen.getByTestId('stats-muscle-row-back_lats-periods')).getByText('(1)'))).toMatchObject({ color: uiRoles.inkMuted });
    expect(style(screen.getByTestId('stats-muscle-row-back_lats-change'))).toMatchObject({ ...FIGURE, color: uiRoles.gain });
  });

  it('reserves figure columns at the figure role size', () => {
    expect(statsTableColumnWidth('', ['12345'])).toBeCloseTo(5 * uiTypography.size.base * 0.61 + uiSpace.xs, 5);
  });

  it('draws a change that reads as a word (`new`) as a word, in its colour, not Plex Mono', () => {
    render(<ComparisonValues row={muscle('back_upper', 'Upper back', 2, 0)} metric="totalVolume"
      layout={{ columns: [40, 40, 40], stacked: false }} prefix="row" />);
    expect(screen.getByTestId('row-change')).toHaveTextContent('new');
    expect(style(screen.getByTestId('row-change'))).toMatchObject({ ...BODY, color: uiRoles.gain });
    expect(style(screen.getByTestId('row-now'))).toMatchObject(FIGURE);
  });
});

describe('Progress muscle views', () => {
  const muscles = [lats, muscle('quads', 'Quads', 4, 2)];

  it('labels the picker trigger as a control in ink, and names its sheet rows in bodyStrong with a meta figure line', () => {
    render(<MuscleBodyCard metric="workingSetCount" muscles={muscles} selectedId="back_lats" onSelect={jest.fn()} />);
    expect(style(screen.getByTestId('stats-muscle-body-selected'))).toMatchObject({ ...LABEL, color: uiRoles.ink });
    fireEvent.press(screen.getByTestId('stats-muscle-body-picker-trigger'));
    const row = screen.getByTestId('stats-muscle-picker-row-back_lats');
    expect(style(within(row).getByText('Lats'))).toMatchObject({ ...BODY_STRONG, color: uiRoles.accent });
    expect(style(within(screen.getByTestId('stats-muscle-picker-row-quads')).getByText('Quads'))).toMatchObject({ ...BODY_STRONG, color: uiRoles.ink });
    const meta = within(row).getByText(/working sets/);
    expect(style(meta)).toMatchObject(META);
    expect(style(within(meta).getByText('3'))).toMatchObject({ fontFamily: uiFonts.figure.family });
  });

  it('titles the selected muscle on the muscle view', () => {
    render(<ProgressMuscleView muscles={muscles} metric="workingSetCount" selectedId="back_lats" muscleLayout="3d"
      onSelect={jest.fn()} onMuscleHistory={jest.fn()} onExerciseHistory={jest.fn()} />);
    expect(style(screen.getByRole('header', { name: 'Lats' }))).toMatchObject({ ...TITLE, flex: 1 });
  });
});

describe('Progress filters and week list', () => {
  it('heads the gym choices with the micro-label', () => {
    render(<ProgressFilters testID="filters" gym={{ value: undefined, onChange: jest.fn(),
      options: [{ gymId: 'club', name: 'Club' }, { gymId: null, name: null }] }} />);
    fireEvent.press(screen.getByTestId('filters'));
    expect(style(screen.getByRole('header', { name: 'Gym' }))).toMatchObject({ ...LABEL, paddingHorizontal: uiSpace.lg });
    // The role itself, not a copy of its values.
    expect(screen.getByRole('header', { name: 'Gym' }).props.style[0]).toBe(uiText.label);
  });

  it('draws a week card\'s detail and the empty week in meta, its figures in the figure face', () => {
    const group = { key: 'se1', sessionId: 's1', title: 'Barbell Bench Press', detail: 'Mon 5 Oct', workingSetCount: 1,
      exerciseDefinitionId: null, record: [], rows: [] };
    const view = render(<WeekSetList groups={[group]} loading={false} error={null} onOpenSession={jest.fn()} testID="week" />);
    const detail = screen.getByText(/Mon/);
    expect(style(detail)).toMatchObject(META);
    expect(style(within(detail).getByText('5'))).toMatchObject({ fontFamily: uiFonts.figure.family });
    view.rerender(<WeekSetList groups={[]} loading={false} error={null} onOpenSession={jest.fn()} testID="week" />);
    expect(style(screen.getByTestId('week-empty'))).toMatchObject(META);
  });
});
