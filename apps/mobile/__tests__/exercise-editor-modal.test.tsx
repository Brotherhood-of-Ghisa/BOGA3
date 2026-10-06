/**
 * The exercise editor sheet on its own: how an existing exercise's mappings
 * become the primary and secondary muscles, what Save sends through a custom
 * `onSave`, its inline errors, and the muscle selector panel. The catalog
 * cache is faked for the states real data cannot hold still (loading, a failed
 * read) and to fix the muscle groups; the catalog screen and the picker cover
 * the default save over real data (`exercise-catalog-screen.test.tsx`,
 * `exercise-picker.test.tsx`).
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ExerciseEditorModal, type ExerciseEditorSaveInput } from '@/components/exercise-catalog/exercise-editor-modal';
import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import type { ExerciseCatalogCacheSnapshot } from '@/src/exercise-catalog/cache';

const MUSCLES: ExerciseCatalogMuscleGroup[] = [
  { id: 'chest', displayName: 'Chest', familyName: 'Push', sortOrder: 0 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
  { id: 'delts', displayName: 'Front delts', familyName: 'Shoulders', sortOrder: 2 },
];

let mockCatalog: ExerciseCatalogCacheSnapshot;
jest.mock('@/src/exercise-catalog/cache', () => ({
  ...jest.requireActual('@/src/exercise-catalog/cache'),
  useExerciseCatalog: () => mockCatalog,
}));
let mockBodyweightEnabled = true;
jest.mock('@/src/bodyweight/calculation-preference', () => ({
  ...jest.requireActual('@/src/bodyweight/calculation-preference'),
  useBodyweightCalculationsEnabled: () => mockBodyweightEnabled,
}));

const catalog = (over: Partial<ExerciseCatalogCacheSnapshot> = {}): ExerciseCatalogCacheSnapshot => ({
  status: 'ready',
  exercises: [],
  muscleGroups: MUSCLES,
  muscleGroupsById: Object.fromEntries(MUSCLES.map((muscle) => [muscle.id, muscle])),
  lastError: null,
  ...over,
});

const exercise = (over: Partial<ExerciseCatalogExercise> = {}): ExerciseCatalogExercise => ({
  id: 'bench',
  name: 'Bench Press',
  loadInputMode: 'total_load',
  bodyweightContribution: 0,
  deletedAt: null,
  mappings: [
    { id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
    { id: 'm2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  ],
  ...over,
});

const onSaved = jest.fn();
const onRequestClose = jest.fn();
const onSave = jest.fn<Promise<ExerciseCatalogExercise>, [ExerciseEditorSaveInput]>();

const renderEditor = (props: Partial<Parameters<typeof ExerciseEditorModal>[0]> = {}) =>
  render(
    <ExerciseEditorModal
      editingExercise={null}
      onRequestClose={onRequestClose}
      onSave={onSave}
      onSaved={onSaved}
      visible
      {...props}
    />,
  );

const save = () => act(async () => fireEvent.press(screen.getByLabelText('Save exercise definition')));
const primaryLabel = () => screen.getByTestId('exercise-editor-primary-muscle-trigger');

beforeEach(() => {
  mockCatalog = catalog();
  mockBodyweightEnabled = true;
  onSaved.mockReset();
  onRequestClose.mockReset();
  onSave.mockReset().mockImplementation(async (input) => exercise({ name: input.name }));
});

describe('editing an existing exercise', () => {
  it('saves its name, load mode, contribution, primary and secondary muscles', async () => {
    renderEditor({ editingExercise: exercise({ bodyweightContribution: 0.25 }) });
    expect(screen.getByTestId('exercise-editor-name-input')).toHaveProp('value', 'Bench Press');
    expect(screen.getByTestId('exercise-editor-bodyweight-percentage')).toHaveProp('value', '25');
    await save();
    expect(onSave).toHaveBeenCalledWith({
      bodyweightContribution: 0.25,
      name: 'Bench Press',
      loadInputMode: 'total_load',
      mappings: [
        { muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bench Press' }));
  });

  it('takes the heaviest mapping as primary when none is marked primary, drops repeats, and defaults the load mode', async () => {
    renderEditor({
      editingExercise: exercise({
        loadInputMode: undefined,
        mappings: [
          { id: 'a', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
          { id: 'b', muscleGroupId: 'delts', weight: 0.75, role: 'secondary' },
          { id: 'c', muscleGroupId: 'triceps', weight: 0.25, role: 'secondary' },
        ],
      }),
    });
    expect(primaryLabel()).toHaveTextContent('Front delts', { exact: false });
    await save();
    expect(onSave.mock.calls[0][0]).toMatchObject({
      loadInputMode: 'total_load',
      mappings: [
        { muscleGroupId: 'delts', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
    });
  });

  it('asks for a primary muscle when the exercise has no mappings', async () => {
    renderEditor({ editingExercise: exercise({ mappings: [] }) });
    expect(screen.getByText('Select primary muscle')).toBeOnTheScreen();
    await save();
    expect(screen.getByText('Select a primary muscle before saving.')).toBeOnTheScreen();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes a secondary muscle', async () => {
    renderEditor({ editingExercise: exercise() });
    fireEvent.press(screen.getByLabelText('Remove secondary muscle Triceps'));
    expect(screen.getByText('No secondary muscles selected.')).toBeOnTheScreen();
    await save();
    expect(onSave.mock.calls[0][0].mappings).toEqual([{ muscleGroupId: 'chest', weight: 1, role: 'primary' }]);
  });

  it('shows an unknown muscle by its id and an unknown family', () => {
    renderEditor({
      editingExercise: exercise({
        mappings: [
          { id: 'm1', muscleGroupId: 'retired-muscle', weight: 1, role: 'primary' },
          { id: 'm2', muscleGroupId: 'retired-too', weight: 0.5, role: 'secondary' },
        ],
      }),
    });
    expect(primaryLabel()).toHaveTextContent('retired-muscle', { exact: false });
    expect(screen.getByText('retired-too')).toBeOnTheScreen();
    expect(screen.getByText('Unknown')).toBeOnTheScreen();
  });
});

describe('inline errors', () => {
  it('clears the name error as soon as the name changes', async () => {
    renderEditor({ editingExercise: exercise() });
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), '  ');
    await save();
    expect(screen.getByTestId('exercise-editor-name-error')).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), 'Bench');
    expect(screen.queryByTestId('exercise-editor-name-error')).toBeNull();
  });

  it.each(['1e2', '-5', 'abc', '.'])('rejects the contribution "%s"', async (text) => {
    renderEditor({ editingExercise: exercise() });
    fireEvent.changeText(screen.getByTestId('exercise-editor-bodyweight-percentage'), text);
    await save();
    expect(screen.getByTestId('exercise-editor-bodyweight-error')).toBeOnTheScreen();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts a contribution written as ".5"', async () => {
    renderEditor({ editingExercise: exercise() });
    fireEvent.changeText(screen.getByTestId('exercise-editor-bodyweight-percentage'), '.5');
    await save();
    expect(onSave.mock.calls[0][0].bodyweightContribution).toBeCloseTo(0.005);
  });

  it('saves without the contribution field when bodyweight calculations are off', async () => {
    mockBodyweightEnabled = false;
    renderEditor({ editingExercise: exercise({ bodyweightContribution: 0.4 }) });
    expect(screen.queryByTestId('exercise-editor-bodyweight-percentage')).toBeNull();
    await save();
    expect(onSave.mock.calls[0][0].bodyweightContribution).toBe(0.4);
  });

  it.each<[string, unknown, string]>([
    ['an Error', new Error('Name already taken.'), 'Name already taken.'],
    ['a non-Error', 'boom', 'Unable to save exercise.'],
  ])('shows a save failure with %s and keeps the sheet open', async (_label, failure, message) => {
    onSave.mockRejectedValue(failure);
    renderEditor({ editingExercise: exercise() });
    await save();
    expect(screen.getByTestId('exercise-editor-save-error')).toHaveTextContent(message);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('muscle groups', () => {
  it('shows loading while the catalog loads', () => {
    mockCatalog = catalog({ status: 'loading', muscleGroups: [] });
    renderEditor();
    expect(screen.getByText('Loading muscle groups…')).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-editor-name-input')).toBeNull();
  });

  it.each<[string | null, string]>([
    ['Database is locked.', 'Database is locked.'],
    [null, 'Unable to load muscle groups right now.'],
  ])('shows the catalog read failure (%s) instead of the form', (lastError, message) => {
    mockCatalog = catalog({ status: 'error', muscleGroups: [], lastError });
    renderEditor();
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-editor-name-input')).toBeNull();
  });
});

describe('muscle selector', () => {
  it('picks a primary muscle, which leaves the secondaries, and goes back', async () => {
    renderEditor({ prefill: { name: 'Dip', loadInputMode: 'total_load', mappings: [{ muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' }] } });
    expect(primaryLabel()).toHaveTextContent('Triceps', { exact: false });
    fireEvent.press(primaryLabel());
    expect(screen.getByText('Select primary muscle')).toBeOnTheScreen();
    expect(screen.getByLabelText('Select primary muscle Triceps')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-option-chest'));
    expect(primaryLabel()).toHaveTextContent('Chest', { exact: false });
    fireEvent.press(screen.getByTestId('exercise-editor-secondary-muscle-trigger'));
    expect(screen.getByText('Add secondary muscle')).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-editor-muscle-option-chest')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-selector-back'));
    expect(screen.queryByTestId('exercise-editor-muscle-selector-list')).toBeNull();
    await save();
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Dip',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });
  });

  it('changes the primary muscle and keeps the other secondaries', async () => {
    renderEditor({ editingExercise: exercise() });
    fireEvent.press(primaryLabel());
    expect(screen.queryByTestId('exercise-editor-muscle-option-triceps')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-option-delts'));
    await save();
    expect(onSave.mock.calls[0][0].mappings).toEqual([
      { muscleGroupId: 'delts', weight: 1, role: 'primary' },
      { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
    ]);
  });

  it('adds a secondary muscle from the selector', async () => {
    renderEditor({ editingExercise: exercise() });
    fireEvent.press(screen.getByTestId('exercise-editor-secondary-muscle-trigger'));
    expect(screen.getByLabelText('Select secondary muscle Front delts')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-option-delts'));
    await save();
    expect(onSave.mock.calls[0][0].mappings.map((mapping) => mapping.muscleGroupId)).toEqual(['chest', 'triceps', 'delts']);
  });

  it('says when every muscle group is already chosen', () => {
    renderEditor({
      editingExercise: exercise({
        mappings: [
          { id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { id: 'm2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
          { id: 'm3', muscleGroupId: 'delts', weight: 0.5, role: 'secondary' },
        ],
      }),
    });
    fireEvent.press(screen.getByTestId('exercise-editor-secondary-muscle-trigger'));
    expect(screen.getByText('All available muscle groups are already selected as primary or secondary.')).toBeOnTheScreen();
  });

  it('says when there is no muscle group to pick as primary', () => {
    mockCatalog = catalog({ muscleGroups: [], muscleGroupsById: {} });
    renderEditor();
    fireEvent.press(primaryLabel());
    expect(screen.getByText('No primary muscle options available.')).toBeOnTheScreen();
  });
});

describe('closing', () => {
  it('opens as a page sheet that its X closes', () => {
    renderEditor({ editingExercise: exercise() });
    expect(screen.getByTestId('exercise-editor-modal')).toHaveProp('presentationStyle', 'pageSheet');
    fireEvent.press(screen.getByLabelText('Close exercise editor'));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('stays open while a save is in flight', async () => {
    let finish!: (value: ExerciseCatalogExercise) => void;
    onSave.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderEditor({ editingExercise: exercise() });
    fireEvent.press(screen.getByLabelText('Save exercise definition'));
    expect(screen.getByTestId('exercise-editor-modal')).toHaveProp('allowSwipeDismissal', false);
    expect(screen.getByLabelText('Close exercise editor')).toBeDisabled();
    fireEvent.press(screen.getByLabelText('Close exercise editor'));
    expect(onRequestClose).not.toHaveBeenCalled();
    await act(async () => finish(exercise()));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('opens with the default title for a new exercise and the given title when set', () => {
    const view = renderEditor();
    expect(screen.getByText('Create Exercise')).toBeOnTheScreen();
    view.rerender(
      <ExerciseEditorModal editingExercise={exercise()} onRequestClose={onRequestClose} onSaved={onSaved} title="Add as new" visible />,
    );
    expect(screen.getByText('Add as new')).toBeOnTheScreen();
  });
});
