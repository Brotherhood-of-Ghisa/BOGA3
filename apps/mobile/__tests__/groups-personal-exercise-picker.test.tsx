/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

import { fireEvent, render, screen } from '@testing-library/react-native';

import { PersonalExercisePicker } from '@/components/groups';
import { linkExercise } from '@/src/data/exercise-group-links';
import { exerciseDefinitions } from '@/src/data/schema';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import { closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

beforeEach(async () => {
  resetLocalData();
  __resetExerciseCatalogCacheForTests();
});
afterEach(() => closeLocalData());

const seedExercises = (items: { id: string; name: string; loadInputMode?: 'total_load' | 'per_side_load'; deletedAt?: Date }[]) => {
  const db = localDatabase();
  for (const item of items) {
    db.insert(exerciseDefinitions)
      .values({
        id: item.id,
        name: item.name,
        loadInputMode: item.loadInputMode ?? 'total_load',
        deletedAt: item.deletedAt ?? null,
      })
      .run();
  }
  __resetExerciseCatalogCacheForTests();
};

it('lists active personal exercises sorted alphabetically and excludes deleted ones', async () => {
  seedExercises([
    { id: 'ex-squat', name: 'ZZZ Custom Squat' },
    { id: 'ex-bench', name: 'AAA Custom Bench' },
    { id: 'ex-deleted', name: 'Deleted Secret Lift', deletedAt: new Date() },
  ]);

  render(<PersonalExercisePicker onPick={jest.fn()} selectedId={null} />);

  expect(await screen.findByText('AAA Custom Bench')).toBeTruthy();
  expect(screen.getByText('ZZZ Custom Squat')).toBeTruthy();
  expect(screen.queryByText('Deleted Secret Lift')).toBeNull();
});

it('searches personal exercises by name and shows empty state when no match', async () => {
  seedExercises([
    { id: 'ex-bench', name: 'Unique Alpha Press' },
    { id: 'ex-squat', name: 'Unique Beta Squat' },
  ]);

  render(<PersonalExercisePicker onPick={jest.fn()} selectedId={null} />);
  expect(await screen.findByText('Unique Alpha Press')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('group-personal-exercise-search'), 'Beta Squat');
  expect(screen.queryByText('Unique Alpha Press')).toBeNull();
  expect(screen.getByText('Unique Beta Squat')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('group-personal-exercise-search'), 'No Such Exercise Exists');
  expect(await screen.findByTestId('group-personal-exercise-no-match')).toHaveTextContent(
    'No exercise matches "No Such Exercise Exists".',
  );
});

it('shows empty catalogue message when user has no active exercises', async () => {
  const db = localDatabase();
  db.delete(exerciseDefinitions).run();
  __resetExerciseCatalogCacheForTests();

  render(<PersonalExercisePicker onPick={jest.fn()} selectedId={null} />);
  expect(await screen.findByTestId('group-personal-exercise-no-match')).toHaveTextContent(
    "You don't have any exercises in your catalogue yet.",
  );
});

it('marks the selected exercise with checked radio and fires onPick on tap', async () => {
  seedExercises([
    { id: 'ex-alpha', name: 'Alpha Selection Lift' },
    { id: 'ex-beta', name: 'Beta Selection Lift' },
  ]);

  const onPick = jest.fn();
  const { rerender } = render(<PersonalExercisePicker onPick={onPick} selectedId={null} />);

  expect(await screen.findByText('Alpha Selection Lift')).toBeTruthy();
  expect(screen.getByTestId('group-personal-exercise-ex-alpha').props.accessibilityState).toEqual({
    checked: false,
  });

  fireEvent.press(screen.getByTestId('group-personal-exercise-ex-alpha'));
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'ex-alpha', name: 'Alpha Selection Lift' }),
  );

  rerender(<PersonalExercisePicker onPick={onPick} selectedId="ex-alpha" />);
  expect(screen.getByTestId('group-personal-exercise-ex-alpha').props.accessibilityState).toEqual({
    checked: true,
  });
  expect(screen.getByTestId('group-personal-exercise-ex-beta').props.accessibilityState).toEqual({
    checked: false,
  });
});

it('disables exercises already linked in this group and prevents selecting them', async () => {
  seedExercises([
    { id: 'ex-bench', name: 'Custom Linked Bench' },
    { id: 'ex-squat', name: 'Custom Free Squat' },
  ]);

  await linkExercise('ex-bench', 'grp-test', 'gx-bench');

  const onPick = jest.fn();
  render(
    <PersonalExercisePicker
      groupId="grp-test"
      groupName="Iron Brotherhood"
      onPick={onPick}
      selectedId={null}
    />,
  );

  expect(await screen.findByText('Custom Linked Bench')).toBeTruthy();
  expect(await screen.findByText('already linked in Iron Brotherhood')).toBeTruthy();

  const linkedRow = screen.getByTestId('group-personal-exercise-ex-bench');
  expect(linkedRow.props.accessibilityState).toMatchObject({ disabled: true });
  expect(linkedRow.props.accessibilityLabel).toContain('already linked in Iron Brotherhood');

  fireEvent.press(linkedRow);
  expect(onPick).not.toHaveBeenCalled();

  const availableRow = screen.getByTestId('group-personal-exercise-ex-squat');
  expect(availableRow.props.accessibilityState.disabled).toBeUndefined();

  fireEvent.press(availableRow);
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'ex-squat', name: 'Custom Free Squat' }),
  );
});
