import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { ExerciseMap } from '@/components/stats/exercise-map';
import type { ExerciseMapEntry, ExerciseMapFamily } from '@/components/stats/exercise-map-data';
import { StyleSheet, Text } from 'react-native';
import { uiRoles } from '@/components/ui';
import { withAlpha } from '@/components/ui/lch';
import { HEAT_RAMP } from '@/components/heatmaps/heatmap-metric';
import { ProgressMuscleView } from '@/components/stats/progress-muscle-view';
import type { ProgressMuscleComparison } from '@/src/data';
import type { ProgressMetric } from '@/src/preferences/model';


const entry = (id: string, now: number, previous: number | null, targetAttainment = .25): ExerciseMapEntry => ({
  item: { id, name: `Exercise ${id}`, current: { workingSetCount: now, totalVolume: now, volumeSetCount: 1 },
    previous: { workingSetCount: previous ?? 0, totalVolume: previous, volumeSetCount: previous === 0 ? 0 : 1 }, lastCompletedAt: null }, targetAttainment,
});
const draw = (metric: ProgressMetric, exercises: ExerciseMapEntry[], family: ExerciseMapFamily['name'] = 'Legs') => render(
  <ExerciseMap families={[{ name: family, exercises, secondary: null }]} metric={metric} selectedFamily={null}
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

it.each([
  ['increase', 200, 100, withAlpha(uiRoles.gain, .16)],
  ['decrease', 50, 100, withAlpha(uiRoles.loss, .16)],
  ['neutral', 100, 100, uiRoles.ruleSoft],
  ['new', 100, 0, withAlpha(uiRoles.gain, .16)],
  ['unavailable', 100, null, uiRoles.ruleSoft],
] as const)('renders the Secondary aggregate Volume comparison as %s', (_state, now, previous, fill) => {
  const secondary = { current: entry('ignored', now, previous).item.current,
    previous: entry('ignored', now, previous).item.previous, exercises: [entry('bench', 1, 1), entry('row', 1, 1)], targetAttainment: .25 };
  render(<ExerciseMap families={[{ name: 'Arms', exercises: [entry('direct', 3, 3)], secondary }]} metric="totalVolume"
    selectedFamily="Arms" onSelectFamily={jest.fn()} renderDetail={() => null} emptyBody="Empty" />);
  expect(screen.getByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: fill });
  expect(screen.getByTestId('stats-exercise-family-Arms')).toHaveProp('accessibilityLabel', 'Show Arms exercises. 3 exercises. Includes secondary contributions.');
});

it('inherits the Secondary Sets target even when its own set delta falls', () => {
  const secondary = { current: entry('ignored', 4, 20).item.current,
    previous: entry('ignored', 4, 20).item.previous, exercises: [entry('bench', 4, 20)], targetAttainment: .25 };
  render(<ExerciseMap families={[{ name: 'Arms', exercises: [], secondary }]} metric="workingSetCount"
    selectedFamily="Arms" onSelectFamily={jest.fn()} renderDetail={() => null} emptyBody="Empty" />);
  expect(screen.getByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: HEAT_RAMP[1] });
});


it('shortens names, falls back on native overflow and passes matching numbers to full-name details', () => {
  const exercise = entry('press', 8, 4);
  exercise.item.name = 'Dumbbell Overhead Press';
  const onSelect = jest.fn();
  const detail = jest.fn((entries, _secondary, labels) => <Text>{entries.map((row: ExerciseMapEntry) => `${labels?.get(row.item.id) ?? ''} ${row.item.name}`).join()}</Text>);
  render(<ExerciseMap families={[{ name: 'Chest', exercises: [exercise], secondary: null }]} metric="workingSetCount"
    selectedFamily="Chest" onSelectFamily={onSelect} renderDetail={detail} emptyBody="Empty" />);
  expect(screen.getAllByText('DB O/H Press', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  fireEvent(screen.getByTestId('stats-exercise-tile-Chest-press-measure', { includeHiddenElements: true }), 'textLayout',
    { nativeEvent: { lines: [{ height: 20 }, { height: 20 }, { height: 20 }] } });
  expect(screen.getByText('[1]', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('1 Dumbbell Overhead Press')).toBeTruthy();
  expect(screen.getByTestId('stats-exercise-selection-Chest')).toHaveStyle({ borderColor: uiRoles.ink });
  fireEvent.press(screen.getByTestId('stats-exercise-family-Chest'));
  expect(onSelect).toHaveBeenCalledWith('Chest');
});

it('keeps Volume geometry across metrics and reserves hidden Secondary space in 1RM', () => {
  const exercise = entry('bench', 6, 4);
  exercise.item.current = { ...exercise.item.current, totalVolume: 600, estimatedOneRepMax: 110 };
  exercise.item.previous.estimatedOneRepMax = 100;
  const secondaryExercise = entry('row', 100, 1);
  const secondary = { current: { workingSetCount: 50, totalVolume: 200 }, previous: { workingSetCount: 1, totalVolume: 100 },
    exercises: [secondaryExercise], targetAttainment: .25 };
  const families: ExerciseMapFamily[] = [{ name: 'Chest', exercises: [exercise], secondary }];
  const detail = jest.fn((entries: ExerciseMapEntry[], summary) => <Text>{summary ? 'Secondary details' : entries.map(row => row.item.name).join()}</Text>);
  const props = { families, selectedFamily: 'Chest' as const, onSelectFamily: jest.fn(), renderDetail: detail, emptyBody: 'Empty' };
  const view = render(<ExerciseMap {...props} metric="workingSetCount" />);
  const bounds = () => {
    const { left, top, width, height } = StyleSheet.flatten(tile('bench', 'Chest').props.style);
    return { left, top, width, height };
  };
  const original = bounds();
  const secondaryBounds = StyleSheet.flatten(screen.getByTestId('stats-exercise-secondary-Chest', { includeHiddenElements: true }).props.style);
  expect(original.width * original.height / (secondaryBounds.width * secondaryBounds.height)).toBeCloseTo(3);
  expect(screen.getByText('6 / +2', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('Secondary details')).toBeTruthy();
  expect(detail).toHaveBeenLastCalledWith([exercise], secondary, expect.any(Map));
  view.rerender(<ExerciseMap {...props} metric="totalVolume" />);
  expect(bounds()).toEqual(original);
  expect(screen.getByTestId('stats-exercise-tile-Chest-bench-now', { includeHiddenElements: true })).toHaveTextContent('600');
  view.rerender(<ExerciseMap {...props} metric="estimatedOneRepMax" />);
  expect(bounds()).toEqual(original);
  expect(screen.getByText('110.0 / +10.0', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId('stats-exercise-secondary-Chest', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText('Secondary details')).toBeNull();
  expect(screen.getByTestId('stats-exercise-family-Chest')).toHaveProp('accessibilityLabel', 'Show Chest exercises. 1 exercises.');
  view.rerender(<ExerciseMap {...props} metric="workingSetCount" />);
  expect(bounds()).toEqual(original);
  expect(screen.getByTestId('stats-exercise-secondary-Chest', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('Secondary details')).toBeTruthy();
});

it('shows an empty primary state when 1RM hides a secondary-only family', () => {
  const secondary = { current: entry('row', 2, 1).item.current, previous: entry('row', 2, 1).item.previous,
    exercises: [entry('row', 2, 1)], targetAttainment: .25 };
  const detail = jest.fn(() => <Text>No primary details</Text>);
  render(<ExerciseMap families={[{ name: 'Arms', exercises: [], secondary }]} metric="estimatedOneRepMax"
    selectedFamily="Arms" onSelectFamily={jest.fn()} renderDetail={detail} emptyBody="Empty" />);
  expect(screen.getByTestId('stats-exercise-map-empty')).toHaveTextContent('No primary exercises in either period.');
  expect(screen.getByText('No primary details')).toBeTruthy();
  expect(screen.queryByTestId('stats-exercise-secondary-Arms', { includeHiddenElements: true })).toBeNull();
  expect(detail).toHaveBeenCalledTimes(1);
});

it('outlines the selected muscle and groups its full-name contributors by effort', () => {
  const primary = entry('curl', 3, 2).item;
  const secondary = entry('bench', 2, 1).item;
  const muscle: ProgressMuscleComparison = {
    muscleGroupId: 'biceps', familyName: 'Arms', displayName: 'Biceps', sortOrder: 0,
    current: { workingSetCount: 5, totalVolume: 5, volumeSetCount: 5 },
    previous: { workingSetCount: 3, totalVolume: 3, volumeSetCount: 3 },
    workingSetChange: 2, volumeChange: { kind: 'empty' },
    exercises: [
      { exerciseDefinitionId: 'bench', displayName: 'Barbell Bench Press', role: 'secondary',
        current: { ...secondary.current, volumeSetCount: 2 }, previous: { ...secondary.previous, volumeSetCount: 1 }, workingSetChange: 1, volumeChange: { kind: 'empty' } },
      { exerciseDefinitionId: 'curl', displayName: 'Dumbbell Curl', role: 'primary',
        current: { ...primary.current, volumeSetCount: 3 }, previous: { ...primary.previous, volumeSetCount: 2 }, workingSetChange: 1, volumeChange: { kind: 'empty' } },
    ],
  };
  const select = jest.fn();
  const history = jest.fn();
  const props = { muscles: [muscle], metric: 'workingSetCount' as const, muscleLayout: 'heatmap' as const,
    selectedId: 'biceps', workingSetTarget: 8, onSelect: select, onMuscleHistory: jest.fn(), onExerciseHistory: history };
  const view = render(<ProgressMuscleView {...props} />);
  const block = within(screen.getByTestId('stats-contributions'));
  expect(block.getByText('Primary effort')).toHaveProp('accessibilityRole', 'header');
  expect(block.getByText('Secondary effort')).toHaveProp('accessibilityRole', 'header');
  expect(block.getAllByTestId(/^stats-contribution-(bench|curl)$/).map(row => row.props.testID))
    .toEqual(['stats-contribution-curl', 'stats-contribution-bench']);
  expect(block.getByText('Barbell Bench Press')).toBeTruthy();
  expect(block.getByText('Dumbbell Curl')).toBeTruthy();
  expect(screen.getByTestId('stats-muscle-selection-biceps')).toHaveStyle({ borderColor: uiRoles.ink });
  fireEvent.press(screen.getByTestId('stats-muscle-tile-biceps'));
  expect(select).toHaveBeenCalledWith('biceps');
  fireEvent.press(block.getByRole('link', { name: 'Open Dumbbell Curl history' }));
  expect(history.mock.calls[0][0]).toEqual(muscle.exercises[1]);
  view.rerender(<ProgressMuscleView {...props} selectedId={null} />);
  expect(screen.queryByTestId('stats-muscle-selection-biceps')).toBeNull();
  expect(screen.queryByTestId('stats-contributions')).toBeNull();
});
