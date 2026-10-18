import { fireEvent, render, screen } from '@testing-library/react-native';
import { ExerciseMap } from '@/components/stats/exercise-map';
import type { ExerciseMapEntry, ExerciseMapFamily } from '@/components/stats/exercise-map-data';
import { uiRoles } from '@/components/ui';
import { withAlpha } from '@/components/ui/lch';
import { HEAT_RAMP } from '@/components/heatmaps/heatmap-metric';
import type { ProgressMetric } from '@/src/preferences/model';

const entry = (id: string, now: number, previous: number | null, targetAttainment = .25): ExerciseMapEntry => ({
  item: { id, name: `Exercise ${id}`, current: { workingSetCount: now, totalVolume: now, volumeSetCount: 1 },
    previous: { workingSetCount: previous ?? 0, totalVolume: previous, volumeSetCount: previous === 0 ? 0 : 1 }, lastCompletedAt: null }, targetAttainment,
});
const draw = (metric: ProgressMetric, exercises: ExerciseMapEntry[], family: ExerciseMapFamily['name'] = 'Legs') => render(
  <ExerciseMap families={[{ name: family, exercises }]} metric={metric} selectedFamily={null}
    onSelectFamily={jest.fn()} renderDetail={() => null} emptyBody="Empty" />
);
const tile = (id: string, family = 'Legs') => screen.getByTestId(`stats-exercise-tile-${family}-${id}`, { includeHiddenElements: true });

it('colours each Volume tile from its own positive, negative, unchanged, new or unavailable comparison', () => {
  draw('totalVolume', [entry('increase', 200, 100), entry('decrease', 50, 100), entry('same', 100, 100),
    entry('new', 100, 0), entry('unavailable', 100, null)]);
  expect(tile('increase')).toHaveStyle({ backgroundColor: withAlpha(uiRoles.gain, .16) });
  expect(tile('decrease')).toHaveStyle({ backgroundColor: withAlpha(uiRoles.loss, .16) });
  expect(tile('same')).toHaveStyle({ backgroundColor: uiRoles.ruleSoft });
  expect(tile('new')).toHaveStyle({ backgroundColor: withAlpha(uiRoles.gain, .16) });
  expect(tile('unavailable')).toHaveStyle({ backgroundColor: uiRoles.ruleSoft });
});

it('gives opposite exercise-set changes the same inherited primary-muscle target fill', () => {
  draw('workingSetCount', [entry('declining', 1, 20), entry('growing', 20, 1)]);
  expect(tile('declining')).toHaveStyle({ backgroundColor: HEAT_RAMP[1] });
  expect(tile('growing')).toHaveStyle({ backgroundColor: HEAT_RAMP[1] });
});

it('shows current figures in compact proportional boxes and leaves too-small boxes visual only', () => {
  draw('workingSetCount', [entry('bench', 4, 1), entry('incline', 3, 1), entry('tiny', .0001, 1)], 'Chest');
  fireEvent(screen.getByTestId('stats-exercise-map'), 'layout', { nativeEvent: { layout: { width: 343, height: 0, x: 0, y: 0 } } });
  expect(screen.getByTestId('stats-exercise-tile-Chest-bench-now', { includeHiddenElements: true })).toHaveTextContent('4');
  expect(screen.getByTestId('stats-exercise-tile-Chest-incline-now', { includeHiddenElements: true })).toHaveTextContent('3');
  expect(screen.queryByTestId('stats-exercise-tile-Chest-tiny-now', { includeHiddenElements: true })).toBeNull();
  expect(tile('tiny', 'Chest')).toBeTruthy();
  expect(screen.getByTestId('stats-exercise-family-Chest')).toHaveProp('accessibilityRole', 'button');
});
