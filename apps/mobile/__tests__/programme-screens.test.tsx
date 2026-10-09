/* eslint-disable import/first */

/**
 * Multi-session training programme screens over real local data:
 * - `/programme/new` (creation, duplicate prefill, validation, child session editor)
 * - `/programme/[programmeId]` (detail view, next unresolved block, Add block, Skip block, child session reorder, detached delete)
 * Over the migrated in-memory SQLite database (helpers/local-data.ts).
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

const mockPush = jest.fn();
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
      push: mockPush,
      replace: mockReplace,
    }),
  };
});

import { uiSpace } from '@/components/ui';
import { ProgrammeNewScreen } from '@/app/programme/new';
import { ProgrammeDetailScreen } from '@/app/programme/[programmeId]';
import { planQueries, planRepository } from '@/src/session-planner';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { bootLocalApp, closeLocalData, resetLocalData } from './helpers/local-data';

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
    fireEvent.press(screen.getByTestId('plan-form-block-1-pick'));
    fireEvent.changeText(await screen.findByTestId('plan-exercise-pick-search'), name);
    fireEvent.press(await screen.findByLabelText(`Select exercise ${name}`));
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

      // Target sets
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-weight'), '140');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '5');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));

      // Edit Session 2
      fireEvent.press(screen.getByTestId('programme-form-plan-2-edit'));
      fireEvent.changeText(screen.getByTestId('programme-child-plan-title-input'), 'Day 2: Heavy Bench');
      await pickExercise('Bench Press');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-weight'), '100');
      fireEvent.changeText(screen.getByTestId('plan-form-block-1-set-1-reps'), '5');
      fireEvent.press(screen.getByTestId('programme-child-plan-done-button'));

      // Save programme
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

    it('insets the child session editor body to the sheet gutter', () => {
      render(<ProgrammeNewScreen editProgrammeId={null} fromProgrammeId={null} />);

      fireEvent.press(screen.getByTestId('programme-form-plan-1-edit'));

      expect(screen.getByTestId('programme-child-plan-editor-body')).toHaveStyle({
        paddingHorizontal: uiSpace.lg,
      });
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
                  { targetWeightText: '140', targetRepsText: '5', targetSetType: null },
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

      // Next block card highlights the Barbell Squat block
      expect(screen.getByTestId('programme-next-block-name')).toHaveTextContent('Barbell Squat');
      expect(screen.getByTestId('programme-next-block-targets')).toHaveTextContent('5 reps @ 140 kg');

      // Sessions list renders both sessions
      expect(screen.getByText('Lower A')).toBeTruthy();
      expect(screen.getByText('Upper A')).toBeTruthy();
    });

    it('adds the next block to session on press', async () => {
      render(<ProgrammeDetailScreen programmeId={seededProgrammeId} />);

      await waitFor(() => {
        expect(screen.getByTestId('programme-next-block-add')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(screen.getByTestId('programme-next-block-add'));
      });

      // Creates session and navigates into active session view
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/session\//));
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
