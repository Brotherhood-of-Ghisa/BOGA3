/* eslint-disable import/first */

/**
 * The one-off plan screens over real data: the shared form, the new-plan
 * route (with its duplicate prefill) and the plan detail route, over the
 * migrated in-memory SQLite database (helpers/local-data.ts). Creation,
 * edits, start-all and add-block writes are read back from the database; the
 * repository refuses anything invalid, so a rejected save leaves zero rows.
 *
 * Replaced: the native database open and the router. The one mocked state a
 * real UI cannot produce is named in its test: `active-conflict` forced
 * through a genuinely active session is real; `block-not-available` is
 * reached by really consuming the block first.
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

import SessionPlanDetailRoute from '@/app/session-plan/[planId]';
import SessionPlanNewRoute, { SessionPlanNewScreen } from '@/app/session-plan/new';
import { ExercisePicker } from '@/components/session-recorder/exercise-picker';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { sessions } from '@/src/data/schema';
import { planRepository, savePlanEdits, startSessionPlan } from '@/src/session-planner';
import type { PlanFormState } from '@/src/session-planner/plan-form-model';
import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import { loadActiveSessionId } from '@/src/session-entry';
import { planQueries } from '@/src/session-planner/plan-queries';
import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  resetLocalData();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockBack.mockReset();
  mockParams = {};
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

// ---- Seeding

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

const createPlanThroughRepository = async (overrides: {
  title?: string;
  scheduledFor?: Date | null;
  name?: string;
  sets?: { targetWeightText: string; targetRepsText: string }[];
} = {}) => {
  const result = await planRepository.createPlan({
    title: overrides.title ?? 'Heavy Day',
    gymId: null,
    scheduledFor: overrides.scheduledFor ?? null,
    exercises: [
      {
        exerciseDefinitionId: 'ex-squat',
        name: overrides.name ?? 'Barbell Squat',
        machineName: '',
        sets:
          overrides.sets?.map((set) => ({ ...set, targetSetType: null as null })) ??
          [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
      },
    ],
  });
  if (result.status !== 'saved') throw new Error(`plan create failed: ${result.status}`);
  return result.id;
};

// ---- Form helpers

const fillTitle = (title: string) => fireEvent.changeText(screen.getByTestId('plan-form-title'), title);
const fillSchedule = (text: string) => fireEvent.changeText(screen.getByTestId('plan-form-schedule'), text);
const fillBlockName = async (blockIndex: number, name: string) => {
  fireEvent.press(screen.getByTestId(`plan-form-block-${blockIndex}-pick`));
  // Search results render flat, as in the session picker.
  fireEvent.changeText(screen.getByTestId('plan-exercise-pick-search'), name);
  fireEvent.press(await screen.findByLabelText(`Select exercise ${name}`));
};
const fillSet = (blockIndex: number, setIndex: number, weight: string, reps: string) => {
  fireEvent.changeText(screen.getByTestId(`plan-form-block-${blockIndex}-set-${setIndex}-weight`), weight);
  fireEvent.changeText(screen.getByTestId(`plan-form-block-${blockIndex}-set-${setIndex}-reps`), reps);
};

const callbackMocks = () => ({
  onClose: jest.fn(),
  onSelectExercise: jest.fn(),
  onAppendPlan: jest.fn(),
  onAddPlanBlock: jest.fn(),
  onOpenManage: jest.fn(),
});

const pressAlertButton = (label: string) => {
  const call = alertSpy.mock.calls.at(-1);
  const button = (call?.[2] as { text: string; onPress?: () => void }[] | undefined)?.find(
    (candidate) => candidate.text === label,
  );
  act(() => button?.onPress?.());
};

// ---- The form: create, validation, duplicate prefill

describe('plan form: create', () => {
  it('saves a valid plan offline; it lands in the Unscheduled queue immediately', async () => {
    await seedCatalog();
    render(<SessionPlanNewScreen editPlanId={null} fromPlanId={null} />);

    fillTitle('Heavy Day');
    await fillBlockName(1, 'Barbell Squat');
    fillSet(1, 1, '100', '5');
    fireEvent.press(screen.getByTestId('plan-form-save'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    const unscheduled = await planQueries.listUnscheduledPlans();
    expect(unscheduled).toHaveLength(1);
    expect(unscheduled[0]).toMatchObject({ title: 'Heavy Day', progress: 'planned' });
  });

  it('keeps invalid fields in place with accessible messages and writes nothing', async () => {
    await seedCatalog();
    render(<SessionPlanNewScreen editPlanId={null} fromPlanId={null} />);

    // No title and invalid reps: their errors stay at the fields.
    await fillBlockName(1, 'Barbell Squat');
    fillSet(1, 1, '120', '0');
    fireEvent.press(screen.getByTestId('plan-form-save'));

    expect(await screen.findByTestId('plan-form-title-error')).toBeTruthy();
    expect(screen.getByTestId('plan-form-block-1-set-1-reps-error')).toHaveTextContent(
      'Reps must be a whole number from 1 to 999.'
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect((await planQueries.listUnscheduledPlans()).concat(await planQueries.listUpcomingPlans())).toHaveLength(0);
  });

  it('a bad schedule stays on its field; a valid one schedules the plan', async () => {
    await seedCatalog();
    render(<SessionPlanNewScreen editPlanId={null} fromPlanId={null} />);

    fillTitle('Tomorrow Work');
    await fillBlockName(1, 'Barbell Squat');
    fillSet(1, 1, '100', '5');
    fillSchedule('2026-10-07 07:00');
    fireEvent.press(screen.getByTestId('plan-form-save'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    const upcoming = await planQueries.listUpcomingPlans();
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].scheduledFor?.getHours()).toBe(7);
  });

  it('prefills from the source plan and saving creates a new plan, never an in-place copy', async () => {
    await seedCatalog();
    const sourceId = await createPlanThroughRepository({ title: 'Original', scheduledFor: new Date(2026, 9, 6, 7) });
    render(<SessionPlanNewScreen editPlanId={null} fromPlanId={sourceId} />);

    expect(await screen.findByTestId('plan-form-title')).toHaveProp('value', 'Original');
    expect(screen.getByTestId('plan-form-schedule')).toHaveProp('value', '2026-10-06 07:00');

    fillTitle('Duplicate of Original');
    fillSchedule('');
    fireEvent.press(screen.getByTestId('plan-form-save'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    const plans = [
      ...(await planQueries.listUnscheduledPlans()),
      ...(await planQueries.listUpcomingPlans()),
    ];
    expect(plans.map((plan) => plan.title).sort()).toEqual(['Duplicate of Original', 'Original']);
  });
});

// ---- The detail: read, start all, add block, delete

describe('plan detail', () => {
  const openDetail = async (planId: string) => {
    mockParams = { planId };
    render(<SessionPlanDetailRoute />);
    await screen.findByTestId('plan-detail');
  };

  it('reads the plan: title, schedule, blocks with targets and states', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository({
      title: 'Heavy Day',
      sets: [
        { targetWeightText: '100', targetRepsText: '5' },
        { targetWeightText: '', targetRepsText: '8' },
      ],
    });
    await openDetail(planId);

    expect(screen.getByTestId('plan-detail-title')).toHaveTextContent('Heavy Day');
    expect(screen.getByTestId('plan-detail-schedule')).toHaveTextContent('Unscheduled');
    expect(screen.getByTestId('plan-detail-block-1-state')).toHaveTextContent('Ready · Block 1 of 1');
    expect(screen.getByTestId('plan-detail-block-1-targets')).toHaveTextContent('100 kg × 5 · — × 8');
    // Deletable while nothing is consumed.
    expect(screen.getByTestId('plan-detail-delete')).toBeTruthy();
  });

  it("Start all creates the active session with the plan's provenance and routes to it", async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    await openDetail(planId);

    fireEvent.press(screen.getByTestId('plan-detail-start-all'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    // The href builder encodes the owner-composed id's colons.
    const startedSessionId = decodeURIComponent(
      String(mockPush.mock.calls[0][0]).replace('/session/', ''),
    );
    const sessionRow = localDatabase().select().from(sessions).all().find((row) => row.id === startedSessionId);
    expect(sessionRow).toMatchObject({ status: 'active', sourcePlanId: planId });
  });

  it('Start all with another active session offers one Resume and creates nothing', async () => {
    await seedCatalog();
    await persistSessionDraftSnapshot({
      sessionId: 'live-session-1',
      gymId: null,
      startedAt: new Date(),
      exercises: [],
    });
    const plansBefore = await planQueries.listUnscheduledPlans();
    const planId = await createPlanThroughRepository();
    await openDetail(planId);

    fireEvent.press(screen.getByTestId('plan-detail-start-all'));

    expect(await screen.findByTestId('plan-detail-notice')).toBeTruthy();
    expect(screen.getByTestId('plan-detail-resume')).toBeTruthy();
    fireEvent.press(screen.getByTestId('plan-detail-resume'));
    expect(mockPush).toHaveBeenCalledWith('/session/live-session-1');
    // No second session: only the pre-existing active one.
    const activeRows = localDatabase().select().from(sessions).all().filter((row) => row.status === 'active');
    expect(activeRows).toHaveLength(1);
    expect(plansBefore.length).toBe(0);
  });

  it('Add block attaches to the only compatible unsourced card; several offer the choice', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    // One active session, two unsourced Barbell Squat cards: ambiguous.
    await persistSessionDraftSnapshot({
      sessionId: 'live-session-1',
      gymId: null,
      startedAt: new Date(),
      exercises: [
        {
          id: 'card-1',
          exerciseDefinitionId: 'ex-squat',
          name: 'Barbell Squat',
          sets: [{ id: 'card-1-set-1', repsValue: '', weightValue: '', setType: null, performanceStatus: null }],
        },
        {
          id: 'card-2',
          exerciseDefinitionId: 'ex-squat',
          name: 'Barbell Squat',
          sets: [],
        },
      ],
    });
    await openDetail(planId);

    fireEvent.press(screen.getByTestId('plan-detail-block-1-add'));

    // Nothing written before the choice; the sheet lists both candidates.
    expect(await screen.findByTestId('plan-card-choice-sheet')).toBeTruthy();
    expect(await screen.findByTestId('plan-detail-block-1-state')).toHaveTextContent('Ready · Block 1 of 1');
    expect(screen.getByTestId('plan-card-choice-card-1')).toBeTruthy();
    expect(screen.getByTestId('plan-card-choice-card-2')).toBeTruthy();

    fireEvent.press(screen.getByTestId('plan-card-choice-card-1'));
    fireEvent.press(screen.getByTestId('plan-card-choice-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('plan-card-choice-sheet')).toBeNull();
    });
    expect(mockPush).toHaveBeenCalledWith('/session/live-session-1');
    // The chosen card carries the block; the other stays unsourced.
    const planDetail = await planQueries.loadPlanDetail(planId);
    expect(planDetail?.blocks[0]).toMatchObject({
      status: 'attached',
      attachedSessionExerciseId: 'card-1',
    });
  });
});

describe('plan detail: edit, skip, and the recorder complete', () => {
  const openDetail = async (planId: string) => {
    mockParams = { planId };
    render(<SessionPlanDetailRoute />);
    await screen.findByTestId('plan-detail');
  };

  it('Edit opens the shared form over the plan; Save changes writes meta and blocks', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository({ title: 'Heavy Day' });
    await openDetail(planId);

    fireEvent.press(screen.getByTestId('plan-detail-edit'));
    expect(mockPush).toHaveBeenCalledWith(`/session-plan/new?edit=${encodeURIComponent(planId)}`);

    // The edit form over real data: prefill, change, save through the sync.
    mockParams = { edit: planId };
    render(<SessionPlanNewRoute />);
    expect(await screen.findByTestId('plan-form-title')).toHaveProp('value', 'Heavy Day');
    fillTitle('Heavy Day II');
    fillSet(1, 1, '105', '5');
    fireEvent.press(screen.getByTestId('plan-form-save'));

    await waitFor(async () => {
      const detail = await planQueries.loadPlanDetail(planId);
      expect(detail?.title).toBe('Heavy Day II');
      expect(detail?.blocks[0].targets[0]).toMatchObject({ targetWeightValue: '105' });
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it('an edit that would touch a consumed block is refused before anything writes', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    await openDetail(planId);
    fireEvent.press(screen.getByTestId('plan-detail-start-all'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    mockParams = { edit: planId };
    render(<SessionPlanNewRoute />);
    expect(await screen.findByTestId('plan-form-title')).toHaveProp('value', 'Heavy Day');
    // Meta alone stays editable with a consumed block; the BLOCK is the
    // read-only snapshot.
    fillTitle('Rewritten');
    fireEvent.press(screen.getByTestId('plan-form-save'));
    await waitFor(async () => expect(mockBack).toHaveBeenCalled());

    // Now the block: rename it and the whole edit refuses, nothing writes.
    render(<SessionPlanNewRoute />);
    expect(await screen.findByTestId('plan-form-title')).toHaveProp('value', 'Rewritten');
    await fillBlockName(1, 'Bench Press');
    fillSet(1, 1, '999', '5');
    fireEvent.press(screen.getByTestId('plan-form-save'));

    expect(await screen.findByTestId('plan-form-notice')).toHaveTextContent(
      'A block that is in progress or already done is read-only; it cannot be changed here.'
    );
    const detail = await planQueries.loadPlanDetail(planId);
    expect(detail?.title).toBe('Rewritten');
    expect(detail?.blocks[0].name).toBe('Barbell Squat');
    expect(detail?.blocks[0].targets[0]).toMatchObject({ targetWeightValue: '100' });
  });

  it('Skip without doing it resolves the pending block with no performed rows', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    await openDetail(planId);

    fireEvent.press(screen.getByTestId('plan-detail-block-1-skip'));
    pressAlertButton('Skip');

    await waitFor(async () => {
      const detail = await planQueries.loadPlanDetail(planId);
      expect(detail?.blocks[0].status).toBe('skipped');
    });
    expect(localDatabase().select().from(sessions).all()).toHaveLength(0);
    expect(await screen.findByTestId('plan-detail-block-1-state')).toHaveTextContent('Skipped · Block 1 of 1');
  });
});

describe('recorder: complete block on a sourced card', () => {
  const startFromPlan = async (planId: string): Promise<string> => {
    const result = await startSessionPlan(planId);
    if (result.status !== 'started') throw new Error(`start failed: ${result.status}`);
    const detail = await planQueries.loadPlanDetail(planId);
    const cardId = detail?.blocks[0].attachedSessionExerciseId;
    if (!cardId) throw new Error('no card');
    return cardId;
  };

  const determineSessionId = async (): Promise<string> => {
    const id = await loadActiveSessionId();
    if (id === null) throw new Error('no active session');
    return id;
  };

  it('the sourced card offers Complete block; without a confirmed planned set it refuses', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    const cardId = await startFromPlan(planId);

    render(<ExercisePageScreen sessionExerciseId={cardId} sessionId={await determineSessionId()} />);
    await screen.findByTestId('exercise-page');

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    expect(await screen.findByTestId('exercise-options-complete-block')).toBeTruthy();
    fireEvent.press(screen.getByTestId('exercise-options-complete-block'));

    expect(await screen.findByTestId('exercise-block-notice')).toHaveTextContent(
      'Finish one planned set first: confirm a set the block planned.'
    );
    const detail = await planQueries.loadPlanDetail(planId);
    expect(detail?.blocks[0].status).toBe('attached');
  });

  it('confirming a planned set then Complete block advances the block, the recorder stays open', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    const cardId = await startFromPlan(planId);

    render(<ExercisePageScreen sessionExerciseId={cardId} sessionId={await determineSessionId()} />);
    await screen.findByTestId('exercise-page');

    // The planned rows are the cursor: type the first one's values and commit.
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '100');
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '5');
    fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));

    fireEvent.press(screen.getByTestId('exercise-page-options'));
    fireEvent.press(await screen.findByTestId('exercise-options-complete-block'));

    expect(await screen.findByTestId('exercise-block-notice')).toHaveTextContent(
      'Block completed. It no longer counts as waiting.'
    );
    const detail = await planQueries.loadPlanDetail(planId);
    expect(detail?.blocks[0].status).toBe('completed');
    // The recorder never closed: the set list is still there.
    expect(screen.getByTestId('exercise-set-list')).toBeTruthy();
  });

  it('a resolved block never offers Complete block again', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    const cardId = await startFromPlan(planId);
    const sessionId = await determineSessionId();

    render(<ExercisePageScreen sessionExerciseId={cardId} sessionId={sessionId} />);
    await screen.findByTestId('exercise-page');
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '100');
    fireEvent.changeText(screen.getByTestId('exercise-set-logger-reps'), '5');
    fireEvent.press(screen.getByTestId('exercise-set-logger-commit'));
    fireEvent.press(screen.getByTestId('exercise-page-options'));
    fireEvent.press(await screen.findByTestId('exercise-options-complete-block'));
    await waitFor(async () => {
      expect((await planQueries.loadPlanDetail(planId))?.blocks[0].status).toBe('completed');
    });

    // The page renders again over the same, now resolved card: no offer.
    const view = render(<ExercisePageScreen sessionExerciseId={cardId} sessionId={sessionId} />);
    await view.findByTestId('exercise-page');
    await act(async () => {});
    fireEvent.press(view.getByTestId('exercise-page-options'));
    await view.findByTestId('exercise-options-sheet');
    expect(view.queryByTestId('exercise-options-complete-block')).toBeNull();
    view.unmount();
  });
});

describe('plan edit sync: order and refusals', () => {
  const formFromScratch = (blocks: { name: string; weight: string; reps: string }[]): PlanFormState => ({
    title: 'Edited',
    scheduleText: '',
    gymId: null,
    blocks: blocks.map((block) => ({
      id: `form-${block.name}`,
      sourceBlockId: null,
      exerciseDefinitionId: null,
      name: block.name,
      machineName: '',
      loadInputMode: null,
      sets: [{ id: `set-${block.name}`, targetWeightText: block.weight, targetRepsText: block.reps, targetSetType: null }],
    })),
  });

  it('a block added between kept blocks lands where the form showed it, not last', async () => {
    await seedCatalog();
    // Two authored blocks, then an edit that inserts one between them.
    const planId = await createPlanThroughRepository({ title: 'Two Blocks' });
    await planRepository.addPlanBlock(planId, {
      exerciseDefinitionId: 'ex-bench',
      name: 'Bench Press',
      machineName: '',
      sets: [{ targetWeightText: '60', targetRepsText: '8', targetSetType: null }],
    });
    const before = await planQueries.loadPlanDetail(planId);
    expect(before?.blocks.map((block) => block.name)).toEqual(['Barbell Squat', 'Bench Press']);

    // The form's blocks: [kept squat, NEW press, kept bench].
    const form: PlanFormState = {
      title: 'Two Blocks',
      scheduleText: '',
      gymId: null,
      blocks: [
        {
          id: 'form-1',
          sourceBlockId: before?.blocks[0].id ?? null,
          exerciseDefinitionId: 'ex-squat',
          name: 'Barbell Squat',
          machineName: '',
          loadInputMode: null,
          sets: [{ id: 's1', targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
        },
        {
          id: 'form-2',
          sourceBlockId: null,
          exerciseDefinitionId: 'ex-bench',
          name: 'Bench Press',
          machineName: '',
          loadInputMode: null,
          sets: [{ id: 's2', targetWeightText: '80', targetRepsText: '6', targetSetType: null }],
        },
        {
          id: 'form-3',
          sourceBlockId: before?.blocks[1].id ?? null,
          exerciseDefinitionId: 'ex-bench',
          name: 'Bench Press',
          machineName: '',
          loadInputMode: null,
          sets: [{ id: 's3', targetWeightText: '60', targetRepsText: '8', targetSetType: null }],
        },
      ],
    };
    const result = await savePlanEdits(planId, form);
    expect(result.status).toBe('updated');

    const after = await planQueries.loadPlanDetail(planId);
    expect(after?.blocks.map((block) => block.name)).toEqual([
      'Barbell Squat',
      'Bench Press', // the new one, at the position the form showed
      'Bench Press',
    ]);
    expect(after?.blocks[1].targets[0]).toMatchObject({ targetWeightValue: '80' });
  });

  it('a reorder touching a consumed block refuses before anything writes', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    await startSessionPlan(planId); // attaches the only block: consumed
    const before = await planQueries.loadPlanDetail(planId);
    // Add nothing, change nothing: only move a NEW block before the consumed
    // one — the form order alone would reshuffle the consumed sequence.
    const form: PlanFormState = {
      title: 'Two Blocks',
      scheduleText: '',
      gymId: null,
      blocks: [
        {
          id: 'form-new',
          sourceBlockId: null,
          exerciseDefinitionId: 'ex-bench',
          name: 'Bench Press',
          machineName: '',
          loadInputMode: null,
          sets: [{ id: 'sn', targetWeightText: '60', targetRepsText: '8', targetSetType: null }],
        },
        {
          id: 'form-kept',
          sourceBlockId: before?.blocks[0].id ?? null,
          exerciseDefinitionId: 'ex-squat',
          name: 'Barbell Squat',
          machineName: '',
          loadInputMode: null,
          sets: [{ id: 'sk', targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
        },
      ],
    };
    const result = await savePlanEdits(planId, form);
    expect(result.status).toBe('immutable-block');
    const after = await planQueries.loadPlanDetail(planId);
    expect(after?.title).toBe('Heavy Day');
    expect(after?.blocks).toHaveLength(1);
    expect(after?.blocks[0].name).toBe('Barbell Squat');
  });
});
describe('review fixes: candidate filter, skip refusal, resolved card, completed session', () => {
  const openDetail = async (planId: string) => {
    mockParams = { planId };
    render(<SessionPlanDetailRoute />);
    await screen.findByTestId('plan-detail');
  };

  it('the card choice never offers an already-sourced card', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    // Two same-exercise cards, one already sourced from another plan's block.
    const otherPlanId = await createPlanThroughRepository({ title: 'Other Plan' });
    const otherBlockId = (await planQueries.loadPlanDetail(otherPlanId))?.blocks[0].id as string;
    await persistSessionDraftSnapshot({
      sessionId: 'live-session-1',
      gymId: null,
      startedAt: new Date(),
      exercises: [
        {
          id: 'card-1',
          exerciseDefinitionId: 'ex-squat',
          name: 'Barbell Squat',
          sourcePlanExerciseId: otherBlockId,
          sets: [],
        },
        {
          id: 'card-2',
          exerciseDefinitionId: 'ex-squat',
          name: 'Barbell Squat',
          sets: [],
        },
      ],
    });
    await openDetail(planId);

    fireEvent.press(screen.getByTestId('plan-detail-block-1-add'));
    // The sheet never opens: one unsourced candidate attaches directly.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/live-session-1'));
    expect(screen.queryByTestId('plan-card-choice-sheet')).toBeNull();
    const detail = await planQueries.loadPlanDetail(planId);
    expect(detail?.blocks[0]).toMatchObject({ status: 'attached', attachedSessionExerciseId: 'card-2' });
  });

  it('Skip with confirmed work says so instead of reloading silently', async () => {
    await seedCatalog();
    const planId = await createPlanThroughRepository();
    await openDetail(planId);
    // Start all, then confirm a planned set: skip is now impossible.
    fireEvent.press(screen.getByTestId('plan-detail-start-all'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const detail = await planQueries.loadPlanDetail(planId);
    const cardId = detail?.blocks[0].attachedSessionExerciseId as string;
    const sessionId = detail?.blocks[0].attachedSessionId as string;
    const snapshot = await loadSessionSnapshotById(sessionId);
    const card = snapshot?.exercises.find((exercise) => exercise.id === cardId);
    await persistSessionDraftSnapshot({
      sessionId,
      gymId: null,
      startedAt: new Date(),
      exercises: (snapshot?.exercises ?? []).map((exercise) =>
        exercise.id === cardId
          ? {
              ...exercise,
              sets: (exercise.sets ?? []).map((set, index) =>
                index === 0
                  ? { ...set, repsValue: '5', weightValue: '100', performanceStatus: null }
                  : set,
              ),
            }
          : exercise,
      ),
    });
    expect(card).toBeTruthy();

    mockParams = { planId };
    fireEvent.press(screen.getByTestId('plan-detail-block-1-skip'));
    pressAlertButton('Skip');

    expect(await screen.findByTestId('plan-detail-notice')).toHaveTextContent(
      'This block has confirmed work. Complete it instead of skipping.'
    );
    const after = await planQueries.loadPlanDetail(planId);
    expect(after?.blocks[0].status).toBe('attached');
  });

  it('the completed-session picker hides the From planner entry', async () => {
    await seedCatalog();
    const view = render(<ExercisePicker {...callbackMocks()} plannerEnabled={false} />);
    await act(async () => {});
    expect(view.queryByTestId('exercise-picker-planner-toggle')).toBeNull();
    // The default keeps the entry: it is only suppressed for a completed session.
    const enabled = render(<ExercisePicker {...callbackMocks()} />);
    await act(async () => {});
    expect(enabled.getByTestId('exercise-picker-planner-toggle')).toBeTruthy();
    enabled.unmount();
  });
});
