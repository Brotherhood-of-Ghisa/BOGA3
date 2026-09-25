/**
 * The shared exercise list (`components/exercise-catalog/exercise-list-controls.tsx`,
 * DLM-T06) on its own: the rows the catalogue, the session view's picker and
 * the exercise page's swap sheet render, and the shared list options. The
 * screens' own tests cover what each does with a pick.
 */

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
} from '@/components/exercise-catalog/exercise-list-controls';
import { uiFonts, uiRoles } from '@/components/ui';
import {
  DEFAULT_EXERCISE_LIST_PREFERENCES,
  type ExerciseListItem,
  type ExerciseListSection,
} from '@/src/exercise-catalog/list-model';

const item = (id: string, name: string, overrides: Partial<ExerciseListItem> = {}): ExerciseListItem =>
  ({
    id,
    name,
    deletedAt: null,
    muscleSummary: 'Chest · Triceps (s)',
    statsSummary: 'Never done',
    ...overrides,
  }) as ExerciseListItem;

const bench = item('bench', 'Bench Press');
const fly = item('fly', 'Cable Fly', { deletedAt: 1_700_000_000_000 as never });

const renderList = (props: Partial<Parameters<typeof ExerciseListContent>[0]> = {}) => {
  const handlers = { onToggleFamily: jest.fn(), onPressExercise: jest.fn() };
  render(
    <ExerciseListContent
      emptyText="No exercises match that filter."
      expandedFamilies={new Set()}
      items={[bench, fly]}
      mode="flat"
      sections={[]}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

const colorOf = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {}).color;

describe('ExerciseListContent rows', () => {
  it('makes each row one target labelled for the pick, with the stats line in Plex Mono', () => {
    const { onPressExercise } = renderList();

    fireEvent.press(screen.getByLabelText('Select exercise Bench Press'));
    expect(onPressExercise).toHaveBeenCalledWith(bench);
    const stats = screen.getAllByText('Never done')[0];
    expect(StyleSheet.flatten(stats.props.style).fontFamily).toBe(uiFonts.figure.family);
    expect(colorOf(stats)).toBe(uiRoles.inkMuted);
  });

  it('marks a deleted exercise with a faint tag and faded text, never a warning hue', () => {
    renderList();

    const row = within(screen.getByLabelText('Select exercise Cable Fly'));
    expect(row.getByText('Deleted')).toBeTruthy();
    expect(colorOf(row.getByText('Deleted'))).toBe(uiRoles.inkFaint);
    expect(colorOf(row.getByText('Cable Fly'))).toBe(uiRoles.inkFaint);
    expect(colorOf(within(screen.getByLabelText('Select exercise Bench Press')).getByText('Bench Press'))).toBe(
      uiRoles.ink,
    );
  });

  it('keeps row actions reachable beside the row target', () => {
    const onAction = jest.fn();
    const { onPressExercise } = renderList({
      getExerciseAccessibilityLabel: (exercise) => `Edit exercise definition ${exercise.name}`,
      renderActions: (exercise) => (
        <Text accessibilityLabel={`Exercise actions ${exercise.name}`} onPress={() => onAction(exercise.id)}>
          Actions
        </Text>
      ),
    });

    fireEvent.press(screen.getByLabelText('Exercise actions Bench Press'));
    expect(onAction).toHaveBeenCalledWith('bench');
    expect(onPressExercise).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Edit exercise definition Bench Press'));
    expect(onPressExercise).toHaveBeenCalledWith(bench);
  });

  it('shows the empty copy when a flat list has nothing', () => {
    renderList({ items: [] });
    expect(screen.getByText('No exercises match that filter.')).toBeTruthy();
  });
});

describe('ExerciseListContent grouped', () => {
  const sections: ExerciseListSection[] = [
    { familyName: 'Chest', count: 1, exercises: [bench] },
    { familyName: 'Lower Legs', count: 0, exercises: [] },
  ];

  it('heads each family with a disclosure row: count, chevron, expanded state', () => {
    const { onToggleFamily } = renderList({ mode: 'grouped', sections });

    const chest = screen.getByTestId('exercise-family-group-chest');
    expect(chest.props.accessibilityLabel).toBe('Chest exercises 1');
    expect(chest.props.accessibilityState).toMatchObject({ expanded: false, disabled: false });
    expect(screen.getByTestId('exercise-family-group-lower-legs').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();

    fireEvent.press(chest);
    expect(onToggleFamily).toHaveBeenCalledWith('Chest');
  });

  it('lists an expanded family under its header', () => {
    renderList({ expandedFamilies: new Set(['Chest']), mode: 'grouped', sections });

    expect(screen.getByTestId('exercise-family-group-chest').props.accessibilityState).toMatchObject({
      expanded: true,
    });
    expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
  });
});

describe('ExerciseListPreferenceControls', () => {
  it('picks the stats window from a segmented control and toggles the list options by what they do', () => {
    const onChangePreferences = jest.fn();
    render(
      <ExerciseListPreferenceControls
        onChangePreferences={onChangePreferences}
        preferences={DEFAULT_EXERCISE_LIST_PREFERENCES}
      />,
    );

    expect(screen.getByTestId('exercise-list-date-range-90').props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(screen.getByLabelText('Date range 30d'));
    expect(onChangePreferences).toHaveBeenLastCalledWith({ dateRange: 30 });

    // Grouping and recents are on by default, so each chip offers to turn off.
    expect(screen.getByLabelText('Turn grouping off').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(screen.getByLabelText('Turn grouping off'));
    expect(onChangePreferences).toHaveBeenLastCalledWith({ groupByMuscleFamily: false });
    fireEvent.press(screen.getByLabelText('Turn recents on top off'));
    expect(onChangePreferences).toHaveBeenLastCalledWith({ recentsOnTop: false });
  });

  it('offers to turn each option back on', () => {
    render(
      <ExerciseListPreferenceControls
        onChangePreferences={jest.fn()}
        preferences={{ ...DEFAULT_EXERCISE_LIST_PREFERENCES, groupByMuscleFamily: false, recentsOnTop: false }}
      />,
    );

    expect(screen.getByLabelText('Turn grouping on').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByLabelText('Turn recents on top on')).toBeTruthy();
  });
});
