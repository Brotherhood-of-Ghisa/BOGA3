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
      expandedFamilies={new Set(['Chest'])}
      items={[bench, fly]}
      sections={[{ familyName: 'Chest', count: 2, exercises: [bench, fly] }]}
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

    expect(screen.getByLabelText('Select exercise Bench Press')).toHaveProp('accessibilityHint', `${bench.muscleSummary}. ${bench.statsSummary}.`);
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

  it('shows the empty copy when no exercise matches', () => {
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
    const { onToggleFamily } = renderList({ sections, expandedFamilies: new Set() });

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
    renderList({ expandedFamilies: new Set(['Chest']), sections });

    expect(screen.getByTestId('exercise-family-group-chest').props.accessibilityState).toMatchObject({
      expanded: true,
    });
    expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
  });
});

describe('ExerciseListPreferenceControls', () => {
  it('offers exactly two sorts with selected state and an accessible never-done toggle', () => {
    const onChangePreferences = jest.fn();
    const view = render(<ExerciseListPreferenceControls onChangePreferences={onChangePreferences} preferences={DEFAULT_EXERCISE_LIST_PREFERENCES} />);
    expect(screen.getByLabelText('Favourite').props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(screen.getByLabelText('Name A–Z'));
    expect(onChangePreferences).toHaveBeenLastCalledWith({ sort: 'name' });
    expect(screen.getByLabelText('Show never-done').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(screen.getByLabelText('Show never-done'));
    expect(onChangePreferences).toHaveBeenLastCalledWith({ showNeverDone: false });
    view.rerender(<ExerciseListPreferenceControls onChangePreferences={onChangePreferences} preferences={{ ...DEFAULT_EXERCISE_LIST_PREFERENCES, sort: 'name', showNeverDone: false }} />);
    expect(screen.getByLabelText('Name A–Z').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByLabelText('Show never-done').props.accessibilityState).toEqual({ checked: false });
    expect(screen.queryByText('Date range')).toBeNull();
  });
});

it('reveals search matches without changing ordinary expansion and restores collapse on clear', () => {
  const onToggleFamily = jest.fn();
  const props = { items: [bench], sections: [{ familyName: 'Chest', count: 1, exercises: [bench] }], expandedFamilies: new Set<string>(), emptyText: 'No matches', onToggleFamily, onPressExercise: jest.fn() };
  const view = render(<ExerciseListContent {...props} isSearching />);
  expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
  fireEvent.press(screen.getByTestId('exercise-family-group-chest'));
  expect(onToggleFamily).not.toHaveBeenCalled();
  view.rerender(<ExerciseListContent {...props} isSearching={false} />);
  expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
});

it('keeps empty families collapsed and disabled even when previously expanded', () => {
  renderList({ items: [], sections: [{ familyName: 'Chest', count: 0, exercises: [] }], expandedFamilies: new Set(['Chest']) });
  expect(screen.getByTestId('exercise-family-group-chest').props.accessibilityState).toMatchObject({ expanded: false, disabled: true });
});

it('replaces unknown history with loading or a retryable error, never Never done', () => {
  const onRetryHistory = jest.fn();
  const props = { items: [bench], sections: [{ familyName: 'Chest', count: 1, exercises: [bench] }], expandedFamilies: new Set(['Chest']), emptyText: 'No matches', onToggleFamily: jest.fn(), onPressExercise: jest.fn(), onRetryHistory };
  const view = render(<ExerciseListContent {...props} historyStatus="loading" />);
  expect(screen.getByText('Loading exercise history…')).toBeTruthy();
  expect(screen.queryByText('Never done')).toBeNull();
  view.rerender(<ExerciseListContent {...props} historyStatus="error" />);
  expect(screen.getByText('Unable to load exercise history.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Retry exercise history'));
  expect(onRetryHistory).toHaveBeenCalledTimes(1);
});
