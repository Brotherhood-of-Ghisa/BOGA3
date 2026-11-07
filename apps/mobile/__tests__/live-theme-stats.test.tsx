/**
 * A saved theme repaints Progress's tables, filters and week list
 * (`components/ui/theme-context.tsx`): `makeStyles` sheets, text roles, tones,
 * the change colour and the roles an icon or the body model are drawn in, all
 * without a remount.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { ComparisonValues } from '@/components/stats/comparison-columns';
import { MuscleBodyCard } from '@/components/stats/muscle-body-card';
import { ProgressFilters } from '@/components/stats/progress-filters';
import { ProgressTables } from '@/components/stats/progress-tables';
import { WeekSetList } from '@/components/stats/week-set-list';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import type { ProgressMuscleComparison } from '@/src/data';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };
const before = rolesFor(DEFAULT_APPEARANCE);
const after = rolesFor(SLATE_DARK);

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;

const figures = (workingSetCount: number) => ({ workingSetCount, totalVolume: workingSetCount * 500, volumeSetCount: workingSetCount });
const muscle = (muscleGroupId: string, displayName: string, now: number, previous: number): ProgressMuscleComparison => ({
  muscleGroupId, displayName, familyName: 'Back', sortOrder: 0,
  current: figures(now), previous: figures(previous), workingSetChange: now - previous,
  volumeChange: { kind: 'percent', percent: 0 },
  exercises: [{ exerciseDefinitionId: 'pulldown', displayName: 'Lat Pulldown', role: 'primary',
    current: figures(now), previous: figures(previous), workingSetChange: now - previous,
    volumeChange: { kind: 'percent', percent: 0 } }],
} as ProgressMuscleComparison);

const lats = muscle('back_lats', 'Lats', 3, 1);

afterEach(async () => {
  await switchTheme(DEFAULT_APPEARANCE);
});

describe('live theme: Progress', () => {
  it('repaints a table: its sheet (selected rule), a sorted header (tone) and a change figure', async () => {
    renderWithTheme(<ProgressTables muscles={[lats]} metric="workingSetCount" selectedId="back_lats" grouped={false}
      onSelect={jest.fn()} onMuscleHistory={jest.fn()} onExerciseHistory={jest.fn()} sortMode="now-desc" />);
    const sorted = () => within(screen.getByTestId('stats-muscle-sort-now')).getByText('Now');
    const change = () => screen.getByTestId('stats-muscle-row-back_lats-change');
    expect(screen.getByTestId('stats-contributions')).toHaveStyle({ backgroundColor: before.ruleSoft, borderColor: before.rule });
    expect(style(sorted()).color).toBe(before.ink);
    expect(style(change()).color).toBe(before.gain);

    await switchTheme(SLATE_DARK);

    expect(after.ruleSoft).not.toBe(before.ruleSoft);
    expect(screen.getByTestId('stats-contributions')).toHaveStyle({ backgroundColor: after.ruleSoft, borderColor: after.rule });
    expect(style(sorted()).color).toBe(after.ink);
    expect(style(change()).color).toBe(after.gain);
  });

  it('repaints a change figure in the colour of its direction', async () => {
    renderWithTheme(<ComparisonValues row={muscle('back_upper', 'Upper back', 0, 2)} metric="workingSetCount"
      layout={{ columns: [60, 60, 60], stacked: false }} prefix="row" />);
    expect(style(screen.getByTestId('row-change')).color).toBe(before.loss);
    await switchTheme(SLATE_DARK);
    expect(after.loss).not.toBe(before.loss);
    expect(style(screen.getByTestId('row-change')).color).toBe(after.loss);
  });

  it('repaints the filter chip trailing icon and the sheet label', async () => {
    renderWithTheme(<ProgressFilters testID="filters" secondary={{ value: true, onChange: jest.fn() }}
      gym={{ value: undefined, onChange: jest.fn(), options: [{ gymId: 'club', name: 'Club' }, { gymId: null, name: null }] }} />);
    fireEvent.press(screen.getByTestId('filters'));
    expect(style(screen.getByText('Gym')).color).toBe(before.inkMuted);
    await switchTheme(SLATE_DARK);
    expect(after.inkMuted).not.toBe(before.inkMuted);
    expect(style(screen.getByText('Gym')).color).toBe(after.inkMuted);
  });

  it('repaints the empty week list and the muscle body card header', async () => {
    renderWithTheme(<>
      <WeekSetList groups={[]} loading={false} error={null} onOpenSession={jest.fn()} testID="week" />
      <MuscleBodyCard metric="workingSetCount" muscles={[lats]} selectedId="back_lats" onSelect={jest.fn()} />
    </>);
    expect(style(screen.getByTestId('week-empty')).color).toBe(before.inkMuted);
    expect(style(screen.getByTestId('stats-muscle-body-selected')).color).toBe(before.ink);
    await switchTheme(SLATE_DARK);
    expect(style(screen.getByTestId('week-empty')).color).toBe(after.inkMuted);
    expect(style(screen.getByTestId('stats-muscle-body-selected')).color).toBe(after.ink);
  });
});
