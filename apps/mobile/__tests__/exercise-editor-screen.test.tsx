/**
 * The exercise editor page on its own: its sections (Groups, Muscles, Weight,
 * Options), how an existing exercise's mappings become the primary and
 * secondary muscles, the bodyweight switch, what Save sends through a custom
 * `onSave`, its inline errors, the muscle picker sheets, and the page title.
 * The catalog cache and the group links are faked for the states real data
 * cannot hold still; the catalogue and the picker cover the default save over
 * real data (`exercise-catalog-screen.test.tsx`, `exercise-picker.test.tsx`).
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import type { ExerciseEditorRequest, ExerciseEditorSaveInput } from '@/components/exercise-catalog/exercise-editor-request';
import { ExerciseEditorScreen } from '@/components/exercise-catalog/exercise-editor-screen';
import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import type { ExerciseCatalogCacheSnapshot } from '@/src/exercise-catalog/cache';
import { buildMuscleSetup, EMPTY_MUSCLE_SETUP } from '@/src/exercise-catalog/muscle-setup';

import { broadMuscleRows, detailedMuscleRows } from './helpers/muscle-setup';

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockTitle: string | undefined;
let mockPreviousRoute = 'exercise-catalog';
let mockRoutesAbove: { name: string }[] = [];
let mockRoutesBelow: { name: string }[] = [];
let mockEditorInState = true;
let mockFocused = true;
let mockOptions: { gestureEnabled?: boolean; headerBackVisible?: boolean } = {};
let mockHeaderLeft: (() => unknown) | undefined;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useNavigation: () => ({
    getState: () => ({ routes: [...mockRoutesBelow, { name: mockPreviousRoute }, ...(mockEditorInState ? [{ name: 'exercise-edit' }] : []), ...mockRoutesAbove] }),
    isFocused: () => mockFocused,
  }),
  Stack: {
    Screen: ({ options }: { options?: { title?: string; headerLeft?: () => unknown; gestureEnabled?: boolean; headerBackVisible?: boolean } }) => {
      mockTitle = options?.title;
      mockOptions = options ?? {};
      mockHeaderLeft = options?.headerLeft;
      return null;
    },
  },
}));

const MUSCLES: ExerciseCatalogMuscleGroup[] = [
  { id: 'chest', displayName: 'Chest', familyName: 'Push', sortOrder: 0, reportGroup: null, tracked: 1 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1, reportGroup: null, tracked: 1 },
  { id: 'delts', displayName: 'Front delts', familyName: 'Shoulders', sortOrder: 2, reportGroup: null, tracked: 1 },
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
let mockLinkingUserId: string | null = null;
let mockLinks: { exerciseDefinitionId: string; groupId: string; groupExerciseId: string }[] = [];
let mockLinksReady = true;
jest.mock('@/src/groups/use-group-exercise-linking', () => ({
  useGroupLinkingUserId: () => mockLinkingUserId,
  useGroupExerciseLinking: () => ({
    catalogs: [{ groupId: 'crew', groupName: 'Lifting Crew', exercises: [{ group_exercise_id: 'gx-bench', name: 'Crew Bench', archived_at_ms: null }] }],
    linkedCatalogs: [],
    links: mockLinks,
    linksReady: mockLinksReady,
  }),
}));

const catalog = (over: Partial<ExerciseCatalogCacheSnapshot> = {}): ExerciseCatalogCacheSnapshot => ({
  status: 'ready',
  exercises: [],
  muscleGroups: MUSCLES,
  muscleGroupsById: Object.fromEntries(MUSCLES.map((muscle) => [muscle.id, muscle])),
  muscleSetup: buildMuscleSetup(MUSCLES),
  lastError: null,
  ...over,
});

const indexed = (entry: ExerciseCatalogExercise) => ({ ...entry, searchText: entry.name.toLowerCase() });

const exercise = (over: Partial<ExerciseCatalogExercise> = {}): ExerciseCatalogExercise => ({
  id: 'bench',
  name: 'Bench Press',
  loadInputMode: 'total_load',
  bodyweightContribution: 0,
  splitByGym: false,
  restTimerSec: null,
  deletedAt: null,
  mappings: [
    { id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
    { id: 'm2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
  ],
  ...over,
});

const onSaved = jest.fn();
const onSave = jest.fn<Promise<ExerciseCatalogExercise>, [ExerciseEditorSaveInput]>();

/** Edits `editing` (put in the catalog) or creates one; `request` adds a prefill or title. */
const renderEditor = ({ editing, ...request }: Partial<ExerciseEditorRequest> & { editing?: ExerciseCatalogExercise } = {}) => {
  if (editing) mockCatalog = { ...mockCatalog, exercises: [indexed(editing)] };
  const page = (current: ExerciseCatalogCacheSnapshot) => {
    mockCatalog = current;
    return <ExerciseEditorScreen request={{ onSave, onSaved, exerciseDefinitionId: editing?.id ?? null, ...request }} />;
  };
  const view = render(page(mockCatalog));
  return { ...view, rerenderWith: (next: ExerciseCatalogCacheSnapshot) => view.rerender(page(next)) };
};

const save = () => act(async () => fireEvent.press(screen.getByLabelText('Save exercise definition')));
const primaryRow = () => screen.getByTestId('exercise-editor-primary-muscle-trigger');
const secondaryRow = () => screen.getByTestId('exercise-editor-secondary-muscle-trigger');
const bodyweightSwitch = () => screen.getByTestId('exercise-editor-uses-bodyweight');

beforeEach(() => {
  mockCatalog = catalog();
  mockBodyweightEnabled = true;
  mockLinkingUserId = null;
  mockLinks = [];
  mockLinksReady = true;
  mockTitle = undefined;
  mockHeaderLeft = undefined;
  mockPreviousRoute = 'exercise-catalog';
  mockRoutesAbove = [];
  mockRoutesBelow = [];
  mockEditorInState = true;
  mockFocused = true;
  mockBack.mockReset();
  mockPush.mockReset();
  onSaved.mockReset();
  onSave.mockReset().mockImplementation(async (input) => exercise({ name: input.name }));
});

describe('editing an existing exercise', () => {
  it('saves its name, load mode, contribution, primary and secondary muscles, then goes back', async () => {
    renderEditor({ editing: exercise({ bodyweightContribution: 0.25 }) });
    expect(screen.getByTestId('exercise-editor-name-input')).toHaveProp('value', 'Bench Press');
    expect(bodyweightSwitch().props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('exercise-editor-bodyweight-percentage')).toHaveProp('value', '25');
    await save();
    expect(onSave).toHaveBeenCalledWith({
      bodyweightContribution: 0.25,
      name: 'Bench Press',
      loadInputMode: 'total_load',
      splitByGym: false,
      restTimerSec: null,
      mappings: [
        { muscleGroupId: 'chest', weight: 1, role: 'primary' },
        { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
      ],
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bench Press' }));
  });

  it('is titled with the exercise name and saves with "Save"', () => {
    renderEditor({ editing: exercise() });
    expect(mockTitle).toBe('Edit "Bench Press"');
    expect(screen.getByTestId('exercise-editor-save')).toHaveTextContent('Save', { exact: false });
  });

  it('takes the heaviest mapping as primary when none is marked primary, drops repeats, and defaults the load mode', async () => {
    renderEditor({
      editing: exercise({
        loadInputMode: undefined,
        mappings: [
          { id: 'a', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
          { id: 'b', muscleGroupId: 'delts', weight: 0.75, role: 'secondary' },
          { id: 'c', muscleGroupId: 'triceps', weight: 0.25, role: 'secondary' },
        ],
      }),
    });
    expect(primaryRow()).toHaveTextContent('Front delts', { exact: false });
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
    renderEditor({ editing: exercise({ mappings: [] }) });
    expect(primaryRow()).toHaveTextContent('Choose', { exact: false });
    expect(secondaryRow()).toHaveTextContent('None', { exact: false });
    await save();
    expect(screen.getByTestId('exercise-editor-muscles-error')).toHaveTextContent('Select a primary muscle before saving.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows an unknown muscle by its id', () => {
    renderEditor({
      editing: exercise({
        mappings: [
          { id: 'm1', muscleGroupId: 'retired-muscle', weight: 1, role: 'primary' },
          { id: 'm2', muscleGroupId: 'retired-too', weight: 0.5, role: 'secondary' },
        ],
      }),
    });
    expect(primaryRow()).toHaveTextContent('retired-muscle', { exact: false });
    expect(secondaryRow()).toHaveTextContent('retired-too', { exact: false });
  });

  it('keeps unsaved edits when the catalogue refreshes beneath it (back from Link)', () => {
    const view = renderEditor({ editing: exercise() });
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), 'Bench (paused)');
    view.rerenderWith({ ...mockCatalog, exercises: [indexed(exercise({ name: 'Bench Press' }))] });
    expect(screen.getByTestId('exercise-editor-name-input')).toHaveProp('value', 'Bench (paused)');
  });

  it.each<[string, Partial<ExerciseCatalogCacheSnapshot>, string]>([
    ['missing', { exercises: [] }, "This exercise isn't available to edit."],
    ['deleted', { exercises: [indexed(exercise({ deletedAt: new Date(0) }))] }, "This exercise isn't available to edit."],
    ['still loading', { status: 'loading', exercises: [] }, 'Loading exercise…'],
  ])('says so instead of a form when the exercise is %s', (_case, over, message) => {
    mockCatalog = catalog(over);
    render(<ExerciseEditorScreen request={{ exerciseDefinitionId: 'bench' }} />);
    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-editor-name-input')).toBeNull();
  });
});

describe('the header', () => {
  it('keeps the native back over an ordinary page', () => {
    renderEditor({ editing: exercise() });
    expect(mockHeaderLeft).toBeUndefined();
  });

  it('closes by an X, writing nothing, when it opens over the exercise picker', () => {
    mockPreviousRoute = 'session/[sessionId]/add-exercise';
    renderEditor();
    render(<>{mockHeaderLeft?.() as React.ReactElement}</>);
    fireEvent.press(screen.getByLabelText('Close exercise editor'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('robustness', () => {
  it('closes by an X over the catalogue opened from the picker (Manage), a card too', () => {
    mockRoutesBelow = [{ name: 'session/[sessionId]/add-exercise' }];
    mockPreviousRoute = 'exercise-catalog';
    renderEditor({ editing: exercise() });
    expect(mockHeaderLeft).toBeDefined();
  });

  it('closes by an X on its first render, before the page is in the navigation state', () => {
    mockPreviousRoute = 'session/[sessionId]/add-exercise';
    mockEditorInState = false;
    renderEditor();
    expect(mockHeaderLeft).toBeDefined();
  });

  it('keeps the X when a page is pushed over the editor (Link) and it re-renders', () => {
    mockPreviousRoute = 'session/[sessionId]/add-exercise';
    mockRoutesAbove = [{ name: 'exercise-link' }];
    renderEditor();
    expect(mockHeaderLeft).toBeDefined();
  });

  it('holds the page while a save is in flight: no back, no swipe', async () => {
    let finish!: (value: ExerciseCatalogExercise) => void;
    onSave.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderEditor({ editing: exercise() });
    expect(mockOptions).toMatchObject({ gestureEnabled: true, headerBackVisible: true });
    fireEvent.press(screen.getByLabelText('Save exercise definition'));
    expect(mockOptions).toMatchObject({ gestureEnabled: false, headerBackVisible: false });
    await act(async () => finish(exercise()));
  });

  it('never pops its caller: a save finishing after the page left only reports', async () => {
    mockFocused = false;
    renderEditor({ editing: exercise() });
    await save();
    expect(mockBack).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('refuses to edit a request no longer in memory rather than save without its caller', () => {
    render(<ExerciseEditorScreen request={{ lost: true }} />);
    expect(screen.getByText('This edit is no longer open. Go back and start it again.')).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-editor-name-input')).toBeNull();
  });
});

describe('creating an exercise', () => {
  it('is titled "New exercise", or the caller\'s title, and adds with "Add exercise"', () => {
    const view = renderEditor();
    expect(mockTitle).toBe('New exercise');
    expect(screen.getByTestId('exercise-editor-save')).toHaveTextContent('Add exercise', { exact: false });
    view.unmount();
    renderEditor({ title: 'Add as new exercise' });
    expect(mockTitle).toBe('Add as new exercise');
  });

  it('has no Groups section until it is saved', () => {
    mockLinkingUserId = 'me';
    renderEditor();
    expect(screen.queryByTestId('exercise-editor-groups')).toBeNull();
  });
});

describe('Groups', () => {
  it('is hidden while signed out', () => {
    renderEditor({ editing: exercise() });
    expect(screen.queryByTestId('exercise-editor-groups')).toBeNull();
  });

  it('lists the group exercises it counts towards, and every row opens the Link page', () => {
    mockLinkingUserId = 'me';
    mockLinks = [{ exerciseDefinitionId: 'bench', groupId: 'crew', groupExerciseId: 'gx-bench' }];
    renderEditor({ editing: exercise() });
    const groups = screen.getByTestId('exercise-editor-groups');
    expect(within(groups).getByLabelText('Linked to Crew Bench in Lifting Crew')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('exercise-editor-linked-gx-bench'));
    fireEvent.press(screen.getByTestId('exercise-editor-link'));
    expect(mockPush).toHaveBeenNthCalledWith(1, '/exercise-link?exerciseDefinitionId=bench');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/exercise-link?exerciseDefinitionId=bench');
  });

  it('offers only Link while the links read', () => {
    mockLinkingUserId = 'me';
    mockLinksReady = false;
    mockLinks = [{ exerciseDefinitionId: 'bench', groupId: 'crew', groupExerciseId: 'gx-bench' }];
    renderEditor({ editing: exercise() });
    expect(screen.queryByTestId('exercise-editor-linked-gx-bench')).toBeNull();
    expect(screen.getByTestId('exercise-editor-link')).toBeOnTheScreen();
  });
});

describe('Weight: Uses bodyweight', () => {
  it('opens off for an ordinary exercise, hiding the share', () => {
    renderEditor({ editing: exercise() });
    expect(bodyweightSwitch().props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.queryByTestId('exercise-editor-bodyweight-percentage')).toBeNull();
  });

  it('switched on starts the share at 0, and a typed share saves', async () => {
    renderEditor({ editing: exercise() });
    fireEvent.press(bodyweightSwitch());
    expect(screen.getByTestId('exercise-editor-bodyweight-percentage')).toHaveProp('value', '0');
    fireEvent.changeText(screen.getByTestId('exercise-editor-bodyweight-percentage'), '65');
    await save();
    expect(onSave.mock.calls[0][0].bodyweightContribution).toBeCloseTo(0.65);
  });

  it('keeps the share field while it is cleared to type a new value', async () => {
    renderEditor({ editing: exercise({ bodyweightContribution: 0.5 }) });
    const share = () => screen.getByTestId('exercise-editor-bodyweight-percentage');
    fireEvent.changeText(share(), '');
    fireEvent.changeText(share(), '0');
    fireEvent.changeText(share(), '0.');
    expect(bodyweightSwitch().props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.changeText(share(), '0.7');
    await save();
    expect(onSave.mock.calls[0][0].bodyweightContribution).toBeCloseTo(0.007);
  });

  it('switched off saves 0 and hides the share', async () => {
    renderEditor({ editing: exercise({ bodyweightContribution: 0.4 }) });
    fireEvent.press(bodyweightSwitch());
    expect(screen.queryByTestId('exercise-editor-bodyweight-percentage')).toBeNull();
    await save();
    expect(onSave.mock.calls[0][0].bodyweightContribution).toBe(0);
  });

  it.each(['1e2', '-5', 'abc', '.'])('rejects the share "%s" under the Weight section', async (text) => {
    renderEditor({ editing: exercise({ bodyweightContribution: 0.1 }) });
    fireEvent.changeText(screen.getByTestId('exercise-editor-bodyweight-percentage'), text);
    await save();
    expect(screen.getByTestId('exercise-editor-bodyweight-error')).toBeOnTheScreen();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts a share written as ".5"', async () => {
    renderEditor({ editing: exercise() });
    fireEvent.press(bodyweightSwitch());
    fireEvent.changeText(screen.getByTestId('exercise-editor-bodyweight-percentage'), '.5');
    await save();
    expect(onSave.mock.calls[0][0].bodyweightContribution).toBeCloseTo(0.005);
  });

  it('shows no switch and keeps the stored share when bodyweight calculations are off', async () => {
    mockBodyweightEnabled = false;
    renderEditor({ editing: exercise({ bodyweightContribution: 0.4 }) });
    expect(screen.queryByTestId('exercise-editor-uses-bodyweight')).toBeNull();
    await save();
    expect(onSave.mock.calls[0][0].bodyweightContribution).toBe(0.4);
  });

  it('switches the load mode to per side', async () => {
    renderEditor({ editing: exercise() });
    fireEvent.press(screen.getByTestId('exercise-editor-load-mode-per_side_load'));
    await save();
    expect(onSave.mock.calls[0][0].loadInputMode).toBe('per_side_load');
  });
});

describe('inline errors', () => {
  it('clears the name error as soon as the name changes', async () => {
    renderEditor({ editing: exercise() });
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), '  ');
    await save();
    expect(screen.getByTestId('exercise-editor-name-error')).toBeOnTheScreen();
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), 'Bench');
    expect(screen.queryByTestId('exercise-editor-name-error')).toBeNull();
  });

  it.each<[string, unknown, string]>([
    ['an Error', new Error('Name already taken.'), 'Name already taken.'],
    ['a non-Error', 'boom', 'Unable to save exercise.'],
  ])('shows a save failure with %s and stays on the page', async (_label, failure, message) => {
    onSave.mockRejectedValue(failure);
    renderEditor({ editing: exercise() });
    await save();
    expect(screen.getByTestId('exercise-editor-save-error')).toHaveTextContent(message);
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('disables Save while a save is in flight', async () => {
    let finish!: (value: ExerciseCatalogExercise) => void;
    onSave.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderEditor({ editing: exercise() });
    fireEvent.press(screen.getByLabelText('Save exercise definition'));
    expect(screen.getByLabelText('Save exercise definition')).toBeDisabled();
    expect(screen.getByTestId('exercise-editor-save')).toHaveTextContent('Saving…', { exact: false });
    await act(async () => finish(exercise()));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe('Options: Track each gym separately', () => {
  const splitSwitch = () => screen.getByTestId('exercise-editor-split-by-gym');

  it('opens on for a split exercise, and switching it off saves the exercise whole', async () => {
    renderEditor({ editing: exercise({ splitByGym: true }) });
    expect(splitSwitch().props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(splitSwitch());
    await save();
    expect(onSave.mock.calls[0][0].splitByGym).toBe(false);
  });

  it('opens off for a new exercise, and switching it on saves it split', async () => {
    renderEditor({ prefill: { name: 'Bench', loadInputMode: 'total_load', mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }] } });
    expect(splitSwitch().props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(splitSwitch());
    await save();
    expect(onSave.mock.calls[0][0].splitByGym).toBe(true);
  });
});

describe('Options: Rest timer', () => {
  const restField = () => screen.getByTestId('exercise-editor-rest-timer');
  const benchPrefill = { name: 'Bench', loadInputMode: 'total_load' as const, mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' as const }] };
  const rangeError = 'Rest timer must be a whole number of seconds from 15 to 600.';

  it('opens blank for an exercise on the global timer, showing that timer as the placeholder', async () => {
    renderEditor({ editing: exercise() });
    expect(restField()).toHaveProp('value', '');
    expect(restField()).toHaveProp('placeholder', '90');
    await save();
    expect(onSave.mock.calls[0][0].restTimerSec).toBeNull();
  });

  it('opens on the exercise\'s own timer and saves a change to it', async () => {
    renderEditor({ editing: exercise({ restTimerSec: 120 }) });
    expect(restField()).toHaveProp('value', '120');
    fireEvent.changeText(restField(), ' 45 ');
    await save();
    expect(onSave.mock.calls[0][0].restTimerSec).toBe(45);
  });

  it('clearing the field saves null, so the exercise goes back to the global timer', async () => {
    renderEditor({ editing: exercise({ restTimerSec: 120 }) });
    fireEvent.changeText(restField(), '');
    await save();
    expect(onSave.mock.calls[0][0].restTimerSec).toBeNull();
  });

  it('shows the rest timer error beside the other field errors on the same Save', async () => {
    renderEditor({ prefill: { ...benchPrefill, name: '' } });
    fireEvent.changeText(restField(), '5');
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Exercise name is required')).toBeTruthy();
    expect(screen.getByTestId('exercise-editor-rest-timer-error')).toHaveTextContent(rangeError);
  });

  it.each(['10', '601', '1.5', 'abc'])('rejects %p inline and does not save', async (text) => {
    renderEditor({ prefill: benchPrefill });
    fireEvent.changeText(restField(), text);
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(rangeError)).toBeTruthy();
    fireEvent.changeText(restField(), '60');
    expect(screen.queryByText(rangeError)).toBeNull();
    await save();
    expect(onSave.mock.calls[0][0].restTimerSec).toBe(60);
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

describe('muscle picker sheets', () => {
  const picker = () => screen.queryByTestId('exercise-editor-muscle-selector-list');

  it('picks a primary muscle, which leaves the secondaries, and closes', async () => {
    renderEditor({ prefill: { name: 'Dip', loadInputMode: 'total_load', mappings: [{ muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' }] } });
    expect(primaryRow()).toHaveTextContent('Triceps', { exact: false });
    fireEvent.press(primaryRow());
    expect(screen.getByText('Primary muscle')).toBeOnTheScreen();
    expect(screen.getByLabelText('Select primary muscle Triceps')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-option-chest'));
    expect(primaryRow()).toHaveTextContent('Chest', { exact: false });
    expect(screen.queryByText('Primary muscle')).toBeNull();
    await save();
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Dip',
      mappings: [{ muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    });
  });

  it('changes the primary muscle and keeps the other secondaries', async () => {
    renderEditor({ editing: exercise() });
    fireEvent.press(primaryRow());
    expect(screen.queryByTestId('exercise-editor-muscle-option-triceps')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-option-delts'));
    await save();
    expect(onSave.mock.calls[0][0].mappings).toEqual([
      { muscleGroupId: 'delts', weight: 1, role: 'primary' },
      { muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
    ]);
  });

  it('ticks and unticks secondaries in one open picker, never offering the primary', async () => {
    renderEditor({ editing: exercise() });
    fireEvent.press(secondaryRow());
    expect(screen.getByText('Secondary muscles')).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-editor-muscle-option-chest')).toBeNull();
    expect(screen.getByTestId('exercise-editor-muscle-option-triceps').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-option-delts'));
    fireEvent.press(screen.getByTestId('exercise-editor-muscle-option-triceps'));
    expect(picker()).toBeOnTheScreen();
    expect(secondaryRow()).toHaveTextContent('Front delts', { exact: false });
    await save();
    expect(onSave.mock.calls[0][0].mappings.map((mapping) => mapping.muscleGroupId)).toEqual(['chest', 'delts']);
  });

  it('lists several secondaries in the row, comma separated', () => {
    renderEditor({
      editing: exercise({
        mappings: [
          { id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' },
          { id: 'm2', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
          { id: 'm3', muscleGroupId: 'delts', weight: 0.5, role: 'secondary' },
        ],
      }),
    });
    expect(secondaryRow()).toHaveTextContent('Triceps, Front delts', { exact: false });
  });

  it('says when there is no muscle group to pick', () => {
    mockCatalog = catalog({ muscleGroups: [], muscleGroupsById: {}, muscleSetup: buildMuscleSetup([]) });
    renderEditor();
    fireEvent.press(primaryRow());
    expect(screen.getByText('No muscles to choose from.')).toBeOnTheScreen();
  });
});

describe("under Broad: the user's muscles ([[muscle.no-breakdown]])", () => {
  const BROAD_ROWS = broadMuscleRows();
  const broadCatalog = () => catalog({
    muscleGroups: BROAD_ROWS,
    muscleGroupsById: Object.fromEntries(BROAD_ROWS.map((muscle) => [muscle.id, muscle])),
    muscleSetup: buildMuscleSetup(BROAD_ROWS),
  });
  const squat = () => exercise({
    name: 'Back Squat',
    mappings: [
      { id: 'q', muscleGroupId: 'quads', weight: 1, role: 'primary' },
      { id: 'a', muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
      { id: 's', muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
    ],
  });

  beforeEach(() => {
    mockCatalog = broadCatalog();
  });

  it('offers the 11 muscles in the picker, no entry inside one and no untracked one', () => {
    renderEditor();
    fireEvent.press(primaryRow());
    const offered = screen.getAllByLabelText(/^Select primary muscle /).map((option) => option.props.accessibilityLabel);
    expect(offered).toEqual([
      'Chest', 'Front Delts', 'Lateral Delts', 'Rear Delts', 'Back', 'Biceps', 'Triceps', 'Core', 'Quads',
      'Glutes & Hams', 'Calves',
    ].map((name) => `Select primary muscle ${name}`));
  });

  it('shows Quads once, primary, and Save keeps the links it hides', async () => {
    renderEditor({ editing: squat() });
    expect(primaryRow()).toHaveTextContent('Quads', { exact: false });
    expect(secondaryRow()).toHaveTextContent('None', { exact: false });
    await save();
    expect(onSave.mock.calls[0][0].mappings).toEqual([
      { muscleGroupId: 'quads', weight: 1, role: 'primary' },
      { muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
      { muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
    ]);
  });

  it('adds Back as one Lats mapping', async () => {
    renderEditor({ editing: squat() });
    fireEvent.press(secondaryRow());
    fireEvent.press(screen.getByLabelText('Secondary muscle Back'));
    await save();
    expect(onSave.mock.calls[0][0].mappings.filter((mapping) => mapping.role === 'secondary')).toEqual([
      { muscleGroupId: 'adductors', weight: 0.5, role: 'secondary' },
      { muscleGroupId: 'back_lats', weight: 0.5, role: 'secondary' },
      { muscleGroupId: 'spinal_erectors', weight: 0.5, role: 'secondary' },
    ]);
  });

  it('fills the form in the user\'s muscles once the setup loads after the page opened', () => {
    const editing = squat();
    mockCatalog = catalog({ muscleGroups: [], muscleGroupsById: {}, muscleSetup: EMPTY_MUSCLE_SETUP });
    const view = renderEditor({ editing });
    view.rerenderWith({ ...broadCatalog(), exercises: [indexed(editing)] });
    expect(primaryRow()).toHaveTextContent('Quads', { exact: false });
    expect(secondaryRow()).toHaveTextContent('None', { exact: false });
  });

  it('saves against the setup the form opened with when the setup changes while it is open', async () => {
    const detailedRows = detailedMuscleRows();
    const editing = exercise({
      mappings: [
        { id: 'q', muscleGroupId: 'quads', weight: 1, role: 'primary' },
        { id: 'g', muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
        { id: 'h', muscleGroupId: 'hamstrings', weight: 0.5, role: 'secondary' },
      ],
    });
    mockCatalog = catalog({ muscleGroups: detailedRows, muscleSetup: buildMuscleSetup(detailedRows) });
    const view = renderEditor({ editing });
    fireEvent.press(secondaryRow());
    fireEvent.press(screen.getByLabelText('Secondary muscle Hamstrings'));
    view.rerenderWith({ ...broadCatalog(), exercises: [indexed(editing)] });
    await save();
    expect(onSave.mock.calls[0][0].mappings).toEqual([
      { muscleGroupId: 'quads', weight: 1, role: 'primary' },
      { muscleGroupId: 'glutes_max', weight: 0.5, role: 'secondary' },
    ]);
  });
});

describe('opening the editor page', () => {
  const { renderHook } = jest.requireActual('@testing-library/react-native') as typeof import('@testing-library/react-native');
  const { useOpenExerciseEditor, resetExerciseEditorOpenGuard, readExerciseEditorRequest } =
    jest.requireActual('@/components/exercise-catalog/exercise-editor-request') as typeof import('@/components/exercise-catalog/exercise-editor-request');

  beforeEach(() => resetExerciseEditorOpenGuard());

  it('pushes the page with the exercise id and a request holding the caller\'s callbacks', () => {
    const { result } = renderHook(() => useOpenExerciseEditor());
    const onSavedHere = jest.fn();
    result.current({ exerciseDefinitionId: 'bench', onSaved: onSavedHere });
    const href = mockPush.mock.calls[0][0] as string;
    expect(href).toMatch(/^\/exercise-edit\?exerciseDefinitionId=bench&request=editor-\d+$/);
    expect(readExerciseEditorRequest(new URLSearchParams(href.split('?')[1]).get('request'))?.onSaved).toBe(onSavedHere);
  });

  it('opens one page for a double tap', () => {
    const { result } = renderHook(() => useOpenExerciseEditor());
    result.current({});
    result.current({});
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

// The editor on the shared text roles (`design-language.md` §3, "Text roles").
describe('text roles', () => {
  const { StyleSheet } = jest.requireActual('react-native') as typeof import('react-native');
  const { uiFonts, uiRoles, uiTypography } = jest.requireActual('@/components/ui/tokens') as typeof import('@/components/ui/tokens');
  const styleOf = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

  it('heads each section with a muted micro-label, the shared Weight section included', () => {
    renderEditor({ editing: exercise() });
    for (const heading of ['Muscles', 'Weight', 'Options']) {
      expect(styleOf(screen.getByText(heading))).toMatchObject({
        fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase', color: uiRoles.inkMuted,
      });
    }
  });

  it('draws an empty choice faint and a section error as meta in danger', async () => {
    renderEditor({ editing: exercise({ mappings: [] }) });
    expect(styleOf(screen.getByText('Choose'))).toMatchObject({ fontFamily: uiFonts.body.family, color: uiRoles.inkFaint });
    await save();
    expect(styleOf(screen.getByTestId('exercise-editor-muscles-error'))).toMatchObject({
      fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, color: uiRoles.danger,
    });
  });
});
