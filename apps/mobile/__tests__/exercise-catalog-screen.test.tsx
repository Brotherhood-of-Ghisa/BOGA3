/* eslint-disable import/first */

/**
 * The exercise catalogue over real data: the production screen, catalog and
 * history caches, and the catalog repository over the migrated in-memory
 * SQLite database with the infra-free starter catalog seeded at boot
 * (helpers/local-data.ts). The `exercise-browser` Maestro fixture adds the
 * history the browser controls read. Only the native database open and the
 * router are replaced; the two failure tests force one rejection on the real
 * module with `jest.spyOn`, the only states real data cannot produce. The
 * exercise editor is the real page over the catalogue, opened by the pushed
 * `/exercise-edit` href (helpers/exercise-editor-page.tsx); its internals are
 * exercise-editor-screen.test.tsx's, and this suite proves the default save
 * over real data and what the catalogue does once it saves.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { and, eq, isNull } from 'drizzle-orm';
import { Alert, Keyboard, Platform, StyleSheet, type ViewStyle } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPrepareMerge = jest.fn();
const mockExecuteMerge = jest.fn();
// `getState`: the exercise editor page reads the stack beneath it.
const mockNavigation = { addListener: jest.fn(() => () => undefined), getState: () => ({ routes: [] }), isFocused: () => true };
jest.mock('@/src/exercise-catalog/merge', () => ({
  ...jest.requireActual('@/src/exercise-catalog/merge'),
  prepareExerciseMerge: (...args: unknown[]) => mockPrepareMerge(...args),
  executeExerciseMerge: (...args: unknown[]) => mockExecuteMerge(...args),
}));
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockSearchParams: Record<string, string> = {};
// Page titles set through the native header, latest last (the editor page's).
let mockHeaderTitles: string[] = [];

jest.mock('expo-router', () => ({
  // The native header: its right action renders in place, as on device.
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => unknown; title?: string } }) => {
      if (options?.title) mockHeaderTitles.push(options.title);
      return (options?.headerRight?.() ?? null) as never;
    },
  },
  useNavigation: () => mockNavigation,
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
  }),
  // Focus runs as on device: the screen re-reads exercise history on focus.
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

import ExerciseCatalogScreen from '../app/exercise-catalog';
import { ensureExerciseCatalogLoaded } from '@/src/exercise-catalog/cache';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { Sheet, uiRoles } from '@/components/ui';
import {
  __resetBodyweightCalculationPreferenceForTests,
  setBodyweightCalculationsEnabled,
} from '@/src/bodyweight/calculation-preference';
import * as catalogRepository from '@/src/data/exercise-catalog';
import * as catalogStats from '@/src/data/exercise-catalog-stats';
import { exerciseDefinitions, exerciseMuscleMappings, muscleGroups } from '@/src/data/schema';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { __resetExerciseListPreferencesForTests } from '@/src/exercise-catalog/list-preferences';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDatabase,
  resetLocalData,
} from './helpers/local-data';
import { broadSetupOf } from './helpers/muscle-setup';
import { waitForGone } from './helpers/wait-for-gone';
import {
  exerciseEditorHrefs,
  exerciseEditorPage,
  exerciseEditorParams,
  WithExerciseEditorPage,
} from './helpers/exercise-editor-page';
import { readExerciseEditorRequest } from '@/components/exercise-catalog/exercise-editor-request';

type TestNode = typeof screen.UNSAFE_root;

// Host nodes drawn on the `accent` ground under `root`: its primaries.
const accentGrounds = (root: TestNode = screen.UNSAFE_root) =>
  root
    .findAll((node: TestNode) => typeof node.type === 'string')
    .filter(
      (node: TestNode) =>
        (StyleSheet.flatten(node.props.style) as ViewStyle | undefined)?.backgroundColor === uiRoles.accent
    );

const openCatalog = async ({
  fixture,
  prepare,
}: { fixture?: 'exercise-browser'; prepare?: () => void } = {}) => {
  if (fixture) {
    await loadMaestroFixture(fixture);
  }
  if (prepare) {
    localDatabase();
    prepare();
  }
  await bootLocalApp();
  render(<WithExerciseEditorPage><ExerciseCatalogScreen /></WithExerciseEditorPage>);
  await screen.findByLabelText('Create new exercise');
  // Past the search debounce the screen arms at mount (150 ms), inside act.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 160));
  });
};

const expandFamily = async (familyName: string) => {
  fireEvent.press(await screen.findByLabelText(new RegExp(`^${familyName} exercises \\d+$`)));
};

const definitionNamed = (name: string) =>
  localDatabase()
    .select()
    .from(exerciseDefinitions)
    .where(eq(exerciseDefinitions.name, name))
    .get();

const activeMappingsOf = (exerciseDefinitionId: string) =>
  localDatabase()
    .select({
      muscleGroupId: exerciseMuscleMappings.muscleGroupId,
      role: exerciseMuscleMappings.role,
      weight: exerciseMuscleMappings.weight,
    })
    .from(exerciseMuscleMappings)
    .where(
      and(
        eq(exerciseMuscleMappings.exerciseDefinitionId, exerciseDefinitionId),
        isNull(exerciseMuscleMappings.deletedAt)
      )
    )
    .all()
    .sort((a, b) => a.muscleGroupId.localeCompare(b.muscleGroupId));

const deleteEveryExercise = () => {
  localDatabase().update(exerciseDefinitions).set({ deletedAt: new Date() }).run();
};

// What a signed-in, sync-configured install holds before its first pull: no
// starter catalog at all (bootstrap only seeds infra-free builds).
const emptyCatalog = () => {
  localDatabase().delete(exerciseMuscleMappings).run();
  localDatabase().delete(exerciseDefinitions).run();
};

// Broad chosen on this account ([[muscle.report-groups]]), as its rows hold it.
const chooseBroad = () => {
  for (const { id } of SYSTEM_MUSCLE_GROUP_SEEDS) {
    localDatabase().update(muscleGroups).set(broadSetupOf(id)).where(eq(muscleGroups.id, id)).run();
  }
};

const createExercise = async (name: string) => {
  fireEvent.press(screen.getByLabelText('Create new exercise'));
  await screen.findByTestId('exercise-editor');
  fireEvent.changeText(screen.getByLabelText('Exercise definition name'), name);
};

// The editor page's muscle rows open a picker sheet over it.
const openPrimaryPicker = () => fireEvent.press(screen.getByTestId('exercise-editor-primary-muscle-trigger'));
const openSecondaryPicker = () => fireEvent.press(screen.getByTestId('exercise-editor-secondary-muscle-trigger'));
const saveEditor = () => act(async () => fireEvent.press(screen.getByLabelText('Save exercise definition')));
const lastEditorHref = () => exerciseEditorHrefs(mockPush).at(-1)!;

describe('ExerciseCatalogScreen', () => {
  beforeEach(() => {
    resetLocalData();
    mockReplace.mockReset();
    mockPush.mockReset().mockImplementation((href: unknown) => exerciseEditorPage.push(href));
    mockBack.mockReset().mockImplementation(() => exerciseEditorPage.back());
    exerciseEditorPage.reset();
    mockHeaderTitles = [];
    mockSearchParams = {};
    mockPrepareMerge.mockReset(); mockExecuteMerge.mockReset();
    __resetExerciseListPreferencesForTests();
    __resetBodyweightCalculationPreferenceForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    closeLocalData();
  });

  it('keeps the tab bar with More selected and draws no back of its own (the native header has it)', async () => {
    mockSearchParams = { source: 'more' };
    await openCatalog();

    expect(screen.getByTestId('main-tab-bar')).toBeTruthy();
    expect(screen.getByTestId('top-level-tab-more')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true })
    );
    expect(screen.queryByTestId('back-to-more-button')).toBeNull();
  });

  it('drops the tab bar when opened from a session, and goes back to it once an exercise is saved', async () => {
    mockSearchParams = { source: 'session' };
    await openCatalog();
    expect(screen.queryByTestId('main-tab-bar')).toBeNull();

    await createExercise('Session Press');
    openPrimaryPicker();
    fireEvent.press(await screen.findByLabelText('Select primary muscle Pectoralis'));
    await saveEditor();

    expect(await screen.findByText('Exercise created.')).toBeTruthy();
    // The page's own back, then the catalogue's, back to the session.
    expect(mockBack).toHaveBeenCalledTimes(2);
    expect(definitionNamed('Session Press')).toMatchObject({ deletedAt: null });
  });

  it('opens the editor page once for the add intent, creating an exercise', async () => {
    mockSearchParams = { intent: 'add' };
    await openCatalog();

    expect(await screen.findByTestId('exercise-editor')).toBeTruthy();
    expect(exerciseEditorHrefs(mockPush)).toHaveLength(1);
    expect(exerciseEditorParams(lastEditorHref()).exerciseDefinitionId).toBeNull();
    // A catalogue reload (loading, then ready) does not open it again.
    await act(async () => {
      invalidateExerciseCatalogCache();
      await ensureExerciseCatalogLoaded();
    });
    expect(exerciseEditorHrefs(mockPush)).toHaveLength(1);

    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Intent Press');
    openPrimaryPicker();
    fireEvent.press(await screen.findByLabelText('Select primary muscle Pectoralis'));
    await saveEditor();
    expect(await screen.findByText('Exercise created.')).toBeTruthy();
    expect(definitionNamed('Intent Press')).toMatchObject({ deletedAt: null });
    expect(exerciseEditorHrefs(mockPush)).toHaveLength(1);
  });

  it('creates a new exercise with primary and secondary muscles', async () => {
    await openCatalog();

    await createExercise('Incline Press');
    expect(exerciseEditorParams(lastEditorHref()).exerciseDefinitionId).toBeNull();
    expect(mockHeaderTitles.at(-1)).toBe('New exercise');
    fireEvent.press(screen.getByLabelText('Per side weight entry'));
    openPrimaryPicker();
    fireEvent.press(await screen.findByLabelText('Select primary muscle Pectoralis'));
    openSecondaryPicker();
    fireEvent.press(await screen.findByLabelText('Secondary muscle Triceps'));
    await saveEditor();

    expect(await screen.findByText('Exercise created.')).toBeTruthy();
    expect(screen.queryByTestId('exercise-editor')).toBeNull();
    const saved = definitionNamed('Incline Press');
    expect(saved).toMatchObject({ loadInputMode: 'per_side_load', deletedAt: null });
    expect(activeMappingsOf(saved!.id)).toEqual([
      { muscleGroupId: 'chest', role: 'primary', weight: 1 },
      { muscleGroupId: 'triceps', role: 'secondary', weight: 0.5 },
    ]);

    await expandFamily('Chest');
    expect(await screen.findByLabelText('Edit exercise definition Incline Press')).toBeTruthy();
  });

  it('edits an existing exercise: name, load mode and secondary muscles', async () => {
    await openCatalog();
    await expandFamily('Chest');
    await screen.findByLabelText('Edit exercise definition Barbell Bench Press');

    fireEvent.press(screen.getByLabelText('Exercise actions Barbell Bench Press'));
    await screen.findByTestId('exercise-catalog-actions-sheet');
    fireEvent.press(screen.getByLabelText('Edit exercise from actions'));
    await screen.findByTestId('exercise-editor');
    expect(exerciseEditorParams(lastEditorHref()).exerciseDefinitionId).toBe('seed_barbell_bench_press');
    expect(mockHeaderTitles.at(-1)).toBe('Edit "Barbell Bench Press"');
    expect(screen.getByLabelText('Total load weight entry').props.accessibilityState.selected).toBe(true);
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Bench Press');
    fireEvent.press(screen.getByLabelText('Per side weight entry'));
    // Unticking Triceps in the open secondary picker removes it.
    openSecondaryPicker();
    fireEvent.press(await screen.findByLabelText('Secondary muscle Triceps'));
    await saveEditor();

    expect(await screen.findByText('Exercise updated.')).toBeTruthy();
    expect(definitionNamed('Bench Press')).toMatchObject({
      id: 'seed_barbell_bench_press',
      loadInputMode: 'per_side_load',
    });
    expect(activeMappingsOf('seed_barbell_bench_press')).toEqual([
      { muscleGroupId: 'chest', role: 'primary', weight: 1 },
      { muscleGroupId: 'delts_front', role: 'secondary', weight: 0.5 },
    ]);
    expect(await screen.findByLabelText('Edit exercise definition Bench Press')).toHaveTextContent(
      /Primary: Pectoralis\s+Secondary: Front Delts/
    );

    fireEvent.press(screen.getByLabelText('Edit exercise definition Bench Press'));
    await screen.findByTestId('exercise-editor');
    expect(screen.getByDisplayValue('Bench Press')).toBeTruthy();
    expect(screen.getByTestId('exercise-editor-secondary-muscle-trigger')).toHaveTextContent('Front Delts', { exact: false });
    expect(screen.getByTestId('exercise-editor-secondary-muscle-trigger')).not.toHaveTextContent('Triceps', { exact: false });
  });

  it('shows the bodyweight contribution only while calculations are on, keeping it while hidden', async () => {
    const openEditor = async (name: string) => {
      fireEvent.press(await screen.findByLabelText(`Edit exercise definition ${name}`));
      await screen.findByTestId('exercise-editor');
    };
    const percentage = () => screen.queryByTestId('exercise-editor-bodyweight-percentage');
    await openCatalog();
    await expandFamily('Back');

    // Off: no contribution field, and saving keeps the stored 100%.
    await openEditor('Pull-Up');
    expect(percentage()).toBeNull();
    expect(screen.queryByTestId('exercise-editor-uses-bodyweight')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Strict Pull-Up');
    await saveEditor();
    expect(await screen.findByText('Exercise updated.')).toBeTruthy();
    expect(definitionNamed('Strict Pull-Up')).toMatchObject({ id: 'seed_pull_up', bodyweightContribution: 1 });

    // On: the field appears with the stored share; an invalid share writes nothing.
    await act(async () => {
      await setBodyweightCalculationsEnabled(true);
    });
    await openEditor('Strict Pull-Up');
    expect(screen.getByTestId('exercise-editor-uses-bodyweight').props.accessibilityState).toMatchObject({ checked: true });
    expect(percentage()).toHaveProp('value', '100');
    fireEvent.changeText(percentage()!, '101');
    await saveEditor();
    expect(screen.getByTestId('exercise-editor-bodyweight-error')).toBeTruthy();
    expect(definitionNamed('Strict Pull-Up')).toMatchObject({ bodyweightContribution: 1 });

    fireEvent.changeText(percentage()!, '70');
    await saveEditor();
    expect(await screen.findByText('Exercise updated.')).toBeTruthy();
    expect(definitionNamed('Strict Pull-Up')).toMatchObject({ bodyweightContribution: 0.7 });

    // Uses bodyweight off stores 0.
    await openEditor('Strict Pull-Up');
    fireEvent(screen.getByTestId('exercise-editor-uses-bodyweight'), 'valueChange', false);
    expect(percentage()).toBeNull();
    await saveEditor();
    expect(await screen.findByText('Exercise updated.')).toBeTruthy();
    expect(definitionNamed('Strict Pull-Up')).toMatchObject({ bodyweightContribution: 0 });
  });

  it('blocks save when no primary muscle is selected', async () => {
    await openCatalog();

    await createExercise('Cable Fly Variation');
    await saveEditor();

    expect(screen.getByTestId('exercise-editor-muscles-error')).toHaveTextContent('Select a primary muscle before saving.');
    expect(screen.getByTestId('exercise-editor')).toBeTruthy();
    expect(definitionNamed('Cable Fly Variation')).toBeUndefined();
  });

  it('renders the shared ExerciseCore fields and blocks a blank name with the shared validator message', async () => {
    await openCatalog();

    fireEvent.press(screen.getByLabelText('Create new exercise'));
    await screen.findByTestId('exercise-editor');
    // The fields come from ExerciseCoreFields and keep the editor's testIDs.
    expect(screen.getByTestId('exercise-editor-name-input')).toBeTruthy();
    expect(screen.getByTestId('exercise-editor-load-mode-total_load').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('exercise-editor-load-mode-per_side_load').props.accessibilityState).toMatchObject({
      selected: false,
    });
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), ' \t ');
    await saveEditor();

    expect(screen.getByTestId('exercise-editor-name-error')).toHaveTextContent('Exercise name is required');
  });

  it('dismisses the keyboard before the muscle picker, and the page scrolls keyboard-aware', async () => {
    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(jest.fn());
    await openCatalog();

    await createExercise('Cable Row Variation');
    const page = screen.getByTestId('exercise-editor');
    expect(page.props.automaticallyAdjustKeyboardInsets).toBe(Platform.OS === 'ios');
    expect(page.props.keyboardDismissMode).toBe('on-drag');
    expect(page.props.keyboardShouldPersistTaps).toBe('handled');
    openPrimaryPicker();

    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('exercise-editor-muscle-selector-list')).toBeTruthy();
  });

  it('prevents duplicate secondary links and excludes the selected primary from secondary options', async () => {
    await openCatalog();

    await createExercise('Press Variation');
    openPrimaryPicker();
    fireEvent.press(screen.getByLabelText('Select primary muscle Pectoralis'));

    openSecondaryPicker();
    expect(screen.queryByLabelText('Secondary muscle Pectoralis')).toBeNull();
    fireEvent.press(screen.getByLabelText('Secondary muscle Triceps'));
    // A tick, not a second row: Triceps is selected once and the picker stays open.
    expect(screen.getAllByLabelText('Secondary muscle Triceps')).toHaveLength(1);
    expect(screen.getByLabelText('Secondary muscle Triceps').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('Secondary muscle Front Delts')).toBeTruthy();
    await saveEditor();

    expect(activeMappingsOf(definitionNamed('Press Variation')!.id)).toEqual([
      { muscleGroupId: 'chest', role: 'primary', weight: 1 },
      { muscleGroupId: 'triceps', role: 'secondary', weight: 0.5 },
    ]);
  });

  it('keeps the cached search available for typing during a background refresh', async () => {
    await openCatalog();
    const readCatalog = catalogRepository.listExerciseCatalogExercises;
    let finishReload!: () => void;
    const heldReload = new Promise<void>(resolve => { finishReload = resolve; });
    jest.spyOn(catalogRepository, 'listExerciseCatalogExercises').mockImplementationOnce(async options => {
      await heldReload;
      return readCatalog(options);
    });
    act(() => { invalidateExerciseCatalogCache(); });
    try {
      const input = await screen.findByLabelText('Exercise filter input');
      fireEvent.changeText(input, 'Barbell');
      expect(screen.getByDisplayValue('Barbell')).toBeTruthy();
    } finally {
      await act(async () => { finishReload(); });
    }
    expect(screen.getByDisplayValue('Barbell')).toBeTruthy();
  });

  async function chooseMergeDestination() {
    await openCatalog({ fixture: 'exercise-browser' });
    await expandFamily('Chest');
    fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
    fireEvent.press(await screen.findByTestId('exercise-action-merge'));
    act(() => screen.UNSAFE_getAllByType(Sheet).find(node => node.props.testID === 'exercise-catalog-actions-sheet')?.props.onDismissed());
    await screen.findByTestId('exercise-merge-search');
    fireEvent.changeText(screen.getByTestId('exercise-merge-search'), 'Cable Bench Press');
    const pickerDismissed = screen.getByTestId('exercise-merge-sheet-modal').props.onDismiss;
    fireEvent.press(await screen.findByLabelText('Select exercise Cable Bench Press'));
    return pickerDismissed;
  }

  it('waits for the native picker dismissal before one destructive confirmation; Cancel writes nothing', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const preview = { sourceId: 'a', destinationId: 'b', sourceName: 'Barbell Bench Press', destinationName: 'Cable Bench Press',
      setCount: 12, factor: 0.5, token: 'preview' };
    mockPrepareMerge.mockResolvedValue(preview);
    const pickerDismissed = await chooseMergeDestination();
    await act(async () => { await Promise.resolve(); });
    expect(alert).not.toHaveBeenCalled();
    act(() => pickerDismissed());
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toContain('Move 12 sets from Barbell Bench Press to Cable Bench Press');
    expect(alert.mock.calls[0][1]).toContain('Weights will be halved.');
    expect(alert.mock.calls[0][2]?.[1].style).toBe('destructive');
    act(() => alert.mock.calls[0][2]?.[0].onPress?.());
    expect(mockExecuteMerge).not.toHaveBeenCalled();
    expect(definitionNamed('Barbell Bench Press')?.deletedAt).toBeNull();
  });

  it.each(['ready', 'error'])('retains Retry through a catalogue reload ending %s and closes silently after Merge', async reloadResult => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const preview = { sourceId: 'a', destinationId: 'b', sourceName: 'A', destinationName: 'B', setCount: 0, factor: 1, token: 'p' };
    mockPrepareMerge.mockRejectedValueOnce(new Error('Connect to merge exercises.'));
    mockExecuteMerge.mockResolvedValue(undefined);
    const pickerDismissed = await chooseMergeDestination();
    expect(await screen.findByText('Connect to merge exercises.')).toBeTruthy();
    const readCatalog = catalogRepository.listExerciseCatalogExercises;
    let finishReload!: () => void;
    const heldReload = new Promise<void>(resolve => { finishReload = resolve; });
    jest.spyOn(catalogRepository, 'listExerciseCatalogExercises').mockImplementationOnce(async options => {
      await heldReload;
      if (reloadResult === 'error') throw new Error('Catalogue refresh failed.');
      return readCatalog(options);
    });
    mockPrepareMerge.mockImplementationOnce(async () => {
      invalidateExerciseCatalogCache();
      await ensureExerciseCatalogLoaded();
      return preview;
    });
    fireEvent.press(screen.getByText('Retry'));
    try {
      expect(await screen.findByText('Preparing merge…')).toBeTruthy();
      expect(screen.getByTestId('exercise-merge-search')).toBeTruthy();
    } finally {
      await act(async () => { finishReload(); });
    }
    await waitForGone(() => screen.queryByText('Preparing merge…'));
    act(() => pickerDismissed());
    expect(alert.mock.calls[0][1]).not.toContain('Weights');
    await act(async () => { alert.mock.calls[0][2]?.[1].onPress?.(); });
    expect(mockExecuteMerge).toHaveBeenCalledWith(preview);
    await waitForGone(() => screen.queryByTestId('exercise-merge-sheet'));
    expect(screen.queryByText(/merged successfully|Exercise merged/i)).toBeNull();
  });

  it('deletes an exercise from its actions, then shows and restores it from Manage', async () => {
    await openCatalog();
    await expandFamily('Chest');
    fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
    // Titled with the exercise's name.
    expect(await screen.findByRole('header', { name: 'Barbell Bench Press' })).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Delete exercise from actions'));

    expect(await screen.findByText('Exercise deleted.')).toBeTruthy();
    expect(definitionNamed('Barbell Bench Press')?.deletedAt).not.toBeNull();
    await waitForGone(() => screen.queryByLabelText('Edit exercise definition Barbell Bench Press'));

    fireEvent.press(screen.getByLabelText('Exercise catalog options'));
    await screen.findByText('Manage exercises');
    fireEvent.press(screen.getByLabelText('Show deleted exercises'));
    // The sheet's backdrop, hidden from VoiceOver while the sheet is modal.
    fireEvent.press(screen.getByLabelText('Close exercise management', { includeHiddenElements: true }));

    fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
    await screen.findByTestId('exercise-catalog-actions-sheet');
    // A deleted exercise cannot be edited; Undelete replaces Delete.
    expect(screen.getByLabelText('Edit exercise from actions')).toBeDisabled();
    expect(screen.getByLabelText('Duplicate exercise from actions')).toBeDisabled();
    expect(screen.getByTestId('exercise-action-merge')).toBeDisabled();
    expect(screen.queryByTestId('exercise-action-delete')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-action-undelete'));

    expect(await screen.findByText('Exercise restored.')).toBeTruthy();
    expect(definitionNamed('Barbell Bench Press')?.deletedAt).toBeNull();
  });

  it('opens unfiltered exercise history from its actions and dismisses the menu', async () => {
    await openCatalog();
    await expandFamily('Chest');
    fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
    fireEvent.press(await screen.findByRole('button', { name: 'View exercise history from actions' }));

    expect(mockPush).toHaveBeenCalledWith(`/exercise-history?exerciseDefinitionId=${definitionNamed('Barbell Bench Press')!.id}`);
    await waitForGone(() => screen.queryByTestId('exercise-catalog-actions-sheet'));
  });

  it('duplicates an exercise from its actions with prefilled data and (Copy) in name', async () => {
    await openCatalog();
    await expandFamily('Chest');
    fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
    expect(await screen.findByRole('header', { name: 'Barbell Bench Press' })).toBeTruthy();
    expect(screen.getByTestId('exercise-action-duplicate')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Duplicate exercise from actions'));

    await screen.findByTestId('exercise-editor');
    const { exerciseDefinitionId, request } = exerciseEditorParams(lastEditorHref());
    expect(exerciseDefinitionId).toBeNull();
    expect(readExerciseEditorRequest(request)?.title).toBe('Duplicate exercise');
    expect(mockHeaderTitles.at(-1)).toBe('Duplicate exercise');
    expect(screen.getByDisplayValue('Barbell Bench Press (Copy)')).toBeTruthy();

    await saveEditor();

    expect(await screen.findByText('Exercise created.')).toBeTruthy();
    const copyDef = definitionNamed('Barbell Bench Press (Copy)');
    expect(copyDef).toBeTruthy();
    expect(copyDef?.deletedAt).toBeNull();
    const origDef = definitionNamed('Barbell Bench Press');
    expect(origDef).toBeTruthy();
    expect(copyDef?.id).not.toBe(origDef?.id);

    const copyMappings = activeMappingsOf(copyDef!.id);
    const origMappings = activeMappingsOf(origDef!.id);
    expect(copyMappings.map((m) => ({ muscleGroupId: m.muscleGroupId, role: m.role }))).toEqual(
      origMappings.map((m) => ({ muscleGroupId: m.muscleGroupId, role: m.role }))
    );
  });

  describe('design language', () => {
    it('puts its ⋮ in the native header (titled by the root stack), with a labelled Add as its one accent', async () => {
      await openCatalog();

      // No in-content title bar: the root stack's native header titles it.
      expect(screen.queryByTestId('exercise-catalog-title')).toBeNull();
      expect(screen.queryByRole('header', { name: 'Exercises' })).toBeNull();
      expect(screen.getByLabelText('Exercise catalog options')).toBeTruthy();
      const accents = accentGrounds();
      expect(accents).toHaveLength(1);
      expect(accents[0].props.testID).toBe('create-new-exercise-button');
      expect(within(accents[0]).getByText('Add')).toBeTruthy();

      expect(screen.getByLabelText('Sort: Favourite')).toBeTruthy();
      expect(screen.getByLabelText('Show never-done')).toHaveProp('accessibilityState', { checked: true });
      fireEvent.press(screen.getByLabelText('Exercise catalog options'));
      expect(await screen.findByTestId('exercise-catalog-management-sheet')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Manage exercises' })).toBeTruthy();
      expect(screen.queryByText('Date range')).toBeNull();
    });

    it('search expands matching families and clearing restores the prior expansion', async () => {
      await openCatalog();
      await expandFamily('Chest');
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'back squat');
      expect(await screen.findByLabelText('Edit exercise definition Barbell Back Squat')).toBeTruthy();
      expect(screen.queryByTestId('exercise-family-group-chest')).toBeNull();
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), '');
      expect(await screen.findByLabelText('Edit exercise definition Barbell Bench Press')).toBeTruthy();
      expect(screen.queryByLabelText('Edit exercise definition Barbell Back Squat')).toBeNull();
    });

    it('titles the actions sheet with the name, with Delete as the danger row, dismissed by the backdrop', async () => {
      await openCatalog();
      await expandFamily('Chest');
      fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));

      expect(await screen.findByTestId('exercise-catalog-actions-sheet')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Barbell Bench Press' })).toBeTruthy();
      expect(screen.getByTestId('exercise-action-edit')).toBeTruthy();
      expect(screen.getByTestId('exercise-action-duplicate')).toBeTruthy();
      expect(screen.getByTestId('exercise-action-delete')).toBeTruthy();
      expect(screen.getByText('Delete')).toHaveStyle({ color: uiRoles.danger });
      expect(screen.getByText('Merge into…')).toHaveStyle({ color: uiRoles.danger });
      const rows = within(screen.getByTestId('exercise-catalog-actions-sheet')).getAllByRole('button');
      const mergeIndex = rows.findIndex(row => row.props.testID === 'exercise-action-merge');
      expect(rows[mergeIndex + 1].props.testID).toBe('exercise-action-delete');
      fireEvent.press(
        screen.getByLabelText('Dismiss exercise action menu overlay', { includeHiddenElements: true })
      );
      expect(screen.queryByTestId('exercise-catalog-actions-sheet')).toBeNull();
    });

    it('dismisses the filter keyboard before opening a sheet over it', async () => {
      const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(jest.fn());
      await openCatalog();

      await expandFamily('Chest');
      fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
      expect(dismissKeyboard).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByLabelText('Exercise catalog options'));
      expect(dismissKeyboard).toHaveBeenCalledTimes(2);
    });

    it('says why the list is empty once and leaves controls available', async () => {
      await openCatalog({ prepare: emptyCatalog });

      expect(
        await screen.findAllByText('No active exercises yet. Create one with the button above.')
      ).toHaveLength(1);
      fireEvent.press(screen.getByLabelText('Show never-done'));
      expect(
        await screen.findAllByText('No active exercises yet. Create one with the button above.')
      ).toHaveLength(1);
    });

    it('opens the editor as a page with Save as its one accent; leaving by Back writes nothing', async () => {
      await openCatalog();

      await createExercise('Abandoned Press');
      expect(screen.getByTestId('exercise-editor-save')).toHaveTextContent('Add exercise', { exact: false });
      const editorAccents = accentGrounds(screen.getByTestId('exercise-editor'));
      expect(editorAccents).toHaveLength(1);
      expect(editorAccents[0].props.accessibilityLabel).toBe('Save exercise definition');

      // The native header's Back.
      act(() => exerciseEditorPage.back());
      await waitForGone(() => screen.queryByTestId('exercise-editor'));
      expect(definitionNamed('Abandoned Press')).toBeUndefined();
      expect(screen.queryByTestId('exercise-catalog-feedback')).toBeNull();
    });

    it('picks the primary muscle in a sheet over the page, which closes on the choice', async () => {
      await openCatalog();

      await createExercise('Cable Fly Variation');
      expect(screen.getByTestId('exercise-editor-primary-muscle-trigger')).toHaveTextContent('Choose', { exact: false });
      openPrimaryPicker();

      expect(await screen.findByRole('header', { name: 'Primary muscle' })).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Select primary muscle Pectoralis'));
      await waitForGone(() => screen.queryByRole('header', { name: 'Primary muscle' }));
      expect(screen.getByDisplayValue('Cable Fly Variation')).toBeTruthy();
      expect(screen.getByTestId('exercise-editor-primary-muscle-trigger')).toHaveTextContent('Pectoralis', { exact: false });

      // The chosen primary is marked in the list when it opens again.
      openPrimaryPicker();
      expect(screen.getByTestId('exercise-editor-muscle-option-chest').props.accessibilityState).toMatchObject({
        checked: true,
      });
    });
  });

  describe('browsing with history (the exercise-browser fixture)', () => {
    it('counts each family, filters never-done by use, and says when nothing matches', async () => {
      await openCatalog({ fixture: 'exercise-browser' });

      expect(screen.getByLabelText('Chest exercises 25')).toBeTruthy();
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');
      expect(await screen.findByLabelText('Exercise actions Barbell Bench Press')).toBeTruthy();
      expect(screen.getByLabelText('Exercise actions Decline Barbell Bench Press')).toBeTruthy();

      // Never-done off keeps only what was used: the bench (session fixture)
      // and last year's Cable Bench Press; Decline was never done.
      fireEvent.press(screen.getByLabelText('Show never-done'));
      await waitForGone(() => screen.queryByLabelText('Exercise actions Decline Barbell Bench Press'));
      expect(screen.getByLabelText('Exercise actions Cable Bench Press')).toBeTruthy();

      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'NoSuchExercise');
      expect(await screen.findByText('No exercises match the current filters.')).toBeTruthy();

      // History older than the stats window still counts as done.
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'Incline Dumbbell Press');
      expect(await screen.findByLabelText('Exercise actions Incline Dumbbell Press')).toBeTruthy();
    });
  });

  describe('choosing a gym (the exercise-browser fixture)', () => {
    it('counts only the chosen gym\'s sessions, every gym until one is chosen', async () => {
      await openCatalog({ fixture: 'exercise-browser' });
      fireEvent.press(screen.getByLabelText('Show never-done'));
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'bench');
      // The session fixture's bench was at a gym; last year's Cable Bench Press had none.
      expect(await screen.findByLabelText('Exercise actions Barbell Bench Press')).toBeTruthy();
      expect(screen.getByLabelText('Exercise actions Cable Bench Press')).toBeTruthy();
      expect(screen.getByLabelText('Gym: All gyms')).toBeTruthy();

      fireEvent.press(screen.getByLabelText('Gym: All gyms'));
      fireEvent.press(screen.getByRole('radio', { name: 'Maestro Block History Gym' }));
      await waitForGone(() => screen.queryByLabelText('Exercise actions Cable Bench Press'));
      expect(screen.getByLabelText('Exercise actions Barbell Bench Press')).toBeTruthy();

      fireEvent.press(screen.getByLabelText('Gym: Maestro Block History Gym'));
      fireEvent.press(screen.getByRole('radio', { name: 'No gym' }));
      await waitForGone(() => screen.queryByLabelText('Exercise actions Barbell Bench Press'));
      expect(screen.getByLabelText('Exercise actions Cable Bench Press')).toBeTruthy();
    });
  });

  describe("under Broad: the user's muscles ([[muscle.no-breakdown]])", () => {
    it('searches and names muscles, never an entry inside one', async () => {
      await openCatalog({ prepare: chooseBroad });
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'lats');
      expect(await screen.findByText('No exercises match the current filters.')).toBeTruthy();
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'back');
      expect(await screen.findByLabelText('Edit exercise definition Lat Pulldown')).toHaveTextContent(/Primary: Back/);
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'back squat');
      expect(await screen.findByLabelText('Edit exercise definition Barbell Back Squat')).toHaveTextContent(
        /Primary: Glutes & Hams · QuadsNever done/
      );
    });

    it('saves an edit without touching the mappings it hides or merges', async () => {
      await openCatalog({ prepare: chooseBroad });
      const before = activeMappingsOf('seed_barbell_back_squat');
      expect(before.map((mapping) => mapping.muscleGroupId)).toEqual(['adductors', 'glutes_max', 'quads', 'spinal_erectors']);
      fireEvent.changeText(screen.getByLabelText('Exercise filter input'), 'back squat');
      fireEvent.press(await screen.findByLabelText('Edit exercise definition Barbell Back Squat'));
      await screen.findByTestId('exercise-editor');
      fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Back Squat');
      await saveEditor();

      expect(await screen.findByText('Exercise updated.')).toBeTruthy();
      expect(activeMappingsOf('seed_barbell_back_squat')).toEqual(before);
    });
  });

  describe('failures (forced on the real modules)', () => {
    it('does not label failed history as Never done and can retry with never-done off', async () => {
      jest
        .spyOn(catalogStats, 'loadExerciseCatalogStatsRawHistory')
        .mockRejectedValueOnce(new Error('history unavailable'));
      await openCatalog({ prepare: deleteEveryExerciseButBench });

      expect(await screen.findByText('Unable to load exercise history.')).toBeTruthy();
      expect(screen.queryByText('Never done')).toBeNull();
      fireEvent.press(screen.getByLabelText('Show never-done'));
      fireEvent.press(screen.getByLabelText('Retry exercise history'));
      expect(await screen.findByText('No exercises match the current filters.')).toBeTruthy();
      expect(screen.getByLabelText('Show never-done')).toHaveProp('accessibilityState', { checked: false });
    });

    it('shows a save failure as a danger notice under Save', async () => {
      jest
        .spyOn(catalogRepository, 'saveExerciseCatalogExercise')
        .mockRejectedValueOnce(new Error('Disk full.'));
      await openCatalog();

      await createExercise('Cable Fly Variation');
      openPrimaryPicker();
      fireEvent.press(screen.getByLabelText('Select primary muscle Pectoralis'));
      await saveEditor();

      const notice = await screen.findByTestId('exercise-editor-save-error');
      expect(notice.props.accessibilityRole).toBe('alert');
      expect(notice).toHaveTextContent('Disk full.');
      expect(screen.getByTestId('exercise-editor')).toBeTruthy();
      expect(definitionNamed('Cable Fly Variation')).toBeUndefined();
    });
  });
});

function deleteEveryExerciseButBench() {
  deleteEveryExercise();
  localDatabase()
    .update(exerciseDefinitions)
    .set({ deletedAt: null })
    .where(eq(exerciseDefinitions.id, 'seed_barbell_bench_press'))
    .run();
}
