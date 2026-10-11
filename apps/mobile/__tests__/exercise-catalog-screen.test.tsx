/* eslint-disable import/first */

/**
 * The exercise catalogue over real data: the production screen, catalog and
 * history caches, and the catalog repository over the migrated in-memory
 * SQLite database with the infra-free starter catalog seeded at boot
 * (helpers/local-data.ts). The `exercise-browser` Maestro fixture adds the
 * history the browser controls read. Only the native database open and the
 * router are replaced; the two failure tests force one rejection on the real
 * module with `jest.spyOn`, the only states real data cannot produce.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { and, eq, isNull } from 'drizzle-orm';
import { Keyboard, Platform, StyleSheet, type ViewStyle } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockReplace = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: mockReplace,
  }),
  // Focus runs as on device: the screen re-reads exercise history on focus.
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

import ExerciseCatalogScreen from '../app/(tabs)/exercise-catalog';
import { uiRoles } from '@/components/ui';
import {
  __resetBodyweightCalculationPreferenceForTests,
  setBodyweightCalculationsEnabled,
} from '@/src/bodyweight/calculation-preference';
import * as catalogRepository from '@/src/data/exercise-catalog';
import * as catalogStats from '@/src/data/exercise-catalog-stats';
import { exerciseDefinitions, exerciseMuscleMappings } from '@/src/data/schema';
import { __resetExerciseListPreferencesForTests } from '@/src/exercise-catalog/list-preferences';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDatabase,
  resetLocalData,
} from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';

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
  render(<ExerciseCatalogScreen />);
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

const createExercise = async (name: string) => {
  fireEvent.press(screen.getByLabelText('Create new exercise'));
  await screen.findByTestId('exercise-editor');
  fireEvent.changeText(screen.getByLabelText('Exercise definition name'), name);
};

describe('ExerciseCatalogScreen', () => {
  beforeEach(() => {
    resetLocalData();
    mockReplace.mockReset();
    mockSearchParams = {};
    __resetExerciseListPreferencesForTests();
    __resetBodyweightCalculationPreferenceForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    closeLocalData();
  });

  it('returns explicitly to More when the catalog was launched from the hub', async () => {
    mockSearchParams = { source: 'more' };
    await openCatalog();

    fireEvent.press(screen.getByTestId('back-to-more-button'));

    expect(mockReplace).toHaveBeenCalledWith('/more');
  });

  it('creates a new exercise with primary and secondary muscles', async () => {
    await openCatalog();

    await createExercise('Incline Press');
    fireEvent.press(screen.getByLabelText('Per side weight entry'));
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    fireEvent.press(await screen.findByLabelText('Select primary muscle Chest'));
    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    fireEvent.press(await screen.findByLabelText('Select secondary muscle Triceps'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    expect(await screen.findByText('Exercise created.')).toBeTruthy();
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
    await screen.findByText('Edit Exercise');
    expect(screen.getByLabelText('Total load weight entry').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByText('Cancel')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Bench Press');
    fireEvent.press(screen.getByLabelText('Per side weight entry'));
    fireEvent.press(screen.getByLabelText('Remove secondary muscle Triceps'));
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

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
      /Chest · Front Delts \(s\)/
    );

    fireEvent.press(screen.getByLabelText('Edit exercise definition Bench Press'));
    await screen.findByText('Edit Exercise');
    expect(screen.getByDisplayValue('Bench Press')).toBeTruthy();
    expect(screen.queryByLabelText('Remove secondary muscle Triceps')).toBeNull();
    expect(screen.getByLabelText('Remove secondary muscle Front Delts')).toBeTruthy();
  });

  it('shows the bodyweight contribution only while calculations are on, keeping it while hidden', async () => {
    const openEditor = async (name: string) => {
      fireEvent.press(await screen.findByLabelText(`Edit exercise definition ${name}`));
      await screen.findByText('Edit Exercise');
    };
    const percentage = () => screen.queryByTestId('exercise-editor-bodyweight-percentage');
    await openCatalog();
    await expandFamily('Back');

    // Off: no contribution field, and saving keeps the stored 100%.
    await openEditor('Pull-Up');
    expect(percentage()).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Exercise definition name'), 'Strict Pull-Up');
    fireEvent.press(screen.getByLabelText('Save exercise definition'));
    expect(await screen.findByText('Exercise updated.')).toBeTruthy();
    expect(definitionNamed('Strict Pull-Up')).toMatchObject({ id: 'seed_pull_up', bodyweightContribution: 1 });

    // On: the field appears with the stored share; an invalid share writes nothing.
    await act(async () => {
      await setBodyweightCalculationsEnabled(true);
    });
    await openEditor('Strict Pull-Up');
    expect(percentage()).toHaveProp('value', '100');
    fireEvent.changeText(percentage()!, '101');
    fireEvent.press(screen.getByLabelText('Save exercise definition'));
    expect(screen.getByTestId('exercise-editor-bodyweight-error')).toBeTruthy();
    expect(definitionNamed('Strict Pull-Up')).toMatchObject({ bodyweightContribution: 1 });

    fireEvent.changeText(percentage()!, '70');
    fireEvent.press(screen.getByLabelText('Save exercise definition'));
    expect(await screen.findByText('Exercise updated.')).toBeTruthy();
    expect(definitionNamed('Strict Pull-Up')).toMatchObject({ bodyweightContribution: 0.7 });
  });

  it('blocks save when no primary muscle is selected', async () => {
    await openCatalog();

    await createExercise('Cable Fly Variation');
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    expect(screen.getByText('Select a primary muscle before saving.')).toBeTruthy();
    expect(definitionNamed('Cable Fly Variation')).toBeUndefined();
  });

  it('renders the shared ExerciseCore fields and blocks a blank name with the shared validator message', async () => {
    await openCatalog();

    fireEvent.press(screen.getByLabelText('Create new exercise'));
    await screen.findByText('Create Exercise');
    // The fields come from ExerciseCoreFields and keep the editor's testIDs.
    expect(screen.getByTestId('exercise-editor-name-input')).toBeTruthy();
    expect(screen.getByTestId('exercise-editor-load-mode-total_load').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('exercise-editor-load-mode-per_side_load').props.accessibilityState).toMatchObject({
      selected: false,
    });
    fireEvent.changeText(screen.getByTestId('exercise-editor-name-input'), ' \t ');
    fireEvent.press(screen.getByLabelText('Save exercise definition'));

    expect(screen.getByTestId('exercise-editor-name-error')).toHaveTextContent('Exercise name is required');
  });

  it('dismisses the keyboard and uses keyboard-aware scrolling for the muscle selector', async () => {
    const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(jest.fn());
    await openCatalog();

    await createExercise('Cable Row Variation');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));

    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    const selectorList = await screen.findByTestId('exercise-editor-muscle-selector-list');
    expect(selectorList.props.automaticallyAdjustKeyboardInsets).toBe(Platform.OS === 'ios');
    expect(selectorList.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(selectorList.props.keyboardDismissMode).toBe('on-drag');
    expect(selectorList.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('prevents duplicate secondary links and excludes the selected primary from secondary options', async () => {
    await openCatalog();

    await createExercise('Press Variation');
    fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
    fireEvent.press(screen.getByLabelText('Select primary muscle Chest'));

    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    expect(screen.queryByLabelText('Select secondary muscle Chest')).toBeNull();
    fireEvent.press(screen.getByLabelText('Select secondary muscle Triceps'));

    fireEvent.press(screen.getByLabelText('Open secondary muscle selector'));
    expect(screen.queryByLabelText('Select secondary muscle Triceps')).toBeNull();
    expect(screen.getByLabelText('Select secondary muscle Front Delts')).toBeTruthy();
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
    expect(screen.queryByTestId('exercise-action-delete')).toBeNull();
    fireEvent.press(screen.getByTestId('exercise-action-undelete'));

    expect(await screen.findByText('Exercise restored.')).toBeTruthy();
    expect(definitionNamed('Barbell Bench Press')?.deletedAt).toBeNull();
  });

  it('duplicates an exercise from its actions with prefilled data and (Copy) in name', async () => {
    await openCatalog();
    await expandFamily('Chest');
    fireEvent.press(await screen.findByLabelText('Exercise actions Barbell Bench Press'));
    expect(await screen.findByRole('header', { name: 'Barbell Bench Press' })).toBeTruthy();
    expect(screen.getByTestId('exercise-action-duplicate')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Duplicate exercise from actions'));

    expect(await screen.findByRole('header', { name: 'Duplicate Exercise' })).toBeTruthy();
    expect(screen.getByDisplayValue('Barbell Bench Press (Copy)')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Save exercise definition'));

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
    it('titles the screen Exercises, with + as its one accent and visible shared controls', async () => {
      await openCatalog();

      expect(screen.getByRole('header', { name: 'Exercises' })).toBeTruthy();
      expect(screen.getByTestId('exercise-catalog-title')).toBeTruthy();
      const accents = accentGrounds();
      expect(accents).toHaveLength(1);
      expect(accents[0].props.testID).toBe('create-new-exercise-button');

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

    it('opens the editor as a page sheet with Save as its one accent, closed by its X', async () => {
      await openCatalog();

      fireEvent.press(screen.getByLabelText('Create new exercise'));
      expect(await screen.findByTestId('exercise-editor')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Create Exercise' })).toBeTruthy();
      expect(screen.getByTestId('exercise-editor-load-mode-row').props.accessibilityRole).toBe('tablist');
      const editorAccents = accentGrounds(screen.getByTestId('exercise-editor'));
      expect(editorAccents).toHaveLength(1);
      expect(editorAccents[0].props.accessibilityLabel).toBe('Save exercise definition');

      fireEvent.press(screen.getByLabelText('Close exercise editor'));
      expect(screen.queryByTestId('exercise-editor')).toBeNull();
    });

    it('swaps the editor for the muscle list in the same sheet, and Back to exercise returns without choosing', async () => {
      await openCatalog();

      await createExercise('Cable Fly Variation');
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));

      expect(screen.getByRole('header', { name: 'Select primary muscle' })).toBeTruthy();
      expect(screen.getByTestId('exercise-editor-muscle-selector-list')).toBeTruthy();
      // The form is hidden, not a second sheet over it.
      expect(screen.queryByLabelText('Save exercise definition')).toBeNull();
      expect(screen.getAllByTestId('exercise-editor')).toHaveLength(1);

      fireEvent.press(screen.getByLabelText('Back to exercise'));
      expect(screen.getByRole('header', { name: 'Create Exercise' })).toBeTruthy();
      expect(screen.getByDisplayValue('Cable Fly Variation')).toBeTruthy();
      expect(screen.getByText('Select primary muscle')).toBeTruthy();

      // The chosen primary is marked in the list when it opens again.
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
      fireEvent.press(screen.getByLabelText('Select primary muscle Chest'));
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
      expect(screen.getByTestId('exercise-editor-muscle-option-chest').props.accessibilityState).toMatchObject({
        selected: true,
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
      fireEvent.press(screen.getByLabelText('Open primary muscle selector'));
      fireEvent.press(screen.getByLabelText('Select primary muscle Chest'));
      fireEvent.press(screen.getByLabelText('Save exercise definition'));

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
