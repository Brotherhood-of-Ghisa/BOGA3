/* eslint-disable import/first */

/**
 * Multi-session training programme screens over real local data:
 * - `/programme/new` (creation, duplicate prefill, validation, child session editor)
 * - `/programme/[programmeId]` (detail view, next unresolved block, Add block, Skip block, child session reorder, detached delete)
 * Over the migrated in-memory SQLite database (helpers/local-data.ts).
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Keyboard, Modal } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string | string[]> = {};

jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(() => callback(), [callback]);
    },
    useLocalSearchParams: () => mockParams,
    useNavigation: () => ({ addListener: () => () => undefined }),
    useRouter: () => ({
      back: mockBack,
      canGoBack: () => true,
      dismissTo: mockDismissTo,
      push: mockPush,
      replace: mockReplace,
    }),
  };
});

import { updatePreferences } from '@/src/preferences/hooks';
import { eq } from 'drizzle-orm';
import { sessionPlans } from '@/src/data/schema';
import { uiSpace } from '@/components/ui';
import { ProgrammeNewScreen } from '@/app/programme/new';
import { ProgrammeDetailScreen } from '@/app/programme/[programmeId]';
import { planQueries, planRepository, addPlanBlockToSession, skipPlanBlock } from '@/src/session-planner';
import { completeSessionDraft, loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

describe('programme screens', () => {
  let alertSpy: jest.SpyInstance;

  const seedCatalog = async () => {
    await bootLocalApp();
    await saveExerciseCatalogExercise({
      bodyweightContribution: 0,
      id: 'ex-squat',
      loadInputMode: 'total_load',
      mappings: [{ muscleGroupId: 'quads', role: 'primary', weight: 1 }],
      name: 'Barbell Squat',
    });
    await saveExerciseCatalogExercise({
      bodyweightContribution: 0,
      id: 'ex-bench',
      loadInputMode: 'per_side_load',
      mappings: [{ muscleGroupId: 'chest', role: 'primary', weight: 1 }],
      name: 'Bench Press',
    });
  };

  const pickExercise = async (name: string) => {
    fireEvent.press(screen.getByTestId('programme-child-plan-add-block'));
    fireEvent.changeText(await screen.findByTestId('plan-exercise-pick-search'), name);
    fireEvent.press(await screen.findByLabelText(`Select exercise ${name}`));
    fireEvent.press(await screen.findByTestId('exercise-picker-add-empty-set-button'));
  };

  beforeAll(async () => {
    await bootLocalApp();
  });

  afterAll(() => {
    closeLocalData();
  });

  beforeEach(async () => {
    resetLocalData();
    await seedCatalog();
    mockPush.mockReset();
    mockDismissTo.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockParams = {};
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  describe('programme create (/programme/new)', () => {
    it('saves a valid programme with two sessions offline and navigates to its detail', async () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);

      // Enter programme name and description
      fireEvent.changeText(screen.getByTestId('programme-form-name'), '6-Week Wave');
      fireEvent.changeText(screen.getByTestId('programme-form-description'), 'Squat emphasis block');

      // Edit Session 1
      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));
      fireEvent.changeText(screen.getByTestId('programme-child-plan-title-input'), 'Day 1: Heavy Squat');

      // Pick exercise for block 1
      await pickExercise('Barbell Squat');
      expect(screen.getByText('Weight')).toBeTruthy();
      expect(screen.getByLabelText('Set 1 weight')).toBeTruthy();

      // Target sets
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-weight'), '140');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '5');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));

      // Edit Session 2
      fireEvent.press(screen.getByTestId('programme-form-plan-2-edit'));
      fireEvent.changeText(screen.getByTestId('programme-child-plan-title-input'), 'Day 2: Heavy Bench');
      await pickExercise('Bench Press');
      expect(screen.getByText('Weight')).toBeTruthy();
      expect(screen.getByLabelText('Set 1 weight')).toBeTruthy();
      expect(screen.queryByText('Weight per side · kg')).toBeNull();
      expect(screen.queryByLabelText('Set 1 weight per side in kilograms')).toBeNull();
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-weight'), '100');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '5');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));

      // Add the programme: a new programme's primary names what it adds.
      expect(screen.getByTestId('programme-form-save')).toHaveTextContent('Add programme');
      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-form-save'));
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/programme\//));
      });

      // Verify database
      const programmes = await planQueries.listProgrammeSummaries();
      expect(programmes).toHaveLength(1);
      expect(programmes[0].name).toBe('6-Week Wave');
      expect(programmes[0].description).toBe('Squat emphasis block');
      expect(programmes[0].planCount).toBe(2);

      const detail = await planQueries.loadProgrammeDetail(programmes[0].id);
      expect(detail).not.toBeNull();
      expect(detail?.plans[0].title).toBe('Day 1: Heavy Squat');
      expect(detail?.plans[1].title).toBe('Day 2: Heavy Bench');
    });

    it('refuses save when name is missing and writes nothing', async () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);

      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-form-save'));
      });

      expect(screen.getByTestId('programme-form-notice')).toBeTruthy();
      expect(screen.getAllByText('Name the programme.')).toHaveLength(2);
      expect(mockReplace).not.toHaveBeenCalled();

      const programmes = await planQueries.listProgrammeSummaries();
      expect(programmes).toHaveLength(0);
    });

    it('shares target effort defaults, picker, copying and validation with standalone plans', async () => {
      updatePreferences({ displayEfforts: ['rir_4', 'rir_2'] });
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);
      fireEvent.changeText(screen.getByTestId('programme-form-name'), 'Copy wave');
      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));
      expect(screen.getByTestId('programme-child-plan-schedule-row')).toHaveTextContent(/Unscheduled/);
      fireEvent.press(screen.getByTestId('programme-child-plan-schedule-row'));
      fireEvent(screen.getByTestId('plan-schedule-picker-native'), 'onChange', { type: 'set' }, new Date(2026, 9, 12, 9, 0, 0));
      fireEvent.press(screen.getByTestId('plan-schedule-confirm-button'));
      expect(screen.getByTestId('programme-child-plan-schedule-row')).toHaveTextContent(/12-10-2026 09:00/);
      await pickExercise('Bench Press');
      expect(screen.getByTestId('plan-form-block-1-set-1-effort')).toHaveTextContent('EffortRIR 4');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-weight'), '40');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '0');
      expect(screen.getByTestId('plan-form-block-1-set-1-reps-error')).toHaveTextContent('Reps must be a whole number from 1 to 999.');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '8');
      const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {
        expect(screen.queryByTestId('exercise-effort-option-rir_2')).toBeNull();
      });
      fireEvent(screen.getByTestId('plan-form-block-1-set-1-effort'), 'longPress');
      expect(dismissKeyboard).toHaveBeenCalledTimes(1);
      dismissKeyboard.mockRestore();
      expect(screen.getByTestId('programme-child-plan-editor-sheet-title')).toHaveTextContent('Effort');
      expect(screen.queryByTestId('programme-child-plan-title-input')).toBeNull();
      expect(screen.queryByTestId('exercise-effort-sheet', { includeHiddenElements: true })).toBeNull();
      expect(screen.UNSAFE_getAllByType(Modal).filter((modal) => modal.props.visible)).toHaveLength(1);
      const picker = within(screen.getByTestId('programme-child-plan-editor-sheet'));
      expect(picker.queryByTestId('exercise-effort-option-warm_up')).toBeNull();
      expect(picker.getByTestId('exercise-effort-option-rir_4')).toHaveProp('accessibilityState', { selected: true, disabled: false });
      fireEvent.press(screen.getByTestId('programme-child-plan-effort-back'));
      expect(screen.getByTestId('plan-form-block-1-set-1-effort')).toHaveTextContent('EffortRIR 4');
      expect(screen.getByTestId('plan-form-block-1-set-1-weight')).toHaveProp('value', '40');
      expect(screen.getByTestId('plan-form-block-1-set-1-reps')).toHaveProp('value', '8');
      fireEvent(screen.getByTestId('plan-form-block-1-set-1-effort'), 'longPress');
      fireEvent.press(screen.getByTestId('exercise-effort-option-rir_2'));
      fireEvent.press(screen.getByTestId('plan-form-block-1-add-set'));
      fireEvent.press(screen.getByTestId('plan-set-add-confirm'));
      expect(screen.getByTestId('plan-form-block-1-set-2-weight')).toHaveProp('value', '40');
      expect(screen.getByTestId('plan-form-block-1-set-2-reps')).toHaveProp('value', '8');
      expect(screen.getByTestId('plan-form-block-1-set-2-effort')).toHaveTextContent('EffortRIR 2');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-2-weight'), '45');
      fireEvent(screen.getByTestId('plan-form-block-1-set-2-effort'), 'longPress');
      fireEvent.press(screen.getByTestId('programme-child-plan-editor-sheet-close'));
      fireEvent.press(screen.getByTestId('programme-form-plan-2-edit'));
      expect(screen.getByTestId('programme-child-plan-editor-sheet-title')).toHaveTextContent('Edit Session 2');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));
      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));
      expect(screen.getByTestId('programme-child-plan-editor-sheet-title')).toHaveTextContent('Edit Session 1');
      expect(screen.getByTestId('plan-form-block-1-set-2-weight')).toHaveProp('value', '45');
      fireEvent(screen.getByTestId('plan-form-block-1-set-2-effort'), 'longPress');
      fireEvent.press(screen.getByTestId('exercise-effort-option-rir_4'));
      expect(screen.getByTestId('plan-form-block-1-set-1-effort')).toHaveTextContent('EffortRIR 2');
      expect(screen.getByTestId('plan-form-block-1-set-2-effort')).toHaveTextContent('EffortRIR 4');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));
      fireEvent.press(screen.getByTestId('programme-form-plan-2-remove'));
      fireEvent.press(screen.getByTestId('programme-form-plan-1-duplicate'));
      fireEvent.press(screen.getByTestId('programme-form-save'));
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      const [programme] = await planQueries.listProgrammeSummaries();
      const detail = await planQueries.loadProgrammeDetail(programme.id);
      for (const plan of detail!.plans) {
        const child = await planQueries.loadPlanDetail(plan.id);
        expect(child?.blocks[0].targets.map(({ targetWeightValue, targetReps, targetSetType }) =>
          [targetWeightValue, targetReps, targetSetType])).toEqual([
          ['40', 8, 'rir_2'], ['45', 8, 'rir_4'],
        ]);
      }
    });

    it('refuses save when sessions count drops below 2', async () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);
      fireEvent.changeText(screen.getByTestId('programme-form-name'), 'Short Programme');

      // Remove session 2
      fireEvent.press(screen.getByTestId('programme-form-plan-2-remove'));

      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-form-save'));
      });

      expect(screen.getByTestId('programme-form-plans-error')).toBeTruthy();
      expect(screen.getAllByText('A programme needs at least two sessions.')).toHaveLength(2);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('supports duplicating and reordering sessions within the form', async () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);
      fireEvent.changeText(screen.getByTestId('programme-form-name'), '3-Day Split');

      // Duplicate Session 1
      fireEvent.press(screen.getByTestId('programme-form-plan-1-duplicate'));
      expect(screen.getByTestId('programme-form-plan-3')).toBeTruthy();

      // Move Session 3 earlier
      fireEvent.press(screen.getByTestId('programme-form-plan-3-up'));
      // The duplicated session is now session 2
      expect(screen.getByTestId('programme-form-plan-2')).toBeTruthy();
    });

    it('saves a programme whose sessions use a seeded gym that has no gyms row yet', async () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);
      fireEvent.changeText(screen.getByTestId('programme-form-name'), 'Gym Wave');

      // Session 1 at the seeded "Downtown Iron Temple" gym — its gyms row is
      // only written when a gym is picked.
      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));
      await pickExercise('Barbell Squat');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-weight'), '140');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '5');
      fireEvent.press(screen.getByTestId('programme-child-plan-gym-row'));
      fireEvent.press(await screen.findByTestId('plan-form-gym-downtown-iron-temple'));
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));

      // Session 2.
      fireEvent.press(screen.getByTestId('programme-form-plan-2-edit'));
      await pickExercise('Bench Press');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-weight'), '100');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '5');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));

      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-form-save'));
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith(expect.stringMatching(/^\/programme\//));
      });
    });

    it('insets the child session editor body to the sheet gutter', () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);

      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));

      expect(screen.getByTestId('programme-child-plan-editor-body')).toHaveStyle({
        paddingHorizontal: uiSpace.lg,
      });
    });

    it('gives the child session editor a scrolling body', () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);

      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));

      // The editor's body is a ScrollView so a long session scrolls rather than
      // hiding fields and Done beyond the sheet's fixed height.
      expect(screen.getByTestId('programme-child-plan-editor-scroll')).toBeTruthy();
    });
  });

  describe('programme edit (/programme/new?edit=)', () => {
    let editProgrammeId: string;

    beforeEach(async () => {
      const result = await planRepository.createProgramme({
        name: 'Editable Wave',
        description: 'Block 1',
        plans: [
          {
            title: 'Lower A',
            gymId: null,
            scheduledFor: null,
            exercises: [
              { exerciseDefinitionId: 'ex-squat', name: 'Barbell Squat', sets: [{ targetWeightText: '140', targetRepsText: '5', targetSetType: null }] },
            ],
          },
          {
            title: 'Upper A',
            gymId: null,
            scheduledFor: null,
            exercises: [
              { exerciseDefinitionId: 'ex-bench', name: 'Bench Press', sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }] },
            ],
          },
          {
            title: 'Lower B',
            gymId: null,
            scheduledFor: null,
            exercises: [
              { exerciseDefinitionId: 'ex-squat', name: 'Barbell Squat', sets: [{ targetWeightText: '120', targetRepsText: '8', targetSetType: null }] },
            ],
          },
        ],
      });
      if (result.status !== 'saved') {
        throw new Error(`createProgramme failed in test setup: ${JSON.stringify(result)}`);
      }
      editProgrammeId = result.id;
    });

    const saveProgramme = async () => {
      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-form-save'));
      });
      await waitFor(() => expect(mockBack).toHaveBeenCalled());
    };

    it('persists an edited child session title', async () => {
      render(<ProgrammeNewScreen editProgrammeId={editProgrammeId} fromProgrammeId={null} />);
      await screen.findByTestId('programme-form-name');

      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));
      fireEvent.changeText(screen.getByTestId('programme-child-plan-title-input'), 'Lower A+');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));

      await saveProgramme();

      const detail = await planQueries.loadProgrammeDetail(editProgrammeId);
      expect(detail?.plans.map((plan) => plan.title)).toEqual(['Lower A+', 'Upper A', 'Lower B']);
    });

    it('persists a duplicated child session', async () => {
      render(<ProgrammeNewScreen editProgrammeId={editProgrammeId} fromProgrammeId={null} />);
      await screen.findByTestId('programme-form-name');

      fireEvent.press(screen.getByTestId('programme-form-plan-1-duplicate'));
      expect(screen.getByTestId('programme-form-plan-4')).toBeTruthy();

      await saveProgramme();

      const detail = await planQueries.loadProgrammeDetail(editProgrammeId);
      expect(detail?.plans).toHaveLength(4);
    });

    it('adds exact copies of the last child target in the existing sheet, cancels with Back and persists only that child', async () => {
      const { unmount } = render(<ProgrammeNewScreen editProgrammeId={editProgrammeId} fromProgrammeId={null} />);
      await screen.findByTestId('programme-form-name');
      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));
      fireEvent(screen.getByTestId('plan-form-block-1-set-1-effort'), 'longPress');
      fireEvent.press(screen.getByTestId('exercise-effort-option-rir_3'));
      act(() => updatePreferences({ displayEfforts: ['unspecified', 'rir_4', 'rir_2'] }));
      expect(screen.queryByLabelText(/Duplicate set/)).toBeNull();
      const openAddSets = () => fireEvent.press(screen.getByTestId('plan-form-block-1-add-set'));
      openAddSets();
      expect(screen.getByTestId('programme-child-plan-editor-sheet-title')).toHaveTextContent('Add set(s)');
      expect(screen.queryByTestId('programme-child-plan-title-input')).toBeNull();
      expect(screen.queryByTestId('plan-set-add-sheet', { includeHiddenElements: true })).toBeNull();
      expect(screen.UNSAFE_getAllByType(Modal).filter((modal) => modal.props.visible)).toHaveLength(1);
      fireEvent.changeText(screen.getByTestId('plan-set-add-count'), '9');
      fireEvent.press(screen.getByTestId('programme-child-plan-add-sets-back'));
      expect(screen.queryByTestId('plan-form-block-1-set-2-weight')).toBeNull();
      openAddSets();
      expect(screen.getByTestId('plan-set-add-count')).toHaveProp('value', '1');
      fireEvent.changeText(screen.getByTestId('plan-set-add-count'), '9');
      fireEvent.press(screen.getByTestId('plan-set-add-confirm'));
      expect(screen.getByTestId('plan-form-block-1-set-10-effort')).toHaveTextContent('EffortRIR 3');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));
      await saveProgramme();
      const detail = await planQueries.loadProgrammeDetail(editProgrammeId);
      const child = await planQueries.loadPlanDetail(detail!.plans[0].id);
      expect(child!.blocks[0].targets).toHaveLength(10);
      expect(child!.blocks[0].targets.every((target) =>
        target.targetWeightValue === '140' && target.targetReps === 5 && target.targetSetType === 'rir_3')).toBe(true);
      const otherChild = await planQueries.loadPlanDetail(detail!.plans[1].id);
      expect(otherChild!.blocks[0].targets).toHaveLength(1);
      unmount();
      render(<ProgrammeNewScreen editProgrammeId={editProgrammeId} fromProgrammeId={null} />);
      await screen.findByTestId('programme-form-name');
      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));
      expect(screen.getByTestId('plan-form-block-1-set-10-reps')).toHaveProp('value', '5');
    });

    it('persists removing a child session', async () => {
      render(<ProgrammeNewScreen editProgrammeId={editProgrammeId} fromProgrammeId={null} />);
      await screen.findByTestId('programme-form-name');

      fireEvent.press(screen.getByTestId('programme-form-plan-1-remove'));

      await saveProgramme();

      const detail = await planQueries.loadProgrammeDetail(editProgrammeId);
      expect(detail?.plans.map((plan) => plan.title)).toEqual(['Upper A', 'Lower B']);
    });

    it('persists a reordered child session list', async () => {
      render(<ProgrammeNewScreen editProgrammeId={editProgrammeId} fromProgrammeId={null} />);
      await screen.findByTestId('programme-form-name');

      fireEvent.press(screen.getByTestId('programme-form-plan-3-up'));

      await saveProgramme();

      const detail = await planQueries.loadProgrammeDetail(editProgrammeId);
      expect(detail?.plans.map((plan) => plan.title)).toEqual(['Lower A', 'Lower B', 'Upper A']);
    });
  });

  describe('programme detail (/programme/[programmeId])', () => {
    let seededProgrammeId: string;

    beforeEach(async () => {
      const result = await planRepository.createProgramme({
        name: 'Hypertrophy Wave',
        description: 'Block 1',
        plans: [
          {
            title: 'Lower A',
            gymId: null,
            scheduledFor: null,
            exercises: [
              {
                exerciseDefinitionId: 'ex-squat',
                name: 'Barbell Squat',
                sets: [
                  { targetWeightText: '140', targetRepsText: '5', targetSetType: 'rir_2' },
                ],
              },
            ],
          },
          {
            title: 'Upper A',
            gymId: null,
            scheduledFor: null,
            exercises: [
              {
                exerciseDefinitionId: 'ex-bench',
                name: 'Bench Press',
                sets: [
                  { targetWeightText: '100', targetRepsText: '5', targetSetType: null },
                ],
              },
            ],
          },
        ],
      });
      if (result.status !== 'saved') {
        throw new Error(`createProgramme failed in test setup: ${JSON.stringify(result)}`);
      }
      seededProgrammeId = result.id;
    });

    it('renders detail with title, progress, next unresolved block and child plans', async () => {
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await waitFor(() => {
        expect(screen.getByText('Hypertrophy Wave')).toBeTruthy();
        expect(screen.getByText('Block 1')).toBeTruthy();
      });

      expect(screen.getByTestId('programme-detail-progress-badge')).toHaveTextContent('Planned');
      expect(screen.getByTestId('programme-detail-stats')).toHaveTextContent('2 sessions · 0 completed · 0 skipped');

      // Next block card highlights the Barbell Squat block
      expect(screen.getByTestId('programme-next-block-name')).toHaveTextContent('Barbell Squat');
      expect(screen.getByTestId('programme-next-block-targets')).toHaveTextContent('5 reps @ 140 (RIR 2)');

      // Sessions list renders both sessions
      expect(screen.getByText('Lower A')).toBeTruthy();
      expect(screen.getByText('Upper A')).toBeTruthy();
    });

    const finishBlock = async (blockId: string) => {
      const result = await addPlanBlockToSession(blockId);
      if (result.status !== 'attached') throw new Error(result.status);
      const snapshot = (await loadSessionSnapshotById(result.sessionId))!;
      await persistSessionDraftSnapshot({
        sessionId: result.sessionId, gymId: null, startedAt: snapshot.startedAt,
        exercises: snapshot.exercises.map((card) => ({
          ...card,
          sets: card.sets.map((set) => ({ ...set, repsValue: '7', weightValue: '125', performanceStatus: null })),
        })),
      });
      await completeSessionDraft(result.sessionId, { completedAt: new Date(), now: new Date() });
      return (await loadSessionSnapshotById(result.sessionId))!;
    };

    it('counts completed and skipped sessions separately using derived completion without rewriting workout provenance', async () => {
      const before = (await planQueries.loadProgrammeDetail(seededProgrammeId))!;
      const workout = await finishBlock(before.plans[0].blocks[0].id);
      await skipPlanBlock(before.plans[1].blocks[0].id);
      const derived = (await planQueries.loadProgrammeDetail(seededProgrammeId))!;
      expect(derived.plans[0].blocks[0]).toMatchObject({
        progressStatus: 'pending', status: 'completed', attachedSessionId: workout.sessionId,
        attachedSessionExerciseId: workout.exercises[0].id,
      });
      expect(workout.exercises[0]).toMatchObject({
        sourcePlanExerciseId: before.plans[0].blocks[0].id,
        sets: [expect.objectContaining({ sourcePlanSetId: before.plans[0].blocks[0].targets[0].id, weightValue: '125', repsValue: '7' })],
      });
      expect(derived.plans[1].blocks[0].attachedSessionId).toBeNull();

      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);
      expect(await screen.findByTestId('programme-detail-stats')).toHaveTextContent('2 sessions · 1 completed · 1 skipped');
      expect(screen.getByTestId('programme-detail-progress-badge')).toHaveTextContent('Completed');
      const completed = screen.getByTestId(`programme-plan-row-${before.plans[0].id}`);
      const skipped = screen.getByTestId(`programme-plan-row-${before.plans[1].id}`);
      expect(completed).toHaveProp('accessibilityLabel', 'Lower A, Unscheduled, Completed, 1 block, 1 completed, 0 skipped');
      expect(skipped).toHaveProp('accessibilityLabel', 'Upper A, Unscheduled, Skipped, 1 block, 0 completed, 1 skipped');
      expect(within(completed).getByText('Completed')).toBeTruthy();
      expect(within(skipped).getByText('Skipped')).toBeTruthy();
      fireEvent.press(completed);
      expect(mockPush).toHaveBeenCalledWith(`/session-plan/${encodeURIComponent(before.plans[0].id)}`);
      expect(await loadSessionSnapshotById(workout.sessionId)).toEqual(workout);
    });

    it.each([false, true])('keeps both block outcomes visible and spoken in a mixed session (resolved=%s)', async (resolved) => {
      const result = await planRepository.createProgramme({
        name: 'Mixed blocks', description: '',
        plans: [resolved ? 2 : 3, 1].map((count, index) => ({
          title: `Day ${index + 1}`, gymId: null, scheduledFor: null,
          exercises: Array.from({ length: count }, () => ({
            exerciseDefinitionId: 'ex-squat', name: 'Barbell Squat',
            sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
          })),
        })),
      });
      if (result.status !== 'saved') throw new Error(result.status);
      const detail = (await planQueries.loadProgrammeDetail(result.id))!;
      await finishBlock(detail.plans[0].blocks[0].id);
      await skipPlanBlock(detail.plans[0].blocks[1].id);
      await skipPlanBlock(detail.plans[1].blocks[0].id);
      render(<ProgrammeDetailScreen programmeId={result.id} />);
      expect(await screen.findByTestId('programme-detail-stats')).toHaveTextContent(`2 sessions · ${resolved ? 1 : 0} completed · 1 skipped`);
      const row = screen.getByTestId(`programme-plan-row-${detail.plans[0].id}`);
      const outcome = resolved ? 'Completed' : 'In progress';
      const total = resolved ? 2 : 3;
      expect(within(row).getByText(outcome)).toBeTruthy();
      expect(within(row).getByText(new RegExp(`${total} blocks · 1 completed · 1 skipped$`))).toBeTruthy();
      expect(row).toHaveProp('accessibilityLabel', `Day 1, Unscheduled, ${outcome}, ${total} blocks, 1 completed, 1 skipped`);
    });

    it.each([0, 1])('keeps empty and singular legacy programme totals explicit (%i sessions)', async (remaining) => {
      const detail = (await planQueries.loadProgrammeDetail(seededProgrammeId))!;
      // A synced/legacy programme can have fewer children than the authoring minimum.
      for (const plan of detail.plans.slice(remaining)) {
        localDatabase().delete(sessionPlans).where(eq(sessionPlans.id, plan.id)).run();
      }
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);
      expect(await screen.findByTestId('programme-detail-stats')).toHaveTextContent(
        `${remaining} ${remaining === 1 ? 'session' : 'sessions'} · 0 completed · 0 skipped`,
      );
      expect(screen.getByTestId('programme-detail-progress-badge')).toHaveTextContent('Planned');
    });

    it('shows all completed sessions without inventing skipped work', async () => {
      const detail = (await planQueries.loadProgrammeDetail(seededProgrammeId))!;
      for (const plan of detail.plans) await finishBlock(plan.blocks[0].id);
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);
      expect(await screen.findByTestId('programme-detail-stats')).toHaveTextContent('2 sessions · 2 completed · 0 skipped');
      expect(screen.getByTestId('programme-detail-progress-badge')).toHaveTextContent('Completed');
    });

    it('keeps partial and attached work in progress and does not count it as a finished session', async () => {
      const detail = (await planQueries.loadProgrammeDetail(seededProgrammeId))!;
      await skipPlanBlock(detail.plans[0].blocks[0].id);
      await addPlanBlockToSession(detail.plans[1].blocks[0].id);
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);
      expect(await screen.findByTestId('programme-detail-stats')).toHaveTextContent('2 sessions · 0 completed · 1 skipped');
      expect(screen.getByTestId('programme-detail-progress-badge')).toHaveTextContent('In progress');
      expect(screen.getByTestId(`programme-plan-row-${detail.plans[1].id}`)).toHaveProp(
        'accessibilityLabel', 'Upper A, Unscheduled, In progress, 1 block, 0 completed, 0 skipped',
      );
    });

    it('adds the next block to session on press', async () => {
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await waitFor(() => {
        expect(screen.getByTestId('programme-next-block-add')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-next-block-add'));
      });

      // Creates the session and opens Train, where the workout lives
      await waitFor(() => {
        expect(mockDismissTo).toHaveBeenCalledWith('/train');
      });
    });

    it('skips the next block and advances to the next unresolved block in sequence', async () => {
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await waitFor(() => {
        expect(screen.getByTestId('programme-next-block-skip')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-next-block-skip'));
      });

      // Once Lower A Barbell Squat is skipped, Upper A Bench Press becomes the next block
      await waitFor(() => {
        expect(screen.getByTestId('programme-next-block-name')).toHaveTextContent('Bench Press');
      });
    });

    it('shows availability wording, not completion, when every unresolved block is attached', async () => {
      const detail = await planQueries.loadProgrammeDetail(seededProgrammeId);
      const blockIds = detail!.plans.flatMap((plan) => plan.blocks.map((block) => block.id));
      for (const blockId of blockIds) {
        await addPlanBlockToSession(blockId);
      }

      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await waitFor(() => {
        expect(screen.getByTestId('programme-next-block-empty')).toBeTruthy();
      });
      expect(screen.getByTestId('programme-next-block-empty-text')).toHaveTextContent(
        'Every remaining block is already attached to a session.'
      );
    });

    it('claims completion only once every block is resolved', async () => {
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await screen.findByTestId('programme-next-block-skip');
      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-next-block-skip'));
      });
      await waitFor(() => expect(screen.getByTestId('programme-next-block-name')).toHaveTextContent('Bench Press'));
      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-next-block-skip'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('programme-next-block-empty-text')).toHaveTextContent(
          'All blocks in this programme have been completed or skipped.'
        );
      });
      expect(screen.getByTestId('programme-detail-progress-badge')).toHaveTextContent('Completed');
      expect(screen.getByTestId('programme-detail-stats')).toHaveTextContent('2 sessions · 0 completed · 2 skipped');
      expect(screen.getAllByText('Skipped')).toHaveLength(2);
    });

    it('reorders sessions in the programme via Move controls', async () => {
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await waitFor(() => {
        expect(screen.getByText('Lower A')).toBeTruthy();
      });

      const detail = await planQueries.loadProgrammeDetail(seededProgrammeId);
      const firstPlanId = detail!.plans[0].id;

      // Move Lower A down
      await act(async () => {
        fireEvent.press(screen.getByTestId(`programme-plan-row-${firstPlanId}-down`));
      });

      await waitFor(async () => {
        const reloaded = await planQueries.loadProgrammeDetail(seededProgrammeId);
        expect(reloaded?.plans[0].title).toBe('Upper A');
        expect(reloaded?.plans[1].title).toBe('Lower A');
      });
    });

    it('deleting a programme detaches child plans as standalone plans without deleting workouts', async () => {
      alertSpy.mockImplementation((title, msg, buttons) => {
        const deleteButton = buttons?.find((b: any) => b.text === 'Delete programme');
        deleteButton?.onPress?.();
      });

      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await waitFor(() => {
        expect(screen.getByTestId('programme-detail-delete')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-detail-delete'));
      });

      await waitFor(() => {
        expect(mockBack).toHaveBeenCalled();
      });

      // Programme row is soft-deleted
      const programme = await planQueries.loadProgrammeDetail(seededProgrammeId);
      expect(programme).toBeNull();

      // Child plans survive as standalone plans (programmeId is null)
      const standalonePlans = await planQueries.listUnscheduledPlans();
      const surviving = standalonePlans.filter((p) => p.title === 'Lower A' || p.title === 'Upper A');
      expect(surviving).toHaveLength(2);
      expect(surviving[0].programmeId).toBeNull();
      expect(surviving[1].programmeId).toBeNull();
    });

    it('displays unavailable state when programme does not exist', async () => {
      render(<ProgrammeDetailScreen programmeId="non-existent-programme-id" />);

      await waitFor(() => {
        expect(screen.getByTestId('programme-detail-unavailable')).toBeTruthy();
        expect(screen.getByText('This programme is no longer available.')).toBeTruthy();
      });
    });
  });
});
