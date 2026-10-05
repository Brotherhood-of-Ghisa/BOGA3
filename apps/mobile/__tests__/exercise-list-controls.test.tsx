/**
 * The shared exercise list (`components/exercise-catalog/exercise-list-controls.tsx`,
 * DLM-T06) on its own: the rows the catalogue, the session view's picker and
 * the exercise page's swap sheet render, and the shared list options. The
 * screens' own tests cover what each does with a pick.
 */

import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react-native';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import {
  ExerciseListContent,
  ExerciseListPreferenceControls,
  type FamilyExpansion,
  useFamilyExpansion,
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

// A fixed open state: the families named are open; toggles are recorded.
const expansion = (open: string[] = []): FamilyExpansion & { toggle: jest.Mock } => ({
  isExpanded: (familyName) => open.includes(familyName),
  toggle: jest.fn(),
});

const renderList = (props: Partial<Parameters<typeof ExerciseListContent>[0]> = {}) => {
  const handlers = { onPressExercise: jest.fn() };
  render(
    <ExerciseListContent
      emptyText="No exercises match that filter."
      familyExpansion={expansion(['Chest'])}
      items={[bench, fly]}
      sections={[{ familyName: 'Chest', count: 2, exercises: [bench, fly] }]}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

const colorOf = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as any) ?? {}).color;

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
    const familyExpansion = expansion();
    renderList({ sections, familyExpansion });

    const chest = screen.getByTestId('exercise-family-group-chest');
    expect(chest.props.accessibilityLabel).toBe('Chest exercises 1');
    expect(chest.props.accessibilityState).toMatchObject({ expanded: false, disabled: false });
    expect(screen.getByTestId('exercise-family-group-lower-legs').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();

    fireEvent.press(chest);
    expect(familyExpansion.toggle).toHaveBeenCalledWith('Chest');
  });

  it('lists an expanded family under its header', () => {
    renderList({ familyExpansion: expansion(['Chest']), sections });

    expect(screen.getByTestId('exercise-family-group-chest').props.accessibilityState).toMatchObject({
      expanded: true,
    });
    expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();
  });
});

describe('ExerciseListPreferenceControls', () => {
  it('lays Never-done, the host chips and Sort out in one row', () => {
    render(
      <ExerciseListPreferenceControls onChangePreferences={jest.fn()} preferences={DEFAULT_EXERCISE_LIST_PREFERENCES}>
        <Text testID="host-chip">Groups</Text>
      </ExerciseListPreferenceControls>,
    );

    const row = screen.getByTestId('exercise-list-controls');
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row' });
    const order = row.props.children.flat().filter(Boolean).map((child: { props: { testID: string } }) => child.props.testID);
    expect(order).toEqual(['exercise-list-never-done', 'host-chip', 'exercise-list-sort']);
    // No section label or segmented control above the row any more.
    expect(screen.queryByText('Sort')).toBeNull();
    expect(screen.queryByText('Date range')).toBeNull();
  });

  it('Sort switches between the two orders; Never-done is a checkbox, ink while on', () => {
    const onChangePreferences = jest.fn();
    const view = render(<ExerciseListPreferenceControls onChangePreferences={onChangePreferences} preferences={DEFAULT_EXERCISE_LIST_PREFERENCES} />);

    const sort = screen.getByLabelText('Sort: Favourite');
    expect(sort).toHaveProp('accessibilityRole', 'button');
    expect(sort).toHaveProp('accessibilityHint', 'Sorts by name A to Z');
    fireEvent.press(sort);
    expect(onChangePreferences).toHaveBeenLastCalledWith({ sort: 'name' });

    const neverDone = screen.getByLabelText('Show never-done');
    expect(neverDone).toHaveProp('accessibilityState', { checked: true });
    expect(within(neverDone).getByText('Never-done')).toBeTruthy();
    expect(StyleSheet.flatten(neverDone.props.style)).toMatchObject({ backgroundColor: uiRoles.ink });
    fireEvent.press(neverDone);
    expect(onChangePreferences).toHaveBeenLastCalledWith({ showNeverDone: false });

    view.rerender(<ExerciseListPreferenceControls onChangePreferences={onChangePreferences} preferences={{ ...DEFAULT_EXERCISE_LIST_PREFERENCES, sort: 'name', showNeverDone: false }} />);
    fireEvent.press(screen.getByLabelText('Sort: A–Z'));
    expect(onChangePreferences).toHaveBeenLastCalledWith({ sort: 'favourite' });
    expect(screen.getByLabelText('Show never-done')).toHaveProp('accessibilityState', { checked: false });
    expect(StyleSheet.flatten(screen.getByLabelText('Show never-done').props.style)).toMatchObject({
      backgroundColor: uiRoles.surface,
    });
  });
});

describe('useFamilyExpansion', () => {
  it('browsing: families start closed and a tap opens one', () => {
    const { result } = renderHook(() => useFamilyExpansion(false));
    expect(result.current.isExpanded('Chest')).toBe(false);

    act(() => result.current.toggle('Chest'));
    expect(result.current.isExpanded('Chest')).toBe(true);
    expect(result.current.isExpanded('Back')).toBe(false);
    act(() => result.current.toggle('Chest'));
    expect(result.current.isExpanded('Chest')).toBe(false);
  });

  it('searching: families start open, a tap closes one, and a new search opens them again', () => {
    const { result, rerender } = renderHook(({ searching }: { searching: boolean }) => useFamilyExpansion(searching), {
      initialProps: { searching: false },
    });
    act(() => result.current.toggle('Back'));

    rerender({ searching: true });
    expect(result.current.isExpanded('Chest')).toBe(true);
    act(() => result.current.toggle('Chest'));
    expect(result.current.isExpanded('Chest')).toBe(false);
    expect(result.current.isExpanded('Back')).toBe(true);

    // Clearing the search restores what was open while browsing.
    rerender({ searching: false });
    expect(result.current.isExpanded('Chest')).toBe(false);
    expect(result.current.isExpanded('Back')).toBe(true);

    rerender({ searching: true });
    expect(result.current.isExpanded('Chest')).toBe(true);
  });
});

it('a search match can be collapsed and reopened from its family header', () => {
  const Harness = ({ searching }: { searching: boolean }) => (
    <ExerciseListContent
      emptyText="No matches"
      familyExpansion={useFamilyExpansion(searching)}
      items={[bench]}
      onPressExercise={jest.fn()}
      sections={[{ familyName: 'Chest', count: 1, exercises: [bench] }]}
    />
  );
  const view = render(<Harness searching />);
  expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();

  fireEvent.press(screen.getByTestId('exercise-family-group-chest'));
  expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
  fireEvent.press(screen.getByTestId('exercise-family-group-chest'));
  expect(screen.getByLabelText('Select exercise Bench Press')).toBeTruthy();

  view.rerender(<Harness searching={false} />);
  expect(screen.queryByLabelText('Select exercise Bench Press')).toBeNull();
});

it('keeps empty families collapsed and disabled even when previously expanded', () => {
  renderList({ items: [], sections: [{ familyName: 'Chest', count: 0, exercises: [] }], familyExpansion: expansion(['Chest']) });
  expect(screen.getByTestId('exercise-family-group-chest').props.accessibilityState).toMatchObject({ expanded: false, disabled: true });
});

it('replaces unknown history with loading or a retryable error, never Never done', () => {
  const onRetryHistory = jest.fn();
  const props = { items: [bench], sections: [{ familyName: 'Chest', count: 1, exercises: [bench] }], familyExpansion: expansion(['Chest']), emptyText: 'No matches', onPressExercise: jest.fn(), onRetryHistory };
  const view = render(<ExerciseListContent {...props} historyStatus="loading" />);
  expect(screen.getByText('Loading exercise history…')).toBeTruthy();
  expect(screen.queryByText('Never done')).toBeNull();
  view.rerender(<ExerciseListContent {...props} historyStatus="error" />);
  expect(screen.getByText('Unable to load exercise history.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Retry exercise history'));
  expect(onRetryHistory).toHaveBeenCalledTimes(1);
});
