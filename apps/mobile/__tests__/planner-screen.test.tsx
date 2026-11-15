/* eslint-disable import/first */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule(),
);

const mockDismissTo = jest.fn();
const mockPush = jest.fn();
let mockIsFocused = true;

jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    useRouter: () => ({
      dismissTo: mockDismissTo,
      push: mockPush,
    }),
    useIsFocused: () => mockIsFocused,
    useLocalSearchParams: () => ({}),
    Stack: {
      Screen: ({ options }: { options?: { title?: string; headerRight?: () => unknown } }) => {
        const { Text } = jest.requireActual('react-native');
        return mockReact.createElement(
          mockReact.Fragment,
          null,
          options?.title ? mockReact.createElement(Text, { testID: 'header-title' }, options.title) : null,
          options?.headerRight?.() ?? null,
        );
      },
    },
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(() => (mockIsFocused ? callback() : undefined), [callback, mockIsFocused]);
    },
  };
});

import PlannerRoute, { PlannerScreen } from '../app/planner';
import { setExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import { EXERCISE_BLOCK_HISTORY_FIXTURE } from '@/src/maestro/exercise-block-history-fixture';
import { Tag } from '@/components/ui/tag';
import {
  planQueries,
  planRepository,
  skipPlanBlock,
  skipSessionPlanUse,
  startSessionPlan,
} from '@/src/session-planner';
import { createDrizzleSessionPlanStore } from '@/src/data/session-plan-store';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDataClient,
  resetLocalData,
} from './helpers/local-data';
import { waitForGone } from './helpers/wait-for-gone';
import { renderWithTheme } from './helpers/theme';

const openPlanner = async (prepare?: () => Promise<unknown>) => {
  await loadMaestroFixture('session-view');
  await prepare?.();
  await bootLocalApp();
  const view = renderWithTheme(<PlannerRoute />);
  await screen.findByTestId('planner-screen');
  return view;
};

const showCompletedPlans = () => {
  fireEvent.press(screen.getByTestId('planner-options-button'));
  fireEvent.press(screen.getByTestId('toggle-completed-plans'));
  fireEvent(screen.getByTestId('planner-options-sheet'), 'accessibilityEscape');
};

beforeEach(() => {
  resetLocalData();
  mockPush.mockClear();
  mockDismissTo.mockClear();
  mockIsFocused = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

afterAll(async () => {
  await closeLocalData();
});

describe('Planner sections', () => {
  const planDraft = (
    overrides: Partial<Parameters<typeof planRepository.createPlan>[0]> = {},
  ): Parameters<typeof planRepository.createPlan>[0] => ({
    title: 'Heavy Day',
    gymId: null,
    scheduledFor: null,
    exercises: [
      {
        exerciseDefinitionId: null,
        name: 'Back Squat',
        sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
      },
    ],
    ...overrides,
  });

  const seedPlans = async () => {
    // Upcoming, soonest last in creation order; the query sorts by schedule.
    await planRepository.createPlan(
      planDraft({ title: 'Later Week', scheduledFor: new Date(2026, 9, 12, 7) }),
      new Date(2026, 9, 1, 8),
    );
    await planRepository.createPlan(
      planDraft({ title: 'Tomorrow', scheduledFor: new Date(2026, 9, 6, 7) }),
      new Date(2026, 9, 1, 9),
    );
    // Unscheduled; the most recently updated leads.
    await planRepository.createPlan(planDraft({ title: 'Old Idea' }), new Date(2026, 9, 2, 8));
    await planRepository.createPlan(planDraft({ title: 'New Idea' }), new Date(2026, 9, 3, 8));
  };

  const planRowLabels = (testID: string) =>
    screen
      .getAllByTestId(new RegExp(`^${testID}-row-`))
      .map((node) => String(node.props.accessibilityLabel));

  it('separates Upcoming (by schedule) and Unscheduled (by recency) from Completed', async () => {
    await openPlanner(seedPlans);

    expect(planRowLabels('planner-plan-section-upcoming')).toEqual([
      'Tomorrow, 06-10-2026 07:00',
      'Later Week, 12-10-2026 07:00',
    ]);
    expect(planRowLabels('planner-plan-section-unscheduled')).toEqual([
      'New Idea, Unscheduled',
      'Old Idea, Unscheduled',
    ]);

    // A plan row opens the plan detail; the action opens the form.
    fireEvent.press(screen.getAllByTestId(/^planner-plan-section-unscheduled-row-/)[0]);
    expect(mockPush).toHaveBeenCalledWith(
      `/session-plan/${String(screen.getAllByTestId(/^planner-plan-section-unscheduled-row-/)[0].props.testID).replace('planner-plan-section-unscheduled-row-', '')}`,
    );
    fireEvent.press(screen.getByTestId('planner-plan-session-action'));
    expect(mockPush).toHaveBeenCalledWith('/session-plan/new');
  });

  it('shows the quiet Plan session action and no plan sections when nothing is planned', async () => {
    await openPlanner();

    expect(screen.queryByTestId('planner-plan-section-upcoming')).toBeNull();
    expect(screen.queryByTestId('planner-plan-section-unscheduled')).toBeNull();
    expect(screen.getByTestId('planner-plan-session-action')).toBeTruthy();
    fireEvent.press(screen.getByTestId('planner-plan-session-action'));
    expect(mockPush).toHaveBeenCalledWith('/session-plan/new');
  });

  it('surfaces training programmes in Unscheduled and supports creating programmes', async () => {
    await openPlanner(async () => {
      await planRepository.createProgramme({
        name: 'Block Periodization',
        description: '4 weeks',
        plans: [planDraft({ title: 'Accumulation A' }), planDraft({ title: 'Accumulation B' })],
      });
    });

    const programmeRow = screen.getByTestId(/^planner-plan-section-unscheduled-programme-/);
    expect(programmeRow).toBeTruthy();
    expect(programmeRow.props.accessibilityLabel).toContain('Block Periodization');
    expect(programmeRow.props.accessibilityLabel).toContain('2 sessions');

    fireEvent.press(programmeRow);
    const progId = String(programmeRow.props.testID).replace(
      'planner-plan-section-unscheduled-programme-',
      '',
    );
    expect(mockPush).toHaveBeenCalledWith(`/programme/${progId}`);

    fireEvent.press(screen.getByTestId('planner-new-programme-action'));
    expect(mockPush).toHaveBeenCalledWith('/programme/new');
  });

  it('keeps dates only in Upcoming planning rows, retaining completed outcomes and routes', async () => {
    const finished = new Date(2026, 9, 25, 0, 30);
    let programmeId = '';
    let completePlanId = '';
    let skippedPlanId = '';
    const resolvePlan = async (id: string, outcome: 'completed' | 'skipped', date: Date | null) => {
      const plan = (await planQueries.loadPlanDetail(id))!;
      for (const block of plan.blocks) {
        localDataClient()
          .prepare(
            'UPDATE session_plan_exercises SET progress_status = ?, resolved_at = ? WHERE id = ?',
          )
          .run(outcome, date?.getTime() ?? null, block.id);
      }
    };
    await openPlanner(async () => {
      await seedPlans();
      completePlanId = (await planQueries.listUpcomingPlans())[0].id;
      skippedPlanId = (await planQueries.listUnscheduledPlans())[0].id;
      await resolvePlan(completePlanId, 'completed', finished);
      await resolvePlan(skippedPlanId, 'skipped', null);
      const programme = await planRepository.createProgramme({
        name: 'Finished wave',
        description: '',
        plans: [planDraft(), planDraft()],
      });
      if (programme.status !== 'saved') throw new Error('seed failed');
      programmeId = programme.id;
      for (const plan of (await planQueries.loadProgrammeDetail(programmeId))!.plans) {
        await resolvePlan(plan.id, 'completed', finished);
      }
    });
    showCompletedPlans();
    const done = screen.getByTestId(`planner-plan-section-completed-row-${completePlanId}`);
    expect(within(done).getByText('Completed')).toBeTruthy();
    expect(within(done).getByText('1 block · 1 completed · 0 skipped')).toBeTruthy();
    expect(done.props.accessibilityLabel).toBe('Tomorrow, Completed, 1 block · 1 completed · 0 skipped');
    expect(within(done).queryByText(/25-10-2026/)).toBeNull();
    expect(within(done).queryByText('06-10-2026 07:00')).toBeNull();
    expect(planRowLabels('planner-plan-section-upcoming')[0]).toBe('Later Week, 12-10-2026 07:00');
    const skipped = screen.getByTestId(`planner-plan-section-completed-row-${skippedPlanId}`);
    expect(within(skipped).getByText('Skipped')).toBeTruthy();
    expect(within(skipped).getByText('1 block · 0 completed · 1 skipped')).toBeTruthy();
    expect(within(skipped).queryByText(/Unscheduled/)).toBeNull();
    const programme = screen.getByTestId(`planner-plan-section-completed-programme-${programmeId}`);
    expect(within(programme).getByText('Completed')).toBeTruthy();
    expect(within(programme).getByText('Programme · 2 sessions')).toBeTruthy();
    expect(programme.props.accessibilityLabel).toBe('Programme Finished wave, 2 sessions, Completed');
    expect(within(programme).queryByText(/25-10-2026/)).toBeNull();

    fireEvent.press(done);
    expect(mockPush).toHaveBeenLastCalledWith(`/session-plan/${completePlanId}`);
    fireEvent.press(programme);
    expect(mockPush).toHaveBeenLastCalledWith(`/programme/${programmeId}`);

    await act(async () => setExerciseListPreferences({ dateFormat: 'YYYY-MM-DD' }));
    expect(planRowLabels('planner-plan-section-upcoming')[0]).toBe('Later Week, 2026-10-12 07:00');
    expect(
      within(screen.getByTestId(`planner-plan-section-completed-row-${completePlanId}`)).queryByText(
        /2026-10-25/,
      ),
    ).toBeNull();
  });

  it('refreshes completion on focus and retains the last rows after a failed plan read', async () => {
    const view = await openPlanner(seedPlans);
    showCompletedPlans();
    const id = (await planQueries.listUpcomingPlans())[0].id;
    const block = (await planQueries.loadPlanDetail(id))!.blocks[0];
    mockIsFocused = false;
    view.rerender(<PlannerRoute />);
    await skipPlanBlock(block.id, new Date(2026, 9, 25, 12));
    mockIsFocused = true;
    view.rerender(<PlannerRoute />);
    const row = () => within(screen.getByTestId(`planner-plan-section-completed-row-${id}`));
    await waitFor(() => expect(row().getByText('Skipped')).toBeTruthy());
    jest.spyOn(planQueries, 'listUpcomingPlans').mockRejectedValueOnce(new Error('failed read'));
    mockIsFocused = false;
    view.rerender(<PlannerRoute />);
    mockIsFocused = true;
    view.rerender(<PlannerRoute />);
    await screen.findByTestId('planner-plan-section-routines-error');
    expect(row().getByText('Skipped')).toBeTruthy();
  });
});

describe('Planner completed-plan visibility over real data', () => {
  beforeEach(async () => {
    await bootLocalApp();
    mockPush.mockClear();
    mockDismissTo.mockClear();
    mockIsFocused = true;
  });

  const store = createDrizzleSessionPlanStore();
  const now = new Date(2026, 10, 4, 10);
  const planInput = (title: string, scheduledFor: Date | null = null) => ({
    title,
    scheduledFor,
    gymId: null,
    exercises: [
      {
        exerciseDefinitionId: 'seed_barbell_bench_press',
        name: 'Bench Press',
        sets: [{ targetWeightValue: '100', targetReps: 5, targetSetType: null }],
      },
    ],
  });
  const resolvePlan = async (id: string, status: 'completed' | 'skipped' = 'completed') => {
    const detail = await planQueries.loadPlanDetail(id);
    for (const block of detail!.blocks) {
      await store.resolvePlanBlock({ planExerciseId: block.id, status, now });
    }
  };
  const planRow = (id: string, queue = 'unscheduled') => `planner-plan-section-${queue}-row-${id}`;
  const programmeRow = (id: string, queue = 'unscheduled') =>
    `planner-plan-section-${queue}-programme-${id}`;
  const openOptions = () => fireEvent.press(screen.getByTestId('planner-options-button'));
  const toggleCompleted = () => fireEvent.press(screen.getByTestId('toggle-completed-plans'));
  const dismissOptions = () =>
    fireEvent(screen.getByTestId('planner-options-sheet'), 'accessibilityEscape');
  const rowIds = (queue: string) =>
    screen
      .getAllByTestId(new RegExp(`^planner-plan-section-${queue}-(row|programme)-`))
      .map((node) => node.props.testID);

  it('keeps partial programmes and unfinished children in their queues while resolved children appear once in programme order', async () => {
    let partial!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    let full!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    let future!: string;
    await openPlanner(async () => {
      future = await store.savePlanGraph(planInput('Completed in advance', new Date(2030, 0, 1)));
      partial = await store.saveProgrammeGraph(
        {
          name: 'Partial wave',
          description: null,
          plans: [
            planInput('Unscheduled completed child'),
            planInput('Later unfinished child', new Date(2026, 10, 8)),
            planInput('Scheduled skipped child', now),
            planInput('Sooner unfinished child', new Date(2026, 10, 7)),
          ],
        },
        now,
      );
      full = await store.saveProgrammeGraph(
        { name: 'Resolved wave', description: null, plans: [planInput('Resolved unscheduled child')] },
        new Date(2026, 10, 3),
      );
      await resolvePlan(future);
      await resolvePlan(partial.planIds[0]);
      await resolvePlan(partial.planIds[2], 'skipped');
      await resolvePlan(full.planIds[0]);
    });
    const parent = screen.getByTestId(programmeRow(partial.programmeId));
    expect(within(parent).getByText('1 over 4')).toBeTruthy();
    expect(within(parent).getByText('Programme · 4 sessions · 1 skipped')).toBeTruthy();
    expect(parent.props.accessibilityLabel).toBe(
      'Programme Partial wave, 4 sessions, 1 of 4 sessions completed, 1 skipped',
    );
    const fractionTag = parent.findByType(Tag);
    expect(fractionTag.props).toEqual({ label: '1 over 4' });
    expect(within(parent).getAllByText('1 over 4')).toHaveLength(1);
    const upcomingIds = [planRow(partial.planIds[3], 'upcoming'), planRow(partial.planIds[1], 'upcoming')];
    expect(rowIds('upcoming')).toEqual(upcomingIds);
    expect(screen.queryByTestId('planner-plan-section-completed')).toBeNull();

    openOptions();
    toggleCompleted();
    dismissOptions();
    expect(rowIds('upcoming')).toEqual(upcomingIds);
    expect(rowIds('unscheduled')).toEqual([programmeRow(partial.programmeId)]);
    expect(rowIds('completed')).toEqual([
      programmeRow(full.programmeId, 'completed'),
      planRow(partial.planIds[2], 'completed'),
      planRow(future, 'completed'),
      planRow(partial.planIds[0], 'completed'),
      planRow(full.planIds[0], 'completed'),
    ]);
    expect(screen.getAllByText('1 over 4')).toHaveLength(1);
    expect(screen.getByTestId(programmeRow(full.programmeId, 'completed')).findByType(Tag).props).toEqual({
      label: 'Completed',
    });
    expect(screen.queryByTestId(planRow(future, 'upcoming'))).toBeNull();
    expect(screen.queryByTestId(planRow(partial.planIds[0]))).toBeNull();
    fireEvent.press(screen.getByTestId(planRow(partial.planIds[0], 'completed')));
    expect(mockPush).toHaveBeenLastCalledWith(`/session-plan/${partial.planIds[0]}`);
    const headings = screen.getAllByRole('header').map((heading) => heading.props.children);
    expect(headings.indexOf('Unscheduled')).toBeLessThan(headings.indexOf('Completed plans'));
  });

  it.each([false, true])(
    'refreshes whole-session fractions and child placement on focus with completed visibility %s',
    async (showCompleted) => {
      let programme!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
      const view = await openPlanner(async () => {
        programme = await store.saveProgrammeGraph({
          name: 'Refreshed wave',
          description: null,
          plans: [planInput('First'), planInput('Second')],
        });
      });
      await screen.findByText('0 over 2');
      if (showCompleted) {
        openOptions();
        toggleCompleted();
        dismissOptions();
      }
      mockIsFocused = false;
      view.rerender(<PlannerRoute />);
      await resolvePlan(programme.planIds[0]);
      mockIsFocused = true;
      view.rerender(<PlannerRoute />);
      await screen.findByText('1 over 2');
      expect(screen.getByTestId(programmeRow(programme.programmeId)).props.accessibilityLabel).toContain(
        '1 of 2 sessions completed',
      );
      if (showCompleted) {
        expect(screen.getByTestId(planRow(programme.planIds[0], 'completed'))).toBeTruthy();
      } else {
        expect(screen.queryByTestId('planner-plan-section-completed')).toBeNull();
      }
      expect(screen.queryByTestId(planRow(programme.planIds[1]))).toBeNull();
    },
  );

  it('hides completed plans in both queues and scheduled programme children, and only fully resolved programmes', async () => {
    let scheduled!: string, unscheduled!: string;
    let full!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    let partial!: Awaited<ReturnType<typeof store.saveProgrammeGraph>>;
    await openPlanner(async () => {
      scheduled = await store.savePlanGraph(planInput('Completed scheduled', now), now);
      unscheduled = await store.savePlanGraph(planInput('All skipped'));
      full = await store.saveProgrammeGraph({
        name: 'Completed programme',
        description: null,
        plans: [planInput('Completed child', now)],
      });
      partial = await store.saveProgrammeGraph({
        name: 'Partial programme',
        description: null,
        plans: [planInput('Resolved child', now), planInput('Pending child', now)],
      });
      await resolvePlan(scheduled);
      await resolvePlan(unscheduled, 'skipped');
      await resolvePlan(full.planIds[0]);
      await resolvePlan(partial.planIds[0]);
    });
    await screen.findByTestId(programmeRow(partial.programmeId));

    expect(rowIds('upcoming')).toEqual([planRow(partial.planIds[1], 'upcoming')]);
    expect(rowIds('unscheduled')).toEqual([programmeRow(partial.programmeId)]);
    expect(screen.queryByTestId(planRow(scheduled, 'upcoming'))).toBeNull();
    expect(screen.queryByTestId(planRow(unscheduled))).toBeNull();
    expect(screen.queryByTestId(planRow(full.planIds[0], 'upcoming'))).toBeNull();
    expect(screen.queryByTestId(programmeRow(full.programmeId))).toBeNull();
  });
});

describe('Planner Routine section over real data', () => {
  const create = async (title = 'Anytime squat') => {
    const result = await planRepository.createPlan({
      title,
      isRoutine: true,
      scheduledFor: new Date(2026, 10, 1),
      gymId: null,
      exercises: [
        {
          exerciseDefinitionId: EXERCISE_BLOCK_HISTORY_FIXTURE.primaryExerciseId,
          name: 'Squat',
          sets: [{ targetWeightText: '60', targetRepsText: '5', targetSetType: null }],
        },
      ],
    });
    if (result.status !== 'saved') throw new Error('Routine fixture failed');
    return result.id;
  };

  it('keeps a skipped Routine separate from due and completed-plan queues, with its latest outcome spoken', async () => {
    let id = '';
    await openPlanner(async () => {
      id = await create();
      await skipSessionPlanUse(id, 'skip-once', new Date(2026, 10, 6));
    });
    const row = await screen.findByTestId(`planner-plan-section-routines-row-${id}`);
    expect(row.props.accessibilityLabel).toBe('Anytime squat, Routine, Last skipped · 06-11-2026');
    showCompletedPlans();
    expect(screen.queryByTestId(`planner-plan-section-upcoming-row-${id}`)).toBeNull();
    expect(screen.queryByTestId(`planner-plan-section-completed-row-${id}`)).toBeNull();
    fireEvent.press(row);
    expect(mockPush).toHaveBeenLastCalledWith(`/session-plan/${id}`);
  });

  it('retains cached Routine rows across a failed focus read and restores them with Retry', async () => {
    let id = '';
    const view = await openPlanner(async () => {
      id = await create('Long reusable session title');
    });
    await screen.findByTestId(`planner-plan-section-routines-row-${id}`);
    jest.spyOn(planQueries, 'listRoutines').mockRejectedValueOnce(new Error('Failed read fixture'));
    mockIsFocused = false;
    view.rerender(<PlannerRoute />);
    mockIsFocused = true;
    view.rerender(<PlannerRoute />);
    await screen.findByTestId('planner-plan-section-routines-error');
    expect(screen.getByTestId(`planner-plan-section-routines-row-${id}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId('planner-plan-section-routines-retry'));
    await waitForGone(() => screen.queryByTestId('planner-plan-section-routines-error'));
    expect(screen.getByTestId(`planner-plan-section-routines-row-${id}`)).toBeTruthy();
  });
});

describe('Planner Power UX scopes and agenda strip', () => {
  const planDraft = (
    overrides: Partial<Parameters<typeof planRepository.createPlan>[0]> = {},
  ): Parameters<typeof planRepository.createPlan>[0] => ({
    title: 'Power Session',
    gymId: null,
    scheduledFor: null,
    exercises: [
      {
        exerciseDefinitionId: null,
        name: 'Back Squat',
        sets: [{ targetWeightText: '100', targetRepsText: '5', targetSetType: null }],
      },
    ],
    ...overrides,
  });

  it('switches between scopes (All, Schedule, Routines, Programmes) with segmented control', async () => {
    let routineId = '';
    await openPlanner(async () => {
      const routine = await planRepository.createPlan(
        planDraft({ title: 'Morning Mobility', isRoutine: true }),
      );
      if (routine.status !== 'saved') throw new Error('Routine failed');
      routineId = routine.id;

      await planRepository.createPlan(
        planDraft({ title: 'Legs Tomorrow', scheduledFor: new Date(Date.now() + 86400000) }),
      );
      await planRepository.createPlan(planDraft({ title: 'Backlog Deadlift' }));
    });

    expect(screen.getByTestId('planner-scope-row')).toBeTruthy();
    expect(screen.getByTestId('planner-scope-all').props.accessibilityState).toEqual({ selected: true });
    expect(StyleSheet.flatten(screen.getByTestId('planner-scope-programmes').props.style)).toMatchObject({
      flexGrow: 1,
    });
    expect(StyleSheet.flatten(screen.getByTestId('planner-scope-programmes').props.style).flex).toBeUndefined();

    // Initial 'All' tab renders all sections and week strip
    expect(screen.getByTestId('planner-week-strip')).toBeTruthy();
    expect(screen.getByTestId('planner-plan-section-upcoming')).toBeTruthy();
    expect(screen.getByTestId('planner-plan-section-unscheduled')).toBeTruthy();
    expect(screen.getByTestId('planner-plan-section-routines')).toBeTruthy();

    // Switch to Schedule
    fireEvent.press(screen.getByTestId('planner-scope-schedule'));
    expect(screen.getByTestId('planner-scope-schedule').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('planner-week-strip')).toBeTruthy();
    expect(screen.getByTestId('planner-plan-section-upcoming')).toBeTruthy();
    expect(screen.getByTestId('planner-plan-section-unscheduled')).toBeTruthy();
    expect(screen.queryByTestId('planner-plan-section-routines')).toBeNull();

    // Switch to Routines
    fireEvent.press(screen.getByTestId('planner-scope-routines'));
    expect(screen.getByTestId('planner-scope-routines').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('planner-plan-section-routines')).toBeTruthy();
    expect(screen.getByTestId(`planner-plan-section-routines-row-${routineId}`)).toBeTruthy();
    expect(screen.queryByTestId('planner-week-strip')).toBeNull();
    expect(screen.queryByTestId('planner-plan-section-upcoming')).toBeNull();
    fireEvent.press(screen.getByTestId('planner-plan-session-action'));
    expect(mockPush).toHaveBeenCalledWith('/session-plan/new?routine=1');

    // Switch to Programmes
    fireEvent.press(screen.getByTestId('planner-scope-programmes'));
    expect(screen.getByTestId('planner-scope-programmes').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('planner-plan-section-programmes')).toBeTruthy();
    expect(screen.getByTestId('planner-new-programme-action')).toBeTruthy();
    expect(screen.queryByTestId('planner-plan-section-upcoming')).toBeNull();

    // Switch back to All
    fireEvent.press(screen.getByTestId('planner-scope-all'));
    expect(screen.getByTestId('planner-scope-all').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('planner-plan-section-upcoming')).toBeTruthy();
    expect(screen.getByTestId('planner-plan-section-routines')).toBeTruthy();
  });

  it('interacts with week strip to filter scheduled workouts by day and clears filter', async () => {
    const today = new Date();
    const todayKey = `${String(today.getFullYear()).padStart(4, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let planId = '';
    await openPlanner(async () => {
      const res = await planRepository.createPlan(
        planDraft({ title: 'Today Squats', scheduledFor: today }),
      );
      if (res.status !== 'saved') throw new Error('Plan failed');
      planId = res.id;
    });

    const todayDayTile = screen.getByTestId(`planner-week-strip-day-${todayKey}`);
    expect(todayDayTile).toBeTruthy();

    // Selecting today filters and switches to schedule scope
    fireEvent.press(todayDayTile);
    expect(screen.getByTestId('planner-scope-schedule').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId(`planner-plan-section-upcoming-row-${planId}`)).toBeTruthy();

    // Clear filter restores all upcoming dates
    expect(screen.getByTestId('planner-week-strip-clear')).toBeTruthy();
    fireEvent.press(screen.getByTestId('planner-week-strip-clear'));
    expect(screen.queryByTestId('planner-week-strip-clear')).toBeNull();
  });

  it('shows empty state panel when a day with no workouts is selected', async () => {
    await openPlanner(async () => {
      await planRepository.createPlan(
        planDraft({ title: 'Upcoming Workout', scheduledFor: new Date(2028, 5, 1) }),
      );
    });

    fireEvent.press(screen.getByTestId('planner-scope-schedule'));

    // Select the first day of the current week strip
    const allDays = screen.getAllByTestId(/^planner-week-strip-day-/);
    expect(allDays.length).toBe(7);
    fireEvent.press(allDays[0]);

    // Expect empty card with 'Plan a session' action
    expect(screen.getByTestId('planner-day-empty-card')).toBeTruthy();
    expect(screen.getByTestId('planner-plan-for-day')).toBeTruthy();
    fireEvent.press(screen.getByTestId('planner-plan-for-day'));
    expect(mockPush).toHaveBeenCalledWith('/session-plan/new');
  });
});
